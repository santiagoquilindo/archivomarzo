#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.resolve(__dirname, '../data/app.db');
const REPORTS_DIR = path.resolve(__dirname, '../reports');
const EXAMPLE_LIMIT_DEFAULT = 10;
const HUNG_RUN_HOURS_DEFAULT = 24;

function parseArgs(argv) {
  const options = {
    writeJson: false,
    outputPath: null,
    exampleLimit: EXAMPLE_LIMIT_DEFAULT,
    skipFsChecks: false,
    hungHours: HUNG_RUN_HOURS_DEFAULT,
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
    if (arg === '--hung-hours') {
      const nextValue = argv[index + 1];
      if (!nextValue || Number.isNaN(Number(nextValue)) || Number(nextValue) < 0) {
        throw new Error('El valor de --hung-hours debe ser un numero mayor o igual a 0');
      }
      options.hungHours = Number(nextValue);
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
    '  node scripts/simulate-sanitization-dry-run.js [opciones]',
    '',
    'Opciones:',
    '  --write-json              Guarda el reporte en reports/sanitization-dry-run-<timestamp>.json',
    '  --output <ruta>           Guarda el reporte JSON en la ruta indicada',
    '  --example-limit <n>       Cantidad de ejemplos por seccion (default: 10)',
    '  --skip-fs-checks          Omite verificacion de existencia fisica en disco',
    '  --hung-hours <horas>      Umbral para corridas colgadas (default: 24)',
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

function hasValue(value) {
  return value != null && String(value).trim() !== '';
}

function takeExamples(items, limit) {
  return items.slice(0, limit);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function loadLatestClassificationReport() {
  if (!fs.existsSync(REPORTS_DIR)) {
    throw new Error('No existe la carpeta reports con el baseline de clasificacion v2');
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
    throw new Error('No se encontro un reporte de clasificacion v2 en reports/');
  }

  const latest = candidates[0];
  return {
    path: latest.fullPath,
    data: JSON.parse(fs.readFileSync(latest.fullPath, 'utf8')),
  };
}

function compareIsoAsc(left, right) {
  const leftTime = left ? new Date(left).getTime() : Number.POSITIVE_INFINITY;
  const rightTime = right ? new Date(right).getTime() : Number.POSITIVE_INFINITY;
  return leftTime - rightTime;
}

function chooseCanonicalRecord(records) {
  const sorted = [...records].sort((left, right) => {
    const leftManaged = left.category === 'Documento gestionado' ? 1 : 0;
    const rightManaged = right.category === 'Documento gestionado' ? 1 : 0;
    if (leftManaged !== rightManaged) {
      return rightManaged - leftManaged;
    }

    const leftNonOrphan = left.facts.is_orphan ? 0 : 1;
    const rightNonOrphan = right.facts.is_orphan ? 0 : 1;
    if (leftNonOrphan !== rightNonOrphan) {
      return rightNonOrphan - leftNonOrphan;
    }

    const leftNonExcluded = left.macro_category === 'Excluido' ? 0 : 1;
    const rightNonExcluded = right.macro_category === 'Excluido' ? 0 : 1;
    if (leftNonExcluded !== rightNonExcluded) {
      return rightNonExcluded - leftNonExcluded;
    }

    const leftOpened = (left.facts.history_actions || []).includes('opened') ? 1 : 0;
    const rightOpened = (right.facts.history_actions || []).includes('opened') ? 1 : 0;
    if (leftOpened !== rightOpened) {
      return rightOpened - leftOpened;
    }

    const leftRich = Number(left.facts.rich_metadata_count || 0);
    const rightRich = Number(right.facts.rich_metadata_count || 0);
    if (leftRich !== rightRich) {
      return rightRich - leftRich;
    }

    const createdAtCompare = compareIsoAsc(left.created_at, right.created_at);
    if (createdAtCompare !== 0) {
      return createdAtCompare;
    }

    return Number(left.id) - Number(right.id);
  });

  return sorted[0];
}

function buildConsolidationGroups(rows, groupByFn, type) {
  const buckets = new Map();

  rows.forEach((row) => {
    const key = groupByFn(row);
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(row);
  });

  const groups = [];
  buckets.forEach((records, key) => {
    if (records.length <= 1) {
      return;
    }

    const canonical = chooseCanonicalRecord(records);
    const surplus = records.filter((row) => row.id !== canonical.id);
    groups.push({
      group_key: key,
      group_type: type,
      canonical: {
        id: canonical.id,
        category: canonical.category,
        absolute_path: canonical.absolute_path,
        root_folder_id: canonical.root_folder_id,
        reasons: canonical.reasons,
      },
      surplus: surplus.map((row) => ({
        id: row.id,
        category: row.category,
        absolute_path: row.absolute_path,
        root_folder_id: row.root_folder_id,
      })),
      surplus_count: surplus.length,
      warnings: uniqueStrings(
        records.flatMap((row) => {
          const warnings = [];
          if ((row.facts.history_actions || []).includes('opened')) {
            warnings.push('opened_history_present');
          }
          if (Number(row.facts.rich_metadata_count || 0) > 0) {
            warnings.push('rich_metadata_present');
          }
          return warnings;
        }),
      ),
    });
  });

  return groups.sort((left, right) => right.surplus_count - left.surplus_count);
}

function buildConsolidationGroupsForCandidateKeys(allRows, candidateRows, groupByFn, type) {
  const keys = new Set();

  candidateRows.forEach((row) => {
    const key = groupByFn(row);
    if (hasValue(key)) {
      keys.add(key);
    }
  });

  if (!keys.size) {
    return [];
  }

  const relatedRows = allRows.filter((row) => keys.has(groupByFn(row)));
  return buildConsolidationGroups(relatedRows, groupByFn, type);
}

function hoursBetween(now, isoDateString) {
  const parsed = new Date(isoDateString);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return Number(((now.getTime() - parsed.getTime()) / (1000 * 60 * 60)).toFixed(2));
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

async function buildDryRunReport(db, options) {
  const now = new Date();
  const classificationReport = loadLatestClassificationReport();
  const classificationRows = classificationReport.data.rows || [];
  const rowsById = new Map(classificationRows.map((row) => [row.id, row]));

  const [indexingRuns, documents] = await Promise.all([
    all(
      db,
      `SELECT
        id,
        started_at,
        finished_at,
        status,
        scanned_files_count,
        indexed_files_count,
        updated_files_count,
        missing_files_count,
        error_count,
        notes
      FROM indexing_runs
      ORDER BY started_at DESC`,
    ),
    all(
      db,
      `SELECT
        id,
        original_name,
        absolute_path,
        relative_path,
        root_folder_id,
        status,
        created_at,
        updated_at
      FROM documents`,
    ),
  ]);

  const documentRows = documents
    .map((row) => {
      const classification = rowsById.get(row.id);
      if (!classification) {
        return null;
      }
      return {
        ...row,
        category: classification.category,
        macro_category: classification.macro_category,
        confidence: classification.confidence,
        reasons: classification.reasons,
        facts: classification.facts,
      };
    })
    .filter(Boolean);

  const byCategory = new Map();
  documentRows.forEach((row) => {
    if (!byCategory.has(row.category)) {
      byCategory.set(row.category, []);
    }
    byCategory.get(row.category).push(row);
  });

  const runningHungRuns = indexingRuns
    .filter((run) => run.status === 'running' && !run.finished_at)
    .map((run) => ({
      ...run,
      age_hours: hoursBetween(now, run.started_at),
    }))
    .filter((run) => run.age_hours != null && run.age_hours >= options.hungHours)
    .map((run) => ({
      run_id: run.id,
      current_status: run.status,
      started_at: run.started_at,
      age_hours: run.age_hours,
      proposed_status: 'failed',
      proposed_note: 'Corrida colgada detectada por saneamiento dry-run',
    }));

  const internalDuplicateGroups = buildConsolidationGroups(
    byCategory.get('consolidacion_duplicate_internal') || [],
    (row) => `${row.root_folder_id}::${normalizePathKey(row.absolute_path)}`,
    'duplicate_internal',
  );

  const globalDuplicateGroups = buildConsolidationGroupsForCandidateKeys(
    documentRows,
    byCategory.get('consolidacion_duplicate_global') || [],
    (row) => normalizePathKey(row.absolute_path),
    'duplicate_global',
  );

  const orphanEquivalentGroups = buildConsolidationGroupsForCandidateKeys(
    documentRows,
    byCategory.get('consolidacion_huerfano_con_equivalente') || [],
    (row) => normalizePathKey(row.absolute_path),
    'orphan_with_active_equivalent',
  );

  const excludedCandidates = [
    ...(byCategory.get('excluido_tecnico') || []),
    ...(byCategory.get('excluido_prueba') || []),
  ];

  const indexHistorical = byCategory.get('indexado_historico') || [];
  const managedDocuments = byCategory.get('Documento gestionado') || [];
  const manualReview = [
    ...(byCategory.get('revision_downloads') || []),
    ...(byCategory.get('revision_valor_documental_potencial') || []),
  ];

  const warnings = [];
  if (manualReview.length > 0) {
    warnings.push('Hay casos que requieren decision humana antes del saneamiento real.');
  }
  if (globalDuplicateGroups.some((group) => group.warnings.length > 0)) {
    warnings.push('Algunos duplicados globales contienen opened o metadatos y conviene validarlos antes de consolidar.');
  }
  if (managedDocuments.length <= 5) {
    warnings.push('El universo de documento gestionado es muy pequeno; conviene revisarlo antes de una migracion definitiva.');
  }

  return {
    meta: {
      generated_at: now.toISOString(),
      database_path: DB_PATH,
      mode: 'read-only',
      classification_report_path: classificationReport.path,
      fs_checks_performed: !options.skipFsChecks,
      hung_run_threshold_hours: options.hungHours,
      total_documents_considered: documentRows.length,
    },
    rules: {
      hung_runs:
        'Toda corrida running sin finished_at y con antiguedad mayor o igual al umbral se marcaria como failed en el saneamiento real.',
      canonical_selection:
        'El canónico se elige por prioridad: Documento gestionado > fila con opened > mayor riqueza documental > created_at mas antiguo > menor id.',
      internal_duplicates:
        'Se agrupan por root_folder_id + absolute_path normalizado.',
      global_duplicates:
        'Se agrupan por absolute_path normalizado.',
      orphan_with_equivalent:
        'Se agrupan por absolute_path normalizado para proponer consolidacion contra el equivalente activo.',
      excluded:
        'Se proponen para salir del dominio documental futuro, no para borrado inmediato.',
      historical_index:
        'Se propone preservar como futura capa de indice y no como documento gestionado.',
      managed_documents:
        'Se propone preservar como entidad documental formal.',
      manual_review:
        'No se automatiza ninguna accion sobre estos casos.',
    },
    impact_summary: {
      hung_runs_to_close: runningHungRuns.length,
      internal_duplicate_groups: internalDuplicateGroups.length,
      internal_duplicate_surplus_rows: internalDuplicateGroups.reduce((sum, group) => sum + group.surplus_count, 0),
      global_duplicate_groups: globalDuplicateGroups.length,
      global_duplicate_surplus_rows: globalDuplicateGroups.reduce((sum, group) => sum + group.surplus_count, 0),
      orphan_equivalent_groups: orphanEquivalentGroups.length,
      orphan_equivalent_surplus_rows: orphanEquivalentGroups.reduce((sum, group) => sum + group.surplus_count, 0),
      excluded_candidates: excludedCandidates.length,
      preserved_as_historical_index: indexHistorical.length,
      preserved_as_managed_document: managedDocuments.length,
      manual_review_cases: manualReview.length,
    },
    hung_runs: {
      total: runningHungRuns.length,
      examples: takeExamples(runningHungRuns, options.exampleLimit),
      rows: runningHungRuns,
    },
    consolidation: {
      duplicate_internal: {
        total_groups: internalDuplicateGroups.length,
        total_surplus_rows: internalDuplicateGroups.reduce((sum, group) => sum + group.surplus_count, 0),
        examples: takeExamples(internalDuplicateGroups, options.exampleLimit),
      },
      duplicate_global: {
        total_groups: globalDuplicateGroups.length,
        total_surplus_rows: globalDuplicateGroups.reduce((sum, group) => sum + group.surplus_count, 0),
        examples: takeExamples(globalDuplicateGroups, options.exampleLimit),
      },
      orphan_with_equivalent: {
        total_groups: orphanEquivalentGroups.length,
        total_surplus_rows: orphanEquivalentGroups.reduce((sum, group) => sum + group.surplus_count, 0),
        examples: takeExamples(orphanEquivalentGroups, options.exampleLimit),
      },
    },
    preservation: {
      historical_index: {
        total: indexHistorical.length,
        examples: takeExamples(indexHistorical, options.exampleLimit).map((row) => ({
          id: row.id,
          absolute_path: row.absolute_path,
          root_folder_id: row.root_folder_id,
          reasons: row.reasons,
        })),
      },
      managed_documents: {
        total: managedDocuments.length,
        examples: takeExamples(managedDocuments, options.exampleLimit).map((row) => ({
          id: row.id,
          absolute_path: row.absolute_path,
          status: row.status,
          reasons: row.reasons,
        })),
      },
    },
    exclusion: {
      total: excludedCandidates.length,
      by_category: {
        excluido_tecnico: (byCategory.get('excluido_tecnico') || []).length,
        excluido_prueba: (byCategory.get('excluido_prueba') || []).length,
      },
      examples: takeExamples(excludedCandidates, options.exampleLimit).map((row) => ({
        id: row.id,
        category: row.category,
        absolute_path: row.absolute_path,
        root_folder_id: row.root_folder_id,
      })),
    },
    manual_review: {
      total: manualReview.length,
      examples: takeExamples(manualReview, options.exampleLimit).map((row) => ({
        id: row.id,
        category: row.category,
        absolute_path: row.absolute_path,
        root_folder_id: row.root_folder_id,
        reasons: row.reasons,
      })),
      rows: manualReview.map((row) => ({
        id: row.id,
        category: row.category,
        absolute_path: row.absolute_path,
        root_folder_id: row.root_folder_id,
        reasons: row.reasons,
        history_actions: row.facts.history_actions,
      })),
    },
    warnings,
  };
}

function printReport(report) {
  printSection('Resumen');
  printKeyValue('Modo', report.meta.mode);
  printKeyValue('Base de datos', report.meta.database_path);
  printKeyValue('Reporte de clasificacion', report.meta.classification_report_path);
  printKeyValue('Generado en', report.meta.generated_at);
  printJson('Impacto simulado', report.impact_summary);

  printSection('Corridas colgadas');
  printJson('Ejemplos', report.hung_runs.examples);

  printSection('Consolidacion');
  printJson('Duplicados internos', report.consolidation.duplicate_internal);
  printJson('Duplicados globales', report.consolidation.duplicate_global);
  printJson('Huerfanos con equivalente', report.consolidation.orphan_with_equivalent);

  printSection('Preservacion');
  printJson('Indice historico', report.preservation.historical_index);
  printJson('Documento gestionado', report.preservation.managed_documents);

  printSection('Exclusion');
  printJson('Candidatos a exclusion', report.exclusion);

  printSection('Revision manual');
  printJson('Casos que no deben tocarse automaticamente', report.manual_review.examples);

  if (report.warnings.length > 0) {
    printSection('Advertencias');
    report.warnings.forEach((warning) => printKeyValue('Warning', warning));
  }
}

async function writeJsonReport(report, outputPath) {
  const finalOutputPath = outputPath || path.join(
    REPORTS_DIR,
    `sanitization-dry-run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
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
    const report = await buildDryRunReport(db, options);
    printReport(report);

    if (options.writeJson) {
      const outputPath = await writeJsonReport(report, options.outputPath);
      console.log(`\nReporte JSON guardado en: ${outputPath}`);
    }

    console.log('\nDry-run de saneamiento completado sin escrituras sobre la base SQLite.');
  } catch (error) {
    console.error(`\nError ejecutando el dry-run de saneamiento: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (db) {
      await closeDatabase(db);
    }
  }
}

main();
