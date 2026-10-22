import { useMemo } from 'react';
import type { TextTab } from '../store';
import { useApp, useStore } from '../store';
import { IconCheck, IconRefresh, IconSave, IconUndo, IconWarning } from '../icons';
import { formatBytes } from '../utils';

export function TextEditor({ tab }: { tab: TextTab }) {
  const state = useApp();
  const store = useStore();
  const jsonCheck = useMemo(() => {
    if (!['json', 'mcmeta'].includes(tab.relPath.split('.').pop() ?? '')) return { checked: false, error: '' };
    try {
      JSON.parse(tab.text);
      return { checked: true, error: '' };
    } catch (error) {
      return { checked: true, error: error instanceof Error ? error.message : String(error) };
    }
  }, [tab.text, tab.relPath]);
  const change = state.view?.changes.find((candidate) => candidate.relPath === tab.relPath);
  const lineCount = tab.text.split('\n').length;

  return (
    <div className="text-editor">
      <div className="text-toolbar">
        <span className="file-chip">
          <strong>{tab.name}</strong>
          <small>{tab.relPath}</small>
        </span>
        <span className={`badge ${change?.status === 'modified' ? 'badge-accent' : 'badge-muted'}`}>
          {change?.status === 'modified' ? 'modifié' : change?.status === 'excluded' ? 'exclu' : 'original'}
        </span>
        {jsonCheck.checked ? (
          jsonCheck.error ? (
            <span className="badge badge-error" title={jsonCheck.error}>
              <IconWarning size={12} /> JSON invalide
            </span>
          ) : (
            <span className="badge badge-success">
              <IconCheck size={12} /> JSON valide
            </span>
          )
        ) : null}
        <span className="toolbar-spacer" />
        <button
          type="button"
          className="btn tiny ghost"
          disabled={!tab.editable}
          onClick={() => store.updateText(tab.relPath, tab.originalText)}
          title="Remettre dans l’éditeur le contenu du fichier source"
        >
          <IconUndo size={14} /> Contenu d’origine
        </button>
        <button type="button" className="btn tiny ghost" onClick={() => void store.reloadTextTab(tab.relPath)}>
          <IconRefresh size={14} /> Recharger
        </button>
        <button
          type="button"
          className="btn tiny primary"
          disabled={!tab.editable || tab.saving}
          onClick={() => void store.saveTab(tab.relPath)}
        >
          <IconSave size={14} /> {tab.saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
      {tab.message ? (
        <div className="alert alert-warning small">
          <IconWarning size={15} /> {tab.message}
        </div>
      ) : null}
      {jsonCheck.error ? (
        <div className="alert alert-error small">
          <IconWarning size={15} /> JSON invalide : {jsonCheck.error}. Minecraft ne lira pas ce fichier.
        </div>
      ) : null}
      <div className="text-area-wrap">
        <div className="line-numbers" aria-hidden="true">
          {Array.from({ length: Math.min(2000, lineCount) }, (_, index) => (
            <span key={index}>{index + 1}</span>
          ))}
        </div>
        <textarea
          className="text-area"
          value={tab.text}
          spellCheck={false}
          readOnly={!tab.editable}
          onChange={(event) => store.updateText(tab.relPath, event.target.value)}
          aria-label={`Contenu de ${tab.name}`}
        />
      </div>
      <div className="text-status">
        <span>
          {lineCount} ligne(s) · {formatBytes(new Blob([tab.text]).size)}
        </span>
        <span className="muted">UTF-8</span>
        <span className={tab.dirty ? 'dirty-text' : 'muted'}>
          {tab.dirty ? 'Non enregistré — Ctrl+S' : 'Enregistré dans le projet'}
        </span>
      </div>
    </div>
  );
}
