const express = require('express');
const router = express.Router();

const { authorize } = require('../middleware/auth');
const analyticsService = require('../services/analyticsService');

router.get('/health', (req, res) => {
  return res.status(200).json({ status: 'ok' });
});

router.get('/trust-dashboard', authorize(['admin', 'staff']), async (req, res) => {
  try {
    const data = await analyticsService.getTrustDashboardData();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch trust dashboard' });
  }
});

module.exports = router;


