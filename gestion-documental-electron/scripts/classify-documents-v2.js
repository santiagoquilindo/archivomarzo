#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.resolve(__dirname, '../data/app.db');
const REPORTS_DIR = path.resolve(__dirname, '../reports');
const EXAMPLE_LIMIT_DEFAULT = 10;

const CATEGORY = {
  MANAGED_DOCUMENT: 'Documento gestionado',
  INDEXED_ACTIVE: 'indexado_activo',
  INDEXED_HISTORICAL: 'indexado_historico',
  EXCLUDED_TECHNICAL: 'excluido_tecnico',
  EXCLUDED_TEST: 'excluido_prueba',
  CONSOLIDATE_INTERNAL: 'consolidacion_duplicate_internal',
  CONSOLIDATE_GLOBAL: 'consolidacion_duplicate_global',
  CONSOLIDATE_ORPHAN_EQUIVALENT: 'consolidacion_huerfano_con_equivalente',
  HISTORICAL_TRACE: 'solo_trazabilidad_historica',
  REVIEW_DOWNLOADS: 'revision_downloads',
  REVIEW_POTENTIAL_VALUE: 'revision_valor_documental_potencial',
};

const MACRO_CATEGORY = {
  [CATEGORY.MANAGED_DOCUMENT]: 'Documento gestionado',
  [CATEGORY.INDEXED_ACTIVE]: 'Archivo indexado',
  [CATEGORY.INDEXED_HISTORICAL]: 'Archivo indexado',
  [CATEGORY.EXCLUDED_TECHNICAL]: 'Excluido',
  [CATEGORY.EXCLUDED_TEST]: 'Excluido',
  [CATEGORY.CONSOLIDATE_INTERNAL]: 'Consolidacion',
  [CATEGORY.CONSOLIDATE_GLOBAL]: 'Consolidacion',
  [CATEGORY.CONSOLIDATE_ORPHAN_EQUIVALENT]: 'Consolidacion',
  [CATEGORY.HISTORICAL_TRACE]: 'Trazabilidad historica',
  [CATEGORY.REVIEW_DOWNLOADS]: 'Revision manual',
  [CATEGORY.REVIEW_POTENTIAL_VALUE]: 'Revision manual',
};

function parseArgs(argv) {
  const options = {
    writeJson: false,
    outputPath: null,
    exampleLimit: EXAMPLE_LIMIT_DEFAULT,
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
    '  node scripts/classify-documents-v2.js [opciones]',
    '',
    'Opciones:',
    '  --write-json              Guarda el reporte en reports/classification-v2-report-<timestamp>.json',
    '  --output <ruta>           Guarda el reporte JSON en la ruta indicada',
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

function normalizePathKey(inputPath) {
  return String(inputPath || '').replace(/\//g, '\\').toLowerCase();
}

function normalizePathSlashes(inputPath) {
  return String(inputPath || '').replace(/\\/g, '/').toLowerCase();
}

function hasValue(value) {
  return value != null && String(value).trim() !== '';
}

function countRichMetadata(documentRow) {
  const fields = [
    'document_date',
    'voucher_number',
    'category',
    'document_type',
    'notes',
    'source_area',
  ];

  return fields.reduce((count, field) => count + (hasValue(documentRow[field]) ? 1 : 0), 0);
}

function detectPathSignals(absolutePath) {
  const normalized = normalizePathSlashes(absolutePath);
  const fileName = path.basename(String(absolutePath || '')).toLowerCase();

  const isGitPath = normalized.includes('/.git/');
  const isNodeModules = normalized.includes('/node_modules/');
  const isElectronUserData = normalized.includes('/electron-user-data/');
  const isProjectAppPath =
    normalized.includes('/gestion-documental-electron/') &&
    !normalized.includes('/gestion-documental-electron/test_docs/');
  const isDist = normalized.includes('/dist/');
  const isCachePath =
    normalized.includes('/cache/') ||
    normalized.includes('/cache_data/') ||
    normalized.includes('/code cache/') ||
    normalized.includes('/gpucache/');
  const isTempFile =
    fileName.startsWith('~$') ||
    fileName.startsWith('~wr') ||
    fileName.endsWith('.tmp') ||
    fileName.endsWith('.temp') ||
    fileName.endsWith('.log') ||
    fileName.endsWith('.lock');
  const isBinaryHelper =
    fileName.endsWith('.dll') ||
    fileName.endsWith('.exe') ||
    fileName.endsWith('.node') ||
    fileName.endsWith('.bin');

  return {
    normalized,
    isNodeModules,
    isElectronUserData,
    isGitPath,
    isDist,
    isCachePath,
    isTempFile,
    isBinaryHelper,
    isTechnicalPath:
      isNodeModules ||
      isElectronUserData ||
      isProjectAppPath ||
      isGitPath ||
      isDist ||
      isCachePath ||
      isTempFile ||
      isBinaryHelper,
    isTestDocs: normalized.includes('/test_docs/'),
    isProjectPath: normalized.includes('/marzo buscador/'),
    isDownloads: normalized.includes('/downloads/'),
    isBusinessDocMarzo: normalized.startsWith('d:/doc marzo/'),
    isBusinessSag: normalized.startsWith('d:/sag/'),
  };
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function takeExamples(items, limit) {
  return items.slice(0, limit);
}

function initBucketMap(keys) {
  const map = new Map();
  keys.forEach((key) => map.set(key, []));
  return map;
}

function classifyDocument(documentRow, context) {
  const signals = [];
  const pathSignals = detectPathSignals(documentRow.absolute_path);
  const normalizedPath = normalizePathKey(documentRow.absolute_path);
  const history = context.historyByDocumentId.get(documentRow.id) || [];
  const actions = new Set(history.map((row) => row.action));
  const richMetadataCount = countRichMetadata(documentRow);
  const isOrphan = !context.rootFolderIds.has(documentRow.root_folder_id);
  const duplicatesByPath = context.documentsByPath.get(normalizedPath) || [];
  const duplicateCount = duplicatesByPath.length;
  const duplicateInternalCount = (context.documentsByRootAndPath.get(`${documentRow.root_folder_id}::${normalizedPath}`) || []).length;
  const hasActiveEquivalent = isOrphan && context.activeExistingPathSet.has(normalizedPath);
  const fileExists = context.fileExistsByDocumentId.get(documentRow.id);
  const hasBadStructure = !hasValue(documentRow.absolute_path) || !hasValue(documentRow.relative_path);
  const hasCreated = actions.has('created');
  const hasUpdated = actions.has('updated');
  const hasManualLikeHistory = hasCreated || hasUpdated;
  const hasIndexed = actions.has('indexed');
  const hasReindexed = actions.has('reindexed');
  const isMissing = documentRow.status === 'missing';
  const isUpdatedStatus = documentRow.status === 'updated';
  const isPending = documentRow.status === 'pending';
  const hasTechnicalHistoryOnly =
    history.length > 0 &&
    [...actions].every((action) => ['indexed', 'reindexed', 'marked_missing', 'error', 'opened'].includes(action));
  const apparentManualOrigin =
    hasCreated && !hasIndexed ||
    (hasCreated && richMetadataCount >= 1) ||
    (hasUpdated && richMetadataCount >= 1);
  const likelyManagedDocument =
    richMetadataCount >= 2 ||
    apparentManualOrigin ||
    (hasManualLikeHistory && richMetadataCount >= 1) ||
    (isMissing && hasManualLikeHistory);
  const likelyHistoricalIndex =
    isOrphan &&
    !hasActiveEquivalent &&
    (isMissing || isUpdatedStatus || hasReindexed);
  const rescueToHistoricalIndex =
    isOrphan &&
    pathSignals.isBusinessDocMarzo &&
    !pathSignals.isTechnicalPath &&
    !pathSignals.isTestDocs &&
    !pathSignals.isDownloads &&
    documentRow.status === 'available' &&
    richMetadataCount === 0 &&
    !hasCreated &&
    !hasUpdated &&
    !hasReindexed &&
    !actions.has('marked_missing') &&
    !actions.has('opened') &&
    hasIndexed &&
    actions.size === 1 &&
    !hasActiveEquivalent &&
    duplicateCount === 1 &&
    duplicateInternalCount === 1 &&
    !hasBadStructure;
  const likelyIndexBusinessRecord =
    !likelyManagedDocument &&
    !pathSignals.isTechnicalPath &&
    !pathSignals.isTestDocs &&
    !isPending &&
    !hasBadStructure &&
    (
      pathSignals.isBusinessDocMarzo ||
      pathSignals.isBusinessSag ||
      hasTechnicalHistoryOnly ||
      richMetadataCount === 0
    );
  const ambiguousPotentialValue =
    !likelyManagedDocument &&
    !pathSignals.isTechnicalPath &&
    !pathSignals.isTestDocs &&
    !hasActiveEquivalent &&
    duplicateCount === 1 &&
    (
      richMetadataCount === 1 ||
      hasCreated ||
      hasUpdated ||
      isPending ||
      (isOrphan && !likelyHistoricalIndex && !pathSignals.isDownloads)
    );

  let category = CATEGORY.REVIEW_POTENTIAL_VALUE;
  let confidence = 'low';

  if (pathSignals.isTechnicalPath) {
    category = CATEGORY.EXCLUDED_TECHNICAL;
    confidence = 'high';
    signals.push('ruta_tecnica');
  } else if (pathSignals.isTestDocs) {
    category = CATEGORY.EXCLUDED_TEST;
    confidence = 'high';
    signals.push('ruta_prueba');
  } else if (duplicateInternalCount > 1) {
    category = CATEGORY.CONSOLIDATE_INTERNAL;
    confidence = 'high';
    signals.push('duplicado_interno');
  } else if (hasActiveEquivalent) {
    category = CATEGORY.CONSOLIDATE_ORPHAN_EQUIVALENT;
    confidence = 'high';
    signals.push('huerfano_con_equivalente_activo');
  } else if (duplicateCount > 1 && !likelyManagedDocument) {
    category = CATEGORY.CONSOLIDATE_GLOBAL;
    confidence = 'medium';
    signals.push('duplicado_global');
  } else if (likelyManagedDocument) {
    category = CATEGORY.MANAGED_DOCUMENT;
    confidence = richMetadataCount >= 2 || apparentManualOrigin ? 'high' : 'medium';
    signals.push('valor_documental_aparente');
  } else if (pathSignals.isDownloads) {
    category = CATEGORY.REVIEW_DOWNLOADS;
    confidence = 'low';
    signals.push('ruta_downloads');
  } else if (rescueToHistoricalIndex) {
    category = CATEGORY.INDEXED_HISTORICAL;
    confidence = 'high';
    signals.push('rescate_a_indice_historico');
  } else if (likelyHistoricalIndex) {
    category = hasManualLikeHistory ? CATEGORY.HISTORICAL_TRACE : CATEGORY.INDEXED_HISTORICAL;
    confidence = 'medium';
    signals.push('historico_u_huerfano');
  } else if (ambiguousPotentialValue) {
    category = CATEGORY.REVIEW_POTENTIAL_VALUE;
    confidence = 'low';
    signals.push('posible_valor_documental');
  } else if (likelyIndexBusinessRecord) {
    category = CATEGORY.INDEXED_ACTIVE;
    confidence = isOrphan ? 'medium' : 'high';
    signals.push('indice_tecnico_de_negocio');
  }

  if (isOrphan) signals.push('root_huerfana');
  if (isMissing) signals.push('estado_missing');
  if (isUpdatedStatus) signals.push('estado_updated');
  if (isPending) signals.push('estado_pending');
  if (hasBadStructure) signals.push('estructura_incompleta');
  if (richMetadataCount > 0) signals.push(`metadatos_ricos_${richMetadataCount}`);
  if (fileExists === false && documentRow.status !== 'missing') signals.push('archivo_no_existe_en_disco');

  return {
    id: documentRow.id,
    original_name: documentRow.original_name,
    absolute_path: documentRow.absolute_path,
    root_folder_id: documentRow.root_folder_id,
    status: documentRow.status,
    category,
    macro_category: MACRO_CATEGORY[category],
    confidence,
    reasons: uniqueStrings(signals),
    facts: {
      rich_metadata_count: richMetadataCount,
      history_actions: [...actions],
      is_orphan: isOrphan,
      has_active_equivalent: hasActiveEquivalent,
      duplicate_count: duplicateCount,
      duplicate_internal_count: duplicateInternalCount,
      file_exists: fileExists,
    },
  };
}

function loadPreviousV2Baseline() {
  if (!fs.existsSync(REPORTS_DIR)) {
    return null;
  }

  const candidates = fs
    .readdirSync(REPORTS_DIR)
    .filter((name) => /^classification-v2-report-.*\.json$/i.test(name))
    .map((name) => ({
      name,
      fullPath: path.join(REPORTS_DIR, name),
      stat: fs.statSync(path.join(REPORTS_DIR, name)),
    }))
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);

  if (candidates.length === 0) {
    return null;
  }

  try {
    const previous = JSON.parse(fs.readFileSync(candidates[0].fullPath, 'utf8'));
    return {
      path: candidates[0].fullPath,
      totals_by_category: previous?.meta?.totals_by_category || null,
      totals_by_macro_category: previous?.meta?.totals_by_macro_category || null,
    };
  } catch (_error) {
    return null;
  }
}

function buildImpact(currentTotals, previousTotals) {
  if (!previousTotals) {
    return null;
  }

  const keys = uniqueStrings([
    ...Object.keys(currentTotals || {}),
    ...Object.keys(previousTotals || {}),
  ]);

  return Object.fromEntries(
    keys.map((key) => [
      key,
      {
        previous: Number(previousTotals[key] || 0),
        current: Number(currentTotals[key] || 0),
        delta: Number(currentTotals[key] || 0) - Number(previousTotals[key] || 0),
      },
    ]),
  );
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

async function buildReport(db, options) {
  const generatedAt = new Date().toISOString();
  const previousBaseline = loadPreviousV2Baseline();
  const [documents, historyRows, rootFolders] = await Promise.all([
    all(
      db,
      `SELECT
        id,
        original_name,
        absolute_path,
        relative_path,
        root_folder_id,
        root_folder_name,
        status,
        created_at,
        updated_at,
        document_date,
        voucher_number,
        category,
        document_type,
        notes,
        source_area,
        file_hash,
        file_size,
        file_modified_at
      FROM documents`,
    ),
    all(
      db,
      `SELECT
        id,
        document_id,
        action,
        field_name,
        old_value,
        new_value,
        performed_by,
        performed_at
      FROM document_history`,
    ),
    all(db, 'SELECT id, name, absolute_path, is_active FROM root_folders'),
  ]);

  const rootFolderIds = new Set(rootFolders.map((row) => row.id));
  const historyByDocumentId = new Map();
  const documentsByPath = new Map();
  const documentsByRootAndPath = new Map();
  const activeExistingPathSet = new Set();
  const fileExistsByDocumentId = new Map();

  historyRows.forEach((row) => {
    if (!historyByDocumentId.has(row.document_id)) {
      historyByDocumentId.set(row.document_id, []);
    }
    historyByDocumentId.get(row.document_id).push(row);
  });

  documents.forEach((row) => {
    const normalizedPath = normalizePathKey(row.absolute_path);
    const rootKey = `${row.root_folder_id}::${normalizedPath}`;

    if (!documentsByPath.has(normalizedPath)) {
      documentsByPath.set(normalizedPath, []);
    }
    documentsByPath.get(normalizedPath).push(row);

    if (!documentsByRootAndPath.has(rootKey)) {
      documentsByRootAndPath.set(rootKey, []);
    }
    documentsByRootAndPath.get(rootKey).push(row);

    if (rootFolderIds.has(row.root_folder_id)) {
      activeExistingPathSet.add(normalizedPath);
    }
  });

  if (!options.skipFsChecks) {
    documents.forEach((row) => {
      fileExistsByDocumentId.set(row.id, fs.existsSync(row.absolute_path));
    });
  }

  const context = {
    historyByDocumentId,
    rootFolderIds,
    documentsByPath,
    documentsByRootAndPath,
    activeExistingPathSet,
    fileExistsByDocumentId,
  };

  const categoryBuckets = initBucketMap(Object.values(CATEGORY));
  const macroBuckets = initBucketMap(uniqueStrings(Object.values(MACRO_CATEGORY)));
  const confidenceBuckets = initBucketMap(['high', 'medium', 'low']);
  const subgroups = {
    orphan_rows: [],
    duplicate_rows: [],
    technical_routes: [],
    rich_metadata: [],
    no_history: [],
    isolated_pending: [],
  };

  const rows = documents.map((documentRow) => {
    const classified = classifyDocument(documentRow, context);
    categoryBuckets.get(classified.category).push(classified);
    macroBuckets.get(classified.macro_category).push(classified);
    confidenceBuckets.get(classified.confidence).push(classified);

    if (classified.facts.is_orphan) subgroups.orphan_rows.push(classified);
    if (classified.facts.duplicate_count > 1) subgroups.duplicate_rows.push(classified);
    if (classified.reasons.includes('ruta_tecnica') || classified.reasons.includes('ruta_prueba')) subgroups.technical_routes.push(classified);
    if (classified.facts.rich_metadata_count > 0) subgroups.rich_metadata.push(classified);
    if ((historyByDocumentId.get(classified.id) || []).length === 0) subgroups.no_history.push(classified);
    if (classified.status === 'pending') subgroups.isolated_pending.push(classified);

    return classified;
  });

  const meta = {
      generated_at: generatedAt,
      database_path: DB_PATH,
      mode: 'read-only',
      fs_checks_performed: !options.skipFsChecks,
      total_documents: documents.length,
      totals_by_category: Object.fromEntries([...categoryBuckets.entries()].map(([key, value]) => [key, value.length])),
      totals_by_macro_category: Object.fromEntries([...macroBuckets.entries()].map(([key, value]) => [key, value.length])),
      totals_by_confidence: Object.fromEntries([...confidenceBuckets.entries()].map(([key, value]) => [key, value.length])),
  };

  return {
    meta,
    categories: Object.fromEntries(
      [...categoryBuckets.entries()].map(([category, bucket]) => [
        category,
        {
          total: bucket.length,
          examples: takeExamples(bucket, options.exampleLimit),
        },
      ]),
    ),
    subgroups: {
      orphan_rows: {
        total: subgroups.orphan_rows.length,
        examples: takeExamples(subgroups.orphan_rows, options.exampleLimit),
      },
      duplicate_rows: {
        total: subgroups.duplicate_rows.length,
        examples: takeExamples(subgroups.duplicate_rows, options.exampleLimit),
      },
      technical_routes: {
        total: subgroups.technical_routes.length,
        examples: takeExamples(subgroups.technical_routes, options.exampleLimit),
      },
      rich_metadata: {
        total: subgroups.rich_metadata.length,
        examples: takeExamples(subgroups.rich_metadata, options.exampleLimit),
      },
      no_history: {
        total: subgroups.no_history.length,
        examples: takeExamples(subgroups.no_history, options.exampleLimit),
      },
      isolated_pending: {
        total: subgroups.isolated_pending.length,
        examples: takeExamples(subgroups.isolated_pending, options.exampleLimit),
      },
    },
    v2_policy_summary: {
      managed_document:
        'Pesa mas created/updated, metadatos de negocio aunque no sean muchos y missing con valor documental aparente.',
      indexed:
        'Se abre a registros de negocio claramente tecnicos, separando activos de historicos y rescatando huerfanos estables de D:\\doc marzo a indice historico.',
      excluded:
        'Se endurece con .git, dist, caches, binarios auxiliares, node_modules, electron-user-data y pruebas.',
      consolidation:
        'Se separa en duplicado interno, duplicado global y huerfano con equivalente activo.',
      review:
        'Se reserva a descargas dudosas y registros con posible valor documental pero evidencia inconclusa.',
    },
    impact_vs_previous_v2: {
      baseline_report: previousBaseline ? previousBaseline.path : null,
      by_category: buildImpact(meta.totals_by_category, previousBaseline?.totals_by_category || null),
      by_macro_category: buildImpact(meta.totals_by_macro_category, previousBaseline?.totals_by_macro_category || null),
    },
    rows,
  };
}

function printReport(report) {
  printSection('Resumen');
  printKeyValue('Modo de apertura SQLite', report.meta.mode);
  printKeyValue('Base de datos', report.meta.database_path);
  printKeyValue('Generado en', report.meta.generated_at);
  printKeyValue('Documents clasificados', report.meta.total_documents);
  printKeyValue('Verificacion de disco', report.meta.fs_checks_performed);
  printJson('Totales por categoria', report.meta.totals_by_category);
  printJson('Totales por macro categoria', report.meta.totals_by_macro_category);
  printJson('Totales por confianza', report.meta.totals_by_confidence);

  if (report.impact_vs_previous_v2 && report.impact_vs_previous_v2.by_category) {
    printSection('Impacto vs v2 anterior');
    printKeyValue('Baseline', report.impact_vs_previous_v2.baseline_report);
    printJson('Impacto por categoria', report.impact_vs_previous_v2.by_category);
    printJson('Impacto por macro categoria', report.impact_vs_previous_v2.by_macro_category);
  }

  printSection('Subgrupos clave');
  printJson('Subgrupos', {
    orphan_rows: report.subgroups.orphan_rows.total,
    duplicate_rows: report.subgroups.duplicate_rows.total,
    technical_routes: report.subgroups.technical_routes.total,
    rich_metadata: report.subgroups.rich_metadata.total,
    no_history: report.subgroups.no_history.total,
    isolated_pending: report.subgroups.isolated_pending.total,
  });

  printSection('Categorias');
  Object.entries(report.categories).forEach(([category, bucket]) => {
    printKeyValue(category, bucket.total);
    printJson(`Ejemplos - ${category}`, bucket.examples);
  });
}

async function writeJsonReport(report, outputPath) {
  const finalOutputPath = outputPath || path.join(
    REPORTS_DIR,
    `classification-v2-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
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
    const report = await buildReport(db, options);
    printReport(report);

    if (options.writeJson) {
      const outputPath = await writeJsonReport(report, options.outputPath);
      console.log(`\nReporte JSON guardado en: ${outputPath}`);
    }

    console.log('\nClasificacion v2 completada sin escrituras sobre la base SQLite.');
  } catch (error) {
    console.error(`\nError ejecutando la clasificacion v2: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (db) {
      await closeDatabase(db);
    }
  }
}

main();
