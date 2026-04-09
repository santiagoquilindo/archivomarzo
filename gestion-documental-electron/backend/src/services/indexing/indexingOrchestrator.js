const { getAllRootFolders } = require('../rootFolderService');
const { logIndexing } = require('./indexingLogger');
const { synchronizeRootFolder } = require('./fileSync');

function createCounters() {
  return {
    scanned: 0,
    indexed: 0,
    updated: 0,
    missing: 0,
    errors: 0,
  };
}

function resolveFinalStatus(counters) {
  return {
    status: counters.errors > 0 ? 'failed' : 'completed',
    notes: counters.errors > 0 ? 'La corrida terminó con errores' : null,
  };
}

async function processActiveRootFolders(userId, counters) {
  const allRootFolders = await getAllRootFolders();
  const rootFolders = allRootFolders.filter(
    (folder) => Number(folder.is_active) === 1,
  );

  logIndexing(`[INDEXING] Active root folders: ${rootFolders.length}`);

  for (const folder of rootFolders) {
    logIndexing(
      `[INDEXING] Processing active folder: ${folder.name}, path: ${folder.absolute_path}`,
    );
    await synchronizeRootFolder(folder, userId, counters);
  }
}

async function runIndexingProcess({ runId, userId, finishIndexingRun }) {
  const counters = createCounters();

  try {
    await processActiveRootFolders(userId, counters);

    logIndexing(
      `[INDEXING] Final counters: scanned=${counters.scanned}, indexed=${counters.indexed}, updated=${counters.updated}, missing=${counters.missing}, errors=${counters.errors}`,
    );

    const finalResult = resolveFinalStatus(counters);
    await finishIndexingRun(runId, finalResult.status, counters, finalResult.notes);
  } catch (error) {
    console.error('Indexing error:', error.message);
    counters.errors += 1;
    await finishIndexingRun(runId, 'failed', counters, error.message);
  }
}

module.exports = {
  runIndexingProcess,
};
