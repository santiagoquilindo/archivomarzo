const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { db, DB_PATH } = require('./db');

const saltRounds = 10;

function initDatabase() {
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
        status TEXT NOT NULL CHECK(status IN ('active', 'inactive')) DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Nuevas tablas para módulo documental
    db.run(`
      CREATE TABLE IF NOT EXISTS root_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        absolute_path TEXT NOT NULL UNIQUE,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_name TEXT NOT NULL,
        stored_name TEXT,
        absolute_path TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        root_folder_id INTEGER NOT NULL,
        root_folder_name TEXT NOT NULL,
        file_extension TEXT,
        file_size INTEGER,
        file_hash TEXT NOT NULL,
        file_modified_at TEXT,
        document_date TEXT,
        voucher_number TEXT,
        category TEXT,
        document_type TEXT,
        notes TEXT,
        source_area TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_by INTEGER,
        updated_by INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (root_folder_id) REFERENCES root_folders (id)
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS document_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        field_name TEXT,
        old_value TEXT,
        new_value TEXT,
        performed_by INTEGER NOT NULL,
        performed_at TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents (id),
        FOREIGN KEY (performed_by) REFERENCES users (id)
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS indexing_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        scanned_files_count INTEGER DEFAULT 0,
        indexed_files_count INTEGER DEFAULT 0,
        updated_files_count INTEGER DEFAULT 0,
        missing_files_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        notes TEXT
      );
    `);

    // Inserción seed
    const createdAt = new Date().toISOString();
    const updatedAt = createdAt;

    const seedUsers = [
      { name: 'Administrador', username: 'admin', password: 'admin123', role: 'admin' },
      { name: 'Usuario Demo', username: 'user', password: 'user123', role: 'user' }
    ];

    const upsert = db.prepare(`
      INSERT OR IGNORE INTO users (name, username, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `);

    seedUsers.forEach((u) => {
      const hash = bcrypt.hashSync(u.password, saltRounds);
      upsert.run(u.name, u.username, hash, u.role, createdAt, updatedAt);
    });

    upsert.finalize(() => {
      console.log('Seed de usuarios aplicado. Credenciales: admin/admin123, user/user123');
      if (require.main === module) {
        db.close();
      }
    });
  });
}

if (require.main === module) {
  initDatabase();
} else {
  module.exports = { initDatabase };
}
