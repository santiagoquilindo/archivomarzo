const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/me', verifyToken, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
