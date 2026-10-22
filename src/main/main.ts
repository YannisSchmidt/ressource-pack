import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { describeError, errorCode } from '../core/errors';
import { Service, type ServiceHost } from '../core/service';

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow: BrowserWindow | null = null;
let service: Service | null = null;

function detectMinecraftResourcePacks(): string | undefined {
  const home = app.getPath('home');
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, '.minecraft', 'resourcepacks'));
    candidates.push(path.join(home, 'AppData', 'Roaming', '.minecraft', 'resourcepacks'));
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(home, 'Library', 'Application Support', 'minecraft', 'resourcepacks'));
  } else {
    candidates.push(path.join(home, '.minecraft', 'resourcepacks'));
  }
  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
}

function defaultOutputDir(): string {
  try {
    return path.join(app.getPath('downloads'), 'Atelier Resource Pack');
  } catch {
    return path.join(app.getPath('userData'), 'exports');
  }
}

function createHost(): ServiceHost {
  const window = (): BrowserWindow | undefined => mainWindow ?? undefined;
  return {
    nativeDialogs: true,
    demo: false,
    canOpenPaths: true,
    minecraftResourcePacks: detectMinecraftResourcePacks(),
    pickSource: async (kind) => {
      const result = await dialog.showOpenDialog(window() as BrowserWindow, {
        title: kind === 'zip' ? 'Choisir une archive de ressources' : 'Choisir un dossier de ressources Minecraft',
        properties: kind === 'zip' ? ['openFile'] : ['openDirectory'],
        filters:
          kind === 'zip'
            ? [
                { name: 'Archives Minecraft', extensions: ['zip', 'jar'] },
                { name: 'Tous les fichiers', extensions: ['*'] },
              ]
            : undefined,
      });
      return { cancelled: result.canceled, path: result.filePaths[0] };
    },
    pickOutputDir: async (initial) => {
      const result = await dialog.showOpenDialog(window() as BrowserWindow, {
        title: 'Choisir le dossier de sortie',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: initial,
      });
      return { cancelled: result.canceled, path: result.filePaths[0] };
    },
    pickFile: async (options) => {
      const result = await dialog.showOpenDialog(window() as BrowserWindow, {
        title: options.title,
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: options.extensions }],
      });
      return { cancelled: result.canceled, path: result.filePaths[0] };
    },
    openPath: async (target) => {
      const error = await shell.openPath(target);
      return error || '';
    },
    revealPath: async (target) => {
      shell.showItemInFolder(target);
    },
  };
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1050,
    minHeight: 680,
    show: false,
    backgroundColor: '#080c14',
    title: 'Atelier Resource Pack',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow as BrowserWindow, {
      type: 'warning',
      buttons: ['Rester dans l’application', 'Quitter sans enregistrer'],
      defaultId: 0,
      cancelId: 0,
      title: 'Modifications non enregistrées',
      message: 'Des modifications ne sont pas encore enregistrées.',
      detail:
        'La sauvegarde automatique est peut-être désactivée ou une écriture a échoué. Enregistrez vos onglets avant de quitter pour éviter toute perte.',
    });
    if (choice === 1) event.preventDefault();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith('file://')) return;
    event.preventDefault();
  });
  if (isDev) {
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'F12') mainWindow?.webContents.toggleDevTools();
    });
  }

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }
}

async function bootstrap(): Promise<void> {
  app.setName('Atelier Resource Pack');
  if (process.platform === 'win32') app.setAppUserModelId('fr.atelier.resourcepack');

  const baseDir = app.getPath('userData');
  service = new Service({
    baseDir,
    host: createHost(),
    version: app.getVersion(),
    defaultOutputDir: defaultOutputDir(),
  });
  await service.init();

  ipcMain.handle('atelier:rpc', async (_event, method: unknown, params: unknown) => {
    if (typeof method !== 'string') {
      return { ok: false, error: { message: 'Méthode RPC invalide.' } };
    }
    try {
      const result = await service?.call(method, params ?? {});
      return { ok: true, result };
    } catch (error) {
      return {
        ok: false,
        error: {
          message: describeError(error),
          code: errorCode(error),
        },
      };
    }
  });

  Menu.setApplicationMenu(null);
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app
    .whenReady()
    .then(bootstrap)
    .catch((error) => {
      dialog.showErrorBox('Atelier Resource Pack', `Impossible de démarrer l’application :\n${describeError(error)}`);
      app.quit();
    });

  app.on('before-quit', () => {
    service?.tasksManager.cancelAll();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
