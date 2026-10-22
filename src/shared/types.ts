/**
 * Types partagés entre le noyau (Node/Electron), le serveur de démo et l'interface.
 * Aucun import Node ici : ce fichier doit rester utilisable dans le navigateur.
 */

export type SourceType = 'directory' | 'zip';

export interface SourceRef {
  type: SourceType;
  /** Chemin absolu de la source sur le disque (dossier ou archive ZIP). */
  path: string;
  importedAt: string;
  fileCount: number;
  totalBytes: number;
  scannerVersion: number;
  /** Empreinte indicative pour détecter un déplacement/renommage de la source. */
  statMtimeMs?: number;
  statSize?: number;
}

export type FileKind =
  | 'texture'
  | 'model'
  | 'lang'
  | 'sound'
  | 'shader'
  | 'meta'
  | 'text'
  | 'other';

/** Capacité d'édition réelle d'un fichier dans l'application. */
export type Editability = 'image' | 'text' | 'none';

export interface FileEntry {
  /** Chemin relatif normalisé (séparateurs « / », jamais absolu, jamais « .. »). */
  relPath: string;
  name: string;
  dir: string;
  ext: string;
  size: number;
  mtimeMs: number;
  kind: FileKind;
  /** Vrai si le fichier est une image (PNG éditable, autres formats listés en lecture seule). */
  image: boolean;
  editability: Editability;
  /** Dimensions connues pour les PNG (remplies paresseusement puis mises en cache). */
  width?: number;
  height?: number;
  animated?: boolean;
}

export interface TreeNode {
  path: string;
  name: string;
  /** Nombre de fichiers directs dans ce dossier. */
  files: number;
  /** Nombre total de fichiers dans ce sous-arbre. */
  totalFiles: number;
  children: TreeNode[];
}

export interface FileInfo {
  relPath: string;
  name: string;
  ext: string;
  size: number;
  mtimeMs: number;
  kind: FileKind;
  image: boolean;
  editability: Editability;
  width?: number;
  height?: number;
  animated?: boolean;
  /** Format réel détecté (permet de signaler un PNG renommé, etc.). */
  detectedFormat?: string;
  modified: boolean;
  excluded: boolean;
  change?: ChangeRecord;
  sourceMissing?: boolean;
}

export type ChangeStatus = 'modified' | 'excluded' | 'error';

export interface ChangeRecord {
  relPath: string;
  kind: 'image' | 'text';
  ext: string;
  originalSize: number;
  originalByteHash: string;
  /** Hachage des pixels RGBA décodés (images) : permet de détecter un retour exact à l'original. */
  originalPixelHash?: string;
  originalWidth?: number;
  originalHeight?: number;
  workSize: number;
  workByteHash: string;
  workPixelHash?: string;
  workWidth?: number;
  workHeight?: number;
  modifiedAt: string;
  status: ChangeStatus;
  exclusionReason?: string;
  error?: string;
}

export interface PackSettings {
  name: string;
  description: string;
  /** Identifiant de version de la table (ex. « 1.21.9 ») ou version personnalisée. */
  targetVersion: string;
  /** Utilisé lorsque targetVersion === 'custom'. */
  customFormat?: { major: number; minor: number };
  icon?: {
    fileName: string;
    width: number;
    height: number;
    bytes: number;
    sha256: string;
  };
  outputDir?: string;
  format: 'folder' | 'zip';
  /** Nom de sortie explicite (sans extension) ; sinon dérivé du nom du pack. */
  outputName?: string;
}

export interface ProjectMeta {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  source: SourceRef;
  pack: PackSettings;
  changes: Record<string, ChangeRecord>;
  ui?: {
    openTabs: string[];
    activeTab?: string;
  };
}

export interface ProjectStats {
  fileCount: number;
  totalBytes: number;
  folderCount: number;
  modifiedCount: number;
  excludedCount: number;
  errorCount: number;
  modifiedBytes: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  source: SourceRef;
  modifiedCount: number;
  pack: PackSettings;
}

export interface ProjectView extends ProjectSummary {
  changes: ChangeRecord[];
  stats: ProjectStats;
  tree: TreeNode;
  ui?: ProjectMeta['ui'];
  sourceAvailable: boolean;
  sourceCheck: SourceCheck;
}

export interface SourceCheck {
  available: boolean;
  message?: string;
  verified?: boolean;
  added?: string[];
  removed?: string[];
  changed?: number;
}

export interface ScanWarning {
  relPath?: string;
  code: string;
  message: string;
}

export interface ScanResult {
  entries: FileEntry[];
  warnings: ScanWarning[];
  totalBytes: number;
  durationMs: number;
  cancelled: boolean;
  duplicates?: string[];
}

export interface SearchQuery {
  text: string;
  ext?: string;
  kind?: FileKind | 'all';
  modifiedOnly?: boolean;
  limit?: number;
}

export interface SearchHit extends FileEntry {
  modified: boolean;
  excluded: boolean;
  width?: number;
  height?: number;
}

export interface SearchResult {
  query: string;
  total: number;
  hits: SearchHit[];
  truncated: boolean;
  durationMs: number;
}

export type TaskStatus = 'running' | 'done' | 'error' | 'cancelled';

export interface TaskState<T = unknown> {
  id: string;
  label: string;
  status: TaskStatus;
  current: number;
  total: number;
  detail?: string;
  error?: string;
  result?: T;
  startedAt: number;
  finishedAt?: number;
}

export interface ImagePayload {
  width: number;
  height: number;
  /** Pixels RGBA, encodés en base64. */
  data: string;
  meta: ImageMeta;
}

export interface ImageMeta {
  relPath: string;
  width: number;
  height: number;
  animated: boolean;
  modified: boolean;
  excluded: boolean;
  hasWorkingCopy: boolean;
  bytes: number;
  sourceWidth?: number;
  sourceHeight?: number;
  sourceBytes?: number;
}

export interface OpenImageResult {
  meta: ImageMeta;
  original: { width: number; height: number; data: string };
  working?: { width: number; height: number; data: string };
}

export interface OpenTextResult {
  relPath: string;
  text: string;
  originalText: string;
  bytes: number;
  modified: boolean;
  excluded: boolean;
  editable: boolean;
  message?: string;
}

export interface ExportConfig {
  name: string;
  description: string;
  targetVersion: string;
  customFormat?: { major: number; minor: number };
  format: 'folder' | 'zip';
  outputDir: string;
  outputName?: string;
  /** Confirmation explicite de remplacement d'une sortie existante. */
  overwrite?: boolean;
  includeUnmodified?: never;
}

export interface ExportWarning {
  code: string;
  message: string;
}

export interface ExportPreview {
  name: string;
  targetVersion: string;
  versionLabel: string;
  format: 'folder' | 'zip';
  outputPath: string;
  files: { relPath: string; bytes: number; width?: number; height?: number }[];
  totalFiles: number;
  estimatedBytes: number;
  warnings: ExportWarning[];
  packMeta: string;
  icon?: { width: number; height: number; bytes: number };
  conflict: boolean;
  suggestedName: string;
  blocked: boolean;
  errors: string[];
  modifiedCount: number;
  excludedCount: number;
}

export interface ExportReport {
  outputPath: string;
  format: 'folder' | 'zip';
  fileCount: number;
  totalBytes: number;
  files: string[];
  warnings: ExportWarning[];
  packMeta: string;
  verified: boolean;
  verification: string[];
  durationMs: number;
}

export interface AppSettings {
  autosave: boolean;
  showNonImages: boolean;
  thumbnailSize: 'small' | 'medium' | 'large';
  lastProjectId?: string;
  minecraftDirOverride?: string;
}

export interface AppInfo {
  version: string;
  platform: string;
  demo: boolean;
  nativeDialogs: boolean;
  canOpenPaths: boolean;
  userDataDir: string;
  minecraftResourcePacks?: string;
  demoSources?: { label: string; path: string; type: SourceType; description: string }[];
  projects: ProjectSummary[];
  settings: AppSettings;
}

export interface DialogResult {
  path?: string;
  cancelled?: boolean;
}

export interface FolderListing {
  relPath: string;
  parent: string | null;
  entries: FileEntry[];
  total: number;
}

export type RpcMethod =
  | 'app.info'
  | 'app.saveSettings'
  | 'app.chooseSource'
  | 'app.chooseOutputDir'
  | 'app.chooseIcon'
  | 'app.chooseImage'
  | 'app.openPath'
  | 'app.revealPath'
  | 'app.minecraftFolder'
  | 'project.list'
  | 'project.create'
  | 'project.open'
  | 'project.close'
  | 'project.delete'
  | 'project.rename'
  | 'project.verifySource'
  | 'project.rescan'
  | 'project.relocate'
  | 'project.savePack'
  | 'project.saveUi'
  | 'project.stats'
  | 'project.changes'
  | 'fs.list'
  | 'fs.info'
  | 'file.search'
  | 'image.open'
  | 'image.thumbnail'
  | 'image.save'
  | 'image.revert'
  | 'image.exclude'
  | 'image.include'
  | 'image.setIcon'
  | 'image.getIcon'
  | 'text.open'
  | 'text.save'
  | 'export.preview'
  | 'export.run'
  | 'task.get'
  | 'task.cancel';
