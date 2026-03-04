const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');

// All admin API routes require authentication + admin role
router.use(authenticateToken);
router.use(authorize(['admin']));

router.get('/overview', (req, res) => {
  return res.status(200).json({ summary: {} });
});

module.exports = router;
