try {
  const { contextBridge, ipcRenderer } = require('electron');
  contextBridge.exposeInMainWorld('api', {
    ping: () => ipcRenderer.invoke('ping'),
    openPDFs: async () => ipcRenderer.invoke('dialog:openPDFs'),
    extractHighlights: async (paths) => ipcRenderer.invoke('pdf:extractHighlights', paths)
  });
  // Debug flag to verify preload executed
  try { window.__preload_ok = true; } catch {}
  console.log('[preload] contextBridge API exposed');
} catch (e) {
  try { window.__preload_error = e?.message || String(e); } catch {}
  console.error('[preload] failed to expose API:', e);
}
