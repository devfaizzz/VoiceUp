const Issue = require('../models/Issue');
const User = require('../models/User');
const classifier = require('../ai/classificationService');

// ─── Voice Coin amounts ───────────────────────────────────────────────────────
const COIN_REWARDS = {
  new: 50,   // initial submission
  approved: 100,
  rejected: 20,
  resolved: 150,
  in_progress: 10,
  acknowledged: 10
};

// Helper: award/update coins on user
async function awardCoins(userId, issue, newStatus) {
  if (!userId) return;
  const reward = COIN_REWARDS[newStatus];
  if (!reward) return;
  try {
    // Only award if transition hasn't given coins for this status yet
    const alreadyRewarded = issue.notifications?.some(
      n => n.type === 'in_app' && n.message && n.message.includes(`coins:${newStatus}`)
    );
    if (alreadyRewarded) return;

    await User.findByIdAndUpdate(userId, { $inc: { voiceCoins: reward } });

    // Mark reward given
    issue.notifications = issue.notifications || [];
    issue.notifications.push({
      type: 'in_app',
      sentAt: new Date(),
      status: 'sent',
      message: `coins:${newStatus}:+${reward}`
    });
  } catch (e) {
    console.error('awardCoins error:', e);
  }
}

// ─── Controllers ─────────────────────────────────────────────────────────────

const getPublicIssues = async (req, res) => {
  const issues = await Issue.find({ isPublic: true }).sort({ createdAt: -1 }).limit(100).lean();
  return res.status(200).json({ issues });
};

const getPublicIssueById = async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id).lean();
    if (!issue) return res.status(404).json({ message: 'Issue not found' });
    return res.status(200).json(issue); // Return issue object directly to match contractor.js expectations
  } catch {
    return res.status(404).json({ message: 'Issue not found' });
  }
};

const getNearbyIssues = async (req, res) => {
  return res.status(200).json({ issues: [], message: 'Nearby issues placeholder' });
};

const getIssueStatistics = async (req, res) => {
  return res.status(200).json({ stats: {} });
};

const createIssue = async (req, res) => {
  try {
    const userId = (req.user?._id || req.user?.id) || null;
    const { title, description, category, latitude, longitude, address, imageBase64 } = req.body;
    if (!title || !description || !category || !latitude || !longitude) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    let imageBuffer = null;
    if (imageBase64) {
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');
    }

    const ai = await classifier.classify(
      imageBuffer, title, description, category,
      Number(longitude), Number(latitude)
    );

    const issue = await Issue.create({
      title, description, category,
      priority: ai.priority,
      location: { type: 'Point', coordinates: [Number(longitude), Number(latitude)], address },
      reportedBy: userId,
      aiClassification: {
        category,
        confidence: ai.severity / 10,
        suggestedPriority: ai.priority,
        reason: ai.aiReason,
        processedAt: new Date()
      }
    });

    // Award 50 coins for submitting
    if (userId) {
      await User.findByIdAndUpdate(userId, {
        $inc: { voiceCoins: COIN_REWARDS.new, 'statistics.totalReports': 1 }
      });
      issue.notifications = [{ type: 'in_app', sentAt: new Date(), status: 'sent', message: `coins:new:+${COIN_REWARDS.new}` }];
      await issue.save();
    }

    req.app.get('io').emit('issue:new', {
      id: issue._id, title: issue.title, category: issue.category,
      status: issue.status, priority: issue.priority
    });

    return res.status(201).json({
      id: issue._id,
      priority: ai.priority,
      severity: ai.severity,
      duplicateCount: ai.duplicateCount,
      aiReason: ai.aiReason,
      coinsAwarded: COIN_REWARDS.new
    });
  } catch (err) {
    console.error('Create issue error:', err);
    return res.status(500).json({ message: 'Failed to create issue' });
  }
};

const getMyIssues = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    let issues = [];

    if (userId) {
      issues = await Issue.find({ reportedBy: userId }).sort({ createdAt: -1 }).lean();
    }

    // Also include anonymous issues if their IDs are passed from local storage
    if (req.query.ids) {
      const ids = req.query.ids.split(',').filter(id => /^[0-9a-fA-F]{24}$/.test(id));
      if (ids.length > 0) {
        const anonIssues = await Issue.find({ _id: { $in: ids } }).sort({ createdAt: -1 }).lean();

        if (userId) {
          const mainIds = new Set(issues.map(i => i._id.toString()));
          for (const a of anonIssues) {
            if (!mainIds.has(a._id.toString())) issues.push(a);
          }
          issues.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        } else {
          issues = anonIssues;
        }
      }
    }

    return res.status(200).json({ issues });
  } catch (err) {
    console.error('getMyIssues error:', err);
    return res.status(500).json({ message: 'Error retrieving issues' });
  }
};

const getIssueById = async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id).lean();
    if (!issue) return res.status(404).json({ message: 'Issue not found' });
    return res.status(200).json({ issue });
  } catch {
    return res.status(404).json({ message: 'Issue not found' });
  }
};

const updateIssue = async (req, res) => {
  return res.status(200).json({ id: req.params.id, message: 'Issue updated (stub)' });
};

const deleteIssue = async (req, res) => {
  return res.status(200).json({ id: req.params.id, message: 'Issue deleted (stub)' });
};

const addComment = async (req, res) => {
  return res.status(201).json({ id: req.params.id, message: 'Comment added (stub)' });
};

const toggleUpvote = async (req, res) => {
  return res.status(200).json({ id: req.params.id, upvoted: true });
};

const submitFeedback = async (req, res) => {
  return res.status(201).json({ id: req.params.id, message: 'Feedback submitted (stub)' });
};

// Award coins when admin changes status
const updateIssueStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });

    const prevStatus = issue.status;
    issue.status = status;

    // Award coins to reporter
    if (issue.reportedBy && prevStatus !== status) {
      await awardCoins(issue.reportedBy, issue, status);
      // Also update resolved count in stats
      if (status === 'resolved' || status === 'closed') {
        await User.findByIdAndUpdate(issue.reportedBy, {
          $inc: { 'statistics.resolvedReports': 1 }
        });
      }
    }

    await issue.save();

    // Realtime to user
    if (issue.reportedBy) {
      req.app.get('io').to(`user-${issue.reportedBy}`).emit('issue:status', {
        id: issue._id, status: issue.status,
        coinsAwarded: COIN_REWARDS[status] || 0
      });
    }
    // Realtime to all admins
    req.app.get('io').emit('issue:updated', { id: issue._id, status: issue.status });

    return res.status(200).json({ id: issue._id, status: issue.status, coinsAwarded: COIN_REWARDS[status] || 0 });
  } catch (err) {
    console.error('updateIssueStatus error:', err);
    return res.status(500).json({ message: 'Failed to update status' });
  }
};

// Reminder from citizen → pushes to admin notification panel via Socket.io
const sendReminder = async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id).lean();
    if (!issue) return res.status(404).json({ message: 'Issue not found' });

    const userName = req.user?.name || 'A citizen';

    // Emit to admin panel via socket (admin listens on 'admin:reminder')
    req.app.get('io').emit('admin:reminder', {
      id: issue._id,
      title: issue.title,
      category: issue.category,
      status: issue.status,
      priority: issue.priority,
      reportedBy: userName,
      message: `${userName} sent a reminder for "${issue.title}" — please review this issue.`,
      sentAt: new Date().toISOString()
    });

    return res.status(200).json({ message: 'Reminder sent to admin.' });
  } catch (err) {
    console.error('sendReminder error:', err);
    return res.status(500).json({ message: 'Failed to send reminder' });
  }
};

const assignIssue = async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });

    // Assign department
    if (req.body.assignee) {
      issue.assignedTo = {
        department: req.body.assignee.department,
        name: req.body.assignee.name,
        assignedAt: new Date()
      };
    } else {
      issue.assignedTo = null;
    }

    issue.markModified('assignedTo');
    await issue.save();
    return res.status(200).json({ id: issue._id, assignee: issue.assignedTo, status: issue.status });
  } catch (err) {
    console.error('assignIssue error:', err);
    return res.status(500).json({ message: 'Failed to assign issue' });
  }
};

const updatePriority = async (req, res) => {
  return res.status(200).json({ id: req.params.id, priority: req.body.priority || 'medium' });
};

const resolveIssue = async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });

    issue.status = 'resolved';

    // Process uploaded resolution images 
    const resolutionImages = [];
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        resolutionImages.push({
          url: file.path,
          publicId: file.filename || file.public_id
        });
      });
    }

    issue.resolution = {
      resolvedAt: new Date(),
      resolvedBy: req.user?._id || req.user?.id || null,
      resolutionNotes: req.body.resolutionNotes || 'Resolved by admin',
      resolutionImages
    };

    // If report has reporter, award coins 
    if (issue.reportedBy && issue.status !== 'resolved') {
      await awardCoins(issue.reportedBy, issue, 'resolved');
      await User.findByIdAndUpdate(issue.reportedBy, {
        $inc: { 'statistics.resolvedReports': 1 }
      });
    }

    await issue.save();

    // Trigger realtime updates
    if (issue.reportedBy) {
      req.app.get('io').to(`user-${issue.reportedBy}`).emit('issue:status', {
        id: issue._id, status: issue.status,
        coinsAwarded: COIN_REWARDS['resolved'] || 0
      });
    }
    req.app.get('io').emit('issue:updated', { id: issue._id, status: issue.status });

    return res.status(200).json({ id: issue._id, message: 'Issue resolved successfully', issue });
  } catch (err) {
    console.error('Resolve issue error:', err);
    return res.status(500).json({ message: 'Failed to resolve issue' });
  }
};

const getCategoryDistribution = async (req, res) => {
  return res.status(200).json({ distribution: {} });
};

const getResolutionTimeStats = async (req, res) => {
  return res.status(200).json({ resolutionTime: {} });
};

const getIssueHeatmap = async (req, res) => {
  return res.status(200).json({ heatmap: [] });
};

const batchClassifyIssues = async (req, res) => {
  return res.status(200).json({ processed: 0 });
};

const batchUpdateStatus = async (req, res) => {
  return res.status(200).json({ updated: 0 });
};

// ─── Voice Transcription (Groq Whisper) ──────────────────────────────────────
const transcribeAudio = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: 'No audio file provided' });
    }

    const result = await classifier.transcribe(req.file.buffer, req.file.originalname || 'audio.webm');
    return res.status(200).json({ text: result.text });
  } catch (err) {
    console.error('Transcription error:', err);
    return res.status(500).json({ message: 'Transcription failed: ' + err.message });
  }
};

// ─── AI Structuring ──────────────────────────────────────────────────────────
const structureIssueText = async (req, res) => {
  try {
    const { rawText, imageBase64 } = req.body;
    if (!rawText) return res.status(400).json({ message: 'No text provided' });

    let imageBuffer = null;
    if (imageBase64) {
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');
    }

    const structured = await classifier.structureInput(rawText, imageBuffer);
    return res.status(200).json(structured);
  } catch (err) {
    console.error('Structurer error:', err);
    return res.status(500).json({ message: 'Structuring failed' });
  }
};

module.exports = {
  getPublicIssues, getPublicIssueById, getNearbyIssues, getIssueStatistics,
  createIssue, getMyIssues, getIssueById, updateIssue, deleteIssue,
  addComment, toggleUpvote, submitFeedback, updateIssueStatus, sendReminder,
  assignIssue, updatePriority, resolveIssue,
  getCategoryDistribution, getResolutionTimeStats, getIssueHeatmap,
  batchClassifyIssues, batchUpdateStatus, transcribeAudio, structureIssueText
};
