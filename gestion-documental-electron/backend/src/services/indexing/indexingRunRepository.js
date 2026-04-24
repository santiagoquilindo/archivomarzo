const { db } = require('../../db/db');

function hasRunningIndexingRun() {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT id FROM indexing_runs WHERE status = ? ORDER BY started_at DESC LIMIT 1',
      ['running'],
      (err, row) => {
        if (err) {
          return reject(err);
        }

        resolve(Boolean(row));
      },
    );
  });
}

function createIndexingRun() {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();

    db.run(
      'INSERT INTO indexing_runs (started_at, status) VALUES (?, ?)',
      [startedAt, 'running'],
      function(err) {
        if (err) {
          return reject(err);
        }

        resolve(this.lastID);
      },
    );
  });
}

function serializeNotes(notes, metadata = {}) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return notes;
  }

  return JSON.stringify({
    message: notes,
    ...metadata,
  });
}

function finishIndexingRun(runId, status, counters, notes = null, metadata = {}) {
  return new Promise((resolve, reject) => {
    const finishedAt = new Date().toISOString();

    db.run(
      'UPDATE indexing_runs SET finished_at = ?, status = ?, scanned_files_count = ?, indexed_files_count = ?, updated_files_count = ?, missing_files_count = ?, error_count = ?, notes = ? WHERE id = ?',
      [
        finishedAt,
        status,
        counters.scanned,
        counters.indexed,
        counters.updated,
        counters.missing,
        counters.errors,
        serializeNotes(notes, metadata),
        runId,
      ],
      (err) => {
        if (err) {
          return reject(err);
        }

        resolve();
      },
    );
  });
}

function deleteIndexingRunsByRootFolder(rootFolderId) {
  return new Promise((resolve, reject) => {
    db.all('SELECT id, notes FROM indexing_runs WHERE notes IS NOT NULL', (selectError, rows) => {
      if (selectError) {
        return reject(selectError);
      }

      const idsToDelete = rows
        .filter((row) => {
          try {
            const parsed = JSON.parse(row.notes);
            return Array.isArray(parsed.rootFolderIds) &&
              parsed.rootFolderIds.map(Number).includes(Number(rootFolderId));
          } catch (error) {
            return String(row.notes).includes(`root:${rootFolderId}`);
          }
        })
        .map((row) => row.id);

      if (idsToDelete.length === 0) {
        resolve({ changes: 0 });
        return;
      }

      const placeholders = idsToDelete.map(() => '?').join(', ');
      db.run(
        `DELETE FROM indexing_runs WHERE id IN (${placeholders})`,
        idsToDelete,
        function onRun(deleteError) {
          if (deleteError) {
            return reject(deleteError);
          }

          resolve({ changes: this.changes || 0 });
        }
      );
    });
  });
}

function deleteAllIndexingRuns() {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM indexing_runs', function onRun(err) {
      if (err) {
        return reject(err);
      }

      resolve({ changes: this.changes || 0 });
    });
  });
}

function getIndexingRuns() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM indexing_runs ORDER BY started_at DESC', (err, rows) => {
      if (err) {
        return reject(err);
      }

      resolve(rows);
    });
  });
}

module.exports = {
  createIndexingRun,
  deleteAllIndexingRuns,
  deleteIndexingRunsByRootFolder,
  finishIndexingRun,
  getIndexingRuns,
  hasRunningIndexingRun,
};
