import { describe, expect, it } from 'vitest';
import {
  buildPackMcmeta,
  findPackVersion,
  PACK_FORMATS,
  PACK_FORMAT_SOURCE,
  resolvePackVersion,
  serializePackMcmeta,
  validatePackMcmeta,
} from '../src/shared/packFormats';

describe('table de compatibilité pack.mcmeta', () => {
  it('contient les formats ressource vérifiés', () => {
    expect(findPackVersion('1.20.1')?.major).toBe(15);
    expect(findPackVersion('1.21.9')?.major).toBe(69);
    expect(findPackVersion('1.21.11')?.major).toBe(75);
    expect(findPackVersion('26.1')?.major).toBe(84);
    expect(findPackVersion('26.2')?.major).toBe(88);
    expect(findPackVersion('26.3')).toMatchObject({ major: 97, minor: 1 });
    expect(PACK_FORMAT_SOURCE.url).toContain('minecraft.wiki');
    expect(PACK_FORMATS.every((version) => version.verified)).toBe(true);
  });

  it('génère pack_format pour 1.20.1 sans champs récents', () => {
    const version = resolvePackVersion('1.20').version;
    const meta = buildPackMcmeta('Mon pack', version);
    expect(meta).toEqual({ pack: { description: 'Mon pack', pack_format: 15 } });
    expect(validatePackMcmeta(meta, version).valid).toBe(true);
  });

  it('génère min_format/max_format pour 1.21.9 sans pack_format', () => {
    const version = resolvePackVersion('1.21.9').version;
    const meta = buildPackMcmeta('Pack moderne', version);
    expect(meta.pack).toEqual({
      description: 'Pack moderne',
      min_format: [69, 0],
      max_format: [69, 0],
    });
    expect('pack_format' in meta.pack).toBe(false);
    expect('supported_formats' in meta.pack).toBe(false);
    expect(validatePackMcmeta(meta, version).valid).toBe(true);
  });

  it('génère les formats mineurs récents (26.3 → 97.1)', () => {
    const version = resolvePackVersion('26.3').version;
    const meta = buildPackMcmeta('Pack 26.3', version);
    expect(meta.pack.min_format).toEqual([97, 1]);
    expect(meta.pack.max_format).toEqual([97, 1]);
  });

  it('échappe correctement les caractères spéciaux de la description', () => {
    const description = 'Pack « spécial » \\ test\nligne 2\t§aÉpée 🗡️';
    const version = resolvePackVersion('1.21.9').version;
    const meta = buildPackMcmeta(description, version);
    const text = serializePackMcmeta(meta);
    expect(() => JSON.parse(text)).not.toThrow();
    const parsed = JSON.parse(text) as { pack: { description: string } };
    expect(parsed.pack.description).toBe(description);
    expect(validatePackMcmeta(parsed, version).valid).toBe(true);
  });

  it('remplace une description vide', () => {
    const version = resolvePackVersion('1.21.9').version;
    expect(buildPackMcmeta('   ', version).pack.description).toBe('Resource pack');
  });

  it('accepte une version personnalisée mais avertit', () => {
    const resolved = resolvePackVersion('custom:80');
    expect(resolved.version.style).toBe('min_max');
    expect(resolved.version.verified).toBe(false);
    expect(resolved.warnings[0]).toContain('n’est pas connue');
    expect(resolvePackVersion('custom:30').version.style).toBe('pack_format');
    expect(() => resolvePackVersion('custom:abc')).toThrow();
    expect(() => resolvePackVersion('')).toThrow();
  });

  it('refuse les champs incompatibles avec la version', () => {
    const modern = resolvePackVersion('1.21.9').version;
    const legacy = resolvePackVersion('1.20').version;
    const invalidModern = validatePackMcmeta(
      { pack: { description: 'x', pack_format: 69, min_format: [69, 0], max_format: [69, 0] } },
      modern,
    );
    expect(invalidModern.valid).toBe(false);
    expect(invalidModern.errors.join(' ')).toContain('pack_format');

    const withSupported = validatePackMcmeta(
      { pack: { description: 'x', min_format: [69, 0], max_format: [69, 0], supported_formats: [69, 69] } },
      modern,
    );
    expect(withSupported.valid).toBe(false);

    const invalidLegacy = validatePackMcmeta(
      { pack: { description: 'x', pack_format: 15, min_format: [15, 0] } },
      legacy,
    );
    expect(invalidLegacy.valid).toBe(false);
    expect(invalidLegacy.errors.join(' ')).toContain('min_format');
  });

  it('refuse un pack.mcmeta sans description ou mal formé', () => {
    const version = resolvePackVersion('1.21.9').version;
    expect(validatePackMcmeta({ pack: {} }, version).valid).toBe(false);
    expect(validatePackMcmeta({ pack: { description: 42 } }, version).valid).toBe(false);
    expect(validatePackMcmeta(null, version).valid).toBe(false);
    expect(validatePackMcmeta({ pack: { description: 'ok', min_format: [69], max_format: [69] } }, version).valid).toBe(
      false,
    );
  });
});
