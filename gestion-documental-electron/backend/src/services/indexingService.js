const { db } = require('../db/db');
const { getAllRootFolders } = require('./rootFolderService');
const { calculateFileHash } = require('./documentService');
const fs = require('fs').promises;
const path = require('path');

async function runIndexing(userId) {
  const runId = await startIndexingRun();
  let scanned = 0, indexed = 0, updated = 0, missing = 0, errors = 0;

  try {
    const rootFolders = await getAllRootFolders();
    for (const folder of rootFolders) {
      if (!folder.is_active) continue;
      await indexFolder(folder, runId, userId, { scanned, indexed, updated, missing, errors });
    }
    await finishIndexingRun(runId, 'completed', scanned, indexed, updated, missing, errors);
  } catch (error) {
    console.error('Indexing error:', error);
    await finishIndexingRun(runId, 'failed', scanned, indexed, updated, missing, errors + 1, error.message);
  }
}

async function startIndexingRun() {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    db.run('INSERT INTO indexing_runs (started_at, status) VALUES (?, ?)', [startedAt, 'running'], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
}

async function finishIndexingRun(runId, status, scanned, indexed, updated, missing, errors, notes = null) {
  return new Promise((resolve, reject) => {
    const finishedAt = new Date().toISOString();
    db.run(
      'UPDATE indexing_runs SET finished_at = ?, status = ?, scanned_files_count = ?, indexed_files_count = ?, updated_files_count = ?, missing_files_count = ?, error_count = ?, notes = ? WHERE id = ?',
      [finishedAt, status, scanned, indexed, updated, missing, errors, notes, runId],
      (err) => err ? reject(err) : resolve()
    );
  });
}

async function indexFolder(folder, runId, userId, counters) {
  const { absolute_path: rootPath, id: rootId, name: rootName } = folder;
  await walkDirectory(rootPath, rootPath, rootId, rootName, runId, userId, counters);
}

async function walkDirectory(dirPath, rootPath, rootId, rootName, runId, userId, counters) {
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      counters.scanned++;
      if (item.isDirectory()) {
        await walkDirectory(fullPath, rootPath, rootId, rootName, runId, userId, counters);
      } else if (item.isFile()) {
        await indexFile(fullPath, rootPath, rootId, rootName, runId, userId, counters);
      }
    }
  } catch (error) {
    console.error(`Error reading dir ${dirPath}:`, error);
    counters.errors++;
  }
}

async function indexFile(filePath, rootPath, rootId, rootName, runId, userId, counters) {
  try {
    const stats = await fs.stat(filePath);
    const hash = await calculateFileHash(filePath);
    const relativePath = path.relative(rootPath, filePath);
    const ext = path.extname(filePath).toLowerCase();

    // Verificar si ya existe
    const existing = await new Promise((resolve, reject) => {
      db.get('SELECT id, file_modified_at FROM documents WHERE file_hash = ? AND root_folder_id = ?', [hash, rootId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    const createdAt = new Date().toISOString();
    const updatedAt = createdAt;

    if (existing) {
      // Verificar si cambió
      if (existing.file_modified_at !== stats.mtime.toISOString()) {
        // Actualizar
        db.run(
          'UPDATE documents SET file_modified_at = ?, updated_at = ?, updated_by = ? WHERE id = ?',
          [stats.mtime.toISOString(), updatedAt, userId, existing.id],
          (err) => {
            if (err) console.error('Update error:', err);
            else counters.updated++;
          }
        );
      }
    } else {
      // Insertar nuevo
      db.run(`
        INSERT INTO documents (
          original_name, absolute_path, relative_path, root_folder_id, root_folder_name,
          file_extension, file_size, file_hash, file_modified_at, status, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        path.basename(filePath), filePath, relativePath, rootId, rootName, ext, stats.size, hash,
        stats.mtime.toISOString(), 'active', userId, userId, createdAt, updatedAt
      ], function(err) {
        if (err) {
          console.error('Insert error:', err);
          counters.errors++;
        } else {
          counters.indexed++;
          // History
          db.run(
            'INSERT INTO document_history (document_id, action, performed_by, performed_at) VALUES (?, ?, ?, ?)',
            [this.lastID, 'indexed', userId, createdAt],
            (err2) => err2 && console.error('History error:', err2)
          );
        }
      });
    }
  } catch (error) {
    console.error(`Error indexing file ${filePath}:`, error);
    counters.errors++;
  }
}

function getIndexingRuns() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM indexing_runs ORDER BY started_at DESC', (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = {
  runIndexing,
  getIndexingRuns,
};