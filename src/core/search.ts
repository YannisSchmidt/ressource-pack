import type { ChangeRecord, FileEntry, FileKind, SearchHit, SearchQuery, SearchResult } from '../shared/types';

function normalize(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('fr');
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function extensionMatches(entry: FileEntry, filter: string): boolean {
  const extensions = filter
    .split(/[,;\s]+/)
    .map((ext) => ext.trim().toLowerCase().replace(/^\*?\.?/, ''))
    .filter(Boolean);
  return extensions.length === 0 || extensions.includes(entry.ext);
}

function kindMatches(entry: FileEntry, kind: SearchQuery['kind']): boolean {
  if (!kind || kind === 'all') return true;
  return entry.kind === (kind as FileKind);
}

/**
 * Recherche rapide sur l'index (aucune lecture disque) :
 * sous-chaîne insensible à la casse, jokers `*` et `?`, filtres extension/type/modifiés.
 */
export function searchEntries(
  entries: FileEntry[],
  query: SearchQuery,
  changes: Map<string, ChangeRecord> = new Map(),
): SearchResult {
  const started = Date.now();
  const raw = (query.text ?? '').trim();
  const text = normalize(raw);
  const limit = Math.max(1, Math.min(2000, query.limit ?? 300));
  const hasWildcard = /[*?]/.test(raw);
  const wildcard = hasWildcard ? wildcardToRegExp(raw) : null;
  const nameOnly = raw.replace(/^[*]+/, '').replace(/[*]+$/, '');
  const nameNeedle = normalize(nameOnly);
  const hits: { entry: FileEntry; score: number; change?: ChangeRecord }[] = [];

  for (const entry of entries) {
    if (query.ext && !extensionMatches(entry, query.ext)) continue;
    if (!kindMatches(entry, query.kind)) continue;
    const change = changes.get(entry.relPath);
    if (query.modifiedOnly && !change) continue;

    let score: number;
    if (!text) {
      if (query.modifiedOnly || query.ext || (query.kind && query.kind !== 'all')) {
        score = 50;
      } else {
        continue;
      }
    } else if (wildcard) {
      if (!wildcard.test(entry.name) && !wildcard.test(entry.relPath)) continue;
      score = wildcard.test(entry.name) ? 0 : 4;
    } else {
      const name = normalize(entry.name);
      const path = normalize(entry.relPath);
      if (name === nameNeedle) score = 0;
      else if (name.startsWith(nameNeedle)) score = 1;
      else if (name.includes(nameNeedle)) score = 2;
      else if (path.includes(text)) score = 3;
      else continue;
    }

    if (change) score -= 0.5;
    hits.push({ entry, score, change });
  }

  hits.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.entry.name.length !== b.entry.name.length) return a.entry.name.length - b.entry.name.length;
    return a.entry.relPath.localeCompare(b.entry.relPath, 'fr');
  });

  const total = hits.length;
  const selected = hits.slice(0, limit).map<SearchHit>(({ entry, change }) => ({
    ...entry,
    modified: Boolean(change && change.status === 'modified'),
    excluded: Boolean(change && change.status === 'excluded'),
  }));

  return {
    query: raw,
    total,
    hits: selected,
    truncated: total > selected.length,
    durationMs: Date.now() - started,
  };
}
