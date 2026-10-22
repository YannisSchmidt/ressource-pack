import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');

function read(name: string): string {
  return fs.readFileSync(path.join(root, name), 'utf8');
}

function raw(name: string): Buffer {
  return fs.readFileSync(path.join(root, name));
}

function labels(content: string): Set<string> {
  const result = new Set<string>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(':') && !trimmed.startsWith('::')) {
      const name = trimmed.slice(1).split(/[\s:]/)[0];
      if (name) result.add(name.toLowerCase());
    }
  }
  return result;
}

function jumpTargets(content: string): string[] {
  const result: string[] = [];
  for (const match of content.matchAll(/\b(?:goto|call)\s+:([A-Za-z0-9_]+)/g)) {
    result.push(match[1].toLowerCase());
  }
  return result;
}

/** Vérifie l'équilibrage des parenthèses des blocs, hors texte affiché et commentaires. */
function parenDepth(content: string): { depth: number; negativeAt: number[] } {
  let depth = 0;
  const negativeAt: number[] = [];
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    const trimmed = line.trim().toLowerCase();
    if (trimmed.startsWith('echo') || trimmed.startsWith('rem') || trimmed.startsWith('::') || trimmed.startsWith('title')) {
      return;
    }
    const withoutQuoted = line.replace(/"[^"]*"/g, '""');
    for (const char of withoutQuoted) {
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
    }
    if (depth < 0) {
      negativeAt.push(index + 1);
      depth = 0;
    }
  });
  return { depth, negativeAt };
}

const SCRIPTS = ['downloadALL.bat', 'start.bat'];

describe('scripts Windows (.bat)', () => {
  it('existent, utilisent CRLF et ne contiennent aucun caractère non-ASCII', () => {
    for (const name of SCRIPTS) {
      const buffer = raw(name);
      expect(buffer.length).toBeGreaterThan(500);
      const text = buffer.toString('utf8');
      expect(text.includes('\r\n')).toBe(true);
      // Aucun saut de ligne LF isolé (cmd.exe gère mal les scripts en LF seul).
      expect(text.replace(/\r\n/g, '')).not.toContain('\n');
      const nonAscii = [...text].filter((char) => char.charCodeAt(0) > 127);
      expect(nonAscii, `caractères non-ASCII dans ${name}`).toHaveLength(0);
      expect(text.startsWith('@echo off')).toBe(true);
    }
  });

  it('n’utilisent que des cibles de saut existantes', () => {
    for (const name of SCRIPTS) {
      const content = read(name);
      const defined = labels(content);
      const targets = jumpTargets(content);
      const missing = targets.filter((target) => !defined.has(target));
      expect(missing, `cibles manquantes dans ${name}`).toEqual([]);
    }
  });

  it('ont des blocs de parenthèses équilibrés', () => {
    for (const name of SCRIPTS) {
      const { depth, negativeAt } = parenDepth(read(name));
      expect(negativeAt, `parenthèses fermées trop tôt dans ${name}`).toEqual([]);
      expect(depth, `bloc non refermé dans ${name}`).toBe(0);
    }
  });

  it('ne référencent que des scripts npm réellement déclarés', () => {
    const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    for (const name of SCRIPTS) {
      const content = read(name);
      for (const match of content.matchAll(/npm(?:\.cmd)?\"?\s+run\s+([A-Za-z0-9:_-]+)/g)) {
        expect(packageJson.scripts[match[1]], `script npm « ${match[1]} » utilisé par ${name}`).toBeDefined();
      }
    }
    expect(packageJson.scripts['demo:assets']).toBeDefined();
    expect(packageJson.scripts.build).toBeDefined();
    expect(packageJson.scripts['run:desktop']).toBe('electron .');
  });

  it('downloadALL télécharge Node.js, vérifie SHA-256 puis extrait, sans droit admin', () => {
    const content = read('downloadALL.bat');
    expect(content).toContain('https://nodejs.org/dist/');
    expect(content).toContain('SHASUMS256.txt');
    expect(content).toContain('Get-FileHash -Algorithm SHA256');
    expect(content).toContain('Expand-Archive');
    expect(content).toContain('node_modules\\electron\\install.js');
    expect(content).toContain('npm');
    expect(content).not.toMatch(/runas|administrator|net session/i);
    // L'extraction ne doit avoir lieu qu'après la comparaison de l'empreinte.
    const hashIndex = content.indexOf('Get-FileHash');
    const extractIndex = content.indexOf('Expand-Archive');
    expect(hashIndex).toBeGreaterThan(-1);
    expect(extractIndex).toBeGreaterThan(hashIndex);
    // Les dossiers de travail restent hors du dépôt.
    expect(read('.gitignore')).toContain('.tools/');
    expect(read('.gitattributes')).toMatch(/^\*\.bat text eol=crlf$/m);
  });

  it('start.bat lance l’application et répare une installation incomplète', () => {
    const content = read('start.bat');
    expect(content).toContain('call "%ROOT%\\downloadALL.bat" /auto');
    expect(content).toContain('npm run run:desktop');
    expect(content).toContain('npm run build');
    expect(content).toContain('node_modules\\electron\\dist\\electron.exe');
    expect(content).toContain(':fail');
    expect(content).not.toMatch(/rmdir \/s \/q \"%ROOT%\"|del \/q \/s/i);
  });
});
