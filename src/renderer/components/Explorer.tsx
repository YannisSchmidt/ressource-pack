import { useEffect, useRef, useState } from 'react';
import type { ChangeRecord, FileEntry, SearchHit, TreeNode } from '../../shared/types';
import { useApp, useStore } from '../store';
import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconChevron,
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconGrid,
  IconImage,
  IconList,
  IconRefresh,
  IconSearch,
  IconWarning,
} from '../icons';
import {
  breadcrumbParts,
  formatBytes,
  formatDate,
  formatNumber,
  KIND_LABELS,
  sortedFiles,
} from '../utils';

function changeFor(changes: ChangeRecord[] | undefined, relPath: string): ChangeRecord | undefined {
  return changes?.find((change) => change.relPath === relPath);
}

export function Thumb({ entry, size = 64 }: { entry: FileEntry; size?: number }) {
  const state = useApp();
  const store = useStore();
  const url = store.getThumb(entry.relPath);

  useEffect(() => {
    if (entry.image) store.requestThumb(entry.relPath);
  }, [entry.image, entry.relPath, state.thumbEpoch, state.view?.changes, store]);

  if (!entry.image) {
    return (
      <div className="thumb placeholder" style={{ width: size, height: size }}>
        <IconFile size={Math.max(18, size * 0.4)} />
      </div>
    );
  }
  if (url === undefined) {
    return <div className="thumb skeleton" style={{ width: size, height: size }} />;
  }
  if (url === null) {
    return (
      <div className="thumb placeholder" style={{ width: size, height: size }} title="Aperçu indisponible">
        <IconImage size={Math.max(18, size * 0.4)} />
      </div>
    );
  }
  return (
    <div className="thumb" style={{ width: size, height: size }}>
      <img src={url} alt="" draggable={false} style={{ imageRendering: 'pixelated' }} />
    </div>
  );
}

function StatusDots({ change }: { change?: ChangeRecord }) {
  if (!change) return null;
  if (change.status === 'modified') return <span className="dot-badge accent" title="Modifié" />;
  if (change.status === 'excluded') return <span className="dot-badge muted" title="Exclu du pack" />;
  return <span className="dot-badge error" title="Erreur" />;
}

interface FolderItem {
  kind: 'folder';
  node: TreeNode;
}

interface FileItem {
  kind: 'file';
  entry: FileEntry;
}

type ExplorerItem = FolderItem | FileItem;

function currentFolders(tree: TreeNode | undefined, dir: string): TreeNode[] {
  if (!tree) return [];
  if (!dir) return tree.children;
  let node: TreeNode | undefined = tree;
  for (const segment of dir.split('/')) {
    node = node?.children.find((child) => child.name === segment);
    if (!node) return [];
  }
  return node.children;
}

export function Explorer() {
  const state = useApp();
  const store = useStore();
  const view = state.view;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ width: 900, height: 600 });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setViewport({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    setViewport({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [state.listingDir]);

  if (!view) return null;

  const folders: FolderItem[] = currentFolders(view.tree, state.listingDir)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }))
    .map((node) => ({ kind: 'folder', node }));
  const files = sortedFiles(
    state.listing.filter((entry) => (state.showNonImages ? true : entry.image)),
    state.sort,
  ).map<FileItem>((entry) => ({ kind: 'file', entry }));
  const items: ExplorerItem[] = [...folders, ...files];
  const changes = view.changes;

  const toolbar = (
    <div className="explorer-toolbar">
      <button
        type="button"
        className="icon-btn"
        title="Dossier précédent"
        disabled={state.navIndex <= 0}
        onClick={() => store.goBack()}
      >
        <IconArrowLeft size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Dossier suivant"
        disabled={state.navIndex >= state.navHistory.length - 1}
        onClick={() => store.goForward()}
      >
        <IconArrowRight size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Dossier parent"
        disabled={state.listingDir === ''}
        onClick={() => store.goUp()}
      >
        <IconArrowUp size={16} />
      </button>
      <nav className="breadcrumb" aria-label="Chemin">
        {breadcrumbParts(state.listingDir).map((part, index, list) => (
          <span key={part.path} className="crumb">
            <button type="button" onClick={() => void store.navigate(part.path)} disabled={index === list.length - 1}>
              {index === 0 ? <IconFolderOpen size={13} /> : null}
              {part.label}
            </button>
            {index < list.length - 1 ? <IconChevron size={11} /> : null}
          </span>
        ))}
      </nav>
      <div className="toolbar-spacer" />
      <label className="select-inline" title="Trier les fichiers">
        <select value={state.sort.key} onChange={(event) => store.setSort(event.target.value as typeof state.sort.key)}>
          <option value="name">Nom</option>
          <option value="type">Type</option>
          <option value="size">Taille</option>
          <option value="date">Date</option>
        </select>
        <span className="sort-dir">{state.sort.dir === 1 ? '↑' : '↓'}</span>
      </label>
      <label className="toggle-inline" title="Masquer les fichiers qui ne sont pas des images">
        <input
          type="checkbox"
          checked={!state.showNonImages}
          onChange={(event) => store.setShowNonImages(!event.target.checked)}
        />
        Images seulement
      </label>
      <div className="segmented">
        <button
          type="button"
          className={state.viewMode === 'grid' ? 'active' : ''}
          title="Vue grille"
          onClick={() => store.setViewMode('grid')}
        >
          <IconGrid size={15} />
        </button>
        <button
          type="button"
          className={state.viewMode === 'list' ? 'active' : ''}
          title="Vue liste"
          onClick={() => store.setViewMode('list')}
        >
          <IconList size={15} />
        </button>
      </div>
      <button type="button" className="icon-btn" title="Rafraîchir" onClick={() => void store.refreshListing()}>
        <IconRefresh size={15} />
      </button>
    </div>
  );

  if (state.viewMode === 'list') {
    const rowHeight = 38;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
    const end = Math.min(items.length, Math.ceil((scrollTop + viewport.height) / rowHeight) + 4);
    const visible = items.slice(start, end);
    return (
      <div className="explorer">
        {toolbar}
        <div className="explorer-head">
          <span className="col-name">Nom</span>
          <span className="col-type">Type</span>
          <span className="col-dims">Résolution</span>
          <span className="col-size">Taille</span>
          <span className="col-date">Modifié le</span>
          <span className="col-status" />
        </div>
        <div
          className="explorer-scroll list"
          ref={scrollRef}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          {items.length === 0 ? <EmptyFolder /> : null}
          <div className="virtual" style={{ height: items.length * rowHeight, position: 'relative' }}>
            <div style={{ position: 'absolute', top: start * rowHeight, left: 0, right: 0 }}>
              {visible.map((item) =>
                item.kind === 'folder' ? (
                  <div
                    key={`folder-${item.node.path}`}
                    className={`list-row folder-row ${state.selectedFolder === item.node.path ? 'selected' : ''}`}
                    style={{ height: rowHeight }}
                    onClick={() => store.selectFolder(item.node.path)}
                    onDoubleClick={() => void store.navigate(item.node.path)}
                  >
                    <span className="col-name">
                      <span className="file-icon folder">
                        <IconFolder size={16} />
                      </span>
                      <span className="name-text">{item.node.name}</span>
                    </span>
                    <span className="col-type">Dossier</span>
                    <span className="col-dims">—</span>
                    <span className="col-size">{formatNumber(item.node.totalFiles)} fichier(s)</span>
                    <span className="col-date">—</span>
                    <span className="col-status">
                      <IconChevron size={13} />
                    </span>
                  </div>
                ) : (
                  <FileListRow
                    key={item.entry.relPath}
                    entry={item.entry}
                    change={changeFor(changes, item.entry.relPath)}
                    rowHeight={rowHeight}
                  />
                ),
              )}
            </div>
          </div>
        </div>
        <div className="explorer-footer">
          {formatNumber(items.length)} élément(s) · {formatNumber(files.length)} fichier(s)
        </div>
      </div>
    );
  }

  const gap = 12;
  const cardWidth = 136;
  const cardHeight = state.thumbSize + 84;
  const columns = Math.max(1, Math.floor((Math.max(200, viewport.width - 24) + gap) / (cardWidth + gap)));
  const totalRows = Math.ceil(items.length / columns);
  const startRow = Math.max(0, Math.floor(scrollTop / cardHeight) - 2);
  const endRow = Math.min(totalRows, Math.ceil((scrollTop + viewport.height) / cardHeight) + 2);
  const slice = items.slice(startRow * columns, endRow * columns);

  return (
    <div className="explorer">
      {toolbar}
      <div
        className="explorer-scroll grid"
        ref={scrollRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {items.length === 0 ? <EmptyFolder /> : null}
        <div style={{ height: totalRows * cardHeight, position: 'relative' }}>
          <div
            className="grid-window"
            style={{
              position: 'absolute',
              top: startRow * cardHeight,
              left: 0,
              right: 0,
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, minmax(0, ${cardWidth}px))`,
              gap,
            }}
          >
            {slice.map((item) =>
              item.kind === 'folder' ? (
                <div
                  key={`folder-${item.node.path}`}
                  className={`grid-card folder-card ${state.selectedFolder === item.node.path ? 'selected' : ''}`}
                  style={{ height: cardHeight }}
                  onClick={() => store.selectFolder(item.node.path)}
                  onDoubleClick={() => void store.navigate(item.node.path)}
                  title={`${item.node.path || item.node.name} — ${item.node.totalFiles} fichier(s)`}
                >
                  <div className="folder-art">
                    <IconFolder size={44} />
                    <span>{formatNumber(item.node.totalFiles)}</span>
                  </div>
                  <span className="card-name">{item.node.name}</span>
                  <span className="card-meta">Dossier</span>
                </div>
              ) : (
                <FileCard
                  key={item.entry.relPath}
                  entry={item.entry}
                  change={changeFor(changes, item.entry.relPath)}
                  height={cardHeight}
                  thumbSize={state.thumbSize}
                />
              ),
            )}
          </div>
        </div>
      </div>
      <div className="explorer-footer">
        {formatNumber(items.length)} élément(s) · {formatNumber(files.length)} fichier(s)
        {folders.length > 0 ? ` · ${folders.length} dossier(s)` : ''}
      </div>
    </div>
  );
}

function FileCard({
  entry,
  change,
  height,
  thumbSize,
}: {
  entry: FileEntry;
  change?: ChangeRecord;
  height: number;
  thumbSize: number;
}) {
  const state = useApp();
  const store = useStore();
  const selected = state.selected?.relPath === entry.relPath;
  return (
    <div
      className={`grid-card ${selected ? 'selected' : ''} ${change ? `state-${change.status}` : ''}`}
      style={{ height }}
      onClick={() => void store.selectFile(entry)}
      onDoubleClick={() => void store.openEntry(entry)}
      title={entry.relPath}
    >
      <div className="card-thumb" style={{ height: thumbSize }}>
        <Thumb entry={entry} size={thumbSize} />
        <StatusDots change={change} />
        {entry.animated ? <span className="badge badge-warn anim">animé</span> : null}
      </div>
      <span className="card-name">{entry.name}</span>
      <span className="card-meta">
        {entry.ext.toUpperCase()}
        {entry.width && entry.height ? ` · ${entry.width}×${entry.height}` : ''}
        <span> · {formatBytes(entry.size)}</span>
      </span>
      <span className={`card-edit ${entry.editability}`}>
        {entry.editability === 'image' ? 'Éditable' : entry.editability === 'text' ? 'Texte' : 'Lecture seule'}
      </span>
    </div>
  );
}

function FileListRow({
  entry,
  change,
  rowHeight,
}: {
  entry: FileEntry;
  change?: ChangeRecord;
  rowHeight: number;
}) {
  const state = useApp();
  const store = useStore();
  const selected = state.selected?.relPath === entry.relPath;
  return (
    <div
      className={`list-row ${selected ? 'selected' : ''}`}
      style={{ height: rowHeight }}
      onClick={() => void store.selectFile(entry)}
      onDoubleClick={() => void store.openEntry(entry)}
      title={entry.relPath}
    >
      <span className="col-name">
        <span className={`file-icon ${entry.editability}`}>
          {entry.image ? <IconImage size={15} /> : <IconFile size={15} />}
        </span>
        <span className="name-text">{entry.name}</span>
        <StatusDots change={change} />
      </span>
      <span className="col-type">{KIND_LABELS[entry.kind]}{entry.ext ? ` · ${entry.ext}` : ''}</span>
      <span className="col-dims">
        {entry.width && entry.height ? `${entry.width} × ${entry.height}` : entry.image ? '—' : '—'}
      </span>
      <span className="col-size">{formatBytes(entry.size)}</span>
      <span className="col-date">{formatDate(entry.mtimeMs)}</span>
      <span className="col-status">
        {entry.editability === 'image' ? <span className="badge badge-accent">éditable</span> : null}
      </span>
    </div>
  );
}

function EmptyFolder() {
  const state = useApp();
  return (
    <div className="empty-state">
      <IconFolderOpen size={42} />
      <h3>Ce dossier est vide</h3>
      <p className="muted">
        {state.showNonImages
          ? 'Aucun fichier à afficher ici.'
          : 'Aucune image ici. Désactivez « Images seulement » pour voir les autres fichiers.'}
      </p>
    </div>
  );
}

export function SearchResults() {
  const state = useApp();
  const store = useStore();
  const result = state.searchResult;

  if (state.searchLoading && !result) {
    return (
      <div className="search-results">
        <div className="empty-state">
          <IconSearch size={36} />
          <p>Recherche dans tout le projet…</p>
        </div>
      </div>
    );
  }
  if (!result) {
    return (
      <div className="search-results">
        <div className="empty-state">
          <IconSearch size={40} />
          <h3>Rechercher dans tout le projet</h3>
          <p className="muted">
            Tapez un nom de fichier, un fragment de chemin, ou un motif avec joker (<code>*.png</code>).
            Les résultats incluent les dossiers imbriqués, les filtres et les fichiers modifiés.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="search-results">
      <div className="search-results-head">
        <div>
          <h2>
            {result.total} résultat(s) {result.query ? <>pour « {result.query} »</> : <>avec les filtres actifs</>}
          </h2>
          <p className="muted">
            {result.durationMs} ms · {result.truncated ? `affichage des ${result.hits.length} premiers` : 'tous les résultats affichés'}
          </p>
        </div>
        <button
          type="button"
          className="btn ghost compact"
          onClick={() => {
            store.setSearchQuery('');
            store.setSearchExt('');
            store.setSearchKind('all');
            store.setSearchModifiedOnly(false);
            store.setSidebarTab('tree');
          }}
        >
          Effacer la recherche
        </button>
      </div>
      {result.hits.length === 0 ? (
        <div className="empty-state">
          <IconWarning size={34} />
          <h3>Aucun fichier trouvé</h3>
          <p className="muted">Essayez un autre nom, retirez un filtre ou vérifiez l’orthographe.</p>
        </div>
      ) : (
        <div className="search-list">
          {result.hits.map((hit: SearchHit) => {
            const change = changeFor(state.view?.changes, hit.relPath);
            return (
              <div
                key={hit.relPath}
                className={`search-row ${state.selected?.relPath === hit.relPath ? 'selected' : ''}`}
                onClick={() => void store.revealSearchHit(hit)}
                onDoubleClick={() => void store.revealSearchHit(hit)}
              >
                <div className="search-thumb">
                  <Thumb
                    entry={{
                      ...hit,
                      dir: hit.dir,
                      image: hit.image,
                      editability: hit.editability,
                    }}
                    size={42}
                  />
                </div>
                <div className="search-text">
                  <strong>{hit.name}</strong>
                  <small>{hit.relPath}</small>
                </div>
                <span className="search-kind">{KIND_LABELS[hit.kind]}</span>
                <span className="search-dims">
                  {hit.width && hit.height ? `${hit.width}×${hit.height}` : '—'}
                </span>
                <span className="search-size">{formatBytes(hit.size)}</span>
                <span className="search-badges">
                  {hit.modified ? <span className="badge badge-accent">modifié</span> : null}
                  {hit.excluded ? <span className="badge badge-muted">exclu</span> : null}
                  {change?.error ? <span className="badge badge-warn">source changée</span> : null}
                </span>
                <button
                  type="button"
                  className="btn tiny"
                  onClick={(event) => {
                    event.stopPropagation();
                    void store.openByPath(hit.relPath);
                  }}
                >
                  Ouvrir
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
