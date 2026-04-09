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

function finishIndexingRun(runId, status, counters, notes = null) {
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
        notes,
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
  finishIndexingRun,
  getIndexingRuns,
  hasRunningIndexingRun,
};
