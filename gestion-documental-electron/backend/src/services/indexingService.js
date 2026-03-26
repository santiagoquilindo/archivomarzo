const fs = require('fs');
const path = require('path');
const { db } = require('../db/db');
const { getAllRootFolders } = require('./rootFolderService');
const { calculateFileHash } = require('./documentService');

async function runIndexing(userId) {
  const runId = await startIndexingRun();
  const counters = { scanned: 0, indexed: 0, updated: 0, missing: 0, errors: 0 };

  try {
    const allRootFolders = await getAllRootFolders();
    console.log(`[INDEXING] Total root folders in DB: ${allRootFolders.length}`);
    allRootFolders.forEach(folder => {
      console.log(`[INDEXING] Folder ID: ${folder.id}, Name: ${folder.name}, Path: ${folder.absolute_path}, Active: ${folder.is_active}`);
    });

    const rootFolders = allRootFolders.filter(f => f.is_active);
    console.log(`[INDEXING] Active root folders: ${rootFolders.length}`);
    for (const folder of rootFolders) {
      console.log(`[INDEXING] Processing active folder: ${folder.name}, path: ${folder.absolute_path}`);
      await indexFolder(folder, runId, userId, counters);
    }
    console.log(`[INDEXING] Final counters: scanned=${counters.scanned}, indexed=${counters.indexed}, updated=${counters.updated}, missing=${counters.missing}, errors=${counters.errors}`);
    console.log(`[INDEXING] Completed run with scanned=${counters.scanned} indexed=${counters.indexed}`);
    await finishIndexingRun(runId, 'completed', counters);
  } catch (error) {
    console.error('Indexing error:', error);
    counters.errors++;
    await finishIndexingRun(runId, 'failed', counters, error.message);
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

async function finishIndexingRun(runId, status, counters, notes = null) {
  return new Promise((resolve, reject) => {
    const finishedAt = new Date().toISOString();
    db.run(
      'UPDATE indexing_runs SET finished_at = ?, status = ?, scanned_files_count = ?, indexed_files_count = ?, updated_files_count = ?, missing_files_count = ?, error_count = ?, notes = ? WHERE id = ?',
      [finishedAt, status, counters.scanned, counters.indexed, counters.updated, counters.missing, counters.errors, notes, runId],
      (err) => err ? reject(err) : resolve()
    );
  });
}

async function indexFolder(folder, runId, userId, counters) {
  const { absolute_path: rootPathRaw, id: rootId, name: rootName } = folder;
  const rootPath = path.resolve(rootPathRaw);
  console.log(`[INDEXING] Indexing folder: ${rootName}, raw path: ${rootPathRaw}, normalized: ${rootPath}`);
  try {
    fs.accessSync(rootPath);
    console.log(`[INDEXING] Path exists: ${rootPath}`);
  } catch (error) {
    console.error(`[INDEXING] Path does not exist: ${rootPath}, error: ${error.message}`);
    counters.errors++;
    return;
  }
  console.log(`[INDEXING] Starting walk for: ${rootPath}`);
  await walkDirectory(rootPath, rootPath, rootId, rootName, runId, userId, counters);
}

async function walkDirectory(dirPath, rootPath, rootId, rootName, runId, userId, counters) {
  dirPath = path.resolve(dirPath);
  console.log(`[INDEXING] Enter walkDirectory for: ${dirPath}`);
  try {
    console.log(`[INDEXING] Reading dir: ${dirPath}`);
    const itemNames = fs.readdirSync(dirPath);
    console.log(`[INDEXING] Items found: ${itemNames.length}`);
    for (const itemName of itemNames) {
      console.log(`[INDEXING] Processing item: ${itemName}`);
      const fullPath = path.join(dirPath, itemName);
      counters.scanned++;
      try {
        const stats = fs.statSync(fullPath);
        if (stats.isDirectory()) {
          console.log(`[INDEXING] Descending into subdirectory: ${fullPath}`);
          await walkDirectory(fullPath, rootPath, rootId, rootName, runId, userId, counters);
        } else if (stats.isFile()) {
          console.log(`[INDEXING] File found: ${fullPath}`);
          await indexFile(fullPath, rootPath, rootId, rootName, runId, userId, counters);
        } else {
          console.log(`[INDEXING] Skipping non-file/dir: ${fullPath}`);
        }
      } catch (statError) {
        console.error(`Error stating ${fullPath}:`, statError);
        counters.errors++;
      }
    }
    console.log(`[INDEXING] Exit walkDirectory for: ${dirPath}, scanned so far: ${counters.scanned}`);
  } catch (error) {
    console.error(`Error reading dir ${dirPath}:`, error);
    counters.errors++;
  }
}

async function indexFile(filePath, rootPath, rootId, rootName, runId, userId, counters) {
  console.log(`[INDEXING] indexFile called for: ${filePath}`);
  try {
    const stats = fs.statSync(filePath);
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
        await new Promise((resolve, reject) => {
          db.run(
          'UPDATE documents SET file_modified_at = ?, updated_at = ?, updated_by = ? WHERE id = ?',
          [stats.mtime.toISOString(), updatedAt, userId, existing.id],
          (err) => {
            if (err) {
              console.error('Update error:', err);
              reject(err);
            } else {
              counters.updated++;
              console.log(`[INDEXING] Updated file: ${filePath}`);
              resolve();
            }
          }
          );
        });
      } else {
        console.log(`[INDEXING] File unchanged: ${filePath}`);
      }
    } else {
      // Insertar nuevo
      console.log(`[INDEXING] Inserting new file: ${filePath}`);
      const documentId = await new Promise((resolve, reject) => {
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
            reject(err);
          } else {
            resolve(this.lastID);
          }
        });
      });

      counters.indexed++;
      console.log(`[INDEXING] Indexed file: ${filePath}, id: ${documentId}, indexed so far: ${counters.indexed}`);

      await new Promise((resolve) => {
        db.run(
          'INSERT INTO document_history (document_id, action, performed_by, performed_at) VALUES (?, ?, ?, ?)',
          [documentId, 'indexed', userId, createdAt],
          (err2) => {
            if (err2) console.error('History error:', err2);
            resolve();
          }
        );
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
