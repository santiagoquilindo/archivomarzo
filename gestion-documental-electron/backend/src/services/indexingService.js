const {
  createIndexingRun,
  finishIndexingRun,
  getIndexingRuns,
  hasRunningIndexingRun,
} = require('./indexing/indexingRunRepository');
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

module.exports = {
  startIndexing,
  getIndexingRuns,
  hasRunningIndexingRun,
};
