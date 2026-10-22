import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type {
  AppInfo,
  AppSettings,
  ChangeRecord,
  ExportConfig,
  ExportPreview,
  ExportReport,
  FileEntry,
  FileInfo,
  FolderListing,
  ImageMeta,
  OpenImageResult,
  OpenTextResult,
  PackSettings,
  ProjectStats,
  ProjectView,
  SearchHit,
  SearchResult,
  SourceType,
  TaskState,
} from '../shared/types';
import { History } from '../core/history';
import {
  brightnessContrast,
  clonePixmap,
  cropImage,
  fillRect,
  flipImage,
  pasteRegion,
  pixmapsEqual,
  resizeCanvas,
  resizeImage,
  rotateImage,
  type FlipAxis,
  type Pixmap,
  type Rect,
  type ResizeMethod,
  type Rotation,
} from '../core/imageOps';
import { ApiError, errorMessage, rpc } from './bridge';
import { base64ToBytes, bytesToBase64, dirname } from './utils';

export type Tool = 'pencil' | 'eraser' | 'dropper' | 'fill' | 'select';
export type LeftTab = 'tree' | 'search' | 'modified';
export type RightTab = 'info' | 'tools';

export interface PixelSnapshot {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface ImageTab {
  kind: 'image';
  relPath: string;
  name: string;
  width: number;
  height: number;
  pixels: Uint8Array;
  originalWidth: number;
  originalHeight: number;
  originalPixels: Uint8Array;
  savedWidth: number;
  savedHeight: number;
  savedPixels: Uint8Array;
  history: History<PixelSnapshot>;
  revision: number;
  dirty: boolean;
  saving: boolean;
  meta: ImageMeta;
  tool: Tool;
  color: [number, number, number, number];
  brushSize: number;
  zoom: number;
  panX: number;
  panY: number;
  fit: boolean;
  selection?: Rect;
  clipboard?: PixelSnapshot;
}

export interface TextTab {
  kind: 'text';
  relPath: string;
  name: string;
  text: string;
  originalText: string;
  savedText: string;
  editable: boolean;
  message?: string;
  dirty: boolean;
  saving: boolean;
  bytes: number;
}

export type Tab = ImageTab | TextTab;

export interface Toast {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

export type ModalState =
  | { type: 'new-project' }
  | { type: 'projects' }
  | { type: 'settings' }
  | { type: 'help' }
  | { type: 'confirm'; title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void | Promise<void> }
  | { type: 'export' }
  | { type: 'delete-project'; id: string; name: string };

export interface AppState {
  booted: boolean;
  bootError?: string;
  info?: AppInfo;
  view?: ProjectView;
  listing: FileEntry[];
  listingDir: string;
  navHistory: string[];
  navIndex: number;
  expanded: Set<string>;
  selected?: FileEntry;
  selectedFolder?: string;
  selectedInfo?: FileInfo;
  tabs: Tab[];
  activeTab?: string;
  showingSearch: boolean;
  viewMode: 'grid' | 'list';
  sort: { key: 'name' | 'type' | 'size' | 'date'; dir: 1 | -1 };
  showNonImages: boolean;
  sidebarTab: LeftTab;
  searchQuery: string;
  searchExt: string;
  searchKind: string;
  searchModifiedOnly: boolean;
  searchResult?: SearchResult;
  searchLoading: boolean;
  tasks: Record<string, TaskState>;
  activeTaskId?: string;
  modal?: ModalState;
  toasts: Toast[];
  status: string;
  saveState: 'saved' | 'saving' | 'dirty';
  rightTab: RightTab;
  compare: boolean;
  compareSplit: number;
  thumbSize: number;
  thumbEpoch: number;
  exportPreview?: ExportPreview;
  exportReport?: ExportReport;
  exportError?: string;
  settings?: AppSettings;
  editorDialog?: 'resize' | 'canvas' | 'adjust';
  iconPreview?: string | null;
}

interface Preferences {
  viewMode?: 'grid' | 'list';
  sort?: { key: 'name' | 'type' | 'size' | 'date'; dir: 1 | -1 };
  sidebarTab?: LeftTab;
  rightTab?: RightTab;
}

const PREFS_KEY = 'atelier-resource-pack.prefs';

function loadPrefs(): Preferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Preferences) : {};
  } catch {
    return {};
  }
}

function savePrefs(state: AppState): void {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        viewMode: state.viewMode,
        sort: state.sort,
        sidebarTab: state.sidebarTab,
        rightTab: state.rightTab,
      } satisfies Preferences),
    );
  } catch {
    // stockage local indisponible : sans conséquence
  }
}

function initialThumbSize(settings?: AppSettings): number {
  return settings?.thumbnailSize === 'small' ? 56 : settings?.thumbnailSize === 'large' ? 120 : 80;
}

function snapshotOf(tab: ImageTab): PixelSnapshot {
  return { width: tab.width, height: tab.height, data: new Uint8Array(tab.pixels) };
}

function samePixels(a: Uint8Array, aw: number, ah: number, b: Uint8Array, bw: number, bh: number): boolean {
  if (aw !== bw || ah !== bh) return false;
  return pixmapsEqual({ width: aw, height: ah, data: a }, { width: bw, height: bh, data: b });
}

function imageTabFrom(view: OpenImageResult, tool: Tool = 'pencil'): ImageTab {
  const original = base64ToBytes(view.original.data);
  const working = view.working ? base64ToBytes(view.working.data) : new Uint8Array(original);
  const width = view.working?.width ?? view.original.width;
  const height = view.working?.height ?? view.original.height;
  return {
    kind: 'image',
    relPath: view.meta.relPath,
    name: view.meta.relPath.split('/').pop() ?? view.meta.relPath,
    width,
    height,
    pixels: new Uint8Array(working),
    originalWidth: view.original.width,
    originalHeight: view.original.height,
    originalPixels: original,
    savedWidth: width,
    savedHeight: height,
    savedPixels: new Uint8Array(working),
    history: new History<PixelSnapshot>({
      limit: 40,
      maxBytes: 96 * 1024 * 1024,
      measure: (snapshot) => snapshot.data.length + 64,
    }),
    revision: 0,
    dirty: false,
    saving: false,
    meta: view.meta,
    tool,
    color: [255, 255, 255, 255],
    brushSize: 1,
    zoom: 8,
    panX: 0,
    panY: 0,
    fit: true,
    selection: undefined,
    clipboard: undefined,
  };
}

function textTabFrom(view: OpenTextResult): TextTab {
  return {
    kind: 'text',
    relPath: view.relPath,
    name: view.relPath.split('/').pop() ?? view.relPath,
    text: view.text,
    originalText: view.originalText,
    savedText: view.text,
    editable: view.editable,
    message: view.message,
    dirty: false,
    saving: false,
    bytes: view.bytes,
  };
}

const prefs = loadPrefs();

const initialState: AppState = {
  booted: false,
  listing: [],
  listingDir: '',
  navHistory: [''],
  navIndex: 0,
  expanded: new Set(['']),
  tabs: [],
  showingSearch: false,
  viewMode: prefs.viewMode ?? 'grid',
  sort: prefs.sort ?? { key: 'name', dir: 1 },
  showNonImages: true,
  sidebarTab: prefs.sidebarTab ?? 'tree',
  searchQuery: '',
  searchExt: '',
  searchKind: 'all',
  searchModifiedOnly: false,
  searchLoading: false,
  tasks: {},
  toasts: [],
  status: 'Prêt',
  saveState: 'saved',
  rightTab: prefs.rightTab ?? 'info',
  compare: false,
  compareSplit: 50,
  thumbSize: 80,
  thumbEpoch: 0,
  settings: undefined,
};

export class AppStore {
  state: AppState = { ...initialState, expanded: new Set(['']) };
  private listeners = new Set<() => void>();
  private thumbCache = new Map<string, string | null>();
  private thumbPending = new Set<string>();
  private autosaveTimers = new Map<string, number>();
  private saveUiTimer?: number;
  private toastCounter = 0;
  private toastTimers = new Map<number, number>();
  private searchSequence = 0;
  private infoSequence = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AppState => this.state;

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  set(patch: Partial<AppState> | ((state: AppState) => Partial<AppState>)): void {
    const value = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...value };
    this.emit();
  }

  // ---------------------------------------------------------------- démarrage

  async bootstrap(): Promise<void> {
    try {
      const info = await rpc<AppInfo>('app.info');
      this.set({
        info,
        booted: true,
        settings: info.settings,
        showNonImages: info.settings.showNonImages,
        thumbSize: initialThumbSize(info.settings),
      });
      const last = info.settings.lastProjectId;
      if (last && info.projects.some((project) => project.id === last)) {
        try {
          await this.openProject(last);
        } catch (error) {
          this.toast(`Impossible de rouvrir le dernier projet : ${errorMessage(error)}`, 'error');
        }
      }
    } catch (error) {
      this.set({ booted: true, bootError: errorMessage(error) });
    }
  }

  async refreshInfo(): Promise<void> {
    try {
      const info = await rpc<AppInfo>('app.info');
      this.set({ info });
    } catch {
      // liste secondaire
    }
  }

  // ------------------------------------------------------------------ projets

  async openProject(id: string): Promise<boolean> {
    await this.saveAll(true);
    if (this.state.tabs.some((tab) => tab.dirty)) {
      this.toast(
        'Impossible de changer de projet : des modifications n’ont pas pu être enregistrées.',
        'error',
      );
      return false;
    }
    let view: ProjectView;
    try {
      view = await rpc<ProjectView>('project.open', { id });
    } catch (error) {
      this.toast(errorMessage(error), 'error');
      return false;
    }
    this.thumbCache.clear();
    this.set({
      view,
      listing: [],
      listingDir: '',
      navHistory: [''],
      navIndex: 0,
      expanded: new Set(['']),
      selected: undefined,
      selectedInfo: undefined,
      selectedFolder: undefined,
      tabs: [],
      activeTab: undefined,
      showingSearch: false,
      searchQuery: '',
      searchResult: undefined,
      exportPreview: undefined,
      exportReport: undefined,
      exportError: undefined,
      iconPreview: undefined,
      rightTab: 'info',
      status: `${view.stats.fileCount.toLocaleString('fr-FR')} fichiers indexés`,
      saveState: 'saved',
      showNonImages: this.state.settings?.showNonImages ?? true,
      thumbSize: initialThumbSize(this.state.settings),
    });
    await this.refreshListing();
    const openTabs = view.ui?.openTabs ?? [];
    for (const relPath of openTabs.slice(0, 12)) {
      try {
        const entry = await rpc<FileInfo>('fs.info', { id, relPath });
        if (entry.editability === 'image') await this.openImageTab(relPath, { silent: true });
        else if (entry.editability === 'text') await this.openTextTab(relPath, { silent: true });
      } catch {
        // fichier supprimé de la source depuis la dernière session
      }
    }
    const active = view.ui?.activeTab;
    if (active && this.state.tabs.some((tab) => tab.relPath === active)) {
      this.set({ activeTab: active });
    } else if (this.state.tabs.length > 0) {
      this.set({ activeTab: undefined });
    }
    await this.refreshInfo();
    return true;
  }

  async closeProject(): Promise<boolean> {
    await this.saveAll(true);
    if (this.state.tabs.some((tab) => tab.dirty)) {
      this.toast(
        'Impossible de fermer le projet : des modifications n’ont pas pu être enregistrées.',
        'error',
      );
      return false;
    }
    const id = this.state.view?.id;
    if (id) {
      try {
        await rpc('project.close', { id });
      } catch {
        // sans conséquence
      }
    }
    this.set({
      view: undefined,
      listing: [],
      listingDir: '',
      navHistory: [''],
      navIndex: 0,
      tabs: [],
      activeTab: undefined,
      selected: undefined,
      selectedInfo: undefined,
      selectedFolder: undefined,
      searchResult: undefined,
      searchQuery: '',
      showingSearch: false,
      status: 'Prêt',
    });
    this.thumbCache.clear();
    await this.refreshInfo();
    return true;
  }

  async createProject(sourcePath: string, sourceType: SourceType | undefined, name: string): Promise<void> {
    this.closeModal();
    try {
      const { taskId } = await rpc<{ taskId: string }>('project.create', { sourcePath, sourceType, name });
      this.set({ status: 'Importation en cours…' });
      this.trackTask(taskId, async (task) => {
        if (task.status !== 'done') return;
        const result = task.result as { projectId?: string } | undefined;
        if (!result?.projectId) return;
        try {
          await this.openProject(result.projectId);
          this.toast('Projet importé : vous pouvez explorer et modifier vos textures.', 'success');
        } catch (error) {
          this.toast(errorMessage(error), 'error');
        }
      });
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  async deleteProject(id: string): Promise<void> {
    try {
      const current = this.state.view?.id === id;
      await rpc('project.delete', { id });
      if (current) {
        for (const timer of this.autosaveTimers.values()) window.clearTimeout(timer);
        this.autosaveTimers.clear();
        this.thumbCache.clear();
        this.set({
          view: undefined,
          listing: [],
          listingDir: '',
          navHistory: [''],
          navIndex: 0,
          tabs: [],
          activeTab: undefined,
          selected: undefined,
          selectedInfo: undefined,
          selectedFolder: undefined,
          searchResult: undefined,
          searchQuery: '',
          showingSearch: false,
          status: 'Prêt',
          saveState: 'saved',
        });
      }
      await this.refreshInfo();
      this.toast('Projet supprimé (les fichiers sources sont intacts).', 'success');
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  async renameProject(name: string): Promise<void> {
    const view = this.state.view;
    if (!view || !name.trim()) return;
    try {
      const result = await rpc<{ name: string }>('project.rename', { id: view.id, name });
      this.set({ view: { ...view, name: result.name } });
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  // --------------------------------------------------------------- navigation

  async refreshListing(dir?: string): Promise<void> {
    const view = this.state.view;
    if (!view) return;
    const target = dir ?? this.state.listingDir;
    try {
      const listing = await rpc<FolderListing>('fs.list', { id: view.id, dir: target, withDims: true });
      const expanded = new Set(this.state.expanded);
      expanded.add('');
      let prefix = '';
      for (const segment of target.split('/').filter(Boolean)) {
        prefix = prefix ? `${prefix}/${segment}` : segment;
        expanded.add(prefix);
      }
      this.set({
        listing: listing.entries,
        listingDir: listing.relPath,
        expanded,
        selectedFolder: listing.relPath,
      });
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  showExplorer(): void {
    this.set({ activeTab: undefined, showingSearch: false });
  }

  async navigate(dir: string, options: { record?: boolean } = {}): Promise<void> {
    const record = options.record !== false;
    const patch: Partial<AppState> = {
      showingSearch: false,
      activeTab: undefined,
      selected: undefined,
      selectedInfo: undefined,
    };
    if (record) {
      const history = this.state.navHistory.slice(0, this.state.navIndex + 1);
      if (history[history.length - 1] !== dir) history.push(dir);
      patch.navHistory = history;
      patch.navIndex = history.length - 1;
    }
    this.set(patch);
    await this.refreshListing(dir);
  }

  goUp(): void {
    const current = this.state.listingDir;
    if (!current) return;
    void this.navigate(dirname(current));
  }

  goBack(): void {
    if (this.state.navIndex <= 0) return;
    const index = this.state.navIndex - 1;
    const target = this.state.navHistory[index] ?? '';
    this.set({ navIndex: index, showingSearch: false, activeTab: undefined, selected: undefined, selectedInfo: undefined });
    void this.refreshListing(target);
  }

  goForward(): void {
    if (this.state.navIndex >= this.state.navHistory.length - 1) return;
    const index = this.state.navIndex + 1;
    const target = this.state.navHistory[index] ?? '';
    this.set({ navIndex: index, showingSearch: false, activeTab: undefined, selected: undefined, selectedInfo: undefined });
    void this.refreshListing(target);
  }

  toggleFolder(path: string): void {
    const expanded = new Set(this.state.expanded);
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
    this.set({ expanded });
    if (expanded.has(path)) void this.refreshListing(path).catch(() => undefined);
  }

  async selectFile(entry: FileEntry): Promise<void> {
    this.set({ selected: entry, selectedFolder: undefined });
    const seq = ++this.infoSequence;
    try {
      const info = await rpc<FileInfo>('fs.info', { id: this.state.view?.id, relPath: entry.relPath });
      if (seq === this.infoSequence) this.set({ selectedInfo: info });
    } catch (error) {
      if (seq === this.infoSequence) this.set({ selectedInfo: undefined });
      this.toast(errorMessage(error), 'error');
    }
  }

  selectFolder(path: string): void {
    this.set({ selectedFolder: path, selected: undefined, selectedInfo: undefined });
  }

  async openByPath(relPath: string): Promise<void> {
    const view = this.state.view;
    if (!view) return;
    try {
      const info = await rpc<FileInfo>('fs.info', { id: view.id, relPath });
      if (this.state.listingDir !== info.relPath.slice(0, Math.max(0, info.relPath.lastIndexOf('/')))) {
        await this.navigate(dirname(relPath));
      }
      const entry: FileEntry = {
        relPath: info.relPath,
        name: info.name,
        dir: dirname(info.relPath),
        ext: info.ext,
        size: info.size,
        mtimeMs: info.mtimeMs,
        kind: info.kind,
        image: info.image,
        editability: info.editability,
        width: info.width,
        height: info.height,
        animated: info.animated,
      };
      await this.openEntry(entry);
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  async openEntry(entry: FileEntry): Promise<void> {
    await this.selectFile(entry);
    if (entry.editability === 'image') await this.openImageTab(entry.relPath);
    else if (entry.editability === 'text') await this.openTextTab(entry.relPath);
    else this.toast('Ce format n’est pas éditable. Il reste visible et exportable tel quel.', 'info');
  }

  async openImageTab(relPath: string, options: { silent?: boolean } = {}): Promise<void> {
    const existing = this.state.tabs.find((tab) => tab.relPath === relPath);
    if (existing) {
      this.set({ activeTab: relPath, showingSearch: false, rightTab: 'tools' });
      return;
    }
    const view = this.state.view;
    if (!view) return;
    try {
      const result = await rpc<OpenImageResult>('image.open', { id: view.id, relPath });
      const tab = imageTabFrom(result);
      this.set((state) => ({
        tabs: [...state.tabs, tab],
        activeTab: relPath,
        showingSearch: false,
        rightTab: 'tools',
        status: `${tab.width} × ${tab.height} px — ${relPath}`,
      }));
      this.persistTabs();
    } catch (error) {
      if (!options.silent) this.toast(errorMessage(error), 'error');
    }
  }

  async reloadTextTab(relPath: string): Promise<void> {
    const view = this.state.view;
    if (!view) return;
    try {
      const result = await rpc<OpenTextResult>('text.open', { id: view.id, relPath });
      const tab = textTabFrom(result);
      this.set((state) => ({
        tabs: state.tabs.map((candidate) => (candidate.relPath === relPath ? tab : candidate)),
        activeTab: relPath,
        showingSearch: false,
        status: relPath,
      }));
      this.toast('Contenu rechargé depuis le projet.', 'info');
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  async openTextTab(relPath: string, options: { silent?: boolean } = {}): Promise<void> {
    const existing = this.state.tabs.find((tab) => tab.relPath === relPath);
    if (existing) {
      this.set({ activeTab: relPath, showingSearch: false, rightTab: 'info' });
      return;
    }
    const view = this.state.view;
    if (!view) return;
    try {
      const result = await rpc<OpenTextResult>('text.open', { id: view.id, relPath });
      const tab = textTabFrom(result);
      this.set((state) => ({
        tabs: [...state.tabs, tab],
        activeTab: relPath,
        showingSearch: false,
        rightTab: 'info',
        status: relPath,
      }));
      this.persistTabs();
    } catch (error) {
      if (!options.silent) this.toast(errorMessage(error), 'error');
    }
  }

  activateTab(relPath: string): void {
    const tab = this.state.tabs.find((candidate) => candidate.relPath === relPath);
    this.set({
      activeTab: relPath,
      showingSearch: false,
      rightTab: tab?.kind === 'image' ? 'tools' : 'info',
    });
  }

  async closeTab(relPath: string): Promise<void> {
    const tab = this.state.tabs.find((candidate) => candidate.relPath === relPath);
    if (tab?.dirty) {
      await this.saveTab(relPath, { silent: true });
      const stillDirty = this.state.tabs.find((candidate) => candidate.relPath === relPath)?.dirty;
      if (stillDirty) {
        this.toast('Impossible de fermer : les modifications n’ont pas pu être enregistrées.', 'error');
        return;
      }
    }
    this.removeTab(relPath);
  }

  private removeTab(relPath: string): void {
    const tabs = this.state.tabs.filter((tab) => tab.relPath !== relPath);
    let activeTab = this.state.activeTab;
    if (activeTab === relPath) {
      const index = this.state.tabs.findIndex((tab) => tab.relPath === relPath);
      activeTab = tabs[Math.min(index, tabs.length - 1)]?.relPath;
    }
    this.set({ tabs, activeTab });
    this.persistTabs();
  }

  private persistTabs(): void {
    window.clearTimeout(this.saveUiTimer);
    this.saveUiTimer = window.setTimeout(() => {
      const view = this.state.view;
      if (!view) return;
      void rpc('project.saveUi', {
        id: view.id,
        ui: { openTabs: this.state.tabs.map((tab) => tab.relPath).slice(0, 30), activeTab: this.state.activeTab },
      }).catch(() => undefined);
    }, 600);
  }

  // ------------------------------------------------------------------ recherche

  setSearchQuery(value: string): void {
    this.set({
      searchQuery: value,
      sidebarTab: 'search',
      showingSearch: true,
      activeTab: undefined,
    });
  }

  setSearchExt(value: string): void {
    this.set({ searchExt: value, sidebarTab: 'search', showingSearch: true, activeTab: undefined });
  }

  setSearchKind(value: string): void {
    this.set({ searchKind: value, sidebarTab: 'search', showingSearch: true, activeTab: undefined });
  }

  setSearchModifiedOnly(value: boolean): void {
    this.set({ searchModifiedOnly: value, sidebarTab: 'search', showingSearch: true, activeTab: undefined });
  }

  setSidebarTab(tab: LeftTab): void {
    this.set({
      sidebarTab: tab,
      showingSearch: tab === 'search' && Boolean(this.state.searchQuery.trim()),
      activeTab: tab === 'search' ? undefined : this.state.activeTab,
    });
    savePrefs(this.state);
    if (tab === 'search') void this.runSearch();
  }

  async runSearch(): Promise<void> {
    const view = this.state.view;
    if (!view) return;
    const seq = ++this.searchSequence;
    const query = {
      text: this.state.searchQuery,
      ext: this.state.searchExt || undefined,
      kind: this.state.searchKind || 'all',
      modifiedOnly: this.state.searchModifiedOnly,
      limit: 400,
    };
    if (!query.text.trim() && !query.ext && !query.modifiedOnly && query.kind === 'all') {
      this.set({ searchResult: undefined, searchLoading: false });
      return;
    }
    this.set({ searchLoading: true });
    try {
      const result = await rpc<SearchResult>('file.search', { id: view.id, query });
      if (seq !== this.searchSequence) return;
      this.set({ searchResult: result, searchLoading: false });
    } catch (error) {
      if (seq !== this.searchSequence) return;
      this.set({ searchLoading: false });
      this.toast(errorMessage(error), 'error');
    }
  }

  async revealSearchHit(hit: SearchHit): Promise<void> {
    await this.navigate(hit.dir);
    const entry = this.state.listing.find((candidate) => candidate.relPath === hit.relPath);
    if (entry) await this.selectFile(entry);
  }

  async openSearchHit(hit: SearchHit): Promise<void> {
    await this.revealSearchHit(hit);
    await this.openEntry(hit);
  }

  // ---------------------------------------------------------------- préférences

  setViewMode(mode: 'grid' | 'list'): void {
    this.set({ viewMode: mode });
    savePrefs(this.state);
  }

  setSort(key: AppState['sort']['key']): void {
    const dir = this.state.sort.key === key ? ((this.state.sort.dir * -1) as 1 | -1) : 1;
    this.set({ sort: { key, dir } });
    savePrefs(this.state);
  }

  setShowNonImages(value: boolean): void {
    this.set({ showNonImages: value });
    void this.saveOptions({ showNonImages: value });
  }

  setRightTab(tab: RightTab): void {
    this.set({ rightTab: tab });
    savePrefs(this.state);
  }

  setCompare(value: boolean): void {
    this.set({ compare: value });
  }

  setCompareSplit(value: number): void {
    this.set({ compareSplit: Math.max(0, Math.min(100, value)) });
  }

  openEditorDialog(dialog: 'resize' | 'canvas' | 'adjust'): void {
    this.set({ editorDialog: dialog });
  }

  closeEditorDialog(): void {
    this.set({ editorDialog: undefined });
  }

  // ------------------------------------------------------------------- éditeur

  private imageTab(relPath: string): ImageTab | undefined {
    const tab = this.state.tabs.find((candidate) => candidate.relPath === relPath);
    return tab && tab.kind === 'image' ? tab : undefined;
  }

  private textTab(relPath: string): TextTab | undefined {
    const tab = this.state.tabs.find((candidate) => candidate.relPath === relPath);
    return tab && tab.kind === 'text' ? tab : undefined;
  }

  setTool(relPath: string, tool: Tool): void {
    const tab = this.imageTab(relPath);
    if (tab) {
      tab.tool = tool;
      this.set({ thumbEpoch: this.state.thumbEpoch });
    }
  }

  setColor(relPath: string, color: [number, number, number, number]): void {
    const tab = this.imageTab(relPath);
    if (tab) {
      tab.color = color;
      this.set({ thumbEpoch: this.state.thumbEpoch });
    }
  }

  setBrushSize(relPath: string, size: number): void {
    const tab = this.imageTab(relPath);
    if (tab) {
      tab.brushSize = Math.max(1, Math.min(32, Math.round(size)));
      this.set({ thumbEpoch: this.state.thumbEpoch });
    }
  }

  setZoom(relPath: string, zoom: number, pan?: { x: number; y: number }): void {
    const tab = this.imageTab(relPath);
    if (!tab) return;
    tab.zoom = Math.max(0.25, Math.min(64, zoom));
    tab.fit = false;
    if (pan) {
      tab.panX = pan.x;
      tab.panY = pan.y;
    }
    this.set({ thumbEpoch: this.state.thumbEpoch });
  }

  setPan(relPath: string, x: number, y: number): void {
    const tab = this.imageTab(relPath);
    if (!tab) return;
    tab.panX = x;
    tab.panY = y;
    tab.fit = false;
    this.set({ thumbEpoch: this.state.thumbEpoch });
  }

  setFit(relPath: string): void {
    const tab = this.imageTab(relPath);
    if (!tab) return;
    tab.fit = true;
    tab.panX = 0;
    tab.panY = 0;
    this.set({ thumbEpoch: this.state.thumbEpoch });
  }

  setSelection(relPath: string, selection?: Rect): void {
    const tab = this.imageTab(relPath);
    if (!tab) return;
    tab.selection = selection;
    this.set({ thumbEpoch: this.state.thumbEpoch });
  }

  beginEdit(relPath: string, label: string): void {
    const tab = this.imageTab(relPath);
    if (!tab) return;
    tab.history.push(snapshotOf(tab), label);
    this.set({ saveState: 'dirty', status: label });
  }

  endEdit(relPath: string): void {
    const tab = this.imageTab(relPath);
    if (!tab) return;
    tab.revision += 1;
    tab.dirty = !samePixels(
      tab.pixels,
      tab.width,
      tab.height,
      tab.savedPixels,
      tab.savedWidth,
      tab.savedHeight,
    );
    this.set((state) => ({
      saveState: tab.dirty ? 'dirty' : state.saveState,
      thumbEpoch: state.thumbEpoch + 1,
      status: tab.dirty ? 'Modifications non enregistrées (Ctrl+S)' : 'Prêt',
    }));
    if (tab.dirty) this.scheduleAutosave(relPath);
  }

  applyImage(relPath: string, image: Pixmap, label: string): void {
    const tab = this.imageTab(relPath);
    if (!tab) return;
    tab.history.push(snapshotOf(tab), label);
    tab.width = image.width;
    tab.height = image.height;
    tab.pixels = new Uint8Array(image.data);
    tab.selection = undefined;
    tab.revision += 1;
    tab.dirty = !samePixels(
      tab.pixels,
      tab.width,
      tab.height,
      tab.savedPixels,
      tab.savedWidth,
      tab.savedHeight,
    );
    this.set((state) => ({
      saveState: 'dirty',
      thumbEpoch: state.thumbEpoch + 1,
      status: label,
    }));
    this.scheduleAutosave(relPath);
  }

  undo(relPath: string): void {
    const tab = this.imageTab(relPath);
    if (!tab) return;
    const entry = tab.history.undo(snapshotOf(tab));
    if (!entry) return;
    tab.width = entry.state.width;
    tab.height = entry.state.height;
    tab.pixels = new Uint8Array(entry.state.data);
    tab.revision += 1;
    tab.dirty = !samePixels(
      tab.pixels,
      tab.width,
      tab.height,
      tab.savedPixels,
      tab.savedWidth,
      tab.savedHeight,
    );
    this.set((state) => ({ saveState: tab.dirty ? 'dirty' : 'saved', thumbEpoch: state.thumbEpoch + 1 }));
    if (tab.dirty) this.scheduleAutosave(relPath);
  }

  redo(relPath: string): void {
    const tab = this.imageTab(relPath);
    if (!tab) return;
    const entry = tab.history.redo(snapshotOf(tab));
    if (!entry) return;
    tab.width = entry.state.width;
    tab.height = entry.state.height;
    tab.pixels = new Uint8Array(entry.state.data);
    tab.revision += 1;
    tab.dirty = !samePixels(
      tab.pixels,
      tab.width,
      tab.height,
      tab.savedPixels,
      tab.savedWidth,
      tab.savedHeight,
    );
    this.set((state) => ({ saveState: tab.dirty ? 'dirty' : 'saved', thumbEpoch: state.thumbEpoch + 1 }));
    if (tab.dirty) this.scheduleAutosave(relPath);
  }

  copySelection(relPath: string): void {
    const tab = this.imageTab(relPath);
    if (!tab?.selection) return;
    const region = cropImage(
      { width: tab.width, height: tab.height, data: tab.pixels },
      tab.selection,
    );
    tab.clipboard = { width: region.width, height: region.height, data: new Uint8Array(region.data) };
    this.toast(`Sélection copiée (${region.width} × ${region.height}).`, 'success');
  }

  cutSelection(relPath: string): void {
    const tab = this.imageTab(relPath);
    if (!tab?.selection) return;
    this.copySelection(relPath);
    const image = clonePixmap({ width: tab.width, height: tab.height, data: tab.pixels });
    fillRect(image, tab.selection, [0, 0, 0, 0]);
    this.applyImage(relPath, image, 'Couper la sélection');
  }

  pasteSelection(relPath: string): void {
    const tab = this.imageTab(relPath);
    if (!tab?.clipboard) return;
    const image = clonePixmap({ width: tab.width, height: tab.height, data: tab.pixels });
    const x = tab.selection?.x ?? 0;
    const y = tab.selection?.y ?? 0;
    pasteRegion(
      image,
      { width: tab.clipboard.width, height: tab.clipboard.height, data: tab.clipboard.data },
      x,
      y,
    );
    this.applyImage(relPath, image, 'Coller');
  }

  deleteSelection(relPath: string): void {
    const tab = this.imageTab(relPath);
    if (!tab?.selection) return;
    const image = clonePixmap({ width: tab.width, height: tab.height, data: tab.pixels });
    fillRect(image, tab.selection, [0, 0, 0, 0]);
    this.applyImage(relPath, image, 'Effacer la sélection');
  }

  cropSelection(relPath: string): void {
    const tab = this.imageTab(relPath);
    if (!tab?.selection) return;
    const image = cropImage({ width: tab.width, height: tab.height, data: tab.pixels }, tab.selection);
    tab.selection = undefined;
    this.applyImage(relPath, image, 'Recadrage');
  }

  rotate(relPath: string, rotation: Rotation): void {
    const tab = this.imageTab(relPath);
    if (!tab) return;
    const image = rotateImage({ width: tab.width, height: tab.height, data: tab.pixels }, rotation);
    this.applyImage(relPath, image, `Rotation ${rotation}°`);
  }

  flip(relPath: string, axis: FlipAxis): void {
    const tab = this.imageTab(relPath);
    if (!tab) return;
    const image = flipImage({ width: tab.width, height: tab.height, data: tab.pixels }, axis);
    this.applyImage(relPath, image, axis === 'horizontal' ? 'Miroir horizontal' : 'Miroir vertical');
  }

  resizeResolution(relPath: string, width: number, height: number, method: ResizeMethod): void {
    const tab = this.imageTab(relPath);
    if (!tab) return;
    const image = resizeImage({ width: tab.width, height: tab.height, data: tab.pixels }, width, height, method);
    this.applyImage(relPath, image, `Résolution ${width} × ${height}`);
  }

  resizeCanvasOp(relPath: string, width: number, height: number): void {
    const tab = this.imageTab(relPath);
    if (!tab) return;
    const image = resizeCanvas({ width: tab.width, height: tab.height, data: tab.pixels }, width, height, 'center');
    this.applyImage(relPath, image, `Canevas ${width} × ${height}`);
  }

  adjust(relPath: string, brightness: number, contrast: number): void {
    const tab = this.imageTab(relPath);
    if (!tab) return;
    const image = brightnessContrast({ width: tab.width, height: tab.height, data: tab.pixels }, brightness, contrast);
    this.applyImage(relPath, image, 'Luminosité / contraste');
  }

  resetToOriginal(relPath: string): void {
    const tab = this.imageTab(relPath);
    if (!tab) return;
    const image = {
      width: tab.originalWidth,
      height: tab.originalHeight,
      data: new Uint8Array(tab.originalPixels),
    };
    this.applyImage(relPath, image, 'Retour à l’original');
  }

  updateText(relPath: string, text: string): void {
    const tab = this.textTab(relPath);
    if (!tab) return;
    tab.text = text;
    tab.dirty = text !== tab.savedText;
    this.set({ saveState: tab.dirty ? 'dirty' : this.state.saveState, status: tab.dirty ? 'Texte non enregistré' : 'Prêt' });
    if (tab.dirty) this.scheduleAutosave(relPath);
  }

  // ------------------------------------------------------------------- actions

  async saveTab(relPath: string, options: { silent?: boolean } = {}): Promise<void> {
    const view = this.state.view;
    const tab = this.state.tabs.find((candidate) => candidate.relPath === relPath);
    if (!view || !tab || tab.saving) return;
    if (tab.kind === 'image') {
      tab.saving = true;
      this.set({ saveState: 'saving', status: 'Enregistrement…' });
      try {
        const result = await rpc<{ modified: boolean; restored: boolean }>('image.save', {
          id: view.id,
          relPath,
          width: tab.width,
          height: tab.height,
          data: bytesToBase64(tab.pixels),
        });
        tab.savedWidth = tab.width;
        tab.savedHeight = tab.height;
        tab.savedPixels = new Uint8Array(tab.pixels);
        tab.dirty = false;
        tab.meta.modified = result.modified;
        this.invalidateThumb(relPath);
        this.set({ saveState: 'saved', status: 'Modifications enregistrées' });
        await this.refreshAfterChange();
        if (!options.silent) {
          this.toast(
            result.restored ? 'La texture est revenue exactement à son état d’origine.' : 'Modification enregistrée dans le projet.',
            'success',
          );
        }
      } catch (error) {
        this.set({ saveState: 'dirty', status: 'Échec de l’enregistrement' });
        this.toast(errorMessage(error), 'error');
      } finally {
        tab.saving = false;
        this.set({ thumbEpoch: this.state.thumbEpoch + 1 });
      }
      return;
    }

    tab.saving = true;
    this.set({ saveState: 'saving' });
    try {
      const result = await rpc<{ modified: boolean; restored: boolean }>('text.save', {
        id: view.id,
        relPath,
        text: tab.text,
      });
      tab.savedText = tab.text;
      tab.dirty = false;
      this.invalidateThumb(relPath);
      this.set({ saveState: 'saved', status: 'Fichier enregistré' });
      await this.refreshAfterChange();
      if (!options.silent) {
        this.toast(result.restored ? 'Fichier identique à l’original : modification retirée.' : 'Fichier enregistré.', 'success');
      }
    } catch (error) {
      this.set({ saveState: 'dirty' });
      this.toast(errorMessage(error), 'error');
    } finally {
      tab.saving = false;
    }
  }

  async saveAll(silent = false): Promise<void> {
    const dirty = this.state.tabs.filter((tab) => tab.dirty);
    for (const tab of dirty) await this.saveTab(tab.relPath, { silent: true });
    if (!silent && dirty.length === 0) this.toast('Tout est déjà enregistré.', 'info');
  }

  async saveActive(): Promise<void> {
    if (this.state.activeTab) await this.saveTab(this.state.activeTab);
    else await this.saveAll();
  }

  private scheduleAutosave(relPath: string): void {
    if (!this.state.settings?.autosave) return;
    const existing = this.autosaveTimers.get(relPath);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.autosaveTimers.delete(relPath);
      const tab = this.state.tabs.find((candidate) => candidate.relPath === relPath);
      if (tab?.dirty) void this.saveTab(relPath, { silent: true });
    }, 1000);
    this.autosaveTimers.set(relPath, timer);
  }

  async flushAutosaves(): Promise<void> {
    for (const timer of this.autosaveTimers.values()) window.clearTimeout(timer);
    this.autosaveTimers.clear();
    await this.saveAll(true);
  }

  async refreshAfterChange(): Promise<void> {
    const view = this.state.view;
    if (!view) return;
    try {
      const [stats, changes] = await Promise.all([
        rpc<ProjectStats>('project.stats', { id: view.id }),
        rpc<ChangeRecord[]>('project.changes', { id: view.id }),
      ]);
      this.set((state) => ({
        view: state.view
          ? { ...state.view, stats, changes, modifiedCount: stats.modifiedCount }
          : state.view,
        selectedInfo:
          state.selectedInfo
            ? {
                ...state.selectedInfo,
                change: changes.find((change) => change.relPath === state.selectedInfo?.relPath),
                modified: changes.some(
                  (change) => change.relPath === state.selectedInfo?.relPath && change.status === 'modified',
                ),
                excluded: changes.some(
                  (change) => change.relPath === state.selectedInfo?.relPath && change.status === 'excluded',
                ),
              }
            : state.selectedInfo,
      }));
    } catch {
      // rafraîchissement secondaire
    }
  }

  // ----------------------------------------------------------- modifications

  async revertChange(relPath: string): Promise<void> {
    const view = this.state.view;
    if (!view) return;
    try {
      await rpc('image.revert', { id: view.id, relPath });
      await this.refreshAfterChange();
      const tab = this.state.tabs.find((candidate) => candidate.relPath === relPath);
      if (tab) {
        const wasText = tab.kind === 'text';
        this.removeTab(relPath);
        if (wasText) await this.openTextTab(relPath, { silent: true });
        else await this.openImageTab(relPath, { silent: true });
      }
      this.toast('Modification annulée : le fichier d’origine est restauré.', 'success');
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  async excludeChange(relPath: string): Promise<void> {
    const view = this.state.view;
    if (!view) return;
    try {
      await rpc('image.exclude', { id: view.id, relPath, reason: 'Exclu manuellement' });
      await this.refreshAfterChange();
      this.toast('Modification exclue du pack (la copie de travail est conservée).', 'info');
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  async includeChange(relPath: string): Promise<void> {
    const view = this.state.view;
    if (!view) return;
    try {
      await rpc('image.include', { id: view.id, relPath });
      await this.refreshAfterChange();
      this.toast('Modification réintégrée dans le pack.', 'success');
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  // ---------------------------------------------------------------- source

  async verifySource(): Promise<void> {
    const view = this.state.view;
    if (!view) return;
    try {
      const { taskId } = await rpc<{ taskId: string }>('project.verifySource', { id: view.id });
      this.trackTask(taskId, (task) => {
        if (task.status !== 'done') return;
        const check = task.result as ProjectView['sourceCheck'];
        this.set((state) => ({
          view: state.view ? { ...state.view, sourceCheck: check } : state.view,
        }));
        this.toast(check.message ?? 'Vérification terminée.', check.available ? 'info' : 'warning');
      });
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  async rescanSource(): Promise<void> {
    const view = this.state.view;
    if (!view) return;
    try {
      const { taskId } = await rpc<{ taskId: string }>('project.rescan', { id: view.id });
      this.trackTask(taskId, async (task) => {
        if (task.status !== 'done') return;
        const result = task.result as { view: ProjectView };
        this.thumbCache.clear();
        this.set({ view: result.view, thumbEpoch: this.state.thumbEpoch + 1 });
        await this.refreshListing();
        await this.refreshAfterChange();
        this.toast('Source rescannée.', 'success');
      });
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  async relocateSource(sourcePath: string): Promise<void> {
    const view = this.state.view;
    if (!view) return;
    try {
      const { taskId } = await rpc<{ taskId: string }>('project.relocate', { id: view.id, sourcePath });
      this.trackTask(taskId, async (task) => {
        if (task.status !== 'done') return;
        const result = task.result as { view: ProjectView };
        this.thumbCache.clear();
        this.set({ view: result.view, thumbEpoch: this.state.thumbEpoch + 1 });
        await this.refreshListing();
        this.toast('Source relocalisée.', 'success');
      });
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  // ------------------------------------------------------------------ pack

  async savePackSettings(pack: Partial<PackSettings>): Promise<void> {
    const view = this.state.view;
    if (!view) return;
    const merged: PackSettings = { ...view.pack, ...pack };
    const saved = await rpc<PackSettings>('project.savePack', { id: view.id, pack: merged });
    this.set((state) => ({
      view: state.view ? { ...state.view, pack: saved } : state.view,
    }));
  }

  async chooseOutputDir(): Promise<string | undefined> {
    try {
      const result = await rpc<{ path?: string; cancelled?: boolean }>('app.chooseOutputDir', {
        initial: this.state.view?.pack.outputDir,
      });
      return result.cancelled ? undefined : result.path;
    } catch (error) {
      this.toast(errorMessage(error), 'error');
      return undefined;
    }
  }

  async chooseSource(kind: 'directory' | 'zip'): Promise<string | undefined> {
    try {
      const result = await rpc<{ path?: string; cancelled?: boolean }>('app.chooseSource', { kind });
      return result.cancelled ? undefined : result.path;
    } catch (error) {
      this.toast(errorMessage(error), 'error');
      return undefined;
    }
  }

  async chooseAndSetIcon(): Promise<void> {
    const view = this.state.view;
    if (!view) return;
    try {
      const picked = await rpc<{ path?: string; cancelled?: boolean }>('app.chooseIcon', {});
      if (!picked.path) return;
      await this.setIconFromPath(picked.path);
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  async setIconFromPath(path: string): Promise<void> {
    const view = this.state.view;
    if (!view) return;
    try {
      const result = await rpc<{ icon?: PackSettings['icon'] }>('image.setIcon', { id: view.id, path });
      this.set((state) => ({
        view: state.view ? { ...state.view, pack: { ...state.view.pack, icon: result.icon } } : state.view,
      }));
      await this.loadIconPreview();
      this.toast('Icône du pack mise à jour.', 'success');
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  async removeIcon(): Promise<void> {
    const view = this.state.view;
    if (!view) return;
    try {
      await rpc('image.setIcon', { id: view.id, remove: true });
      this.set((state) => ({
        view: state.view
          ? { ...state.view, pack: { ...state.view.pack, icon: undefined } }
          : state.view,
        iconPreview: null,
      }));
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  async loadIconPreview(): Promise<void> {
    const view = this.state.view;
    if (!view) return;
    if (!view.pack.icon) {
      this.set({ iconPreview: null });
      return;
    }
    try {
      const result = await rpc<{ dataUrl: string; width: number; height: number } | null>('image.getIcon', {
        id: view.id,
      });
      this.set({ iconPreview: result?.dataUrl ?? null });
    } catch {
      this.set({ iconPreview: null });
    }
  }

  // ------------------------------------------------------------------ export

  async previewExport(config: ExportConfig): Promise<ExportPreview | undefined> {
    const view = this.state.view;
    if (!view) return undefined;
    try {
      const preview = await rpc<ExportPreview>('export.preview', { id: view.id, config });
      this.set({ exportPreview: preview, exportError: undefined });
      return preview;
    } catch (error) {
      this.set({ exportPreview: undefined, exportError: errorMessage(error) });
      return undefined;
    }
  }

  async runExport(
    config: ExportConfig,
  ): Promise<{ needsOverwrite: boolean; suggestedName?: string; outputPath?: string; preview?: ExportPreview } | { taskId: string } | undefined> {
    const view = this.state.view;
    if (!view) return undefined;
    try {
      const result = await rpc<
        | { needsOverwrite: true; suggestedName: string; outputPath: string; preview: ExportPreview }
        | { taskId: string; preview: ExportPreview }
      >('export.run', { id: view.id, config });
      if ('needsOverwrite' in result) {
        this.set({ exportPreview: result.preview });
        return { needsOverwrite: true, suggestedName: result.suggestedName, outputPath: result.outputPath };
      }
      this.set((state) => ({
        exportPreview: result.preview,
        exportError: undefined,
        exportReport: undefined,
        view: state.view
          ? {
              ...state.view,
              pack: {
                ...state.view.pack,
                name: config.name.trim() || state.view.pack.name,
                description: config.description,
                targetVersion: config.targetVersion,
                customFormat: config.customFormat,
                format: config.format,
                outputDir: config.outputDir,
                outputName: config.outputName,
              },
            }
          : state.view,
      }));
      this.trackTask(result.taskId, (task) => {
        if (task.status !== 'done') return;
        const report = task.result as ExportReport;
        this.set({ exportReport: report });
        this.toast(`Resource pack exporté : ${report.fileCount} fichier(s), archive vérifiée.`, 'success');
        void this.refreshAfterChange();
      });
      return { taskId: result.taskId };
    } catch (error) {
      this.set({ exportError: errorMessage(error) });
      this.toast(errorMessage(error), 'error');
      return undefined;
    }
  }

  clearExport(): void {
    this.set({ exportPreview: undefined, exportReport: undefined, exportError: undefined });
  }

  // ------------------------------------------------------------------- tâches

  private trackTask(taskId: string, onDone?: (task: TaskState) => void | Promise<void>): void {
    this.set({ activeTaskId: taskId });
    const tick = async (): Promise<void> => {
      try {
        const task = await rpc<TaskState>('task.get', { taskId });
        this.set((state) => ({ tasks: { ...state.tasks, [taskId]: task } }));
        if (task.status === 'running') return;
        window.clearInterval(handle);
        if (task.status === 'error') this.toast(task.error ?? 'Opération échouée.', 'error');
        else if (task.status === 'cancelled') this.toast('Opération annulée.', 'info');
        else await onDone?.(task);
      } catch (error) {
        window.clearInterval(handle);
        this.toast(errorMessage(error), 'error');
      }
    };
    const handle = window.setInterval(tick, 240);
    void tick();
  }

  async cancelTask(taskId?: string): Promise<void> {
    const id = taskId ?? this.state.activeTaskId;
    if (!id) return;
    try {
      await rpc('task.cancel', { taskId: id });
      this.toast('Annulation demandée…', 'info');
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  // --------------------------------------------------------------- miniatures

  private thumbKey(relPath: string): string {
    const view = this.state.view;
    const modified = Boolean(view?.changes.some((change) => change.relPath === relPath));
    return `${view?.id ?? 'none'}:${relPath}:${modified ? 1 : 0}:${this.state.thumbSize}`;
  }

  getThumb(relPath: string): string | null | undefined {
    return this.thumbCache.get(this.thumbKey(relPath));
  }

  requestThumb(relPath: string): void {
    const key = this.thumbKey(relPath);
    if (this.thumbCache.has(key) || this.thumbPending.has(key)) return;
    const view = this.state.view;
    if (!view) return;
    this.thumbPending.add(key);
    void rpc<{ dataUrl: string } | null>('image.thumbnail', {
      id: view.id,
      relPath,
      size: this.state.thumbSize,
    })
      .then((result) => {
        this.thumbCache.set(key, result?.dataUrl ?? null);
      })
      .catch(() => {
        this.thumbCache.set(key, null);
      })
      .finally(() => {
        this.thumbPending.delete(key);
        this.set({ thumbEpoch: this.state.thumbEpoch + 1 });
      });
  }

  invalidateThumb(relPath: string): void {
    for (const key of [...this.thumbCache.keys()]) {
      if (key.includes(`:${relPath}:`)) this.thumbCache.delete(key);
    }
  }

  // ------------------------------------------------------------------ divers

  async saveOptions(patch: Partial<AppSettings>): Promise<void> {
    try {
      const settings = await rpc<AppSettings>('app.saveSettings', patch);
      this.set((state) => ({
        settings,
        info: state.info ? { ...state.info, settings } : state.info,
        showNonImages: settings.showNonImages,
        thumbSize: initialThumbSize(settings),
      }));
      this.thumbCache.clear();
      this.set({ thumbEpoch: this.state.thumbEpoch + 1 });
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  async openPath(path: string): Promise<void> {
    try {
      const result = await rpc<{ message?: string }>('app.openPath', { path });
      if (result.message) this.toast(result.message, 'info');
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  async revealPath(path: string): Promise<void> {
    try {
      await rpc('app.revealPath', { path });
    } catch (error) {
      this.toast(errorMessage(error), 'error');
    }
  }

  openModal(modal: ModalState): void {
    if (modal.type === 'export') {
      this.set({ modal, exportReport: undefined, exportError: undefined, exportPreview: undefined });
    } else {
      this.set({ modal });
    }
  }

  closeModal(): void {
    this.set({ modal: undefined });
  }

  toast(message: string, type: Toast['type'] = 'info'): void {
    const id = ++this.toastCounter;
    this.set((state) => ({ toasts: [...state.toasts.slice(-4), { id, message, type }] }));
    const timer = window.setTimeout(() => this.dismissToast(id), type === 'error' ? 9000 : 4500);
    this.toastTimers.set(id, timer);
  }

  dismissToast(id: number): void {
    const timer = this.toastTimers.get(id);
    if (timer) window.clearTimeout(timer);
    this.toastTimers.delete(id);
    this.set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  }

  isApiError(error: unknown): error is ApiError {
    return error instanceof ApiError;
  }
}

const StoreContext = createContext<AppStore | null>(null);

export function StoreProvider({ store, children }: { store: AppStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreProvider manquant');
  return store;
}

export function useApp(): AppState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
