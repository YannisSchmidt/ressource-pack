import { useEffect } from 'react';
import type { ChangeRecord, TreeNode } from '../../shared/types';
import { useApp, useStore } from '../store';
import {
  IconChevron,
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconRefresh,
  IconSearch,
  IconWarning,
} from '../icons';
import { formatBytes, KIND_LABELS } from '../utils';

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const state = useApp();
  const store = useStore();
  const expanded = state.expanded.has(node.path);
  const active = state.listingDir === node.path && !state.activeTab;
  return (
    <>
      <div
        className={`tree-row ${active ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => void store.navigate(node.path)}
      >
        <button
          type="button"
          className={`tree-chevron ${expanded ? 'open' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            store.toggleFolder(node.path);
          }}
          aria-label={expanded ? 'Réduire' : 'Développer'}
        >
          {node.children.length > 0 ? <IconChevron size={13} /> : <span className="dot" />}
        </button>
        {expanded ? <IconFolderOpen size={15} /> : <IconFolder size={15} />}
        <span className="tree-name" title={node.path}>
          {node.name}
        </span>
        <span className="tree-count">{node.totalFiles}</span>
      </div>
      {expanded
        ? node.children.map((child) => <TreeRow key={child.path} node={child} depth={depth + 1} />)
        : null}
    </>
  );
}

function StatusBadge({ change }: { change?: ChangeRecord }) {
  if (!change) return null;
  if (change.status === 'excluded') return <span className="badge badge-muted">exclu</span>;
  if (change.status === 'error') return <span className="badge badge-error">erreur</span>;
  return <span className="badge badge-accent">modifié</span>;
}

function SearchPanel() {
  const state = useApp();
  const store = useStore();
  const result = state.searchResult;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void store.runSearch();
    }, 280);
    return () => window.clearTimeout(timer);
  }, [
    state.searchQuery,
    state.searchExt,
    state.searchKind,
    state.searchModifiedOnly,
    state.view?.id,
  ]);

  return (
    <div className="sidebar-panel search-panel">
      <div className="search-input">
        <IconSearch size={15} />
        <input
          value={state.searchQuery}
          onChange={(event) => store.setSearchQuery(event.target.value)}
          placeholder="diamond_sword, *.png, gui…"
          aria-label="Rechercher un fichier"
          autoFocus
        />
        {state.searchQuery ? (
          <button type="button" className="link-btn" onClick={() => store.setSearchQuery('')}>
            effacer
          </button>
        ) : null}
      </div>
      <div className="search-filters">
        <label>
          <span>Extension</span>
          <select value={state.searchExt} onChange={(event) => store.setSearchExt(event.target.value)}>
            <option value="">Toutes</option>
            <option value="png">png</option>
            <option value="json">json</option>
            <option value="mcmeta">mcmeta</option>
            <option value="lang">lang</option>
            <option value="txt">txt</option>
            <option value="jpg">jpg</option>
            <option value="ogg">ogg</option>
            <option value="vsh">vsh</option>
            <option value="fsh">fsh</option>
          </select>
        </label>
        <label>
          <span>Catégorie</span>
          <select value={state.searchKind} onChange={(event) => store.setSearchKind(event.target.value)}>
            <option value="all">Toutes</option>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={state.searchModifiedOnly}
          onChange={(event) => store.setSearchModifiedOnly(event.target.checked)}
        />
        Uniquement les fichiers modifiés
      </label>
      <div className="search-meta">
        {state.searchLoading ? (
          <span className="muted">Recherche…</span>
        ) : result ? (
          <span className="muted">
            {result.total} résultat(s) en {result.durationMs} ms
          </span>
        ) : (
          <span className="muted">Recherche récursive dans tout le projet</span>
        )}
      </div>
    </div>
  );
}

function ModifiedPanel() {
  const state = useApp();
  const store = useStore();
  const changes = state.view?.changes ?? [];
  return (
    <div className="sidebar-panel modified-panel">
      <div className="panel-heading compact">
        <span className="muted">{changes.length} fichier(s) dans le projet</span>
        <button type="button" className="icon-btn tiny" title="Rafraîchir" onClick={() => void store.refreshAfterChange()}>
          <IconRefresh size={14} />
        </button>
      </div>
      {changes.length === 0 ? (
        <p className="empty-note">
          Aucune modification pour l’instant. Ouvrez une texture et enregistrez-la : elle apparaîtra ici.
        </p>
      ) : (
        <ul className="modified-list">
          {changes.map((change) => (
            <li key={change.relPath} className="modified-item">
              <button type="button" className="modified-main" onClick={() => void store.openByPath(change.relPath)}>
                <span className={`modified-dot ${change.status}`} />
                <span className="modified-text">
                  <strong>{change.relPath.split('/').pop()}</strong>
                  <small>{change.relPath}</small>
                  <small className="muted">
                    {change.workWidth && change.workHeight
                      ? `${change.originalWidth}×${change.originalHeight} → ${change.workWidth}×${change.workHeight} px`
                      : `${formatBytes(change.originalSize)} → ${formatBytes(change.workSize)}`}
                  </small>
                </span>
                <StatusBadge change={change} />
              </button>
              <div className="modified-actions">
                {change.status === 'excluded' ? (
                  <button type="button" className="link-btn" onClick={() => void store.includeChange(change.relPath)}>
                    réintégrer
                  </button>
                ) : (
                  <button type="button" className="link-btn" onClick={() => void store.excludeChange(change.relPath)}>
                    exclure
                  </button>
                )}
                <button
                  type="button"
                  className="link-btn danger"
                  onClick={() =>
                    store.openModal({
                      type: 'confirm',
                      title: 'Revenir à l’original ?',
                      message: `La modification de « ${change.relPath} » sera supprimée. Le fichier source reste intact et la copie de travail sera effacée.`,
                      confirmLabel: 'Annuler la modification',
                      danger: true,
                      onConfirm: () => store.revertChange(change.relPath),
                    })
                  }
                >
                  annuler
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Sidebar() {
  const state = useApp();
  const store = useStore();
  const view = state.view;
  if (!view) return null;
  const modCount = view.changes.length;

  return (
    <aside className="sidebar">
      <div className="source-card">
        <div className="source-title">
          {view.source.type === 'zip' ? <IconFile size={15} /> : <IconFolder size={15} />}
          <strong>{view.source.type === 'zip' ? 'Archive source' : 'Dossier source'}</strong>
        </div>
        <p className="source-path" title={view.source.path}>
          {view.source.path}
        </p>
        <div className="source-meta">
          {view.source.fileCount.toLocaleString('fr-FR')} fichiers · {formatBytes(view.source.totalBytes)}
        </div>
        {!view.sourceAvailable || view.sourceCheck.message ? (
          <div className={`source-warning ${view.sourceAvailable ? '' : 'missing'}`}>
            <IconWarning size={13} />
            <span>{view.sourceCheck.message ?? 'La source est indisponible.'}</span>
          </div>
        ) : null}
        <div className="source-actions">
          <button type="button" className="btn tiny ghost" onClick={() => void store.verifySource()}>
            Vérifier
          </button>
          <button type="button" className="btn tiny ghost" onClick={() => void store.rescanSource()}>
            Rescanner
          </button>
          <button
            type="button"
            className="btn tiny ghost"
            onClick={async () => {
              const chosen = await store.chooseSource(view.source.type);
              if (chosen) await store.relocateSource(chosen);
            }}
          >
            Relocaliser
          </button>
        </div>
      </div>

      <div className="sidebar-tabs">
        <button
          type="button"
          className={state.sidebarTab === 'tree' ? 'active' : ''}
          onClick={() => store.setSidebarTab('tree')}
        >
          Arborescence
        </button>
        <button
          type="button"
          className={state.sidebarTab === 'search' ? 'active' : ''}
          onClick={() => store.setSidebarTab('search')}
        >
          Recherche
        </button>
        <button
          type="button"
          className={state.sidebarTab === 'modified' ? 'active' : ''}
          onClick={() => store.setSidebarTab('modified')}
        >
          Modifiés {modCount > 0 ? <span className="count">{modCount}</span> : null}
        </button>
      </div>

      {state.sidebarTab === 'tree' ? (
        <div className="tree-panel">
          <div
            className={`tree-root ${state.listingDir === '' && !state.activeTab ? 'active' : ''}`}
            onClick={() => void store.navigate('')}
          >
            <IconFolderOpen size={15} />
            <span>{view.name}</span>
            <span className="tree-count">{view.stats.fileCount}</span>
          </div>
          {view.tree.children.map((child) => (
            <TreeRow key={child.path} node={child} depth={0} />
          ))}
          {view.tree.children.length === 0 ? <p className="empty-note">Aucun sous-dossier.</p> : null}
        </div>
      ) : state.sidebarTab === 'search' ? (
        <SearchPanel />
      ) : (
        <ModifiedPanel />
      )}

      <div className="sidebar-footer">
        <div className="quick-stat">
          <span>Modifiés</span>
          <strong>{view.stats.modifiedCount}</strong>
        </div>
        <div className="quick-stat">
          <span>Exclus</span>
          <strong>{view.stats.excludedCount}</strong>
        </div>
        <button type="button" className="btn tiny primary wide" onClick={() => store.openModal({ type: 'export' })}>
          Exporter le pack
        </button>
      </div>
    </aside>
  );
}
