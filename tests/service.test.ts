import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ExportConfig, TaskState } from '../src/shared/types';
import { Service, type ServiceHost } from '../src/core/service';
import { buildMinecraftTree, changeOnePixel, createTestProject, hashTree, noProgress, tempDir } from './helpers';
import { ProjectManager } from '../src/core/project';

const cleanup: string[] = [];
afterAll(async () => {
  await Promise.all(cleanup.map((target) => fs.promises.rm(target, { recursive: true, force: true })));
});

function stubHost(): ServiceHost {
  return {
    nativeDialogs: false,
    demo: false,
    canOpenPaths: true,
    pickSource: async () => ({ cancelled: true }),
    pickOutputDir: async () => ({ cancelled: true }),
    pickFile: async () => ({ cancelled: true }),
    openPath: async () => '',
    revealPath: async () => undefined,
  };
}

async function waitForTask(service: Service, taskId: string): Promise<TaskState> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const task = (await service.call('task.get', { taskId })) as TaskState;
    if (task.status !== 'running') return task;
    if (Date.now() > deadline) throw new Error('Tâche non terminée dans le délai imparti.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('service RPC et tâches', () => {
  it('crée un projet via une tâche suivie, puis expose fichiers et recherches', async () => {
    const baseDir = await tempDir('arp-svc-base-');
    const sourceDir = await tempDir('arp-svc-src-');
    const outputDir = path.join(await tempDir('arp-svc-out-'), 'exports');
    cleanup.push(baseDir, sourceDir, path.dirname(outputDir));
    await buildMinecraftTree(sourceDir);
    const service = new Service({ baseDir, host: stubHost(), defaultOutputDir: outputDir, version: 'test' });
    await service.init();

    const info = (await service.call('app.info', {})) as { projects: unknown[]; settings: { autosave: boolean } };
    expect(info.projects).toHaveLength(0);
    expect(info.settings.autosave).toBe(true);

    const created = (await service.call('project.create', {
      sourcePath: sourceDir,
      name: 'Projet service',
    })) as { taskId: string };
    const task = await waitForTask(service, created.taskId);
    expect(task.status).toBe('done');
    const result = task.result as { projectId: string; view: { stats: { fileCount: number } } };
    expect(result.view.stats.fileCount).toBeGreaterThan(10);

    const projects = (await service.call('project.list', {})) as { id: string; name: string }[];
    expect(projects[0]).toMatchObject({ id: result.projectId, name: 'Projet service' });

    const search = (await service.call('file.search', {
      id: result.projectId,
      query: { text: 'ANCIENT_RUNE' },
    })) as { total: number };
    expect(search.total).toBe(1);

    const listing = (await service.call('fs.list', {
      id: result.projectId,
      dir: 'assets/minecraft/textures/item',
    })) as { entries: { name: string }[] };
    expect(listing.entries.some((entry) => entry.name === 'diamond_sword.png')).toBe(true);

    const opened = (await service.call('image.open', {
      id: result.projectId,
      relPath: 'assets/minecraft/textures/item/diamond_sword.png',
    })) as { original: { width: number; data: string } };
    const buffer = Buffer.from(opened.original.data, 'base64');
    buffer[0] = (buffer[0] + 1) % 256;
    const saved = (await service.call('image.save', {
      id: result.projectId,
      relPath: 'assets/minecraft/textures/item/diamond_sword.png',
      width: opened.original.width,
      height: opened.original.width,
      data: buffer.toString('base64'),
    })) as { modified: boolean; stats: { modifiedCount: number } };
    expect(saved.modified).toBe(true);
    expect(saved.stats.modifiedCount).toBe(1);

    const config: ExportConfig = {
      name: 'Pack service',
      description: 'Test service',
      targetVersion: '1.21.9',
      format: 'zip',
      outputDir,
      outputName: 'PackService',
    };
    const preview = (await service.call('export.preview', { id: result.projectId, config })) as {
      totalFiles: number;
      modifiedCount: number;
    };
    expect(preview.modifiedCount).toBe(1);
    expect(preview.totalFiles).toBe(2);

    const run = (await service.call('export.run', { id: result.projectId, config })) as { taskId: string };
    const exportTask = await waitForTask(service, run.taskId);
    expect(exportTask.status).toBe('done');
    const report = exportTask.result as { verified: boolean; fileCount: number; outputPath: string };
    expect(report.verified).toBe(true);
    expect(report.fileCount).toBe(2);
    expect(await fs.promises.access(report.outputPath).then(() => true).catch(() => false)).toBe(true);

    const second = (await service.call('export.run', { id: result.projectId, config })) as {
      needsOverwrite: boolean;
      suggestedName: string;
    };
    expect(second.needsOverwrite).toBe(true);
    expect(second.suggestedName).not.toBe('PackService');

    const overwrite = (await service.call('export.run', {
      id: result.projectId,
      config: { ...config, overwrite: true },
    })) as { taskId: string };
    const overwriteTask = await waitForTask(service, overwrite.taskId);
    expect(overwriteTask.status).toBe('done');

    await service.call('app.saveSettings', { autosave: false, thumbnailSize: 'large', showNonImages: false });
    const settings = (await service.call('app.info', {})) as {
      settings: { autosave: boolean; thumbnailSize: string; showNonImages: boolean };
    };
    expect(settings.settings).toMatchObject({ autosave: false, thumbnailSize: 'large', showNonImages: false });

    const service2 = new Service({ baseDir, host: stubHost(), defaultOutputDir: outputDir, version: 'test' });
    await service2.init();
    const persisted = (await service2.call('app.info', {})) as {
      settings: { autosave: boolean; thumbnailSize: string };
      projects: { id: string }[];
    };
    expect(persisted.settings.autosave).toBe(false);
    expect(persisted.settings.thumbnailSize).toBe('large');
    expect(persisted.projects.some((project) => project.id === result.projectId)).toBe(true);
  });

  it('limite les chemins en mode démo et signale les erreurs de tâche', async () => {
    const baseDir = await tempDir('arp-svc-demo-');
    const sourceDir = await tempDir('arp-svc-demo-src-');
    const outside = await tempDir('arp-svc-outside-');
    cleanup.push(baseDir, sourceDir, outside);
    await buildMinecraftTree(sourceDir);
    const service = new Service({
      baseDir,
      host: { ...stubHost(), demo: true },
      demoRoot: sourceDir,
      defaultOutputDir: path.join(sourceDir, 'exports'),
    });
    await service.init();
    const created = (await service.call('project.create', { sourcePath: sourceDir })) as { taskId: string };
    const task = await waitForTask(service, created.taskId);
    const id = (task.result as { projectId: string }).projectId;

    await expect(
      service.call('export.preview', {
        id,
        config: {
          name: 'X',
          description: 'X',
          targetVersion: '1.21.9',
          format: 'zip',
          outputDir: outside,
        },
      }),
    ).rejects.toThrow(/démo|limité/i);

    await expect(service.call('project.create', { sourcePath: outside })).rejects.toThrow(/démo|limité/i);

    await expect(service.call('task.get', { taskId: 'inconnue' })).rejects.toThrow(/inconnue/i);
  });

  it('conserve l’intégrité des sources pendant tout le cycle de service', async () => {
    const project = await createTestProject();
    cleanup.push(project.baseDir, project.sourceDir, path.dirname(project.outputDir));
    const before = await hashTree(project.sourceDir);
    const manager = new ProjectManager({ baseDir: project.baseDir, defaultOutputDir: project.outputDir });
    await changeOnePixel(manager, project.projectId, 'assets/minecraft/textures/block/stone.png');
    const opened = await manager.openText(project.projectId, 'assets/minecraft/lang/fr_fr.json');
    await manager.saveText(project.projectId, 'assets/minecraft/lang/fr_fr.json', `${opened.text.trim()}\n`);
    const sql = await manager.verifySource(project.projectId, noProgress());
    expect(sql.available).toBe(true);
    await manager.close(project.projectId);
    expect(await hashTree(project.sourceDir)).toEqual(before);
  });
});
