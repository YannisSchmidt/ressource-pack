import fs from 'node:fs';
import path from 'node:path';
import type {
  AppInfo,
  AppSettings,
  DialogResult,
  ExportConfig,
  ExportPreview,
  FileKind,
  ProjectView,
  SearchQuery,
  SourceType,
  TaskState,
} from '../shared/types';
import { describeError, UserError } from './errors';
import { executeExport, prepareExport, previewFromPrepared, type PreparedExport } from './export';
import { isSameOrInside, uniqueSuffix } from './paths';
import { ProjectManager, type CreateProjectInput } from './project';
import { TaskManager } from './tasks';

export interface ServiceHost {
  nativeDialogs: boolean;
  demo: boolean;
  canOpenPaths: boolean;
  minecraftResourcePacks?: string;
  demoSources?: AppInfo['demoSources'];
  pickSource(kind: 'directory' | 'zip'): Promise<DialogResult>;
  pickOutputDir(initial?: string): Promise<DialogResult>;
  pickFile(options: { title: string; extensions: string[] }): Promise<DialogResult>;
  openPath(target: string): Promise<string>;
  revealPath(target: string): Promise<void>;
}

export interface ServiceOptions {
  baseDir: string;
  host: ServiceHost;
  version?: string;
  demoRoot?: string;
  defaultOutputDir?: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  autosave: true,
  showNonImages: true,
  thumbnailSize: 'medium',
};

function asObject(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new UserError('Requête invalide.', 'INVALID_REQUEST');
  }
  return payload as Record<string, unknown>;
}

function reqString(obj: Record<string, unknown>, key: string, label = key): string {
  const value = obj[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new UserError(`Paramètre manquant : ${label}.`, 'INVALID_REQUEST');
  }
  return value;
}

function optString(obj: Record<string, unknown>, key: string): string | undefined {
  return typeof obj[key] === 'string' ? (obj[key] as string) : undefined;
}

function optBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  return typeof obj[key] === 'boolean' ? (obj[key] as boolean) : undefined;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.promises.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${uniqueSuffix()}`;
  await fs.promises.writeFile(temp, JSON.stringify(value, null, 2));
  await fs.promises.rename(temp, file);
}

export class Service {
  private readonly manager: ProjectManager;
  private readonly tasks = new TaskManager();
  private readonly baseDir: string;
  private readonly host: ServiceHost;
  private readonly version: string;
  private readonly demoRoot?: string;
  private readonly defaultOutputDir: string;
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  private initialized?: Promise<void>;

  constructor(options: ServiceOptions) {
    this.baseDir = path.resolve(options.baseDir);
    this.host = options.host;
    this.version = options.version ?? '1.0.0';
    this.demoRoot = options.demoRoot ? path.resolve(options.demoRoot) : undefined;
    this.defaultOutputDir = options.defaultOutputDir
      ? path.resolve(options.defaultOutputDir)
      : path.join(this.baseDir, 'exports');
    this.manager = new ProjectManager({
      baseDir: this.baseDir,
      defaultOutputDir: this.defaultOutputDir,
      defaultFormat: 'zip',
    });
  }

  get tasksManager(): TaskManager {
    return this.tasks;
  }

  async init(): Promise<void> {
    if (!this.initialized) {
      this.initialized = (async () => {
        await fs.promises.mkdir(this.baseDir, { recursive: true });
        await fs.promises.mkdir(this.defaultOutputDir, { recursive: true }).catch(() => undefined);
        const settingsFile = path.join(this.baseDir, 'settings.json');
        const loaded = await readJsonFile<Partial<AppSettings>>(settingsFile);
        if (loaded && typeof loaded === 'object') {
          this.settings = {
            ...DEFAULT_SETTINGS,
            ...(typeof loaded.autosave === 'boolean' ? { autosave: loaded.autosave } : {}),
            ...(typeof loaded.showNonImages === 'boolean' ? { showNonImages: loaded.showNonImages } : {}),
            ...(loaded.thumbnailSize === 'small' || loaded.thumbnailSize === 'medium' || loaded.thumbnailSize === 'large'
              ? { thumbnailSize: loaded.thumbnailSize }
              : {}),
            ...(typeof loaded.lastProjectId === 'string' ? { lastProjectId: loaded.lastProjectId } : {}),
            ...(typeof loaded.minecraftDirOverride === 'string'
              ? { minecraftDirOverride: loaded.minecraftDirOverride }
              : {}),
          };
        }
      })();
    }
    await this.initialized;
  }

  private get settingsFile(): string {
    return path.join(this.baseDir, 'settings.json');
  }

  private async saveSettings(): Promise<void> {
    await writeJsonAtomic(this.settingsFile, this.settings);
  }

  private assertAllowed(target: string, label: string): void {
    if (!target || !path.isAbsolute(target)) {
      throw new UserError(`${label} : un chemin absolu est requis.`, 'INVALID_PATH');
    }
    if (this.demoRoot && !isSameOrInside(this.demoRoot, target)) {
      throw new UserError(
        `${label} : l’aperçu web de démonstration est limité au dossier de démo. Utilisez l’application desktop pour accéder à tous vos fichiers.`,
        'DEMO_RESTRICTED',
      );
    }
  }

  async call(method: string, payload: unknown): Promise<unknown> {
    await this.init();
    switch (method) {
      case 'app.info':
        return this.appInfo();
      case 'app.saveSettings':
        return this.saveAppSettings(payload);
      case 'app.chooseSource':
        return this.host.pickSource((asObject(payload).kind as 'directory' | 'zip') ?? 'directory');
      case 'app.chooseOutputDir':
        return this.host.pickOutputDir(optString(asObject(payload), 'initial'));
      case 'app.chooseIcon':
        return this.host.pickFile({ title: 'Choisir l’icône du pack (PNG)', extensions: ['png'] });
      case 'app.chooseImage':
        return this.host.pickFile({ title: 'Choisir une image', extensions: ['png'] });
      case 'app.openPath': {
        const target = reqString(asObject(payload), 'path', 'chemin');
        this.assertAllowed(target, 'Ouverture');
        const result = await this.host.openPath(target);
        return { message: result };
      }
      case 'app.revealPath': {
        const target = reqString(asObject(payload), 'path', 'chemin');
        this.assertAllowed(target, 'Ouverture');
        await this.host.revealPath(target);
        return { ok: true };
      }
      case 'app.minecraftFolder':
        return { path: await this.minecraftFolder() };
      case 'project.list':
        return this.manager.list();
      case 'project.create':
        return this.createProject(payload);
      case 'project.open':
        return this.openProject(payload);
      case 'project.close': {
        await this.manager.close(reqString(asObject(payload), 'id'));
        return { ok: true };
      }
      case 'project.delete': {
        const id = reqString(asObject(payload), 'id');
        await this.manager.delete(id);
        if (this.settings.lastProjectId === id) {
          this.settings.lastProjectId = undefined;
          await this.saveSettings();
        }
        return { ok: true };
      }
      case 'project.rename': {
        const obj = asObject(payload);
        const meta = await this.manager.rename(reqString(obj, 'id'), reqString(obj, 'name'));
        return { name: meta.name };
      }
      case 'project.savePack': {
        const obj = asObject(payload);
        const pack = asObject(obj.pack);
        if (typeof pack.outputDir === 'string' && pack.outputDir) this.assertAllowed(pack.outputDir, 'Dossier de sortie');
        const saved = await this.manager.savePack(reqString(obj, 'id'), pack as never);
        return saved;
      }
      case 'project.saveUi': {
        const obj = asObject(payload);
        await this.manager.saveUi(reqString(obj, 'id'), obj.ui as never);
        return { ok: true };
      }
      case 'project.stats':
        return this.manager.stats(reqString(asObject(payload), 'id'));
      case 'project.changes':
        return this.manager.changesList(reqString(asObject(payload), 'id'));
      case 'project.verifySource':
        return this.verifySource(payload);
      case 'project.rescan':
        return this.rescan(payload);
      case 'project.relocate':
        return this.relocate(payload);
      case 'fs.list': {
        const obj = asObject(payload);
        const id = reqString(obj, 'id');
        const dir = optString(obj, 'dir') ?? '';
        return this.manager.listDir(id, dir, obj.withDims !== false);
      }
      case 'fs.info': {
        const obj = asObject(payload);
        return this.manager.info(reqString(obj, 'id'), reqString(obj, 'relPath'));
      }
      case 'file.search': {
        const obj = asObject(payload);
        const query = asObject(obj.query) as unknown as SearchQuery;
        const kind = query.kind as FileKind | 'all' | undefined;
        return this.manager.search(reqString(obj, 'id'), {
          text: typeof query.text === 'string' ? query.text : '',
          ext: typeof query.ext === 'string' ? query.ext : undefined,
          kind,
          modifiedOnly: Boolean(query.modifiedOnly),
          limit: typeof query.limit === 'number' ? query.limit : 300,
        });
      }
      case 'image.open': {
        const obj = asObject(payload);
        return this.manager.openImage(reqString(obj, 'id'), reqString(obj, 'relPath'));
      }
      case 'image.thumbnail': {
        const obj = asObject(payload);
        const size = typeof obj.size === 'number' ? Math.max(16, Math.min(256, obj.size)) : 96;
        return this.manager.thumbnail(reqString(obj, 'id'), reqString(obj, 'relPath'), size);
      }
      case 'image.save':
        return this.saveImage(payload);
      case 'image.revert': {
        const obj = asObject(payload);
        await this.manager.revert(reqString(obj, 'id'), reqString(obj, 'relPath'));
        return { ok: true, stats: await this.manager.stats(reqString(obj, 'id')) };
      }
      case 'image.exclude': {
        const obj = asObject(payload);
        await this.manager.exclude(reqString(obj, 'id'), reqString(obj, 'relPath'), optString(obj, 'reason'));
        return { ok: true, stats: await this.manager.stats(reqString(obj, 'id')) };
      }
      case 'image.include': {
        const obj = asObject(payload);
        await this.manager.include(reqString(obj, 'id'), reqString(obj, 'relPath'));
        return { ok: true, stats: await this.manager.stats(reqString(obj, 'id')) };
      }
      case 'image.setIcon':
        return this.setIcon(payload);
      case 'image.getIcon': {
        const icon = await this.manager.readIcon(reqString(asObject(payload), 'id'));
        return icon
          ? {
              dataUrl: `data:image/png;base64,${icon.bytes.toString('base64')}`,
              width: icon.width,
              height: icon.height,
            }
          : null;
      }
      case 'text.open': {
        const obj = asObject(payload);
        return this.manager.openText(reqString(obj, 'id'), reqString(obj, 'relPath'));
      }
      case 'text.save': {
        const obj = asObject(payload);
        const id = reqString(obj, 'id');
        const result = await this.manager.saveText(id, reqString(obj, 'relPath'), String(obj.text ?? ''));
        return { ...result, stats: await this.manager.stats(id) };
      }
      case 'export.preview':
        return this.previewExport(payload);
      case 'export.run':
        return this.runExport(payload);
      case 'task.get': {
        const id = reqString(asObject(payload), 'taskId');
        const task = this.tasks.get<TaskState>(id);
        if (!task) throw new UserError('Tâche inconnue ou expirée.', 'TASK_NOT_FOUND');
        return task;
      }
      case 'task.cancel': {
        const id = reqString(asObject(payload), 'taskId');
        return { cancelled: this.tasks.cancel(id) };
      }
      default:
        throw new UserError(`Méthode inconnue : ${method}`, 'UNKNOWN_METHOD');
    }
  }

  private async appInfo(): Promise<AppInfo> {
    const projects = await this.manager.list();
    return {
      version: this.version,
      platform: process.platform,
      demo: this.host.demo,
      nativeDialogs: this.host.nativeDialogs,
      canOpenPaths: this.host.canOpenPaths,
      userDataDir: this.baseDir,
      minecraftResourcePacks: await this.minecraftFolder(),
      demoSources: this.host.demoSources,
      projects,
      settings: this.settings,
    };
  }

  private async saveAppSettings(payload: unknown): Promise<AppSettings> {
    const obj = asObject(payload);
    if (typeof obj.autosave === 'boolean') this.settings.autosave = obj.autosave;
    if (typeof obj.showNonImages === 'boolean') this.settings.showNonImages = obj.showNonImages;
    if (obj.thumbnailSize === 'small' || obj.thumbnailSize === 'medium' || obj.thumbnailSize === 'large') {
      this.settings.thumbnailSize = obj.thumbnailSize;
    }
    if (typeof obj.minecraftDirOverride === 'string') {
      this.settings.minecraftDirOverride = obj.minecraftDirOverride || undefined;
    }
    await this.saveSettings();
    return this.settings;
  }

  private async minecraftFolder(): Promise<string | undefined> {
    if (this.settings.minecraftDirOverride) {
      if (await pathExists(this.settings.minecraftDirOverride)) return this.settings.minecraftDirOverride;
    }
    const candidate = this.host.minecraftResourcePacks;
    if (!candidate) return undefined;
    return (await pathExists(candidate)) ? candidate : undefined;
  }

  private async createProject(payload: unknown): Promise<{ taskId: string }> {
    const obj = asObject(payload);
    const input: CreateProjectInput = {
      sourcePath: reqString(obj, 'sourcePath', 'source'),
      sourceType: (obj.sourceType === 'zip' ? 'zip' : obj.sourceType === 'directory' ? 'directory' : undefined) as
        | SourceType
        | undefined,
      name: optString(obj, 'name'),
    };
    this.assertAllowed(input.sourcePath, 'Import');
    const taskId = this.tasks.run('Importation des ressources', async (ctx) => {
      const view = await this.manager.create(input, ctx);
      this.settings.lastProjectId = view.id;
      await this.saveSettings();
      return { projectId: view.id, view };
    });
    return { taskId };
  }

  private async openProject(payload: unknown): Promise<ProjectView> {
    const id = reqString(asObject(payload), 'id');
    const view = await this.manager.open(id);
    this.settings.lastProjectId = id;
    await this.saveSettings();
    return view;
  }

  private async verifySource(payload: unknown): Promise<{ taskId: string }> {
    const id = reqString(asObject(payload), 'id');
    const taskId = this.tasks.run('Vérification de la source', async (ctx) => {
      const check = await this.manager.verifySource(id, ctx);
      return check;
    });
    return { taskId };
  }

  private async rescan(payload: unknown): Promise<{ taskId: string }> {
    const id = reqString(asObject(payload), 'id');
    const taskId = this.tasks.run('Rescan de la source', async (ctx) => {
      const result = await this.manager.rescan(id, ctx);
      return result;
    });
    return { taskId };
  }

  private async relocate(payload: unknown): Promise<{ taskId: string }> {
    const obj = asObject(payload);
    const id = reqString(obj, 'id');
    const sourcePath = reqString(obj, 'sourcePath', 'nouvelle source');
    this.assertAllowed(sourcePath, 'Relocalisation');
    const taskId = this.tasks.run('Relocalisation de la source', async (ctx) => {
      const view = await this.manager.relocate(id, sourcePath, ctx);
      return { view };
    });
    return { taskId };
  }

  private async saveImage(payload: unknown): Promise<unknown> {
    const obj = asObject(payload);
    const id = reqString(obj, 'id');
    const relPath = reqString(obj, 'relPath');
    const width = Number(obj.width);
    const height = Number(obj.height);
    const data = obj.data;
    if (typeof data !== 'string' || data.length > 600 * 1024 * 1024) {
      throw new UserError('Données d’image manquantes ou trop volumineuses.', 'INVALID_IMAGE_DATA');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
      throw new UserError('Dimensions d’image invalides.', 'INVALID_DIMENSIONS');
    }
    const buffer = Buffer.from(data, 'base64');
    if (buffer.length !== width * height * 4) {
      throw new UserError('Les données de l’image sont incomplètes.', 'INVALID_IMAGE_DATA');
    }
    const result = await this.manager.saveImage(id, relPath, width, height, buffer);
    return { ...result, stats: await this.manager.stats(id), changes: await this.manager.changesList(id) };
  }

  private async setIcon(payload: unknown): Promise<unknown> {
    const obj = asObject(payload);
    const id = reqString(obj, 'id');
    if (obj.remove === true) {
      const icon = await this.manager.setIcon(id, null);
      return { icon };
    }
    const filePath = reqString(obj, 'path', 'icône');
    this.assertAllowed(filePath, 'Icône');
    let bytes: Buffer;
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) throw new UserError('L’icône doit être un fichier.', 'INVALID_ICON');
      if (stat.size > 8 * 1024 * 1024) throw new UserError('L’icône dépasse 8 Mo.', 'INVALID_ICON');
      bytes = await fs.promises.readFile(filePath);
    } catch (error) {
      if (error instanceof UserError) throw error;
      throw new UserError(describeError(error, 'Impossible de lire l’icône'), 'INVALID_ICON');
    }
    const icon = await this.manager.setIcon(id, bytes);
    return { icon, pack: (await this.manager.getMeta(id)).pack };
  }

  private async buildPrepared(payload: unknown): Promise<{ prepared: PreparedExport; preview: ExportPreview }> {
    const obj = asObject(payload);
    const id = reqString(obj, 'id');
    const config = asObject(obj.config) as unknown as ExportConfig;
    if (!config.outputDir || typeof config.outputDir !== 'string') {
      throw new UserError('Choisissez un dossier de sortie.', 'INVALID_OUTPUT');
    }
    this.assertAllowed(config.outputDir, 'Dossier de sortie');
    const snapshot = await this.manager.buildExportSnapshot(id);
    const prepared = await prepareExport(snapshot, config);
    const preview = previewFromPrepared(prepared);
    preview.excludedCount = snapshot.changes.filter((change) => change.status === 'excluded').length;
    return { prepared, preview };
  }

  private async previewExport(payload: unknown): Promise<ExportPreview> {
    const { preview } = await this.buildPrepared(payload);
    return preview;
  }

  private async runExport(payload: unknown): Promise<unknown> {
    const obj = asObject(payload);
    const id = reqString(obj, 'id');
    const config = asObject(obj.config) as unknown as ExportConfig;
    const packSaved = await this.manager.savePack(id, {
      name: config.name,
      description: config.description,
      targetVersion: config.targetVersion,
      customFormat: config.customFormat,
      format: config.format,
      outputDir: config.outputDir,
      outputName: config.outputName,
    });
    void packSaved;
    const { prepared, preview } = await this.buildPrepared(payload);
    if (prepared.errors.length > 0) {
      throw new UserError(`Export impossible : ${prepared.errors.join(' ')}`, 'EXPORT_BLOCKED');
    }
    if (prepared.conflict && !prepared.config.overwrite) {
      return {
        needsOverwrite: true,
        suggestedName: prepared.suggestedName,
        outputPath: prepared.outputPath,
        preview,
      };
    }
    const taskId = this.tasks.run('Export du resource pack', async (ctx) => {
      const report = await executeExport(prepared, ctx);
      return report;
    });
    return { taskId, preview };
  }
}
