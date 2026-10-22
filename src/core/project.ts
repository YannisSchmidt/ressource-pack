import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ChangeRecord,
  FileEntry,
  FileInfo,
  FolderListing,
  OpenImageResult,
  OpenTextResult,
  PackSettings,
  ProjectMeta,
  ProjectStats,
  ProjectSummary,
  ProjectView,
  ScanResult,
  ScanWarning,
  SearchQuery,
  SearchResult,
  SourceCheck,
  SourceRef,
  SourceType,
  TreeNode,
} from '../shared/types';
import { DEFAULT_TARGET_VERSION, resolvePackVersion } from '../shared/packFormats';
import { describeError, UserError } from './errors';
import { editability, makeEntry } from './files';
import { sha256, sha256Pixels } from './hash';
import { encodePng, decodePng, imageInfo, isPng, makeThumbnail, type ThumbnailResult } from './png';
import { checkDimensions, type Pixmap } from './imageOps';
import { isSameOrInside, joinInside, sanitizeFileName, uniqueSuffix } from './paths';
import {
  createSourceFromRef,
  openSource,
  sourceToRef,
  verifySource,
  type ProgressContext,
  type Source,
} from './source';
import { buildTree, countFolders } from './tree';
import { searchEntries } from './search';

const TEXT_MAX_BYTES = 4 * 1024 * 1024;
const THUMB_CACHE_LIMIT = 900;
const DIMS_ENRICH_LIMIT = 180;

interface ProjectRuntime {
  meta: ProjectMeta;
  entries: FileEntry[];
  entryMap: Map<string, FileEntry>;
  dims: Map<string, { width: number; height: number; animated: boolean }>;
  tree?: TreeNode;
  warnings: ScanWarning[];
  source: Source;
  sourceAvailable: boolean;
  sourceCheck: SourceCheck;
  lock: Promise<unknown>;
}

interface IndexFile {
  schemaVersion: 1;
  scannerVersion: number;
  scannedAt: string;
  warnings: ScanWarning[];
  entries: FileEntry[];
}

export interface CreateProjectInput {
  sourcePath: string;
  sourceType?: SourceType;
  name?: string;
}

export interface ProjectManagerOptions {
  baseDir: string;
  defaultOutputDir?: string;
  defaultTargetVersion?: string;
  defaultFormat?: 'folder' | 'zip';
}

async function writeAtomic(file: string, data: string | Buffer): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${uniqueSuffix()}`;
  await fs.promises.writeFile(tmp, data);
  try {
    await fs.promises.rename(tmp, file);
  } catch (error) {
    await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readJson<T>(file: string): Promise<T> {
  const text = await fs.promises.readFile(file, 'utf8');
  return JSON.parse(text) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateMeta(value: unknown): ProjectMeta {
  if (!isRecord(value)) throw new UserError('Fichier de projet illisible.', 'INVALID_PROJECT');
  if (value.schemaVersion !== 1) {
    throw new UserError('Version de projet non prise en charge par cette application.', 'UNSUPPORTED_PROJECT');
  }
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || !isRecord(value.source)) {
    throw new UserError('Fichier de projet incomplet ou corrompu.', 'INVALID_PROJECT');
  }
  if (!isRecord(value.pack)) {
    throw new UserError('Configuration du pack manquante dans le projet.', 'INVALID_PROJECT');
  }
  return {
    schemaVersion: 1,
    id: value.id,
    name: value.name,
    createdAt: String(value.createdAt ?? new Date().toISOString()),
    updatedAt: String(value.updatedAt ?? new Date().toISOString()),
    source: value.source as unknown as SourceRef,
    pack: value.pack as unknown as PackSettings,
    changes: isRecord(value.changes) ? (value.changes as Record<string, ChangeRecord>) : {},
    ui: isRecord(value.ui) ? (value.ui as ProjectMeta['ui']) : undefined,
  };
}

export class ProjectManager {
  private readonly baseDir: string;
  private readonly projectsRoot: string;
  private readonly defaultOutputDir?: string;
  private readonly defaultTargetVersion: string;
  private readonly defaultFormat: 'folder' | 'zip';
  private readonly runtimes = new Map<string, ProjectRuntime>();
  private readonly thumbCache = new Map<string, ThumbnailResult>();

  constructor(options: ProjectManagerOptions) {
    this.baseDir = path.resolve(options.baseDir);
    this.projectsRoot = path.join(this.baseDir, 'projects');
    this.defaultOutputDir = options.defaultOutputDir;
    this.defaultTargetVersion = options.defaultTargetVersion ?? DEFAULT_TARGET_VERSION;
    this.defaultFormat = options.defaultFormat ?? 'zip';
  }

  get dataDir(): string {
    return this.baseDir;
  }

  get root(): string {
    return this.projectsRoot;
  }

  projectDir(id: string): string {
    if (!/^[A-Za-z0-9-]{6,80}$/.test(id)) {
      throw new UserError('Identifiant de projet invalide.', 'INVALID_PROJECT_ID');
    }
    return joinInside(this.projectsRoot, id);
  }

  private workRoot(id: string): string {
    return path.join(this.projectDir(id), 'work');
  }

  private iconPath(id: string): string {
    return path.join(this.projectDir(id), 'icon.png');
  }

  async list(): Promise<ProjectSummary[]> {
    await fs.promises.mkdir(this.projectsRoot, { recursive: true });
    const dirents = await fs.promises.readdir(this.projectsRoot, { withFileTypes: true });
    const summaries: ProjectSummary[] = [];
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue;
      const metaFile = path.join(this.projectsRoot, dirent.name, 'project.json');
      try {
        const meta = validateMeta(await readJson<unknown>(metaFile));
        const changes = Object.values(meta.changes);
        summaries.push({
          id: meta.id,
          name: meta.name,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          source: meta.source,
          modifiedCount: changes.filter((change) => change.status === 'modified').length,
          pack: meta.pack,
        });
      } catch {
        // Projet illisible : ignoré de la liste, jamais supprimé automatiquement.
      }
    }
    summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return summaries;
  }

  async create(input: CreateProjectInput, ctx: ProgressContext): Promise<ProjectView> {
    const source = await openSource(input.sourcePath, input.sourceType);
    if (isSameOrInside(this.baseDir, source.path)) {
      throw new UserError(
        'Le dossier de données de l’application ne peut pas être importé comme source (copies de travail incluses).',
        'INVALID_SOURCE',
      );
    }
    const scan = await source.scan(ctx);
    if (scan.cancelled) throw new UserError('Importation annulée.', 'CANCELLED');

    const id = crypto.randomUUID();
    const dir = this.projectDir(id);
    const workRoot = this.workRoot(id);
    await fs.promises.mkdir(workRoot, { recursive: true });
    try {
      const baseName = sanitizeFileName(
        input.name?.trim() ||
          path.basename(source.path, path.extname(source.path)) ||
          'MonResourcePack',
        'MonResourcePack',
      );
      const now = new Date().toISOString();
      const meta: ProjectMeta = {
        schemaVersion: 1,
        id,
        name: baseName,
        createdAt: now,
        updatedAt: now,
        source: await sourceToRef(source, scan),
        pack: {
          name: baseName,
          description: 'Textures personnalisées créées avec Atelier Resource Pack',
          targetVersion: this.defaultTargetVersion,
          format: this.defaultFormat,
          outputDir: this.defaultOutputDir,
        },
        changes: {},
        ui: { openTabs: [] },
      };
      await this.writeIndex(id, scan);
      await writeAtomic(path.join(dir, 'project.json'), JSON.stringify(meta, null, 2));
      const runtime = await this.buildRuntime(meta, scan.entries, scan.warnings, source);
      this.runtimes.set(id, runtime);
      return this.makeView(runtime);
    } catch (error) {
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async buildRuntime(
    meta: ProjectMeta,
    entries: FileEntry[],
    warnings: ScanWarning[],
    source?: Source,
  ): Promise<ProjectRuntime> {
    const resolvedSource = source ?? createSourceFromRef(meta.source);
    const entryMap = new Map(entries.map((entry) => [entry.relPath, entry]));
    const available = await resolvedSource.exists();
    const sourceCheck: SourceCheck = available
      ? { available: true, verified: false }
      : {
          available: false,
          verified: false,
          message:
            meta.source.type === 'zip'
              ? 'L’archive source est introuvable. Les modifications restent accessibles et exportables.'
              : 'Le dossier source est introuvable. Les modifications restent accessibles et exportables.',
        };
    if (available) {
      try {
        const summary = await resolvedSource.summary();
        if (
          typeof meta.source.statMtimeMs === 'number' &&
          Math.abs(summary.mtimeMs - meta.source.statMtimeMs) > 1
        ) {
          sourceCheck.message =
            'La source a peut-être changé depuis l’importation (date de modification différente). Lancez « Vérifier la source ».';
        }
      } catch {
        // indicateur uniquement
      }
    }
    await fs.promises.mkdir(this.workRoot(meta.id), { recursive: true });
    return {
      meta,
      entries,
      entryMap,
      dims: new Map(),
      warnings,
      source: resolvedSource,
      sourceAvailable: available,
      sourceCheck,
      lock: Promise.resolve(),
    };
  }

  private async writeIndex(id: string, scan: Pick<ScanResult, 'entries' | 'warnings'>): Promise<void> {
    const index: IndexFile = {
      schemaVersion: 1,
      scannerVersion: 1,
      scannedAt: new Date().toISOString(),
      warnings: scan.warnings,
      entries: scan.entries,
    };
    await writeAtomic(path.join(this.projectDir(id), 'index.json'), JSON.stringify(index));
  }

  private async loadIndex(id: string): Promise<IndexFile> {
    const file = path.join(this.projectDir(id), 'index.json');
    let raw: unknown;
    try {
      raw = await readJson<unknown>(file);
    } catch (error) {
      throw new UserError(
        `L’index du projet est introuvable ou illisible. ${describeError(error)}`,
        'INDEX_MISSING',
      );
    }
    if (!isRecord(raw) || !Array.isArray(raw.entries)) {
      throw new UserError('L’index du projet est corrompu.', 'INDEX_INVALID');
    }
    const entries: FileEntry[] = [];
    for (const value of raw.entries) {
      if (!isRecord(value) || typeof value.relPath !== 'string') continue;
      const base = makeEntry(
        value.relPath,
        typeof value.size === 'number' ? value.size : 0,
        typeof value.mtimeMs === 'number' ? value.mtimeMs : 0,
      );
      entries.push({
        ...base,
        width: typeof value.width === 'number' ? value.width : undefined,
        height: typeof value.height === 'number' ? value.height : undefined,
        animated: typeof value.animated === 'boolean' ? value.animated : undefined,
      });
    }
    return {
      schemaVersion: 1,
      scannerVersion: 1,
      scannedAt: String(raw.scannedAt ?? ''),
      warnings: Array.isArray(raw.warnings) ? (raw.warnings as ScanWarning[]) : [],
      entries,
    };
  }

  async open(id: string): Promise<ProjectView> {
    const existing = this.runtimes.get(id);
    if (existing) return this.makeView(existing);
    const dir = this.projectDir(id);
    let meta: ProjectMeta;
    try {
      meta = validateMeta(await readJson<unknown>(path.join(dir, 'project.json')));
    } catch (error) {
      throw new UserError(`Impossible d’ouvrir ce projet. ${describeError(error)}`, 'PROJECT_OPEN_FAILED');
    }
    const index = await this.loadIndex(id);
    const runtime = await this.buildRuntime(meta, index.entries, index.warnings);
    this.runtimes.set(id, runtime);
    return this.makeView(runtime);
  }

  async close(id: string): Promise<void> {
    this.runtimes.delete(id);
  }

  async delete(id: string): Promise<void> {
    const dir = this.projectDir(id);
    this.runtimes.delete(id);
    await fs.promises.rm(dir, { recursive: true, force: true });
  }

  private async runtime(id: string): Promise<ProjectRuntime> {
    const existing = this.runtimes.get(id);
    if (existing) return existing;
    await this.open(id);
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new UserError('Projet indisponible.', 'PROJECT_NOT_OPEN');
    return runtime;
  }

  private async exclusive<T>(id: string, task: (runtime: ProjectRuntime) => Promise<T>): Promise<T> {
    const runtime = await this.runtime(id);
    const previous = runtime.lock;
    let release: () => void = () => undefined;
    runtime.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => undefined);
    const actual = this.runtimes.get(id) ?? runtime;
    try {
      return await task(actual);
    } finally {
      release();
    }
  }

  async saveMeta(runtime: ProjectRuntime): Promise<void> {
    runtime.meta.updatedAt = new Date().toISOString();
    await writeAtomic(
      path.join(this.projectDir(runtime.meta.id), 'project.json'),
      JSON.stringify(runtime.meta, null, 2),
    );
  }

  async savePack(id: string, pack: PackSettings): Promise<PackSettings> {
    return this.exclusive(id, async (runtime) => {
      const resolved = resolvePackVersion(pack.targetVersion, pack.customFormat);
      const name = sanitizeFileName(pack.name?.trim() || runtime.meta.name, runtime.meta.name);
      const clean: PackSettings = {
        name,
        description: String(pack.description ?? '').replace(/\u0000/g, '').slice(0, 2000),
        targetVersion: resolved.version.id,
        customFormat: resolved.version.verified ? undefined : pack.customFormat,
        icon: runtime.meta.pack.icon,
        outputDir: pack.outputDir && path.isAbsolute(pack.outputDir) ? pack.outputDir : runtime.meta.pack.outputDir,
        format: pack.format === 'folder' ? 'folder' : 'zip',
        outputName: pack.outputName ? sanitizeFileName(pack.outputName) : undefined,
      };
      runtime.meta.pack = clean;
      await this.saveMeta(runtime);
      return clean;
    });
  }

  async saveUi(id: string, ui: ProjectMeta['ui']): Promise<void> {
    await this.exclusive(id, async (runtime) => {
      runtime.meta.ui = {
        openTabs: Array.isArray(ui?.openTabs) ? ui.openTabs.filter((rel) => runtime.entryMap.has(rel)).slice(0, 30) : [],
        activeTab: ui?.activeTab,
      };
      await this.saveMeta(runtime);
    });
  }

  async rename(id: string, name: string): Promise<ProjectMeta> {
    return this.exclusive(id, async (runtime) => {
      runtime.meta.name = sanitizeFileName(name, runtime.meta.name);
      await this.saveMeta(runtime);
      return runtime.meta;
    });
  }

  getStats(runtime: ProjectRuntime): ProjectStats {
    const changes = Object.values(runtime.meta.changes);
    return {
      fileCount: runtime.entries.length,
      totalBytes: runtime.entries.reduce((sum, entry) => sum + entry.size, 0),
      folderCount: runtime.tree ? countFolders(runtime.tree) : 0,
      modifiedCount: changes.filter((change) => change.status === 'modified').length,
      excludedCount: changes.filter((change) => change.status === 'excluded').length,
      errorCount: changes.filter((change) => change.status === 'error').length,
      modifiedBytes: changes.reduce((sum, change) => sum + (change.workSize ?? 0), 0),
    };
  }

  private getTree(runtime: ProjectRuntime): TreeNode {
    if (!runtime.tree) runtime.tree = buildTree(runtime.entries);
    return runtime.tree;
  }

  private async makeView(runtime: ProjectRuntime): Promise<ProjectView> {
    this.getTree(runtime);
    const stats = this.getStats(runtime);
    return {
      id: runtime.meta.id,
      name: runtime.meta.name,
      createdAt: runtime.meta.createdAt,
      updatedAt: runtime.meta.updatedAt,
      source: runtime.meta.source,
      modifiedCount: stats.modifiedCount,
      pack: runtime.meta.pack,
      changes: Object.values(runtime.meta.changes).sort((a, b) => a.relPath.localeCompare(b.relPath)),
      stats,
      tree: this.getTree(runtime),
      ui: runtime.meta.ui,
      sourceAvailable: runtime.sourceAvailable,
      sourceCheck: runtime.sourceCheck,
    };
  }

  async view(id: string): Promise<ProjectView> {
    const runtime = await this.runtime(id);
    this.getTree(runtime);
    return this.makeView(runtime);
  }

  async stats(id: string): Promise<ProjectStats> {
    const runtime = await this.runtime(id);
    this.getTree(runtime);
    return this.getStats(runtime);
  }

  async changesList(id: string): Promise<ChangeRecord[]> {
    const runtime = await this.runtime(id);
    return Object.values(runtime.meta.changes).sort((a, b) => a.relPath.localeCompare(b.relPath));
  }

  async getMeta(id: string): Promise<ProjectMeta> {
    const runtime = await this.runtime(id);
    return runtime.meta;
  }

  async getRuntimeEntries(id: string): Promise<FileEntry[]> {
    const runtime = await this.runtime(id);
    return runtime.entries;
  }

  async getChanges(id: string): Promise<Record<string, ChangeRecord>> {
    const runtime = await this.runtime(id);
    return runtime.meta.changes;
  }

  async getSource(id: string): Promise<Source> {
    return (await this.runtime(id)).source;
  }

  async readSourceFile(id: string, relPath: string): Promise<Buffer> {
    const runtime = await this.runtime(id);
    return runtime.source.read(relPath);
  }

  async readWorkingFile(id: string, relPath: string): Promise<Buffer | null> {
    const runtime = await this.runtime(id);
    const file = joinInside(this.workRoot(id), relPath);
    try {
      return await fs.promises.readFile(file);
    } catch {
      return null;
    }
  }

  async hasWorkingFile(id: string, relPath: string): Promise<boolean> {
    const runtime = await this.runtime(id);
    const file = joinInside(this.workRoot(id), relPath);
    try {
      const stat = await fs.promises.stat(file);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  private rememberDims(runtime: ProjectRuntime, entry: FileEntry, info: { width: number; height: number; animated: boolean }): void {
    runtime.dims.set(entry.relPath, info);
    entry.width = info.width;
    entry.height = info.height;
    entry.animated = info.animated;
  }

  private async enrichDims(runtime: ProjectRuntime, entries: FileEntry[], limit = DIMS_ENRICH_LIMIT): Promise<void> {
    const candidates = entries
      .filter((entry) => entry.editability === 'image' && !entry.animated && entry.size > 0 && entry.size < 8 * 1024 * 1024)
      .slice(0, limit);
    const batchSize = 8;
    for (let offset = 0; offset < candidates.length; offset += batchSize) {
      const batch = candidates.slice(offset, offset + batchSize);
      await Promise.all(
        batch.map(async (entry) => {
          const cached = runtime.dims.get(entry.relPath);
          if (cached) {
            this.rememberDims(runtime, entry, cached);
            return;
          }
          try {
            const bytes = await runtime.source.read(entry.relPath, 64 * 1024);
            const info = imageInfo(bytes);
            if (info && info.format === 'png') {
              this.rememberDims(runtime, entry, {
                width: info.width,
                height: info.height,
                animated: info.animated,
              });
            }
          } catch {
            // Dimensions inconnues : l'aperçu affichera un message.
          }
        }),
      );
    }
  }

  async listDir(id: string, relDir = '', withDims = true): Promise<FolderListing> {
    const runtime = await this.runtime(id);
    const normalized = relDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const entries = runtime.entries
      .filter((entry) => entry.dir === normalized)
      .map((entry) => {
        const cached = runtime.dims.get(entry.relPath);
        if (cached) this.rememberDims(runtime, entry, cached);
        return { ...entry };
      });
    if (withDims) await this.enrichDims(runtime, entries);
    const changes = runtime.meta.changes;
    for (const entry of entries) {
      const change = changes[entry.relPath];
      if (change) {
        entry.width = change.workWidth ?? entry.width;
        entry.height = change.workHeight ?? entry.height;
      }
    }
    const idx = normalized.lastIndexOf('/');
    const parent = normalized ? (idx === -1 ? '' : normalized.slice(0, idx)) : null;
    return { relPath: normalized, parent, entries, total: entries.length };
  }

  async info(id: string, relPath: string): Promise<FileInfo> {
    const runtime = await this.runtime(id);
    const entry = runtime.entryMap.get(relPath);
    if (!entry) throw new UserError(`Fichier inconnu dans le projet : ${relPath}`, 'FILE_NOT_FOUND');
    const change = runtime.meta.changes[relPath];
    const dims = runtime.dims.get(relPath);
    let sourceMissing = false;
    try {
      await runtime.source.read(relPath, 1);
    } catch {
      sourceMissing = true;
    }
    return {
      relPath: entry.relPath,
      name: entry.name,
      ext: entry.ext,
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      kind: entry.kind,
      image: entry.image,
      editability: entry.editability,
      width: change?.workWidth ?? dims?.width ?? entry.width,
      height: change?.workHeight ?? dims?.height ?? entry.height,
      animated: dims?.animated ?? entry.animated,
      modified: change?.status === 'modified',
      excluded: change?.status === 'excluded',
      change,
      sourceMissing,
    };
  }

  async search(id: string, query: SearchQuery): Promise<SearchResult> {
    const runtime = await this.runtime(id);
    const changes = new Map(Object.entries(runtime.meta.changes));
    const result = searchEntries(runtime.entries, query, changes);
    for (const hit of result.hits) {
      const dims = runtime.dims.get(hit.relPath);
      if (dims) {
        hit.width = dims.width;
        hit.height = dims.height;
      }
    }
    return result;
  }

  private async tryReadSource(runtime: ProjectRuntime, relPath: string): Promise<Buffer | null> {
    try {
      return await runtime.source.read(relPath);
    } catch {
      return null;
    }
  }

  async openImage(id: string, relPath: string): Promise<OpenImageResult> {
    const runtime = await this.runtime(id);
    const entry = runtime.entryMap.get(relPath);
    if (!entry) throw new UserError(`Texture introuvable : ${relPath}`, 'FILE_NOT_FOUND');
    if (editability(relPath) !== 'image') {
      throw new UserError('Ce fichier n’est pas une image PNG éditable.', 'NOT_EDITABLE');
    }
    const info = runtime.dims.get(relPath) ?? { width: entry.width ?? 0, height: entry.height ?? 0, animated: entry.animated ?? false };
    if (info.animated) {
      throw new UserError(
        'Cette texture est animée (APNG). L’éditeur ne modifie que les PNG statiques pour ne pas détruire l’animation.',
        'ANIMATED_PNG',
      );
    }
    const sourceBytes = await this.tryReadSource(runtime, relPath);
    if (!sourceBytes) {
      throw new UserError(
        'Le fichier source est introuvable : relocalisez la source pour pouvoir éditer cette texture.',
        'SOURCE_MISSING',
      );
    }
    if (!isPng(sourceBytes)) {
      throw new UserError('Seuls les fichiers PNG peuvent être édités.', 'NOT_PNG');
    }
    const sourceInfo = imageInfo(sourceBytes);
    if (sourceInfo?.animated) {
      throw new UserError(
        'Cette texture est animée (APNG). L’éditeur ne modifie que les PNG statiques pour ne pas détruire l’animation.',
        'ANIMATED_PNG',
      );
    }
    let original: Pixmap;
    try {
      original = decodePng(sourceBytes);
    } catch (error) {
      throw new UserError(describeError(error, 'PNG source illisible'), 'PNG_DECODE_FAILED');
    }
    this.rememberDims(runtime, entry, {
      width: original.width,
      height: original.height,
      animated: false,
    });
    const change = runtime.meta.changes[relPath];
    const workingBytes = change ? await this.readWorkingFile(id, relPath) : null;
    let working: Pixmap | undefined;
    if (workingBytes) {
      try {
        working = decodePng(workingBytes);
      } catch {
        working = undefined;
      }
    }
    return {
      meta: {
        relPath,
        width: working?.width ?? original.width,
        height: working?.height ?? original.height,
        animated: false,
        modified: change?.status === 'modified',
        excluded: change?.status === 'excluded',
        hasWorkingCopy: Boolean(working),
        bytes: workingBytes?.length ?? sourceBytes.length,
        sourceWidth: original.width,
        sourceHeight: original.height,
        sourceBytes: sourceBytes.length,
      },
      original: {
        width: original.width,
        height: original.height,
        data: Buffer.from(original.data).toString('base64'),
      },
      working: working
        ? {
            width: working.width,
            height: working.height,
            data: Buffer.from(working.data).toString('base64'),
          }
        : undefined,
    };
  }

  async thumbnail(id: string, relPath: string, size = 96): Promise<ThumbnailResult | null> {
    const runtime = await this.runtime(id);
    const entry = runtime.entryMap.get(relPath);
    if (!entry || !entry.image) return null;
    const change = runtime.meta.changes[relPath];
    const cacheKey = `${id}:${relPath}:${change ? `${change.workByteHash}:${change.workSize}` : `${entry.size}:${entry.mtimeMs}`}:${size}`;
    const cached = this.thumbCache.get(cacheKey);
    if (cached) return cached;
    let bytes: Buffer | null = null;
    if (change) bytes = await this.readWorkingFile(id, relPath);
    if (!bytes) bytes = await this.tryReadSource(runtime, relPath);
    if (!bytes) return null;
    const thumb = makeThumbnail(bytes, size);
    if (!thumb) return null;
    this.rememberDims(runtime, entry, {
      width: thumb.width,
      height: thumb.height,
      animated: entry.animated ?? false,
    });
    this.thumbCache.set(cacheKey, thumb);
    while (this.thumbCache.size > THUMB_CACHE_LIMIT) {
      const oldest = this.thumbCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.thumbCache.delete(oldest);
    }
    return thumb;
  }

  private invalidateThumbnail(id: string, relPath: string): void {
    for (const key of this.thumbCache.keys()) {
      if (key.startsWith(`${id}:${relPath}:`)) this.thumbCache.delete(key);
    }
  }

  /** Enregistre une image éditée comme copie de travail (la source n'est jamais touchée). */
  async saveImage(
    id: string,
    relPath: string,
    width: number,
    height: number,
    data: Buffer,
  ): Promise<{ change?: ChangeRecord; restored: boolean; modified: boolean }> {
    return this.exclusive(id, async (runtime) => {
      const entry = runtime.entryMap.get(relPath);
      if (!entry) throw new UserError(`Texture inconnue : ${relPath}`, 'FILE_NOT_FOUND');
      if (editability(relPath) !== 'image') {
        throw new UserError('Ce fichier n’est pas éditable comme image PNG.', 'NOT_EDITABLE');
      }
      checkDimensions(width, height);
      if (data.length !== width * height * 4) {
        throw new UserError('Les pixels reçus ne correspondent pas aux dimensions.', 'INVALID_PIXELS');
      }
      const image: Pixmap = { width, height, data: new Uint8Array(data) };
      const workBytes = encodePng(image);
      const workPixelHash = sha256Pixels(width, height, image.data);
      const workByteHash = sha256(workBytes);

      const sourceBytes = await this.tryReadSource(runtime, relPath);
      const existing = runtime.meta.changes[relPath];
      let originalWidth = existing?.originalWidth;
      let originalHeight = existing?.originalHeight;
      let originalPixelHash = existing?.originalPixelHash;
      let originalByteHash = existing?.originalByteHash;
      let originalSize = existing?.originalSize;
      let originalBytesLength: number;
      if (sourceBytes) {
        if (imageInfo(sourceBytes)?.animated) {
          throw new UserError(
            'Le PNG source est animé (APNG) : l’enregistrement statique détruirait l’animation et est refusé.',
            'ANIMATED_PNG',
          );
        }
        let original: Pixmap;
        try {
          original = decodePng(sourceBytes);
        } catch (error) {
          throw new UserError(describeError(error, 'Le PNG source est illisible'), 'SOURCE_UNREADABLE');
        }
        originalWidth = original.width;
        originalHeight = original.height;
        originalPixelHash = sha256Pixels(original.width, original.height, original.data);
        originalByteHash = sha256(sourceBytes);
        originalSize = sourceBytes.length;
        originalBytesLength = sourceBytes.length;
      } else {
        if (!existing || !originalPixelHash || !originalByteHash || originalSize === undefined) {
          throw new UserError(
            'Le fichier source est introuvable : impossible de vérifier l’original. Relocalisez la source.',
            'SOURCE_MISSING',
          );
        }
        originalBytesLength = originalSize;
      }

      const same =
        Boolean(originalPixelHash) &&
        workPixelHash === originalPixelHash &&
        width === originalWidth &&
        height === originalHeight;

      this.invalidateThumbnail(id, relPath);
      if (same) {
        await fs.promises.rm(joinInside(this.workRoot(id), relPath), { force: true }).catch(() => undefined);
        delete runtime.meta.changes[relPath];
        runtime.dims.set(relPath, { width, height, animated: false });
        await this.saveMeta(runtime);
        return { restored: true, modified: false };
      }

      await this.writeWorkFile(id, relPath, workBytes);
      const change: ChangeRecord = {
        relPath,
        kind: 'image',
        ext: entry.ext,
        originalSize: originalSize ?? originalBytesLength,
        originalByteHash: originalByteHash ?? '',
        originalPixelHash,
        originalWidth,
        originalHeight,
        workSize: workBytes.length,
        workByteHash,
        workPixelHash,
        workWidth: width,
        workHeight: height,
        modifiedAt: new Date().toISOString(),
        status: 'modified',
      };
      runtime.meta.changes[relPath] = change;
      runtime.dims.set(relPath, { width, height, animated: false });
      entry.width = width;
      entry.height = height;
      await this.saveMeta(runtime);
      return { change, restored: false, modified: true };
    });
  }

  private async writeWorkFile(id: string, relPath: string, bytes: Buffer): Promise<void> {
    const target = joinInside(this.workRoot(id), relPath);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await writeAtomic(target, bytes);
  }

  async revert(id: string, relPath: string): Promise<void> {
    await this.exclusive(id, async (runtime) => {
      const change = runtime.meta.changes[relPath];
      if (!change) throw new UserError('Ce fichier n’a pas de modification à annuler.', 'NO_CHANGE');
      try {
        await runtime.source.read(relPath, 1);
      } catch {
        throw new UserError(
          'La source est introuvable : restaurez d’abord le dossier source pour annuler cette modification sans perdre de données.',
          'SOURCE_MISSING',
        );
      }
      await fs.promises.rm(joinInside(this.workRoot(id), relPath), { force: true }).catch(() => undefined);
      delete runtime.meta.changes[relPath];
      this.invalidateThumbnail(id, relPath);
      const entry = runtime.entryMap.get(relPath);
      if (entry) {
        const info = runtime.dims.get(relPath);
        if (info && change.originalWidth) {
          runtime.dims.set(relPath, {
            width: change.originalWidth,
            height: change.originalHeight ?? info.height,
            animated: false,
          });
        }
        entry.width = change.originalWidth ?? entry.width;
        entry.height = change.originalHeight ?? entry.height;
      }
      await this.saveMeta(runtime);
    });
  }

  async exclude(id: string, relPath: string, reason?: string): Promise<void> {
    await this.exclusive(id, async (runtime) => {
      const change = runtime.meta.changes[relPath];
      if (!change) throw new UserError('Aucune modification à exclure pour ce fichier.', 'NO_CHANGE');
      change.status = 'excluded';
      change.exclusionReason = reason ?? 'Exclu manuellement du pack';
      await this.saveMeta(runtime);
    });
  }

  async include(id: string, relPath: string): Promise<void> {
    await this.exclusive(id, async (runtime) => {
      const change = runtime.meta.changes[relPath];
      if (!change) throw new UserError('Aucune modification à réintégrer pour ce fichier.', 'NO_CHANGE');
      if (!(await this.hasWorkingFile(id, relPath))) {
        change.status = 'error';
        change.error = 'La copie de travail est introuvable.';
      } else {
        change.status = 'modified';
        delete change.exclusionReason;
        delete change.error;
      }
      await this.saveMeta(runtime);
    });
  }

  async openText(id: string, relPath: string): Promise<OpenTextResult> {
    const runtime = await this.runtime(id);
    const entry = runtime.entryMap.get(relPath);
    if (!entry) throw new UserError(`Fichier introuvable : ${relPath}`, 'FILE_NOT_FOUND');
    const editable = editability(relPath) === 'text';
    const change = runtime.meta.changes[relPath];
    const workingBytes = change ? await this.readWorkingFile(id, relPath) : null;
    const sourceBytes = await this.tryReadSource(runtime, relPath);
    const bytes = sourceBytes ?? workingBytes;
    if (!bytes) {
      throw new UserError('Le fichier source est introuvable.', 'SOURCE_MISSING');
    }
    if (bytes.length > TEXT_MAX_BYTES) {
      return {
        relPath,
        text: '',
        originalText: '',
        bytes: bytes.length,
        modified: change?.status === 'modified',
        excluded: change?.status === 'excluded',
        editable: false,
        message: `Fichier trop volumineux pour l’éditeur de texte (${Math.round(bytes.length / 1024)} Ko, limite ${TEXT_MAX_BYTES / 1024} Ko).`,
      };
    }
    let text = '';
    let originalText = '';
    let message: string | undefined;
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      if (sourceBytes) originalText = decoder.decode(sourceBytes);
      else {
        originalText = workingBytes ? decoder.decode(workingBytes) : '';
        message = 'Le fichier source est introuvable : le contenu affiché provient de la copie de travail.';
      }
      text = workingBytes ? decoder.decode(workingBytes) : originalText;
    } catch {
      return {
        relPath,
        text: '',
        originalText: '',
        bytes: bytes.length,
        modified: change?.status === 'modified',
        excluded: change?.status === 'excluded',
        editable: false,
        message: 'Ce fichier n’est pas du texte UTF-8 : il ne peut pas être édité sans risquer de le corrompre.',
      };
    }
    return {
      relPath,
      text,
      originalText,
      bytes: bytes.length,
      modified: change?.status === 'modified',
      excluded: change?.status === 'excluded',
      editable: editable && !message?.includes('introuvable'),
      message,
    };
  }

  async saveText(
    id: string,
    relPath: string,
    text: string,
  ): Promise<{ restored: boolean; modified: boolean }> {
    return this.exclusive(id, async (runtime) => {
      const entry = runtime.entryMap.get(relPath);
      if (!entry) throw new UserError(`Fichier inconnu : ${relPath}`, 'FILE_NOT_FOUND');
      if (editability(relPath) !== 'text') {
        throw new UserError('Ce fichier n’est pas éditable comme texte.', 'NOT_EDITABLE');
      }
      const bytes = Buffer.from(text, 'utf8');
      if (bytes.length > TEXT_MAX_BYTES) {
        throw new UserError('Le texte dépasse la limite de 4 Mo de l’éditeur.', 'FILE_TOO_LARGE');
      }
      const sourceBytes = await this.tryReadSource(runtime, relPath);
      const existing = runtime.meta.changes[relPath];
      const originalHash = sourceBytes ? sha256(sourceBytes) : existing?.originalByteHash;
      const originalSize = sourceBytes ? sourceBytes.length : existing?.originalSize;
      if (!originalHash || originalSize === undefined) {
        throw new UserError('Impossible de vérifier l’original : source introuvable.', 'SOURCE_MISSING');
      }
      if (sha256(bytes) === originalHash) {
        await fs.promises.rm(joinInside(this.workRoot(id), relPath), { force: true }).catch(() => undefined);
        delete runtime.meta.changes[relPath];
        this.invalidateThumbnail(id, relPath);
        await this.saveMeta(runtime);
        return { restored: true, modified: false };
      }
      await this.writeWorkFile(id, relPath, bytes);
      runtime.meta.changes[relPath] = {
        relPath,
        kind: 'text',
        ext: entry.ext,
        originalSize,
        originalByteHash: originalHash,
        workSize: bytes.length,
        workByteHash: sha256(bytes),
        modifiedAt: new Date().toISOString(),
        status: 'modified',
      };
      await this.saveMeta(runtime);
      return { restored: false, modified: true };
    });
  }

  async setIcon(id: string, bytes: Buffer | null): Promise<PackSettings['icon'] | undefined> {
    return this.exclusive(id, async (runtime) => {
      if (bytes === null) {
        await fs.promises.rm(this.iconPath(id), { force: true }).catch(() => undefined);
        delete runtime.meta.pack.icon;
        await this.saveMeta(runtime);
        return undefined;
      }
      const info = imageInfo(bytes);
      if (!info || info.format !== 'png') {
        throw new UserError('L’icône doit être un fichier PNG valide.', 'INVALID_ICON');
      }
      checkDimensions(info.width, info.height);
      try {
        decodePng(bytes);
      } catch (error) {
        throw new UserError(describeError(error, 'Icône PNG illisible'), 'INVALID_ICON');
      }
      await fs.promises.mkdir(this.projectDir(id), { recursive: true });
      await writeAtomic(this.iconPath(id), bytes);
      const icon = {
        fileName: 'icon.png',
        width: info.width,
        height: info.height,
        bytes: bytes.length,
        sha256: sha256(bytes),
      };
      runtime.meta.pack.icon = icon;
      await this.saveMeta(runtime);
      return icon;
    });
  }

  async readIcon(id: string): Promise<{ bytes: Buffer; width: number; height: number } | null> {
    const runtime = await this.runtime(id);
    if (!runtime.meta.pack.icon) return null;
    try {
      const bytes = await fs.promises.readFile(this.iconPath(id));
      const info = imageInfo(bytes);
      if (!info) return null;
      return { bytes, width: info.width, height: info.height };
    } catch {
      return null;
    }
  }

  async verifySource(id: string, ctx: ProgressContext): Promise<SourceCheck> {
    const runtime = await this.runtime(id);
    const result = await verifySource(runtime.source, runtime.entries, ctx);
    runtime.sourceCheck = result.check;
    runtime.sourceAvailable = result.check.available;
    return result.check;
  }

  private async markBrokenChanges(runtime: ProjectRuntime): Promise<void> {
    for (const [relPath, change] of Object.entries(runtime.meta.changes)) {
      const exists = await this.hasWorkingFile(runtime.meta.id, relPath);
      if (!exists) {
        change.status = 'error';
        change.error = 'La copie de travail est introuvable sur le disque.';
        continue;
      }
      if (change.status === 'error') {
        change.status = 'modified';
        delete change.error;
      }
      if (change.status === 'modified' && change.originalByteHash) {
        try {
          const sourceBytes = await runtime.source.read(relPath);
          if (sha256(sourceBytes) !== change.originalByteHash) {
            change.error =
              'Le fichier source a changé depuis la modification. Le pack utilisera tout de même votre version de travail.';
          } else {
            delete change.error;
          }
        } catch {
          change.error = 'Le fichier source d’origine est introuvable.';
        }
      }
    }
  }

  async rescan(id: string, ctx: ProgressContext): Promise<{ view: ProjectView; warnings: ScanWarning[] }> {
    return this.exclusive(id, async (runtime) => {
      if (!(await runtime.source.exists())) {
        throw new UserError(
          'La source est introuvable : utilisez « Relocaliser la source » avant de rescanner.',
          'SOURCE_MISSING',
        );
      }
      const scan = await runtime.source.scan(ctx);
      if (scan.cancelled) throw new UserError('Rescan annulé.', 'CANCELLED');
      runtime.entries = scan.entries;
      runtime.entryMap = new Map(scan.entries.map((entry) => [entry.relPath, entry]));
      runtime.warnings = scan.warnings;
      runtime.tree = undefined;
      runtime.dims.clear();
      runtime.meta.source = await sourceToRef(runtime.source, scan);
      runtime.sourceAvailable = true;
      runtime.sourceCheck = { available: true, verified: true, message: 'Source rescannée.' };
      await this.markBrokenChanges(runtime);
      await this.writeIndex(id, scan);
      await this.saveMeta(runtime);
      return { view: await this.makeView(runtime), warnings: scan.warnings };
    });
  }

  async relocate(id: string, newPath: string, ctx: ProgressContext): Promise<ProjectView> {
    const source = await openSource(newPath);
    const scan = await source.scan(ctx);
    if (scan.cancelled) throw new UserError('Relocalisation annulée.', 'CANCELLED');
    return this.exclusive(id, async (runtime) => {
      runtime.source = source;
      runtime.entries = scan.entries;
      runtime.entryMap = new Map(scan.entries.map((entry) => [entry.relPath, entry]));
      runtime.warnings = scan.warnings;
      runtime.tree = undefined;
      runtime.dims.clear();
      runtime.meta.source = await sourceToRef(source, scan);
      runtime.sourceAvailable = true;
      runtime.sourceCheck = {
        available: true,
        verified: true,
        message: 'Source relocalisée et rescannée.',
      };
      await this.markBrokenChanges(runtime);
      await this.writeIndex(id, scan);
      await this.saveMeta(runtime);
      return this.makeView(runtime);
    });
  }

  async entry(id: string, relPath: string): Promise<FileEntry | undefined> {
    return (await this.runtime(id)).entryMap.get(relPath);
  }

  async buildExportSnapshot(id: string): Promise<{
    meta: ProjectMeta;
    changes: ChangeRecord[];
    entries: FileEntry[];
    readWorking: (relPath: string) => Promise<Buffer>;
    readSource: (relPath: string) => Promise<Buffer>;
    hasWorking: (relPath: string) => Promise<boolean>;
    icon: { bytes: Buffer; width: number; height: number } | null;
    sourceAvailable: boolean;
  }> {
    const runtime = await this.runtime(id);
    return {
      meta: runtime.meta,
      changes: Object.values(runtime.meta.changes),
      entries: runtime.entries,
      readWorking: async (relPath: string) => {
        const bytes = await this.readWorkingFile(id, relPath);
        if (!bytes) throw new UserError(`La copie de travail de « ${relPath} » est introuvable.`, 'WORK_MISSING');
        return bytes;
      },
      readSource: (relPath: string) => runtime.source.read(relPath),
      hasWorking: (relPath: string) => this.hasWorkingFile(id, relPath),
      icon: await this.readIcon(id),
      sourceAvailable: await runtime.source.exists(),
    };
  }

  async updateSourceAvailability(id: string): Promise<SourceCheck> {
    const runtime = await this.runtime(id);
    runtime.sourceAvailable = await runtime.source.exists();
    if (!runtime.sourceAvailable) {
      runtime.sourceCheck = {
        ...runtime.sourceCheck,
        available: false,
        message: 'La source est introuvable. Vos modifications restent exportables.',
      };
    }
    return runtime.sourceCheck;
  }

  async entryByPath(id: string, relPath: string): Promise<FileEntry> {
    const entry = await this.entry(id, relPath);
    if (!entry) throw new UserError(`Fichier inconnu : ${relPath}`, 'FILE_NOT_FOUND');
    return entry;
  }

}
