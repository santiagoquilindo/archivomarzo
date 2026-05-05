const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');

let mainWindow = null;
let backendStartedByElectron = false;
let serverApi = null;

const isProduction = app.isPackaged;

function configureRuntimePaths() {
  const userDataPath = isProduction
    ? app.getPath('userData')
    : path.join(__dirname, '..', '..', 'electron-user-data');

  if (!isProduction) {
    app.setPath('userData', userDataPath);
  }

  process.env.NODE_ENV = isProduction ? 'production' : process.env.NODE_ENV || 'development';
  process.env.APP_HOST = process.env.APP_HOST || '127.0.0.1';
  process.env.PORT = process.env.PORT || (isProduction ? '0' : '3000');
  process.env.SAG_DOCUMENTAL_DATA_DIR = path.join(userDataPath, 'data');
}

configureRuntimePaths();

function getServerApi() {
  if (!serverApi) {
    serverApi = require('../backend/src/server');
  }

  return serverApi;
}

function createWindow(baseUrl) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    title: 'Gestión Documental SAG Cauca',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !isProduction,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(baseUrl);

  if (!isProduction) {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
}

async function ensureBackendStarted() {
  const { startServer } = getServerApi();
  await startServer();
  backendStartedByElectron = true;
}

function showBackendStartError(error) {
  const port = process.env.PORT || '3000';
  const message =
    error?.code === 'EADDRINUSE'
      ? `No se pudo iniciar la aplicación porque el puerto ${port} ya está en uso.`
      : `No se pudo iniciar el backend local.\n\n${error?.message || error}`;

  dialog.showErrorBox('Error iniciando la aplicación', message);
}

async function bootstrapApp() {
  try {
    await ensureBackendStarted();
    const { getServerBaseUrl } = getServerApi();
    createWindow(getServerBaseUrl());
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
      const { getServerBaseUrl } = getServerApi();
      createWindow(getServerBaseUrl());
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
    const { stopServer } = getServerApi();
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
