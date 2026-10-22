import { PNG } from 'pngjs';
import { UserError } from './errors';
import {
  checkDimensions,
  resizeImage,
  type Pixmap,
} from './imageOps';

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp' | 'tga';

export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
  animated: boolean;
  bitDepth?: number;
  colorType?: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

/** Lit les métadonnées d'une image sans la décoder entièrement quand c'est possible. */
export function imageInfo(buffer: Buffer): ImageInfo | null {
  if (buffer.length < 24) return null;
  try {
    if (isPng(buffer)) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      const bitDepth = buffer[24];
      const colorType = buffer[25];
      let animated = false;
      let offset = 8;
      while (offset + 8 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        if (type === 'acTL') animated = true;
        if (type === 'IDAT' || type === 'IEND') break;
        offset += 12 + length;
        if (length < 0 || offset <= 8) break;
      }
      if (width <= 0 || height <= 0) return null;
      return { format: 'png', width, height, animated, bitDepth, colorType };
    }

    // JPEG
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      let pos = 2;
      while (pos + 9 < buffer.length) {
        if (buffer[pos] !== 0xff) {
          pos += 1;
          continue;
        }
        const marker = buffer[pos + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          pos += 2;
          continue;
        }
        if (marker === 0xd9 || marker === 0xda) break;
        const length = buffer.readUInt16BE(pos + 2);
        const isSof =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf);
        if (isSof && pos + 9 < buffer.length) {
          const height = buffer.readUInt16BE(pos + 5);
          const width = buffer.readUInt16BE(pos + 7);
          if (width > 0 && height > 0) {
            return { format: 'jpeg', width, height, animated: false };
          }
          break;
        }
        if (length < 2) break;
        pos += 2 + length;
      }
      return null;
    }

    // GIF
    const gifHeader = buffer.toString('ascii', 0, 6);
    if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      let frames = 0;
      for (let i = 13; i < buffer.length - 1; i += 1) {
        if (buffer[i] === 0x21 && buffer[i + 1] === 0xf9) frames += 1;
      }
      if (width > 0 && height > 0) {
        return { format: 'gif', width, height, animated: frames > 1 };
      }
      return null;
    }

    // BMP
    if (buffer[0] === 0x42 && buffer[1] === 0x4d && buffer.length >= 26) {
      const width = buffer.readInt32LE(18);
      const height = Math.abs(buffer.readInt32LE(22));
      if (width > 0 && height > 0) {
        return { format: 'bmp', width, height, animated: false };
      }
    }

    // WebP
    if (
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP' &&
      buffer.length >= 30
    ) {
      const chunk = buffer.toString('ascii', 12, 16);
      if (chunk === 'VP8X') {
        const width = buffer.readUIntLE(24, 3) + 1;
        const height = buffer.readUIntLE(27, 3) + 1;
        const animated = (buffer[20] & 0x02) !== 0;
        return { format: 'webp', width, height, animated };
      }
      if (chunk === 'VP8L' && buffer[20] === 0x2f) {
        const bits = buffer.readUInt32LE(21);
        const width = (bits & 0x3fff) + 1;
        const height = ((bits >> 14) & 0x3fff) + 1;
        return { format: 'webp', width, height, animated: false };
      }
      if (chunk === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
        const width = buffer.readUInt16LE(26) & 0x3fff;
        const height = buffer.readUInt16LE(28) & 0x3fff;
        if (width > 0 && height > 0) return { format: 'webp', width, height, animated: false };
      }
    }

    // TGA (pas de nombre magique fiable, entête à l'offset 0)
    if (buffer.length >= 18) {
      const imageType = buffer[2];
      const width = buffer.readUInt16LE(12);
      const height = buffer.readUInt16LE(14);
      const depth = buffer[16];
      if ([1, 2, 3, 9, 10, 11].includes(imageType) && width > 0 && height > 0 && [8, 16, 24, 32].includes(depth)) {
        return { format: 'tga', width, height, animated: imageType === 9 || imageType === 10 || imageType === 11 };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Décode un PNG en pixels RGBA. Refuse les images démesurées avant allocation. */
export function decodePng(buffer: Buffer): Pixmap {
  const info = imageInfo(buffer);
  if (!info || info.format !== 'png') {
    throw new UserError('Ce fichier n’est pas un PNG valide ou reconnaissable.', 'INVALID_PNG');
  }
  checkDimensions(info.width, info.height);
  try {
    const png = PNG.sync.read(buffer);
    const expected = png.width * png.height * 4;
    if (png.data.length < expected) {
      throw new Error('Données RGBA incomplètes');
    }
    const data = new Uint8Array(png.data.buffer, png.data.byteOffset, expected);
    return { width: png.width, height: png.height, data };
  } catch (error) {
    throw new UserError(
      `Impossible de décoder ce PNG : ${error instanceof Error ? error.message : String(error)}`,
      'PNG_DECODE_FAILED',
    );
  }
}

export function encodePng(image: Pixmap): Buffer {
  checkDimensions(image.width, image.height);
  if (image.data.length !== image.width * image.height * 4) {
    throw new UserError('Les données de l’image sont incohérentes avec ses dimensions.', 'INVALID_PIXELS');
  }
  try {
    const png = {
      width: image.width,
      height: image.height,
      data: Buffer.from(image.data),
    } as unknown as PNG;
    return PNG.sync.write(png, {
      colorType: 6,
      inputColorType: 6,
      inputHasAlpha: true,
      deflateLevel: 9,
    });
  } catch (error) {
    throw new UserError(
      `Impossible d’encoder le PNG : ${error instanceof Error ? error.message : String(error)}`,
      'PNG_ENCODE_FAILED',
    );
  }
}

export function bufferToDataUrl(buffer: Buffer, mime = 'image/png'): string {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export function pixelsToDataUrl(image: Pixmap, mime = 'image/png'): string {
  return bufferToDataUrl(encodePng(image), mime);
}

export interface ThumbnailResult {
  dataUrl: string;
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
}

/**
 * Miniature PNG. Seuls les PNG sont décodés ; les autres formats sont affichés
 * avec une icône générique par l'interface (aucun décodeur externe n'est requis).
 */
export function makeThumbnail(buffer: Buffer, maxSize = 96): ThumbnailResult | null {
  if (!isPng(buffer)) return null;
  let image: Pixmap;
  try {
    image = decodePng(buffer);
  } catch {
    return null;
  }
  if (maxSize <= 0) return null;
  const ratio = Math.min(1, maxSize / Math.max(image.width, image.height));
  const thumbWidth = Math.max(1, Math.round(image.width * ratio));
  const thumbHeight = Math.max(1, Math.round(image.height * ratio));
  if (ratio === 1) {
    return {
      dataUrl: bufferToDataUrl(buffer),
      width: image.width,
      height: image.height,
      thumbWidth,
      thumbHeight,
    };
  }
  const thumb = resizeImage(image, thumbWidth, thumbHeight, 'box');
  return {
    dataUrl: bufferToDataUrl(encodePng(thumb)),
    width: image.width,
    height: image.height,
    thumbWidth,
    thumbHeight,
  };
}

export function pngDimensions(buffer: Buffer): { width: number; height: number; animated: boolean } | null {
  const info = imageInfo(buffer);
  if (!info || info.format !== 'png') return null;
  return { width: info.width, height: info.height, animated: info.animated };
}
