import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImageTab } from '../store';
import { useApp, useStore } from '../store';
import {
  brightnessContrast,
  drawLine,
  floodFill,
  getPixel,
  MAX_IMAGE_PIXELS,
  resizeCanvas,
  resizeImage,
  type Pixmap,
  type Rect,
  type ResizeMethod,
} from '../../core/imageOps';
import { checkDimensions } from '../../core/imageOps';
import {
  IconBrightness,
  IconCompare,
  IconFit,
  IconRedo,
  IconResize,
  IconSave,
  IconUndo,
  IconWarning,
  IconZoomIn,
  IconZoomOut,
} from '../icons';
import { Modal } from '../components/Modal';
import { formatBytes, rgbaToHex } from '../utils';

const CHECKER_SIZE = 8;
let checkerPatternCanvas: HTMLCanvasElement | null = null;

function getCheckerPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (!checkerPatternCanvas) {
    const canvas = document.createElement('canvas');
    canvas.width = CHECKER_SIZE * 2;
    canvas.height = CHECKER_SIZE * 2;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#1b2433';
    context.fillRect(0, 0, CHECKER_SIZE * 2, CHECKER_SIZE * 2);
    context.fillStyle = '#141b27';
    context.fillRect(0, 0, CHECKER_SIZE, CHECKER_SIZE);
    context.fillRect(CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE);
    checkerPatternCanvas = canvas;
  }
  return ctx.createPattern(checkerPatternCanvas, 'repeat');
}

type DragState =
  | { mode: 'draw'; lastX: number; lastY: number }
  | { mode: 'select'; startX: number; startY: number; currentX: number; currentY: number }
  | { mode: 'pan'; startClientX: number; startClientY: number; startPanX: number; startPanY: number };

export function ImageEditor({ tab }: { tab: ImageTab }) {
  const state = useApp();
  const store = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const viewRef = useRef({ scale: 1, originX: 0, originY: 0 });
  const rafRef = useRef<number | null>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const [size, setSize] = useState({ width: 800, height: 600 });
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [tick, setTick] = useState(0);
  const [panPreview, setPanPreview] = useState<{ x: number; y: number } | null>(null);
  const panPreviewRef = useRef<{ x: number; y: number } | null>(null);
  const [selectionPreview, setSelectionPreview] = useState<Rect | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);

  const scale = useMemo(() => {
    if (tab.fit) {
      const fit = Math.min(
        (Math.max(80, size.width) - 56) / tab.width,
        (Math.max(80, size.height) - 56) / tab.height,
      );
      return Math.max(0.1, Math.min(32, fit));
    }
    return tab.zoom;
  }, [tab.fit, tab.width, tab.height, tab.zoom, size.width, size.height]);

  const pan = panPreview ?? { x: tab.fit ? 0 : tab.panX, y: tab.fit ? 0 : tab.panY };
  const originX = size.width / 2 + pan.x - (tab.width * scale) / 2;
  const originY = size.height / 2 + pan.y - (tab.height * scale) / 2;
  viewRef.current = { scale, originX, originY };

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: Math.max(80, rect.width), height: Math.max(80, rect.height) });
    });
    observer.observe(element);
    setSize({ width: Math.max(80, element.clientWidth), height: Math.max(80, element.clientHeight) });
    return () => observer.disconnect();
  }, []);

  const scheduleRender = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      setTick((value) => value + 1);
    });
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(size.width * dpr) || canvas.height !== Math.round(size.height * dpr)) {
      canvas.width = Math.round(size.width * dpr);
      canvas.height = Math.round(size.height * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0a0f18';
    ctx.fillRect(0, 0, size.width, size.height);

    const imageWidth = tab.width * scale;
    const imageHeight = tab.height * scale;
    const imageRect = { x: originX, y: originY, width: imageWidth, height: imageHeight };

    let current = currentCanvasRef.current;
    if (!current || current.width !== tab.width || current.height !== tab.height) {
      current = document.createElement('canvas');
      current.width = tab.width;
      current.height = tab.height;
      currentCanvasRef.current = current;
    }
    const currentCtx = current.getContext('2d');
    if (currentCtx) {
      const data = new Uint8ClampedArray(tab.pixels.length);
      data.set(tab.pixels);
      currentCtx.putImageData(new ImageData(data, tab.width, tab.height), 0, 0);
    }

    let original = originalCanvasRef.current;
    if (!original || original.width !== tab.originalWidth || original.height !== tab.originalHeight) {
      original = document.createElement('canvas');
      original.width = tab.originalWidth;
      original.height = tab.originalHeight;
      originalCanvasRef.current = original;
    }
    const originalCtx = original.getContext('2d');
    if (originalCtx) {
      const data = new Uint8ClampedArray(tab.originalPixels.length);
      data.set(tab.originalPixels);
      originalCtx.putImageData(new ImageData(data, tab.originalWidth, tab.originalHeight), 0, 0);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(imageRect.x, imageRect.y, imageRect.width, imageRect.height);
    ctx.clip();
    const pattern = getCheckerPattern(ctx);
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(imageRect.x, imageRect.y, imageRect.width, imageRect.height);
    }
    ctx.drawImage(current, imageRect.x, imageRect.y, imageRect.width, imageRect.height);

    if (state.compare) {
      const splitX = imageRect.x + (imageRect.width * state.compareSplit) / 100;
      ctx.save();
      ctx.beginPath();
      ctx.rect(imageRect.x, imageRect.y, splitX - imageRect.x, imageRect.height);
      ctx.clip();
      ctx.drawImage(original, imageRect.x, imageRect.y, tab.originalWidth * scale, tab.originalHeight * scale);
      ctx.restore();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(splitX, imageRect.y);
      ctx.lineTo(splitX, imageRect.y + imageRect.height);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(120, 160, 220, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(imageRect.x + 0.5, imageRect.y + 0.5, imageRect.width, imageRect.height);

    if (scale >= 10) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      for (let x = 1; x < tab.width; x += 1) {
        const px = Math.round(imageRect.x + x * scale) + 0.5;
        ctx.moveTo(px, imageRect.y);
        ctx.lineTo(px, imageRect.y + imageRect.height);
      }
      for (let y = 1; y < tab.height; y += 1) {
        const py = Math.round(imageRect.y + y * scale) + 0.5;
        ctx.moveTo(imageRect.x, py);
        ctx.lineTo(imageRect.x + imageRect.width, py);
      }
      ctx.stroke();
    }

    const selection = selectionPreview ?? tab.selection;
    if (selection) {
      const sx = imageRect.x + selection.x * scale;
      const sy = imageRect.y + selection.y * scale;
      const sw = selection.width * scale;
      const sh = selection.height * scale;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#0b0e14';
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(sx + 0.5, sy + 0.5, sw, sh);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineDashOffset = 4;
      ctx.strokeRect(sx + 0.5, sy + 0.5, sw, sh);
      ctx.restore();
    }
  }, [
    size.width,
    size.height,
    tab.width,
    tab.height,
    tab.pixels,
    tab.originalWidth,
    tab.originalHeight,
    tab.originalPixels,
    tab.selection,
    originX,
    originY,
    scale,
    state.compare,
    state.compareSplit,
    selectionPreview,
    tick,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    currentCanvasRef.current = null;
    originalCanvasRef.current = null;
    setHover(null);
    setSelectionPreview(null);
    setPanPreview(null);
    panPreviewRef.current = null;
  }, [tab.relPath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === 'Space' && !isFormTarget(event.target)) {
        event.preventDefault();
        setSpacePressed(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') setSpacePressed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
      const active = tabRef.current;
      const currentScale = active.fit
        ? Math.min(
            (Math.max(80, canvas.clientWidth) - 56) / active.width,
            (Math.max(80, canvas.clientHeight) - 56) / active.height,
          )
        : active.zoom;
      store.setZoom(active.relPath, Math.max(0.25, Math.min(64, currentScale * factor)));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [store, tab.relPath]);

  const imagePoint = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    const { scale: currentScale, originX: ox, originY: oy } = viewRef.current;
    return {
      x: Math.floor((event.clientX - rect.left - ox) / currentScale),
      y: Math.floor((event.clientY - rect.top - oy) / currentScale),
    };
  };

  const inBounds = (point: { x: number; y: number }): boolean =>
    point.x >= 0 && point.y >= 0 && point.x < tab.width && point.y < tab.height;

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = imagePoint(event);
    if (event.button === 1 || spacePressed) {
      dragRef.current = {
        mode: 'pan',
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPanX: tab.fit ? 0 : tab.panX,
        startPanY: tab.fit ? 0 : tab.panY,
      };
      const startPan = { x: tab.fit ? 0 : tab.panX, y: tab.fit ? 0 : tab.panY };
      panPreviewRef.current = startPan;
      setPanPreview(startPan);
      return;
    }
    if (event.button !== 0) return;
    if (tab.tool === 'select') {
      const clamped = {
        x: Math.max(0, Math.min(tab.width - 1, point.x)),
        y: Math.max(0, Math.min(tab.height - 1, point.y)),
      };
      dragRef.current = {
        mode: 'select',
        startX: clamped.x,
        startY: clamped.y,
        currentX: clamped.x,
        currentY: clamped.y,
      };
      setSelectionPreview({ x: clamped.x, y: clamped.y, width: 1, height: 1 });
      return;
    }
    if (!inBounds(point)) return;
    if (tab.tool === 'dropper') {
      const [r, g, b, a] = getPixel({ width: tab.width, height: tab.height, data: tab.pixels }, point.x, point.y);
      store.setColor(tab.relPath, [r, g, b, a]);
      store.toast(`Couleur prélevée : ${rgbaToHex([r, g, b, a])} (alpha ${a}).`, 'info');
      return;
    }
    if (tab.tool === 'fill') {
      store.beginEdit(tab.relPath, 'Remplissage');
      floodFill(
        { width: tab.width, height: tab.height, data: tab.pixels },
        point.x,
        point.y,
        tab.color,
        { contiguous: true },
      );
      store.endEdit(tab.relPath);
      scheduleRender();
      return;
    }
    store.beginEdit(tab.relPath, tab.tool === 'eraser' ? 'Gomme' : 'Crayon');
    dragRef.current = { mode: 'draw', lastX: point.x, lastY: point.y };
    drawPoint(point.x, point.y);
  };

  const drawPoint = (x: number, y: number): void => {
    const active = tabRef.current;
    const color = active.tool === 'eraser' ? ([0, 0, 0, 0] as [number, number, number, number]) : active.color;
    const image = { width: active.width, height: active.height, data: active.pixels };
    drawLine(image, x, y, x, y, active.brushSize, color);
    scheduleRender();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const point = imagePoint(event);
    setHover(inBounds(point) ? point : null);
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.mode === 'pan') {
      const next = {
        x: drag.startPanX + event.clientX - drag.startClientX,
        y: drag.startPanY + event.clientY - drag.startClientY,
      };
      panPreviewRef.current = next;
      setPanPreview(next);
      return;
    }
    if (drag.mode === 'draw') {
      const x = Math.max(-2, Math.min(tab.width + 1, point.x));
      const y = Math.max(-2, Math.min(tab.height + 1, point.y));
      const active = tabRef.current;
      const color = active.tool === 'eraser' ? ([0, 0, 0, 0] as [number, number, number, number]) : active.color;
      drawLine(
        { width: active.width, height: active.height, data: active.pixels },
        drag.lastX,
        drag.lastY,
        x,
        y,
        active.brushSize,
        color,
      );
      drag.lastX = x;
      drag.lastY = y;
      scheduleRender();
      return;
    }
    if (drag.mode === 'select') {
      drag.currentX = Math.max(0, Math.min(tab.width - 1, point.x));
      drag.currentY = Math.max(0, Math.min(tab.height - 1, point.y));
      const x = Math.min(drag.startX, drag.currentX);
      const y = Math.min(drag.startY, drag.currentY);
      setSelectionPreview({
        x,
        y,
        width: Math.abs(drag.currentX - drag.startX) + 1,
        height: Math.abs(drag.currentY - drag.startY) + 1,
      });
    }
  };

  const onPointerUp = (): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.mode === 'draw') {
      store.endEdit(tab.relPath);
      setTick((value) => value + 1);
    } else if (drag.mode === 'select') {
      const x = Math.min(drag.startX, drag.currentX);
      const y = Math.min(drag.startY, drag.currentY);
      const width = Math.abs(drag.currentX - drag.startX) + 1;
      const height = Math.abs(drag.currentY - drag.startY) + 1;
      store.setSelection(tab.relPath, { x, y, width, height });
      setSelectionPreview(null);
    } else if (drag.mode === 'pan' && panPreviewRef.current) {
      store.setPan(tab.relPath, panPreviewRef.current.x, panPreviewRef.current.y);
      panPreviewRef.current = null;
      setPanPreview(null);
    }
  };

  const onPointerLeave = (): void => {
    setHover(null);
  };

  const zoomBy = (factor: number): void => {
    store.setZoom(tab.relPath, Math.max(0.25, Math.min(64, scale * factor)));
  };

  const hoverColor = hover ? getPixel({ width: tab.width, height: tab.height, data: tab.pixels }, hover.x, hover.y) : null;

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <button type="button" className="icon-btn" title="Annuler (Ctrl+Z)" disabled={!tab.history.canUndo} onClick={() => store.undo(tab.relPath)}>
          <IconUndo size={16} />
        </button>
        <button type="button" className="icon-btn" title="Rétablir (Ctrl+Y)" disabled={!tab.history.canRedo} onClick={() => store.redo(tab.relPath)}>
          <IconRedo size={16} />
        </button>
        <span className="toolbar-divider" />
        <button type="button" className="icon-btn" title="Zoom arrière" onClick={() => zoomBy(1 / 1.25)}>
          <IconZoomOut size={16} />
        </button>
        <span className="zoom-value">{Math.round(scale * 100)} %</span>
        <button type="button" className="icon-btn" title="Zoom avant" onClick={() => zoomBy(1.25)}>
          <IconZoomIn size={16} />
        </button>
        <button type="button" className="btn tiny ghost" onClick={() => store.setFit(tab.relPath)} title="Ajuster à la fenêtre">
          <IconFit size={14} /> Ajuster
        </button>
        <button type="button" className="btn tiny ghost" onClick={() => store.setZoom(tab.relPath, 1)} title="Échelle réelle">
          1:1
        </button>
        <span className="toolbar-divider" />
        <span className="dims-badge" title="Résolution actuelle">
          {tab.width} × {tab.height} px
        </span>
        {tab.width !== tab.originalWidth || tab.height !== tab.originalHeight ? (
          <span className="badge badge-warn" title="La résolution diffère de l’original">
            redimensionné
          </span>
        ) : null}
        <span className="toolbar-spacer" />
        <button
          type="button"
          className={`btn tiny ${state.compare ? 'primary' : 'ghost'}`}
          onClick={() => store.setCompare(!state.compare)}
          title="Comparer avant / après"
        >
          <IconCompare size={14} /> Comparer
        </button>
        <button type="button" className="btn tiny primary" onClick={() => void store.saveTab(tab.relPath)} disabled={tab.saving}>
          <IconSave size={14} /> {tab.saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>

      <div className="editor-canvas-wrap" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className={`pixel-canvas ${spacePressed ? 'panning' : tab.tool}`}
          style={{ width: size.width, height: size.height }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          onContextMenu={(event) => event.preventDefault()}
        />
        {state.compare ? (
          <div className="compare-slider">
            <span>Original</span>
            <input
              type="range"
              min={0}
              max={100}
              value={state.compareSplit}
              onChange={(event) => store.setCompareSplit(Number(event.target.value))}
            />
            <span>Modifié</span>
          </div>
        ) : null}
      </div>

      <div className="editor-status">
        <span>
          {tab.width} × {tab.height} px
          {tab.width !== tab.originalWidth ? ` (source ${tab.originalWidth} × ${tab.originalHeight})` : ''}
        </span>
        <span>
          {hover ? (
            <>
              x {hover.x}, y {hover.y}
              {hoverColor ? (
                <>
                  <span
                    className="status-swatch"
                    style={{
                      background: `rgba(${hoverColor[0]},${hoverColor[1]},${hoverColor[2]},${hoverColor[3] / 255})`,
                    }}
                  />
                  {rgbaToHex(hoverColor)} · α {hoverColor[3]}
                </>
              ) : null}
            </>
          ) : (
            'Survolez l’image pour inspecter les pixels'
          )}
        </span>
        <span className="muted">{tab.history.canUndo ? `Annuler : ${tab.history.undoLabel}` : 'Aucun historique'}</span>
        <span className={tab.dirty ? 'dirty-text' : 'muted'}>
          {tab.dirty ? 'Non enregistré — Ctrl+S' : 'Enregistré dans le projet'}
        </span>
      </div>

      {state.editorDialog === 'resize' ? <ResizeDialog tab={tab} mode="resize" /> : null}
      {state.editorDialog === 'canvas' ? <ResizeDialog tab={tab} mode="canvas" /> : null}
      {state.editorDialog === 'adjust' ? <AdjustDialog tab={tab} /> : null}
    </div>
  );
}

function isFormTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable;
}

function PreviewCanvas({ image, max = 180 }: { image: Pixmap; max?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ratio = Math.min(max / image.width, max / image.height, 3);
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const pattern = getCheckerPattern(ctx);
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, width, height);
    }
    const temp = document.createElement('canvas');
    temp.width = image.width;
    temp.height = image.height;
    const tempCtx = temp.getContext('2d');
    if (!tempCtx) return;
    const data = new Uint8ClampedArray(image.data.length);
    data.set(image.data);
    tempCtx.putImageData(new ImageData(data, image.width, image.height), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(temp, 0, 0, width, height);
  }, [image, width, height]);
  return <canvas ref={ref} className="preview-canvas" style={{ width, height }} />;
}

function ResizeDialog({ tab, mode }: { tab: ImageTab; mode: 'resize' | 'canvas' }) {
  const store = useStore();
  const [width, setWidth] = useState(String(mode === 'resize' ? tab.width : tab.width));
  const [height, setHeight] = useState(String(tab.height));
  const [lock, setLock] = useState(true);
  const [method, setMethod] = useState<ResizeMethod>('nearest');
  const ratio = tab.width / tab.height;

  useEffect(() => {
    setWidth(String(tab.width));
    setHeight(String(tab.height));
  }, [tab.width, tab.height, mode]);

  const parsedWidth = Number.parseInt(width, 10);
  const parsedHeight = Number.parseInt(height, 10);
  const valid =
    Number.isInteger(parsedWidth) &&
    Number.isInteger(parsedHeight) &&
    parsedWidth > 0 &&
    parsedHeight > 0;
  let error = '';
  if (!valid) error = 'Indiquez des dimensions entières positives.';
  else {
    try {
      checkDimensions(parsedWidth, parsedHeight);
      if (parsedWidth * parsedHeight > MAX_IMAGE_PIXELS) error = 'Image trop grande.';
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Dimensions invalides.';
    }
  }

  const memory = valid ? (parsedWidth * parsedHeight * 4) / (1024 * 1024) : 0;
  const downscale = valid && parsedWidth < tab.width && parsedHeight < tab.height;
  const preview = useMemo(() => {
    if (!valid) return null;
    const source: Pixmap = { width: tab.width, height: tab.height, data: tab.pixels };
    try {
      return mode === 'resize'
        ? resizeImage(source, parsedWidth, parsedHeight, method)
        : resizeCanvas(source, parsedWidth, parsedHeight, 'center');
    } catch {
      return null;
    }
  }, [valid, parsedWidth, parsedHeight, method, mode, tab.width, tab.height, tab.pixels]);

  const applyDimension = (value: number): void => {
    const next = Math.max(1, value);
    if (lock) {
      setWidth(String(next));
      setHeight(String(Math.max(1, Math.round(next / ratio))));
    } else if (next === parsedWidth && error) {
      setWidth(String(next));
    } else {
      setWidth(String(next));
    }
  };

  return (
    <Modal
      title={mode === 'resize' ? 'Modifier la résolution' : 'Redimensionner le canevas'}
      subtitle={
        mode === 'resize'
          ? 'Les pixels sont rééchantillonnés. Le chemin et le nom du fichier restent identiques.'
          : 'La taille du canevas change sans étirer les pixels existants (ancrage centré).'
      }
      onClose={() => store.closeEditorDialog()}
      size="large"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={() => store.closeEditorDialog()}>
            Annuler
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!valid || Boolean(error) || !preview}
            onClick={() => {
              if (!valid || error) return;
              if (mode === 'resize') store.resizeResolution(tab.relPath, parsedWidth, parsedHeight, method);
              else store.resizeCanvasOp(tab.relPath, parsedWidth, parsedHeight);
              store.closeEditorDialog();
            }}
          >
            Appliquer {valid ? `${parsedWidth} × ${parsedHeight}` : ''}
          </button>
        </>
      }
    >
      <div className="resize-layout">
        <div className="resize-form">
          <div className="field-row">
            <label>
              <span>Largeur (px)</span>
              <input
                type="number"
                min={1}
                max={16384}
                value={width}
                onChange={(event) => {
                  setWidth(event.target.value);
                  if (lock && Number(event.target.value) > 0) {
                    setHeight(String(Math.max(1, Math.round(Number(event.target.value) / ratio))));
                  }
                }}
              />
            </label>
            <label>
              <span>Hauteur (px)</span>
              <input
                type="number"
                min={1}
                max={16384}
                value={height}
                onChange={(event) => {
                  setHeight(event.target.value);
                  if (lock && Number(event.target.value) > 0) {
                    setWidth(String(Math.max(1, Math.round(Number(event.target.value) * ratio))));
                  }
                }}
              />
            </label>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={lock} onChange={(event) => setLock(event.target.checked)} />
            Conserver les proportions
          </label>
          <div className="preset-row">
            {[16, 32, 64, 128, 256, 512].map((preset) => (
              <button key={preset} type="button" className="btn tiny" onClick={() => applyDimension(preset)}>
                {preset}
              </button>
            ))}
            <button
              type="button"
              className="btn tiny ghost"
              onClick={() => {
                setWidth(String(tab.originalWidth));
                setHeight(String(tab.originalHeight));
              }}
            >
              Original
            </button>
          </div>
          {mode === 'resize' ? (
            <label className="field">
              <span>Méthode de redimensionnement</span>
              <select value={method} onChange={(event) => setMethod(event.target.value as ResizeMethod)}>
                <option value="nearest">Plus proche voisin (pixel art)</option>
                <option value="bilinear">Bilinéaire</option>
                <option value="bicubic">Bicubique</option>
                <option value="box">Moyenne de zone (box)</option>
              </select>
            </label>
          ) : null}
          <p className="tool-hint">
            Dimensions actuelles : {tab.width} × {tab.height} px · mémoire pixels estimée : {memory.toFixed(1)} Mo
          </p>
          {error ? (
            <div className="alert alert-error small">
              <IconWarning size={15} /> {error}
            </div>
          ) : null}
          {downscale ? (
            <div className="alert alert-warning small">
              <IconWarning size={15} /> Réduire la résolution peut dégrader les pixels. Le mode plus proche voisin est
              recommandé pour les textures pixel art ; les autres méthodes mélangent les couleurs et la transparence.
            </div>
          ) : null}
          {mode === 'resize' && method !== 'nearest' && !downscale ? (
            <div className="alert alert-info small">
              <IconWarning size={15} /> Les méthodes interpolées peuvent créer des pixels semi-transparents.
            </div>
          ) : null}
        </div>
        <div className="resize-preview">
          <div>
            <span className="preview-label">Actuel · {tab.width} × {tab.height}</span>
            <PreviewCanvas image={{ width: tab.width, height: tab.height, data: tab.pixels }} />
          </div>
          <IconResize size={18} />
          <div>
            <span className="preview-label">
              Résultat · {valid ? `${parsedWidth} × ${parsedHeight}` : '—'}
            </span>
            {preview ? <PreviewCanvas image={preview} /> : <div className="preview-empty">Aperçu indisponible</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function AdjustDialog({ tab }: { tab: ImageTab }) {
  const store = useStore();
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const preview = useMemo(
    () => brightnessContrast({ width: tab.width, height: tab.height, data: tab.pixels }, brightness, contrast),
    [tab.width, tab.height, tab.pixels, brightness, contrast],
  );
  return (
    <Modal
      title="Luminosité et contraste"
      subtitle="Aperçu en direct. Cliquez sur Appliquer pour ajouter l’opération à l’historique."
      onClose={() => store.closeEditorDialog()}
      size="large"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={() => store.closeEditorDialog()}>
            Annuler
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              store.adjust(tab.relPath, brightness, contrast);
              store.closeEditorDialog();
            }}
          >
            Appliquer
          </button>
        </>
      }
    >
      <div className="adjust-layout">
        <div className="adjust-controls">
          <label className="slider-row">
            <span>
              <IconBrightness size={14} /> Luminosité
            </span>
            <input type="range" min={-100} max={100} value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} />
            <span className="value">{brightness}</span>
          </label>
          <label className="slider-row">
            <span>Contraste</span>
            <input type="range" min={-100} max={100} value={contrast} onChange={(event) => setContrast(Number(event.target.value))} />
            <span className="value">{contrast}</span>
          </label>
          <button type="button" className="btn tiny ghost" onClick={() => { setBrightness(0); setContrast(0); }}>
            Réinitialiser les réglages
          </button>
          <p className="tool-hint">L’alpha n’est pas modifié par ces réglages.</p>
          <span className="muted">Taille : {formatBytes(preview.data.length)}</span>
        </div>
        <div className="adjust-preview">
          <PreviewCanvas image={preview} max={240} />
        </div>
      </div>
    </Modal>
  );
}
