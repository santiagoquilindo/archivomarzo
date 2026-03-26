const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Base de datos local en el workspace
const DB_PATH = path.resolve(__dirname, '../../../data/app.db');
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
