import { useEffect, useState } from 'react';
import { useApp, useStore } from '../store';
import {
  IconExport,
  IconFolderOpen,
  IconHelp,
  IconRedo,
  IconSave,
  IconSettings,
  IconUndo,
} from '../icons';
import { IconHistory } from '../icons';

export function TopBar() {
  const state = useApp();
  const store = useStore();
  const view = state.view;
  const [name, setName] = useState(view?.name ?? '');
  useEffect(() => {
    setName(view?.name ?? '');
  }, [view?.name]);
  if (!view) return null;
  const activeTab = state.tabs.find((tab) => tab.relPath === state.activeTab);
  const imageTab = activeTab?.kind === 'image' ? activeTab : undefined;
  const modified = view.stats.modifiedCount;

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <div className="brand-mark small">RP</div>
        <span className="brand-name">Atelier Resource Pack</span>
      </div>

      <div className="topbar-project">
        <input
          className="project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name.trim() && name !== view.name) void store.renameProject(name.trim());
            else setName(view.name);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
          aria-label="Nom du projet"
        />
        <span className={`badge ${modified > 0 ? 'badge-accent' : 'badge-muted'}`}>
          {modified} modif.
        </span>
      </div>

      <div className="topbar-actions">
        <button type="button" className="btn ghost compact" title="Ouvrir un projet" onClick={() => store.openModal({ type: 'projects' })}>
          <IconFolderOpen size={16} /> <span className="hide-small">Projets</span>
        </button>
        <button
          type="button"
          className="btn ghost compact"
          title="Enregistrer (Ctrl+S)"
          onClick={() => void store.saveActive()}
        >
          <IconSave size={16} /> <span className="hide-small">Enregistrer</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Annuler (Ctrl+Z)"
          disabled={!imageTab?.history.canUndo}
          onClick={() => imageTab && store.undo(imageTab.relPath)}
        >
          <IconUndo size={17} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Rétablir (Ctrl+Y)"
          disabled={!imageTab?.history.canRedo}
          onClick={() => imageTab && store.redo(imageTab.relPath)}
        >
          <IconRedo size={17} />
        </button>
        <button type="button" className="icon-btn" title="Source et vérification" onClick={() => void store.verifySource()}>
          <IconHistory size={17} />
        </button>
        <button type="button" className="icon-btn" title="Paramètres" onClick={() => store.openModal({ type: 'settings' })}>
          <IconSettings size={17} />
        </button>
        <button type="button" className="icon-btn" title="Aide et raccourcis (F1)" onClick={() => store.openModal({ type: 'help' })}>
          <IconHelp size={17} />
        </button>
        <button type="button" className="btn primary" onClick={() => store.openModal({ type: 'export' })}>
          <IconExport size={17} /> Exporter
        </button>
      </div>
    </header>
  );
}
