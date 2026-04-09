const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const { initDatabase } = require('./db/init');
const authRoutes = require('./routes/auth');
const protectedRoutes = require('./routes/protected');
const rootFolderRoutes = require('./routes/rootFolders');
const documentRoutes = require('./routes/documents');
const indexingRoutes = require('./routes/indexing');
const { BASE_URL, FRONTEND_PUBLIC_CONFIG, HOST, PORT } = require('./config');
const { sendError } = require('./utils/http');

const app = express();
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

let databaseInitialized = false;
let activeServer = null;
let activeStartPromise = null;

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', contentSecurityPolicy);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

app.get('/app-config.js', (req, res) => {
  res.type('application/javascript');
  res.send(`window.APP_CONFIG = ${JSON.stringify(FRONTEND_PUBLIC_CONFIG, null, 2)};`);
});

app.use('/api/auth', authRoutes);
app.use('/api/protected', protectedRoutes);
app.use('/api/root-folders', rootFolderRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/indexing', indexingRoutes);

app.use(express.static(path.join(__dirname, '../../frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/index.html'));
});

app.use((req, res) => {
  sendError(res, { statusCode: 404, message: 'No encontrado', code: 'NOT_FOUND' });
});

app.use((err, req, res, next) => {
  console.error('Middleware error:', err.message || err);
  sendError(res, err, 'Error interno del servidor');
});

function ensureDatabaseInitialized() {
  if (!databaseInitialized) {
    initDatabase();
    databaseInitialized = true;
  }
}

function buildListenError(error, port) {
  if (error?.code === 'EADDRINUSE') {
    error.message = `El puerto ${port} ya está en uso`;
  }

  return error;
}

function startServer(options = {}) {
  if (activeServer) {
    return Promise.resolve(activeServer);
  }

  if (activeStartPromise) {
    return activeStartPromise;
  }

  const port = Number.parseInt(options.port || PORT, 10);
  const host = options.host || HOST;

  ensureDatabaseInitialized();

  activeStartPromise = new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      activeServer = server;
      activeStartPromise = null;
      console.log(`API local escuchando en http://${host}:${port}`);
      resolve(server);
    });

    server.once('error', (error) => {
      activeStartPromise = null;
      reject(buildListenError(error, port));
    });
  });

  return activeStartPromise;
}

function stopServer() {
  if (!activeServer) {
    return Promise.resolve();
  }

  const serverToClose = activeServer;
  activeServer = null;

  return new Promise((resolve, reject) => {
    serverToClose.close((error) => {
      if (error) {
        return reject(error);
      }

      resolve();
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Server start error:', error.message || error);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
  stopServer,
};
