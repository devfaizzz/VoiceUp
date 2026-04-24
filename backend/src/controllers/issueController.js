const mongoose = require('mongoose');
const Issue = require('../models/Issue');
const User = require('../models/User');
const Bid = require('../models/Bid');
const classifier = require('../ai/classificationService');
const sentimentService = require('../ai/sentimentService');
const { calculateDistance, isValidCoordinates } = require('../utils/locationUtils');
const { calculatePriority, normalizePriority } = require('../utils/issuePriority');
const { sendStatusEmail } = require('../utils/emailService');

const COIN_REWARDS = {
  new: 50,
  approved: 100,
  rejected: 20,
  resolved: 150,
  in_progress: 10,
  acknowledged: 10,
  satisfied: 75
};

function fallbackAiClassification(title, description) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  let severity = 3;

  if (/(danger|urgent|collapsed|flood|fire|accident|injury)/.test(text)) severity = 9;
  else if (/(broken|blocked|overflow|burst|sewage|pothole|leak)/.test(text)) severity = 6;

  const priority = severity >= 9 ? 'critical' : severity >= 6 ? 'high' : severity >= 4 ? 'medium' : 'low';
  return {
    priority,
    severity,
    duplicateCount: 0,
    aiReason: 'Fallback local classification'
  };
}

function getUserId(req) {
  return req.user?._id || req.user?.id || null;
}

function sanitizeIssue(issue, currentUserId) {
  if (!issue) return issue;
  const normalized = typeof issue.toObject === 'function' ? issue.toObject() : { ...issue };
  normalized.upvoteCount = normalized.upvoteCount ?? normalized.upvotes?.length ?? 0;
  normalized.hasUpvoted = currentUserId
    ? (normalized.upvotes || []).some((id) => id.toString() === currentUserId.toString())
    : false;
  return normalized;
}

async function awardCoins(userId, issue, newStatus) {
  if (!userId) return;
  const reward = COIN_REWARDS[newStatus];
  if (!reward) return;

  const alreadyRewarded = issue.notifications?.some(
    (item) => item.type === 'in_app' && item.message && item.message.includes(`coins:${newStatus}`)
  );
  if (alreadyRewarded) return;

  await User.findByIdAndUpdate(userId, { $inc: { voiceCoins: reward } });

  issue.notifications = issue.notifications || [];
  issue.notifications.push({
    type: 'in_app',
    sentAt: new Date(),
    status: 'sent',
    message: `coins:${newStatus}:+${reward}`
  });
}

async function recomputeIssuePriority(issue) {
  issue.upvoteCount = issue.upvotes?.length || issue.upvoteCount || 0;
  issue.priority = calculatePriority({
    basePriority: issue.basePriority || issue.priority,
    upvoteCount: issue.upvoteCount,
    sentiment: (issue.sentiment?.label || 'Neutral').toLowerCase()
  });
}

function ensureValidCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return isValidCoordinates(lat, lng) ? { lat, lng } : null;
}

const getPublicIssues = async (req, res) => {
  const currentUserId = getUserId(req);
  const issues = await Issue.find({ isPublic: true })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  return res.status(200).json({
    issues: issues.map((issue) => sanitizeIssue(issue, currentUserId))
  });
};

const getPublicIssueById = async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id).lean();
    if (!issue) return res.status(404).json({ message: 'Issue not found' });
    return res.status(200).json(sanitizeIssue(issue, getUserId(req)));
  } catch (error) {
    return res.status(404).json({ message: 'Issue not found' });
  }
};

const getNearbyIssues = async (req, res) => {
  try {
    const coords = ensureValidCoordinates(req.query.latitude, req.query.longitude);
    if (!coords) {
      return res.status(400).json({ message: 'Valid latitude and longitude are required' });
    }

    const radius = Math.min(Math.max(Number(req.query.radius) || 5000, 100), 20000);
    const currentUserId = getUserId(req);

    const candidates = await Issue.find({
      isPublic: true,
      'location.coordinates.0': { $exists: true },
      'location.coordinates.1': { $exists: true }
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const enriched = candidates.map((issue) => {
      const distance = issue.location?.coordinates
        ? Math.round(calculateDistance([coords.lng, coords.lat], issue.location.coordinates))
        : null;
      return {
        ...sanitizeIssue(issue, currentUserId),
        distance
      };
    })
      .filter((issue) => issue.distance !== null && issue.distance <= radius)
      .sort((a, b) => {
        if ((b.upvoteCount || 0) !== (a.upvoteCount || 0)) return (b.upvoteCount || 0) - (a.upvoteCount || 0);
        return (a.distance || 0) - (b.distance || 0);
      })
      .slice(0, 50);

    return res.status(200).json({ issues: enriched, radius });
  } catch (error) {
    console.error('getNearbyIssues error:', error);
    return res.status(500).json({ message: 'Failed to fetch nearby issues' });
  }
};

const getIssueStatistics = async (req, res) => {
  const [total, open, resolved] = await Promise.all([
    Issue.countDocuments(),
    Issue.countDocuments({ status: { $nin: ['resolved', 'closed', 'rejected'] } }),
    Issue.countDocuments({ status: { $in: ['resolved', 'closed'] } })
  ]);

  return res.status(200).json({ stats: { total, open, resolved } });
};

const createIssue = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { title, description, category, latitude, longitude, address, area, city, postalCode, imageBase64 } = req.body;

    const coords = ensureValidCoordinates(latitude, longitude);
    if (!title || !description || !category || !coords) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    let imageBuffer = null;
    if (imageBase64) {
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');
    }

    let ai;
    try {
      ai = await classifier.classify(
        imageBuffer,
        title,
        description,
        category,
        coords.lng,
        coords.lat
      );
    } catch (classificationError) {
      console.error('AI classification failed, using fallback:', classificationError);
      ai = fallbackAiClassification(title, description);
    }

    const sentiment = sentimentService.analyzeText(description);

    const basePriority = normalizePriority(ai.priority);
    const issue = await Issue.create({
      title,
      description,
      category,
      priority: calculatePriority({ basePriority, sentiment: sentiment.label.toLowerCase() }),
      basePriority,
      location: {
        type: 'Point',
        coordinates: [coords.lng, coords.lat],
        address,
        area,
        city,
        postalCode
      },
      reportedBy: userId,
      aiClassification: {
        category,
        confidence: ai.severity / 10,
        suggestedPriority: ai.priority,
        reason: ai.aiReason,
        processedAt: new Date()
      },
      sentiment: {
        label: sentiment.label,
        score: sentiment.score,
        analyzedAt: new Date()
      }
    });

    if (userId) {
      await User.findByIdAndUpdate(userId, {
        $inc: { voiceCoins: COIN_REWARDS.new, 'statistics.totalReports': 1 }
      });
      issue.notifications = [{
        type: 'in_app',
        sentAt: new Date(),
        status: 'sent',
        message: `coins:new:+${COIN_REWARDS.new}`
      }];
      await issue.save();
      
      try {
        const citizen = await User.findById(userId);
        if (citizen && citizen.email) {
          sendStatusEmail(citizen.email, citizen.name, issue.title, 'submitted');
        }
      } catch (err) {
        console.error('Error fetching citizen for submission email:', err);
      }
    }

    req.app.get('io').emit('issue:new', {
      id: issue._id,
      title: issue.title,
      category: issue.category,
      status: issue.status,
      priority: issue.priority
    });

    return res.status(201).json({
      id: issue._id,
      priority: issue.priority,
      severity: ai.severity,
      duplicateCount: ai.duplicateCount,
      aiReason: ai.aiReason,
      coinsAwarded: userId ? COIN_REWARDS.new : 0,
      sentiment: issue.sentiment
    });
  } catch (error) {
    console.error('Create issue error:', error);
    return res.status(500).json({ message: 'Failed to create issue' });
  }
};

const getMyIssues = async (req, res) => {
  try {
    const userId = getUserId(req);
    let issues = [];

    if (userId) {
      issues = await Issue.find({ reportedBy: userId }).sort({ createdAt: -1 }).lean();
    }

    if (req.query.ids) {
      const ids = req.query.ids.split(',').filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (ids.length > 0) {
        const anonIssues = await Issue.find({ _id: { $in: ids } }).sort({ createdAt: -1 }).lean();
        if (userId) {
          const currentIds = new Set(issues.map((issue) => issue._id.toString()));
          anonIssues.forEach((issue) => {
            if (!currentIds.has(issue._id.toString())) issues.push(issue);
          });
          issues.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        } else {
          issues = anonIssues;
        }
      }
    }

    return res.status(200).json({
      issues: issues.map((issue) => sanitizeIssue(issue, userId))
    });
  } catch (error) {
    console.error('getMyIssues error:', error);
    return res.status(500).json({ message: 'Error retrieving issues' });
  }
};

const getIssueById = async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });

    const userId = getUserId(req);
    const ownsIssue = issue.reportedBy && userId && issue.reportedBy.toString() === userId.toString();
    if (!issue.isPublic && !ownsIssue && req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    return res.status(200).json({ issue: sanitizeIssue(issue, userId) });
  } catch (error) {
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
  try {
    const userId = getUserId(req);
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: 'Comment text is required' });

    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });

    await issue.addComment(userId, text);
    return res.status(201).json({ message: 'Comment added', issue: sanitizeIssue(issue, userId) });
  } catch (error) {
    console.error('addComment error:', error);
    return res.status(500).json({ message: 'Failed to add comment' });
  }
};

const upvoteIssue = async (req, res) => {
  try {
    const userId = getUserId(req);
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });

    const alreadyUpvoted = issue.upvotes.some((id) => id.toString() === userId.toString());
    if (alreadyUpvoted) {
      return res.status(200).json({
        message: 'Issue already upvoted',
        issue: sanitizeIssue(issue, userId)
      });
    }

    issue.upvotes.push(userId);
    await recomputeIssuePriority(issue);
    await issue.save();

    req.app.get('io').emit('issue:updated', {
      id: issue._id,
      upvoteCount: issue.upvoteCount,
      priority: issue.priority
    });

    return res.status(200).json({
      message: 'Upvote recorded',
      issue: sanitizeIssue(issue, userId)
    });
  } catch (error) {
    console.error('upvoteIssue error:', error);
    return res.status(500).json({ message: 'Failed to upvote issue' });
  }
};

const incrementViewCount = async (req, res) => {
  try {
    const issue = await Issue.findByIdAndUpdate(
      req.params.id,
      { $inc: { viewCount: 1 } },
      { new: true }
    );

    if (!issue) return res.status(404).json({ message: 'Issue not found' });
    return res.status(200).json({
      issue: sanitizeIssue(issue, getUserId(req))
    });
  } catch (error) {
    console.error('incrementViewCount error:', error);
    return res.status(500).json({ message: 'Failed to track issue view' });
  }
};

const submitFeedback = async (req, res) => {
  return res.status(201).json({ id: req.params.id, message: 'Feedback submitted (stub)' });
};

const updateIssueStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });

    const prevStatus = issue.status;
    issue.status = status;

    if (issue.reportedBy && prevStatus !== status) {
      await awardCoins(issue.reportedBy, issue, status);
      if (status === 'resolved' || status === 'closed') {
        await User.findByIdAndUpdate(issue.reportedBy, {
          $inc: { 'statistics.resolvedReports': 1 }
        });
      }
      
      try {
        const citizen = await User.findById(issue.reportedBy);
        if (citizen && citizen.email) {
          sendStatusEmail(citizen.email, citizen.name, issue.title, status);
        }
      } catch (err) {
        console.error('Error fetching citizen for email notification:', err);
      }
    }

    await issue.save();

    if (issue.reportedBy) {
      req.app.get('io').to(`user-${issue.reportedBy}`).emit('issue:status', {
        id: issue._id,
        status: issue.status,
        coinsAwarded: COIN_REWARDS[status] || 0
      });
    }

    req.app.get('io').emit('issue:updated', { id: issue._id, status: issue.status });
    return res.status(200).json({ id: issue._id, status: issue.status, coinsAwarded: COIN_REWARDS[status] || 0 });
  } catch (error) {
    console.error('updateIssueStatus error:', error);
    return res.status(500).json({ message: 'Failed to update status' });
  }
};

const sendReminder = async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id).lean();
    if (!issue) return res.status(404).json({ message: 'Issue not found' });

    const userName = req.user?.name || 'A citizen';
    req.app.get('io').emit('admin:reminder', {
      id: issue._id,
      title: issue.title,
      category: issue.category,
      status: issue.status,
      priority: issue.priority,
      reportedBy: userName,
      message: `${userName} sent a reminder for "${issue.title}".`,
      sentAt: new Date().toISOString()
    });

    return res.status(200).json({ message: 'Reminder sent to admin.' });
  } catch (error) {
    console.error('sendReminder error:', error);
    return res.status(500).json({ message: 'Failed to send reminder' });
  }
};

const assignIssue = async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });

    issue.assignedTo = req.body.assignee
      ? {
        department: req.body.assignee.department,
        name: req.body.assignee.name,
        assignedAt: new Date()
      }
      : null;

    issue.markModified('assignedTo');
    await issue.save();
    return res.status(200).json({ id: issue._id, assignee: issue.assignedTo, status: issue.status });
  } catch (error) {
    console.error('assignIssue error:', error);
    return res.status(500).json({ message: 'Failed to assign issue' });
  }
};

const updatePriority = async (req, res) => {
  try {
    const priority = normalizePriority(req.body.priority);
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });

    issue.basePriority = priority;
    await recomputeIssuePriority(issue);
    await issue.save();

    return res.status(200).json({ id: issue._id, priority: issue.priority, basePriority: issue.basePriority });
  } catch (error) {
    console.error('updatePriority error:', error);
    return res.status(500).json({ message: 'Failed to update priority' });
  }
};

const resolveIssue = async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });

    const wasResolved = issue.status === 'resolved';
    issue.status = 'resolved';

    const resolutionImages = (req.files || []).map((file) => ({
      url: file.path,
      publicId: file.filename || file.public_id
    }));

    issue.resolution = {
      resolvedAt: new Date(),
      resolvedBy: getUserId(req),
      resolutionNotes: req.body.resolutionNotes || 'Resolved by admin',
      resolutionImages
    };

    if (issue.reportedBy && !wasResolved) {
      await awardCoins(issue.reportedBy, issue, 'resolved');
      await User.findByIdAndUpdate(issue.reportedBy, {
        $inc: { 'statistics.resolvedReports': 1 }
      });
      
      try {
        const citizen = await User.findById(issue.reportedBy);
        if (citizen && citizen.email) {
          sendStatusEmail(citizen.email, citizen.name, issue.title, 'resolved');
        }
      } catch (err) {
        console.error('Error fetching citizen for email notification:', err);
      }
    }

    await issue.save();

    if (issue.reportedBy) {
      req.app.get('io').to(`user-${issue.reportedBy}`).emit('issue:status', {
        id: issue._id,
        status: issue.status,
        coinsAwarded: COIN_REWARDS.resolved || 0
      });
    }

    req.app.get('io').emit('issue:updated', { id: issue._id, status: issue.status });
    return res.status(200).json({ id: issue._id, message: 'Issue resolved successfully', issue });
  } catch (error) {
    console.error('Resolve issue error:', error);
    return res.status(500).json({ message: 'Failed to resolve issue' });
  }
};

const respondToWorkVerification = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { decision, comment } = req.body;
    if (!['satisfied', 'not_satisfied'].includes(decision)) {
      return res.status(400).json({ message: 'Decision must be satisfied or not_satisfied' });
    }

    const issue = await Issue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: 'Issue not found' });
    if (!issue.reportedBy || issue.reportedBy.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'Only the reporting citizen can respond' });
    }
    if (issue.citizenFeedback?.status !== 'pending') {
      return res.status(400).json({ message: 'This issue is not awaiting citizen verification' });
    }

    issue.citizenFeedback.status = decision;
    issue.citizenFeedback.comment = comment || '';
    issue.citizenFeedback.respondedAt = new Date();

    if (decision === 'satisfied') {
      issue.status = 'closed';
      issue.citizenFeedback.rewardCoins = COIN_REWARDS.satisfied;
      await User.findByIdAndUpdate(userId, { $inc: { voiceCoins: COIN_REWARDS.satisfied } });
      issue.notifications = issue.notifications || [];
      issue.notifications.push({
        type: 'in_app',
        sentAt: new Date(),
        status: 'sent',
        message: `coins:satisfied:+${COIN_REWARDS.satisfied}`
      });
    } else {
      issue.status = 'in_progress';
      issue.contractorAssignment.status = 'work_in_progress';
    }

    await issue.save();
    return res.status(200).json({ message: 'Citizen response recorded', issue: sanitizeIssue(issue, userId) });
  } catch (error) {
    console.error('respondToWorkVerification error:', error);
    return res.status(500).json({ message: 'Failed to record response' });
  }
};

const getCategoryDistribution = async (req, res) => {
  const distribution = await Issue.aggregate([
    { $group: { _id: '$category', count: { $sum: 1 } } }
  ]);
  return res.status(200).json({ distribution });
};

const getResolutionTimeStats = async (req, res) => {
  const resolvedIssues = await Issue.find({
    status: { $in: ['resolved', 'closed'] },
    'resolution.resolvedAt': { $exists: true }
  }).select('createdAt resolution.resolvedAt');

  const values = resolvedIssues.map((issue) => {
    const createdAt = new Date(issue.createdAt).getTime();
    const resolvedAt = new Date(issue.resolution.resolvedAt).getTime();
    return (resolvedAt - createdAt) / (1000 * 60 * 60 * 24);
  });

  const average = values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1))
    : 0;

  return res.status(200).json({ resolutionTime: { averageDays: average, sampleSize: values.length } });
};

const getIssueHeatmap = async (req, res) => {
  const heatmap = await Issue.find({ 'location.coordinates.0': { $exists: true } })
    .select('location priority upvoteCount category')
    .lean();
  return res.status(200).json({ heatmap });
};

const batchClassifyIssues = async (req, res) => {
  return res.status(200).json({ processed: 0 });
};

const batchUpdateStatus = async (req, res) => {
  return res.status(200).json({ updated: 0 });
};

const transcribeAudio = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: 'No audio file provided' });
    }

    const result = await classifier.transcribe(req.file.buffer, req.file.originalname || 'audio.webm');
    return res.status(200).json({ text: result.text });
  } catch (error) {
    console.error('Transcription error:', error);
    return res.status(500).json({ message: `Transcription failed: ${error.message}` });
  }
};

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
  } catch (error) {
    console.error('Structurer error:', error);
    return res.status(500).json({ message: 'Structuring failed' });
  }
};

module.exports = {
  getPublicIssues,
  getPublicIssueById,
  getNearbyIssues,
  getIssueStatistics,
  createIssue,
  getMyIssues,
  getIssueById,
  updateIssue,
  deleteIssue,
  addComment,
  upvoteIssue,
  incrementViewCount,
  submitFeedback,
  updateIssueStatus,
  sendReminder,
  assignIssue,
  updatePriority,
  resolveIssue,
  respondToWorkVerification,
  getCategoryDistribution,
  getResolutionTimeStats,
  getIssueHeatmap,
  batchClassifyIssues,
  batchUpdateStatus,
  transcribeAudio,
  structureIssueText
};
