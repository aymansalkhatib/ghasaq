/*
 * غسق on Windows: one window running the same single-file game as the browser version
 * (app/index.html, fonts inside), so it plays offline.
 *
 *   F11 or Alt+Enter   full screen / window
 *   --windowed         start in a window instead of full screen
 */
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('node:path');

// the soundtrack starts with the title screen, WebGL stays on for graphics cards Chrome distrusts,
// and laptops with two GPUs render on the fast one instead of the power-saving one
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force_high_performance_gpu');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    fullscreen: !process.argv.includes('--windowed'),
    backgroundColor: '#0b0908',
    title: 'غسق',
    icon: path.join(__dirname, 'app', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'app', 'index.html'));

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      e.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });
  // links open in the web browser: the game window only ever shows the game
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
}

// a second launch brings the running game forward instead of opening another copy
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  ipcMain.on('app:quit', () => app.quit());
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
