import type { FileEntry, FileKind, TreeNode } from '../shared/types';

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

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

export function formatDate(timestamp: number): string {
  if (!timestamp) return '—';
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(timestamp));
  } catch {
    return '—';
  }
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR').format(value);
}

export function dirname(relPath: string): string {
  const index = relPath.lastIndexOf('/');
  return index === -1 ? '' : relPath.slice(0, index);
}

export function basename(relPath: string): string {
  const index = relPath.lastIndexOf('/');
  return index === -1 ? relPath : relPath.slice(index + 1);
}

export function osDirname(target: string): string {
  const index = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'));
  return index <= 0 ? target : target.slice(0, index);
}

export function stripExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index <= 0 ? name : name.slice(0, index);
}

export function rectLabel(rect: { x: number; y: number; width: number; height: number }): string {
  return `${rect.width} × ${rect.height} px @ ${rect.x},${rect.y}`;
}

export function rgbaToHex(color: [number, number, number, number]): string {
  const [r, g, b] = color;
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((char) => char + char).join('') : clean.padEnd(6, '0').slice(0, 6);
  return [
    Number.parseInt(full.slice(0, 2), 16) || 0,
    Number.parseInt(full.slice(2, 4), 16) || 0,
    Number.parseInt(full.slice(4, 6), 16) || 0,
  ];
}

export function sortedFiles(
  entries: FileEntry[],
  sort: { key: 'name' | 'type' | 'size' | 'date'; dir: 1 | -1 },
): FileEntry[] {
  return [...entries].sort((a, b) => {
    let result = 0;
    switch (sort.key) {
      case 'type':
        result = a.ext.localeCompare(b.ext) || a.name.localeCompare(b.name, 'fr');
        break;
      case 'size':
        result = a.size - b.size || a.name.localeCompare(b.name, 'fr');
        break;
      case 'date':
        result = a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name, 'fr');
        break;
      default:
        result = a.name.localeCompare(b.name, 'fr', { numeric: true });
    }
    return result * sort.dir;
  });
}

export function findTreeNode(tree: TreeNode | undefined, target: string): TreeNode | undefined {
  if (!tree) return undefined;
  if (!target) return tree;
  let current: TreeNode | undefined = tree;
  for (const segment of target.split('/')) {
    current = current?.children.find((child) => child.name === segment);
    if (!current) return undefined;
  }
  return current;
}

export function breadcrumbParts(relDir: string): { label: string; path: string }[] {
  const parts = [{ label: 'Racine', path: '' }];
  let current = '';
  for (const segment of relDir.split('/').filter(Boolean)) {
    current = current ? `${current}/${segment}` : segment;
    parts.push({ label: segment, path: current });
  }
  return parts;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function isTextLike(ext: string): boolean {
  return ['json', 'mcmeta', 'txt', 'lang', 'properties', 'yml', 'yaml', 'xml', 'vsh', 'fsh', 'glsl', 'frag', 'vert', 'toml', 'csv', 'md'].includes(
    ext,
  );
}

export function bytesLabel(bytes: number): string {
  return formatBytes(bytes);
}
