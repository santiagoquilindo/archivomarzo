const { db, DB_PATH } = require('../../db/db');

const SEARCHABLE_FIELDS = [
  'original_name',
  'relative_path',
  'absolute_path',
  'file_extension',
  'root_folder_name',
  'category',
  'document_type',
  'notes',
  'voucher_number',
];

function createPathSearchVariants(value) {
  const variants = new Set([value]);

  if (value.includes('/')) {
    variants.add(value.replace(/\//g, '\\'));
  }

  if (value.includes('\\')) {
    variants.add(value.replace(/\\/g, '/'));
  }

  return [...variants].map((variant) => `%${variant}%`);
}

function buildSearchClause(search) {
  if (!search) {
    return { clause: '', params: [] };
  }

  const params = [];
  const terms = SEARCHABLE_FIELDS.map((field) => {
    if (field === 'relative_path' || field === 'absolute_path') {
      const variants = createPathSearchVariants(search);
      params.push(...variants, `%${search.replace(/\\/g, '/')}%`);
      return `(
        LOWER(COALESCE(d.${field}, '')) LIKE LOWER(?)
        ${variants.length > 1 ? " OR LOWER(COALESCE(d." + field + ", '')) LIKE LOWER(?)" : ''}
        OR LOWER(REPLACE(COALESCE(d.${field}, ''), '\\', '/')) LIKE LOWER(?)
      )`;
    }

    params.push(`%${search}%`);
    return `LOWER(COALESCE(d.${field}, '')) LIKE LOWER(?)`;
  });

  return {
    clause: ` AND (${terms.join(' OR ')})`,
    params,
  };
}

function logSearchQuery(search, query, params, resultCount) {
  console.log('[DOCUMENT_SEARCH] term:', search || '');
  console.log('[DOCUMENT_SEARCH] sql:', query.replace(/\s+/g, ' ').trim());
  console.log('[DOCUMENT_SEARCH] params:', JSON.stringify(params));
  console.log('[DOCUMENT_SEARCH] results:', resultCount);
}

function getDocuments(filters = {}) {
  return new Promise((resolve, reject) => {
    let query = `
      SELECT d.*
      FROM documents d
      INNER JOIN root_folders rf
        ON rf.id = d.root_folder_id
       AND rf.is_active = 1
      WHERE 1=1
    `;
    const params = [];
    const searchClause = buildSearchClause(filters.search);

    if (searchClause.clause) {
      query += searchClause.clause;
      params.push(...searchClause.params);
    }

    if (filters.name) {
      query += ' AND d.original_name LIKE ?';
      params.push(`%${filters.name}%`);
    }
    if (filters.date) {
      query += ' AND d.document_date = ?';
      params.push(filters.date);
    }
    if (filters.voucher) {
      query += ' AND d.voucher_number LIKE ?';
      params.push(`%${filters.voucher}%`);
    }
    if (filters.rootFolderId) {
      query += ' AND d.root_folder_id = ?';
      params.push(filters.rootFolderId);
    }
    if (filters.extension) {
      query += ' AND d.file_extension = ?';
      params.push(filters.extension);
    }
    if (filters.category) {
      query += ' AND d.category LIKE ?';
      params.push(`%${filters.category}%`);
    }
    if (filters.type) {
      query += ' AND d.document_type LIKE ?';
      params.push(`%${filters.type}%`);
    }
    if (filters.status) {
      query += ' AND d.status = ?';
      params.push(filters.status);
    }

    query += ' ORDER BY d.created_at DESC';

    db.all(query, params, (err, rows) => {
      if (err) {
        return reject(err);
      }

      if (filters.search) {
        logSearchQuery(filters.search, query, params, rows.length);
      }

      resolve(rows);
    });
  });
}

function getDocumentDebugStats() {
  return new Promise((resolve, reject) => {
    const stats = {
      databasePath: DB_PATH,
    };

    db.serialize(() => {
      db.get('SELECT COUNT(*) AS total FROM documents', (totalError, totalRow) => {
        if (totalError) {
          reject(totalError);
          return;
        }

        stats.totalDocuments = totalRow?.total || 0;

        db.all(
          'SELECT COALESCE(status, "pending") AS status, COUNT(*) AS total FROM documents GROUP BY COALESCE(status, "pending") ORDER BY status',
          (statusError, statusRows) => {
            if (statusError) {
              reject(statusError);
              return;
            }

            stats.totalByStatus = statusRows || [];

            db.get(
              'SELECT COUNT(*) AS total FROM root_folders WHERE is_active = 1',
              (rootFolderError, rootFolderRow) => {
                if (rootFolderError) {
                  reject(rootFolderError);
                  return;
                }

                stats.activeRootFolders = rootFolderRow?.total || 0;

                db.all(
                  `
                    SELECT id, original_name, relative_path, absolute_path, root_folder_id,
                           root_folder_name, file_extension, status, created_at, updated_at
                    FROM documents
                    ORDER BY datetime(created_at) DESC, id DESC
                    LIMIT 10
                  `,
                  (documentsError, documentRows) => {
                    if (documentsError) {
                      reject(documentsError);
                      return;
                    }

                    stats.lastIndexedDocuments = documentRows || [];

                    db.get(
                      'SELECT * FROM indexing_runs ORDER BY datetime(started_at) DESC, id DESC LIMIT 1',
                      (runError, runRow) => {
                        if (runError) {
                          reject(runError);
                          return;
                        }

                        stats.lastIndexingRun = runRow || null;
                        resolve(stats);
                      },
                    );
                  },
                );
              },
            );
          },
        );
      });
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
  getDocumentDebugStats,
  getDocuments,
  getDocumentById,
  getRootFolderById,
  insertDocument,
  updateDocumentFields,
  updateDocumentStatus,
};
