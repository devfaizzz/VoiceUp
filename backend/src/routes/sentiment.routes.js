const express = require('express');
const router = express.Router();
const { authorize } = require('../middleware/auth');
const sentimentService = require('../ai/sentimentService');

// Admin only route
router.get('/dashboard', authorize(['admin', 'staff']), async (req, res) => {
    try {
        const report = await sentimentService.generateSentimentReport();
        return res.status(200).json(report);
    } catch (err) {
        console.error('Sentiment dashboard error:', err);
        return res.status(500).json({ message: 'Failed to load sentiment dashboard' });
    }
});

module.exports = router;
