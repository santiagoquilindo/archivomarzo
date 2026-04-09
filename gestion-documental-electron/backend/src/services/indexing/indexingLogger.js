const verboseIndexingLogs = process.env.INDEXING_VERBOSE === 'true';

function logIndexing(message) {
  if (verboseIndexingLogs) {
    console.log(message);
  }
}

module.exports = {
  logIndexing,
};
