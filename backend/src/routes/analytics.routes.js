const express = require('express');
const router = express.Router();

const { authenticateToken, authorize } = require('../middleware/auth');
const analyticsService = require('../services/analyticsService');

router.get('/health', (req, res) => {
  return res.status(200).json({ status: 'ok' });
});

// Apply authentication to protected analytics routes
router.get('/trust-dashboard', authenticateToken, authorize(['admin', 'staff']), async (req, res) => {
  try {
    const data = await analyticsService.getTrustDashboardData();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch trust dashboard' });
  }
});

module.exports = router;


