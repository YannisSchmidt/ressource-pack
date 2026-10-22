import { useApp, useStore } from '../store';
import { formatBytes, formatNumber } from '../utils';
import { IconCheck, IconClose, IconInfo } from '../icons';

export function StatusBar() {
  const state = useApp();
  const store = useStore();
  const view = state.view;
  if (!view) return null;
  const task = state.activeTaskId ? state.tasks[state.activeTaskId] : undefined;
  const running = task?.status === 'running';
  const percent = task && task.total > 0 ? Math.min(100, Math.round((task.current / task.total) * 100)) : undefined;
  const activeTab = state.tabs.find((tab) => tab.relPath === state.activeTab);

  return (
    <footer className="statusbar">
      <div className="status-left">
        {state.info?.demo ? <span className="pill demo">DÉMO</span> : <span className="pill">LOCAL</span>}
        <span className="muted">
          {view.source.type === 'zip' ? 'Archive' : 'Dossier'} · {formatNumber(view.stats.fileCount)} fichiers ·{' '}
          {formatBytes(view.stats.totalBytes)}
        </span>
      </div>

      <div className="status-center">
        {running ? (
          <div className="task-inline">
            <span>{task.label}</span>
            {percent !== undefined ? (
              <span className="progress mini">
                <span style={{ width: `${percent}%` }} />
              </span>
            ) : (
              <span className="progress mini indeterminate">
                <span />
              </span>
            )}
            <span className="muted">{percent !== undefined ? `${percent}%` : `${formatNumber(task.current)}`}</span>
            <button type="button" className="icon-btn tiny" title="Annuler" onClick={() => void store.cancelTask(task.id)}>
              <IconClose size={13} />
            </button>
          </div>
        ) : (
          <span className="status-message">
            {activeTab ? activeTab.relPath : state.status}
          </span>
        )}
      </div>

      <div className="status-right">
        <span className={`save-state ${state.saveState}`}>
          {state.saveState === 'saved' ? (
            <>
              <IconCheck size={13} /> Enregistré
            </>
          ) : state.saveState === 'saving' ? (
            <>Enregistrement…</>
          ) : (
            <>Modifications non enregistrées</>
          )}
        </span>
        <span className="badge badge-accent" title="Fichiers modifiés dans le projet">
          {view.stats.modifiedCount} modifié(s)
        </span>
        {view.stats.excludedCount > 0 ? (
          <span className="badge badge-muted" title="Modifications exclues du pack">
            {view.stats.excludedCount} exclu(s)
          </span>
        ) : null}
        <button type="button" className="icon-btn tiny" title="Aide" onClick={() => store.openModal({ type: 'help' })}>
          <IconInfo size={14} />
        </button>
      </div>
    </footer>
  );
}
