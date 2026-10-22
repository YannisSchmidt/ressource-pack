import { UserError } from './errors';

export interface Pixmap {
  width: number;
  height: number;
  /** RGBA 8 bits, 4 octets par pixel, ligne par ligne. */
  data: Uint8Array;
}

export type ResizeMethod = 'nearest' | 'bilinear' | 'bicubic' | 'box';
export type Rotation = 90 | 180 | 270;
export type FlipAxis = 'horizontal' | 'vertical';

/** Limites de sécurité matérielles (pas des limites fonctionnelles arbitraires). */
export const MAX_IMAGE_DIMENSION = 16_384;
export const MAX_IMAGE_PIXELS = 100_000_000;

export const RESIZE_METHODS: { id: ResizeMethod; label: string; description: string }[] = [
  { id: 'nearest', label: 'Plus proche voisin', description: 'Pixel art préservé, aucun mélange. Recommandé pour Minecraft.' },
  { id: 'bilinear', label: 'Bilinéaire', description: 'Lissage doux, adapté aux dégradés.' },
  { id: 'bicubic', label: 'Bicubique', description: 'Lissage plus net, léger sur-échantillonnage.' },
  { id: 'box', label: 'Moyenne (box)', description: 'Réduction par moyenne de zone, préserve la transparence.' },
];

export function createPixmap(width: number, height: number, fill?: [number, number, number, number]): Pixmap {
  checkDimensions(width, height);
  const data = new Uint8Array(width * height * 4);
  if (fill) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
      data[i + 3] = fill[3];
    }
  }
  return { width, height, data };
}

export function checkDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new UserError('La largeur et la hauteur doivent être des nombres entiers.', 'INVALID_DIMENSIONS');
  }
  if (width < 1 || height < 1) {
    throw new UserError('La largeur et la hauteur doivent être supérieures ou égales à 1 pixel.', 'INVALID_DIMENSIONS');
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new UserError(
      `Dimension trop grande : ${width} × ${height} px. La limite de sécurité est de ${MAX_IMAGE_DIMENSION} px par côté.`,
      'DIMENSIONS_TOO_LARGE',
    );
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    const mb = Math.round((width * height * 4) / (1024 * 1024));
    throw new UserError(
      `Cette image nécessiterait environ ${mb} Mo en mémoire (${width} × ${height} px), au-delà de la limite de sécurité de ${MAX_IMAGE_PIXELS / 1_000_000} millions de pixels.`,
      'DIMENSIONS_TOO_LARGE',
    );
  }
}

export function clonePixmap(image: Pixmap): Pixmap {
  return { width: image.width, height: image.height, data: new Uint8Array(image.data) };
}

export function pixmapsEqual(a: Pixmap, b: Pixmap): boolean {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i += 1) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

function indexOf(image: Pixmap, x: number, y: number): number {
  return (y * image.width + x) * 4;
}

export function getPixel(image: Pixmap, x: number, y: number): [number, number, number, number] {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return [0, 0, 0, 0];
  const i = indexOf(image, x, y);
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
}

export function setPixel(image: Pixmap, x: number, y: number, color: [number, number, number, number]): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const i = indexOf(image, x, y);
  image.data[i] = color[0];
  image.data[i + 1] = color[1];
  image.data[i + 2] = color[2];
  image.data[i + 3] = color[3];
}

/**
 * Redimensionne une image en interpolant en alpha prémultiplié :
 * les pixels transparents ne tirent pas les couleurs vers le noir.
 */
export function resizeImage(image: Pixmap, width: number, height: number, method: ResizeMethod = 'nearest'): Pixmap {
  checkDimensions(width, height);
  if (width === image.width && height === image.height) return clonePixmap(image);
  if (method === 'nearest') return resizeNearest(image, width, height);
  if (method === 'box' && width <= image.width && height <= image.height) return resizeBox(image, width, height);
  if (method === 'bicubic') return resizeBicubic(image, width, height);
  return resizeBilinear(image, width, height);
}

function resizeNearest(image: Pixmap, width: number, height: number): Pixmap {
  const out = new Uint8Array(width * height * 4);
  const sw = image.width;
  const sh = image.height;
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / width));
      const si = (sy * sw + sx) * 4;
      const di = (y * width + x) * 4;
      out[di] = image.data[si];
      out[di + 1] = image.data[si + 1];
      out[di + 2] = image.data[si + 2];
      out[di + 3] = image.data[si + 3];
    }
  }
  return { width, height, data: out };
}

interface WeightedSample {
  r: number;
  g: number;
  b: number;
  a: number;
  w: number;
}

function bilinearAt(image: Pixmap, sx: number, sy: number): WeightedSample {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let dy = 0; dy < 2; dy += 1) {
    for (let dx = 0; dx < 2; dx += 1) {
      const w = (dx === 0 ? 1 - fx : fx) * (dy === 0 ? 1 - fy : fy);
      if (w === 0) continue;
      const px = Math.min(image.width - 1, Math.max(0, x0 + dx));
      const py = Math.min(image.height - 1, Math.max(0, y0 + dy));
      const i = (py * image.width + px) * 4;
      const alpha = image.data[i + 3] / 255;
      r += image.data[i] * alpha * w;
      g += image.data[i + 1] * alpha * w;
      b += image.data[i + 2] * alpha * w;
      a += image.data[i + 3] * w;
    }
  }
  return { r, g, b, a, w: 1 };
}

function resizeBilinear(image: Pixmap, width: number, height: number): Pixmap {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = ((y + 0.5) * image.height) / height - 0.5;
    for (let x = 0; x < width; x += 1) {
      const sx = ((x + 0.5) * image.width) / width - 0.5;
      const sample = bilinearAt(image, sx, sy);
      const di = (y * width + x) * 4;
      const alpha = sample.a / 255;
      if (alpha > 0) {
        out[di] = clampByte(sample.r / alpha);
        out[di + 1] = clampByte(sample.g / alpha);
        out[di + 2] = clampByte(sample.b / alpha);
      }
      out[di + 3] = clampByte(sample.a);
    }
  }
  return { width, height, data: out };
}

function cubicWeight(t: number): number {
  const a = -0.5;
  const at = Math.abs(t);
  if (at <= 1) return (a + 2) * at * at * at - (a + 3) * at * at + 1;
  if (at < 2) return a * at * at * at - 5 * a * at * at + 8 * a * at - 4 * a;
  return 0;
}

function resizeBicubic(image: Pixmap, width: number, height: number): Pixmap {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = ((y + 0.5) * image.height) / height - 0.5;
    const iy = Math.floor(sy);
    for (let x = 0; x < width; x += 1) {
      const sx = ((x + 0.5) * image.width) / width - 0.5;
      const ix = Math.floor(sx);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let totalWeight = 0;
      for (let dy = -1; dy <= 2; dy += 1) {
        const wy = cubicWeight(sy - (iy + dy));
        if (wy === 0) continue;
        const py = Math.min(image.height - 1, Math.max(0, iy + dy));
        for (let dx = -1; dx <= 2; dx += 1) {
          const wx = cubicWeight(sx - (ix + dx));
          const weight = wx * wy;
          if (weight === 0) continue;
          const px = Math.min(image.width - 1, Math.max(0, ix + dx));
          const i = (py * image.width + px) * 4;
          const alpha = image.data[i + 3] / 255;
          r += image.data[i] * alpha * weight;
          g += image.data[i + 1] * alpha * weight;
          b += image.data[i + 2] * alpha * weight;
          a += image.data[i + 3] * weight;
          totalWeight += weight;
        }
      }
      const di = (y * width + x) * 4;
      if (totalWeight !== 0) {
        const alpha = clampByte(a / totalWeight);
        if (alpha > 0) {
          out[di] = clampByte(r / totalWeight / (alpha / 255));
          out[di + 1] = clampByte(g / totalWeight / (alpha / 255));
          out[di + 2] = clampByte(b / totalWeight / (alpha / 255));
        }
        out[di + 3] = alpha;
      }
    }
  }
  return { width, height, data: out };
}

/** Moyenne de zone en alpha prémultiplié (réduction de haute qualité). */
function resizeBox(image: Pixmap, width: number, height: number): Pixmap {
  const out = new Uint8Array(width * height * 4);
  const scaleX = image.width / width;
  const scaleY = image.height / height;
  for (let y = 0; y < height; y += 1) {
    const sy0 = y * scaleY;
    const sy1 = (y + 1) * scaleY;
    const py0 = Math.max(0, Math.floor(sy0));
    const py1 = Math.min(image.height - 1, Math.ceil(sy1) - 1);
    for (let x = 0; x < width; x += 1) {
      const sx0 = x * scaleX;
      const sx1 = (x + 1) * scaleX;
      const px0 = Math.max(0, Math.floor(sx0));
      const px1 = Math.min(image.width - 1, Math.ceil(sx1) - 1);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let py = py0; py <= py1; py += 1) {
        for (let px = px0; px <= px1; px += 1) {
          const i = (py * image.width + px) * 4;
          const alpha = image.data[i + 3] / 255;
          r += image.data[i] * alpha;
          g += image.data[i + 1] * alpha;
          b += image.data[i + 2] * alpha;
          a += image.data[i + 3];
          count += 1;
        }
      }
      const di = (y * width + x) * 4;
      if (count > 0) {
        const alpha = a / count;
        if (alpha > 0) {
          out[di] = clampByte(r / count / (alpha / 255));
          out[di + 1] = clampByte(g / count / (alpha / 255));
          out[di + 2] = clampByte(b / count / (alpha / 255));
        }
        out[di + 3] = clampByte(alpha);
      }
    }
  }
  return { width, height, data: out };
}

export function rotateImage(image: Pixmap, rotation: Rotation): Pixmap {
  const swap = rotation !== 180;
  const width = swap ? image.height : image.width;
  const height = swap ? image.width : image.height;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      let dx: number;
      let dy: number;
      if (rotation === 90) {
        dx = image.height - 1 - y;
        dy = x;
      } else if (rotation === 180) {
        dx = image.width - 1 - x;
        dy = image.height - 1 - y;
      } else {
        dx = y;
        dy = image.width - 1 - x;
      }
      const si = (y * image.width + x) * 4;
      const di = (dy * width + dx) * 4;
      out[di] = image.data[si];
      out[di + 1] = image.data[si + 1];
      out[di + 2] = image.data[si + 2];
      out[di + 3] = image.data[si + 3];
    }
  }
  return { width, height, data: out };
}

export function flipImage(image: Pixmap, axis: FlipAxis): Pixmap {
  const out = new Uint8Array(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const dx = axis === 'horizontal' ? image.width - 1 - x : x;
      const dy = axis === 'vertical' ? image.height - 1 - y : y;
      const si = (y * image.width + x) * 4;
      const di = (dy * image.width + dx) * 4;
      out[di] = image.data[si];
      out[di + 1] = image.data[si + 1];
      out[di + 2] = image.data[si + 2];
      out[di + 3] = image.data[si + 3];
    }
  }
  return { width: image.width, height: image.height, data: out };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function cropImage(image: Pixmap, rect: Rect): Pixmap {
  const x = Math.max(0, Math.min(image.width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(image.height - 1, Math.round(rect.y)));
  const width = Math.max(1, Math.min(image.width - x, Math.round(rect.width)));
  const height = Math.max(1, Math.min(image.height - y, Math.round(rect.height)));
  const out = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const srcStart = ((y + row) * image.width + x) * 4;
    out.set(image.data.subarray(srcStart, srcStart + width * 4), row * width * 4);
  }
  return { width, height, data: out };
}

/** Modify the canvas size without scaling the pixels. */
export function resizeCanvas(
  image: Pixmap,
  width: number,
  height: number,
  anchor: 'top-left' | 'center' = 'center',
): Pixmap {
  checkDimensions(width, height);
  const out = new Uint8Array(width * height * 4);
  const offsetX = anchor === 'center' ? Math.floor((width - image.width) / 2) : 0;
  const offsetY = anchor === 'center' ? Math.floor((height - image.height) / 2) : 0;
  for (let y = 0; y < image.height; y += 1) {
    const dy = y + offsetY;
    if (dy < 0 || dy >= height) continue;
    for (let x = 0; x < image.width; x += 1) {
      const dx = x + offsetX;
      if (dx < 0 || dx >= width) continue;
      const si = (y * image.width + x) * 4;
      const di = (dy * width + dx) * 4;
      out[di] = image.data[si];
      out[di + 1] = image.data[si + 1];
      out[di + 2] = image.data[si + 2];
      out[di + 3] = image.data[si + 3];
    }
  }
  return { width, height, data: out };
}

export function fillRect(image: Pixmap, rect: Rect, color: [number, number, number, number]): void {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(image.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(image.height, Math.ceil(rect.y + rect.height));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      setPixel(image, x, y, color);
    }
  }
}

export function stampBrush(
  image: Pixmap,
  centerX: number,
  centerY: number,
  size: number,
  color: [number, number, number, number],
): void {
  const brush = Math.max(1, Math.round(size));
  const offset = Math.floor(brush / 2);
  for (let y = centerY - offset; y < centerY - offset + brush; y += 1) {
    for (let x = centerX - offset; x < centerX - offset + brush; x += 1) {
      setPixel(image, x, y, color);
    }
  }
}

export function drawLine(
  image: Pixmap,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
  color: [number, number, number, number],
): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - x);
  const dy = Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    stampBrush(image, x, y, size, color);
    if (x === tx && y === ty) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

function colorMatches(
  data: Uint8Array,
  i: number,
  color: [number, number, number, number],
  tolerance: number,
): boolean {
  return (
    Math.abs(data[i] - color[0]) <= tolerance &&
    Math.abs(data[i + 1] - color[1]) <= tolerance &&
    Math.abs(data[i + 2] - color[2]) <= tolerance &&
    Math.abs(data[i + 3] - color[3]) <= tolerance
  );
}

/** Remplissage par zone contiguë (4 directions) ou global, avec tolérance. */
export function floodFill(
  image: Pixmap,
  x: number,
  y: number,
  color: [number, number, number, number],
  options: { contiguous?: boolean; tolerance?: number } = {},
): number {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) return 0;
  const tolerance = Math.max(0, Math.min(255, options.tolerance ?? 0));
  const target = getPixel(image, px, py);
  if (target[0] === color[0] && target[1] === color[1] && target[2] === color[2] && target[3] === color[3]) {
    return 0;
  }
  if (options.contiguous === false) {
    let changed = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      if (colorMatches(image.data, i, target, tolerance)) {
        image.data[i] = color[0];
        image.data[i + 1] = color[1];
        image.data[i + 2] = color[2];
        image.data[i + 3] = color[3];
        changed += 1;
      }
    }
    return changed;
  }

  const visited = new Uint8Array(image.width * image.height);
  const stack: number[] = [py * image.width + px];
  let changed = 0;
  while (stack.length > 0) {
    const index = stack.pop() as number;
    if (visited[index]) continue;
    visited[index] = 1;
    const cx = index % image.width;
    const cy = (index - cx) / image.width;
    const i = index * 4;
    if (!colorMatches(image.data, i, target, tolerance)) continue;
    image.data[i] = color[0];
    image.data[i + 1] = color[1];
    image.data[i + 2] = color[2];
    image.data[i + 3] = color[3];
    changed += 1;
    if (cx > 0) stack.push(index - 1);
    if (cx < image.width - 1) stack.push(index + 1);
    if (cy > 0) stack.push(index - image.width);
    if (cy < image.height - 1) stack.push(index + image.width);
  }
  return changed;
}

/** Colle une région avec composition source-over (gère la transparence). */
export function pasteRegion(dest: Pixmap, source: Pixmap, x: number, y: number): void {
  for (let sy = 0; sy < source.height; sy += 1) {
    for (let sx = 0; sx < source.width; sx += 1) {
      const si = (sy * source.width + sx) * 4;
      const sa = source.data[si + 3];
      if (sa === 0) continue;
      const dx = Math.round(x) + sx;
      const dy = Math.round(y) + sy;
      if (dx < 0 || dy < 0 || dx >= dest.width || dy >= dest.height) continue;
      const di = (dy * dest.width + dx) * 4;
      if (sa === 255) {
        dest.data[di] = source.data[si];
        dest.data[di + 1] = source.data[si + 1];
        dest.data[di + 2] = source.data[si + 2];
        dest.data[di + 3] = 255;
        continue;
      }
      const srcA = sa / 255;
      const dstA = dest.data[di + 3] / 255;
      const outA = srcA + dstA * (1 - srcA);
      if (outA === 0) continue;
      for (let c = 0; c < 3; c += 1) {
        const src = source.data[si + c] / 255;
        const dst = dest.data[di + c] / 255;
        dest.data[di + c] = clampByte(((src * srcA + dst * dstA * (1 - srcA)) / outA) * 255);
      }
      dest.data[di + 3] = clampByte(outA * 255);
    }
  }
}

export function extractRegion(image: Pixmap, rect: Rect): Pixmap {
  return cropImage(image, rect);
}

export function brightnessContrast(
  image: Pixmap,
  brightness: number,
  contrast: number,
): Pixmap {
  const b = Math.max(-255, Math.min(255, brightness));
  const c = Math.max(-100, Math.min(100, contrast));
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  const out = new Uint8Array(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) {
    out[i] = clampByte(factor * (image.data[i] + b - 128) + 128);
    out[i + 1] = clampByte(factor * (image.data[i + 1] + b - 128) + 128);
    out[i + 2] = clampByte(factor * (image.data[i + 2] + b - 128) + 128);
    out[i + 3] = image.data[i + 3];
  }
  return { width: image.width, height: image.height, data: out };
}

/** Estime la mémoire nécessaire aux pixels d'une image. */
export function estimateMemoryBytes(width: number, height: number): number {
  return width * height * 4;
}

/** Dimensions normalisées qui restent dans les limites physiques. */
export function clampDimensions(
  width: number,
  height: number,
  maxWidth = MAX_IMAGE_DIMENSION,
  maxHeight = MAX_IMAGE_DIMENSION,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.min(maxWidth, Math.round(width))),
    height: Math.max(1, Math.min(maxHeight, Math.round(height))),
  };
}
