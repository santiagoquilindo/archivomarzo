const express = require('express');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { startIndexing, getIndexingRuns } = require('../services/indexingService');
const { AppError, sendError, sendSuccess } = require('../utils/http');

const router = express.Router();

router.post('/run', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const runId = await startIndexing(req.user.id);
    return sendSuccess(res, {
      message: 'Indexación iniciada en segundo plano',
      runId,
    });
  } catch (error) {
    if (error.code === 'INDEXING_ALREADY_RUNNING') {
      return sendError(
        res,
        new AppError(
          'Ya existe una indexación en ejecución',
          409,
          'INDEXING_ALREADY_RUNNING',
        ),
      );
    }

    console.error('Start indexing error:', error.message);
    return sendError(res, error, 'Error iniciando indexación');
  }
});

router.get('/runs', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const runs = await getIndexingRuns();
    return res.json(runs);
  } catch (error) {
    console.error('Get indexing runs error:', error.message);
    return sendError(res, error, 'Error obteniendo corridas de indexación');
  }
});

module.exports = router;
