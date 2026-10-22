import { useApp, useStore, type ImageTab, type TextTab } from '../store';
import {
  IconBrightness,
  IconCheck,
  IconCompare,
  IconCopy,
  IconCrop,
  IconDropper,
  IconEraser,
  IconExport,
  IconFill,
  IconFlip,
  IconImage,
  IconInfo,
  IconPencil,
  IconResize,
  IconRotate,
  IconSave,
  IconSelect,
  IconUndo,
  IconWarning,
} from '../icons';
import { formatBytes, formatDate, rectLabel, rgbaToHex, hexToRgb } from '../utils';
import { KIND_LABELS } from '../utils';
import { resolvePackVersion, PACK_FORMAT_SOURCE } from '../../shared/packFormats';
import { useEffect, useState } from 'react';

const PALETTE: string[] = [
  '#000000', '#1d1d21', '#3c3c44', '#6b6b74', '#9a9aa6', '#c6c6d0', '#e9e9f0', '#ffffff',
  '#6b3f1d', '#8b5a2b', '#a97142', '#c48b5a', '#e0b48a', '#f2d6b3',
  '#385d2a', '#4f7f36', '#6aa84f', '#8fbf6a', '#b6d7a8',
  '#1f3a52', '#2c5a7a', '#3c87b8', '#66b8e0', '#a8dcf5',
  '#6b1f1f', '#a03030', '#d04545', '#f07a7a',
  '#4a2c6b', '#7a4fa3', '#b085d0', '#e0c2f0',
  '#6b5a1f', '#a89030', '#e0c040', '#f5e07a',
];

function ToolButton({
  active,
  label,
  shortcut,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  shortcut?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={`tool-btn ${active ? 'active' : ''}`} onClick={onClick} title={`${label}${shortcut ? ` (${shortcut})` : ''}`}>
      {children}
      <span>{label}</span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </button>
  );
}

function fullSourcePath(sourcePath: string, sourceType: 'directory' | 'zip', relPath: string): string {
  return sourceType === 'zip' ? `${sourcePath}!/${relPath}` : `${sourcePath}/${relPath}`;
}

function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className={`info-value ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  );
}

function ImageTools({ tab }: { tab: ImageTab }) {
  const store = useStore();
  const state = useApp();
  const [hex, setHex] = useState(rgbaToHex(tab.color));
  useEffect(() => {
    setHex(rgbaToHex(tab.color));
  }, [tab.color[0], tab.color[1], tab.color[2], tab.color[3]]);

  const setColor = (color: [number, number, number, number]): void => {
    store.setColor(tab.relPath, color);
    setHex(rgbaToHex(color));
  };

  const applyHex = (value: string): void => {
    setHex(value);
    if (/^#[0-9a-fA-F]{6}$/.test(value)) {
      const [r, g, b] = hexToRgb(value);
      store.setColor(tab.relPath, [r, g, b, tab.color[3]]);
    }
  };

  return (
    <div className="tools">
      <div className="tool-grid">
        <ToolButton active={tab.tool === 'pencil'} label="Crayon" shortcut="B" onClick={() => store.setTool(tab.relPath, 'pencil')}>
          <IconPencil size={17} />
        </ToolButton>
        <ToolButton active={tab.tool === 'eraser'} label="Gomme" shortcut="E" onClick={() => store.setTool(tab.relPath, 'eraser')}>
          <IconEraser size={17} />
        </ToolButton>
        <ToolButton active={tab.tool === 'dropper'} label="Pipette" shortcut="I" onClick={() => store.setTool(tab.relPath, 'dropper')}>
          <IconDropper size={17} />
        </ToolButton>
        <ToolButton active={tab.tool === 'fill'} label="Remplir" shortcut="G" onClick={() => store.setTool(tab.relPath, 'fill')}>
          <IconFill size={17} />
        </ToolButton>
        <ToolButton active={tab.tool === 'select'} label="Sélection" shortcut="M" onClick={() => store.setTool(tab.relPath, 'select')}>
          <IconSelect size={17} />
        </ToolButton>
      </div>

      <section className="tool-section">
        <header>
          <span>Couleur</span>
          <span className="muted">alpha {tab.color[3]}</span>
        </header>
        <div className="color-row">
          <div className="color-preview checker">
            <span style={{ background: `rgba(${tab.color[0]}, ${tab.color[1]}, ${tab.color[2]}, ${tab.color[3] / 255})` }} />
          </div>
          <input type="color" value={hex} onChange={(event) => applyHex(event.target.value)} aria-label="Couleur" />
          <input className="hex-input" value={hex} onChange={(event) => applyHex(event.target.value)} aria-label="Code couleur" />
        </div>
        <label className="slider-row">
          <span>Opacité</span>
          <input
            type="range"
            min={0}
            max={255}
            value={tab.color[3]}
            onChange={(event) =>
              store.setColor(tab.relPath, [tab.color[0], tab.color[1], tab.color[2], Number(event.target.value)])
            }
          />
          <span className="value">{tab.color[3]}</span>
        </label>
        <div className="palette">
          {PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              className="swatch"
              style={{ background: color }}
              title={color}
              aria-label={`Couleur ${color}`}
              onClick={() => {
                const [r, g, b] = hexToRgb(color);
                setColor([r, g, b, tab.color[3] || 255]);
              }}
            />
          ))}
        </div>
      </section>

      <section className="tool-section">
        <header>
          <span>Taille du pinceau</span>
          <span className="muted">{tab.brushSize} px</span>
        </header>
        <input
          type="range"
          min={1}
          max={16}
          value={tab.brushSize}
          onChange={(event) => store.setBrushSize(tab.relPath, Number(event.target.value))}
          aria-label="Taille du pinceau"
        />
      </section>

      <section className="tool-section">
        <header>
          <span>Sélection</span>
          {tab.selection ? <span className="muted">{rectLabel(tab.selection)}</span> : <span className="muted">aucune</span>}
        </header>
        <div className="button-grid">
          <button type="button" className="btn tiny" disabled={!tab.selection} onClick={() => store.copySelection(tab.relPath)}>
            <IconCopy size={14} /> Copier
          </button>
          <button type="button" className="btn tiny" disabled={!tab.selection} onClick={() => store.cutSelection(tab.relPath)}>
            Couper
          </button>
          <button
            type="button"
            className="btn tiny"
            disabled={!tab.clipboard}
            onClick={() => store.pasteSelection(tab.relPath)}
            title={tab.clipboard ? `Coller ${tab.clipboard.width}×${tab.clipboard.height}` : 'Aucun presse-papiers'}
          >
            Coller
          </button>
          <button type="button" className="btn tiny" disabled={!tab.selection} onClick={() => store.deleteSelection(tab.relPath)}>
            Effacer
          </button>
          <button type="button" className="btn tiny" disabled={!tab.selection} onClick={() => store.cropSelection(tab.relPath)}>
            <IconCrop size={14} /> Recadrer
          </button>
        </div>
        <p className="tool-hint">
          Astuce : sélectionnez une zone avec l’outil Sélection, puis utilisez ces actions (Ctrl+C / X / V).
        </p>
      </section>

      <section className="tool-section">
        <header>
          <span>Transformations</span>
        </header>
        <div className="button-grid">
          <button type="button" className="btn tiny" onClick={() => store.rotate(tab.relPath, 270)}>
            <IconRotate size={14} /> 90° gauche
          </button>
          <button type="button" className="btn tiny" onClick={() => store.rotate(tab.relPath, 90)}>
            <IconRotate size={14} /> 90° droite
          </button>
          <button type="button" className="btn tiny" onClick={() => store.rotate(tab.relPath, 180)}>
            180°
          </button>
          <button type="button" className="btn tiny" onClick={() => store.flip(tab.relPath, 'horizontal')}>
            <IconFlip size={14} /> Miroir H
          </button>
          <button type="button" className="btn tiny" onClick={() => store.flip(tab.relPath, 'vertical')}>
            <IconFlip size={14} /> Miroir V
          </button>
        </div>
      </section>

      <section className="tool-section">
        <header>
          <span>Image</span>
        </header>
        <div className="button-grid">
          <button type="button" className="btn tiny" onClick={() => store.openEditorDialog('resize')}>
            <IconResize size={14} /> Résolution
          </button>
          <button type="button" className="btn tiny" onClick={() => store.openEditorDialog('canvas')}>
            Canevas
          </button>
          <button type="button" className="btn tiny" onClick={() => store.openEditorDialog('adjust')}>
            <IconBrightness size={14} /> Lum./contraste
          </button>
          <button
            type="button"
            className="btn tiny"
            onClick={() =>
              store.openModal({
                type: 'confirm',
                title: 'Revenir à la texture d’origine ?',
                message: 'Les pixels actuels seront remplacés par la version du fichier source. Cette action est annulable (Ctrl+Z) tant que vous n’enregistrez pas.',
                confirmLabel: 'Revenir à l’original',
                onConfirm: () => store.resetToOriginal(tab.relPath),
              })
            }
          >
            <IconUndo size={14} /> Original
          </button>
          <button type="button" className="btn tiny" onClick={() => store.setCompare(!state.compare)}>
            <IconCompare size={14} /> Comparer
          </button>
        </div>
      </section>

      <div className="tool-actions">
        <button type="button" className="btn primary" onClick={() => void store.saveTab(tab.relPath)} disabled={tab.saving}>
          <IconSave size={15} /> {tab.saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button type="button" className="btn ghost" onClick={() => void store.closeTab(tab.relPath)}>
          Fermer
        </button>
      </div>
    </div>
  );
}

function ImageInfo({ tab }: { tab: ImageTab }) {
  const state = useApp();
  const store = useStore();
  const change = state.view?.changes.find((candidate) => candidate.relPath === tab.relPath);
  return (
    <div className="info-panel">
      <div className="preview-large checker">
        <ImagePreviewThumb relPath={tab.relPath} />
      </div>
      <div className="info-table">
        <InfoRow label="Nom" value={tab.name} />
        <InfoRow label="Chemin" value={tab.relPath} mono />
        <InfoRow
          label="Chemin source"
          value={state.view ? fullSourcePath(state.view.source.path, state.view.source.type, tab.relPath) : tab.relPath}
          mono
        />
        <InfoRow label="Dimensions source" value={`${tab.originalWidth} × ${tab.originalHeight} px`} />
        <InfoRow label="Dimensions actuelles" value={`${tab.width} × ${tab.height} px`} />
        <InfoRow label="Zoom" value={tab.fit ? 'Ajusté' : `${Math.round(tab.zoom * 100)} %`} />
        <InfoRow label="Fichier source" value={formatBytes(tab.meta.sourceBytes ?? 0)} />
        <InfoRow label="Format" value={tab.meta.animated ? 'PNG animé (lecture seule)' : 'PNG statique'} />
        <InfoRow label="État" value={
          change?.status === 'modified' ? (
            <span className="badge badge-accent">modifié</span>
          ) : change?.status === 'excluded' ? (
            <span className="badge badge-muted">exclu du pack</span>
          ) : (
            <span className="muted">non modifié</span>
          )
        } />
        {change?.workSize ? <InfoRow label="Taille de travail" value={formatBytes(change.workSize)} /> : null}
        <InfoRow label="Modifié le" value={formatDate(change ? new Date(change.modifiedAt).getTime() : 0)} />
      </div>
      <div className="info-actions">
        <button type="button" className="btn primary wide" onClick={() => void store.saveTab(tab.relPath)} disabled={tab.saving}>
          <IconSave size={15} /> Enregistrer dans le projet
        </button>
        {change ? (
          <>
            <button
              type="button"
              className="btn wide"
              onClick={() =>
                store.openModal({
                  type: 'confirm',
                  title: 'Annuler la modification ?',
                  message: `La copie de travail de « ${tab.relPath} » sera supprimée. Le fichier source n’est jamais modifié.`,
                  confirmLabel: 'Annuler la modification',
                  danger: true,
                  onConfirm: () => store.revertChange(tab.relPath),
                })
              }
            >
              Restaurer l’original
            </button>
            {change.status === 'excluded' ? (
              <button type="button" className="btn wide" onClick={() => void store.includeChange(tab.relPath)}>
                Réintégrer au pack
              </button>
            ) : (
              <button type="button" className="btn wide" onClick={() => void store.excludeChange(tab.relPath)}>
                Exclure du pack
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

function ImagePreviewThumb({ relPath }: { relPath: string }) {
  const store = useStore();
  const state = useApp();
  const url = store.getThumb(relPath);
  useEffect(() => {
    store.requestThumb(relPath);
  }, [relPath, state.thumbEpoch, store]);
  if (!url) return <div className="preview-placeholder">Aperçu</div>;
  return (
    <div className="scale-previews">
      <div className="scale-main">
        <img src={url} alt="" style={{ imageRendering: 'pixelated' }} />
      </div>
      <div className="scale-strip" title="Aperçu à plusieurs échelles (1×, 2×, 4×)">
        {[32, 64, 128].map((size) => (
          <img key={size} src={url} alt="" width={size} height={size} style={{ imageRendering: 'pixelated' }} />
        ))}
      </div>
    </div>
  );
}

function activeSourcePath(
  view: { source: { path: string; type: 'directory' | 'zip' } } | undefined,
  relPath: string,
): string {
  return view ? fullSourcePath(view.source.path, view.source.type, relPath) : relPath;
}

function TextInfo({ tab }: { tab: TextTab }) {
  const store = useStore();
  const state = useApp();
  return (
    <div className="info-panel">
      <div className="info-table">
        <InfoRow label="Nom" value={tab.name} />
        <InfoRow label="Chemin" value={tab.relPath} mono />
        <InfoRow
          label="Chemin source"
          value={activeSourcePath(state.view, tab.relPath)}
          mono
        />
        <InfoRow label="Taille" value={formatBytes(tab.bytes)} />
        <InfoRow label="Éditable" value={tab.editable ? 'Oui (UTF-8)' : 'Non'} />
        <InfoRow label="État" value={tab.dirty ? <span className="badge badge-accent">non enregistré</span> : <span className="muted">à jour</span>} />
        {tab.message ? <p className="alert alert-warning small">{tab.message}</p> : null}
      </div>
      <div className="info-actions">
        <button type="button" className="btn primary wide" disabled={!tab.editable || tab.saving} onClick={() => void store.saveTab(tab.relPath)}>
          <IconSave size={15} /> Enregistrer
        </button>
      </div>
    </div>
  );
}

function safeVersionLabel(targetVersion: string, customFormat?: { major: number; minor: number }): string {
  try {
    return resolvePackVersion(targetVersion, customFormat).version.label;
  } catch {
    return `Version inconnue (${targetVersion})`;
  }
}

export function RightPanel() {
  const state = useApp();
  const store = useStore();
  const view = state.view;
  if (!view) return null;
  const activeTab = state.tabs.find((tab) => tab.relPath === state.activeTab);
  const selected = state.selected;
  const selectedInfo = state.selectedInfo;
  const selectedChange = view.changes.find((change) => change.relPath === (activeTab?.relPath ?? selected?.relPath));

  return (
    <aside className="rightpanel">
      {activeTab ? (
        <>
          <div className="rightpanel-tabs">
            <button type="button" className={state.rightTab === 'tools' ? 'active' : ''} onClick={() => store.setRightTab('tools')}>
              Outils
            </button>
            <button type="button" className={state.rightTab === 'info' ? 'active' : ''} onClick={() => store.setRightTab('info')}>
              Informations
            </button>
          </div>
          {activeTab.kind === 'image' ? (
            state.rightTab === 'tools' ? (
              <ImageTools tab={activeTab} />
            ) : (
              <ImageInfo tab={activeTab} />
            )
          ) : state.rightTab === 'tools' ? (
            <div className="info-panel">
              <p className="empty-note">Le fichier texte s’édite dans la zone centrale. Utilisez l’onglet Informations pour les détails.</p>
              <TextInfo tab={activeTab} />
            </div>
          ) : (
            <TextInfo tab={activeTab} />
          )}
        </>
      ) : selected ? (
        <div className="info-panel">
          <div className="info-panel-title">
            {selected.image ? <IconImage size={18} /> : <IconInfo size={18} />}
            <div>
              <strong>{selected.name}</strong>
              <small>{selected.relPath}</small>
            </div>
          </div>
          <div className="info-table">
            <InfoRow label="Type" value={KIND_LABELS[selected.kind]} />
            <InfoRow label="Extension" value={selected.ext ? `.${selected.ext}` : '—'} />
            <InfoRow label="Taille" value={formatBytes(selected.size)} />
            <InfoRow
              label="Résolution"
              value={selected.width && selected.height ? `${selected.width} × ${selected.height} px` : selected.image ? '—' : 'Non applicable'}
            />
            <InfoRow label="Modifié le" value={formatDate(selected.mtimeMs)} />
            <InfoRow label="Éditable" value={selected.editability === 'image' ? 'Oui, éditeur d’image' : selected.editability === 'text' ? 'Oui, éditeur de texte' : 'Lecture seule'} />
            <InfoRow
              label="État"
              value={
                selectedChange?.status === 'modified' ? (
                  <span className="badge badge-accent">modifié</span>
                ) : selectedChange?.status === 'excluded' ? (
                  <span className="badge badge-muted">exclu du pack</span>
                ) : (
                  <span className="muted">non modifié</span>
                )
              }
            />
            <InfoRow label="Chemin relatif" value={selected.relPath} mono />
            <InfoRow
              label="Chemin source"
              value={activeSourcePath(view, selected.relPath)}
              mono
            />
          </div>
          {selectedInfo?.sourceMissing ? (
            <div className="alert alert-warning small">
              <IconWarning size={15} /> Le fichier source est introuvable sur le disque. La copie de travail reste utilisable si elle existe.
            </div>
          ) : null}
          {selectedChange?.error ? (
            <div className="alert alert-warning small">
              <IconWarning size={15} /> {selectedChange.error}
            </div>
          ) : null}
          <div className="info-actions">
            {selected.editability !== 'none' ? (
              <button type="button" className="btn primary wide" onClick={() => void store.openEntry(selected)}>
                Ouvrir dans l’éditeur
              </button>
            ) : (
              <p className="empty-note">Ce format n’est pas éditable par l’application, mais reste visible et indexé.</p>
            )}
            {selectedChange ? (
              <>
                {selectedChange.status === 'excluded' ? (
                  <button type="button" className="btn wide" onClick={() => void store.includeChange(selected.relPath)}>
                    Réintégrer au pack
                  </button>
                ) : (
                  <button type="button" className="btn wide" onClick={() => void store.excludeChange(selected.relPath)}>
                    Exclure du pack
                  </button>
                )}
                <button
                  type="button"
                  className="btn danger wide"
                  onClick={() =>
                    store.openModal({
                      type: 'confirm',
                      title: 'Annuler la modification ?',
                      message: `La copie de travail de « ${selected.relPath} » sera supprimée. Le fichier source n’est jamais modifié.`,
                      confirmLabel: 'Restaurer l’original',
                      danger: true,
                      onConfirm: () => store.revertChange(selected.relPath),
                    })
                  }
                >
                  Restaurer l’original
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="info-panel project-summary">
          <div className="info-panel-title">
            <IconInfo size={18} />
            <div>
              <strong>{view.name}</strong>
              <small>
                {view.source.type === 'zip' ? 'Archive' : 'Dossier'} · {view.stats.fileCount.toLocaleString('fr-FR')} fichiers
              </small>
            </div>
          </div>

          <section className="summary-card">
            <header>Resource pack</header>
            <InfoRow label="Nom" value={view.pack.name} />
            <InfoRow label="Version cible" value={safeVersionLabel(view.pack.targetVersion, view.pack.customFormat)} />
            <InfoRow label="Format de sortie" value={view.pack.format === 'zip' ? 'Archive ZIP' : 'Dossier'} />
            <InfoRow label="Icône" value={view.pack.icon ? `${view.pack.icon.width}×${view.pack.icon.height}` : 'Aucune'} />
            <InfoRow label="Fichiers modifiés" value={String(view.stats.modifiedCount)} />
            <InfoRow label="Taille des modifications" value={formatBytes(view.stats.modifiedBytes)} />
          </section>

          <div className="alert alert-info small">
            <IconCheck size={15} /> À l’export, seuls les fichiers modifiés, <code>pack.mcmeta</code> et l’icône éventuelle sont
            inclus. Aucun fichier original non modifié n’est copié.
          </div>

          <button type="button" className="btn primary wide" onClick={() => store.openModal({ type: 'export' })}>
            <IconExport size={16} /> Configurer et exporter
          </button>

          <section className="compat-note">
            <header>Table de compatibilité</header>
            <p>
              {PACK_FORMAT_SOURCE.title} — relevé du {PACK_FORMAT_SOURCE.checkedAt}. Les versions inconnues sont acceptées avec
              un avertissement explicite.
            </p>
            <a href={PACK_FORMAT_SOURCE.url} target="_blank" rel="noreferrer">
              Consulter la source
            </a>
          </section>

          <section className="summary-card">
            <header>Source</header>
            <InfoRow label="Type" value={view.source.type === 'zip' ? 'Archive ZIP' : 'Dossier'} />
            <InfoRow label="Fichiers" value={view.source.fileCount.toLocaleString('fr-FR')} />
            <InfoRow label="Taille" value={formatBytes(view.source.totalBytes)} />
            <InfoRow label="Importé le" value={formatDate(new Date(view.source.importedAt).getTime())} />
          </section>

          <div className="info-actions">
            <button type="button" className="btn wide" onClick={() => void store.verifySource()}>
              Vérifier la source
            </button>
            <button type="button" className="btn wide" onClick={() => store.openModal({ type: 'settings' })}>
              Paramètres
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
