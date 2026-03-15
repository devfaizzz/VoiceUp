const express = require('express');
const router = express.Router();
const { authorize } = require('../middleware/auth');
const communicationService = require('../ai/communicationService');

router.post('/generate', authorize(['admin', 'staff']), async (req, res) => {
    try {
        const { issueId, tone, context } = req.body;
        if (!issueId) return res.status(400).json({ message: 'Issue ID is required' });

        const draft = await communicationService.generateCommunication(issueId, tone, context);
        return res.status(200).json({ draft });
    } catch (err) {
        console.error('Communication error:', err);
        return res.status(500).json({ message: 'Failed to generate communication draft' });
    }
});

module.exports = router;
