const { db } = require('../db/db');

function getAllRootFolders() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM root_folders ORDER BY name', (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function createRootFolder(name, absolutePath) {
  return new Promise((resolve, reject) => {
    const createdAt = new Date().toISOString();
    const updatedAt = createdAt;
    db.run(
      'INSERT INTO root_folders (name, absolute_path, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
      [name, absolutePath, createdAt, updatedAt],
      function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, name, absolute_path: absolutePath, is_active: 1, created_at: createdAt, updated_at: updatedAt });
      }
    );
  });
}

function updateRootFolder(id, name, absolutePath, isActive) {
  return new Promise((resolve, reject) => {
    const updatedAt = new Date().toISOString();
    db.run(
      'UPDATE root_folders SET name = ?, absolute_path = ?, is_active = ?, updated_at = ? WHERE id = ?',
      [name, absolutePath, isActive ? 1 : 0, updatedAt, id],
      function(err) {
        if (err) return reject(err);
        resolve({ changes: this.changes });
      }
    );
  });
}

function deleteRootFolder(id) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM root_folders WHERE id = ?', [id], function(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes });
    });
  });
}

module.exports = {
  getAllRootFolders,
  createRootFolder,
  updateRootFolder,
  deleteRootFolder,
};