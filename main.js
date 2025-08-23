const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { extractHighlightsFromFiles } = require('./main/pdf');

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  console.log('[main] preload path:', preloadPath, 'exists:', fs.existsSync(preloadPath));
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    title: 'VibeWriting',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  win.removeMenu();

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

// Example IPC handler
ipcMain.handle('ping', () => 'pong');

ipcMain.handle('dialog:openPDFs', async () => {
  const res = await dialog.showOpenDialog({
    title: '选择 PDF 文件',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (res.canceled) return [];
  return res.filePaths || [];
});

ipcMain.handle('pdf:extractHighlights', async (_evt, filePaths) => {
  try {
    const result = await extractHighlightsFromFiles(filePaths);
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// Windows needs an explicit AppUserModelID for notifications/taskbar grouping
if (process.platform === 'win32') {
  app.setAppUserModelId('com.vibewriting.app');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
