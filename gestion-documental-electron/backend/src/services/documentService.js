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

function createDocument(docData, userId) {
  return new Promise(async (resolve, reject) => {
    try {
      const hash = await calculateFileHash(docData.absolutePath);
      const stats = await fs.stat(docData.absolutePath);
      const createdAt = new Date().toISOString();
      const updatedAt = createdAt;

      db.run(`
        INSERT INTO documents (
          original_name, stored_name, absolute_path, relative_path, root_folder_id, root_folder_name,
          file_extension, file_size, file_hash, file_modified_at, document_date, voucher_number,
          category, document_type, notes, source_area, status, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        docData.originalName, docData.storedName, docData.absolutePath, docData.relativePath,
        docData.rootFolderId, docData.rootFolderName, docData.fileExtension, stats.size, hash,
        stats.mtime.toISOString(), docData.documentDate, docData.voucherNumber, docData.category,
        docData.documentType, docData.notes, docData.sourceArea, 'active', userId, userId, createdAt, updatedAt
      ], function(err) {
        if (err) return reject(err);
        const docId = this.lastID;
        // Registrar en history
        db.run(
          'INSERT INTO document_history (document_id, action, performed_by, performed_at) VALUES (?, ?, ?, ?)',
          [docId, 'created', userId, createdAt],
          (err2) => {
            if (err2) console.error('Error history:', err2);
            resolve({ id: docId });
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
    db.run('UPDATE documents SET status = ? WHERE id = ?', ['missing', id], function(err) {
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