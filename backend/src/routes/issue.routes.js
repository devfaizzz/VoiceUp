const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticateToken, authorize, optionalAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const issueController = require('../controllers/issueController');
const { validateIssue } = require('../middleware/validation');

// Memory storage for audio transcription (we need raw buffer, not Cloudinary URL)
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Public routes
router.get('/public', issueController.getPublicIssues);
router.get('/public/:id', issueController.getPublicIssueById);
router.get('/nearby', issueController.getNearbyIssues);
router.get('/stats', issueController.getIssueStatistics);

// Submission route (no auth required for now; will attach user if present)
router.post('/',
  optionalAuth,
  upload.fields([
    { name: 'images', maxCount: 5 },
    { name: 'audio', maxCount: 1 }
  ]),
  validateIssue,
  issueController.createIssue
);

// Voice transcription route (Groq Whisper STT — uses memory storage)
router.post('/transcribe',
  optionalAuth,
  memUpload.single('audio'),
  issueController.transcribeAudio
);

// AI Structuring route (extract structured data from raw text)
router.post('/ai-structure',
  optionalAuth,
  issueController.structureIssueText
);

// Temporarily make status updates open for demo (will secure later)
router.put('/:id/status', issueController.updateIssueStatus);

// Protected routes (require authentication)
router.use(authenticateToken);

router.get('/my-issues', issueController.getMyIssues);
router.get('/:id', issueController.getIssueById);
router.put('/:id', issueController.updateIssue);
router.delete('/:id', issueController.deleteIssue);

// Issue interactions
router.post('/:id/comment', issueController.addComment);
router.post('/:id/upvote', issueController.toggleUpvote);
router.post('/:id/feedback', issueController.submitFeedback);
router.post('/:id/reminder', issueController.sendReminder);

router.put('/:id/assign', authorize(['admin', 'staff']), issueController.assignIssue);

router.put('/:id/priority', authorize(['admin', 'staff']), issueController.updatePriority);

router.post('/:id/resolve',
  authorize(['admin', 'staff']),
  upload.array('resolutionImages', 3),
  issueController.resolveIssue
);

// Analytics routes (admin only)
router.get('/analytics/category-distribution',
  authorize(['admin']),
  issueController.getCategoryDistribution
);

router.get('/analytics/resolution-time',
  authorize(['admin']),
  issueController.getResolutionTimeStats
);

router.get('/analytics/heatmap',
  authorize(['admin']),
  issueController.getIssueHeatmap
);

// Batch operations (admin only)
router.post('/batch/classify',
  authorize(['admin']),
  issueController.batchClassifyIssues
);

router.put('/batch/update-status',
  authorize(['admin']),
  issueController.batchUpdateStatus
);

module.exports = router;
