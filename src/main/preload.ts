import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  invoke: (method: string, params: unknown) => ipcRenderer.invoke('atelier:rpc', method, params),
  isDesktop: true,
  platform: process.platform,
});
