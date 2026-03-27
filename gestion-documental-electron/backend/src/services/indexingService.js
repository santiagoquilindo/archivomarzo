const fs = require('fs');
const path = require('path');
const { db } = require('../db/db');
const { getAllRootFolders } = require('./rootFolderService');
const { calculateFileHash } = require('./documentService');

let indexingInProgress = false;

async function startIndexing(userId) {
  if (indexingInProgress || await hasRunningIndexingRun()) {
    const error = new Error('Ya existe una indexación en ejecución');
    error.code = 'INDEXING_ALREADY_RUNNING';
    throw error;
  }

  indexingInProgress = true;

  try {
    const runId = await createIndexingRun();

    runIndexingProcess(runId, userId)
      .catch((error) => {
        console.error('Background indexing error:', error);
      })
      .finally(() => {
        indexingInProgress = false;
      });

    return runId;
  } catch (error) {
    indexingInProgress = false;
    throw error;
  }
}

async function runIndexingProcess(runId, userId) {
  const counters = { scanned: 0, indexed: 0, updated: 0, missing: 0, errors: 0 };

  try {
    const allRootFolders = await getAllRootFolders();
    const rootFolders = allRootFolders.filter((folder) => folder.is_active);

    console.log(`[INDEXING] Active root folders: ${rootFolders.length}`);

    for (const folder of rootFolders) {
      console.log(`[INDEXING] Processing active folder: ${folder.name}, path: ${folder.absolute_path}`);
      await indexFolder(folder, runId, userId, counters);
    }

    console.log(
      `[INDEXING] Final counters: scanned=${counters.scanned}, indexed=${counters.indexed}, updated=${counters.updated}, missing=${counters.missing}, errors=${counters.errors}`
    );

    const finalStatus = counters.errors > 0 ? 'failed' : 'completed';
    const finalNotes = counters.errors > 0 ? 'La corrida terminó con errores' : null;
    await finishIndexingRun(runId, finalStatus, counters, finalNotes);
  } catch (error) {
    console.error('Indexing error:', error);
    counters.errors++;
    await finishIndexingRun(runId, 'failed', counters, error.message);
  }
}

async function hasRunningIndexingRun() {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT id FROM indexing_runs WHERE status = ? ORDER BY started_at DESC LIMIT 1',
      ['running'],
      (err, row) => {
        if (err) return reject(err);
        resolve(Boolean(row));
      }
    );
  });
}

async function createIndexingRun() {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    db.run(
      'INSERT INTO indexing_runs (started_at, status) VALUES (?, ?)',
      [startedAt, 'running'],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
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
  const existingDocuments = await getDocumentsByRootFolder(rootId);
  const seenPaths = new Set();

  console.log(`[INDEXING] Indexing folder: ${rootName}, raw path: ${rootPathRaw}, normalized: ${rootPath}`);

  try {
    fs.accessSync(rootPath);
  } catch (error) {
    console.error(`[INDEXING] Path does not exist: ${rootPath}, error: ${error.message}`);
    counters.errors++;
    await markMissingDocuments(existingDocuments, seenPaths, userId, counters);
    return;
  }

  await walkDirectory(rootPath, rootPath, rootId, rootName, runId, userId, counters, existingDocuments, seenPaths);
  await markMissingDocuments(existingDocuments, seenPaths, userId, counters);
}

async function walkDirectory(dirPath, rootPath, rootId, rootName, runId, userId, counters, existingDocuments, seenPaths) {
  const normalizedDirPath = path.resolve(dirPath);

  try {
    const itemNames = fs.readdirSync(normalizedDirPath);

    for (const itemName of itemNames) {
      const fullPath = path.join(normalizedDirPath, itemName);
      counters.scanned++;

      try {
        const stats = fs.statSync(fullPath);
        if (stats.isDirectory()) {
          await walkDirectory(fullPath, rootPath, rootId, rootName, runId, userId, counters, existingDocuments, seenPaths);
        } else if (stats.isFile()) {
          await indexFile(fullPath, rootPath, rootId, rootName, runId, userId, counters, existingDocuments, seenPaths, stats);
        }
      } catch (statError) {
        console.error(`Error stating ${fullPath}:`, statError);
        counters.errors++;
      }
    }
  } catch (error) {
    console.error(`Error reading dir ${normalizedDirPath}:`, error);
    counters.errors++;
  }
}

async function indexFile(filePath, rootPath, rootId, rootName, runId, userId, counters, existingDocuments, seenPaths, stats) {
  const normalizedPath = path.resolve(filePath);
  const existingDocument = existingDocuments.get(normalizedPath);
  const fileModifiedAt = stats.mtime.toISOString();
  const relativePath = path.relative(rootPath, normalizedPath);
  const fileExtension = path.extname(normalizedPath).toLowerCase();
  const originalName = path.basename(normalizedPath);
  const updatedAt = new Date().toISOString();

  seenPaths.add(normalizedPath);

  try {
    if (!existingDocument) {
      const fileHash = await calculateFileHash(normalizedPath);
      const documentId = await insertIndexedDocument({
        originalName,
        absolutePath: normalizedPath,
        relativePath,
        rootFolderId: rootId,
        rootFolderName: rootName,
        fileExtension,
        fileSize: stats.size,
        fileHash,
        fileModifiedAt,
        userId,
        createdAt: updatedAt
      });

      existingDocuments.set(normalizedPath, {
        id: documentId,
        absolute_path: normalizedPath,
        original_name: originalName,
        relative_path: relativePath,
        file_extension: fileExtension,
        file_size: stats.size,
        file_modified_at: fileModifiedAt,
        file_hash: fileHash,
        status: 'available'
      });
      counters.indexed++;
      return;
    }

    const unchangedFile =
      Number(existingDocument.file_size) === Number(stats.size) &&
      existingDocument.file_modified_at === fileModifiedAt;

    if (unchangedFile && existingDocument.status === 'available') {
      return;
    }

    let nextHash = existingDocument.file_hash;
    if (!unchangedFile) {
      nextHash = await calculateFileHash(normalizedPath);
    }

    const shouldUpdate =
      !unchangedFile ||
      existingDocument.status !== 'available' ||
      existingDocument.relative_path !== relativePath ||
      existingDocument.original_name !== originalName ||
      existingDocument.file_extension !== fileExtension;

    if (!shouldUpdate) {
      return;
    }

    const nextStatus = unchangedFile ? 'available' : 'updated';

    await updateIndexedDocument(existingDocument.id, {
      originalName,
      absolutePath: normalizedPath,
      relativePath,
      rootFolderName: rootName,
      fileExtension,
      fileSize: stats.size,
      fileHash: nextHash,
      fileModifiedAt,
      status: nextStatus,
      updatedAt,
      userId
    });

    existingDocuments.set(normalizedPath, {
      ...existingDocument,
      original_name: originalName,
      absolute_path: normalizedPath,
      relative_path: relativePath,
      root_folder_name: rootName,
      file_extension: fileExtension,
      file_size: stats.size,
      file_hash: nextHash,
      file_modified_at: fileModifiedAt,
      status: nextStatus
    });

    if (nextStatus === 'updated') {
      counters.updated++;
    }
  } catch (error) {
    console.error(`Error indexing file ${normalizedPath}:`, error);
    if (existingDocument) {
      await markDocumentError(existingDocument.id, userId, error.message);
      existingDocuments.set(normalizedPath, { ...existingDocument, status: 'error' });
    }
    counters.errors++;
  }
}

async function getDocumentsByRootFolder(rootFolderId) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM documents WHERE root_folder_id = ? ORDER BY id DESC',
      [rootFolderId],
      (err, rows) => {
        if (err) return reject(err);

        const documentsByPath = new Map();
        rows.forEach((row) => {
          const normalizedPath = path.resolve(row.absolute_path);
          if (!documentsByPath.has(normalizedPath)) {
            documentsByPath.set(normalizedPath, row);
          }
        });

        resolve(documentsByPath);
      }
    );
  });
}

async function insertIndexedDocument(data) {
  return new Promise((resolve, reject) => {
    db.run(
      `
        INSERT INTO documents (
          original_name, absolute_path, relative_path, root_folder_id, root_folder_name,
          file_extension, file_size, file_hash, file_modified_at, status, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        data.originalName,
        data.absolutePath,
        data.relativePath,
        data.rootFolderId,
        data.rootFolderName,
        data.fileExtension,
        data.fileSize,
        data.fileHash,
        data.fileModifiedAt,
        'available',
        data.userId,
        data.userId,
        data.createdAt,
        data.createdAt
      ],
      function(err) {
        if (err) return reject(err);

        const documentId = this.lastID;
        db.run(
          'INSERT INTO document_history (document_id, action, performed_by, performed_at) VALUES (?, ?, ?, ?)',
          [documentId, 'indexed', data.userId, data.createdAt],
          (historyError) => {
            if (historyError) console.error('History error:', historyError);
            resolve(documentId);
          }
        );
      }
    );
  });
}

async function updateIndexedDocument(documentId, data) {
  return new Promise((resolve, reject) => {
    db.run(
      `
        UPDATE documents
        SET original_name = ?, absolute_path = ?, relative_path = ?, root_folder_name = ?,
            file_extension = ?, file_size = ?, file_hash = ?, file_modified_at = ?,
            status = ?, updated_at = ?, updated_by = ?
        WHERE id = ?
      `,
      [
        data.originalName,
        data.absolutePath,
        data.relativePath,
        data.rootFolderName,
        data.fileExtension,
        data.fileSize,
        data.fileHash,
        data.fileModifiedAt,
        data.status,
        data.updatedAt,
        data.userId,
        documentId
      ],
      (err) => {
        if (err) return reject(err);

        db.run(
          'INSERT INTO document_history (document_id, action, performed_by, performed_at) VALUES (?, ?, ?, ?)',
          [documentId, 'reindexed', data.userId, data.updatedAt],
          (historyError) => {
            if (historyError) console.error('History error:', historyError);
            resolve();
          }
        );
      }
    );
  });
}

async function markMissingDocuments(existingDocuments, seenPaths, userId, counters) {
  for (const [absolutePath, document] of existingDocuments.entries()) {
    if (seenPaths.has(absolutePath) || document.status === 'missing') {
      continue;
    }

    const performedAt = new Date().toISOString();

    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE documents SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?',
        ['missing', performedAt, userId, document.id],
        (err) => {
          if (err) return reject(err);

          db.run(
            'INSERT INTO document_history (document_id, action, performed_by, performed_at) VALUES (?, ?, ?, ?)',
            [document.id, 'marked_missing', userId, performedAt],
            (historyError) => historyError ? reject(historyError) : resolve()
          );
        }
      );
    });

    existingDocuments.set(absolutePath, { ...document, status: 'missing' });
    counters.missing++;
  }
}

async function markDocumentError(documentId, userId, errorMessage) {
  const performedAt = new Date().toISOString();

  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE documents SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      ['error', performedAt, userId, documentId],
      (err) => {
        if (err) return reject(err);

        db.run(
          'INSERT INTO document_history (document_id, action, new_value, performed_by, performed_at) VALUES (?, ?, ?, ?, ?)',
          [documentId, 'error', errorMessage, userId, performedAt],
          (historyError) => historyError ? reject(historyError) : resolve()
        );
      }
    );
  });
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
  startIndexing,
  getIndexingRuns,
  hasRunningIndexingRun
};
