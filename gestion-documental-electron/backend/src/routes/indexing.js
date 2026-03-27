const express = require('express');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { startIndexing, getIndexingRuns } = require('../services/indexingService');

const router = express.Router();

router.post('/run', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const runId = await startIndexing(req.user.id);
    res.json({
      message: 'Indexación iniciada en segundo plano',
      runId
    });
  } catch (error) {
    if (error.code === 'INDEXING_ALREADY_RUNNING') {
      return res.status(409).json({ message: 'Ya existe una indexación en ejecución' });
    }

    console.error('Start indexing error:', error);
    res.status(500).json({ message: 'Error iniciando indexación' });
  }
});

router.get('/runs', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const runs = await getIndexingRuns();
    res.json(runs);
  } catch (error) {
    console.error('Get indexing runs error:', error);
    res.status(500).json({ message: 'Error obteniendo corridas de indexación' });
  }
});

module.exports = router;
