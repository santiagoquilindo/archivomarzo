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
const { sendError } = require('./utils/http');

const app = express();
const PORT = 3000;
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' http://localhost:3000 http://127.0.0.1:3000",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

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

initDatabase();

app.listen(PORT, () => {
  console.log(`API local escuchando en http://localhost:${PORT}`);
});
