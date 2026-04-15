#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.resolve(__dirname, '../data/app.db');
const REPORTS_DIR = path.resolve(__dirname, '../reports');
const EXAMPLE_LIMIT_DEFAULT = 10;

const CATEGORY = {
  MANAGED_DOCUMENT: 'Documento gestionado',
  INDEXED_FILE: 'Archivo indexado',
  EXCLUDED: 'Excluido del dominio documental',
  MANUAL_REVIEW: 'Revision manual',
  CONSOLIDATION: 'Candidato a consolidacion',
  HISTORICAL_TRACE: 'Solo trazabilidad historica',
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
    '  node scripts/classify-documents.js [opciones]',
    '',
    'Opciones:',
    '  --write-json              Guarda el reporte en reports/classification-report-<timestamp>.json',
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

  return {
    normalized,
    isProjectPath: normalized.includes('/marzo buscador/'),
    isNodeModules: normalized.includes('/node_modules/'),
    isElectronUserData: normalized.includes('/electron-user-data/'),
    isDownloads: normalized.includes('/downloads/'),
    isTestDocs: normalized.includes('/test_docs/'),
    isBusinessDocMarzo: normalized.startsWith('d:/doc marzo/'),
    isBusinessSag: normalized.startsWith('d:/sag/'),
    isTechnicalPath:
      normalized.includes('/node_modules/') ||
      normalized.includes('/electron-user-data/'),
  };
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function takeExamples(items, limit) {
  return items.slice(0, limit);
}

function buildClassification(documentRow, context) {
  const signals = [];
  const pathSignals = detectPathSignals(documentRow.absolute_path);
  const normalizedPath = normalizePathKey(documentRow.absolute_path);
  const history = context.historyByDocumentId.get(documentRow.id) || [];
  const actions = new Set(history.map((row) => row.action));
  const richMetadataCount = countRichMetadata(documentRow);
  const hasFunctionalHistory = actions.has('created') || actions.has('updated');
  const hasOnlyTechnicalHistory =
    history.length > 0 &&
    [...actions].every((action) => ['indexed', 'reindexed', 'marked_missing', 'error', 'opened'].includes(action));
  const isOrphan = !context.rootFolderIds.has(documentRow.root_folder_id);
  const pathDuplicates = context.documentsByPath.get(normalizedPath) || [];
  const duplicateCount = pathDuplicates.length;
  const duplicateInternalCount = (context.documentsByRootAndPath.get(`${documentRow.root_folder_id}::${normalizedPath}`) || []).length;
  const hasActiveEquivalent = isOrphan && context.activeExistingPathSet.has(normalizedPath);
  const fileExists = context.fileExistsByDocumentId.get(documentRow.id);
  const hasBadStructure = !hasValue(documentRow.absolute_path) || !hasValue(documentRow.relative_path);
  const isPendingIsolated = documentRow.status === 'pending';
  const isMissing = documentRow.status === 'missing';
  const isChanged = documentRow.status === 'updated';
  const likelyManualDocument =
    richMetadataCount >= 2 ||
    (richMetadataCount >= 1 && hasFunctionalHistory) ||
    (hasFunctionalHistory && !actions.has('indexed'));
  const ambiguousBusinessRecord =
    !pathSignals.isTechnicalPath &&
    !pathSignals.isTestDocs &&
    !likelyManualDocument &&
    !hasActiveEquivalent &&
    duplicateCount === 1 &&
    (
      richMetadataCount === 1 ||
      (isOrphan && !isMissing && !isChanged) ||
      pathSignals.isDownloads
    );

  let category = CATEGORY.MANUAL_REVIEW;
  let subcategory = 'ambiguous';
  let confidence = 'low';

  if (pathSignals.isTechnicalPath) {
    category = CATEGORY.EXCLUDED;
    subcategory = pathSignals.isNodeModules ? 'technical_node_modules' : 'technical_runtime_data';
    confidence = 'high';
    signals.push('ruta_tecnica');
  } else if (pathSignals.isTestDocs) {
    category = CATEGORY.EXCLUDED;
    subcategory = 'test_fixture';
    confidence = 'high';
    signals.push('ruta_de_prueba');
  } else if (duplicateInternalCount > 1) {
    category = CATEGORY.CONSOLIDATION;
    subcategory = 'duplicate_internal_same_root';
    confidence = 'high';
    signals.push('duplicado_interno');
  } else if (hasActiveEquivalent) {
    category = CATEGORY.CONSOLIDATION;
    subcategory = 'orphan_with_active_equivalent';
    confidence = 'high';
    signals.push('huerfano_con_equivalente_activo');
  } else if (duplicateCount > 1 && !likelyManualDocument) {
    category = CATEGORY.CONSOLIDATION;
    subcategory = 'duplicate_global';
    confidence = 'medium';
    signals.push('duplicado_global');
  } else if (likelyManualDocument) {
    category = CATEGORY.MANAGED_DOCUMENT;
    subcategory = isMissing ? 'managed_missing_with_value' : 'managed_rich_or_manual';
    confidence = richMetadataCount >= 2 || hasFunctionalHistory ? 'high' : 'medium';
    signals.push('metadatos_ricos_o_historial_funcional');
  } else if (isOrphan && !hasActiveEquivalent && (isMissing || documentRow.status === 'updated')) {
    category = CATEGORY.HISTORICAL_TRACE;
    subcategory = 'orphan_without_active_equivalent';
    confidence = 'medium';
    signals.push('huerfano_sin_equivalente_activo');
  } else if (ambiguousBusinessRecord) {
    category = CATEGORY.MANUAL_REVIEW;
    subcategory = pathSignals.isDownloads ? 'downloads_path' : 'ambiguous_business_record';
    confidence = 'low';
    signals.push('registro_ambiguo_de_negocio');
  } else if (isPendingIsolated) {
    category = CATEGORY.MANUAL_REVIEW;
    subcategory = 'isolated_pending';
    confidence = 'medium';
    signals.push('pending_aislado');
  } else if (hasBadStructure || history.length === 0) {
    category = CATEGORY.MANUAL_REVIEW;
    subcategory = hasBadStructure ? 'structural_quality_issue' : 'no_history';
    confidence = 'medium';
    signals.push('calidad_estructural_baja');
  } else if (pathSignals.isBusinessDocMarzo || pathSignals.isBusinessSag || hasOnlyTechnicalHistory || richMetadataCount === 0) {
    category = CATEGORY.INDEXED_FILE;
    subcategory = isMissing ? 'indexed_missing' : 'indexed_technical_reference';
    confidence = isOrphan ? 'medium' : 'high';
    signals.push('inventario_tecnico');
  }

  if (isOrphan) {
    signals.push('root_huerfana');
  }
  if (duplicateCount > 1) {
    signals.push('ruta_duplicada');
  }
  if (isMissing) {
    signals.push('estado_missing');
  }
  if (fileExists === false && documentRow.status !== 'missing') {
    signals.push('archivo_no_existe_en_disco');
    if (category === CATEGORY.INDEXED_FILE) {
      confidence = 'medium';
    }
  }
  if (richMetadataCount > 0) {
    signals.push(`metadatos_ricos_${richMetadataCount}`);
  }

  return {
    id: documentRow.id,
    category,
    subcategory,
    confidence,
    reasons: uniqueStrings(signals),
    facts: {
      root_folder_id: documentRow.root_folder_id,
      status: documentRow.status,
      absolute_path: documentRow.absolute_path,
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

function initBucketMap(keys) {
  const map = new Map();
  keys.forEach((key) => {
    map.set(key, []);
  });
  return map;
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
    const rootPathKey = `${row.root_folder_id}::${normalizedPath}`;

    if (!documentsByPath.has(normalizedPath)) {
      documentsByPath.set(normalizedPath, []);
    }
    documentsByPath.get(normalizedPath).push(row);

    if (!documentsByRootAndPath.has(rootPathKey)) {
      documentsByRootAndPath.set(rootPathKey, []);
    }
    documentsByRootAndPath.get(rootPathKey).push(row);

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
  const confidenceBuckets = initBucketMap(['high', 'medium', 'low']);
  const subcategoryCounts = new Map();
  const subgroups = {
    orphan_with_active_equivalent: [],
    orphan_without_active_equivalent: [],
    duplicate_internal: [],
    duplicate_global: [],
    technical_paths: [],
    rich_metadata: [],
    without_history: [],
    isolated_pending: [],
    low_confidence_review: [],
  };

  const classifiedRows = documents.map((row) => {
    const classification = buildClassification(row, context);
    const merged = {
      id: row.id,
      original_name: row.original_name,
      absolute_path: row.absolute_path,
      root_folder_id: row.root_folder_id,
      status: row.status,
      ...classification,
    };

    categoryBuckets.get(merged.category).push(merged);
    confidenceBuckets.get(merged.confidence).push(merged);
    subcategoryCounts.set(merged.subcategory, (subcategoryCounts.get(merged.subcategory) || 0) + 1);

    if (merged.subcategory === 'orphan_with_active_equivalent') {
      subgroups.orphan_with_active_equivalent.push(merged);
    }
    if (merged.subcategory === 'orphan_without_active_equivalent') {
      subgroups.orphan_without_active_equivalent.push(merged);
    }
    if (merged.subcategory === 'duplicate_internal_same_root') {
      subgroups.duplicate_internal.push(merged);
    }
    if (merged.subcategory === 'duplicate_global') {
      subgroups.duplicate_global.push(merged);
    }
    if (merged.reasons.includes('ruta_tecnica') || merged.reasons.includes('ruta_de_prueba')) {
      subgroups.technical_paths.push(merged);
    }
    if ((merged.facts.rich_metadata_count || 0) > 0) {
      subgroups.rich_metadata.push(merged);
    }
    if ((context.historyByDocumentId.get(merged.id) || []).length === 0) {
      subgroups.without_history.push(merged);
    }
    if (merged.subcategory === 'isolated_pending') {
      subgroups.isolated_pending.push(merged);
    }
    if (merged.category === CATEGORY.MANUAL_REVIEW && merged.confidence === 'low') {
      subgroups.low_confidence_review.push(merged);
    }

    return merged;
  });

  const summary = {
    generated_at: generatedAt,
    database_path: DB_PATH,
    mode: 'read-only',
    fs_checks_performed: !options.skipFsChecks,
    total_documents: documents.length,
    totals_by_category: Object.fromEntries(
      [...categoryBuckets.entries()].map(([key, rows]) => [key, rows.length]),
    ),
    totals_by_confidence: Object.fromEntries(
      [...confidenceBuckets.entries()].map(([key, rows]) => [key, rows.length]),
    ),
    totals_by_subcategory: Object.fromEntries(
      [...subcategoryCounts.entries()].sort((left, right) => right[1] - left[1]),
    ),
  };

  const report = {
    meta: summary,
    categories: Object.fromEntries(
      [...categoryBuckets.entries()].map(([category, rows]) => [
        category,
        {
          total: rows.length,
          examples: takeExamples(rows, options.exampleLimit),
        },
      ]),
    ),
    subgroups: {
      orphan_with_active_equivalent: {
        total: subgroups.orphan_with_active_equivalent.length,
        examples: takeExamples(subgroups.orphan_with_active_equivalent, options.exampleLimit),
      },
      orphan_without_active_equivalent: {
        total: subgroups.orphan_without_active_equivalent.length,
        examples: takeExamples(subgroups.orphan_without_active_equivalent, options.exampleLimit),
      },
      duplicate_internal: {
        total: subgroups.duplicate_internal.length,
        examples: takeExamples(subgroups.duplicate_internal, options.exampleLimit),
      },
      duplicate_global: {
        total: subgroups.duplicate_global.length,
        examples: takeExamples(subgroups.duplicate_global, options.exampleLimit),
      },
      technical_paths: {
        total: subgroups.technical_paths.length,
        examples: takeExamples(subgroups.technical_paths, options.exampleLimit),
      },
      rich_metadata: {
        total: subgroups.rich_metadata.length,
        examples: takeExamples(subgroups.rich_metadata, options.exampleLimit),
      },
      without_history: {
        total: subgroups.without_history.length,
        examples: takeExamples(subgroups.without_history, options.exampleLimit),
      },
      isolated_pending: {
        total: subgroups.isolated_pending.length,
        examples: takeExamples(subgroups.isolated_pending, options.exampleLimit),
      },
    },
    automatic_candidates: {
      high_confidence: {
        total: confidenceBuckets.get('high').length,
        by_category: Object.fromEntries(
          Object.values(CATEGORY).map((category) => [
            category,
            confidenceBuckets.get('high').filter((row) => row.category === category).length,
          ]),
        ),
        examples: takeExamples(confidenceBuckets.get('high'), options.exampleLimit),
      },
      medium_confidence: {
        total: confidenceBuckets.get('medium').length,
        examples: takeExamples(confidenceBuckets.get('medium'), options.exampleLimit),
      },
      low_confidence_review: {
        total: subgroups.low_confidence_review.length,
        examples: takeExamples(subgroups.low_confidence_review, options.exampleLimit),
      },
    },
    estimated_transition: {
      survivable_as_managed_document: categoryBuckets.get(CATEGORY.MANAGED_DOCUMENT).length,
      move_to_index: categoryBuckets.get(CATEGORY.INDEXED_FILE).length,
      exclude_from_domain: categoryBuckets.get(CATEGORY.EXCLUDED).length,
      consolidate_first: categoryBuckets.get(CATEGORY.CONSOLIDATION).length,
      keep_only_as_historical_trace: categoryBuckets.get(CATEGORY.HISTORICAL_TRACE).length,
      requires_manual_review: categoryBuckets.get(CATEGORY.MANUAL_REVIEW).length,
    },
    classification_rules: {
      managed_document:
        'Metadatos ricos y/o historial funcional sugieren valor documental real.',
      indexed_file:
        'Registro tecnico de negocio sin evidencia suficiente de gestion formal.',
      excluded:
        'Ruta tecnica, datos de prueba o contenido fuera del dominio documental.',
      manual_review:
        'Caso ambiguo, con estructura dudosa o senales insuficientes para decidir automaticamente.',
      consolidation:
        'Duplicado o residuo huerfano con equivalente activo que no debe sobrevivir como entidad independiente.',
      historical_trace:
        'Residuo historico sin canónico activo claro, util para referencia pero no para entidad operativa.',
    },
  };

  report.rows = classifiedRows;
  return report;
}

function printReport(report) {
  printSection('Resumen');
  printKeyValue('Modo de apertura SQLite', report.meta.mode);
  printKeyValue('Base de datos', report.meta.database_path);
  printKeyValue('Generado en', report.meta.generated_at);
  printKeyValue('Documents clasificados', report.meta.total_documents);
  printKeyValue('Verificacion de disco', report.meta.fs_checks_performed);
  printJson('Totales por categoria', report.meta.totals_by_category);
  printJson('Totales por confianza', report.meta.totals_by_confidence);

  printSection('Estimacion de transicion');
  printJson('Destino estimado', report.estimated_transition);

  printSection('Subgrupos clave');
  printJson('Subgrupos', {
    orphan_with_active_equivalent: report.subgroups.orphan_with_active_equivalent.total,
    orphan_without_active_equivalent: report.subgroups.orphan_without_active_equivalent.total,
    duplicate_internal: report.subgroups.duplicate_internal.total,
    duplicate_global: report.subgroups.duplicate_global.total,
    technical_paths: report.subgroups.technical_paths.total,
    rich_metadata: report.subgroups.rich_metadata.total,
    without_history: report.subgroups.without_history.total,
    isolated_pending: report.subgroups.isolated_pending.total,
  });

  printSection('Categorias');
  Object.entries(report.categories).forEach(([category, data]) => {
    printKeyValue(`${category}`, data.total);
    printJson(`Ejemplos - ${category}`, data.examples);
  });

  printSection('Candidatos automaticos');
  printJson('Alta confianza', report.automatic_candidates.high_confidence);
  printJson('Baja confianza para revision', report.automatic_candidates.low_confidence_review);
}

async function writeJsonReport(report, outputPath) {
  const finalOutputPath = outputPath || path.join(
    REPORTS_DIR,
    `classification-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
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

    console.log('\nClasificacion completada sin escrituras sobre la base SQLite.');
  } catch (error) {
    console.error(`\nError ejecutando la clasificacion: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (db) {
      await closeDatabase(db);
    }
  }
}

main();
