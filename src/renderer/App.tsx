import { useEffect, useRef, useState } from 'react';
import { useApp, useStore } from './store';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { Explorer, SearchResults } from './components/Explorer';
import { RightPanel } from './components/RightPanel';
import { StatusBar } from './components/StatusBar';
import { Welcome } from './components/Welcome';
import { Toasts } from './components/Toasts';
import { ModalHost } from './components/modals';
import { ImageEditor } from './editor/ImageEditor';
import { TextEditor } from './text/TextEditor';
import { IconClose, IconFile, IconImage, IconSearch, IconWarning } from './icons';

function useGlobalShortcuts(): void {
  const state = useApp();
  const store = useStore();

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const inField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        Boolean(target?.isContentEditable);

      if (event.key === 'Escape') {
        if (state.modal) store.closeModal();
        else if (state.activeTab && inField) (target as HTMLElement)?.blur();
        else if (state.selected) store.set({ selected: undefined, selectedInfo: undefined });
        return;
      }
      if (event.key === 'F1') {
        event.preventDefault();
        store.openModal({ type: 'help' });
        return;
      }
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void store.saveActive();
        return;
      }
      if (ctrl && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        store.openModal({ type: 'projects' });
        return;
      }
      if (ctrl && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        if (state.view) store.openModal({ type: 'export' });
        return;
      }
      if (ctrl && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (state.view) {
          store.setSidebarTab('search');
          window.setTimeout(() => {
            (document.querySelector('.search-input input') as HTMLInputElement | null)?.focus();
          }, 30);
        }
        return;
      }
      if (!state.view || state.modal) return;
      const activeTab = state.tabs.find((tab) => tab.relPath === state.activeTab);
      const imageTab = activeTab?.kind === 'image' ? activeTab : undefined;
      if (inField) return;

      if (ctrl && event.key.toLowerCase() === 'z' && imageTab) {
        event.preventDefault();
        if (event.shiftKey) store.redo(imageTab.relPath);
        else store.undo(imageTab.relPath);
        return;
      }
      if (ctrl && event.key.toLowerCase() === 'y' && imageTab) {
        event.preventDefault();
        store.redo(imageTab.relPath);
        return;
      }
      if (ctrl && (event.key === '0' || event.key === '1') && imageTab) {
        event.preventDefault();
        if (event.key === '0') store.setFit(imageTab.relPath);
        else store.setZoom(imageTab.relPath, 1);
        return;
      }
      if (imageTab && !ctrl) {
        const key = event.key.toLowerCase();
        if (key === 'b') store.setTool(imageTab.relPath, 'pencil');
        else if (key === 'e') store.setTool(imageTab.relPath, 'eraser');
        else if (key === 'i') store.setTool(imageTab.relPath, 'dropper');
        else if (key === 'g') store.setTool(imageTab.relPath, 'fill');
        else if (key === 'm') store.setTool(imageTab.relPath, 'select');
        else if (key === 'delete' || event.key === 'Backspace') {
          if (imageTab.selection) {
            event.preventDefault();
            store.deleteSelection(imageTab.relPath);
          }
        } else if (event.key === '+' || event.key === '=') {
          store.setZoom(imageTab.relPath, imageTab.zoom * 1.25);
        } else if (event.key === '-') {
          store.setZoom(imageTab.relPath, imageTab.zoom / 1.25);
        }
      }
      if (ctrl && imageTab && ['c', 'x', 'v'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        const key = event.key.toLowerCase();
        if (key === 'c') store.copySelection(imageTab.relPath);
        else if (key === 'x') store.cutSelection(imageTab.relPath);
        else store.pasteSelection(imageTab.relPath);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state, store]);
}

function useWorkProtection(): void {
  const state = useApp();
  const store = useStore();
  const dirty = state.tabs.some((tab) => tab.dirty);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') void store.flushAutosaves();
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onVisibility);
    };
  }, [dirty, store]);
}

function TabBar() {
  const state = useApp();
  const store = useStore();
  return (
    <nav className="tabbar" aria-label="Onglets">
      <button
        type="button"
        className={`center-tab ${!state.activeTab && !state.showingSearch ? 'active' : ''}`}
        onClick={() => store.showExplorer()}
      >
        <IconFile size={14} /> Fichiers
      </button>
      {state.showingSearch ? (
        <span className="center-tab active search-tab">
          <IconSearch size={14} /> Recherche
        </span>
      ) : null}
      <span className="tabbar-divider" />
      <div className="doc-tabs">
        {state.tabs.map((tab) => (
          <div
            key={tab.relPath}
            className={`doc-tab ${state.activeTab === tab.relPath ? 'active' : ''}`}
            onClick={() => store.activateTab(tab.relPath)}
            onAuxClick={(event) => {
              if (event.button === 1) void store.closeTab(tab.relPath);
            }}
            title={tab.relPath}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter') store.activateTab(tab.relPath);
            }}
          >
            {tab.kind === 'image' ? <IconImage size={13} /> : <IconFile size={13} />}
            <span className="doc-name">{tab.name}</span>
            {tab.dirty ? <span className="unsaved-dot" title="Modifications non enregistrées" /> : null}
            <button
              type="button"
              className="doc-close"
              aria-label={`Fermer ${tab.name}`}
              onClick={(event) => {
                event.stopPropagation();
                void store.closeTab(tab.relPath);
              }}
            >
              <IconClose size={12} />
            </button>
          </div>
        ))}
      </div>
    </nav>
  );
}

function SourceBanner() {
  const state = useApp();
  const store = useStore();
  const [dismissed, setDismissed] = useState<string | undefined>();
  const view = state.view;
  if (!view) return null;
  const unavailable = !view.sourceAvailable;
  const message = view.sourceCheck.message ?? (unavailable ? 'La source est indisponible.' : undefined);
  if (!message || dismissed === message) return null;
  return (
    <div className={`source-banner ${unavailable ? 'error' : 'warning'}`}>
      <IconWarning size={16} />
      <span>{message}</span>
      <div className="banner-actions">
        <button type="button" className="btn tiny ghost" onClick={() => void store.verifySource()}>
          Vérifier
        </button>
        <button type="button" className="btn tiny ghost" onClick={() => void store.rescanSource()}>
          Rescanner
        </button>
        <button
          type="button"
          className="btn tiny primary"
          onClick={async () => {
            const chosen = await store.chooseSource(view.source.type);
            if (chosen) await store.relocateSource(chosen);
          }}
        >
          Relocaliser la source
        </button>
        <button type="button" className="icon-btn tiny" title="Masquer" onClick={() => setDismissed(message)}>
          <IconClose size={13} />
        </button>
      </div>
    </div>
  );
}

function ImportOverlay() {
  const state = useApp();
  const store = useStore();
  const task = state.activeTaskId ? state.tasks[state.activeTaskId] : undefined;
  if (state.view || !task || task.status !== 'running') return null;
  const percent = task.total > 0 ? Math.min(100, Math.round((task.current / task.total) * 100)) : undefined;
  return (
    <div className="import-overlay">
      <div className="import-card">
        <div className="brand-mark">RP</div>
        <h2>{task.label}</h2>
        <p>{task.detail ?? 'Analyse des fichiers…'}</p>
        <div className={`progress ${percent === undefined ? 'indeterminate' : ''}`}>
          <span style={{ width: percent === undefined ? undefined : `${percent}%` }} />
        </div>
        <span className="muted">
          {percent !== undefined ? `${percent} % · ${task.current} / ${task.total}` : `${task.current} fichiers analysés`}
        </span>
        <button type="button" className="btn ghost" onClick={() => void store.cancelTask(task.id)}>
          Annuler
        </button>
      </div>
    </div>
  );
}

function Splash() {
  return (
    <div className="splash">
      <div className="brand-mark large">RP</div>
      <p>Chargement de l’atelier…</p>
    </div>
  );
}

export function App() {
  const state = useApp();
  const store = useStore();
  const bootstrapped = useRef(false);
  useGlobalShortcuts();
  useWorkProtection();

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void store.bootstrap();
  }, [store]);

  if (!state.booted) return <Splash />;

  return (
    <div className="app">
      {state.view ? (
        <>
          <TopBar />
          <SourceBanner />
          <div className="workspace">
            <Sidebar />
            <main className="center">
              <TabBar />
              <div className="center-body">
                {state.activeTab ? (
                  (() => {
                    const tab = state.tabs.find((candidate) => candidate.relPath === state.activeTab);
                    if (!tab) return <Explorer />;
                    return tab.kind === 'image' ? (
                      <ImageEditor key={tab.relPath} tab={tab} />
                    ) : (
                      <TextEditor key={tab.relPath} tab={tab} />
                    );
                  })()
                ) : state.showingSearch ? (
                  <SearchResults />
                ) : (
                  <Explorer />
                )}
              </div>
            </main>
            <RightPanel />
          </div>
          <StatusBar />
        </>
      ) : (
        <Welcome />
      )}
      <ImportOverlay />
      <Toasts />
      <ModalHost />
    </div>
  );
}
