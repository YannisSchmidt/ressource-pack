import { describe, expect, it } from 'vitest';
import {
  brightnessContrast,
  createPixmap,
  cropImage,
  drawLine,
  fillRect,
  floodFill,
  getPixel,
  MAX_IMAGE_DIMENSION,
  pasteRegion,
  pixmapsEqual,
  resizeCanvas,
  resizeImage,
  rotateImage,
  setPixel,
  stampBrush,
} from '../src/core/imageOps';
import { History } from '../src/core/history';

function makeImage(colors: number[][]): ReturnType<typeof createPixmap> {
  const width = colors.length;
  const height = colors[0]?.length ? 1 : 1;
  const image = createPixmap(width, height);
  for (let x = 0; x < width; x += 1) {
    const i = x * 4;
    image.data[i] = colors[x][0];
    image.data[i + 1] = colors[x][1];
    image.data[i + 2] = colors[x][2];
    image.data[i + 3] = colors[x][3];
  }
  return image;
}

describe('opérations d’image', () => {
  it('redimensionne en plus proche voisin sans interpoler (pixel art)', () => {
    const image = makeImage([
      [255, 0, 0, 255],
      [0, 255, 0, 255],
    ]);
    const up = resizeImage(image, 4, 2, 'nearest');
    expect([...getPixel(up, 0, 0)]).toEqual([255, 0, 0, 255]);
    expect([...getPixel(up, 1, 0)]).toEqual([255, 0, 0, 255]);
    expect([...getPixel(up, 2, 0)]).toEqual([0, 255, 0, 255]);
    expect([...getPixel(up, 3, 0)]).toEqual([0, 255, 0, 255]);
    const down = resizeImage(up, 2, 1, 'nearest');
    expect([...getPixel(down, 0, 0)]).toEqual([255, 0, 0, 255]);
    expect([...getPixel(down, 1, 0)]).toEqual([0, 255, 0, 255]);
  });

  it('préserve la transparence lors d’un redimensionnement', () => {
    const image = createPixmap(16, 16, [255, 0, 0, 255]);
    setPixel(image, 0, 0, [0, 0, 0, 0]);
    const resized = resizeImage(image, 32, 32, 'nearest');
    expect(getPixel(resized, 0, 0)[3]).toBe(0);
    expect(getPixel(resized, 2, 2)[3]).toBe(255);
    expect(getPixel(resized, 1, 0)[3]).toBe(0);
    const bilinear = resizeImage(image, 8, 8, 'bilinear');
    expect(bilinear.width).toBe(8);
    for (let i = 3; i < bilinear.data.length; i += 4) {
      expect(bilinear.data[i]).toBeGreaterThanOrEqual(0);
    }
    const box = resizeImage(image, 8, 8, 'box');
    expect(getPixel(box, 0, 0)[3]).toBeLessThan(255);
    expect(getPixel(box, 4, 4)[3]).toBe(255);
  });

  it('n’assombrit pas les bords transparents en bilinéaire (alpha prémultiplié)', () => {
    const image = createPixmap(2, 1);
    setPixel(image, 0, 0, [255, 0, 0, 255]);
    setPixel(image, 1, 0, [0, 0, 255, 0]);
    const resized = resizeImage(image, 8, 1, 'bilinear');
    const [r, , b] = getPixel(resized, 3, 0);
    expect(r).toBeGreaterThan(200);
    expect(b).toBeLessThan(120);
  });

  it('fait pivoter et retourne correctement', () => {
    const image = createPixmap(2, 3);
    image.data.fill(0);
    setPixel(image, 0, 0, [255, 0, 0, 255]);
    const rotated = rotateImage(image, 90);
    expect(rotated.width).toBe(3);
    expect(rotated.height).toBe(2);
    expect([...getPixel(rotated, 2, 0)]).toEqual([255, 0, 0, 255]);
    const back = rotateImage(rotated, 270);
    expect(pixmapsEqual(image, back)).toBe(true);
    const flipped = rotateImage(rotateImage(image, 180), 180);
    expect(pixmapsEqual(image, flipped)).toBe(true);
  });

  it('recadre et redimensionne le canevas', () => {
    const image = createPixmap(4, 4, [10, 20, 30, 255]);
    setPixel(image, 1, 1, [255, 0, 0, 255]);
    const cropped = cropImage(image, { x: 1, y: 1, width: 2, height: 2 });
    expect(cropped.width).toBe(2);
    expect([...getPixel(cropped, 0, 0)]).toEqual([255, 0, 0, 255]);
    const larger = resizeCanvas(image, 8, 8, 'center');
    expect(getPixel(larger, 0, 0)[3]).toBe(0);
    expect([...getPixel(larger, 3, 3)]).toEqual([255, 0, 0, 255]);
    const topLeft = resizeCanvas(image, 6, 6, 'top-left');
    expect([...getPixel(topLeft, 1, 1)]).toEqual([255, 0, 0, 255]);
  });

  it('remplit une zone contiguë sans déborder', () => {
    const image = createPixmap(4, 4);
    fillRect(image, { x: 0, y: 0, width: 2, height: 2 }, [255, 255, 255, 255]);
    const changed = floodFill(image, 0, 0, [0, 128, 0, 255]);
    expect(changed).toBe(4);
    expect([...getPixel(image, 1, 1)]).toEqual([0, 128, 0, 255]);
    expect(getPixel(image, 3, 3)[3]).toBe(0);
    const changedAll = floodFill(image, 3, 3, [0, 0, 255, 255], { contiguous: false });
    expect(changedAll).toBe(12);
  });

  it('dessine au crayon avec épaisseur et lignes continues', () => {
    const image = createPixmap(8, 8);
    stampBrush(image, 2, 2, 2, [255, 255, 0, 255]);
    expect(getPixel(image, 1, 1)[0]).toBe(255);
    expect(getPixel(image, 2, 2)[0]).toBe(255);
    expect(getPixel(image, 3, 3)[3]).toBe(0);
    drawLine(image, 0, 7, 7, 7, 1, [0, 0, 0, 255]);
    for (let x = 0; x < 8; x += 1) expect(getPixel(image, x, 7)[3]).toBe(255);
  });

  it('colle une région avec composition alpha', () => {
    const dest = createPixmap(2, 2, [0, 0, 0, 255]);
    const source = createPixmap(1, 1, [255, 0, 0, 128]);
    pasteRegion(dest, source, 0, 0);
    const [r, , , a] = getPixel(dest, 0, 0);
    expect(r).toBeGreaterThan(100);
    expect(a).toBe(255);
  });

  it('ajuste luminosité et contraste en conservant l’alpha', () => {
    const image = createPixmap(1, 1, [100, 100, 100, 120]);
    const brighter = brightnessContrast(image, 50, 0);
    expect(brighter.data[0]).toBe(150);
    expect(brighter.data[3]).toBe(120);
    const contrasted = brightnessContrast(image, 0, 50);
    expect(contrasted.data[0]).not.toBe(100);
  });

  it('refuse les dimensions absurdes', () => {
    const image = createPixmap(2, 2);
    expect(() => resizeImage(image, 0, 2)).toThrow(/1 pixel/);
    expect(() => resizeImage(image, MAX_IMAGE_DIMENSION + 1, 2)).toThrow(/limite/);
    expect(() => resizeImage(image, 2.5, 2)).toThrow(/entiers/);
    expect(() => resizeImage(image, 20000, 20000)).toThrow();
  });
});

describe('historique annuler/rétablir', () => {
  it('annule et rétablit des états successifs', () => {
    const history = new History<string>({ limit: 10, measure: (value) => value.length });
    let current = 'initial';
    history.push(current, 'A');
    current = 'A';
    history.push(current, 'B');
    current = 'B';
    expect(history.canUndo).toBe(true);
    const undoB = history.undo(current);
    expect(undoB?.state).toBe('A');
    expect(undoB?.label).toBe('B');
    const undoA = history.undo('A');
    expect(undoA?.state).toBe('initial');
    expect(history.canUndo).toBe(false);
    const redo = history.redo('initial');
    expect(redo?.state).toBe('A');
    const redo2 = history.redo('A');
    expect(redo2?.state).toBe('B');
    expect(history.canRedo).toBe(false);
  });

  it('borne l’historique en nombre d’états et en mémoire', () => {
    const history = new History<number[]>({ limit: 3, maxBytes: 24, measure: (value) => value.length });
    for (let i = 0; i < 6; i += 1) history.push([1, 2, 3, 4, 5, 6, 7, 8], `état ${i}`);
    expect(history.depth).toBeLessThanOrEqual(3);
    expect(history.bytes).toBeLessThanOrEqual(24);
  });

  it('vide la pile de rétablissement après une nouvelle action', () => {
    const history = new History<number>({ measure: () => 1 });
    history.push(1, 'un');
    history.undo(2);
    expect(history.canRedo).toBe(true);
    history.push(2, 'deux');
    expect(history.canRedo).toBe(false);
  });
});
