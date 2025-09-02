const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { extractHighlightsFromFiles } = require('./pdf');
require('dotenv').config();
const OpenAI = require('openai');

let mainWindow = null;
let cachedSystemPrompt = null;

function getSystemPrompt() {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  try {
    const p = path.resolve(__dirname, '../prompts/SystemPrompt.md');
    cachedSystemPrompt = fs.readFileSync(p, 'utf8');
  } catch (e) {
    cachedSystemPrompt = 'You are a helpful writing assistant.';
  }
  return cachedSystemPrompt;
}

function getLogDir() {
  const configured = process.env.LOG_PATH || '';
  // If absolute path provided, use it; otherwise resolve relative to CWD
  const dir = path.isAbsolute(configured) && configured
    ? configured
    : path.resolve(process.cwd(), configured || 'logs');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

function writeLog(kind, data) {
  try {
    const dir = getLogDir();
    const ts = new Date();
    const stamp = ts.toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${stamp}-${kind}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return file;
  } catch (e) {
    console.error('[LOG] failed to write log:', e);
    return null;
  }
}

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
    title: '按住 Command 键选择多个 PDF 文件',
    buttonLabel: '选择（可多选）',
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
    const startedAt = Date.now();
    const result = await extractHighlightsFromFiles(filePaths);
    writeLog('pdf', {
      type: 'pdf:extractHighlights',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      request: { filePaths },
      response: { count: Array.isArray(result) ? result.length : 0 }
    });
    return { ok: true, data: result };
  } catch (e) {
    writeLog('pdf', {
      type: 'pdf:extractHighlights',
      timestamp: new Date().toISOString(),
      error: e?.message || String(e),
      request: { filePaths }
    });
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('ai:chat', async (_evt, messages, systemPrompt) => {
  try {
    const startedAt = Date.now();
    const system = systemPrompt || getSystemPrompt();
    const reqBody = {
      model: process.env.MODEL_NAME || 'gpt-5',
      messages: [
        { role: 'system', content: system },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: 2000,
      stream: false
    };
    const completion = await openai.chat.completions.create(reqBody);

    const responsePayload = { 
      ok: true, 
      data: {
        content: completion.choices[0].message.content,
        usage: completion.usage
      }
    };

    writeLog('ai', {
      type: 'ai:chat',
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      request: {
        model: reqBody.model,
        temperature: reqBody.temperature,
        max_tokens: reqBody.max_tokens,
        system,
        messages: reqBody.messages
      },
      response: responsePayload.data
    });

    return responsePayload;
  } catch (e) {
    console.error('[AI] Chat error:', e);
    writeLog('ai', {
      type: 'ai:chat',
      timestamp: new Date().toISOString(),
      error: e?.message || String(e),
      request: { model: process.env.MODEL_NAME || 'gpt-5' }
    });
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
