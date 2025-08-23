const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { extractHighlightsFromFiles } = require('./pdf');
require('dotenv').config();
const OpenAI = require('openai');

let mainWindow = null;

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.API_KEY,
  baseURL: process.env.BASE_URL,
});

function createWindow() {
  const preloadPath = path.join(__dirname, '../preload/preload.js');
  const distIndex = path.resolve(__dirname, '../../dist', 'index.html');
  const devUrl = process.env.VITE_DEV_SERVER_URL;

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

  if (devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(distIndex);
  }

  mainWindow = win;
}

// Example IPC handler
ipcMain.handle('ping', () => 'pong');

ipcMain.handle('dialog:openPDFs', async () => {
  const res = await dialog.showOpenDialog({
    title: '按住cmmand键选择多个 PDF 文件',
    buttonLabel: '选择（按住cmmand键选择多个）',
    properties: [
      'openFile',
      'multiSelections',
      // 'openDirectory',
      // 'treatPackageAsDirectory',
      // 'dontAddToRecent'
    ],
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (res.canceled) return [];

  const picked = res.filePaths || [];
  const pdfs = new Set();

  const walk = (p) => {
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        for (const name of fs.readdirSync(p)) {
          walk(path.join(p, name));
        }
      } else if (st.isFile()) {
        if (path.extname(p).toLowerCase() === '.pdf') pdfs.add(p);
      }
    } catch {}
  };

  for (const p of picked) walk(p);
  return Array.from(pdfs);
});

ipcMain.handle('pdf:extractHighlights', async (_evt, filePaths) => {
  try {
    const result = await extractHighlightsFromFiles(filePaths);
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('ai:chat', async (_evt, messages, systemPrompt) => {
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.MODEL_NAME || 'qwen-max-latest',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: 2000,
      stream: false
    });

    return { 
      ok: true, 
      data: {
        content: completion.choices[0].message.content,
        usage: completion.usage
      }
    };
  } catch (e) {
    console.error('[AI] Chat error:', e);
    return { ok: false, error: e?.message || String(e) };
  }
});

// Windows needs an explicit AppUserModelID for notifications/taskbar grouping
if (process.platform === 'win32') {
  app.setAppUserModelId('com.vibewriting.app');
}

// Ensure single instance
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

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
