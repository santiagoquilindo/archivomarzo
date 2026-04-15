#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.resolve(__dirname, '../data/app.db');
const REPORTS_DIR = path.resolve(__dirname, '../reports');
const EXAMPLE_LIMIT_DEFAULT = 10;
const HUNG_RUN_HOURS_DEFAULT = 24;
const DEFAULT_ACTOR_USER_ID = 1;
const PHASES = new Set(['all', 'phase1', 'phase2', 'phase3', 'phase4', 'phase5', 'phase6']);

function parseArgs(argv) {
  const options = {
    mode: 'dry-run',
    phase: 'all',
    writeJson: false,
    outputPath: null,
    exampleLimit: EXAMPLE_LIMIT_DEFAULT,
    skipFsChecks: false,
    hungHours: HUNG_RUN_HOURS_DEFAULT,
    confirmBackup: false,
    actorUserId: DEFAULT_ACTOR_USER_ID,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--dry-run') {
      options.mode = 'dry-run';
      continue;
    }
    if (arg === '--apply') {
      options.mode = 'apply';
      continue;
    }
    if (arg === '--confirm-backup') {
      options.confirmBackup = true;
      continue;
    }
    if (arg === '--write-json') {
      options.writeJson = true;
      continue;
    }
    if (arg === '--skip-fs-checks') {
      options.skipFsChecks = true;
      continue;
    }
    if (arg === '--phase') {
      const nextValue = argv[index + 1];
      if (!nextValue || !PHASES.has(nextValue)) {
        throw new Error(`Valor invalido para --phase. Usa uno de: ${[...PHASES].join(', ')}`);
      }
      options.phase = nextValue;
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
    if (arg === '--hung-hours') {
      const nextValue = argv[index + 1];
      if (!nextValue || Number.isNaN(Number(nextValue)) || Number(nextValue) < 0) {
        throw new Error('El valor de --hung-hours debe ser un numero mayor o igual a 0');
      }
      options.hungHours = Number(nextValue);
      index += 1;
      continue;
    }
    if (arg === '--actor-user-id') {
      const nextValue = argv[index + 1];
      if (!nextValue || Number.isNaN(Number(nextValue)) || Number(nextValue) < 1) {
        throw new Error('El valor de --actor-user-id debe ser un entero mayor a 0');
      }
      options.actorUserId = Number(nextValue);
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

  if (options.mode === 'apply' && !options.confirmBackup) {
    throw new Error('El modo --apply exige --confirm-backup');
  }
  if (options.mode === 'apply' && options.phase === 'all') {
    throw new Error('No se permite --apply con --phase all. Ejecuta una fase puntual por vez.');
  }
  if (options.mode === 'apply' && options.phase === 'phase4') {
    throw new Error('La fase4 solo esta habilitada en dry-run hasta definir una estrategia de exclusion logica no destructiva.');
  }

  return options;
}

function printHelp() {
  console.log([
    'Uso:',
    '  node scripts/run-sanitization.js [opciones]',
    '',
    'Opciones:',
    '  --dry-run                 Simula. Es el modo por defecto.',
    '  --apply                   Aplica cambios reales sobre la BD.',
    '  --confirm-backup          Obligatorio con --apply.',
    '  --phase <fase>            all | phase1 | phase2 | phase3 | phase4 | phase5 | phase6',
    '  --example-limit <n>       Cantidad de ejemplos por seccion (default: 10)',
    '  --hung-hours <horas>      Umbral para corridas colgadas (default: 24)',
    '  --actor-user-id <id>      Usuario para auditoria en document_history (default: 1)',
    '  --write-json              Guarda el reporte JSON en reports/',
    '  --output <ruta>           Guarda el reporte JSON en la ruta indicada',
    '  --skip-fs-checks          Conservado por compatibilidad; este script no toca archivos fisicos',
    '  --help, -h                Muestra esta ayuda',
  ].join('\n'));
}

function createDatabase(dbPath, writable) {
  const flags = writable
    ? sqlite3.OPEN_READWRITE
    : sqlite3.OPEN_READONLY;

  return new sqlite3.Database(dbPath, flags, (error) => {
    if (error) {
      console.error(`No fue posible abrir la base: ${error.message}`);
      process.exit(1);
    }
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve({
        changes: this.changes || 0,
        lastID: this.lastID || null,
      });
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
      resolve(row || null);
    });
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

async function withTransaction(db, work) {
  await run(db, 'BEGIN IMMEDIATE TRANSACTION');
  try {
    const result = await work();
    await run(db, 'COMMIT');
    return result;
  } catch (error) {
    try {
      await run(db, 'ROLLBACK');
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
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

function compareIsoAsc(left, right) {
  const leftTime = left ? new Date(left).getTime() : Number.POSITIVE_INFINITY;
  const rightTime = right ? new Date(right).getTime() : Number.POSITIVE_INFINITY;
  return leftTime - rightTime;
}

function hoursBetween(now, isoDateString) {
  const parsed = new Date(isoDateString);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return Number(((now.getTime() - parsed.getTime()) / (1000 * 60 * 60)).toFixed(2));
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

function enrichGroup(records, key, type) {
  const canonical = chooseCanonicalRecord(records);
  const surplus = records.filter((row) => row.id !== canonical.id);

  return {
    group_key: key,
    group_type: type,
    source_categories: uniqueStrings(records.map((row) => row.category)),
    canonical: {
      id: canonical.id,
      category: canonical.category,
      absolute_path: canonical.absolute_path,
      root_folder_id: canonical.root_folder_id,
      reasons: canonical.reasons,
    },
    canonical_record: canonical,
    surplus,
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
        if (row.category === 'Documento gestionado') {
          warnings.push('managed_document_in_group');
        }
        return warnings;
      }),
    ),
  };
}

function buildConsolidationGroups(rows, groupByFn, type) {
  const buckets = new Map();

  rows.forEach((row) => {
    const key = groupByFn(row);
    if (!hasValue(key)) {
      return;
    }
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(row);
  });

  return [...buckets.entries()]
    .map(([key, records]) => enrichGroup(records, key, type))
    .filter((group) => group.surplus_count > 0)
    .sort((left, right) => right.surplus_count - left.surplus_count);
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

function serializeMergeAuditPayload(group, surplusRow, historyCount) {
  return JSON.stringify({
    group_type: group.group_type,
    group_key: group.group_key,
    canonical_document_id: group.canonical.id,
    source_document_id: surplusRow.id,
    source_category: surplusRow.category,
    source_root_folder_id: surplusRow.root_folder_id,
    source_absolute_path: surplusRow.absolute_path,
    moved_history_rows: historyCount,
  });
}

function appendRunNote(existingNotes, noteLine) {
  return hasValue(existingNotes)
    ? `${existingNotes}\n${noteLine}`
    : noteLine;
}

function phaseLabel(phase) {
  return {
    all: 'Todas las fases',
    phase1: 'Fase 1 - Corridas colgadas',
    phase2: 'Fase 2 - Consolidacion interna',
    phase3: 'Fase 3 - Consolidacion global y huerfanos con equivalente',
    phase4: 'Fase 4 - Exclusion logica',
    phase5: 'Fase 5 - Preservacion',
    phase6: 'Fase 6 - Revision manual',
  }[phase] || phase;
}

async function assertActorUserExists(db, userId) {
  const row = await get(db, 'SELECT id FROM users WHERE id = ?', [userId]);
  if (!row) {
    throw new Error(`No existe users.id=${userId}. Usa --actor-user-id con un usuario valido.`);
  }
}

async function buildSanitizationPlan(db, options) {
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
        root_folder_name,
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

  const phase1Runs = indexingRuns
    .filter((runRow) => runRow.status === 'running' && !runRow.finished_at)
    .map((runRow) => ({
      ...runRow,
      age_hours: hoursBetween(now, runRow.started_at),
    }))
    .filter((runRow) => runRow.age_hours != null && runRow.age_hours >= options.hungHours)
    .map((runRow) => ({
      ...runRow,
      proposed_status: 'failed',
      proposed_note: 'Cierre tecnico por saneamiento controlado',
    }));

  const phase2Groups = buildConsolidationGroups(
    byCategory.get('consolidacion_duplicate_internal') || [],
    (row) => `${row.root_folder_id}::${normalizePathKey(row.absolute_path)}`,
    'duplicate_internal',
  );

  const phase3CandidateRows = [
    ...(byCategory.get('consolidacion_duplicate_global') || []),
    ...(byCategory.get('consolidacion_huerfano_con_equivalente') || []),
  ];
  const phase3Groups = buildConsolidationGroupsForCandidateKeys(
    documentRows,
    phase3CandidateRows,
    (row) => normalizePathKey(row.absolute_path),
    'path_level_consolidation',
  );

  const phase4Excluded = [
    ...(byCategory.get('excluido_tecnico') || []),
    ...(byCategory.get('excluido_prueba') || []),
  ];

  const phase5Preservation = {
    managed_documents: byCategory.get('Documento gestionado') || [],
    historical_index: byCategory.get('indexado_historico') || [],
  };

  const phase6Manual = [
    ...(byCategory.get('revision_downloads') || []),
    ...(byCategory.get('revision_valor_documental_potencial') || []),
  ];

  const warnings = [];
  if (phase6Manual.length > 0) {
    warnings.push('Los casos de revision manual no deben tocarse automaticamente.');
  }
  if (phase4Excluded.length > 0) {
    warnings.push('La exclusion logica no se aplica en modo real con el esquema actual; queda limitada a reporte.');
  }
  if (phase3Groups.some((group) => group.warnings.length > 0)) {
    warnings.push('Algunos grupos de consolidacion contienen opened o metadatos; la transaccion preserva historial, pero conviene ejecutar por lotes pequenos.');
  }

  return {
    meta: {
      generated_at: now.toISOString(),
      database_path: DB_PATH,
      classification_report_path: classificationReport.path,
      total_documents_considered: documentRows.length,
      mode: options.mode,
      selected_phase: options.phase,
      fs_checks_performed: !options.skipFsChecks,
      hung_run_threshold_hours: options.hungHours,
      actor_user_id: options.actorUserId,
    },
    rules: {
      phase1: 'Corridas running sin finished_at y con antiguedad mayor o igual al umbral se cierran como failed y se les agrega nota tecnica.',
      phase2: 'Duplicados internos se consolidan por root_folder_id + absolute_path. Se preserva trazabilidad moviendo document_history al canonico antes de eliminar excedentes.',
      phase3: 'Duplicados globales y huerfanos con equivalente se consolidan por absolute_path. Se preserva trazabilidad moviendo document_history al canonico antes de eliminar excedentes.',
      phase4: 'Exclusion logica solo reportada; no se aplica aun por falta de estado o tabla de exclusiones segura.',
      phase5: 'Documento gestionado e indexado_historico quedan preservados y fuera de cambios destructivos.',
      phase6: 'Revision manual nunca se toca automaticamente.',
      canonical_selection: 'El canonico se elige por prioridad: Documento gestionado > no huerfano > no excluido > fila con opened > mayor riqueza documental > created_at mas antiguo > menor id.',
    },
    phase1: {
      name: phaseLabel('phase1'),
      rows: phase1Runs,
      total: phase1Runs.length,
      examples: takeExamples(phase1Runs, options.exampleLimit),
    },
    phase2: {
      name: phaseLabel('phase2'),
      groups: phase2Groups,
      total_groups: phase2Groups.length,
      total_surplus_rows: phase2Groups.reduce((sum, group) => sum + group.surplus_count, 0),
      examples: takeExamples(phase2Groups, options.exampleLimit).map(toSerializableGroup),
    },
    phase3: {
      name: phaseLabel('phase3'),
      groups: phase3Groups,
      total_groups: phase3Groups.length,
      total_surplus_rows: phase3Groups.reduce((sum, group) => sum + group.surplus_count, 0),
      examples: takeExamples(phase3Groups, options.exampleLimit).map(toSerializableGroup),
    },
    phase4: {
      name: phaseLabel('phase4'),
      rows: phase4Excluded,
      total: phase4Excluded.length,
      by_category: {
        excluido_tecnico: (byCategory.get('excluido_tecnico') || []).length,
        excluido_prueba: (byCategory.get('excluido_prueba') || []).length,
      },
      examples: takeExamples(phase4Excluded, options.exampleLimit).map(toLightRow),
      apply_supported: false,
    },
    phase5: {
      name: phaseLabel('phase5'),
      managed_total: phase5Preservation.managed_documents.length,
      historical_index_total: phase5Preservation.historical_index.length,
      managed_examples: takeExamples(phase5Preservation.managed_documents, options.exampleLimit).map(toLightRow),
      historical_examples: takeExamples(phase5Preservation.historical_index, options.exampleLimit).map(toLightRow),
    },
    phase6: {
      name: phaseLabel('phase6'),
      total: phase6Manual.length,
      rows: phase6Manual,
      examples: takeExamples(phase6Manual, options.exampleLimit).map(toLightRow),
    },
    warnings,
  };
}

function toLightRow(row) {
  return {
    id: row.id,
    category: row.category,
    absolute_path: row.absolute_path,
    root_folder_id: row.root_folder_id,
    status: row.status,
    reasons: row.reasons,
  };
}

function toSerializableGroup(group) {
  return {
    group_key: group.group_key,
    group_type: group.group_type,
    source_categories: group.source_categories,
    canonical: group.canonical,
    surplus: group.surplus.map(toLightRow),
    surplus_count: group.surplus_count,
    warnings: group.warnings,
  };
}

function buildReportSkeleton(plan, options) {
  return {
    meta: {
      ...plan.meta,
      mode: options.mode,
      selected_phase: options.phase,
      backup_confirmed: options.confirmBackup,
    },
    decisions: {
      apply_supported: {
        phase1: true,
        phase2: true,
        phase3: true,
        phase4: false,
        phase5: false,
        phase6: false,
      },
      destructive_notes: [
        'Las fases 2 y 3 eliminan filas excedentes de documents solo despues de mover su historial al canonico e insertar auditoria de saneamiento.',
        'La fase 4 no se aplica sin una estrategia de exclusion no destructiva en el modelo.',
      ],
    },
    rules: plan.rules,
    selection: {
      phase: options.phase,
      phase_label: phaseLabel(options.phase),
    },
    preview: {
      phase1: {
        total: plan.phase1.total,
        examples: plan.phase1.examples,
      },
      phase2: {
        total_groups: plan.phase2.total_groups,
        total_surplus_rows: plan.phase2.total_surplus_rows,
        examples: plan.phase2.examples,
      },
      phase3: {
        total_groups: plan.phase3.total_groups,
        total_surplus_rows: plan.phase3.total_surplus_rows,
        examples: plan.phase3.examples,
      },
      phase4: {
        total: plan.phase4.total,
        by_category: plan.phase4.by_category,
        examples: plan.phase4.examples,
      },
      phase5: {
        managed_total: plan.phase5.managed_total,
        historical_index_total: plan.phase5.historical_index_total,
      },
      phase6: {
        total: plan.phase6.total,
        examples: plan.phase6.examples,
      },
    },
    execution: {
      mode: options.mode,
      applied_phase: options.phase,
      changed_rows: 0,
      actions: {},
      warnings: [...plan.warnings],
      skipped: [],
    },
  };
}

async function applyPhase1(db, phaseData) {
  const executed = [];

  await withTransaction(db, async () => {
    for (const runRow of phaseData.rows) {
      const finishedAt = new Date().toISOString();
      const noteLine = `[${finishedAt}] saneamiento_controlado: corrida cerrada por estar colgada`;
      const nextNotes = appendRunNote(runRow.notes, noteLine);

      const result = await run(
        db,
        `UPDATE indexing_runs
         SET finished_at = ?, status = ?, notes = ?
         WHERE id = ? AND status = 'running' AND finished_at IS NULL`,
        [finishedAt, 'failed', nextNotes, runRow.id],
      );

      if (result.changes === 1) {
        executed.push({
          run_id: runRow.id,
          previous_status: runRow.status,
          new_status: 'failed',
          finished_at: finishedAt,
        });
      }
    }
  });

  return {
    changed_rows: executed.length,
    closed_runs: executed.length,
    examples: takeExamples(executed, 10),
  };
}

async function consolidateGroups(db, groups, actorUserId, phaseName) {
  const executedGroups = [];
  let deletedDocuments = 0;
  let movedHistoryRows = 0;
  let auditHistoryRows = 0;
  let updatedCanonicalRows = 0;

  await withTransaction(db, async () => {
    for (const group of groups) {
      if (!group.surplus_count) {
        continue;
      }

      const now = new Date().toISOString();
      const groupExecution = {
        group_key: group.group_key,
        group_type: group.group_type,
        canonical_document_id: group.canonical.id,
        surplus_document_ids: [],
      };

      for (const surplusRow of group.surplus) {
        const historyCountRow = await get(
          db,
          'SELECT COUNT(*) AS c FROM document_history WHERE document_id = ?',
          [surplusRow.id],
        );
        const historyCount = Number(historyCountRow?.c || 0);

        const historyMove = await run(
          db,
          'UPDATE document_history SET document_id = ? WHERE document_id = ?',
          [group.canonical.id, surplusRow.id],
        );
        movedHistoryRows += historyMove.changes;

        const auditPayload = serializeMergeAuditPayload(group, surplusRow, historyCount);
        const auditInsert = await run(
          db,
          `INSERT INTO document_history (
             document_id, action, field_name, old_value, new_value, performed_by, performed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            group.canonical.id,
            'sanitized_merge_duplicate',
            phaseName,
            String(surplusRow.id),
            auditPayload,
            actorUserId,
            now,
          ],
        );
        if (auditInsert.lastID) {
          auditHistoryRows += 1;
        }

        const deleteResult = await run(
          db,
          'DELETE FROM documents WHERE id = ?',
          [surplusRow.id],
        );
        deletedDocuments += deleteResult.changes;

        groupExecution.surplus_document_ids.push(surplusRow.id);
      }

      const canonicalTouch = await run(
        db,
        'UPDATE documents SET updated_at = ?, updated_by = ? WHERE id = ?',
        [new Date().toISOString(), actorUserId, group.canonical.id],
      );
      updatedCanonicalRows += canonicalTouch.changes;

      executedGroups.push(groupExecution);
    }
  });

  return {
    changed_rows: deletedDocuments + movedHistoryRows + auditHistoryRows + updatedCanonicalRows,
    groups_consolidated: executedGroups.length,
    deleted_documents: deletedDocuments,
    moved_history_rows: movedHistoryRows,
    inserted_audit_history_rows: auditHistoryRows,
    updated_canonical_rows: updatedCanonicalRows,
    examples: takeExamples(executedGroups, 10),
  };
}

async function executePlan(db, plan, options) {
  const execution = {
    mode: options.mode,
    applied_phase: options.phase,
    changed_rows: 0,
    actions: {},
    skipped: [],
  };

  if (options.mode === 'dry-run') {
    execution.skipped.push('Dry-run: no se realizaron escrituras sobre la base.');
    return execution;
  }

  await assertActorUserExists(db, options.actorUserId);

  if (options.phase === 'phase1') {
    execution.actions.phase1 = await applyPhase1(db, plan.phase1);
  } else if (options.phase === 'phase2') {
    execution.actions.phase2 = await consolidateGroups(db, plan.phase2.groups, options.actorUserId, 'phase2');
  } else if (options.phase === 'phase3') {
    execution.actions.phase3 = await consolidateGroups(db, plan.phase3.groups, options.actorUserId, 'phase3');
  } else if (options.phase === 'phase4') {
    execution.skipped.push('Phase4 esta bloqueada en apply.');
  } else if (options.phase === 'phase5') {
    execution.skipped.push('Phase5 es informativa; no aplica cambios.');
  } else if (options.phase === 'phase6') {
    execution.skipped.push('Phase6 es informativa; no aplica cambios.');
  }

  execution.changed_rows = Object.values(execution.actions)
    .reduce((sum, action) => sum + Number(action.changed_rows || 0), 0);

  return execution;
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

function printReport(report) {
  printSection('Resumen');
  printKeyValue('Modo', report.meta.mode);
  printKeyValue('Fase seleccionada', report.selection.phase_label);
  printKeyValue('Base de datos', report.meta.database_path);
  printKeyValue('Reporte de clasificacion', report.meta.classification_report_path);
  printKeyValue('Backup confirmado', report.meta.backup_confirmed ? 'si' : 'no');
  printKeyValue('Actor user id', report.meta.actor_user_id);

  printSection('Vista previa');
  printJson('Phase1', report.preview.phase1);
  printJson('Phase2', report.preview.phase2);
  printJson('Phase3', report.preview.phase3);
  printJson('Phase4', report.preview.phase4);
  printJson('Phase5', report.preview.phase5);
  printJson('Phase6', report.preview.phase6);

  printSection('Ejecucion');
  printJson('Resultado', report.execution);

  if ((report.execution.warnings || []).length > 0) {
    printSection('Advertencias');
    report.execution.warnings.forEach((warning) => printKeyValue('Warning', warning));
  }
}

async function writeJsonReport(report, outputPath) {
  const fileName = `sanitization-${report.meta.mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const finalOutputPath = outputPath || path.join(REPORTS_DIR, fileName);

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

    db = createDatabase(DB_PATH, options.mode === 'apply');
    const plan = await buildSanitizationPlan(db, options);
    const report = buildReportSkeleton(plan, options);
    const execution = await executePlan(db, plan, options);
    report.execution = {
      ...report.execution,
      ...execution,
      warnings: uniqueStrings([...(report.execution.warnings || []), ...(plan.warnings || [])]),
    };

    printReport(report);

    if (options.writeJson) {
      const outputPath = await writeJsonReport(report, options.outputPath);
      console.log(`\nReporte JSON guardado en: ${outputPath}`);
    }

    if (options.mode === 'dry-run') {
      console.log('\nSaneamiento controlado completado en modo dry-run sin escrituras sobre la base SQLite.');
    } else {
      console.log('\nSaneamiento controlado aplicado sobre la base SQLite para la fase seleccionada.');
    }
  } catch (error) {
    console.error(`\nError ejecutando el saneamiento controlado: ${error.message}`);
    if (error.rollbackError) {
      console.error(`Rollback error: ${error.rollbackError.message}`);
    }
    process.exitCode = 1;
  } finally {
    if (db) {
      await closeDatabase(db);
    }
  }
}

main();
