const { db } = require('../db/db');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = require('fs').createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function getDocuments(filters = {}) {
  return new Promise((resolve, reject) => {
    let query = 'SELECT * FROM documents WHERE 1=1';
    const params = [];

    if (filters.name) {
      query += ' AND original_name LIKE ?';
      params.push(`%${filters.name}%`);
    }
    if (filters.date) {
      query += ' AND document_date = ?';
      params.push(filters.date);
    }
    if (filters.voucher) {
      query += ' AND voucher_number LIKE ?';
      params.push(`%${filters.voucher}%`);
    }
    if (filters.rootFolderId) {
      query += ' AND root_folder_id = ?';
      params.push(filters.rootFolderId);
    }
    if (filters.extension) {
      query += ' AND file_extension = ?';
      params.push(filters.extension);
    }
    if (filters.category) {
      query += ' AND category LIKE ?';
      params.push(`%${filters.category}%`);
    }
    if (filters.type) {
      query += ' AND document_type LIKE ?';
      params.push(`%${filters.type}%`);
    }
    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    query += ' ORDER BY created_at DESC';

    db.all(query, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function getDocumentById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM documents WHERE id = ?', [id], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function getRootFolderById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM root_folders WHERE id = ?', [id], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function normalizeRelativePath(relativePath, fallbackFileName) {
  const cleaned = String(relativePath || '')
    .trim()
    .replace(/[\\/]+/g, path.sep)
    .replace(new RegExp(`^[${path.sep === '\\' ? '\\\\' : path.sep}]+`), '');

  return cleaned || fallbackFileName;
}

function ensurePathInsideRoot(rootPath, targetPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);

  if (resolvedTarget === resolvedRoot) {
    return resolvedTarget;
  }

  if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('La ruta relativa queda por fuera de la carpeta raíz seleccionada');
  }

  return resolvedTarget;
}

async function getAvailableDestinationPath(destinationPath) {
  const parsed = path.parse(destinationPath);
  let attempt = 0;
  let candidatePath = destinationPath;

  while (true) {
    try {
      await fs.access(candidatePath);
      attempt += 1;
      candidatePath = path.join(parsed.dir, `${parsed.name}-${attempt}${parsed.ext}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return candidatePath;
      }

      throw error;
    }
  }
}

function createDocument(docData, userId) {
  return new Promise(async (resolve, reject) => {
    try {
      const sourcePath = path.resolve(docData.absolutePath);
      const sourceStats = await fs.stat(sourcePath);
      const sourceFileName = path.basename(sourcePath);
      const rootFolder = await getRootFolderById(docData.rootFolderId);

      if (!rootFolder) {
        throw new Error('La carpeta raíz seleccionada no existe');
      }

      const rootFolderPath = path.resolve(rootFolder.absolute_path);
      const desiredRelativePath = normalizeRelativePath(docData.relativePath, sourceFileName);
      const requestedDestination = ensurePathInsideRoot(
        rootFolderPath,
        path.resolve(rootFolderPath, desiredRelativePath)
      );
      const finalDestinationPath = await getAvailableDestinationPath(requestedDestination);
      const finalRelativePath = path.relative(rootFolderPath, finalDestinationPath);

      await fs.mkdir(path.dirname(finalDestinationPath), { recursive: true });
      await fs.copyFile(sourcePath, finalDestinationPath);

      const hash = await calculateFileHash(finalDestinationPath);
      const stats = await fs.stat(finalDestinationPath);
      const createdAt = new Date().toISOString();
      const updatedAt = createdAt;
      const fileExtension = docData.fileExtension || path.extname(finalDestinationPath).toLowerCase();
      const storedName = path.basename(finalDestinationPath);
      const rootFolderName = rootFolder.name;

      db.run(`
        INSERT INTO documents (
          original_name, stored_name, absolute_path, relative_path, root_folder_id, root_folder_name,
          file_extension, file_size, file_hash, file_modified_at, document_date, voucher_number,
          category, document_type, notes, source_area, status, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        docData.originalName, storedName, finalDestinationPath, finalRelativePath,
        rootFolder.id, rootFolderName, fileExtension, stats.size, hash,
        stats.mtime.toISOString(), docData.documentDate, docData.voucherNumber, docData.category,
        docData.documentType, docData.notes, docData.sourceArea, 'pending', userId, userId, createdAt, updatedAt
      ], function(err) {
        if (err) return reject(err);
        const docId = this.lastID;
        // Registrar en history
        db.run(
          'INSERT INTO document_history (document_id, action, performed_by, performed_at) VALUES (?, ?, ?, ?)',
          [docId, 'created', userId, createdAt],
          (err2) => {
            if (err2) console.error('Error history:', err2);
            resolve({
              id: docId,
              absolutePath: finalDestinationPath,
              relativePath: finalRelativePath,
              copiedFrom: sourcePath
            });
          }
        );
      });
    } catch (error) {
      reject(error);
    }
  });
}

function updateDocument(id, updates, userId) {
  return new Promise((resolve, reject) => {
    const updatedAt = new Date().toISOString();
    const fields = Object.keys(updates).filter(k => k !== 'id');
    const setClause = fields.map(f => `${f} = ?`).join(', ') + ', updated_at = ?, updated_by = ?';
    const values = fields.map(f => updates[f]);
    values.push(updatedAt, userId, id);

    db.run(`UPDATE documents SET ${setClause} WHERE id = ?`, values, function(err) {
      if (err) return reject(err);
      // Registrar cambios en history
      const performedAt = new Date().toISOString();
      const historyInserts = fields.map(field => {
        return new Promise((res, rej) => {
          db.run(
            'INSERT INTO document_history (document_id, action, field_name, new_value, performed_by, performed_at) VALUES (?, ?, ?, ?, ?, ?)',
            [id, 'updated', field, updates[field], userId, performedAt],
            (err2) => err2 ? rej(err2) : res()
          );
        });
      });
      Promise.all(historyInserts).then(() => resolve({ changes: this.changes })).catch(reject);
    });
  });
}

function getDocumentHistory(documentId) {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM document_history WHERE document_id = ? ORDER BY performed_at DESC', [documentId], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function markDocumentMissing(id, userId) {
  return new Promise((resolve, reject) => {
    const performedAt = new Date().toISOString();
    db.run('UPDATE documents SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?', ['missing', performedAt, userId, id], function(err) {
      if (err) return reject(err);
      db.run(
        'INSERT INTO document_history (document_id, action, performed_by, performed_at) VALUES (?, ?, ?, ?)',
        [id, 'marked_missing', userId, performedAt],
        (err2) => err2 ? reject(err2) : resolve({ changes: this.changes })
      );
    });
  });
}

module.exports = {
  getDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  getDocumentHistory,
  markDocumentMissing,
  calculateFileHash,
};
