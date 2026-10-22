import fs from 'node:fs';
import path from 'node:path';
import yazl from 'yazl';
import type {
  ChangeRecord,
  ExportConfig,
  ExportPreview,
  ExportReport,
  ExportWarning,
  FileEntry,
  ProjectMeta,
} from '../shared/types';
import {
  buildPackMcmeta,
  resolvePackVersion,
  serializePackMcmeta,
  validatePackMcmeta,
  type PackFormatVersion,
} from '../shared/packFormats';
import { CancelledError, ConflictError, describeError, UserError } from './errors';
import { imageInfo } from './png';
import {
  isPathInside,
  isSameOrInside,
  nextAvailableName,
  normalizeRelPath,
  sanitizeFileName,
  uniqueSuffix,
} from './paths';
import { ZipSource } from './source';
import { DirectorySource } from './source';
import type { ProgressContext } from './source';

export interface ExportSnapshot {
  meta: ProjectMeta;
  changes: ChangeRecord[];
  entries: FileEntry[];
  readWorking: (relPath: string) => Promise<Buffer>;
  readSource: (relPath: string) => Promise<Buffer>;
  hasWorking: (relPath: string) => Promise<boolean>;
  icon: { bytes: Buffer; width: number; height: number } | null;
  sourceAvailable: boolean;
}

export interface PreparedFile {
  relPath: string;
  bytes: Buffer;
  width?: number;
  height?: number;
}

export interface PreparedExport {
  config: Required<Pick<ExportConfig, 'name' | 'description' | 'format' | 'outputDir'>> & {
    targetVersion: string;
    outputName: string;
    overwrite: boolean;
  };
  version: PackFormatVersion;
  outputPath: string;
  suggestedName: string;
  files: PreparedFile[];
  icon?: { bytes: Buffer; width: number; height: number };
  packMetaText: string;
  warnings: ExportWarning[];
  errors: string[];
  conflict: boolean;
  totalFiles: number;
  estimatedBytes: number;
}

export interface ExportFsHooks {
  writeFile?: (file: string, data: Buffer | string) => Promise<void>;
  unlink?: (file: string) => Promise<void>;
}

function outputConflictError(prepared: PreparedExport): ConflictError {
  return new ConflictError(
    `Le fichier ou dossier « ${path.basename(prepared.outputPath)} » existe déjà à cet emplacement. Choisissez un autre nom ou confirmez explicitement le remplacement.`,
    prepared.suggestedName,
  );
}

function safeName(name: string, fallback: string): string {
  return sanitizeFileName(name.replace(/\.zip$/i, ''), fallback);
}

export async function resolveOutputPath(
  outputDir: string,
  baseName: string,
  format: 'folder' | 'zip',
): Promise<{ outputPath: string; conflict: boolean; suggestedName: string }> {
  const dir = path.resolve(outputDir);
  const target = format === 'zip' ? path.join(dir, `${baseName}.zip`) : path.join(dir, baseName);
  if (path.dirname(target) !== dir) {
    throw new UserError('Le chemin de sortie est invalide.', 'INVALID_OUTPUT');
  }
  const exists = async (candidate: string): Promise<boolean> => {
    try {
      await fs.promises.access(candidate);
      return true;
    } catch {
      return false;
    }
  };
  const conflict = await exists(target);
  let suggestedName = baseName;
  if (conflict) {
    suggestedName = await nextAvailableName(baseName, (name) =>
      format === 'zip' ? fs.existsSync(path.join(dir, `${name}.zip`)) : fs.existsSync(path.join(dir, name)),
    );
  }
  return { outputPath: target, conflict, suggestedName };
}

/**
 * Construit la liste exacte des fichiers à exporter : uniquement les modifications
 * actives, plus pack.mcmeta et éventuellement pack.png. Aucun fichier original non
 * modifié n'entre dans le pack.
 */
export async function prepareExport(snapshot: ExportSnapshot, config: ExportConfig): Promise<PreparedExport> {
  const warnings: ExportWarning[] = [];
  const errors: string[] = [];

  if (!config.outputDir || !path.isAbsolute(config.outputDir)) {
    throw new UserError('Choisissez un dossier de sortie valide (chemin absolu).', 'INVALID_OUTPUT');
  }
  const outputDir = path.resolve(config.outputDir);
  if (snapshot.meta.source.type === 'directory' && isSameOrInside(snapshot.meta.source.path, outputDir)) {
    errors.push(
      'Le dossier de sortie se trouve à l’intérieur du dossier source importé. Choisissez un emplacement extérieur pour ne jamais toucher à la source.',
    );
  }

  let resolved;
  try {
    resolved = resolvePackVersion(config.targetVersion, config.customFormat);
  } catch (error) {
    throw new UserError(describeError(error), 'INVALID_VERSION');
  }
  const version = resolved.version;
  warnings.push(...resolved.warnings.map((message) => ({ code: 'UNVERIFIED_VERSION', message })));

  const description = (config.description ?? '').trim();
  if (!description) {
    warnings.push({
      code: 'EMPTY_DESCRIPTION',
      message: 'La description est vide : « Resource pack » sera utilisée.',
    });
  }
  const packMeta = buildPackMcmeta(description, version);
  const packMetaText = serializePackMcmeta(packMeta);
  const validation = validatePackMcmeta(JSON.parse(packMetaText) as unknown, version);
  if (!validation.valid) {
    errors.push(...validation.errors.map((message) => `pack.mcmeta : ${message}`));
  }
  warnings.push(...validation.warnings.map((message) => ({ code: 'PACK_META_WARNING', message })));

  const baseName = safeName(config.outputName || config.name || snapshot.meta.pack.name, 'MonResourcePack');
  const format: 'folder' | 'zip' = config.format === 'folder' ? 'folder' : 'zip';
  const { outputPath, conflict, suggestedName } = await resolveOutputPath(outputDir, baseName, format);

  const files: PreparedFile[] = [];
  const modified = snapshot.changes
    .filter((change) => change.status === 'modified')
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
  const excluded = snapshot.changes.filter((change) => change.status === 'excluded');
  if (excluded.length > 0) {
    warnings.push({
      code: 'EXCLUDED_SKIPPED',
      message: `${excluded.length} modification(s) exclue(s) du pack ne seront pas exportées.`,
    });
  }
  const broken = snapshot.changes.filter((change) => change.status === 'error');
  if (broken.length > 0) {
    warnings.push({
      code: 'BROKEN_SKIPPED',
      message: `${broken.length} modification(s) en erreur ne peuvent pas être exportées : ${broken
        .map((change) => change.relPath)
        .join(', ')}`,
    });
  }
  if (modified.length === 0) {
    warnings.push({
      code: 'NO_CHANGES',
      message:
        'Aucune modification active : le pack ne contiendra que pack.mcmeta. Minecraft l’acceptera, mais il ne changera rien visuellement.',
    });
  }

  for (const change of modified) {
    let relPath: string;
    try {
      relPath = normalizeRelPath(change.relPath, { forWrite: true });
    } catch (error) {
      errors.push(describeError(error, `Chemin invalide pour ${change.relPath}`));
      continue;
    }
    const entry = snapshot.entries.find((candidate) => candidate.relPath === change.relPath);
    if (!entry) {
      errors.push(`Fichier absent de l’index : ${change.relPath}`);
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = await snapshot.readWorking(change.relPath);
    } catch (error) {
      errors.push(describeError(error, `Copie de travail illisible pour ${change.relPath}`));
      continue;
    }
    if (bytes.length === 0) {
      errors.push(`La copie de travail de ${change.relPath} est vide.`);
      continue;
    }
    const prepared: PreparedFile = { relPath, bytes };
    if (change.kind === 'image' || entry.image) {
      const info = imageInfo(bytes);
      if (!info || (info.format !== 'png' && entry.ext === 'png')) {
        errors.push(`La copie de travail de ${change.relPath} n’est pas un PNG valide.`);
        continue;
      }
      if (info) {
        prepared.width = info.width;
        prepared.height = info.height;
      }
    }
    if (change.error) {
      warnings.push({
        code: 'SOURCE_CHANGED',
        message: `${change.relPath} : ${change.error} La version de travail sera utilisée.`,
      });
    }
    files.push(prepared);
  }

  if (snapshot.meta.pack.icon && !snapshot.icon) {
    warnings.push({
      code: 'ICON_MISSING',
      message: 'L’icône configurée est introuvable sur le disque : le pack sera exporté sans pack.png.',
    });
  }
  let icon: PreparedExport['icon'];
  if (snapshot.icon) {
    const info = imageInfo(snapshot.icon.bytes);
    if (!info || info.format !== 'png') {
      errors.push('L’icône du pack n’est pas un PNG valide : elle ne sera pas incluse.');
    } else {
      icon = { bytes: snapshot.icon.bytes, width: info.width, height: info.height };
      if (info.width !== info.height) {
        warnings.push({
          code: 'ICON_NOT_SQUARE',
          message: `L’icône (${info.width} × ${info.height}) n’est pas carrée : Minecraft l’affichera déformée.`,
        });
      } else if (info.width > 512) {
        warnings.push({
          code: 'ICON_LARGE',
          message: 'L’icône dépasse 512 × 512 px : envisagez une taille plus petite.',
        });
      }
    }
  }

  if (!snapshot.sourceAvailable) {
    warnings.push({
      code: 'SOURCE_MISSING',
      message:
        'La source d’origine est introuvable. L’export utilise les copies de travail et reste possible, mais la vérification des originaux est limitée.',
    });
  }

  const estimatedBytes =
    files.reduce((sum, file) => sum + file.bytes.length, 0) +
    Buffer.byteLength(packMetaText) +
    (icon?.bytes.length ?? 0);

  return {
    config: {
      name: safeName(config.name || snapshot.meta.pack.name, 'MonResourcePack'),
      description: description || 'Resource pack',
      targetVersion: version.id,
      outputDir,
      outputName: baseName,
      format,
      overwrite: Boolean(config.overwrite),
    },
    version,
    outputPath,
    suggestedName,
    files,
    icon,
    packMetaText,
    warnings,
    errors,
    conflict,
    totalFiles: files.length + 1 + (icon ? 1 : 0),
    estimatedBytes,
  };
}

export function previewFromPrepared(prepared: PreparedExport): ExportPreview {
  return {
    name: prepared.config.name,
    targetVersion: prepared.config.targetVersion,
    versionLabel: prepared.version.label,
    format: prepared.config.format,
    outputPath: prepared.outputPath,
    files: prepared.files.map((file) => ({
      relPath: file.relPath,
      bytes: file.bytes.length,
      width: file.width,
      height: file.height,
    })),
    totalFiles: prepared.totalFiles,
    estimatedBytes: prepared.estimatedBytes,
    warnings: prepared.warnings,
    packMeta: prepared.packMetaText,
    icon: prepared.icon ? { width: prepared.icon.width, height: prepared.icon.height, bytes: prepared.icon.bytes.length } : undefined,
    conflict: prepared.conflict,
    suggestedName: prepared.suggestedName,
    blocked: prepared.errors.length > 0,
    errors: prepared.errors,
    modifiedCount: prepared.files.length,
    excludedCount: 0,
  };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.promises.access(target);
    return true;
  } catch {
    return false;
  }
}

async function assertSafeOverwriteTarget(prepared: PreparedExport): Promise<void> {
  const { outputPath, config } = prepared;
  if (!config.overwrite) throw outputConflictError(prepared);
  if (config.format === 'folder') {
    const entries = await fs.promises.readdir(outputPath);
    if (entries.length > 0) {
      const looksLikePack =
        entries.includes('pack.mcmeta') ||
        entries.every((entry) => ['assets', 'pack.mcmeta', 'pack.png'].includes(entry));
      if (!looksLikePack) {
        throw new UserError(
          `Le dossier « ${path.basename(outputPath)} » existe et ne ressemble pas à un resource pack exporté. Il n’a pas été supprimé par sécurité.`,
          'UNSAFE_OVERWRITE',
        );
      }
    }
  } else {
    const stat = await fs.promises.stat(outputPath);
    if (!stat.isFile()) {
      throw new UserError(`« ${outputPath} » n’est pas un fichier ZIP.`, 'UNSAFE_OVERWRITE');
    }
  }
}

async function verifyFolder(
  outputPath: string,
  expected: Set<string>,
  packMetaText: string,
): Promise<string[]> {
  const source = new DirectorySource(outputPath);
  const scan = await source.scan({ onProgress: () => undefined, isCancelled: () => false });
  const actual = new Set(scan.entries.map((entry) => entry.relPath));
  const messages: string[] = [];
  for (const name of expected) if (!actual.has(name)) messages.push(`Fichier manquant dans l’export : ${name}`);
  for (const name of actual) if (!expected.has(name)) messages.push(`Fichier inattendu dans l’export : ${name}`);
  try {
    const text = await fs.promises.readFile(path.join(outputPath, 'pack.mcmeta'), 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (JSON.stringify(parsed) !== JSON.stringify(JSON.parse(packMetaText))) {
      messages.push('Le pack.mcmeta écrit ne correspond pas au contenu généré.');
    }
  } catch (error) {
    messages.push(describeError(error, 'pack.mcmeta illisible après écriture'));
  }
  if (messages.length === 0) messages.push(`Structure vérifiée : ${actual.size} fichier(s), pack.mcmeta valide.`);
  return messages;
}

async function verifyZip(
  outputPath: string,
  expected: Set<string>,
  packMetaText: string,
): Promise<string[]> {
  const messages: string[] = [];
  let scan;
  const source = new ZipSource(outputPath);
  try {
    scan = await source.scan({ onProgress: () => undefined, isCancelled: () => false });
  } catch (error) {
    return [describeError(error, 'Archive ZIP illisible après écriture')];
  }
  const actual = new Set(scan.entries.map((entry) => entry.relPath));
  for (const name of expected) if (!actual.has(name)) messages.push(`Fichier manquant dans l’archive : ${name}`);
  for (const name of actual) if (!expected.has(name)) messages.push(`Fichier inattendu dans l’archive : ${name}`);
  try {
    const text = (await source.read('pack.mcmeta')).toString('utf8');
    const parsed = JSON.parse(text) as unknown;
    if (JSON.stringify(parsed) !== JSON.stringify(JSON.parse(packMetaText))) {
      messages.push('pack.mcmeta dans l’archive ne correspond pas au contenu généré.');
    }
  } catch (error) {
    messages.push(describeError(error, 'pack.mcmeta illisible dans l’archive'));
  }
  if (messages.length === 0) messages.push(`Archive vérifiée : ${actual.size} fichier(s), pack.mcmeta à la racine.`);
  return messages;
}

export async function executeExport(
  prepared: PreparedExport,
  ctx: ProgressContext,
  hooks: ExportFsHooks = {},
): Promise<ExportReport> {
  const started = Date.now();
  const writeFile = hooks.writeFile ?? ((file: string, data: Buffer | string) => fs.promises.writeFile(file, data));
  const unlink = hooks.unlink ?? ((file: string) => fs.promises.unlink(file));
  const expected = new Set<string>(['pack.mcmeta', ...prepared.files.map((file) => file.relPath)]);
  if (prepared.icon) expected.add('pack.png');

  if (prepared.errors.length > 0) {
    throw new UserError(
      `Export bloqué : ${prepared.errors.join(' ')}`,
      'EXPORT_BLOCKED',
    );
  }

  const exists = await pathExists(prepared.outputPath);
  if (exists) {
    await assertSafeOverwriteTarget(prepared);
  }

  await fs.promises.mkdir(prepared.config.outputDir, { recursive: true });
  const total = prepared.files.length + 2;
  let current = 0;

  const cleanup = async (target: string, isTemp: boolean): Promise<void> => {
    try {
      await fs.promises.rm(target, { recursive: true, force: true });
    } catch {
      // nettoyage best effort
    }
    void isTemp;
  };

  if (prepared.config.format === 'folder') {
    const target = prepared.outputPath;
    try {
      if (exists) await fs.promises.rm(target, { recursive: true, force: true });
      await fs.promises.mkdir(target, { recursive: true });
      ctx.onProgress(0, total, 'pack.mcmeta');
      await writeFile(path.join(target, 'pack.mcmeta'), prepared.packMetaText);
      current += 1;
      if (prepared.icon) {
        if (ctx.isCancelled()) throw new CancelledError();
        await writeFile(path.join(target, 'pack.png'), prepared.icon.bytes);
        current += 1;
      }
      for (const file of prepared.files) {
        if (ctx.isCancelled()) throw new CancelledError();
        const destination = path.join(target, ...file.relPath.split('/'));
        if (!isPathInside(target, destination)) {
          throw new UserError(`Chemin d’export hors du pack : ${file.relPath}`, 'EXPORT_PATH_ESCAPE');
        }
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, file.bytes);
        current += 1;
        ctx.onProgress(current, total, file.relPath);
      }
      const verification = await verifyFolder(target, expected, prepared.packMetaText);
      const failed = verification.some((message) => !message.startsWith('Structure vérifiée'));
      if (failed) {
        await cleanup(target, false);
        throw new UserError(`Vérification de l’export échouée : ${verification.join(' ')}`, 'EXPORT_VERIFICATION_FAILED');
      }
      ctx.onProgress(total, total, 'Export terminé');
      return {
        outputPath: target,
        format: 'folder',
        fileCount: expected.size,
        totalBytes: prepared.estimatedBytes,
        files: [...expected].sort(),
        warnings: prepared.warnings,
        packMeta: prepared.packMetaText,
        verified: true,
        verification,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      await cleanup(target, false);
      if (error instanceof UserError) throw error;
      throw new UserError(describeError(error, 'Échec de l’export du dossier'), 'EXPORT_FAILED');
    }
  }

  // Export ZIP : écriture dans un fichier temporaire puis renommage atomique.
  const target = prepared.outputPath;
  const temp = path.join(prepared.config.outputDir, `.${path.basename(target)}.tmp-${uniqueSuffix()}`);
  try {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from(prepared.packMetaText, 'utf8'), 'pack.mcmeta', { compress: true });
    if (prepared.icon) zip.addBuffer(prepared.icon.bytes, 'pack.png', { compress: true });
    for (const file of prepared.files) {
      if (ctx.isCancelled()) throw new CancelledError();
      zip.addBuffer(file.bytes, file.relPath, { compress: true });
      current += 1;
      ctx.onProgress(current, total, file.relPath);
    }
    const completion = new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(temp);
      output.on('close', resolve);
      output.on('error', reject);
      zip.outputStream.on('error', reject);
      zip.outputStream.pipe(output);
      zip.end();
    });
    await completion;
    if (ctx.isCancelled()) throw new CancelledError();
    if (exists) await fs.promises.rm(target, { force: true });
    await fs.promises.rename(temp, target);
    ctx.onProgress(total, total, 'Vérification de l’archive');
    const verification = await verifyZip(target, expected, prepared.packMetaText);
    const failed = verification.some((message) => !message.startsWith('Archive vérifiée'));
    if (failed) {
      await cleanup(target, false);
      throw new UserError(`Vérification de l’archive échouée : ${verification.join(' ')}`, 'EXPORT_VERIFICATION_FAILED');
    }
    const stat = await fs.promises.stat(target);
    return {
      outputPath: target,
      format: 'zip',
      fileCount: expected.size,
      totalBytes: stat.size,
      files: [...expected].sort(),
      warnings: prepared.warnings,
      packMeta: prepared.packMetaText,
      verified: true,
      verification,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    await fs.promises.rm(temp, { force: true }).catch(() => undefined);
    if (ctx.isCancelled()) {
      await fs.promises.rm(target, { force: true }).catch(() => undefined);
      throw new CancelledError();
    }
    if (error instanceof UserError) throw error;
    throw new UserError(describeError(error, 'Échec de l’écriture du fichier ZIP'), 'EXPORT_FAILED');
  }
}

function isCancelledError(error: unknown): boolean {
  return error instanceof UserError && error.code === 'CANCELLED';
}

export function expectedExportPaths(prepared: PreparedExport): string[] {
  return ['pack.mcmeta', ...(prepared.icon ? ['pack.png'] : []), ...prepared.files.map((file) => file.relPath)];
}

export function exportFileCount(prepared: PreparedExport): number {
  return expectedExportPaths(prepared).length;
}
