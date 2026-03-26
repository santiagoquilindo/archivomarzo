const { app, BrowserWindow } = require('electron');
const path = require('path');
const backend = require('../backend/src/server');

// For environments con permisos limitados y rutas con espacios, usar carpeta local en app path.
const userDataPath = path.join(__dirname, '..', '..', 'electron-user-data');
app.setPath('userData', userDataPath);

const BACKEND_URL = 'http://localhost:3000';

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 680,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Cargar la interfaz desde el servidor local para que las rutas /api funciones con la misma base
  win.loadURL(BACKEND_URL);
  // abrir devtools para debugging
  win.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
