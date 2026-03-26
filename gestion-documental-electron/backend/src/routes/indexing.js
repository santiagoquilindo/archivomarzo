const express = require('express');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { runIndexing, getIndexingRuns } = require('../services/indexingService');

const router = express.Router();

router.post('/run', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    // Ejecutar indexación en background
    runIndexing(req.user.id).catch(err => console.error('Background indexing error:', err));
    res.json({ message: 'Indexación iniciada en segundo plano' });
  } catch (error) {
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