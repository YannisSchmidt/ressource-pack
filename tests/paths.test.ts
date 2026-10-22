import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isPathInside,
  joinInside,
  nextAvailableName,
  normalizeRelPath,
  sanitizeFileName,
} from '../src/core/paths';

describe('sécurité des chemins', () => {
  it('normalise les séparateurs et les segments vides', () => {
    expect(normalizeRelPath('assets/minecraft/textures/block/stone.png')).toBe(
      'assets/minecraft/textures/block/stone.png',
    );
    expect(normalizeRelPath('./assets//textures/./stone.png')).toBe('assets/textures/stone.png');
    expect(normalizeRelPath('assets\\minecraft\\block\\stone.png')).toBe('assets/minecraft/block/stone.png');
  });

  it('refuse les traversées et chemins absolus', () => {
    expect(() => normalizeRelPath('../secret.png')).toThrow();
    expect(() => normalizeRelPath('assets/../../secret.png')).toThrow();
    expect(() => normalizeRelPath('/etc/passwd')).toThrow();
    expect(() => normalizeRelPath('C:\\Windows\\system32\\evil.dll')).toThrow();
    expect(() => normalizeRelPath('assets/\0hidden.png')).toThrow();
    expect(() => normalizeRelPath('')).toThrow();
  });

  it('refuse les noms impossibles à écrire sous Windows lors de l’export', () => {
    expect(() => normalizeRelPath('assets/aux.png', { forWrite: true })).toThrow();
    expect(() => normalizeRelPath('assets/name:bad.png', { forWrite: true })).toThrow();
    expect(normalizeRelPath('assets/texture.png', { forWrite: true })).toBe('assets/texture.png');
  });

  it('garantit que joinInside reste sous la racine', () => {
    const root = path.resolve('/tmp/source');
    expect(joinInside(root, 'assets/a.png')).toBe(path.join(root, 'assets/a.png'));
    expect(() => joinInside(root, '../outside.png')).toThrow();
    expect(() => joinInside(root, '/etc/passwd')).toThrow();
    expect(isPathInside(root, path.join(root, 'assets'))).toBe(true);
    expect(isPathInside(root, path.resolve('/tmp/other'))).toBe(false);
    expect(isPathInside(root, root)).toBe(false);
  });

  it('nettoie les noms de pack et évite les noms réservés', () => {
    expect(sanitizeFileName('Mon: Pack/Test')).toBe('Mon_ Pack_Test');
    expect(sanitizeFileName('   ')).toBe('MonResourcePack');
    expect(sanitizeFileName('CON')).toBe('_CON');
    expect(sanitizeFileName('pack.')).toBe('pack');
    expect(sanitizeFileName('a'.repeat(300)).length).toBeLessThanOrEqual(120);
  });

  it('propose un nom libre en cas de collision', () => {
    const taken = new Set(['Pack', 'Pack (2)']);
    expect(nextAvailableName('Pack', (name) => taken.has(name))).toBe('Pack (3)');
    expect(nextAvailableName('Autre', (name) => taken.has(name))).toBe('Autre');
  });
});
