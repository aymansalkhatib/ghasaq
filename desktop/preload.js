// What the game may ask of the desktop app: close it from the main menu («خروج»).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghasaqApp', {
  quit: () => ipcRenderer.send('app:quit'),
});
