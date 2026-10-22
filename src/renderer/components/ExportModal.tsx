import { useEffect, useMemo, useState } from 'react';
import type { ExportConfig, PackSettings } from '../../shared/types';
import {
  findPackVersion,
  PACK_FORMATS,
  PACK_FORMAT_SOURCE,
  resolvePackVersion,
} from '../../shared/packFormats';
import { useApp, useStore } from '../store';
import { Modal } from './Modal';
import {
  IconCheck,
  IconExport,
  IconFolderOpen,
  IconInfo,
  IconWarning,
} from '../icons';
import { formatBytes, osDirname } from '../utils';

interface ExportForm {
  name: string;
  description: string;
  targetVersion: string;
  custom: boolean;
  customMajor: number;
  customMinor: number;
  format: 'folder' | 'zip';
  outputDir: string;
  outputName: string;
}

function initialForm(pack: PackSettings): ExportForm {
  const known = findPackVersion(pack.targetVersion);
  const match = /^custom:(\d+)(?:\.(\d+))?$/.exec(pack.targetVersion);
  return {
    name: pack.name,
    description: pack.description,
    targetVersion: known ? known.id : '1.21.9',
    custom: !known,
    customMajor: match ? Number(match[1]) : pack.customFormat?.major ?? 69,
    customMinor: match && match[2] ? Number(match[2]) : pack.customFormat?.minor ?? 0,
    format: pack.format,
    outputDir: pack.outputDir ?? '',
    outputName: pack.outputName ?? pack.name,
  };
}

export function ExportModal() {
  const state = useApp();
  const store = useStore();
  const view = state.view;
  const [form, setForm] = useState<ExportForm>(() => initialForm(view!.pack));
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [overwritePrompt, setOverwritePrompt] = useState<{ suggestedName: string; outputPath: string } | null>(null);
  const [localError, setLocalError] = useState('');

  const preview = state.exportPreview;
  const report = state.exportReport;
  const task = state.activeTaskId ? state.tasks[state.activeTaskId] : undefined;
  const running = task?.status === 'running';

  useEffect(() => {
    if (view?.pack.icon) void store.loadIconPreview();
  }, [view?.id, view?.pack.icon, store]);

  const patch = (value: Partial<ExportForm>): void => {
    setForm((current) => ({ ...current, ...value }));
    setOverwritePrompt(null);
  };

  const targetVersion = form.custom
    ? `custom:${Math.max(1, Math.trunc(form.customMajor || 1))}${form.customMinor ? `.${Math.max(0, Math.trunc(form.customMinor))}` : ''}`
    : form.targetVersion;

  const config: ExportConfig = useMemo(
    () => ({
      name: form.name,
      description: form.description,
      targetVersion,
      customFormat: form.custom ? { major: form.customMajor, minor: form.customMinor } : undefined,
      format: form.format,
      outputDir: form.outputDir,
      outputName: form.outputName || form.name,
    }),
    [form, targetVersion],
  );

  useEffect(() => {
    if (!form.outputDir || !view) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      await store.previewExport(config);
      if (!cancelled) setLoading(false);
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    form.name,
    form.description,
    form.targetVersion,
    form.custom,
    form.customMajor,
    form.customMinor,
    form.format,
    form.outputDir,
    form.outputName,
    view?.id,
    store,
  ]);

  const versionInfo = (() => {
    try {
      return resolvePackVersion(targetVersion, form.custom ? { major: form.customMajor, minor: form.customMinor } : undefined);
    } catch (error) {
      return { version: undefined, warnings: [error instanceof Error ? error.message : String(error)] };
    }
  })();

  const runExport = async (formValue: ExportForm, overwrite: boolean): Promise<void> => {
    setBusy(true);
    setLocalError('');
    const cfg: ExportConfig = {
      name: formValue.name,
      description: formValue.description,
      targetVersion: formValue.custom
        ? `custom:${Math.max(1, Math.trunc(formValue.customMajor || 1))}${formValue.customMinor ? `.${formValue.customMinor}` : ''}`
        : formValue.targetVersion,
      customFormat: formValue.custom ? { major: formValue.customMajor, minor: formValue.customMinor } : undefined,
      format: formValue.format,
      outputDir: formValue.outputDir,
      outputName: formValue.outputName || formValue.name,
      overwrite,
    };
    const result = await store.runExport(cfg);
    setBusy(false);
    if (result && 'needsOverwrite' in result && result.needsOverwrite) {
      setOverwritePrompt({
        suggestedName: result.suggestedName ?? `${formValue.outputName} (2)`,
        outputPath: result.outputPath ?? '',
      });
    }
  };

  if (!view) return null;

  if (report) {
    return (
      <Modal
        title="Resource pack exporté"
        subtitle="Le projet reste ouvert : vos modifications de travail sont conservées."
        onClose={() => store.closeModal()}
        size="large"
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => store.clearExport()}>
              Exporter à nouveau
            </button>
            <button type="button" className="btn primary" onClick={() => store.closeModal()}>
              Fermer
            </button>
          </>
        }
      >
        <div className="export-success">
          <div className="success-icon">
            <IconCheck size={26} />
          </div>
          <div>
            <h3>Export terminé et vérifié</h3>
            <p className="path-display">{report.outputPath}</p>
            <p className="muted">
              {report.fileCount} fichier(s) · {formatBytes(report.totalBytes)} · {report.format === 'zip' ? 'archive ZIP' : 'dossier'} ·{' '}
              {report.verified ? 'structure vérifiée' : 'vérification incomplète'}
            </p>
          </div>
        </div>

        <div className="report-grid">
          <section className="summary-card">
            <header>Contenu exact</header>
            <ul className="file-list">
              {report.files.map((file) => (
                <li key={file}>
                  <span className="mono">{file}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="summary-card">
            <header>Vérifications</header>
            <ul className="verification-list">
              {report.verification.map((message) => (
                <li key={message}>
                  <IconCheck size={13} /> {message}
                </li>
              ))}
            </ul>
            {report.warnings.length > 0 ? (
              <>
                <header>Avertissements</header>
                <ul className="warning-list">
                  {report.warnings.map((warning) => (
                    <li key={warning.code + warning.message}>
                      <IconWarning size={13} /> {warning.message}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        </div>

        <div className="report-actions">
          <button type="button" className="btn" onClick={() => void store.openPath(osDirname(report.outputPath))}>
            <IconFolderOpen size={15} /> Ouvrir le dossier de destination
          </button>
          {state.info?.minecraftResourcePacks ? (
            <button type="button" className="btn" onClick={() => void store.openPath(state.info!.minecraftResourcePacks!)}>
              <IconFolderOpen size={15} /> Ouvrir le dossier resourcepacks de Minecraft
            </button>
          ) : (
            <span className="tool-hint">Dossier resourcepacks non détecté sur cette machine.</span>
          )}
        </div>

        <details className="meta-details">
          <summary>pack.mcmeta généré</summary>
          <pre>{report.packMeta}</pre>
        </details>
      </Modal>
    );
  }

  return (
    <Modal
      title="Exporter mon resource pack"
      subtitle="Seuls les fichiers modifiés, pack.mcmeta et l’icône facultative seront inclus."
      onClose={() => store.closeModal()}
      size="wide"
      footer={
        <>
          <span className="footer-note">
            {preview ? `${preview.totalFiles} fichier(s) · ${formatBytes(preview.estimatedBytes)}` : 'Préparation…'}
            {preview?.excludedCount ? ` · ${preview.excludedCount} exclu(s)` : ''}
          </span>
          <button type="button" className="btn ghost" onClick={() => store.closeModal()}>
            Annuler
          </button>
          <button
            type="button"
            className="btn primary large"
            disabled={busy || running || loading || !preview || preview.blocked || !form.outputDir}
            onClick={() => void runExport(form, false)}
          >
            <IconExport size={17} /> {busy || running ? 'Export en cours…' : 'Exporter maintenant'}
          </button>
        </>
      }
    >
      <div className="export-layout">
        <div className="export-form">
          <div className="minecraft-preview">
            <div className="mc-pack-icon checker">
              {state.iconPreview ? (
                <img src={state.iconPreview} alt="Icône du pack" style={{ imageRendering: 'pixelated' }} />
              ) : (
                <span>pack.png</span>
              )}
            </div>
            <div className="mc-pack-text">
              <strong>{form.name || 'Sans nom'}</strong>
              <p>{form.description || 'Description affichée dans Minecraft'}</p>
              <small>
                {versionInfo.version?.label ?? targetVersion} ·{' '}
                {versionInfo.version
                  ? versionInfo.version.style === 'min_max'
                    ? `min/max ${versionInfo.version.major}.${versionInfo.version.minor}`
                    : `pack_format ${versionInfo.version.major}`
                  : 'version inconnue'}
              </small>
            </div>
          </div>

          <div className="field-row">
            <label className="field grow">
              <span>Nom du resource pack</span>
              <input value={form.name} onChange={(event) => patch({ name: event.target.value })} />
            </label>
            <label className="field">
              <span>Nom du fichier / dossier</span>
              <input value={form.outputName} onChange={(event) => patch({ outputName: event.target.value })} />
            </label>
          </div>

          <label className="field">
            <span>Description affichée dans Minecraft</span>
            <textarea
              rows={2}
              value={form.description}
              onChange={(event) => patch({ description: event.target.value })}
              placeholder="Textures personnalisées avec Atelier Resource Pack"
            />
            <small className="field-hint">{form.description.length} caractères · échappement JSON automatique</small>
          </label>

          <div className="field-row">
            <label className="field grow">
              <span>Version Minecraft ciblée</span>
              <select
                value={form.custom ? 'custom' : form.targetVersion}
                onChange={(event) => {
                  if (event.target.value === 'custom') patch({ custom: true });
                  else patch({ custom: false, targetVersion: event.target.value });
                }}
              >
                {PACK_FORMATS.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.label} — {version.style === 'min_max' ? `${version.major}.${version.minor}` : `format ${version.major}`}
                  </option>
                ))}
                <option value="custom">Version personnalisée (non vérifiée)…</option>
              </select>
            </label>
            <label className="field">
              <span>Format de sortie</span>
              <select value={form.format} onChange={(event) => patch({ format: event.target.value as 'folder' | 'zip' })}>
                <option value="zip">Archive ZIP (.zip)</option>
                <option value="folder">Dossier</option>
              </select>
            </label>
          </div>

          {form.custom ? (
            <div className="field-row">
              <label className="field">
                <span>Format majeur</span>
                <input
                  type="number"
                  min={1}
                  value={form.customMajor}
                  onChange={(event) => patch({ customMajor: Number(event.target.value) })}
                />
              </label>
              <label className="field">
                <span>Format mineur</span>
                <input
                  type="number"
                  min={0}
                  value={form.customMinor}
                  onChange={(event) => patch({ customMinor: Number(event.target.value) })}
                />
              </label>
            </div>
          ) : null}

          <div className="field">
            <span>Dossier de sortie</span>
            <div className="output-row">
              <input value={form.outputDir} readOnly placeholder="Choisissez un dossier…" />
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  const chosen = await store.chooseOutputDir();
                  if (chosen) patch({ outputDir: chosen });
                }}
              >
                <IconFolderOpen size={15} /> Parcourir…
              </button>
            </div>
            {form.outputDir ? <small className="field-hint mono">{form.outputDir}</small> : null}
          </div>

          <div className="field">
            <span>Icône du pack (facultative)</span>
            <div className="icon-row">
              {state.iconPreview ? <img className="icon-mini" src={state.iconPreview} alt="" /> : <div className="icon-mini empty">—</div>}
              <button type="button" className="btn tiny" onClick={() => void store.chooseAndSetIcon()}>
                Choisir un PNG…
              </button>
              {view.pack.icon ? (
                <button type="button" className="btn tiny ghost" onClick={() => void store.removeIcon()}>
                  Retirer
                </button>
              ) : null}
              <span className="muted">
                {view.pack.icon ? `${view.pack.icon.width} × ${view.pack.icon.height} px` : 'pack.png non inclus'}
              </span>
            </div>
            <small className="field-hint">Une icône carrée (128 × 128 px) est recommandée.</small>
          </div>

          <div className="alert alert-info small">
            <IconInfo size={15} />
            <span>
              Table de compatibilité : {PACK_FORMAT_SOURCE.title}, relevé du {PACK_FORMAT_SOURCE.checkedAt}. «{' '}
              {versionInfo.version?.label ?? 'inconnue'} »{' '}
              {versionInfo.version?.verified ? 'est vérifiée.' : 'n’est pas vérifiée : la compatibilité n’est pas garantie.'}
            </span>
          </div>

          {versionInfo.warnings.map((warning) => (
            <div key={warning} className="alert alert-warning small">
              <IconWarning size={15} /> {warning}
            </div>
          ))}
        </div>

        <div className="export-summary">
          <section className="summary-card">
            <header>Récapitulatif</header>
            <div className="info-row">
              <span className="info-label">Fichiers modifiés</span>
              <span className="info-value">{preview?.modifiedCount ?? 0}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Fichiers dans le pack</span>
              <span className="info-value">{preview?.totalFiles ?? 0}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Taille estimée</span>
              <span className="info-value">{preview ? formatBytes(preview.estimatedBytes) : '—'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Version</span>
              <span className="info-value">{preview?.versionLabel ?? versionInfo.version?.label ?? '—'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Sortie</span>
              <span className="info-value mono">{preview?.outputPath ?? '—'}</span>
            </div>
            {preview?.conflict ? (
              <div className="alert alert-warning small">
                <IconWarning size={14} /> Un élément portant ce nom existe déjà. L’export demandera une confirmation.
              </div>
            ) : null}
          </section>

          {preview?.errors.length ? (
            <section className="alert alert-error small">
              <IconWarning size={16} />
              <div>
                <strong>Export bloqué</strong>
                <ul>
                  {preview.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          {preview?.warnings.length ? (
            <section className="warnings-box">
              <header>
                <IconWarning size={15} /> Avertissements ({preview.warnings.length})
              </header>
              <ul>
                {preview.warnings.map((warning) => (
                  <li key={warning.code + warning.message}>{warning.message}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {preview?.files.length ? (
            <section className="summary-card file-summary">
              <header>Fichiers exportés ({preview.files.length})</header>
              <ul className="file-list">
                {preview.files.map((file) => (
                  <li key={file.relPath}>
                    <span className="mono">{file.relPath}</span>
                    <span className="muted">
                      {file.width && file.height ? `${file.width}×${file.height} · ` : ''}
                      {formatBytes(file.bytes)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="summary-card">
              <header>Contenu</header>
              <p className="empty-note">
                Aucune texture modifiée : le pack ne contiendra que <code>pack.mcmeta</code>. Minecraft l’acceptera,
                mais rien ne changera visuellement.
              </p>
            </section>
          )}

          <details className="meta-details">
            <summary>Voir pack.mcmeta</summary>
            <pre>{preview?.packMeta ?? '—'}</pre>
          </details>

          {localError || state.exportError || task?.status === 'error' ? (
            <div className="alert alert-error small">
              <IconWarning size={15} /> {localError || state.exportError || task?.error}
            </div>
          ) : null}

          {loading ? <p className="muted">Calcul de l’aperçu…</p> : null}

          {overwritePrompt ? (
            <section className="overwrite-box">
              <strong>Un pack existe déjà à cet emplacement</strong>
              <p className="mono">{overwritePrompt.outputPath}</p>
              <p className="muted">Choisissez un autre nom ou confirmez explicitement le remplacement.</p>
              <div className="overwrite-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const next = { ...form, outputName: overwritePrompt.suggestedName };
                    setForm(next);
                    setOverwritePrompt(null);
                    setLocalError('');
                    void runExport(next, false);
                  }}
                >
                  Utiliser « {overwritePrompt.suggestedName} »
                </button>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => {
                    setOverwritePrompt(null);
                    void runExport(form, true);
                  }}
                >
                  Remplacer l’export existant
                </button>
              </div>
            </section>
          ) : null}

          {running ? (
            <div className="task-box">
              <strong>{task?.label}</strong>
              <div className={`progress ${task?.total ? '' : 'indeterminate'}`}>
                <span
                  style={{
                    width: task?.total ? `${Math.min(100, Math.round(((task.current ?? 0) / task.total) * 100))}%` : undefined,
                  }}
                />
              </div>
              <span className="muted">{task?.detail ?? 'Écriture des fichiers…'}</span>
              <button type="button" className="btn tiny ghost" onClick={() => void store.cancelTask(task?.id)}>
                Annuler l’export
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
