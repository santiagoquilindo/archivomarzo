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

const app = express();
const PORT = 3000;

// Config
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

// Rutas API
app.use('/api/auth', authRoutes);
app.use('/api/protected', protectedRoutes);
app.use('/api/root-folders', rootFolderRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/indexing', indexingRoutes);

// Archivos frontend estáticos para pruebas de desarrollo
app.use(express.static(path.join(__dirname, '../../frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/index.html'));
});

app.use((req, res) => {
  res.status(404).json({ message: 'No encontrado' });
});

app.use((err, req, res, next) => {
  console.error('Middleware error:', err);
  res.status(500).json({ message: 'Error interno del servidor' });
});

initDatabase();

app.listen(PORT, () => {
  console.log(`API local escuchando en http://localhost:${PORT}`);
});
