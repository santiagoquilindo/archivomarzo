const {
  createIndexingRun,
  deleteAllIndexingRuns,
  finishIndexingRun,
  getIndexingRuns,
  hasRunningIndexingRun,
} = require('./indexing/indexingRunRepository');
const { clearIndexedDocuments } = require('./indexing/indexedDocumentRepository');
const { runIndexingProcess } = require('./indexing/indexingOrchestrator');

let indexingInProgress = false;

async function startIndexing(userId) {
  if (indexingInProgress || (await hasRunningIndexingRun())) {
    const error = new Error('Ya existe una indexación en ejecución');
    error.code = 'INDEXING_ALREADY_RUNNING';
    throw error;
  }

  indexingInProgress = true;

  try {
    const runId = await createIndexingRun();

    runIndexingProcess({ runId, userId, finishIndexingRun })
      .catch((error) => {
        console.error('Background indexing error:', error.message);
      })
      .finally(() => {
        indexingInProgress = false;
      });

    return runId;
  } catch (error) {
    indexingInProgress = false;
    throw error;
  }
}

async function limpiarIndice() {
  if (indexingInProgress || (await hasRunningIndexingRun())) {
    const error = new Error('No se puede limpiar el indice mientras hay una indexacion en ejecucion');
    error.code = 'INDEXING_ALREADY_RUNNING';
    throw error;
  }

  const result = await clearIndexedDocuments();
  const deletedIndexingRuns = await deleteAllIndexingRuns();

  return {
    ...result,
    deletedIndexingRuns: deletedIndexingRuns.changes,
  };
}

module.exports = {
  limpiarIndice,
  startIndexing,
  getIndexingRuns,
  hasRunningIndexingRun,
};
