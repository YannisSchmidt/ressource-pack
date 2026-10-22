import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yazl from 'yazl';
import type { FileEntry, SourceCheck } from '../src/shared/types';
import { encodePng } from '../src/core/png';
import { createPixmap, type Pixmap } from '../src/core/imageOps';
import { ProjectManager } from '../src/core/project';
import type { ProgressContext } from '../src/core/source';

export async function tempDir(prefix = 'arp-test-'): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
}

export function solidPixmap(width: number, height: number, color: [number, number, number, number]): Pixmap {
  return createPixmap(width, height, color);
}

export function patternPixmap(width: number, height: number, alpha = true): Pixmap {
  const image = createPixmap(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      image.data[i] = (x * 17 + y * 31) % 256;
      image.data[i + 1] = (x * 7 + y * 53) % 256;
      image.data[i + 2] = (x * 97 + y * 13) % 256;
      image.data[i + 3] = alpha && (x + y) % 5 === 0 ? 0 : 255;
    }
  }
  return image;
}

export async function writePixmap(file: string, image: Pixmap): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, encodePng(image));
}

export async function writeText(file: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, content, 'utf8');
}

export const FILLER_PNG = encodePng(solidPixmap(16, 16, [120, 80, 200, 255]));

export interface MinecraftTreeOptions {
  filler?: number;
  deepLevels?: number;
}

/** Arborescence proche d'un resource pack réel, avec plusieurs niveaux de dossiers. */
export async function buildMinecraftTree(root: string, options: MinecraftTreeOptions = {}): Promise<void> {
  const textures = path.join(root, 'assets', 'minecraft', 'textures');
  await writePixmap(path.join(textures, 'block', 'stone.png'), patternPixmap(16, 16));
  await writePixmap(
    path.join(textures, 'block', 'grass_block_side.png'),
    patternPixmap(16, 16),
  );
  await writePixmap(
    path.join(textures, 'item', 'diamond_sword.png'),
    solidPixmap(16, 16, [80, 220, 240, 255]),
  );
  await writePixmap(
    path.join(textures, 'entity', 'zombie', 'zombie.png'),
    patternPixmap(64, 64, false),
  );
  await writePixmap(
    path.join(textures, 'gui', 'widgets.png'),
    patternPixmap(256, 256),
  );
  await writePixmap(
    path.join(textures, 'block', 'glass.png'),
    solidPixmap(16, 16, [200, 240, 255, 80]),
  );
  await writeText(
    path.join(textures, 'block', 'stone.png.mcmeta'),
    JSON.stringify({ animation: { frametime: 2 } }),
  );
  const deep = ['custom', 'deep', 'level1', 'level2', 'level3', 'level4', 'level5', 'level6'];
  await writePixmap(
    path.join(textures, ...deep, 'ancient_rune.png'),
    solidPixmap(32, 32, [255, 120, 0, 255]),
  );
  await writeText(
    path.join(root, 'assets', 'minecraft', 'models', 'item', 'diamond_sword.json'),
    JSON.stringify({ parent: 'item/handheld', textures: { layer0: 'item/diamond_sword' } }, null, 2),
  );
  await writeText(
    path.join(root, 'assets', 'minecraft', 'lang', 'fr_fr.json'),
    JSON.stringify({ 'item.diamond_sword': 'Épée en diamant' }, null, 2),
  );
  await writeText(
    path.join(root, 'assets', 'minecraft', 'lang', 'en_us.json'),
    JSON.stringify({ 'item.diamond_sword': 'Diamond Sword' }, null, 2),
  );
  await writeText(
    path.join(root, 'assets', 'minecraft', 'sounds.json'),
    JSON.stringify({ 'block.stone.break': { sounds: [{ name: 'block/stone/break', volume: 0.8 }] } }, null, 2),
  );
  await writePixmap(
    path.join(root, 'assets', 'minecraft', 'textures', 'misc', 'photo-ish.jpg.png'),
    solidPixmap(8, 8, [1, 2, 3, 255]),
  );
  // Faux JPEG : listé mais non éditable.
  await fs.promises.writeFile(
    path.join(textures, 'misc', 'fake.jpg'),
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  );
  await fs.promises.writeFile(path.join(textures, 'block', 'corrupt.png'), Buffer.from('not a png'));
  await writeText(path.join(root, 'README.md'), '# Ressources de test\n');

  if (options.filler) {
    const fillerDir = path.join(textures, 'block', 'filler');
    await fs.promises.mkdir(fillerDir, { recursive: true });
    for (let i = 0; i < options.filler; i += 1) {
      await fs.promises.writeFile(path.join(fillerDir, `demo_block_${String(i).padStart(4, '0')}.png`), FILLER_PNG);
    }
  }
}

export async function hashFile(file: string): Promise<string> {
  return crypto.createHash('sha256').update(await fs.promises.readFile(file)).digest('hex');
}

export async function hashTree(root: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
      const absolute = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        result.set(`${rel}/`, 'dir');
        await walk(absolute, rel);
      } else if (dirent.isFile()) {
        result.set(rel, await hashFile(absolute));
      }
    }
  };
  await walk(root, '');
  return result;
}

export async function writeZip(file: string, entries: { name: string; data: Buffer | string }[]): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const zip = new yazl.ZipFile();
  for (const entry of entries) {
    zip.addBuffer(typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data, entry.name);
  }
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(file);
    output.on('close', () => resolve());
    output.on('error', reject);
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(output);
    zip.end();
  });
}

export async function buildZipSource(zipPath: string): Promise<void> {
  const temp = await tempDir('arp-zip-src-');
  await buildMinecraftTree(temp);
  const entries: { name: string; data: Buffer }[] = [];
  // Structure attendue : assets/minecraft/... à la racine de l'archive.
  const walkRoot = async (dir: string, prefix: string): Promise<void> => {
    const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
      const absolute = path.join(dir, dirent.name);
      if (dirent.isDirectory()) await walkRoot(absolute, rel);
      else if (dirent.isFile()) entries.push({ name: rel, data: await fs.promises.readFile(absolute) });
    }
  };
  await walkRoot(temp, '');
  await writeZip(zipPath, entries);
  await fs.promises.rm(temp, { recursive: true, force: true });
}

export function noProgress(): ProgressContext {
  return { isCancelled: () => false, onProgress: () => undefined };
}

export interface TestProject {
  baseDir: string;
  sourceDir: string;
  outputDir: string;
  manager: ProjectManager;
  projectId: string;
  view: Awaited<ReturnType<ProjectManager['create']>>;
}

export async function createTestProject(options: {
  filler?: number;
  packSettings?: Partial<TestProject['view']['pack']>;
} = {}): Promise<TestProject> {
  const baseDir = await tempDir('arp-base-');
  const sourceDir = await tempDir('arp-source-');
  const outputDir = path.join(await tempDir('arp-out-'), 'exports');
  await buildMinecraftTree(sourceDir, { filler: options.filler ?? 0 });
  const manager = new ProjectManager({ baseDir, defaultOutputDir: outputDir, defaultFormat: 'zip' });
  const view = await manager.create({ sourcePath: sourceDir, name: 'Pack de test' }, noProgress());
  const projectId = view.id;
  if (options.packSettings) {
    await manager.savePack(projectId, { ...view.pack, ...options.packSettings });
  }
  return { baseDir, sourceDir, outputDir, manager, projectId, view };
}

export async function changeOnePixel(
  manager: ProjectManager,
  projectId: string,
  relPath: string,
): Promise<{ original: Pixmap; modified: Pixmap }> {
  const opened = await manager.openImage(projectId, relPath);
  const original: Pixmap = {
    width: opened.original.width,
    height: opened.original.height,
    data: Buffer.from(opened.original.data, 'base64'),
  };
  const modified: Pixmap = {
    width: original.width,
    height: original.height,
    data: new Uint8Array(original.data),
  };
  modified.data[0] = modified.data[0] === 255 ? 0 : 255;
  modified.data[3] = 255;
  const result = await manager.saveImage(projectId, relPath, modified.width, modified.height, Buffer.from(modified.data));
  if (!result.modified) throw new Error('La modification n’a pas été enregistrée');
  return { original, modified };
}

export function entryPaths(entries: FileEntry[]): string[] {
  return entries.map((entry) => entry.relPath);
}

export type { SourceCheck };


const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Écrit un ZIP brut (méthode « stored ») pour tester des entrées hostiles que
 * les bibliothèques d'écriture refusent de produire (chemins `../`, doublons).
 */
export async function writeRawZip(
  file: string,
  entries: { name: string; data: Buffer | string }[],
): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  await fs.promises.writeFile(file, Buffer.concat([...locals, centralBuffer, end]));
}


/** Fabrique un PNG contenant un chunk acTL (APNG) pour tester le refus d'édition. */
export function makeApng(width = 16, height = 16): Buffer {
  const base = encodePng(solidPixmap(width, height, [10, 200, 90, 255]));
  const chunkData = Buffer.alloc(8);
  chunkData.writeUInt32BE(2, 0);
  chunkData.writeUInt32BE(0, 4);
  const type = Buffer.from('acTL', 'ascii');
  const crc = crc32(Buffer.concat([type, chunkData]));
  const chunk = Buffer.alloc(20);
  chunk.writeUInt32BE(chunkData.length, 0);
  type.copy(chunk, 4);
  chunkData.copy(chunk, 8);
  chunk.writeUInt32BE(crc, 16);
  // Le chunk acTL doit précéder le premier IDAT : insertion après IHDR (offset 33).
  return Buffer.concat([base.subarray(0, 33), chunk, base.subarray(33)]);
}
