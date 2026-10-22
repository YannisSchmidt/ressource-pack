import crypto from 'node:crypto';

export function sha256(buffer: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Empreinte du contenu visuel : dimensions + pixels RGBA. */
export function sha256Pixels(width: number, height: number, data: Uint8Array): string {
  const header = Buffer.from(`pixels:${width}x${height}:`, 'utf8');
  return crypto.createHash('sha256').update(header).update(data).digest('hex');
}

export function shortHash(hash: string): string {
  return hash.slice(0, 10);
}
