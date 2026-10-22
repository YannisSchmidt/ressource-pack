/**
 * Génère un jeu de ressources de démonstration (textures, modèles, langues, sons)
 * afin de pouvoir essayer l'application sans installer Minecraft.
 * Les fichiers sont déterministes et placés dans un dossier ignoré par Git.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yazl from 'yazl';
import { PNG } from 'pngjs';

export interface DemoInfo {
  root: string;
  sourceDir: string;
  zipPath: string;
  iconPath: string;
  fileCount: number;
}

const DEMO_VERSION = 3;
const FILLER_COUNT = 2200;

const BLOCKS: [string, [number, number, number]][] = [
  ['stone', [125, 125, 125]],
  ['dirt', [134, 96, 67]],
  ['grass_block_top', [106, 170, 88]],
  ['grass_block_side', [120, 150, 80]],
  ['oak_planks', [162, 130, 78]],
  ['spruce_planks', [110, 84, 52]],
  ['birch_planks', [198, 183, 128]],
  ['cobblestone', [110, 110, 110]],
  ['sand', [219, 207, 163]],
  ['gravel', [131, 127, 126]],
  ['deepslate', [77, 77, 80]],
  ['diamond_ore', [130, 130, 130]],
  ['gold_ore', [140, 130, 100]],
  ['iron_ore', [130, 125, 120]],
  ['coal_ore', [100, 100, 100]],
  ['oak_log', [102, 81, 51]],
  ['glass', [200, 230, 240]],
  ['bricks', [150, 97, 83]],
  ['netherrack', [97, 38, 38]],
  ['soul_sand', [81, 62, 50]],
  ['stone_bricks', [122, 122, 122]],
  ['obsidian', [21, 18, 30]],
  ['amethyst_block', [133, 97, 191]],
  ['copper_block', [192, 107, 79]],
  ['emerald_block', [42, 203, 88]],
  ['redstone_block', [175, 24, 5]],
  ['water_still', [47, 67, 170]],
  ['lava_still', [207, 92, 20]],
];

const ITEMS: [string, [number, number, number]][] = [
  ['diamond_sword', [80, 230, 230]],
  ['iron_sword', [210, 210, 210]],
  ['netherite_sword', [90, 75, 75]],
  ['diamond_pickaxe', [90, 230, 230]],
  ['iron_pickaxe', [210, 210, 210]],
  ['diamond_axe', [80, 220, 220]],
  ['bow', [150, 110, 60]],
  ['arrow', [190, 190, 170]],
  ['apple', [220, 40, 40]],
  ['golden_apple', [240, 210, 70]],
  ['bread', [190, 140, 70]],
  ['cooked_beef', [140, 80, 40]],
  ['diamond', [90, 230, 240]],
  ['emerald', [40, 220, 100]],
  ['redstone', [220, 30, 30]],
  ['coal', [35, 35, 35]],
  ['iron_ingot', [220, 220, 220]],
  ['gold_ingot', [250, 210, 60]],
  ['stick', [150, 110, 60]],
  ['bucket', [190, 190, 200]],
  ['water_bucket', [60, 100, 220]],
  ['ender_pearl', [40, 190, 170]],
  ['blaze_rod', [240, 190, 60]],
  ['totem_of_undying', [230, 200, 80]],
  ['elytra', [140, 120, 180]],
  ['netherite_ingot', [90, 80, 80]],
];

const GUI_TEXTURES: [string, number, number, number?][] = [
  ['widgets', 256, 256, 90],
  ['icons', 256, 256, 255],
  ['container/inventory', 256, 256, 255],
  ['container/crafting_table', 256, 256, 255],
  ['container/furnace', 256, 256, 255],
  ['title/background', 256, 256, 255],
  ['advancements/backgrounds/stone', 16, 16, 255],
];

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rng(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createPng(width: number, height: number, painter: (x: number, y: number) => [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = painter(x, y);
      const i = (y * width + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = a;
    }
  }
  return PNG.sync.write(png);
}

function blockTexture(name: string, base: [number, number, number]): Buffer {
  const random = rng(hashString(name));
  const variations = Array.from({ length: 6 }, () => 0.82 + random() * 0.32);
  return createPng(16, 16, (x, y) => {
    const n = variations[(x * 3 + y * 7 + ((x * y) % 5)) % variations.length];
    const edge = x === 0 || y === 0 ? 0.92 : 1;
    return [
      Math.max(0, Math.min(255, Math.round(base[0] * n * edge))),
      Math.max(0, Math.min(255, Math.round(base[1] * n * edge))),
      Math.max(0, Math.min(255, Math.round(base[2] * n * edge))),
      255,
    ];
  });
}

function itemTexture(name: string, base: [number, number, number]): Buffer {
  const seed = hashString(name);
  const shape = seed % 3;
  return createPng(16, 16, (x, y) => {
    const diagonal = shape === 0 ? Math.abs(x - y) <= 1 : shape === 1 ? Math.abs(x + y - 15) <= 1 : x >= 5 && x <= 10 && y >= 4 && y <= 12;
    if (diagonal) {
      const highlight = (x + y) % 4 === 0 ? 1.25 : 1;
      return [
        Math.min(255, Math.round(base[0] * highlight)),
        Math.min(255, Math.round(base[1] * highlight)),
        Math.min(255, Math.round(base[2] * highlight)),
        255,
      ];
    }
    if (shape === 2 && x >= 7 && x <= 8 && y >= 10 && y <= 14) return [120, 80, 40, 255];
    if (shape !== 2 && x >= 7 && x <= 9 && y >= 11 && y <= 14) return [120, 80, 40, 255];
    return [0, 0, 0, 0];
  });
}

function guiTexture(name: string, width: number, height: number, alpha: number): Buffer {
  const random = rng(hashString(name));
  return createPng(width, height, (x, y) => {
    const border = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
    const grid = x % 18 === 0 || y % 18 === 0;
    const noise = random() < 0.06 ? 12 : 0;
    const value = border ? 180 : grid ? 205 : 235;
    return [
      Math.min(255, value + noise),
      Math.min(255, value - 6 + noise),
      Math.min(255, value - 18 + noise),
      border ? 255 : Math.max(60, Math.round(alpha * (0.85 + random() * 0.15))),
    ];
  });
}

function photoLikeTexture(name: string): Buffer {
  const random = rng(hashString(name));
  return createPng(64, 64, (x, y) => {
    const wave = Math.sin((x + y) / 7) * 0.5 + 0.5;
    return [
      Math.round(40 + wave * 120 + random() * 20),
      Math.round(70 + wave * 90 + random() * 20),
      Math.round(130 + wave * 80 + random() * 20),
      255,
    ];
  });
}

function writeBmp(file: string, width: number, height: number): void {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelData = Buffer.alloc(rowSize * height);
  const random = rng(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * rowSize + x * 3;
      pixelData[i] = Math.round(random() * 200);
      pixelData[i + 1] = Math.round(random() * 255);
      pixelData[i + 2] = Math.round(random() * 120);
    }
  }
  const header = Buffer.alloc(54);
  header.write('BM', 0, 'ascii');
  header.writeUInt32LE(54 + pixelData.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(pixelData.length, 34);
  header.writeInt32LE(2835, 38);
  header.writeInt32LE(2835, 42);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, pixelData]));
}

function iconTexture(): Buffer {
  return createPng(128, 128, (x, y) => {
    const dx = x - 64;
    const dy = y - 64;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const inCircle = distance < 60;
    const stripe = Math.floor((x + y) / 14) % 2 === 0;
    if (!inCircle) return [0, 0, 0, 0];
    if (distance > 55) return [56, 189, 248, 255];
    if (stripe) return [14, 165, 233, 255];
    return [8, 47, 73, 255];
  });
}

async function walkFiles(root: string): Promise<{ name: string; data: Buffer }[]> {
  const result: { name: string; data: Buffer }[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
      const absolute = path.join(dir, dirent.name);
      if (dirent.isDirectory()) await walk(absolute, rel);
      else if (dirent.isFile()) result.push({ name: rel, data: await fs.promises.readFile(absolute) });
    }
  };
  await walk(root, '');
  return result;
}

async function writeZip(file: string, entries: { name: string; data: Buffer }[]): Promise<void> {
  const zip = new yazl.ZipFile();
  for (const entry of entries) zip.addBuffer(entry.data, entry.name, { compress: true });
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(file);
    output.on('close', () => resolve());
    output.on('error', reject);
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(output);
    zip.end();
  });
}

export function defaultDemoRoot(): string {
  return process.env.ATELIER_DEMO_ROOT ?? path.join(os.tmpdir(), 'atelier-resource-pack-demo');
}

export async function ensureDemoAssets(root = defaultDemoRoot()): Promise<DemoInfo> {
  const resolved = path.resolve(root);
  const sourceDir = path.join(resolved, 'minecraft-assets');
  const zipPath = path.join(resolved, 'pack-source.zip');
  const iconPath = path.join(resolved, 'pack-icon.png');
  const markerFile = path.join(resolved, 'demo.json');

  let upToDate = false;
  try {
    const marker = JSON.parse(await fs.promises.readFile(markerFile, 'utf8')) as {
      version?: number;
      fileCount?: number;
    };
    upToDate =
      marker.version === DEMO_VERSION &&
      typeof marker.fileCount === 'number' &&
      fs.existsSync(sourceDir) &&
      fs.existsSync(zipPath) &&
      fs.existsSync(iconPath);
  } catch {
    upToDate = false;
  }
  if (upToDate) {
    const info = JSON.parse(await fs.promises.readFile(markerFile, 'utf8')) as DemoInfo;
    return { ...info, root: resolved, sourceDir, zipPath, iconPath };
  }

  await fs.promises.rm(sourceDir, { recursive: true, force: true });
  await fs.promises.rm(zipPath, { force: true });
  const assets = path.join(sourceDir, 'assets', 'minecraft');
  const textures = path.join(assets, 'textures');

  await fs.promises.mkdir(textures, { recursive: true });
  for (const [name, color] of BLOCKS) {
    await fs.promises.mkdir(path.join(textures, 'block'), { recursive: true });
    await fs.promises.writeFile(path.join(textures, 'block', `${name}.png`), blockTexture(name, color));
  }
  for (const [name, color] of ITEMS) {
    await fs.promises.mkdir(path.join(textures, 'item'), { recursive: true });
    await fs.promises.writeFile(path.join(textures, 'item', `${name}.png`), itemTexture(name, color));
  }
  for (const [name, width, height, alpha] of GUI_TEXTURES) {
    const file = path.join(textures, 'gui', `${name}.png`);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, guiTexture(name, width, height, alpha ?? 255));
  }
  for (const [name, size] of [
    ['entity/zombie/zombie', 64],
    ['entity/creeper/creeper', 64],
    ['entity/enderman/enderman', 64],
    ['entity/player/wide/steve', 64],
    ['entity/cow/cow', 64],
    ['entity/pig/pig', 64],
    ['entity/armor/diamond_layer_1', 64],
  ] as [string, number][]) {
    const file = path.join(textures, `${name}.png`);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, photoLikeTexture(name));
    void size;
  }
  const deep = ['custom', 'deep', 'chapitre1', 'chapitre2', 'chapitre3', 'chapitre4', 'chapitre5', 'secret'];
  const rune = path.join(textures, ...deep, 'ancient_rune.png');
  await fs.promises.mkdir(path.dirname(rune), { recursive: true });
  await fs.promises.writeFile(rune, blockTexture('ancient_rune', [220, 120, 40]));
  const corrupted = path.join(textures, 'block', 'texture_corrompue.png');
  await fs.promises.writeFile(corrupted, Buffer.from('PNG de démonstration volontairement corrompu'));
  const bmp = path.join(textures, 'painting', 'kebab.bmp');
  writeBmp(bmp, 32, 32);

  await fs.promises.mkdir(path.join(textures, 'particle'), { recursive: true });
  await fs.promises.writeFile(path.join(textures, 'particle', 'glow.png'), blockTexture('glow', [250, 230, 120]));
  await fs.promises.mkdir(path.join(textures, 'environment'), { recursive: true });
  await fs.promises.writeFile(path.join(textures, 'environment', 'rain.png'), blockTexture('rain', [120, 160, 230]));
  await fs.promises.mkdir(path.join(textures, 'font'), { recursive: true });
  await fs.promises.writeFile(path.join(textures, 'font', 'default.png'), guiTexture('font', 128, 128, 255));

  // Métadonnées de texture animée (fichier texte éditable).
  await fs.promises.writeFile(
    path.join(textures, 'block', 'lava_still.png.mcmeta'),
    `${JSON.stringify({ animation: { frametime: 2, interpolate: true } }, null, 2)}\n`,
  );

  const models = path.join(assets, 'models', 'item');
  await fs.promises.mkdir(models, { recursive: true });
  for (const [name] of ITEMS.slice(0, 15)) {
    await fs.promises.writeFile(
      path.join(models, `${name}.json`),
      `${JSON.stringify(
        {
          parent: 'minecraft:item/handheld',
          textures: { layer0: `minecraft:item/${name}` },
        },
        null,
        2,
      )}\n`,
    );
  }
  const blockstates = path.join(assets, 'blockstates');
  await fs.promises.mkdir(blockstates, { recursive: true });
  await fs.promises.writeFile(
    path.join(blockstates, 'stone.json'),
    `${JSON.stringify({ variants: { '': { model: 'minecraft:block/stone' } } }, null, 2)}\n`,
  );

  const lang = path.join(assets, 'lang');
  await fs.promises.mkdir(lang, { recursive: true });
  const fr: Record<string, string> = {};
  const en: Record<string, string> = {};
  for (const [name] of ITEMS) {
    const key = `item.minecraft.${name}`;
    fr[key] = name.replace(/_/g, ' ');
    en[key] = name.replace(/_/g, ' ');
  }
  for (const [name] of BLOCKS.slice(0, 12)) {
    fr[`block.minecraft.${name}`] = name.replace(/_/g, ' ');
    en[`block.minecraft.${name}`] = name.replace(/_/g, ' ');
  }
  fr['pack.description.démo'] = 'Ressources de démonstration — Atelier Resource Pack';
  await fs.promises.writeFile(path.join(lang, 'fr_fr.json'), `${JSON.stringify(fr, null, 2)}\n`);
  await fs.promises.writeFile(path.join(lang, 'en_us.json'), `${JSON.stringify(en, null, 2)}\n`);

  await fs.promises.mkdir(assets, { recursive: true });
  await fs.promises.writeFile(
    path.join(assets, 'sounds.json'),
    `${JSON.stringify(
      {
        'block.stone.break': { sounds: [{ name: 'block/stone/break', volume: 1 }] },
        'entity.zombie.ambient': { sounds: [{ name: 'mob/zombie/say1' }] },
      },
      null,
      2,
    )}\n`,
  );
  const shaders = path.join(assets, 'shaders', 'core');
  await fs.promises.mkdir(shaders, { recursive: true });
  await fs.promises.writeFile(
    path.join(shaders, 'rendertype_text.vsh'),
    '#version 150\n\nin vec3 Position;\n// Démo éditable\nvoid main() {\n  gl_Position = vec4(Position, 1.0);\n}\n',
  );
  await fs.promises.mkdir(path.join(assets, 'shaders', 'post'), { recursive: true });
  await fs.promises.writeFile(
    path.join(assets, 'shaders', 'post', 'test.fsh'),
    '#version 150\nuniform sampler2D DiffuseSampler;\nout vec4 fragColor;\nvoid main() { fragColor = texture(DiffuseSampler, vec2(0.5)); }\n',
  );
  await fs.promises.writeFile(
    path.join(sourceDir, 'README-DEMO.txt'),
    'Ressources de démonstration générées localement pour Atelier Resource Pack.\nAucun fichier de Minecraft n’est inclus.\n',
  );

  // Volume de fichiers pour éprouver l'explorateur et la recherche.
  const fillerDir = path.join(textures, 'block', 'variantes');
  await fs.promises.mkdir(fillerDir, { recursive: true });
  const fillerBuffer = blockTexture('variantes', [110, 130, 160]);
  for (let i = 0; i < FILLER_COUNT; i += 1) {
    await fs.promises.writeFile(path.join(fillerDir, `variante_${String(i).padStart(4, '0')}.png`), fillerBuffer);
  }

  await fs.promises.writeFile(iconPath, iconTexture());

  const entries = await walkFiles(sourceDir);
  await writeZip(zipPath, entries);
  const info: DemoInfo = {
    root: resolved,
    sourceDir,
    zipPath,
    iconPath,
    fileCount: entries.length,
  };
  await fs.promises.mkdir(resolved, { recursive: true });
  await fs.promises.writeFile(
    markerFile,
    JSON.stringify({ version: DEMO_VERSION, ...info }, null, 2),
  );
  return info;
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/generate-demo.ts');
if (invokedDirectly) {
  ensureDemoAssets()
    .then((info) => {
      console.log(`Ressources de démo prêtes : ${info.fileCount} fichiers`);
      console.log(`Dossier : ${info.sourceDir}`);
      console.log(`Archive : ${info.zipPath}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
