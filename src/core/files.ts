import type { Editability, FileEntry, FileKind } from '../shared/types';
import { relBasename, relDirname, relExt } from './paths';

export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tga', 'webp']);

/** Formats réellement pris en charge par l'éditeur intégré (décodage + réécriture). */
export const EDITABLE_IMAGE_EXTENSIONS = new Set(['png']);

export const TEXT_EXTENSIONS = new Set([
  'json', 'mcmeta', 'txt', 'lang', 'properties', 'yml', 'yaml', 'xml',
  'vsh', 'fsh', 'glsl', 'frag', 'vert', 'cfg', 'toml', 'csv', 'md',
]);

export function isImageName(relPath: string): boolean {
  return IMAGE_EXTENSIONS.has(relExt(relPath));
}

export function isEditableImageName(relPath: string): boolean {
  return EDITABLE_IMAGE_EXTENSIONS.has(relExt(relPath));
}

export function isTextName(relPath: string): boolean {
  return TEXT_EXTENSIONS.has(relExt(relPath));
}

export function editability(relPath: string): Editability {
  if (isEditableImageName(relPath)) return 'image';
  if (isTextName(relPath)) return 'text';
  return 'none';
}

export function fileKind(relPath: string): FileKind {
  const ext = relExt(relPath);
  const name = relBasename(relPath).toLowerCase();
  const normalized = relPath.toLowerCase();

  if (name === 'pack.mcmeta' || ext === 'mcmeta' && name === 'pack.mcmeta') return 'meta';
  if (name.endsWith('.png.mcmeta')) return 'texture';
  if (normalized.includes('/textures/') || normalized.startsWith('textures/')) return 'texture';
  if (normalized.includes('/models/') || normalized.includes('/blockstates/') || normalized.includes('/items/')) return 'model';
  if (normalized.includes('/lang/') || ext === 'lang') return 'lang';
  if (normalized.includes('/sounds/') || name === 'sounds.json') return 'sound';
  if (normalized.includes('/shaders/') || ['vsh', 'fsh', 'glsl', 'frag', 'vert'].includes(ext)) return 'shader';
  if (['mcmeta', 'json', 'txt', 'properties', 'yml', 'yaml', 'xml', 'toml', 'csv', 'md'].includes(ext)) return 'text';
  return 'other';
}

export function makeEntry(
  relPath: string,
  size: number,
  mtimeMs: number,
): FileEntry {
  return {
    relPath,
    name: relBasename(relPath),
    dir: relDirname(relPath),
    ext: relExt(relPath),
    size,
    mtimeMs,
    kind: fileKind(relPath),
    image: isImageName(relPath),
    editability: editability(relPath),
  };
}

export const KIND_LABELS: Record<FileKind, string> = {
  texture: 'Texture',
  model: 'Modèle',
  lang: 'Langue',
  sound: 'Son',
  shader: 'Shader',
  meta: 'Métadonnées',
  text: 'Texte',
  other: 'Autre',
};
