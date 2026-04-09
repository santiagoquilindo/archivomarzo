const { db } = require('../../db/db');

function addDocumentHistoryEntry(
  documentId,
  action,
  userId,
  fieldName = null,
  newValue = null,
) {
  return new Promise((resolve, reject) => {
    const performedAt = new Date().toISOString();
    db.run(
      'INSERT INTO document_history (document_id, action, field_name, new_value, performed_by, performed_at) VALUES (?, ?, ?, ?, ?, ?)',
      [documentId, action, fieldName, newValue, userId, performedAt],
      function(err) {
        if (err) {
          return reject(err);
        }

        resolve({ id: this.lastID });
      },
    );
  });
}

function getDocumentHistory(documentId) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM document_history WHERE document_id = ? ORDER BY performed_at DESC',
      [documentId],
      (err, rows) => {
        if (err) {
          return reject(err);
        }

        resolve(rows);
      },
    );
  });
}

module.exports = {
  addDocumentHistoryEntry,
  getDocumentHistory,
};
