import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createTestProject,
  changeOnePixel,
  hashTree,
  makeApng,
  noProgress,
  solidPixmap,
  tempDir,
  writePixmap,
} from './helpers';
import { ProjectManager } from '../src/core/project';
import { sha256Pixels } from '../src/core/hash';

const created: string[] = [];
afterAll(async () => {
  await Promise.all(created.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
});

async function newProject(filler = 0) {
  const project = await createTestProject({ filler });
  created.push(project.baseDir, project.sourceDir, path.dirname(project.outputDir));
  return project;
}

describe('gestion du projet et suivi des modifications', () => {
  it('importe, indexe et expose les métadonnées de l’arborescence', async () => {
    const { manager, projectId, sourceDir } = await newProject();
    const view = await manager.open(projectId);
    expect(view.source.type).toBe('directory');
    expect(view.source.path).toBe(sourceDir);
    expect(view.stats.fileCount).toBeGreaterThan(10);
    expect(view.stats.folderCount).toBeGreaterThan(3);
    expect(view.sourceAvailable).toBe(true);

    const root = await manager.listDir(projectId, '');
    expect(root.entries.map((entry) => entry.name)).toContain('README.md');
    expect(root.parent).toBeNull();

    const blocks = await manager.listDir(projectId, 'assets/minecraft/textures/block');
    const stone = blocks.entries.find((entry) => entry.name === 'stone.png');
    expect(stone).toBeDefined();
    expect(stone?.width).toBe(16);
    expect(stone?.height).toBe(16);
    expect(stone?.editability).toBe('image');
    expect(blocks.entries.find((entry) => entry.name === 'corrupt.png')?.image).toBe(true);
    const mcmeta = blocks.entries.find((entry) => entry.name === 'stone.png.mcmeta');
    expect(mcmeta?.editability).toBe('text');
  });

  it('ouvre, modifie, enregistre puis restaure exactement l’image d’origine', async () => {
    const { manager, projectId, sourceDir } = await newProject();
    const before = await hashTree(sourceDir);
    const relPath = 'assets/minecraft/textures/block/stone.png';
    const { original, modified } = await changeOnePixel(manager, projectId, relPath);

    let stats = await manager.stats(projectId);
    expect(stats.modifiedCount).toBe(1);
    let changes = await manager.changesList(projectId);
    expect(changes[0]).toMatchObject({ relPath, status: 'modified', kind: 'image', workWidth: 16, workHeight: 16 });

    const reopened = await manager.openImage(projectId, relPath);
    expect(reopened.working).toBeDefined();
    expect(reopened.meta.hasWorkingCopy).toBe(true);
    const workingPixels = Buffer.from(reopened.working!.data, 'base64');
    expect(sha256Pixels(16, 16, workingPixels)).toBe(sha256Pixels(16, 16, modified.data));

    const restore = await manager.saveImage(
      projectId,
      relPath,
      original.width,
      original.height,
      Buffer.from(original.data),
    );
    expect(restore.restored).toBe(true);
    expect(restore.modified).toBe(false);
    stats = await manager.stats(projectId);
    expect(stats.modifiedCount).toBe(0);
    expect(await manager.changesList(projectId)).toHaveLength(0);
    expect(await manager.hasWorkingFile(projectId, relPath)).toBe(false);

    const after = await hashTree(sourceDir);
    expect(after).toEqual(before);
  });

  it('ne modifie jamais les fichiers sources et conserve les chemins relatifs', async () => {
    const { manager, projectId, sourceDir } = await newProject();
    const before = await hashTree(sourceDir);
    const stone = 'assets/minecraft/textures/block/stone.png';
    const sword = 'assets/minecraft/textures/item/diamond_sword.png';
    await changeOnePixel(manager, projectId, stone);
    const opened = await manager.openImage(projectId, sword);
    const image = {
      width: opened.original.width,
      height: opened.original.height,
      data: new Uint8Array(Buffer.from(opened.original.data, 'base64')),
    };
    image.data[0] = 1;
    await manager.saveImage(projectId, sword, image.width, image.height, Buffer.from(image.data));
    const after = await hashTree(sourceDir);
    expect(after).toEqual(before);
    const changes = await manager.changesList(projectId);
    expect(changes.map((change) => change.relPath).sort()).toEqual([stone, sword].sort());
    expect(changes.every((change) => change.originalSize > 0 && change.workSize > 0)).toBe(true);
  });

  it('conserve les modifications après fermeture et réouverture du projet', async () => {
    const { manager, projectId, baseDir, outputDir, sourceDir } = await newProject();
    const relPath = 'assets/minecraft/textures/item/diamond_sword.png';
    const { modified } = await changeOnePixel(manager, projectId, relPath);
    await manager.saveUi(projectId, { openTabs: [relPath], activeTab: relPath });
    await manager.close(projectId);

    const manager2 = new ProjectManager({ baseDir, defaultOutputDir: outputDir });
    const view = await manager2.open(projectId);
    expect(view.stats.modifiedCount).toBe(1);
    expect(view.ui?.activeTab).toBe(relPath);
    const image = await manager2.openImage(projectId, relPath);
    const pixels = Buffer.from(image.working!.data, 'base64');
    expect(sha256Pixels(modified.width, modified.height, pixels)).toBe(
      sha256Pixels(modified.width, modified.height, modified.data),
    );
    expect((await hashTree(sourceDir)).size).toBeGreaterThan(0);
  });

  it('édite un fichier texte JSON et revient à l’original', async () => {
    const { manager, projectId } = await newProject();
    const relPath = 'assets/minecraft/lang/fr_fr.json';
    const opened = await manager.openText(projectId, relPath);
    expect(opened.editable).toBe(true);
    expect(opened.text).toContain('Épée en diamant');
    const changed = `${opened.text.trim()}\n`;
    const saved = await manager.saveText(projectId, relPath, changed);
    expect(saved.modified).toBe(true);
    const after = await manager.openText(projectId, relPath);
    expect(after.modified).toBe(true);
    expect(after.text).toBe(changed);
    expect((await manager.stats(projectId)).modifiedCount).toBe(1);
    await manager.saveText(projectId, relPath, opened.originalText);
    expect((await manager.stats(projectId)).modifiedCount).toBe(0);
  });

  it('refuse d’éditer ou d’écraser un PNG animé (APNG)', async () => {
    const { manager, projectId, sourceDir } = await newProject();
    const relPath = 'assets/minecraft/textures/block/animated_test.png';
    await writePixmap(path.join(sourceDir, ...relPath.split('/')), {
      width: 16,
      height: 16,
      data: new Uint8Array(16 * 16 * 4),
    });
    await fs.promises.writeFile(path.join(sourceDir, ...relPath.split('/')), makeApng());
    await manager.rescan(projectId, noProgress());
    await expect(manager.openImage(projectId, relPath)).rejects.toThrow(/animée|APNG/i);
    await expect(
      manager.saveImage(projectId, relPath, 1, 1, Buffer.alloc(4)),
    ).rejects.toThrow(/animée|APNG/i);
  });

  it('refuse un PNG corrompu et signale un fichier illisible', async () => {
    const { manager, projectId, sourceDir } = await newProject();
    await expect(manager.openImage(projectId, 'assets/minecraft/textures/block/corrupt.png')).rejects.toThrow(
      /PNG|image/i,
    );
    await expect(manager.openImage(projectId, 'assets/minecraft/textures/block/stone.png.mcmeta')).rejects.toThrow(
      /PNG/i,
    );
    await expect(manager.openImage(projectId, 'assets/minecraft/textures/misc/fake.jpg')).rejects.toThrow(/PNG/i);

    if (process.getuid?.() !== 0) {
      const target = path.join(sourceDir, 'assets/minecraft/textures/block/grass_block_side.png');
      await fs.promises.chmod(target, 0o000);
      try {
        const info = await manager.info(projectId, 'assets/minecraft/textures/block/grass_block_side.png');
        expect(info.sourceMissing).toBe(true);
        await expect(
          manager.openImage(projectId, 'assets/minecraft/textures/block/grass_block_side.png'),
        ).rejects.toThrow(/source/i);
      } finally {
        await fs.promises.chmod(target, 0o644);
      }
    }
  });

  it('recherche récursivement, sans tenir compte de la casse, avec filtres et jokers', async () => {
    const { manager, projectId } = await newProject();
    const deep = await manager.search(projectId, { text: 'ancient_rune' });
    expect(deep.hits).toHaveLength(1);
    expect(deep.hits[0].relPath).toContain('level6/ancient_rune.png');

    const upper = await manager.search(projectId, { text: 'STONE' });
    expect(upper.hits.some((hit) => hit.name.startsWith('stone'))).toBe(true);

    const wildcard = await manager.search(projectId, { text: '*.png' });
    expect(wildcard.total).toBeGreaterThan(3);
    expect(wildcard.hits.every((hit) => hit.ext === 'png')).toBe(true);

    const json = await manager.search(projectId, { text: '', ext: 'json' });
    expect(json.hits.every((hit) => hit.ext === 'json')).toBe(true);
    expect(json.hits.some((hit) => hit.relPath.endsWith('fr_fr.json'))).toBe(true);

    const lang = await manager.search(projectId, { text: '', kind: 'lang' });
    expect(lang.hits.every((hit) => hit.kind === 'lang')).toBe(true);

    await changeOnePixel(manager, projectId, 'assets/minecraft/textures/block/stone.png');
    const modified = await manager.search(projectId, { text: '', modifiedOnly: true });
    expect(modified.hits.map((hit) => hit.relPath)).toEqual(['assets/minecraft/textures/block/stone.png']);

    const capped = await manager.search(projectId, { text: '*.png', limit: 2 });
    expect(capped.hits).toHaveLength(2);
    expect(capped.truncated).toBe(true);
  });

  it('génère des miniatures et expose les dimensions', async () => {
    const { manager, projectId } = await newProject();
    const thumb = await manager.thumbnail(
      projectId,
      'assets/minecraft/textures/gui/widgets.png',
      64,
    );
    expect(thumb?.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(thumb?.width).toBe(256);
    expect(thumb?.height).toBe(256);
    expect(thumb?.thumbWidth).toBeLessThanOrEqual(64);
    expect(await manager.thumbnail(projectId, 'assets/minecraft/textures/misc/fake.jpg', 64)).toBeNull();
    expect(await manager.thumbnail(projectId, 'assets/minecraft/lang/fr_fr.json', 64)).toBeNull();
  });

  it('exclut et réintègre une modification sans perdre la copie de travail', async () => {
    const { manager, projectId } = await newProject();
    const relPath = 'assets/minecraft/textures/block/stone.png';
    await changeOnePixel(manager, projectId, relPath);
    await manager.exclude(projectId, relPath, 'Test');
    let stats = await manager.stats(projectId);
    expect(stats.excludedCount).toBe(1);
    expect(stats.modifiedCount).toBe(0);
    expect(await manager.hasWorkingFile(projectId, relPath)).toBe(true);
    await manager.include(projectId, relPath);
    stats = await manager.stats(projectId);
    expect(stats.modifiedCount).toBe(1);
    expect(stats.excludedCount).toBe(0);
  });

  it('détecte les changements de la source et permet de la relocaliser', async () => {
    const { manager, projectId, sourceDir } = await newProject();
    await changeOnePixel(manager, projectId, 'assets/minecraft/textures/block/stone.png');
    const extra = path.join(sourceDir, 'assets/minecraft/textures/block/new_block.png');
    await writePixmap(extra, solidPixmap(16, 16, [9, 9, 9, 255]));

    const check = await manager.verifySource(projectId, noProgress());
    expect(check.available).toBe(true);
    expect(check.verified).toBe(true);
    expect(check.added).toContain('assets/minecraft/textures/block/new_block.png');

    const rescanned = await manager.rescan(projectId, noProgress());
    expect(rescanned.view.stats.fileCount).toBeGreaterThan(0);
    expect(rescanned.view.changes.some((change) => change.relPath.endsWith('stone.png'))).toBe(true);

    const moved = await tempDir();
    created.push(moved);
    const movedSource = path.join(moved, 'ressources');
    await fs.promises.cp(sourceDir, movedSource, { recursive: true });
    await fs.promises.rm(sourceDir, { recursive: true, force: true });

    const missing = await manager.verifySource(projectId, noProgress());
    expect(missing.available).toBe(false);
    const relocated = await manager.relocate(projectId, movedSource, noProgress());
    expect(relocated.sourceAvailable).toBe(true);
    expect(relocated.stats.modifiedCount).toBe(1);
    const image = await manager.openImage(projectId, 'assets/minecraft/textures/block/stone.png');
    expect(image.working).toBeDefined();
  });

  it('supprime un projet sans toucher à sa source', async () => {
    const { manager, projectId, sourceDir } = await newProject();
    const before = await hashTree(sourceDir);
    const projectDir = manager.projectDir(projectId);
    await manager.delete(projectId);
    await expect(fs.promises.access(projectDir)).rejects.toThrow();
    expect(await hashTree(sourceDir)).toEqual(before);
    expect((await manager.list()).find((summary) => summary.id === projectId)).toBeUndefined();
  });

  it('refuse un chemin de fichier hors du projet', async () => {
    const { manager, projectId } = await newProject();
    await expect(manager.openImage(projectId, '../secret.png')).rejects.toThrow();
    await expect(manager.info(projectId, 'inconnu.png')).rejects.toThrow();
  });
});
