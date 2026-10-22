import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { Service, type ServiceHost } from '../core/service';
import { describeError } from '../core/errors';
import { ensureDemoAssets } from '../../scripts/generate-demo';

const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? '0.0.0.0';
const MAX_BODY = 256 * 1024 * 1024;

interface RpcEnvelope {
  ok: boolean;
  result?: unknown;
  error?: { message: string; code?: string; details?: string };
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY) {
        reject(new Error('Requête trop volumineuse pour l’aperçu web.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function main(): Promise<void> {
  const demo = await ensureDemoAssets();
  const exportsDir = path.join(demo.root, 'exports');
  await fs.promises.mkdir(exportsDir, { recursive: true });

  const host: ServiceHost = {
    nativeDialogs: false,
    demo: true,
    canOpenPaths: false,
    demoSources: [
      {
        label: 'Ressources Minecraft (démo)',
        path: demo.sourceDir,
        type: 'directory',
        description: `${demo.fileCount.toLocaleString('fr-FR')} fichiers, textures 16×16, modèles, langues et dossiers imbriqués.`,
      },
      {
        label: 'Archive ZIP (démo)',
        path: demo.zipPath,
        type: 'zip',
        description: 'Même contenu lu directement dans une archive, sans extraction complète.',
      },
    ],
    pickSource: async () => ({ cancelled: true }),
    pickOutputDir: async () => ({ path: exportsDir }),
    pickFile: async () => ({ path: demo.iconPath }),
    openPath: async (target: string) => `Aperçu web : ouverture de « ${target} » indisponible.`,
    revealPath: async () => undefined,
  };

  const service = new Service({
    baseDir: path.join(demo.root, 'app-data'),
    host,
    version: '1.0.0',
    demoRoot: demo.root,
    defaultOutputDir: exportsDir,
  });
  await service.init();

  process.env.ATELIER_WEB = '1';
  const vite = await createViteServer({
    configFile: path.resolve('vite.config.mts'),
    server: {
      middlewareMode: true,
      hmr: false,
      allowedHosts: true,
      host: HOST,
    },
    appType: 'spa',
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (url.pathname === '/api/health') {
        sendJson(res, 200, { ok: true, demo: true, files: demo.fileCount });
        return;
      }
      if (url.pathname === '/api/rpc' && req.method === 'POST') {
        let envelope: RpcEnvelope;
        try {
          const body = await readBody(req);
          const payload = JSON.parse(body.toString('utf8')) as { method?: unknown; params?: unknown };
          if (typeof payload.method !== 'string') {
            sendJson(res, 400, { ok: false, error: { message: 'Méthode RPC manquante.' } });
            return;
          }
          try {
            const result = await service.call(payload.method, payload.params ?? {});
            envelope = { ok: true, result };
          } catch (error) {
            envelope = {
              ok: false,
              error: {
                message: describeError(error),
                code: error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : undefined,
                details: error instanceof Error ? error.stack : undefined,
              },
            };
          }
          sendJson(res, 200, envelope);
        } catch (error) {
          sendJson(res, 400, { ok: false, error: { message: describeError(error) } });
        }
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        sendJson(res, 404, { ok: false, error: { message: 'Route API inconnue.' } });
        return;
      }
      vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end('Introuvable');
      });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: { message: describeError(error) } });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`[atelier] Aperçu web sur http://${HOST}:${PORT}`);
    console.log(`[atelier] Démo : ${demo.sourceDir} (${demo.fileCount} fichiers)`);
  });
}

main().catch((error) => {
  console.error('[atelier] Échec du démarrage :', error);
  process.exit(1);
});
