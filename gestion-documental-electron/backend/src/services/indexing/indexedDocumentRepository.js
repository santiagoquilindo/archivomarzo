const path = require('path');
const { db } = require('../../db/db');

function getDocumentsByRootFolder(rootFolderId) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM documents WHERE root_folder_id = ? ORDER BY id DESC',
      [rootFolderId],
      (err, rows) => {
        if (err) {
          return reject(err);
        }

        const documentsByPath = new Map();
        rows.forEach((row) => {
          const normalizedPath = path.resolve(row.absolute_path);
          if (!documentsByPath.has(normalizedPath)) {
            documentsByPath.set(normalizedPath, row);
          }
        });

        resolve(documentsByPath);
      },
    );
  });
}

function insertIndexedDocument(data) {
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
        data.createdAt,
      ],
      function(err) {
        if (err) {
          return reject(err);
        }

        const documentId = this.lastID;
        db.run(
          'INSERT INTO document_history (document_id, action, performed_by, performed_at) VALUES (?, ?, ?, ?)',
          [documentId, 'indexed', data.userId, data.createdAt],
          (historyError) => {
            if (historyError) {
              return reject(historyError);
            }

            resolve(documentId);
          },
        );
      },
    );
  });
}

function updateIndexedDocument(documentId, data) {
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
        documentId,
      ],
      (err) => {
        if (err) {
          return reject(err);
        }

        db.run(
          'INSERT INTO document_history (document_id, action, performed_by, performed_at) VALUES (?, ?, ?, ?)',
          [documentId, 'reindexed', data.userId, data.updatedAt],
          (historyError) => {
            if (historyError) {
              return reject(historyError);
            }

            resolve();
          },
        );
      },
    );
  });
}

function markDocumentMissing(documentId, userId, performedAt) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE documents SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      ['missing', performedAt, userId, documentId],
      (err) => {
        if (err) {
          return reject(err);
        }

        db.run(
          'INSERT INTO document_history (document_id, action, performed_by, performed_at) VALUES (?, ?, ?, ?)',
          [documentId, 'marked_missing', userId, performedAt],
          (historyError) => {
            if (historyError) {
              return reject(historyError);
            }

            resolve();
          },
        );
      },
    );
  });
}

function markDocumentError(documentId, userId, errorMessage, performedAt) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE documents SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      ['error', performedAt, userId, documentId],
      (err) => {
        if (err) {
          return reject(err);
        }

        db.run(
          'INSERT INTO document_history (document_id, action, new_value, performed_by, performed_at) VALUES (?, ?, ?, ?, ?)',
          [documentId, 'error', errorMessage, userId, performedAt],
          (historyError) => {
            if (historyError) {
              return reject(historyError);
            }

            resolve();
          },
        );
      },
    );
  });
}

function clearIndexedDocuments() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      db.run('DELETE FROM document_history', function onDeleteHistory(historyError) {
        if (historyError) {
          db.run('ROLLBACK');
          reject(historyError);
          return;
        }

        const deletedHistory = this.changes || 0;

        db.run('DELETE FROM documents', function onDeleteDocuments(documentsError) {
          if (documentsError) {
            db.run('ROLLBACK');
            reject(documentsError);
            return;
          }

          const deletedDocuments = this.changes || 0;

          db.run('COMMIT', (commitError) => {
            if (commitError) {
              reject(commitError);
              return;
            }

            resolve({
              deletedDocuments,
              deletedHistory,
            });
          });
        });
      });
    });
  });
}

module.exports = {
  clearIndexedDocuments,
  getDocumentsByRootFolder,
  insertIndexedDocument,
  updateIndexedDocument,
  markDocumentMissing,
  markDocumentError,
};
