import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DirectorySource, openSource, ZipSource } from '../src/core/source';
import { buildTree } from '../src/core/tree';
import { buildMinecraftTree, buildZipSource, FILLER_PNG, noProgress, tempDir, writeRawZip } from './helpers';
import { normalizeRelPath } from '../src/core/paths';

describe('importation et indexation des sources', () => {
  it('importe un dossier avec de nombreux niveaux imbriqués', async () => {
    const root = await tempDir();
    await buildMinecraftTree(root, { deepLevels: 8 });
    const source = await openSource(root);
    expect(source.type).toBe('directory');
    const scan = await source.scan(noProgress());
    expect(scan.cancelled).toBe(false);
    expect(scan.entries.length).toBeGreaterThan(10);
    expect(scan.entries.some((entry) => entry.relPath.endsWith('ancient_rune.png'))).toBe(true);
    const deep = scan.entries.find((entry) => entry.relPath.includes('level6/ancient_rune.png'));
    expect(deep?.relPath).toContain('level1/level2/level3/level4/level5/level6');

    const tree = buildTree(scan.entries);
    let node = tree;
    for (const level of ['assets', 'minecraft', 'textures', 'custom', 'deep', 'level1', 'level2', 'level3', 'level4', 'level5', 'level6']) {
      const child = node.children.find((candidate) => candidate.name === level);
      expect(child, `dossier ${level}`).toBeDefined();
      node = child as typeof node;
    }
    expect(node.files).toBe(1);
    expect(node.totalFiles).toBe(1);

    const bytes = await source.read('assets/minecraft/textures/block/stone.png');
    expect(bytes.length).toBeGreaterThan(50);
    await expect(source.read('../secret')).rejects.toThrow();
    await expect(source.read('/etc/passwd')).rejects.toThrow();
  });

  it('parcourt des milliers de fichiers avec progression, sans blocage', async () => {
    const root = await tempDir();
    const target = path.join(root, 'assets', 'minecraft', 'textures', 'block', 'filler');
    await fs.promises.mkdir(target, { recursive: true });
    const count = 3000;
    for (let i = 0; i < count; i += 1) {
      await fs.promises.writeFile(path.join(target, `demo_${String(i).padStart(5, '0')}.png`), FILLER_PNG);
    }
    const source = new DirectorySource(root);
    let progressCalls = 0;
    const started = Date.now();
    const scan = await source.scan({
      isCancelled: () => false,
      onProgress: () => {
        progressCalls += 1;
      },
    });
    const duration = Date.now() - started;
    expect(scan.entries.length).toBeGreaterThanOrEqual(count);
    expect(progressCalls).toBeGreaterThan(0);
    expect(duration).toBeLessThan(20_000);
  });

  it('annule une opération de scan en cours', async () => {
    const root = await tempDir();
    await fs.promises.mkdir(path.join(root, 'a'), { recursive: true });
    await fs.promises.writeFile(path.join(root, 'a', 'x.png'), FILLER_PNG);
    const source = new DirectorySource(root);
    await expect(
      source.scan({ isCancelled: () => true, onProgress: () => undefined }),
    ).rejects.toThrow(/annulée/i);
  });

  it('importe une archive ZIP sans extraction complète', async () => {
    const dir = await tempDir();
    const zipPath = path.join(dir, 'pack.zip');
    await buildZipSource(zipPath);
    const source = await openSource(zipPath);
    expect(source.type).toBe('zip');
    const scan = await source.scan(noProgress());
    expect(scan.entries.find((entry) => entry.relPath === 'assets/minecraft/textures/block/stone.png')).toBeDefined();
    const bytes = await source.read('assets/minecraft/textures/block/stone.png', 64 * 1024);
    expect(bytes.length).toBeGreaterThan(50);
    await expect(source.read('inexistant.png')).rejects.toThrow(/introuvable/i);
  });

  it('refuse une archive contenant un chemin dangereux sans rien extraire', async () => {
    const dir = await tempDir();
    const zipPath = path.join(dir, 'hostile.zip');
    await writeRawZip(zipPath, [
      { name: '../escape.png', data: FILLER_PNG },
      { name: 'assets/ok.png', data: FILLER_PNG },
    ]);
    const source = new ZipSource(zipPath);
    await expect(source.scan(noProgress())).rejects.toThrow(/dangereux|refusée/i);
    expect(await fs.promises.readdir(dir)).toEqual(['hostile.zip']);
  });

  it('normalise les antislashs et signale les doublons d’archive', async () => {
    const dir = await tempDir();
    const zipPath = path.join(dir, 'doublons.zip');
    await writeRawZip(zipPath, [
      { name: 'assets/ok.png', data: FILLER_PNG },
      { name: 'assets/ok.png', data: FILLER_PNG },
      { name: 'assets/windows\\path.png', data: FILLER_PNG },
    ]);
    const source = new ZipSource(zipPath);
    const scan = await source.scan(noProgress());
    const paths = scan.entries.map((entry) => entry.relPath);
    expect(paths).toEqual(expect.arrayContaining(['assets/ok.png', 'assets/windows/path.png']));
    expect(scan.duplicates).toContain('assets/ok.png');
    expect(scan.entries.filter((entry) => entry.relPath === 'assets/ok.png')).toHaveLength(1);
  });

  it('signale un dossier illisible sans faire échouer tout le scan', async () => {
    if (process.getuid?.() === 0) return;
    const root = await tempDir();
    await fs.promises.mkdir(path.join(root, 'visible'), { recursive: true });
    await fs.promises.writeFile(path.join(root, 'visible', 'ok.png'), FILLER_PNG);
    const blocked = path.join(root, 'blocked');
    await fs.promises.mkdir(blocked);
    await fs.promises.chmod(blocked, 0o000);
    try {
      const scan = await new DirectorySource(root).scan(noProgress());
      expect(scan.entries.some((entry) => entry.relPath === 'visible/ok.png')).toBe(true);
      expect(scan.warnings.some((warning) => warning.code === 'DIR_UNREADABLE')).toBe(true);
    } finally {
      await fs.promises.chmod(blocked, 0o755);
    }
  });

  it('rejette une source inexistante avec un message clair', async () => {
    await expect(openSource('/chemin/qui/n/existe/pas')).rejects.toThrow(/introuvable|Impossible/i);
    await expect(openSource(path.join(await tempDir(), 'fichier.txt'))).rejects.toThrow();
  });

  it('normalise les séparateurs sans accepter de sortie de racine', () => {
    expect(normalizeRelPath('assets\\minecraft\\textures\\stone.png')).toBe(
      'assets/minecraft/textures/stone.png',
    );
    expect(() => normalizeRelPath('..\\escape.png')).toThrow();
  });
});
