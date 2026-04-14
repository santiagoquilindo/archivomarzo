#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.resolve(__dirname, '../data/app.db');
const REPORTS_DIR = path.resolve(__dirname, '../reports');
const HUNG_RUN_HOURS_DEFAULT = 24;
const EXAMPLE_LIMIT_DEFAULT = 10;

function parseArgs(argv) {
  const options = {
    writeJson: false,
    hungHours: HUNG_RUN_HOURS_DEFAULT,
    exampleLimit: EXAMPLE_LIMIT_DEFAULT,
    outputPath: null,
    skipFsChecks: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--write-json') {
      options.writeJson = true;
      continue;
    }
    if (arg === '--skip-fs-checks') {
      options.skipFsChecks = true;
      continue;
    }
    if (arg === '--hung-hours') {
      const nextValue = argv[index + 1];
      if (!nextValue || Number.isNaN(Number(nextValue)) || Number(nextValue) < 0) {
        throw new Error('El valor de --hung-hours debe ser un numero mayor o igual a 0');
      }
      options.hungHours = Number(nextValue);
      index += 1;
      continue;
    }
    if (arg === '--example-limit') {
      const nextValue = argv[index + 1];
      if (!nextValue || Number.isNaN(Number(nextValue)) || Number(nextValue) < 1) {
        throw new Error('El valor de --example-limit debe ser un numero entero mayor a 0');
      }
      options.exampleLimit = Number(nextValue);
      index += 1;
      continue;
    }
    if (arg === '--output') {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error('Debes indicar una ruta para --output');
      }
      options.outputPath = path.resolve(process.cwd(), nextValue);
      options.writeJson = true;
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    throw new Error(`Argumento no soportado: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log([
    'Uso:',
    '  node scripts/audit-database.js [opciones]',
    '',
    'Opciones:',
    '  --write-json              Guarda el reporte en reports/audit-report-<timestamp>.json',
    '  --output <ruta>           Guarda el reporte JSON en la ruta indicada',
    '  --hung-hours <horas>      Umbral para marcar corridas colgadas (default: 24)',
    '  --example-limit <n>       Cantidad de ejemplos por seccion (default: 10)',
    '  --skip-fs-checks          Omite verificacion de existencia fisica en disco',
    '  --help, -h                Muestra esta ayuda',
  ].join('\n'));
}

function createDatabase(dbPath) {
  return new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (error) => {
    if (error) {
      console.error(`No fue posible abrir la base en modo solo lectura: ${error.message}`);
      process.exit(1);
    }
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function closeDatabase(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function hoursBetween(now, isoDateString) {
  const parsed = new Date(isoDateString);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return Number(((now.getTime() - parsed.getTime()) / (1000 * 60 * 60)).toFixed(2));
}

function normalizePathForKey(inputPath) {
  return String(inputPath || '').replace(/\//g, '\\').toLowerCase();
}

function normalizePathForPrefix(inputPath) {
  return String(inputPath || '').replace(/\\/g, '/').toLowerCase();
}

function detectPathPrefix(inputPath) {
  const normalized = normalizePathForPrefix(inputPath);
  if (normalized.startsWith('d:/sag/')) return 'D:/sag';
  if (normalized.startsWith('d:/doc marzo/')) return 'D:/doc marzo';
  if (normalized.startsWith('c:/users/personal/downloads/')) return 'C:/Users/Personal/Downloads';
  const driveMatch = normalized.match(/^([a-z]:)\//);
  return driveMatch ? driveMatch[1].toUpperCase() : 'other';
}

function buildStatusCounts(rows, keyName) {
  const counts = {};
  rows.forEach((row) => {
    const key = row[keyName] == null || row[keyName] === '' ? '(null/empty)' : row[keyName];
    counts[key] = Number(row.c);
  });
  return counts;
}

function limitExamples(rows, limit) {
  return rows.slice(0, limit);
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function printKeyValue(label, value) {
  console.log(`- ${label}: ${value}`);
}

function printJson(label, value) {
  console.log(`${label}:`);
  console.log(JSON.stringify(value, null, 2));
}

function findTechnicalFlags(absolutePath) {
  const normalized = normalizePathForPrefix(absolutePath);
  return {
    isProjectPath: normalized.includes('/marzo buscador/'),
    isNodeModules: normalized.includes('/node_modules/'),
    isElectronUserData: normalized.includes('/electron-user-data/'),
    isDownloads: normalized.includes('/downloads/'),
  };
}

async function inspectSchema(db, tableName) {
  const tableInfo = await all(db, `PRAGMA table_info(${tableName})`);
  const indexInfo = await all(db, `PRAGMA index_list(${tableName})`);
  const tableSqlRow = await get(
    db,
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName],
  );

  return {
    table: tableName,
    create_sql: tableSqlRow ? tableSqlRow.sql : null,
    columns: tableInfo.map((column) => ({
      cid: column.cid,
      name: column.name,
      type: column.type,
      notnull: column.notnull,
      default_value: column.dflt_value,
      pk: column.pk,
    })),
    indexes: indexInfo.map((index) => ({
      name: index.name,
      unique: index.unique,
      origin: index.origin,
      partial: index.partial,
    })),
  };
}

function compareExpectedSchema(schemaByTable) {
  const expected = {
    documents: {
      columns: {
        status: { defaultValue: "'pending'" },
        absolute_path: { notNull: 1 },
        relative_path: { notNull: 1 },
        root_folder_id: { notNull: 1 },
      },
    },
    indexing_runs: {
      columns: {
        started_at: { notNull: 1 },
        status: { notNull: 1 },
      },
    },
    root_folders: {
      columns: {
        absolute_path: { notNull: 1 },
        is_active: { defaultValue: '1' },
      },
    },
  };

  const diff = {};

  Object.entries(expected).forEach(([tableName, tableExpectation]) => {
    const tableSchema = schemaByTable[tableName];
    const tableDiff = [];

    if (!tableSchema) {
      diff[tableName] = [{ type: 'missing_table', message: 'La tabla no existe' }];
      return;
    }

    Object.entries(tableExpectation.columns).forEach(([columnName, columnExpectation]) => {
      const realColumn = tableSchema.columns.find((column) => column.name === columnName);

      if (!realColumn) {
        tableDiff.push({ type: 'missing_column', column: columnName });
        return;
      }

      if (
        Object.prototype.hasOwnProperty.call(columnExpectation, 'defaultValue') &&
        String(realColumn.default_value) !== String(columnExpectation.defaultValue)
      ) {
        tableDiff.push({
          type: 'default_mismatch',
          column: columnName,
          expected: columnExpectation.defaultValue,
          actual: realColumn.default_value,
        });
      }

      if (
        Object.prototype.hasOwnProperty.call(columnExpectation, 'notNull') &&
        Number(realColumn.notnull) !== Number(columnExpectation.notNull)
      ) {
        tableDiff.push({
          type: 'notnull_mismatch',
          column: columnName,
          expected: columnExpectation.notNull,
          actual: realColumn.notnull,
        });
      }
    });

    diff[tableName] = tableDiff;
  });

  return diff;
}

function summarizeRootFolderRows(rootFolders, documentsByRootId, suspiciousByRootId) {
  return rootFolders.map((rootFolder) => {
    const documentStats = documentsByRootId.get(rootFolder.id) || {
      documents: 0,
      distinct_paths_case_insensitive: 0,
    };
    const suspicious = suspiciousByRootId.get(rootFolder.id) || {
      projectFiles: 0,
      nodeModules: 0,
      electronUserData: 0,
      downloads: 0,
    };

    return {
      id: rootFolder.id,
      name: rootFolder.name,
      absolute_path: rootFolder.absolute_path,
      is_active: Number(rootFolder.is_active) === 1,
      created_at: rootFolder.created_at,
      updated_at: rootFolder.updated_at,
      documents: documentStats.documents,
      distinct_paths_case_insensitive: documentStats.distinct_paths_case_insensitive,
      suspicious_scope: suspicious,
    };
  });
}

async function buildAuditReport(db, options) {
  const now = new Date();
  const report = {
    meta: {
      generated_at: now.toISOString(),
      database_path: DB_PATH,
      mode: 'read-only',
      hung_run_threshold_hours: options.hungHours,
      example_limit: options.exampleLimit,
      fs_checks_performed: !options.skipFsChecks,
    },
  };

  const [
    foreignKeysPragma,
    tableRows,
    rootFolders,
    documents,
    documentHistory,
    indexingRuns,
    documentStatusRows,
    indexingStatusRows,
  ] = await Promise.all([
    get(db, 'PRAGMA foreign_keys'),
    all(db, "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"),
    all(db, 'SELECT id, name, absolute_path, is_active, created_at, updated_at FROM root_folders ORDER BY id'),
    all(db, `SELECT id, original_name, absolute_path, relative_path, root_folder_id, root_folder_name, status, created_at, updated_at, file_hash, file_size, file_modified_at FROM documents`),
    all(db, `SELECT id, document_id, action, field_name, old_value, new_value, performed_by, performed_at FROM document_history`),
    all(db, `SELECT id, started_at, finished_at, status, scanned_files_count, indexed_files_count, updated_files_count, missing_files_count, error_count, notes FROM indexing_runs ORDER BY started_at DESC`),
    all(db, 'SELECT status, COUNT(*) AS c FROM documents GROUP BY status ORDER BY c DESC'),
    all(db, 'SELECT status, COUNT(*) AS c FROM indexing_runs GROUP BY status ORDER BY c DESC'),
  ]);

  report.summary = {
    total_tables: tableRows.length,
    total_root_folders: rootFolders.length,
    total_documents: documents.length,
    total_document_history: documentHistory.length,
    total_indexing_runs: indexingRuns.length,
    sqlite_foreign_keys_pragma: foreignKeysPragma ? Number(foreignKeysPragma.foreign_keys) : null,
  };

  const rootFolderIds = new Set(rootFolders.map((row) => row.id));
  const historyByDocumentId = new Map();
  const historyActionCountsByDocumentId = new Map();
  const documentsByNormalizedPath = new Map();
  const documentsByRootAndPath = new Map();
  const orphanDocuments = [];
  const existingDocuments = [];
  const documentsByRootId = new Map();
  const suspiciousByRootId = new Map();

  documentHistory.forEach((row) => {
    if (!historyByDocumentId.has(row.document_id)) {
      historyByDocumentId.set(row.document_id, []);
    }
    historyByDocumentId.get(row.document_id).push(row);

    if (!historyActionCountsByDocumentId.has(row.document_id)) {
      historyActionCountsByDocumentId.set(row.document_id, new Map());
    }
    const actionCounts = historyActionCountsByDocumentId.get(row.document_id);
    actionCounts.set(row.action, (actionCounts.get(row.action) || 0) + 1);
  });

  documents.forEach((document) => {
    const normalizedPath = normalizePathForKey(document.absolute_path);
    const rootAndPathKey = `${document.root_folder_id}::${normalizedPath}`;
    const isOrphan = !rootFolderIds.has(document.root_folder_id);

    if (!documentsByNormalizedPath.has(normalizedPath)) {
      documentsByNormalizedPath.set(normalizedPath, []);
    }
    documentsByNormalizedPath.get(normalizedPath).push(document);

    if (!documentsByRootAndPath.has(rootAndPathKey)) {
      documentsByRootAndPath.set(rootAndPathKey, []);
    }
    documentsByRootAndPath.get(rootAndPathKey).push(document);

    if (isOrphan) orphanDocuments.push(document);
    else existingDocuments.push(document);

    const rootStats = documentsByRootId.get(document.root_folder_id) || {
      documents: 0,
      pathSet: new Set(),
    };
    rootStats.documents += 1;
    rootStats.pathSet.add(normalizedPath);
    documentsByRootId.set(document.root_folder_id, rootStats);

    const technicalFlags = findTechnicalFlags(document.absolute_path);
    const suspiciousRootStats = suspiciousByRootId.get(document.root_folder_id) || {
      projectFiles: 0,
      nodeModules: 0,
      electronUserData: 0,
      downloads: 0,
    };
    if (technicalFlags.isProjectPath) suspiciousRootStats.projectFiles += 1;
    if (technicalFlags.isNodeModules) suspiciousRootStats.nodeModules += 1;
    if (technicalFlags.isElectronUserData) suspiciousRootStats.electronUserData += 1;
    if (technicalFlags.isDownloads) suspiciousRootStats.downloads += 1;
    suspiciousByRootId.set(document.root_folder_id, suspiciousRootStats);
  });

  const activeExistingPathSet = new Set(existingDocuments.map((row) => normalizePathForKey(row.absolute_path)));
  const orphanByRootId = new Map();
  const orphanByPrefix = new Map();
  let orphanWithActiveEquivalent = 0;
  let orphanWithoutActiveEquivalent = 0;

  orphanDocuments.forEach((document) => {
    const prefix = detectPathPrefix(document.absolute_path);
    const normalizedPath = normalizePathForKey(document.absolute_path);
    const hasActiveEquivalent = activeExistingPathSet.has(normalizedPath);

    if (hasActiveEquivalent) orphanWithActiveEquivalent += 1;
    else orphanWithoutActiveEquivalent += 1;

    if (!orphanByRootId.has(document.root_folder_id)) {
      orphanByRootId.set(document.root_folder_id, {
        root_folder_id: document.root_folder_id,
        count: 0,
        prefixes: new Set(),
        statuses: new Map(),
      });
    }
    const orphanRootEntry = orphanByRootId.get(document.root_folder_id);
    orphanRootEntry.count += 1;
    orphanRootEntry.prefixes.add(prefix);
    orphanRootEntry.statuses.set(document.status || '(null)', (orphanRootEntry.statuses.get(document.status || '(null)') || 0) + 1);

    if (!orphanByPrefix.has(prefix)) {
      orphanByPrefix.set(prefix, { prefix, count: 0, with_active_equivalent: 0, without_active_equivalent: 0 });
    }
    const orphanPrefixEntry = orphanByPrefix.get(prefix);
    orphanPrefixEntry.count += 1;
    if (hasActiveEquivalent) orphanPrefixEntry.with_active_equivalent += 1;
    else orphanPrefixEntry.without_active_equivalent += 1;
  });

  const globalDuplicateGroups = [];
  const perRootDuplicateGroups = [];
  let globalDuplicateExcessRows = 0;
  let perRootDuplicateExcessRows = 0;

  documentsByNormalizedPath.forEach((rows, normalizedPath) => {
    if (rows.length <= 1) return;
    globalDuplicateExcessRows += rows.length - 1;
    globalDuplicateGroups.push({
      normalized_path: normalizedPath,
      count: rows.length,
      ids: rows.map((row) => row.id),
      root_folder_ids: [...new Set(rows.map((row) => row.root_folder_id))],
      sample_paths: [...new Set(rows.map((row) => row.absolute_path))].slice(0, 3),
    });
  });

  documentsByRootAndPath.forEach((rows, compositeKey) => {
    if (rows.length <= 1) return;
    perRootDuplicateExcessRows += rows.length - 1;
    const [rootFolderId, normalizedPath] = compositeKey.split('::');
    perRootDuplicateGroups.push({
      root_folder_id: Number(rootFolderId),
      normalized_path: normalizedPath,
      count: rows.length,
      ids: rows.map((row) => row.id),
      sample_paths: [...new Set(rows.map((row) => row.absolute_path))].slice(0, 3),
    });
  });

  const fileExistenceSummary = {
    checked_documents: 0,
    skipped: options.skipFsChecks,
    missing_status_but_exists_on_disk: [],
    non_missing_status_but_missing_on_disk: [],
  };

  if (!options.skipFsChecks) {
    documents.forEach((document) => {
      const existsOnDisk = fs.existsSync(document.absolute_path);
      fileExistenceSummary.checked_documents += 1;

      if (document.status === 'missing' && existsOnDisk) {
        fileExistenceSummary.missing_status_but_exists_on_disk.push({
          id: document.id,
          root_folder_id: document.root_folder_id,
          status: document.status,
          absolute_path: document.absolute_path,
        });
      }

      if (document.status !== 'missing' && !existsOnDisk) {
        fileExistenceSummary.non_missing_status_but_missing_on_disk.push({
          id: document.id,
          root_folder_id: document.root_folder_id,
          status: document.status,
          absolute_path: document.absolute_path,
        });
      }
    });
  }

  const documentsWithoutHistory = [];
  const documentsWithHistoryButNoIndexed = [];
  const anomalousHistorySequences = [];

  documents.forEach((document) => {
    const history = historyByDocumentId.get(document.id) || [];
    const actionCounts = historyActionCountsByDocumentId.get(document.id) || new Map();
    const hasIndexed = actionCounts.has('indexed');

    if (history.length === 0) {
      documentsWithoutHistory.push({
        id: document.id,
        root_folder_id: document.root_folder_id,
        status: document.status,
        absolute_path: document.absolute_path,
      });
    }

    if (history.length > 0 && !hasIndexed) {
      documentsWithHistoryButNoIndexed.push({
        id: document.id,
        root_folder_id: document.root_folder_id,
        status: document.status,
        absolute_path: document.absolute_path,
        actions: [...actionCounts.keys()],
      });
    }

    const hasMarkedMissing = actionCounts.has('marked_missing');
    const hasError = actionCounts.has('error');
    const hasReindexed = actionCounts.has('reindexed');

    if (document.status === 'available' && hasMarkedMissing) {
      anomalousHistorySequences.push({
        id: document.id,
        issue: 'document_available_but_has_marked_missing_history',
        actions: [...actionCounts.keys()],
        absolute_path: document.absolute_path,
      });
    }
    if (document.status === 'pending' && hasReindexed) {
      anomalousHistorySequences.push({
        id: document.id,
        issue: 'document_pending_but_has_reindexed_history',
        actions: [...actionCounts.keys()],
        absolute_path: document.absolute_path,
      });
    }
    if (document.status !== 'error' && hasError) {
      anomalousHistorySequences.push({
        id: document.id,
        issue: 'document_not_error_but_has_error_history',
        actions: [...actionCounts.keys()],
        absolute_path: document.absolute_path,
      });
    }
  });

  const runningRuns = indexingRuns
    .filter((run) => run.status === 'running')
    .map((run) => {
      const ageHours = hoursBetween(now, run.started_at);
      return {
        ...run,
        age_hours: ageHours,
        appears_hung: ageHours != null && ageHours >= options.hungHours && !run.finished_at,
      };
    });

  const suspiciousRoots = summarizeRootFolderRows(
    rootFolders,
    new Map(
      [...documentsByRootId.entries()].map(([rootFolderId, stats]) => [
        rootFolderId,
        { documents: stats.documents, distinct_paths_case_insensitive: stats.pathSet.size },
      ]),
    ),
    suspiciousByRootId,
  );

  const schemaByTable = {
    documents: await inspectSchema(db, 'documents'),
    indexing_runs: await inspectSchema(db, 'indexing_runs'),
    root_folders: await inspectSchema(db, 'root_folders'),
  };

  report.indexing_runs = {
    counts_by_status: buildStatusCounts(indexingStatusRows, 'status'),
    running_runs: runningRuns,
    hung_runs: runningRuns.filter((run) => run.appears_hung),
  };

  report.documents = {
    counts_by_status: buildStatusCounts(documentStatusRows, 'status'),
    orphan_documents: {
      total: orphanDocuments.length,
      with_active_equivalent_same_path: orphanWithActiveEquivalent,
      without_active_equivalent_same_path: orphanWithoutActiveEquivalent,
      by_root_folder_id: [...orphanByRootId.values()]
        .sort((left, right) => right.count - left.count)
        .map((entry) => ({
          root_folder_id: entry.root_folder_id,
          count: entry.count,
          prefixes: [...entry.prefixes].sort(),
          statuses: Object.fromEntries([...entry.statuses.entries()].sort((left, right) => right[1] - left[1])),
        })),
      by_path_prefix: [...orphanByPrefix.values()].sort((left, right) => right.count - left.count),
      examples: limitExamples(
        orphanDocuments.map((document) => ({
          id: document.id,
          root_folder_id: document.root_folder_id,
          status: document.status,
          absolute_path: document.absolute_path,
        })),
        options.exampleLimit,
      ),
    },
    duplicate_paths: {
      global: {
        groups: globalDuplicateGroups.length,
        excess_rows: globalDuplicateExcessRows,
        examples: limitExamples(globalDuplicateGroups.sort((left, right) => right.count - left.count), options.exampleLimit),
      },
      per_root_folder: {
        groups: perRootDuplicateGroups.length,
        excess_rows: perRootDuplicateExcessRows,
        examples: limitExamples(perRootDuplicateGroups.sort((left, right) => right.count - left.count), options.exampleLimit),
      },
    },
    status_disk_consistency: {
      checked_documents: fileExistenceSummary.checked_documents,
      skipped: fileExistenceSummary.skipped,
      missing_status_but_exists_on_disk_count: fileExistenceSummary.missing_status_but_exists_on_disk.length,
      non_missing_status_but_missing_on_disk_count: fileExistenceSummary.non_missing_status_but_missing_on_disk.length,
      missing_status_but_exists_on_disk_examples: limitExamples(fileExistenceSummary.missing_status_but_exists_on_disk, options.exampleLimit),
      non_missing_status_but_missing_on_disk_examples: limitExamples(fileExistenceSummary.non_missing_status_but_missing_on_disk, options.exampleLimit),
      blank_or_invalid_paths: limitExamples(
        documents
          .filter((document) => !document.absolute_path || !String(document.absolute_path).trim() || !document.relative_path || !String(document.relative_path).trim())
          .map((document) => ({
            id: document.id,
            root_folder_id: document.root_folder_id,
            status: document.status,
            absolute_path: document.absolute_path,
            relative_path: document.relative_path,
          })),
        options.exampleLimit,
      ),
    },
  };

  report.document_history = {
    total_rows: documentHistory.length,
    action_counts: Object.fromEntries(
      [...documentHistory.reduce((accumulator, row) => {
        accumulator.set(row.action, (accumulator.get(row.action) || 0) + 1);
        return accumulator;
      }, new Map()).entries()].sort((left, right) => right[1] - left[1]),
    ),
    documents_without_history_count: documentsWithoutHistory.length,
    documents_without_history_examples: limitExamples(documentsWithoutHistory, options.exampleLimit),
    documents_with_history_but_no_indexed_count: documentsWithHistoryButNoIndexed.length,
    documents_with_history_but_no_indexed_examples: limitExamples(documentsWithHistoryButNoIndexed, options.exampleLimit),
    anomalous_sequences_count: anomalousHistorySequences.length,
    anomalous_sequences_examples: limitExamples(anomalousHistorySequences, options.exampleLimit),
  };

  report.root_folders = {
    total: rootFolders.length,
    active_count: rootFolders.filter((row) => Number(row.is_active) === 1).length,
    inactive_count: rootFolders.filter((row) => Number(row.is_active) !== 1).length,
    rows: suspiciousRoots,
    suspicious_roots: suspiciousRoots.filter((row) => (
      row.suspicious_scope.projectFiles > 0 ||
      row.suspicious_scope.nodeModules > 0 ||
      row.suspicious_scope.electronUserData > 0 ||
      row.suspicious_scope.downloads > 0
    )),
  };

  report.schema = {
    tables: tableRows.map((row) => ({ name: row.name, sql: row.sql })),
    key_tables: schemaByTable,
    expected_vs_real_differences: compareExpectedSchema(schemaByTable),
  };

  return report;
}

function printConsoleReport(report) {
  printSection('Resumen');
  printKeyValue('Modo de apertura SQLite', report.meta.mode);
  printKeyValue('Base de datos', report.meta.database_path);
  printKeyValue('Generado en', report.meta.generated_at);
  printKeyValue('Tablas', report.summary.total_tables);
  printKeyValue('Root folders', report.summary.total_root_folders);
  printKeyValue('Documents', report.summary.total_documents);
  printKeyValue('Document history', report.summary.total_document_history);
  printKeyValue('Indexing runs', report.summary.total_indexing_runs);
  printKeyValue('PRAGMA foreign_keys', report.summary.sqlite_foreign_keys_pragma);

  printSection('Corridas de indexacion');
  printJson('Conteo por estado', report.indexing_runs.counts_by_status);
  printKeyValue('Corridas running', report.indexing_runs.running_runs.length);
  printKeyValue('Corridas colgadas segun umbral', report.indexing_runs.hung_runs.length);
  if (report.indexing_runs.running_runs.length > 0) {
    printJson('Running runs', report.indexing_runs.running_runs);
  }

  printSection('Documentos huerfanos');
  printKeyValue('Total huerfanos', report.documents.orphan_documents.total);
  printKeyValue('Con equivalente activo por misma ruta', report.documents.orphan_documents.with_active_equivalent_same_path);
  printKeyValue('Sin equivalente activo por misma ruta', report.documents.orphan_documents.without_active_equivalent_same_path);
  printJson('Huerfanos por root_folder_id', report.documents.orphan_documents.by_root_folder_id.slice(0, 10));
  printJson('Huerfanos por prefijo de ruta', report.documents.orphan_documents.by_path_prefix.slice(0, 10));

  printSection('Duplicados por ruta');
  printKeyValue('Grupos duplicados globales', report.documents.duplicate_paths.global.groups);
  printKeyValue('Filas excedentes globales', report.documents.duplicate_paths.global.excess_rows);
  printKeyValue('Grupos duplicados por root_folder_id + path', report.documents.duplicate_paths.per_root_folder.groups);
  printKeyValue('Filas excedentes por root_folder_id + path', report.documents.duplicate_paths.per_root_folder.excess_rows);
  printJson('Ejemplos duplicados globales', report.documents.duplicate_paths.global.examples);
  printJson('Ejemplos duplicados por root', report.documents.duplicate_paths.per_root_folder.examples);

  printSection('Estados documentales');
  printJson('Conteo por status', report.documents.counts_by_status);
  printKeyValue('Missing que existen en disco', report.documents.status_disk_consistency.missing_status_but_exists_on_disk_count);
  printKeyValue('No missing que no existen en disco', report.documents.status_disk_consistency.non_missing_status_but_missing_on_disk_count);
  printJson('Ejemplos no missing pero ausentes en disco', report.documents.status_disk_consistency.non_missing_status_but_missing_on_disk_examples);
  printJson('Rutas vacias o invalidas', report.documents.status_disk_consistency.blank_or_invalid_paths);

  printSection('Historial documental');
  printJson('Conteo de acciones', report.document_history.action_counts);
  printKeyValue('Documentos sin historial', report.document_history.documents_without_history_count);
  printKeyValue('Documentos con historial pero sin indexed', report.document_history.documents_with_history_but_no_indexed_count);
  printKeyValue('Secuencias anomalas basicas', report.document_history.anomalous_sequences_count);
  printJson('Ejemplos de secuencias anomalas', report.document_history.anomalous_sequences_examples);

  printSection('Carpetas raiz');
  printKeyValue('Raices activas', report.root_folders.active_count);
  printKeyValue('Raices inactivas', report.root_folders.inactive_count);
  printJson('Root folders', report.root_folders.rows);
  printJson('Root folders sospechosas', report.root_folders.suspicious_roots);

  printSection('Esquema real vs esperado');
  printJson('Diferencias detectadas', report.schema.expected_vs_real_differences);
}

async function writeJsonReport(report, outputPath) {
  const finalOutputPath = outputPath || path.join(
    REPORTS_DIR,
    `audit-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  fs.mkdirSync(path.dirname(finalOutputPath), { recursive: true });
  fs.writeFileSync(finalOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return finalOutputPath;
}

async function main() {
  let db;

  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
      printHelp();
      return;
    }
    if (!fs.existsSync(DB_PATH)) {
      throw new Error(`No se encontro la base de datos en ${DB_PATH}`);
    }

    db = createDatabase(DB_PATH);
    const report = await buildAuditReport(db, options);
    printConsoleReport(report);

    if (options.writeJson) {
      const outputPath = await writeJsonReport(report, options.outputPath);
      console.log(`\nReporte JSON guardado en: ${outputPath}`);
    }

    console.log('\nAuditoria completada sin escrituras sobre la base SQLite.');
  } catch (error) {
    console.error(`\nError ejecutando la auditoria: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (db) {
      await closeDatabase(db);
    }
  }
}

main();
