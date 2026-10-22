import path from 'node:path';
import { UserError } from './errors';

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

export interface RelPathOptions {
  /** Refuse les noms impossibles à écrire sur Windows (export). */
  forWrite?: boolean;
}

/**
 * Normalise et valide un chemin relatif de resource pack.
 * - séparateurs « / », jamais de préfixe, jamais de segment « .. » ou « . » ;
 * - refuse les chemins absolus, lecteurs Windows, NUL et caractères de contrôle.
 */
export function normalizeRelPath(input: string, options: RelPathOptions = {}): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new UserError('Chemin de fichier vide.', 'INVALID_PATH');
  }
  const replaced = input.replace(/\\/g, '/');
  if (CONTROL_CHARS.test(replaced)) {
    throw new UserError(`Le chemin contient un caractère interdit : ${JSON.stringify(input)}`, 'INVALID_PATH');
  }
  if (replaced.startsWith('/') || /^[a-zA-Z]:/.test(replaced)) {
    throw new UserError(`Chemin absolu refusé : ${input}`, 'INVALID_PATH');
  }
  const segments = replaced.split('/');
  const result: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      throw new UserError(`Chemin relatif dangereux refusé : ${input}`, 'INVALID_PATH');
    }
    if (options.forWrite) {
      if (segment.endsWith('.') || segment.endsWith(' ')) {
        throw new UserError(`Nom de fichier invalide sous Windows : « ${segment} »`, 'INVALID_PATH');
      }
      const base = segment.split('.')[0]?.toLowerCase() ?? '';
      if (WINDOWS_RESERVED.has(base)) {
        throw new UserError(`Nom réservé sous Windows : « ${segment} »`, 'INVALID_PATH');
      }
      if (/[<>:"|?*]/.test(segment)) {
        throw new UserError(`Caractère interdit dans un nom de fichier : « ${segment} »`, 'INVALID_PATH');
      }
    }
    result.push(segment);
  }
  if (result.length === 0) {
    throw new UserError(`Chemin relatif invalide : ${input}`, 'INVALID_PATH');
  }
  return result.join('/');
}

export function relDirname(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? '' : relPath.slice(0, idx);
}

export function relBasename(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? relPath : relPath.slice(idx + 1);
}

export function relExt(relPath: string): string {
  const name = relBasename(relPath);
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return '';
  return name.slice(idx + 1).toLowerCase();
}

export function isPathInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function isSameOrInside(parent: string, child: string): boolean {
  return path.resolve(parent) === path.resolve(child) || isPathInside(parent, child);
}

/** Joint un chemin relatif à une racine en garantissant qu'il reste dans la racine. */
export function joinInside(root: string, relPath: string): string {
  const normalized = normalizeRelPath(relPath);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...normalized.split('/'));
  if (!isPathInside(resolvedRoot, target)) {
    throw new UserError(`Le chemin sort du dossier autorisé : ${relPath}`, 'PATH_ESCAPE');
  }
  return target;
}

/** Nettoie un nom de pack/fichier pour une utilisation multiplateforme. */
export function sanitizeFileName(name: string, fallback = 'MonResourcePack'): string {
  let cleaned = (name ?? '')
    .replace(CONTROL_CHARS, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 120);
  if (!cleaned) cleaned = fallback;
  const base = cleaned.split('.')[0]?.toLowerCase() ?? '';
  if (WINDOWS_RESERVED.has(base)) cleaned = `_${cleaned}`;
  return cleaned;
}

/** Évite les collisions en proposant « Nom (2) », « Nom (3) », etc. */
export function nextAvailableName(base: string, exists: (name: string) => boolean): string {
  if (!exists(base)) return base;
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `${base} (${i})`;
    if (!exists(candidate)) return candidate;
  }
  return `${base} (${Date.now()})`;
}

export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
