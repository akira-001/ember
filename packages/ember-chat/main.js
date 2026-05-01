const { app, BrowserWindow, nativeImage, Tray, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// Default loads the Ember Chat page only (embedded=true hides sidebar in dashboard Layout).
// Override with EMBER_DASHBOARD_URL=http://localhost:3456/ to get the full dashboard.
const DASHBOARD_URL = process.env.EMBER_DASHBOARD_URL || 'http://localhost:3456/ember-chat?embedded=true';
const RETRY_INTERVAL_MS = 3000;
const APP_ICON_PATH = path.join(__dirname, 'icon-1024.png');

app.setName('Ember Chat');

// Single instance lock — prevent multiple windows
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow;
let tray = null;
let saveTimer = null;

const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function isVisibleOnAnyDisplay(bounds) {
  return screen.getAllDisplays().some((d) => (
    bounds.x < d.bounds.x + d.bounds.width &&
    bounds.x + bounds.width > d.bounds.x &&
    bounds.y < d.bounds.y + d.bounds.height &&
    bounds.y + bounds.height > d.bounds.y
  ));
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const state = {
    ...mainWindow.getNormalBounds(),
    isMaximized: mainWindow.isMaximized(),
    isFullScreen: mainWindow.isFullScreen(),
  };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (err) {
    console.warn('[ember] failed to save window state:', err.message);
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveWindowState, 500);
}

function createWindow() {
  const saved = loadWindowState();
  const restoreBounds = saved
    && Number.isFinite(saved.x)
    && Number.isFinite(saved.y)
    && Number.isFinite(saved.width)
    && Number.isFinite(saved.height)
    && isVisibleOnAnyDisplay(saved)
    ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
    : { width: 1200, height: 800 };

  mainWindow = new BrowserWindow({
    ...restoreBounds,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#141820',
    icon: APP_ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  if (saved?.isMaximized) mainWindow.maximize();
  if (saved?.isFullScreen) mainWindow.setFullScreen(true);

  // Open DevTools for diagnosis (set EMBER_NO_DEVTOOLS=1 to disable)
  if (!process.env.EMBER_NO_DEVTOOLS) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.warn(`[ember] did-fail-load (${errorCode}): ${errorDescription}. Retrying in ${RETRY_INTERVAL_MS}ms...`);
    setTimeout(loadDashboardWithRetry, RETRY_INTERVAL_MS);
  });

  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('maximize', saveWindowState);
  mainWindow.on('unmaximize', saveWindowState);
  mainWindow.on('enter-full-screen', saveWindowState);
  mainWindow.on('leave-full-screen', saveWindowState);
  mainWindow.on('close', saveWindowState);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  loadDashboardWithRetry();
}

function loadDashboardWithRetry() {
  if (!mainWindow) return;

  mainWindow.loadURL(DASHBOARD_URL).catch((err) => {
    console.warn(`[ember] Failed to load ${DASHBOARD_URL}: ${err.message}. Retrying in ${RETRY_INTERVAL_MS}ms...`);
    setTimeout(loadDashboardWithRetry, RETRY_INTERVAL_MS);
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  let img;
  try {
    img = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  } catch {
    img = nativeImage.createEmpty();
  }

  tray = new Tray(img);
  tray.setToolTip('Ember Chat');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);
}

app.on('second-instance', () => {
  // Focus existing window when second instance is launched
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  try {
    app.dock.setIcon(nativeImage.createFromPath(APP_ICON_PATH));
  } catch {}
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
