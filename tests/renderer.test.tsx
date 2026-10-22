// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../src/renderer/App';
import { AppStore, StoreProvider } from '../src/renderer/store';
import type { AppInfo, ProjectView, TreeNode } from '../src/shared/types';
import { encodePng } from '../src/core/png';
import { createPixmap } from '../src/core/imageOps';

const tree: TreeNode = {
  path: '',
  name: '',
  files: 0,
  totalFiles: 3,
  children: [
    {
      path: 'assets',
      name: 'assets',
      files: 0,
      totalFiles: 3,
      children: [
        {
          path: 'assets/minecraft',
          name: 'minecraft',
          files: 0,
          totalFiles: 3,
          children: [
            {
              path: 'assets/minecraft/textures',
              name: 'textures',
              files: 0,
              totalFiles: 3,
              children: [
                {
                  path: 'assets/minecraft/textures/block',
                  name: 'block',
                  files: 3,
                  totalFiles: 3,
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const stonePath = 'assets/minecraft/textures/block/stone.png';
const pixelPng = encodePng(createPixmap(2, 2, [10, 20, 30, 255]));

const view: ProjectView = {
  id: 'p1',
  name: 'Pack de test UI',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  source: {
    type: 'directory',
    path: '/tmp/demo',
    importedAt: new Date().toISOString(),
    fileCount: 3,
    totalBytes: 4096,
    scannerVersion: 1,
  },
  modifiedCount: 0,
  pack: {
    name: 'Pack de test UI',
    description: 'Description de test',
    targetVersion: '1.21.9',
    format: 'zip',
    outputDir: '/tmp/out',
  },
  changes: [],
  stats: {
    fileCount: 3,
    totalBytes: 4096,
    folderCount: 4,
    modifiedCount: 0,
    excludedCount: 0,
    errorCount: 0,
    modifiedBytes: 0,
  },
  tree,
  sourceAvailable: true,
  sourceCheck: { available: true, verified: false },
};

const info: AppInfo = {
  version: '1.0.0-test',
  platform: 'linux',
  demo: true,
  nativeDialogs: false,
  canOpenPaths: false,
  userDataDir: '/tmp/demo-data',
  demoSources: [
    { label: 'Démo', path: '/tmp/demo', type: 'directory', description: 'Ressources de test' },
  ],
  projects: [
    {
      id: 'p1',
      name: view.name,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      source: view.source,
      modifiedCount: 0,
      pack: view.pack,
    },
  ],
  settings: { autosave: false, showNonImages: true, thumbnailSize: 'medium', lastProjectId: 'p1' },
};

const entries = [
  {
    relPath: stonePath,
    name: 'stone.png',
    dir: 'assets/minecraft/textures/block',
    ext: 'png',
    size: pixelPng.length,
    mtimeMs: Date.now(),
    kind: 'texture' as const,
    image: true,
    editability: 'image' as const,
    width: 2,
    height: 2,
  },
  {
    relPath: 'assets/minecraft/textures/block/stone.png.mcmeta',
    name: 'stone.png.mcmeta',
    dir: 'assets/minecraft/textures/block',
    ext: 'mcmeta',
    size: 20,
    mtimeMs: Date.now(),
    kind: 'texture' as const,
    image: false,
    editability: 'text' as const,
  },
  {
    relPath: 'assets/minecraft/textures/block/notes.txt',
    name: 'notes.txt',
    dir: 'assets/minecraft/textures/block',
    ext: 'txt',
    size: 12,
    mtimeMs: Date.now(),
    kind: 'text' as const,
    image: false,
    editability: 'text' as const,
  },
];

function mockRpc(): void {
  const handlers: Record<string, (params: Record<string, unknown>) => unknown> = {
    'app.info': () => info,
    'project.open': () => view,
    'project.saveUi': () => ({ ok: true }),
    'fs.list': () => ({
      relPath: 'assets/minecraft/textures/block',
      parent: 'assets/minecraft/textures',
      entries,
      total: entries.length,
    }),
    'fs.info': (params) => ({
      ...(entries.find((entry) => entry.relPath === params.relPath) ?? entries[0]),
      width: 2,
      height: 2,
      modified: false,
      excluded: false,
    }),
    'image.open': () => ({
      meta: {
        relPath: stonePath,
        width: 2,
        height: 2,
        animated: false,
        modified: false,
        excluded: false,
        hasWorkingCopy: false,
        bytes: pixelPng.length,
        sourceWidth: 2,
        sourceHeight: 2,
        sourceBytes: pixelPng.length,
      },
      original: {
        width: 2,
        height: 2,
        data: Buffer.from(createPixmap(2, 2, [10, 20, 30, 255]).data).toString('base64'),
      },
    }),
    'image.thumbnail': () => null,
    'image.save': () => ({
      modified: true,
      restored: false,
      stats: { ...view.stats, modifiedCount: 1 },
      changes: [],
    }),
    'project.stats': () => ({ ...view.stats, modifiedCount: 1 }),
    'project.changes': () => [],
    'text.open': (params) => ({
      relPath: params.relPath,
      text: '{\n  "animation": {}\n}',
      originalText: '{\n  "animation": {}\n}',
      bytes: 20,
      modified: false,
      excluded: false,
      editable: true,
    }),
    'export.preview': () => ({
      name: 'Pack de test UI',
      targetVersion: '1.21.9',
      versionLabel: '1.21.9 – 1.21.10',
      format: 'zip',
      outputPath: '/tmp/out/Pack de test UI.zip',
      files: [{ relPath: stonePath, bytes: 120, width: 2, height: 2 }],
      totalFiles: 2,
      estimatedBytes: 400,
      warnings: [],
      packMeta: '{\n  "pack": {\n    "description": "test"\n  }\n}\n',
      conflict: false,
      suggestedName: 'Pack de test UI (2)',
      blocked: false,
      errors: [],
      modifiedCount: 1,
      excludedCount: 0,
    }),
    'app.chooseOutputDir': () => ({ path: '/tmp/out' }),
    'app.saveSettings': () => info.settings,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? '{}')) as {
        method: string;
        params: Record<string, unknown>;
      };
      const handler = handlers[payload.method];
      if (!handler) throw new Error(`RPC non simulé : ${payload.method}`);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: handler(payload.params) }),
      } as Response;
    }),
  );
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class ImageDataStub {
  data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

function fakeContext(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get: (object, property) => {
      if (property in object) return object[property as string];
      if (property === 'createPattern') return () => null;
      if (property === 'canvas') return document.createElement('canvas');
      return () => undefined;
    },
    set: (object, property, value) => {
      object[property as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('ImageData', ImageDataStub);
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => fakeContext() });
  Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', { value: () => undefined });
  Object.defineProperty(HTMLCanvasElement.prototype, 'releasePointerCapture', { value: () => undefined });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
});

async function mount(): Promise<{ store: AppStore; text: () => string }> {
  mockRpc();
  container = document.createElement('div');
  document.body.appendChild(container);
  const store = new AppStore();
  await act(async () => {
    root = createRoot(container as HTMLDivElement);
    root.render(
      <StoreProvider store={store}>
        <App />
      </StoreProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  return { store, text: () => container?.textContent ?? '' };
}

function findButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((button) =>
    button.textContent?.toLowerCase().includes(label.toLowerCase()),
  );
}

describe('interface React', () => {
  it('se monte, restaure le dernier projet et affiche l’explorateur', async () => {
    const { store, text } = await mount();
    expect(store.state.booted).toBe(true);
    expect(store.state.view?.id).toBe('p1');
    expect(text()).toContain('Pack de test UI');
    expect(text()).toContain('stone.png');
    expect(text()).toContain('Exporter');
    expect(text()).toContain('3 fichiers');
  });

  it('ouvre une texture dans l’éditeur et affiche ses outils', async () => {
    const { store } = await mount();
    await act(async () => {
      await store.openImageTab(stonePath);
    });
    expect(store.state.activeTab).toBe(stonePath);
    const canvas = document.querySelector('canvas.pixel-canvas');
    expect(canvas).toBeTruthy();
    expect(document.body.textContent).toContain('Crayon');
    expect(document.body.textContent).toContain('Gomme');
    expect(document.body.textContent).toContain('Résolution');
    expect(document.body.textContent).toContain('2 × 2 px');
  });

  it('modifie un pixel au crayon, annule puis enregistre', async () => {
    const { store } = await mount();
    await act(async () => {
      await store.openImageTab(stonePath);
    });
    const tab = store.state.tabs.find((candidate) => candidate.relPath === stonePath);
    expect(tab?.kind).toBe('image');
    if (!tab || tab.kind !== 'image') throw new Error('onglet image manquant');
    const before = new Uint8Array(tab.pixels);
    const canvas = document.querySelector('canvas.pixel-canvas') as HTMLCanvasElement;
    expect(canvas).toBeTruthy();

    await act(async () => {
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 30, clientY: 30, button: 0, pointerId: 1 }),
      );
      canvas.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, clientX: 30, clientY: 30, button: 0, pointerId: 1 }),
      );
    });

    const edited = store.state.tabs.find((candidate) => candidate.relPath === stonePath);
    if (!edited || edited.kind !== 'image') throw new Error('onglet image manquant');
    expect(edited.dirty).toBe(true);
    expect([...edited.pixels]).not.toEqual([...before]);

    await act(async () => {
      store.undo(stonePath);
    });
    const undone = store.state.tabs.find((candidate) => candidate.relPath === stonePath);
    if (!undone || undone.kind !== 'image') throw new Error('onglet image manquant');
    expect([...undone.pixels]).toEqual([...before]);
    expect(undone.dirty).toBe(false);

    await act(async () => {
      store.setTool(stonePath, 'fill');
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 30, clientY: 30, button: 0, pointerId: 2 }),
      );
      await store.saveTab(stonePath);
    });
    const saved = store.state.tabs.find((candidate) => candidate.relPath === stonePath);
    if (!saved || saved.kind !== 'image') throw new Error('onglet image manquant');
    expect(saved.dirty).toBe(false);
    expect(store.state.view?.stats.modifiedCount).toBe(1);
  });

  it('ouvre l’éditeur de texte pour un fichier .mcmeta', async () => {
    const { store } = await mount();
    await act(async () => {
      await store.openTextTab('assets/minecraft/textures/block/stone.png.mcmeta');
    });
    expect(store.state.activeTab).toContain('.mcmeta');
    expect(document.querySelector('textarea.text-area')).toBeTruthy();
    expect(document.body.textContent).toContain('JSON valide');
  });

  it('affiche la fenêtre d’export avec l’aperçu RPC', async () => {
    const { text } = await mount();
    const exportButton = findButton('Exporter');
    expect(exportButton).toBeTruthy();
    await act(async () => {
      exportButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(text()).toContain('Exporter mon resource pack');
    expect(text()).toContain('Récapitulatif');
  });
});
