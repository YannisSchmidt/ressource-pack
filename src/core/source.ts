import fs from 'node:fs';
import path from 'node:path';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import type { FileEntry, ScanResult, ScanWarning, SourceCheck, SourceRef, SourceType } from '../shared/types';
import { describeError, UserError } from './errors';
import { makeEntry } from './files';
import { isPathInside, joinInside, normalizeRelPath } from './paths';

export interface ProgressContext {
  onProgress(current: number, total: number, detail?: string): void;
  isCancelled(): boolean;
}

export interface Source {
  readonly type: SourceType;
  readonly path: string;
  exists(): Promise<boolean>;
  summary(): Promise<{ mtimeMs: number; size: number }>;
  scan(ctx: ProgressContext): Promise<ScanResult>;
  /** Lit un fichier (ou son préfixe) sans jamais modifier la source. */
  read(relPath: string, maxBytes?: number): Promise<Buffer>;
}

const MAX_READ_BYTES = 512 * 1024 * 1024;
const STAT_CONCURRENCY = 32;

function throwIfCancelled(ctx: ProgressContext): void {
  if (ctx.isCancelled()) {
    throw new UserError('Opération annulée.', 'CANCELLED');
  }
}

function warn(warnings: ScanWarning[], code: string, message: string, relPath?: string): void {
  warnings.push({ code, message, relPath });
}

async function statFiles(
  root: string,
  dir: string,
  names: string[],
  entries: FileEntry[],
  warnings: ScanWarning[],
): Promise<void> {
  for (let offset = 0; offset < names.length; offset += STAT_CONCURRENCY) {
    const slice = names.slice(offset, offset + STAT_CONCURRENCY);
    await Promise.all(
      slice.map(async (name) => {
        const rel = dir ? `${dir}/${name}` : name;
        try {
          const stat = await fs.promises.stat(
            path.join(root, ...(dir ? dir.split('/') : []), name),
          );
          if (!stat.isFile()) {
            warn(warnings, 'UNSUPPORTED_ENTRY', 'Entrée spéciale ignorée (ni fichier ni dossier).', rel);
            return;
          }
          entries.push(makeEntry(rel, stat.size, stat.mtimeMs));
        } catch (error) {
          warn(warnings, 'STAT_FAILED', describeError(error, 'Fichier illisible'), rel);
        }
      }),
    );
  }
}

export class DirectorySource implements Source {
  readonly type = 'directory' as const;
  readonly path: string;

  constructor(sourcePath: string) {
    this.path = path.resolve(sourcePath);
  }

  async exists(): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(this.path);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  async summary(): Promise<{ mtimeMs: number; size: number }> {
    const stat = await fs.promises.stat(this.path);
    return { mtimeMs: stat.mtimeMs, size: 0 };
  }

  async scan(ctx: ProgressContext): Promise<ScanResult> {
    const started = Date.now();
    const entries: FileEntry[] = [];
    const warnings: ScanWarning[] = [];
    const root = this.path;
    const queue: string[] = [''];
    let processed = 0;
    let lastReport = 0;

    try {
      const rootStat = await fs.promises.stat(root);
      if (!rootStat.isDirectory()) {
        throw new UserError('Le chemin sélectionné n’est pas un dossier.', 'NOT_A_DIRECTORY');
      }
    } catch (error) {
      throw new UserError(describeError(error, 'Impossible d’ouvrir le dossier source'), 'SOURCE_UNAVAILABLE');
    }

    while (queue.length > 0) {
      throwIfCancelled(ctx);
      const dir = queue.shift() as string;
      const absolute = dir ? joinInside(root, dir) : root;
      let dirents: fs.Dirent[];
      try {
        dirents = await fs.promises.readdir(absolute, { withFileTypes: true });
      } catch (error) {
        warn(warnings, 'DIR_UNREADABLE', describeError(error, 'Dossier illisible'), dir || '.');
        continue;
      }

      const files: string[] = [];
      const dirs: string[] = [];
      for (const dirent of dirents) {
        if (dirent.isSymbolicLink()) {
          warn(
            warnings,
            'SYMLINK_SKIPPED',
            'Lien symbolique ignoré (protection contre les boucles et les sorties du dossier source).',
            dir ? `${dir}/${dirent.name}` : dirent.name,
          );
          continue;
        }
        if (dirent.isDirectory()) {
          elsePushDir(dirs, dirent.name);
        } else if (dirent.isFile()) {
          files.push(dirent.name);
        } else {
          warn(warnings, 'UNSUPPORTED_ENTRY', 'Entrée spéciale ignorée.', dir ? `${dir}/${dirent.name}` : dirent.name);
        }
      }

      for (const name of dirs) {
        const rel = dir ? `${dir}/${name}` : name;
        try {
          normalizeRelPath(rel);
          queue.push(rel);
        } catch {
          warn(warnings, 'INVALID_PATH', 'Dossier au nom invalide ignoré.', rel);
        }
      }

      await statFiles(root, dir, files, entries, warnings);
      processed += files.length + dirs.length;
      const now = Date.now();
      if (now - lastReport > 120) {
        ctx.onProgress(processed, 0, dir || '.');
        lastReport = now;
      }
    }

    entries.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
    const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    ctx.onProgress(entries.length, entries.length, 'Terminé');
    return {
      entries,
      warnings,
      totalBytes,
      durationMs: Date.now() - started,
      cancelled: false,
    };
  }

  async read(relPath: string, maxBytes?: number): Promise<Buffer> {
    const absolute = joinInside(this.path, relPath);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(absolute);
    } catch (error) {
      throw new UserError(describeError(error, `Impossible de lire « ${relPath} »`), 'READ_FAILED');
    }
    if (stat.isSymbolicLink()) {
      throw new UserError(`Le fichier « ${relPath} » est un lien symbolique et n’est pas lu.`, 'SYMLINK_READ');
    }
    if (!stat.isFile()) {
      throw new UserError(`« ${relPath} » n’est pas un fichier.`, 'NOT_A_FILE');
    }
    const limit = maxBytes ?? MAX_READ_BYTES;
    if (stat.size > MAX_READ_BYTES) {
      throw new UserError(`Le fichier « ${relPath} » est trop volumineux pour être édité.`, 'FILE_TOO_LARGE');
    }
    if (stat.size <= limit) {
      return fs.promises.readFile(absolute);
    }
    const handle = await fs.promises.open(absolute, 'r');
    try {
      const buffer = Buffer.alloc(limit);
      const { bytesRead } = await handle.read(buffer, 0, limit, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
}

function elsePushDir(target: string[], name: string): void {
  if (name && name !== '.' && name !== '..') target.push(name);
}

function openZip(zipPath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      { lazyEntries: true, autoClose: true, decodeStrings: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) {
          reject(new UserError(describeError(error, 'Archive ZIP illisible'), 'ZIP_OPEN_FAILED'));
          return;
        }
        resolve(zip);
      },
    );
  });
}

function entryDate(entry: Entry): number {
  try {
    return entry.getLastModDate().getTime();
  } catch {
    return 0;
  }
}

export class ZipSource implements Source {
  readonly type = 'zip' as const;
  readonly path: string;

  constructor(sourcePath: string) {
    this.path = path.resolve(sourcePath);
  }

  async exists(): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(this.path);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async summary(): Promise<{ mtimeMs: number; size: number }> {
    const stat = await fs.promises.stat(this.path);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  }

  async scan(ctx: ProgressContext): Promise<ScanResult> {
    const started = Date.now();
    const entries: FileEntry[] = [];
    const warnings: ScanWarning[] = [];
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    const zip = await openZip(this.path);

    return new Promise<ScanResult>((resolve, reject) => {
      let settled = false;
      let processed = 0;
      let lastReport = 0;

      const finish = (result: ScanResult): void => {
        if (settled) return;
        settled = true;
        try {
          zip.close();
        } catch {
          // déjà fermé
        }
        resolve(result);
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        try {
          zip.close();
        } catch {
          // ignore
        }
        const raw = error instanceof Error ? error.message : String(error);
        if (/invalid relative path|absolute path|invalid characters/i.test(raw)) {
          reject(
            new UserError(
              'Archive refusée : elle contient un chemin d’extraction dangereux (entrée absolue ou « .. »). Aucun fichier n’a été extrait.',
              'ZIP_UNSAFE_PATH',
            ),
          );
          return;
        }
        reject(new UserError(describeError(error, 'Lecture de l’archive impossible'), 'ZIP_SCAN_FAILED'));
      };

      zip.on('error', fail);
      zip.on('end', () => {
        if (ctx.isCancelled()) {
          finish({ entries: [], warnings, totalBytes: 0, durationMs: Date.now() - started, cancelled: true });
          return;
        }
        entries.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
        ctx.onProgress(entries.length, entries.length, 'Terminé');
        finish({
          entries,
          warnings,
          totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
          durationMs: Date.now() - started,
          cancelled: false,
          duplicates,
        });
      });

      zip.on('entry', (entry: Entry) => {
        if (ctx.isCancelled()) {
          finish({ entries: [], warnings, totalBytes: 0, durationMs: Date.now() - started, cancelled: true });
          return;
        }
        processed += 1;
        const rawName = entry.fileName;
        if (!rawName.endsWith('/')) {
          try {
            const rel = normalizeRelPath(rawName);
            if (seen.has(rel)) {
              duplicates.push(rel);
              warn(warnings, 'DUPLICATE_ENTRY', 'Entrée en double dans l’archive : la première est utilisée.', rel);
            } else {
              seen.set(rel, rawName);
              entries.push(makeEntry(rel, entry.uncompressedSize, entryDate(entry)));
            }
          } catch (error) {
            warn(
              warnings,
              'UNSAFE_ZIP_PATH',
              describeError(error, 'Entrée d’archive ignorée pour raison de sécurité'),
              rawName,
            );
          }
        }
        const now = Date.now();
        if (now - lastReport > 120) {
          ctx.onProgress(processed, 0, rawName);
          lastReport = now;
        }
        zip.readEntry();
      });

      zip.readEntry();
    });
  }

  async read(relPath: string, maxBytes?: number): Promise<Buffer> {
    const target = normalizeRelPath(relPath);
    const zip = await openZip(this.path);
    const limit = Math.min(maxBytes ?? MAX_READ_BYTES, MAX_READ_BYTES);

    return new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        try {
          zip.close();
        } catch {
          // ignore
        }
      };
      const succeed = (buffer: Buffer): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(buffer);
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new UserError(describeError(error, `Impossible de lire « ${relPath} » dans l’archive`), 'ZIP_READ_FAILED'));
      };

      zip.on('error', fail);
      zip.on('end', () => fail(new UserError(`« ${relPath} » est introuvable dans l’archive.`, 'ZIP_ENTRY_NOT_FOUND')));
      zip.on('entry', (entry: Entry) => {
        let matches = false;
        try {
          matches = !entry.fileName.endsWith('/') && normalizeRelPath(entry.fileName) === target;
        } catch {
          matches = false;
        }
        if (!matches) {
          zip.readEntry();
          return;
        }
        if (entry.uncompressedSize > MAX_READ_BYTES) {
          fail(new UserError(`Le fichier « ${relPath} » est trop volumineux pour être lu.`, 'FILE_TOO_LARGE'));
          return;
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            fail(error ?? new Error('Flux illisible'));
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          let done = false;
          const finalize = (): void => {
            if (done) return;
            done = true;
            succeed(Buffer.concat(chunks));
          };
          stream.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
            total += chunk.length;
            if (total >= limit) {
              stream.destroy();
              finalize();
            }
          });
          stream.on('end', finalize);
          stream.on('error', fail);
          stream.on('close', finalize);
        });
      });

      zip.readEntry();
    });
  }
}

export function createSourceFromRef(ref: SourceRef): Source {
  return ref.type === 'zip' ? new ZipSource(ref.path) : new DirectorySource(ref.path);
}

export async function openSource(sourcePath: string, type?: SourceType): Promise<Source> {
  if (!sourcePath || typeof sourcePath !== 'string') {
    throw new UserError('Aucune source sélectionnée.', 'NO_SOURCE');
  }
  const resolved = path.resolve(sourcePath);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(resolved);
  } catch (error) {
    throw new UserError(describeError(error, 'Source introuvable'), 'SOURCE_UNAVAILABLE');
  }
  const detected: SourceType = type ?? (stat.isDirectory() ? 'directory' : 'zip');
  if (detected === 'directory') {
    if (!stat.isDirectory()) throw new UserError('La source sélectionnée n’est pas un dossier.', 'NOT_A_DIRECTORY');
    return new DirectorySource(resolved);
  }
  if (!stat.isFile()) throw new UserError('La source sélectionnée n’est pas une archive.', 'NOT_A_FILE');
  if (!/\.(zip|jar)$/i.test(resolved)) {
    throw new UserError('Seules les archives ZIP (ou JAR) sont prises en charge.', 'UNSUPPORTED_ARCHIVE');
  }
  return new ZipSource(resolved);
}

export async function sourceToRef(source: Source, scan: ScanResult): Promise<SourceRef> {
  let summary = { mtimeMs: 0, size: 0 };
  try {
    summary = await source.summary();
  } catch {
    // tant pis pour l'empreinte indicative
  }
  return {
    type: source.type,
    path: source.path,
    importedAt: new Date().toISOString(),
    fileCount: scan.entries.length,
    totalBytes: scan.totalBytes,
    scannerVersion: 1,
    statMtimeMs: summary.mtimeMs,
    statSize: summary.size,
  } as SourceRef;
}

/**
 * Rescanne la source et compare avec l'index précédent.
 * Lecture seule : ne met à jour ni l'index ni les fichiers du projet.
 */
export async function verifySource(
  source: Source,
  previous: FileEntry[],
  ctx: ProgressContext,
): Promise<{ check: SourceCheck; entries: FileEntry[]; warnings: ScanWarning[] }> {
  if (!(await source.exists())) {
    return {
      check: {
        available: false,
        verified: false,
        message:
          source.type === 'zip'
            ? 'L’archive source est introuvable (déplacée, renommée ou supprimée).'
            : 'Le dossier source est introuvable (déplacé, renommé ou supprimé).',
      },
      entries: [],
      warnings: [],
    };
  }
  const scan = await source.scan(ctx);
  if (scan.cancelled) {
    return {
      check: { available: true, verified: false, message: 'Vérification annulée.' },
      entries: [],
      warnings: [],
    };
  }
  const previousMap = new Map(previous.map((entry) => [entry.relPath, entry]));
  const added: string[] = [];
  const removed: string[] = [];
  let changed = 0;
  for (const entry of scan.entries) {
    const old = previousMap.get(entry.relPath);
    if (!old) {
      added.push(entry.relPath);
    } else {
      if (old.size !== entry.size || Math.abs(old.mtimeMs - entry.mtimeMs) > 1) changed += 1;
      previousMap.delete(entry.relPath);
    }
  }
  for (const relPath of previousMap.keys()) removed.push(relPath);

  const parts: string[] = [];
  if (added.length) parts.push(`${added.length} fichier(s) ajouté(s)`);
  if (removed.length) parts.push(`${removed.length} fichier(s) retiré(s)`);
  if (changed) parts.push(`${changed} fichier(s) modifié(s)`);
  return {
    check: {
      available: true,
      verified: true,
      added: added.slice(0, 50),
      removed: removed.slice(0, 50),
      changed,
      message: parts.length
        ? `La source a changé : ${parts.join(', ')}.`
        : `Source vérifiée : ${scan.entries.length} fichiers, aucun changement détecté.`,
    },
    entries: scan.entries,
    warnings: scan.warnings,
  };
}

export function isSourcePathAllowed(sourcePath: string, allowedRoot?: string): boolean {
  if (!allowedRoot) return true;
  return isPathInside(allowedRoot, sourcePath);
}
