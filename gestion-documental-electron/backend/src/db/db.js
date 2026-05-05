const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const localDataDir =
  process.env.SAG_DOCUMENTAL_DATA_DIR ||
  path.resolve(__dirname, '../../../data');

const DB_PATH = path.join(localDataDir, 'app.db');
const DB_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error al conectar SQLite:', err.message);
    process.exit(1);
  }
  console.log('Conectado a SQLite en', DB_PATH);
});

module.exports = {
  db,
  DB_PATH,
};
