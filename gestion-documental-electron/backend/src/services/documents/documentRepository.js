const { db } = require('../../db/db');

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
      if (err) {
        return reject(err);
      }

      resolve(rows);
    });
  });
}

function getDocumentById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM documents WHERE id = ?', [id], (err, row) => {
      if (err) {
        return reject(err);
      }

      resolve(row);
    });
  });
}

function getRootFolderById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM root_folders WHERE id = ?', [id], (err, row) => {
      if (err) {
        return reject(err);
      }

      resolve(row);
    });
  });
}

function insertDocument(documentData) {
  return new Promise((resolve, reject) => {
    db.run(
      `
        INSERT INTO documents (
          original_name, stored_name, absolute_path, relative_path, root_folder_id, root_folder_name,
          file_extension, file_size, file_hash, file_modified_at, document_date, voucher_number,
          category, document_type, notes, source_area, status, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        documentData.originalName,
        documentData.storedName,
        documentData.absolutePath,
        documentData.relativePath,
        documentData.rootFolderId,
        documentData.rootFolderName,
        documentData.fileExtension,
        documentData.fileSize,
        documentData.fileHash,
        documentData.fileModifiedAt,
        documentData.documentDate,
        documentData.voucherNumber,
        documentData.category,
        documentData.documentType,
        documentData.notes,
        documentData.sourceArea,
        documentData.status,
        documentData.createdBy,
        documentData.updatedBy,
        documentData.createdAt,
        documentData.updatedAt,
      ],
      function(err) {
        if (err) {
          return reject(err);
        }

        resolve(this.lastID);
      },
    );
  });
}

function updateDocumentFields(id, fieldUpdates, updatedAt, userId) {
  return new Promise((resolve, reject) => {
    const fieldNames = Object.keys(fieldUpdates);
    const setClause =
      fieldNames.map((field) => `${field} = ?`).join(', ') +
      ', updated_at = ?, updated_by = ?';
    const values = fieldNames.map((field) => fieldUpdates[field]);
    values.push(updatedAt, userId, id);

    db.run(
      `UPDATE documents SET ${setClause} WHERE id = ?`,
      values,
      function(err) {
        if (err) {
          return reject(err);
        }

        resolve({ changes: this.changes });
      },
    );
  });
}

function updateDocumentStatus(id, status, performedAt, userId) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE documents SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      [status, performedAt, userId, id],
      function(err) {
        if (err) {
          return reject(err);
        }

        resolve({ changes: this.changes });
      },
    );
  });
}

module.exports = {
  getDocuments,
  getDocumentById,
  getRootFolderById,
  insertDocument,
  updateDocumentFields,
  updateDocumentStatus,
};
