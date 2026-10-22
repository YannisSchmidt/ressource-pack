/**
 * Table de compatibilité des resource packs Minecraft Java Edition.
 *
 * Source : Minecraft Wiki, « Pack format » (resource pack format history),
 * https://minecraft.wiki/w/Pack_format — relevé le 2026-10-22.
 *
 * Depuis la 1.21.9 (format ressource 69.0), `pack.mcmeta` utilise
 * `min_format` / `max_format` et n'accepte plus `supported_formats` si le pack
 * ne cible pas d'ancien format. Le champ `pack_format` reste utilisé par les
 * versions ≤ 1.21.8.
 */

export type PackMetaStyle = 'pack_format' | 'min_max';

export interface PackFormatVersion {
  /** Identifiant de la version ciblée (première version du groupe). */
  id: string;
  /** Libellé lisible (plage de versions couverte). */
  label: string;
  /** Format majeur (resource pack format). */
  major: number;
  /** Format mineur (0 avant 1.21.9). */
  minor: number;
  style: PackMetaStyle;
  /** Faux uniquement pour les versions saisies manuellement. */
  verified: boolean;
  note?: string;
}

export const PACK_FORMAT_SOURCE = {
  url: 'https://minecraft.wiki/w/Pack_format',
  checkedAt: '2026-10-22',
  title: 'Minecraft Wiki — Pack format',
};

/** Table vérifiée, du plus récent au plus ancien. */
export const PACK_FORMATS: PackFormatVersion[] = [
  { id: '26.3', label: '26.3', major: 97, minor: 1, style: 'min_max', verified: true },
  { id: '26.2', label: '26.2', major: 88, minor: 0, style: 'min_max', verified: true },
  { id: '26.1', label: '26.1 – 26.1.2', major: 84, minor: 0, style: 'min_max', verified: true },
  { id: '1.21.11', label: '1.21.11', major: 75, minor: 0, style: 'min_max', verified: true },
  { id: '1.21.9', label: '1.21.9 – 1.21.10', major: 69, minor: 0, style: 'min_max', verified: true },
  { id: '1.21.7', label: '1.21.7 – 1.21.8', major: 64, minor: 0, style: 'pack_format', verified: true },
  { id: '1.21.6', label: '1.21.6', major: 63, minor: 0, style: 'pack_format', verified: true },
  { id: '1.21.5', label: '1.21.5', major: 55, minor: 0, style: 'pack_format', verified: true },
  { id: '1.21.4', label: '1.21.4', major: 46, minor: 0, style: 'pack_format', verified: true },
  { id: '1.21.2', label: '1.21.2 – 1.21.3', major: 42, minor: 0, style: 'pack_format', verified: true },
  { id: '1.21', label: '1.21 – 1.21.1', major: 34, minor: 0, style: 'pack_format', verified: true },
  { id: '1.20.5', label: '1.20.5 – 1.20.6', major: 32, minor: 0, style: 'pack_format', verified: true },
  { id: '1.20.3', label: '1.20.3 – 1.20.4', major: 22, minor: 0, style: 'pack_format', verified: true },
  { id: '1.20.2', label: '1.20.2', major: 18, minor: 0, style: 'pack_format', verified: true },
  { id: '1.20', label: '1.20 – 1.20.1', major: 15, minor: 0, style: 'pack_format', verified: true },
  { id: '1.19.4', label: '1.19.4', major: 13, minor: 0, style: 'pack_format', verified: true },
  { id: '1.19.3', label: '1.19.3', major: 12, minor: 0, style: 'pack_format', verified: true },
  { id: '1.19', label: '1.19 – 1.19.2', major: 9, minor: 0, style: 'pack_format', verified: true },
  { id: '1.18', label: '1.18 – 1.18.2', major: 8, minor: 0, style: 'pack_format', verified: true },
  { id: '1.17', label: '1.17 – 1.17.1', major: 7, minor: 0, style: 'pack_format', verified: true },
  { id: '1.16.2', label: '1.16.2 – 1.16.5', major: 6, minor: 0, style: 'pack_format', verified: true },
  { id: '1.15', label: '1.15 – 1.16.1', major: 5, minor: 0, style: 'pack_format', verified: true },
  { id: '1.13', label: '1.13 – 1.14.4', major: 4, minor: 0, style: 'pack_format', verified: true },
  { id: '1.11', label: '1.11 – 1.12.2', major: 3, minor: 0, style: 'pack_format', verified: true },
  { id: '1.9', label: '1.9 – 1.10.2', major: 2, minor: 0, style: 'pack_format', verified: true },
  { id: '1.6.1', label: '1.6.1 – 1.8.9', major: 1, minor: 0, style: 'pack_format', verified: true },
];

export const DEFAULT_TARGET_VERSION = '1.21.9';

export interface ResolvedVersion {
  version: PackFormatVersion;
  warnings: string[];
}

/**
 * Versions couvertes par une entrée de groupe (ex. « 1.20.1 » → entrée « 1.20 »).
 * La table reste compacte tout en reconnaissant chaque version publiée.
 */
const VERSION_ALIASES: Record<string, string> = {
  '1.6.2': '1.6.1', '1.6.4': '1.6.1',
  '1.7.2': '1.6.1', '1.7.4': '1.6.1', '1.7.5': '1.6.1', '1.7.6': '1.6.1',
  '1.7.7': '1.6.1', '1.7.8': '1.6.1', '1.7.9': '1.6.1', '1.7.10': '1.6.1',
  '1.8': '1.6.1', '1.8.1': '1.6.1', '1.8.2': '1.6.1', '1.8.3': '1.6.1',
  '1.8.4': '1.6.1', '1.8.5': '1.6.1', '1.8.6': '1.6.1', '1.8.7': '1.6.1',
  '1.8.8': '1.6.1', '1.8.9': '1.6.1',
  '1.9.1': '1.9', '1.9.2': '1.9', '1.9.3': '1.9', '1.9.4': '1.9',
  '1.10': '1.9', '1.10.1': '1.9', '1.10.2': '1.9',
  '1.11.1': '1.11', '1.11.2': '1.11', '1.12': '1.11', '1.12.1': '1.11', '1.12.2': '1.11',
  '1.13.1': '1.13', '1.13.2': '1.13', '1.14': '1.13', '1.14.1': '1.13',
  '1.14.2': '1.13', '1.14.3': '1.13', '1.14.4': '1.13',
  '1.15.1': '1.15', '1.15.2': '1.15', '1.16': '1.15', '1.16.1': '1.15',
  '1.16.3': '1.16.2', '1.16.4': '1.16.2', '1.16.5': '1.16.2',
  '1.17.1': '1.17',
  '1.18.1': '1.18', '1.18.2': '1.18',
  '1.19.1': '1.19', '1.19.2': '1.19',
  '1.20.1': '1.20',
  '1.20.4': '1.20.3',
  '1.20.6': '1.20.5',
  '1.21.1': '1.21',
  '1.21.3': '1.21.2',
  '1.21.8': '1.21.7',
  '1.21.10': '1.21.9',
  '26.1.1': '26.1', '26.1.2': '26.1',
};

export function findPackVersion(id: string): PackFormatVersion | undefined {
  const direct = PACK_FORMATS.find((v) => v.id === id);
  if (direct) return direct;
  const alias = VERSION_ALIASES[id];
  return alias ? PACK_FORMATS.find((v) => v.id === alias) : undefined;
}

/**
 * Résout la version ciblée. Une version inconnue peut être fournie sous la forme
 * `custom:major` ou `custom:major.minor` : elle est alors marquée comme non vérifiée.
 */
export function resolvePackVersion(
  targetVersion: string,
  custom?: { major: number; minor?: number } | undefined,
): ResolvedVersion {
  const known = findPackVersion(targetVersion);
  if (known) return { version: known, warnings: [] };

  let major = custom?.major;
  let minor = custom?.minor ?? 0;
  const match = /^custom:(\d+)(?:\.(\d+))?$/.exec(targetVersion);
  if (match) {
    major = Number(match[1]);
    minor = match[2] ? Number(match[2]) : 0;
  }

  if (!Number.isInteger(major) || (major as number) < 1 || !Number.isInteger(minor) || minor < 0) {
    throw new Error(
      `Version Minecraft inconnue : « ${targetVersion} ». Choisissez une version de la table ou une version personnalisée valide.`,
    );
  }

  const style: PackMetaStyle = (major as number) >= 69 ? 'min_max' : 'pack_format';
  const id = targetVersion.startsWith('custom:') ? targetVersion : `custom:${major}${minor ? `.${minor}` : ''}`;
  const version: PackFormatVersion = {
    id,
    label: `Version personnalisée ${major}${minor ? `.${minor}` : ''} (non vérifiée)`,
    major: major as number,
    minor,
    style,
    verified: false,
    note: 'Cette version n’est pas présente dans la table vérifiée. La compatibilité n’est pas garantie.',
  };
  return {
    version,
    warnings: [
      `La version « ${targetVersion} » n’est pas connue de la table de compatibilité (relevé du ${PACK_FORMAT_SOURCE.checkedAt}). L’application ne peut pas garantir la compatibilité.`,
    ],
  };
}

export interface PackMeta {
  pack: Record<string, unknown>;
}

export interface PackMetaValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Construit l'objet `pack.mcmeta` exactement compatible avec la version résolue. */
export function buildPackMcmeta(description: string, version: PackFormatVersion): PackMeta {
  const clean = (description ?? '').replace(/\u0000/g, '').trim() || 'Resource pack';
  const pack: Record<string, unknown> = { description: clean };

  if (version.style === 'min_max') {
    pack.min_format = [version.major, version.minor];
    pack.max_format = [version.major, version.minor];
  } else {
    pack.pack_format = version.major;
  }
  return { pack };
}

export function serializePackMcmeta(meta: PackMeta): string {
  // JSON.stringify échappe guillemets, antislashs, sauts de ligne et caractères de contrôle.
  return `${JSON.stringify(meta, null, 2)}\n`;
}

export function validatePackMcmeta(
  value: unknown,
  version: PackFormatVersion,
): PackMetaValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['Le contenu de pack.mcmeta doit être un objet JSON.'], warnings };
  }
  const root = value as Record<string, unknown>;
  const pack = root.pack;
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) {
    return { valid: false, errors: ['Le champ « pack » est manquant ou invalide.'], warnings };
  }
  const p = pack as Record<string, unknown>;

  if (typeof p.description !== 'string') {
    errors.push('Le champ « description » doit être une chaîne de texte.');
  } else {
    if (!p.description.trim()) errors.push('La description ne doit pas être vide.');
    if (p.description.length > 512) warnings.push('La description est très longue (plus de 512 caractères).');
  }

  const isPair = (v: unknown): boolean =>
    Array.isArray(v) &&
    v.length === 2 &&
    v.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0);

  if (version.style === 'min_max') {
    if (!isPair(p.min_format)) errors.push('« min_format » doit être un tableau [majeur, mineur].');
    if (!isPair(p.max_format)) errors.push('« max_format » doit être un tableau [majeur, mineur].');
    if ('supported_formats' in p) {
      errors.push('« supported_formats » est interdit pour les packs 1.21.9+ ciblant un format ≥ 69.');
    }
    if ('pack_format' in p) {
      errors.push('« pack_format » ne doit pas être généré pour un pack 1.21.9+ ciblant uniquement un format récent.');
    }
    if (isPair(p.min_format) && isPair(p.max_format)) {
      const min = p.min_format as [number, number];
      const max = p.max_format as [number, number];
      if (min[0] > max[0] || (min[0] === max[0] && min[1] > max[1])) {
        errors.push('La plage de formats est incohérente (minimum supérieur au maximum).');
      }
      if (version.verified && (min[0] !== version.major || min[1] !== version.minor)) {
        warnings.push(
          `Le format déclaré ne correspond pas exactement à la version ciblée (${version.major}.${version.minor}).`,
        );
      }
    }
  } else {
    if (typeof p.pack_format !== 'number' || !Number.isInteger(p.pack_format)) {
      errors.push('« pack_format » doit être un entier.');
    } else if (version.verified && p.pack_format !== version.major) {
      warnings.push(`Le pack_format déclaré (${String(p.pack_format)}) diffère de la table (${version.major}).`);
    }
    if ('min_format' in p || 'max_format' in p) {
      errors.push('« min_format » / « max_format » ne doivent pas être utilisés avant la 1.21.9.');
    }
    if ('supported_formats' in p) {
      errors.push('« supported_formats » n’est pas généré : ciblage d’une version unique.');
    }
  }

  for (const key of Object.keys(root)) {
    if (key !== 'pack') warnings.push(`Champ racine ignoré par Minecraft : « ${key} ».`);
  }

  return { valid: errors.length === 0, errors, warnings };
}
