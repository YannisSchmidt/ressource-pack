import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ExportConfig } from '../src/shared/types';
import { ConflictError } from '../src/core/errors';
import { executeExport, prepareExport } from '../src/core/export';
import { ProjectManager } from '../src/core/project';
import { ZipSource } from '../src/core/source';
import { encodePng } from '../src/core/png';
import {
  buildZipSource,
  changeOnePixel,
  createTestProject,
  hashFile,
  hashTree,
  noProgress,
  solidPixmap,
  tempDir,
} from './helpers';

const created: string[] = [];
afterAll(async () => {
  await Promise.all(created.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
});

async function newProject() {
  const project = await createTestProject();
  created.push(project.baseDir, project.sourceDir, path.dirname(project.outputDir));
  return project;
}

function configFor(
  outputDir: string,
  overrides: Partial<ExportConfig> = {},
): ExportConfig {
  return {
    name: 'Pack de test',
    description: 'Textures modifiées pour le test',
    targetVersion: '1.21.9',
    format: 'folder',
    outputDir,
    outputName: 'PackDeTest',
    ...overrides,
  };
}

async function prepare(manager: ProjectManager, projectId: string, config: ExportConfig) {
  const snapshot = await manager.buildExportSnapshot(projectId);
  return prepareExport(snapshot, config);
}

async function walkFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) await walk(path.join(dir, dirent.name), rel);
      else result.push(rel);
    }
  };
  await walk(root, '');
  return result.sort();
}

describe('exportation du resource pack', () => {
  it('exporte une seule texture modifiée, sans aucun fichier original', async () => {
    const { manager, projectId, sourceDir, outputDir } = await newProject();
    const before = await hashTree(sourceDir);
    const relPath = 'assets/minecraft/textures/block/stone.png';
    await changeOnePixel(manager, projectId, relPath);
    const prepared = await prepare(manager, projectId, configFor(outputDir));
    expect(prepared.errors).toEqual([]);
    expect(prepared.files.map((file) => file.relPath)).toEqual([relPath]);
    expect(prepared.totalFiles).toBe(2);

    const report = await executeExport(prepared, noProgress());
    expect(report.verified).toBe(true);
    expect(report.fileCount).toBe(2);
    const files = await walkFiles(report.outputPath);
    expect(files).toEqual(['assets/minecraft/textures/block/stone.png', 'pack.mcmeta'].sort());

    const meta = JSON.parse(await fs.promises.readFile(path.join(report.outputPath, 'pack.mcmeta'), 'utf8')) as {
      pack: Record<string, unknown>;
    };
    expect(meta.pack).toMatchObject({ description: 'Textures modifiées pour le test', min_format: [69, 0], max_format: [69, 0] });
    expect('pack_format' in meta.pack).toBe(false);

    const exported = await fs.promises.readFile(path.join(report.outputPath, ...relPath.split('/')));
    const working = await manager.readWorkingFile(projectId, relPath);
    expect(exported.equals(working as Buffer)).toBe(true);

    const after = await hashTree(sourceDir);
    expect(after).toEqual(before);
  });

  it('exporte plusieurs fichiers de dossiers différents dans un ZIP sans dossier parent', async () => {
    const { manager, projectId, outputDir } = await newProject();
    await changeOnePixel(manager, projectId, 'assets/minecraft/textures/block/stone.png');
    await changeOnePixel(manager, projectId, 'assets/minecraft/textures/item/diamond_sword.png');
    const lang = await manager.openText(projectId, 'assets/minecraft/lang/fr_fr.json');
    await manager.saveText(projectId, 'assets/minecraft/lang/fr_fr.json', `${lang.text.trim()}\n`);

    const prepared = await prepare(
      manager,
      projectId,
      configFor(outputDir, { format: 'zip', outputName: 'PackZip' }),
    );
    const report = await executeExport(prepared, noProgress());
    expect(report.format).toBe('zip');
    expect(report.outputPath).toBe(path.join(outputDir, 'PackZip.zip'));
    expect(report.verified).toBe(true);
    expect(report.fileCount).toBe(4);

    const source = new ZipSource(report.outputPath);
    const scan = await source.scan(noProgress());
    expect(scan.entries.map((entry) => entry.relPath).sort()).toEqual(
      [
        'pack.mcmeta',
        'assets/minecraft/textures/block/stone.png',
        'assets/minecraft/textures/item/diamond_sword.png',
        'assets/minecraft/lang/fr_fr.json',
      ].sort(),
    );
    expect(scan.entries.some((entry) => entry.relPath.startsWith('PackZip/'))).toBe(false);
    const meta = JSON.parse((await source.read('pack.mcmeta')).toString('utf8')) as { pack: Record<string, unknown> };
    expect(meta.pack.min_format).toEqual([69, 0]);
  });

  it('adapte pack.mcmeta aux versions anciennes et récentes', async () => {
    const { manager, projectId, outputDir } = await newProject();
    await changeOnePixel(manager, projectId, 'assets/minecraft/textures/block/stone.png');

    const old = await prepare(manager, projectId, configFor(outputDir, { targetVersion: '1.20', outputName: 'Old' }));
    const oldReport = await executeExport(old, noProgress());
    const oldMeta = JSON.parse(await fs.promises.readFile(path.join(oldReport.outputPath, 'pack.mcmeta'), 'utf8')) as {
      pack: Record<string, unknown>;
    };
    expect(oldMeta.pack.pack_format).toBe(15);
    expect('min_format' in oldMeta.pack).toBe(false);

    const recent = await prepare(
      manager,
      projectId,
      configFor(outputDir, { targetVersion: '26.3', outputName: 'Recent' }),
    );
    const recentReport = await executeExport(recent, noProgress());
    const recentMeta = JSON.parse(
      await fs.promises.readFile(path.join(recentReport.outputPath, 'pack.mcmeta'), 'utf8'),
    ) as { pack: Record<string, unknown> };
    expect(recentMeta.pack.min_format).toEqual([97, 1]);
    expect(recentMeta.pack.max_format).toEqual([97, 1]);

    const unknown = await prepare(
      manager,
      projectId,
      configFor(outputDir, { targetVersion: 'custom:80', outputName: 'Unknown' }),
    );
    expect(unknown.warnings.some((warning) => warning.code === 'UNVERIFIED_VERSION')).toBe(true);
    expect(unknown.packMetaText).toContain('"min_format"');
  });

  it('ajoute pack.png et valide l’icône', async () => {
    const { manager, projectId, outputDir } = await newProject();
    await changeOnePixel(manager, projectId, 'assets/minecraft/textures/block/stone.png');
    const icon = encodePng(solidPixmap(128, 128, [30, 120, 200, 255]));
    await manager.setIcon(projectId, icon);

    const prepared = await prepare(manager, projectId, configFor(outputDir, { format: 'zip', outputName: 'Icone' }));
    expect(prepared.icon?.width).toBe(128);
    const report = await executeExport(prepared, noProgress());
    const source = new ZipSource(report.outputPath);
    const scan = await source.scan(noProgress());
    expect(scan.entries.map((entry) => entry.relPath)).toContain('pack.png');
    expect((await source.read('pack.png')).equals(icon)).toBe(true);
    expect(report.fileCount).toBe(3);
  });

  it('exclut les fichiers non modifiés, en erreur ou exclus', async () => {
    const { manager, projectId, outputDir } = await newProject();
    await changeOnePixel(manager, projectId, 'assets/minecraft/textures/block/stone.png');
    await changeOnePixel(manager, projectId, 'assets/minecraft/textures/block/glass.png');
    await manager.exclude(projectId, 'assets/minecraft/textures/block/glass.png');
    const prepared = await prepare(manager, projectId, configFor(outputDir, { outputName: 'Exclus' }));
    expect(prepared.files.map((file) => file.relPath)).toEqual([
      'assets/minecraft/textures/block/stone.png',
    ]);
    expect(prepared.warnings.some((warning) => warning.code === 'EXCLUDED_SKIPPED')).toBe(true);
    const report = await executeExport(prepared, noProgress());
    expect(report.files).not.toContain('assets/minecraft/textures/block/glass.png');
  });

  it('exporte un pack vide valide en avertissant clairement', async () => {
    const { manager, projectId, outputDir } = await newProject();
    const prepared = await prepare(manager, projectId, configFor(outputDir, { outputName: 'Vide' }));
    expect(prepared.warnings.some((warning) => warning.code === 'NO_CHANGES')).toBe(true);
    const report = await executeExport(prepared, noProgress());
    expect(report.files).toEqual(['pack.mcmeta']);
    expect(report.fileCount).toBe(1);
  });

  it('ne remplace jamais silencieusement un export existant', async () => {
    const { manager, projectId, outputDir } = await newProject();
    await changeOnePixel(manager, projectId, 'assets/minecraft/textures/block/stone.png');
    const firstConfig = configFor(outputDir, { outputName: 'Conflit' });
    const first = await prepare(manager, projectId, firstConfig);
    expect(first.conflict).toBe(false);
    const firstReport = await executeExport(first, noProgress());
    const firstHash = await hashFile(path.join(firstReport.outputPath, 'pack.mcmeta'));

    const second = await prepare(manager, projectId, firstConfig);
    expect(second.conflict).toBe(true);
    expect(second.suggestedName).not.toBe('Conflit');
    await expect(executeExport(second, noProgress())).rejects.toBeInstanceOf(ConflictError);
    expect(await hashFile(path.join(firstReport.outputPath, 'pack.mcmeta'))).toBe(firstHash);

    // Un autre nom est accepté sans confirmation.
    const renamed = await prepare(
      manager,
      projectId,
      configFor(outputDir, { outputName: second.suggestedName }),
    );
    const renamedReport = await executeExport(renamed, noProgress());
    expect(renamedReport.outputPath).not.toBe(firstReport.outputPath);

    // Remplacement explicitement confirmé.
    const overwrite = await prepare(
      manager,
      projectId,
      configFor(outputDir, { outputName: 'Conflit', overwrite: true }),
    );
    const overwriteReport = await executeExport(overwrite, noProgress());
    expect(overwriteReport.verified).toBe(true);
  });

  it('bloque l’export si une copie de travail a disparu', async () => {
    const { manager, projectId, outputDir } = await newProject();
    const relPath = 'assets/minecraft/textures/block/stone.png';
    await changeOnePixel(manager, projectId, relPath);
    const workFile = path.join(manager.projectDir(projectId), 'work', ...relPath.split('/'));
    await fs.promises.rm(workFile, { force: true });
    const prepared = await prepare(manager, projectId, configFor(outputDir, { outputName: 'CopieManquante' }));
    expect(prepared.errors.join(' ')).toContain('introuvable');
    await expect(executeExport(prepared, noProgress())).rejects.toThrow(/Export bloqué/i);
  });

  it('avertit si l’icône configurée est absente du disque', async () => {
    const { manager, projectId, outputDir } = await newProject();
    await changeOnePixel(manager, projectId, 'assets/minecraft/textures/block/stone.png');
    const icon = encodePng(solidPixmap(64, 64, [200, 120, 40, 255]));
    await manager.setIcon(projectId, icon);
    await fs.promises.rm(path.join(manager.projectDir(projectId), 'icon.png'), { force: true });
    const prepared = await prepare(manager, projectId, configFor(outputDir, { outputName: 'SansIcone' }));
    expect(prepared.warnings.some((warning) => warning.code === 'ICON_MISSING')).toBe(true);
    expect(prepared.icon).toBeUndefined();
  });

  it('nettoie la sortie si l’écriture échoue (disque plein simulé)', async () => {
    const { manager, projectId, outputDir } = await newProject();
    await changeOnePixel(manager, projectId, 'assets/minecraft/textures/block/stone.png');
    const prepared = await prepare(manager, projectId, configFor(outputDir, { outputName: 'Plein' }));
    let writes = 0;
    const error = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    await expect(
      executeExport(prepared, noProgress(), {
        writeFile: async (file, data) => {
          writes += 1;
          if (writes >= 2) throw error;
          await fs.promises.writeFile(file, data);
        },
      }),
    ).rejects.toThrow(/Espace disque/i);
    expect(await fs.promises.access(prepared.outputPath).then(() => true).catch(() => false)).toBe(false);
  });

  it('refuse d’écrire dans le dossier source importé', async () => {
    const { manager, projectId, sourceDir } = await newProject();
    await changeOnePixel(manager, projectId, 'assets/minecraft/textures/block/stone.png');
    const prepared = await prepare(manager, projectId, configFor(sourceDir, { outputName: 'Intrus' }));
    expect(prepared.errors.join(' ')).toContain('source');
    await expect(executeExport(prepared, noProgress())).rejects.toThrow(/Export bloqué/i);
    expect(await fs.promises.access(path.join(sourceDir, 'Intrus')).then(() => true).catch(() => false)).toBe(false);
  });

  it('exporte les copies de travail même si la source a disparu', async () => {
    const { manager, projectId, sourceDir, outputDir } = await newProject();
    await changeOnePixel(manager, projectId, 'assets/minecraft/textures/block/stone.png');
    await fs.promises.rm(sourceDir, { recursive: true, force: true });
    await manager.verifySource(projectId, noProgress());
    const prepared = await prepare(manager, projectId, configFor(outputDir, { outputName: 'SansSource' }));
    expect(prepared.warnings.some((warning) => warning.code === 'SOURCE_MISSING')).toBe(true);
    const report = await executeExport(prepared, noProgress());
    expect(report.fileCount).toBe(2);
    expect(await fs.promises.readFile(path.join(report.outputPath, ...'assets/minecraft/textures/block/stone.png'.split('/')))).toBeTruthy();
  });

  it('importe un ZIP, modifie et exporte sans altérer l’archive source', async () => {
    const baseDir = await tempDir('arp-zip-base-');
    const outputDir = path.join(await tempDir('arp-zip-out-'), 'exports');
    const zipDir = await tempDir('arp-zip-');
    const zipPath = path.join(zipDir, 'minecraft.zip');
    await buildZipSource(zipPath);
    created.push(baseDir, path.dirname(outputDir), zipDir);
    const hashBefore = await hashFile(zipPath);
    const manager = new ProjectManager({ baseDir, defaultOutputDir: outputDir });
    const view = await manager.create({ sourcePath: zipPath, sourceType: 'zip', name: 'Depuis ZIP' }, noProgress());
    expect(view.source.type).toBe('zip');
    await changeOnePixel(manager, view.id, 'assets/minecraft/textures/block/stone.png');
    const prepared = await prepare(
      manager,
      view.id,
      configFor(outputDir, { format: 'zip', outputName: 'DepuisZip' }),
    );
    const report = await executeExport(prepared, noProgress());
    expect(report.verified).toBe(true);
    expect(await hashFile(zipPath)).toBe(hashBefore);
  });

  it('produit un pack.mcmeta valide et échappé pour chaque version testée', async () => {
    const { manager, projectId, outputDir } = await newProject();
    await changeOnePixel(manager, projectId, 'assets/minecraft/textures/block/stone.png');
    for (const [version, expected] of [
      ['1.19.4', { pack_format: 13 }],
      ['1.20.2', { pack_format: 18 }],
      ['1.21.5', { pack_format: 55 }],
      ['1.21.9', { min_format: [69, 0], max_format: [69, 0] }],
      ['26.2', { min_format: [88, 0], max_format: [88, 0] }],
    ] as const) {
      const prepared = await prepare(
        manager,
        projectId,
        configFor(outputDir, {
          targetVersion: version,
          outputName: `Pack-${version}`,
          description: `Version "${version}" \\ test\n§a✓`,
        }),
      );
      const report = await executeExport(prepared, noProgress());
      const text = await fs.promises.readFile(path.join(report.outputPath, 'pack.mcmeta'), 'utf8');
      const parsed = JSON.parse(text) as { pack: Record<string, unknown> };
      expect(parsed.pack).toMatchObject(expected);
      expect(parsed.pack.description).toBe(`Version "${version}" \\ test\n§a✓`);
    }
  });
});
