const { app, BrowserWindow } = require('electron');
const path = require('path');
const { BASE_URL, IS_PRODUCTION } = require('../backend/src/config');
require('../backend/src/server');

// For environments con permisos limitados y rutas con espacios, usar carpeta local en app path.
const userDataPath = path.join(__dirname, '..', '..', 'electron-user-data');
app.setPath('userData', userDataPath);

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 680,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !IS_PRODUCTION,
    },
  });

  win.loadURL(BASE_URL);

  if (!IS_PRODUCTION) {
    win.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
