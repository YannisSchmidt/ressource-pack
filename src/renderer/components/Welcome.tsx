import { useApp, useStore } from '../store';
import { formatBytes, formatDate, formatNumber } from '../utils';
import {
  IconExport,
  IconFolderOpen,
  IconInfo,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
  IconWarning,
} from '../icons';

export function Welcome() {
  const state = useApp();
  const store = useStore();
  const info = state.info;
  const projects = info?.projects ?? [];

  return (
    <div className="welcome">
      <div className="welcome-glow" />
      <div className="welcome-inner">
        <div className="brand-large">
          <div className="brand-mark">RP</div>
          <div>
            <h1>Atelier Resource Pack</h1>
            <p className="welcome-subtitle">
              Créez des resource packs Minecraft Java Edition à partir des fichiers du jeu.
              Seules vos textures modifiées seront exportées.
            </p>
          </div>
        </div>

        {state.bootError ? (
          <div className="alert alert-error">
            <IconWarning size={18} />
            <div>
              <strong>Le service local ne répond pas.</strong>
              <p>{state.bootError}</p>
            </div>
          </div>
        ) : null}

        {info?.demo ? (
          <div className="alert alert-info">
            <IconInfo size={18} />
            <div>
              <strong>Aperçu web de démonstration</strong>
              <p>
                Vous explorez un jeu de ressources fictif généré localement ({projects.length} projet(s)). Pour
                ouvrir vos propres fichiers Minecraft, utilisez l’application desktop
                (<code>npm run dev:desktop</code>).
              </p>
            </div>
          </div>
        ) : null}

        <div className="welcome-actions">
          <button type="button" className="btn primary large" onClick={() => store.openModal({ type: 'new-project' })}>
            <IconPlus size={18} /> Créer un projet
          </button>
          <button
            type="button"
            className="btn large"
            onClick={() => store.openModal({ type: 'projects' })}
            disabled={projects.length === 0}
          >
            <IconFolderOpen size={18} /> Ouvrir un projet
          </button>
          <button type="button" className="btn ghost large" onClick={() => store.openModal({ type: 'help' })}>
            Guide & raccourcis
          </button>
        </div>

        <div className="welcome-grid">
          <section className="panel welcome-features">
            <h2>Un vrai atelier, pas un aperçu</h2>
            <ul className="feature-list">
              <li>
                <IconFolderOpen size={16} /> Import d’un dossier Minecraft ou d’une archive ZIP, navigation
                récursive illimitée.
              </li>
              <li>
                <IconSearch size={16} /> Recherche instantanée dans des milliers de fichiers.
              </li>
              <li>
                <IconPencil size={16} /> Éditeur pixel art : crayon, gomme, pipette, remplissage, sélections,
                rotations, redimensionnement.
              </li>
              <li>
                <IconExport size={16} /> Export sélectif : uniquement les fichiers modifiés + <code>pack.mcmeta</code>.
              </li>
            </ul>
            <div className="welcome-note">
              <IconInfo size={15} /> Les fichiers sources sont ouverts en lecture seule et ne sont jamais modifiés.
            </div>
          </section>

          <section className="panel welcome-recent">
            <div className="panel-heading">
              <h2>Projets récents</h2>
              <span className="muted">{projects.length}</span>
            </div>
            {projects.length === 0 ? (
              <p className="empty-note">Aucun projet pour le moment. Créez-en un pour commencer.</p>
            ) : (
              <ul className="recent-list">
                {projects.slice(0, 5).map((project) => (
                  <li key={project.id}>
                    <button type="button" className="recent-item" onClick={() => void store.openProject(project.id)}>
                      <span className="recent-icon">
                        <IconFolderOpen size={18} />
                      </span>
                      <span className="recent-text">
                        <strong>{project.name}</strong>
                        <small>
                          {project.source.type === 'zip' ? 'Archive' : 'Dossier'} ·{' '}
                          {formatNumber(project.source.fileCount)} fichiers ·{' '}
                          {formatBytes(project.source.totalBytes)}
                        </small>
                        <small className="muted">
                          Modifié le {formatDate(new Date(project.updatedAt).getTime())} ·{' '}
                          {project.modifiedCount} modification(s)
                        </small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger-hover"
                      title="Supprimer ce projet (les sources restent intactes)"
                      onClick={() => store.openModal({ type: 'delete-project', id: project.id, name: project.name })}
                    >
                      <IconTrash size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="welcome-footer">
          <span>Version {info?.version ?? '—'} · 100 % local, aucune donnée envoyée sur Internet</span>
          <span className="muted">{info?.userDataDir}</span>
        </footer>
      </div>
    </div>
  );
}
