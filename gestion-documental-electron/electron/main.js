const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { BASE_URL, HOST, IS_PRODUCTION, PORT } = require('../backend/src/config');
const { startServer, stopServer } = require('../backend/src/server');

let mainWindow = null;
let backendStartedByElectron = false;

// For environments con permisos limitados y rutas con espacios, usar carpeta local en app path.
const userDataPath = path.join(__dirname, '..', '..', 'electron-user-data');
app.setPath('userData', userDataPath);

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(BASE_URL);

  if (!IS_PRODUCTION) {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
}

async function ensureBackendStarted() {
  await startServer({ port: PORT, host: HOST });
  backendStartedByElectron = true;
}

function showBackendStartError(error) {
  const message =
    error?.code === 'EADDRINUSE'
      ? `No se pudo iniciar la aplicación porque el puerto ${PORT} ya está en uso.`
      : `No se pudo iniciar el backend local.\n\n${error?.message || error}`;

  dialog.showErrorBox('Error iniciando la aplicación', message);
}

async function bootstrapApp() {
  try {
    await ensureBackendStarted();
    createWindow();
  } catch (error) {
    console.error('Electron bootstrap error:', error.message || error);
    showBackendStartError(error);
    app.quit();
  }
}

app.whenReady().then(() => {
  bootstrapApp();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', async (event) => {
  if (!backendStartedByElectron) {
    return;
  }

  backendStartedByElectron = false;
  event.preventDefault();

  try {
    await stopServer();
  } catch (error) {
    console.error('Error stopping backend:', error.message || error);
  } finally {
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
