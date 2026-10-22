import { useState } from 'react';
import type { SourceType } from '../../shared/types';
import { PACK_FORMAT_SOURCE } from '../../shared/packFormats';
import { useApp, useStore } from '../store';
import { Modal } from './Modal';
import { ExportModal } from './ExportModal';
import {
  IconCheck,
  IconExport,
  IconFolder,
  IconFolderOpen,
  IconInfo,
  IconPlus,
  IconTrash,
  IconWarning,
} from '../icons';
import { formatDate, formatNumber } from '../utils';

function osBasename(target: string): string {
  const parts = target.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? target;
}

export function NewProjectModal() {
  const state = useApp();
  const store = useStore();
  const sources = state.info?.demoSources ?? [];
  const first = sources[0];
  const [sourcePath, setSourcePath] = useState(first?.path ?? '');
  const [sourceType, setSourceType] = useState<SourceType>(first?.type ?? 'directory');
  const [name, setName] = useState(first ? osBasename(first.path).replace(/\.zip$/i, '') : 'MonResourcePack');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');

  const choose = async (kind: 'directory' | 'zip'): Promise<void> => {
    const picked = await store.chooseSource(kind);
    if (!picked) return;
    setSourcePath(picked);
    setSourceType(kind);
    setError('');
    if (!touched) setName(osBasename(picked).replace(/\.zip$/i, '') || 'MonResourcePack');
  };

  const task = state.activeTaskId ? state.tasks[state.activeTaskId] : undefined;
  const canCreate = Boolean(sourcePath) && task?.status !== 'running';

  return (
    <Modal
      title="Créer un projet"
      subtitle="Importez un dossier de ressources Minecraft (ou compatible) ou une archive ZIP. Les fichiers sources ne seront jamais modifiés."
      onClose={() => store.closeModal()}
      size="large"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={() => store.closeModal()}>
            Annuler
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!canCreate}
            onClick={() => {
              if (!sourcePath) {
                setError('Choisissez d’abord une source.');
                return;
              }
              void store.createProject(sourcePath, sourceType, name.trim() || 'MonResourcePack');
            }}
          >
            <IconPlus size={16} /> Importer et créer le projet
          </button>
        </>
      }
    >
      <div className="form-stack">
        <label className="field">
          <span>Nom du projet</span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setTouched(true);
            }}
            placeholder="MonResourcePack"
          />
        </label>

        {state.info?.demo ? (
          <div className="field">
            <span>Source de démonstration</span>
            <div className="source-options">
              {sources.map((source) => (
                <button
                  key={source.path}
                  type="button"
                  className={`source-option ${sourcePath === source.path ? 'selected' : ''}`}
                  onClick={() => {
                    setSourcePath(source.path);
                    setSourceType(source.type);
                    setError('');
                    if (!touched) setName(osBasename(source.path).replace(/\.zip$/i, ''));
                  }}
                >
                  <span className="source-option-icon">
                    {source.type === 'zip' ? <IconExport size={18} /> : <IconFolder size={18} />}
                  </span>
                  <span>
                    <strong>{source.label}</strong>
                    <small>{source.description}</small>
                  </span>
                  {sourcePath === source.path ? <IconCheck size={16} /> : null}
                </button>
              ))}
            </div>
            <p className="tool-hint">
              L’aperçu web utilise un jeu de ressources fictif généré localement. L’application desktop permet
              d’ouvrir n’importe quel dossier ou ZIP de votre ordinateur.
            </p>
          </div>
        ) : (
          <div className="field">
            <span>Source à importer</span>
            <div className="source-buttons">
              <button type="button" className="btn" onClick={() => void choose('directory')}>
                <IconFolderOpen size={16} /> Choisir un dossier…
              </button>
              <button type="button" className="btn" onClick={() => void choose('zip')}>
                <IconExport size={16} /> Choisir une archive ZIP…
              </button>
            </div>
            <p className="path-display">{sourcePath || 'Aucune source sélectionnée'}</p>
            {sourcePath ? (
              <p className="tool-hint">Type détecté : {sourceType === 'zip' ? 'archive ZIP' : 'dossier'}</p>
            ) : null}
          </div>
        )}

        <div className="alert alert-info small">
          <IconInfo size={15} />
          <span>
            L’application indexe les noms, tailles et extensions sans charger toutes les images en mémoire. Les PNG
            restent dans votre dossier d’origine : les modifications sont stockées dans le projet.
          </span>
        </div>

        {error ? (
          <div className="alert alert-error small">
            <IconWarning size={15} /> {error}
          </div>
        ) : null}

        {task && task.status === 'running' ? (
          <div className="task-box">
            <strong>{task.label}</strong>
            <div className={`progress ${task.total === 0 ? 'indeterminate' : ''}`}>
              <span style={{ width: task.total > 0 ? `${Math.round((task.current / task.total) * 100)}%` : undefined }} />
            </div>
            <span className="muted">{task.detail ?? 'Analyse…'}</span>
            <button type="button" className="btn tiny ghost" onClick={() => void store.cancelTask(task.id)}>
              Annuler l’importation
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export function ProjectsModal() {
  const state = useApp();
  const store = useStore();
  const projects = state.info?.projects ?? [];
  return (
    <Modal
      title="Projets"
      subtitle="Chaque projet conserve la source, les copies de travail et la configuration du pack."
      onClose={() => store.closeModal()}
      size="large"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={() => store.closeModal()}>
            Fermer
          </button>
          <button type="button" className="btn primary" onClick={() => store.openModal({ type: 'new-project' })}>
            <IconPlus size={16} /> Nouveau projet
          </button>
        </>
      }
    >
      {projects.length === 0 ? (
        <p className="empty-note">Aucun projet enregistré.</p>
      ) : (
        <div className="project-list">
          {projects.map((project) => (
            <div key={project.id} className={`project-row ${state.view?.id === project.id ? 'current' : ''}`}>
              <div className="project-main">
                <IconFolderOpen size={18} />
                <div>
                  <strong>
                    {project.name} {state.view?.id === project.id ? <span className="badge badge-accent">ouvert</span> : null}
                  </strong>
                  <small title={project.source.path}>{project.source.path}</small>
                  <small className="muted">
                    {project.source.type === 'zip' ? 'Archive' : 'Dossier'} ·{' '}
                    {formatNumber(project.source.fileCount)} fichiers · {project.modifiedCount} modification(s) ·{' '}
                    {formatDate(new Date(project.updatedAt).getTime())}
                  </small>
                </div>
              </div>
              <div className="project-actions">
                <button
                  type="button"
                  className="btn tiny primary"
                  onClick={async () => {
                    await store.openProject(project.id);
                    store.closeModal();
                  }}
                >
                  Ouvrir
                </button>
                <button
                  type="button"
                  className="icon-btn danger-hover"
                  title="Supprimer le projet (les fichiers sources restent intacts)"
                  onClick={() => store.openModal({ type: 'delete-project', id: project.id, name: project.name })}
                >
                  <IconTrash size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {state.view ? (
        <div className="modal-extra-actions">
          <button type="button" className="btn ghost" onClick={() => void store.closeProject()}>
            Fermer le projet actuel
          </button>
        </div>
      ) : null}
    </Modal>
  );
}

export function DeleteProjectModal({ id, name }: { id: string; name: string }) {
  const store = useStore();
  return (
    <Modal
      title="Supprimer le projet ?"
      onClose={() => store.closeModal()}
      size="small"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={() => store.closeModal()}>
            Annuler
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={async () => {
              await store.deleteProject(id);
              store.closeModal();
            }}
          >
            <IconTrash size={15} /> Supprimer « {name} »
          </button>
        </>
      }
    >
      <p>
        Le projet <strong>{name}</strong> et ses copies de travail seront supprimés. Les fichiers sources importés ne
        seront <strong>jamais</strong> supprimés ni modifiés.
      </p>
    </Modal>
  );
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirmer',
  danger,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={() => store.closeModal()}
      size="small"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={() => store.closeModal()} disabled={busy}>
            Annuler
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'danger' : 'primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                store.closeModal();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Opération…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-message">{message}</p>
    </Modal>
  );
}

export function SettingsModal() {
  const state = useApp();
  const store = useStore();
  const settings = state.settings;
  const [autosave, setAutosave] = useState(settings?.autosave ?? true);
  const [showNonImages, setShowNonImages] = useState(settings?.showNonImages ?? true);
  const [thumbnailSize, setThumbnailSize] = useState(settings?.thumbnailSize ?? 'medium');
  const [minecraftDir, setMinecraftDir] = useState(settings?.minecraftDirOverride ?? '');
  const [saving, setSaving] = useState(false);

  return (
    <Modal
      title="Paramètres"
      subtitle="Préférences locales de l’atelier. Aucune donnée n’est envoyée sur Internet."
      onClose={() => store.closeModal()}
      size="medium"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={() => store.closeModal()}>
            Annuler
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await store.saveOptions({
                autosave,
                showNonImages,
                thumbnailSize: thumbnailSize as 'small' | 'medium' | 'large',
                minecraftDirOverride: minecraftDir.trim() || undefined,
              });
              setSaving(false);
              store.closeModal();
            }}
          >
            Enregistrer les préférences
          </button>
        </>
      }
    >
      <div className="form-stack">
        <label className="checkbox-row">
          <input type="checkbox" checked={autosave} onChange={(event) => setAutosave(event.target.checked)} />
          Sauvegarde automatique des modifications (1 seconde d’inactivité)
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={showNonImages} onChange={(event) => setShowNonImages(event.target.checked)} />
          Afficher par défaut les fichiers qui ne sont pas des images
        </label>
        <label className="field">
          <span>Taille des miniatures</span>
          <select value={thumbnailSize} onChange={(event) => setThumbnailSize(event.target.value as 'small' | 'medium' | 'large')}>
            <option value="small">Petite</option>
            <option value="medium">Moyenne</option>
            <option value="large">Grande</option>
          </select>
        </label>
        <label className="field">
          <span>Dossier « resourcepacks » de Minecraft (facultatif)</span>
          <input
            value={minecraftDir}
            onChange={(event) => setMinecraftDir(event.target.value)}
            placeholder={state.info?.minecraftResourcePacks ?? '%APPDATA%\\.minecraft\\resourcepacks'}
          />
        </label>
        <p className="tool-hint">
          Détection automatique : {state.info?.minecraftResourcePacks ?? 'non détecté sur cette machine'}.
        </p>
        <div className="settings-actions">
          {state.info?.minecraftResourcePacks ? (
            <button type="button" className="btn tiny" onClick={() => void store.openPath(state.info!.minecraftResourcePacks!)}>
              <IconFolderOpen size={14} /> Ouvrir le dossier resourcepacks
            </button>
          ) : null}
          <button type="button" className="btn tiny" onClick={() => void store.openPath(state.info!.userDataDir)}>
            <IconFolderOpen size={14} /> Ouvrir le dossier de données
          </button>
        </div>
        <div className="info-table">
          <div className="info-row">
            <span className="info-label">Version</span>
            <span className="info-value">{state.info?.version}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Plateforme</span>
            <span className="info-value">{state.info?.platform}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Mode</span>
            <span className="info-value">{state.info?.demo ? 'Aperçu web (démo)' : 'Application desktop'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Données</span>
            <span className="info-value mono">{state.info?.userDataDir}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function HelpModal() {
  const store = useStore();
  const shortcuts: [string, string][] = [
    ['Ctrl + S', 'Enregistrer l’onglet actif dans le projet'],
    ['Ctrl + Z / Ctrl + Y', 'Annuler / rétablir'],
    ['Ctrl + O', 'Ouvrir la liste des projets'],
    ['Ctrl + E', 'Configurer et exporter le pack'],
    ['Ctrl + K', 'Aller à la recherche'],
    ['B / E / I / G / M', 'Crayon / Gomme / Pipette / Remplir / Sélection'],
    ['Ctrl + C / X / V', 'Copier / couper / coller la sélection'],
    ['Suppr', 'Effacer la sélection'],
    ['Molette', 'Zoom dans l’éditeur'],
    ['Espace + glisser', 'Déplacer l’image dans l’éditeur'],
    ['Ctrl + 0 / Ctrl + 1', 'Ajuster / échelle réelle'],
    ['F1', 'Cette aide'],
  ];
  return (
    <Modal title="Guide & raccourcis" subtitle="Workflow, fonctionnement local et limites connues." onClose={() => store.closeModal()} size="large">
      <div className="help-grid">
        <section>
          <h3>Workflow</h3>
          <ol className="help-list">
            <li>Créez un projet depuis un dossier de ressources ou une archive ZIP.</li>
            <li>Naviguez dans l’arborescence ou recherchez une texture.</li>
            <li>Double-cliquez sur une texture PNG pour l’éditer.</li>
            <li>Enregistrez : la modification rejoint le projet sous son chemin relatif exact.</li>
            <li>Configurez le nom, la description, la version et l’icône, puis exportez en dossier ou ZIP.</li>
          </ol>
          <h3>Ce qui est exporté</h3>
          <ul className="help-list">
            <li>Uniquement les fichiers modifiés et actifs.</li>
            <li><code>pack.mcmeta</code> généré pour la version cible.</li>
            <li><code>pack.png</code> si une icône a été choisie.</li>
            <li>Aucun fichier original non modifié, aucun dossier vide, aucun fichier factice.</li>
          </ul>
          <h3>Formats</h3>
          <ul className="help-list">
            <li>Les textures PNG statiques sont entièrement éditables (pixels, résolution, alpha).</li>
            <li>Les fichiers JSON, <code>.mcmeta</code>, <code>.lang</code>, sons, shaders texte sont éditables comme texte.</li>
            <li>Les JPEG, GIF, BMP, WebP et TGA sont indexés et affichés, mais non réécrits pour éviter toute corruption.</li>
            <li>Les PNG animés (APNG) sont signalés et protégés en lecture seule.</li>
          </ul>
        </section>
        <section>
          <h3>Raccourcis</h3>
          <table className="shortcut-table">
            <tbody>
              {shortcuts.map(([keys, description]) => (
                <tr key={keys}>
                  <td><kbd>{keys}</kbd></td>
                  <td>{description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="alert alert-info small">
            <IconInfo size={15} />
            <span>
              Les sources sont ouvertes en lecture seule. Les modifications sont stockées dans le dossier de données
              de l’application et ne touchent jamais les fichiers d’origine.
            </span>
          </div>
          <h3>Compatibilité pack.mcmeta</h3>
          <p className="help-note">
            La table est issue de {PACK_FORMAT_SOURCE.title}, relevée le {PACK_FORMAT_SOURCE.checkedAt}. Depuis Minecraft
            1.21.9, les champs <code>min_format</code> et <code>max_format</code> remplacent le <code>pack_format</code>{' '}
            seul. L’application génère les champs adaptés et n’affirme jamais une compatibilité non vérifiée : les
            versions personnalisées sont acceptées avec un avertissement.
          </p>
          <p className="help-note">
            Vérification dans le jeu : importez le pack exporté dans <code>resourcepacks</code>, activez-le dans
            Options → Packs de ressources. Un test automatique dans Minecraft n’est pas possible sans le jeu installé.
          </p>
        </section>
      </div>
    </Modal>
  );
}

export function ModalHost() {
  const state = useApp();
  const modal = state.modal;
  if (!modal) return null;
  switch (modal.type) {
    case 'new-project':
      return <NewProjectModal />;
    case 'projects':
      return <ProjectsModal />;
    case 'settings':
      return <SettingsModal />;
    case 'help':
      return <HelpModal />;
    case 'delete-project':
      return <DeleteProjectModal id={modal.id} name={modal.name} />;
    case 'confirm':
      return (
        <ConfirmModal
          title={modal.title}
          message={modal.message}
          confirmLabel={modal.confirmLabel}
          danger={modal.danger}
          onConfirm={modal.onConfirm}
        />
      );
    case 'export':
      return <ExportModal />;
    default:
      return null;
  }
}
