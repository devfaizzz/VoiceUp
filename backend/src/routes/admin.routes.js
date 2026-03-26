const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const Issue = require('../models/Issue');
const Bid = require('../models/Bid');
const Contractor = require('../models/Contractor');
const BidRecommendationService = require('../ai/bidRecommendationService');
const ContractorRecommendationService = require('../ai/contractorRecommendationService');

// All admin API routes require authentication + admin role
router.use(authenticateToken);
router.use(authorize(['admin']));

router.get('/overview', (req, res) => {
  return res.status(200).json({ summary: {} });
});

// ── Get full report details ──
router.get('/issue/:id/details', async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id)
      .populate('reportedBy', 'name email phone')
      .populate('contractorAssignment.acceptedContractor', 'name email phone statistics')
      .populate('contractorAssignment.acceptedBid');

    if (!issue) {
      return res.status(404).json({ success: false, message: 'Issue not found' });
    }

    // Get bid count for this issue
    const bidCount = await Bid.countDocuments({ issue: req.params.id });

    // Get accepted bid with work proof if exists
    let acceptedBidDetails = null;
    const acceptedBidId = issue.contractorAssignment?.acceptedBid;
    if (acceptedBidId) {
      acceptedBidDetails = await Bid.findById(acceptedBidId)
        .populate('contractor', 'name email phone statistics location profilePicture');
    }

    if (!acceptedBidDetails) {
      acceptedBidDetails = await Bid.findOne({ issue: req.params.id })
        .sort({ updatedAt: -1, createdAt: -1 })
        .populate('contractor', 'name email phone statistics location profilePicture');
    }

    res.json({
      success: true,
      issue: issue.toObject(),
      bidCount,
      acceptedBidDetails
    });
  } catch (error) {
    console.error('Get issue details error:', error);
    res.status(500).json({ success: false, message: 'Error fetching issue details', error: error.message });
  }
});

// ── AI Contractor Recommendation + Send to Contractors ──
router.post('/issue/:id/ai-recommend-contractors', async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);

    if (!issue) {
      return res.status(404).json({ success: false, message: 'Issue not found' });
    }

    if (issue.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Only approved issues can be sent to contractors' });
    }

    if (issue.contractorAssignment?.status && issue.contractorAssignment.status !== 'none') {
      return res.status(400).json({ success: false, message: 'Issue has already been sent to contractors' });
    }

    // Get AI recommendation
    const recommendationService = new ContractorRecommendationService();
    const recommendation = await recommendationService.getRecommendedContractors(issue);

    // Update issue status
    issue.contractorAssignment = {
      status: 'sent_to_contractors',
      sentAt: new Date()
    };
    await issue.save();

    // Emit Socket.IO event to contractors room
    const io = req.app.get('io');
    if (io) {
      io.to('contractors').emit('new_report_request', {
        issueId: issue._id,
        title: issue.title,
        category: issue.category,
        priority: issue.priority,
        description: issue.description,
        location: issue.location,
        images: issue.images,
        createdAt: issue.createdAt,
        aiRecommendation: recommendation
      });
    }

    res.json({
      success: true,
      message: 'AI analysis complete. Issue sent to contractors.',
      recommendation,
      issue: {
        id: issue._id,
        title: issue.title,
        contractorAssignment: issue.contractorAssignment
      }
    });
  } catch (error) {
    console.error('AI recommend contractors error:', error);
    res.status(500).json({ success: false, message: 'Error recommending contractors', error: error.message });
  }
});

// Send issue to contractors (Fix button — legacy endpoint)
router.post('/issue/:id/send-to-contractors', async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);

    if (!issue) {
      return res.status(404).json({
        success: false,
        message: 'Issue not found'
      });
    }

    // Check if issue is approved
    if (issue.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Only approved issues can be sent to contractors'
      });
    }

    // Check if already sent
    if (issue.contractorAssignment?.status && issue.contractorAssignment.status !== 'none') {
      return res.status(400).json({
        success: false,
        message: 'Issue has already been sent to contractors or is in progress'
      });
    }

    // Update issue status
    issue.contractorAssignment = {
      status: 'sent_to_contractors',
      sentAt: new Date()
    };
    await issue.save();

    // Emit socket event to contractors room
    if (req.app.get('io')) {
      req.app.get('io').to('contractors').emit('new_report_request', {
        issueId: issue._id,
        title: issue.title,
        category: issue.category,
        priority: issue.priority,
        location: issue.location
      });
    }

    res.json({
      success: true,
      message: 'Issue sent to contractors successfully',
      issue: {
        id: issue._id,
        title: issue.title,
        contractorAssignment: issue.contractorAssignment
      }
    });
  } catch (error) {
    console.error('Send to contractors error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending issue to contractors',
      error: error.message
    });
  }
});

// Get bids for an issue with AI recommendation
router.get('/issue/:id/bids', async (req, res) => {
  try {
    const issue = await Issue.findById(req.params.id);

    if (!issue) {
      return res.status(404).json({
        success: false,
        message: 'Issue not found'
      });
    }

    // Get all bids for this issue
    const bids = await Bid.find({ issue: req.params.id })
      .populate('contractor', 'name email phone gstNumber aadhaarNumber location statistics profilePicture address isVerified')
      .sort({ createdAt: -1 });

    if (bids.length === 0) {
      return res.json({
        success: true,
        bids: [],
        recommendation: null,
        message: 'No bids received yet'
      });
    }

    // Get AI recommendation
    let recommendation = null;
    try {
      const bidRecommendationService = new BidRecommendationService();
      recommendation = await bidRecommendationService.getRecommendation(bids, issue);
      
      // Mark the recommended bid
      if (recommendation && recommendation.recommendedBidId) {
        const recommendedBid = bids.find(b => b._id.toString() === recommendation.recommendedBidId);
        if (recommendedBid) {
          recommendedBid.isAIRecommended = true;
          recommendedBid.aiRecommendationReason = recommendation.reason;
          recommendedBid.aiScore = recommendation.score;
          await recommendedBid.save();
        }
      }
    } catch (aiError) {
      console.error('AI recommendation error:', aiError);
    }

    // Format bids for response
    const formattedBids = bids.map(bid => ({
      id: bid._id,
      contractor: {
        id: bid.contractor._id,
        name: bid.contractor.name,
        email: bid.contractor.email,
        phone: bid.contractor.phone,
        gstNumber: bid.contractor.gstNumber,
        aadhaarNumber: bid.contractor.aadhaarNumber ? 
          bid.contractor.aadhaarNumber.slice(0, 4) + '****' + bid.contractor.aadhaarNumber.slice(-4) : 'N/A',
        location: bid.contractor.location,
        statistics: bid.contractor.statistics,
        profilePicture: bid.contractor.profilePicture,
        isVerified: bid.contractor.isVerified
      },
      bidAmount: bid.bidAmount,
      completionDays: bid.completionDays,
      completionDeadline: bid.completionDeadline,
      status: bid.status,
      isAIRecommended: bid.isAIRecommended,
      aiRecommendationReason: bid.aiRecommendationReason,
      aiScore: bid.aiScore,
      createdAt: bid.createdAt
    }));

    res.json({
      success: true,
      bids: formattedBids,
      recommendation,
      totalBids: bids.length
    });
  } catch (error) {
    console.error('Get bids error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching bids',
      error: error.message
    });
  }
});

// Accept a bid
router.post('/bid/:bidId/accept', async (req, res) => {
  try {
    const bid = await Bid.findById(req.params.bidId)
      .populate('contractor', 'name email statistics');

    if (!bid) {
      return res.status(404).json({
        success: false,
        message: 'Bid not found'
      });
    }

    if (bid.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending bids can be accepted'
      });
    }

    // Accept the bid and reject all others
    await bid.acceptBid();

    // Update issue
    const issue = await Issue.findById(bid.issue);
    if (!issue.contractorAssignment) issue.contractorAssignment = {};
    issue.contractorAssignment.status = 'bid_accepted';
    issue.contractorAssignment.acceptedBid = bid._id;
    issue.contractorAssignment.acceptedContractor = bid.contractor._id;
    issue.contractorAssignment.acceptedAt = new Date();
    await issue.save();

    // Update contractor statistics
    const contractor = await Contractor.findById(bid.contractor._id);
    if (!contractor.statistics) {
       contractor.statistics = { totalBids: 0, acceptedBids: 0, completedProjects: 0, averageRating: 0, totalRatings: 0 };
    }
    contractor.statistics.acceptedBids = (contractor.statistics.acceptedBids || 0) + 1;
    await contractor.save();

    // Emit socket event to the specific contractor's room + admins
    if (req.app.get('io')) {
      const io = req.app.get('io');
      // Notify the winning contractor
      io.to(`contractor-${bid.contractor._id}`).emit('bid_accepted', {
        bidId: bid._id,
        issueId: issue._id,
        contractorId: bid.contractor._id,
        issueTitle: issue.title,
        issueDescription: issue.description,
        issueLocation: issue.location,
        bidAmount: bid.bidAmount,
        completionDeadline: bid.completionDeadline,
        completionDays: bid.completionDays,
        message: 'Government has selected your bid. Congratulations!'
      });
      // Notify admins
      io.to('admins').emit('bid:accepted', {
        bidId: bid._id,
        issueId: issue._id,
        contractorName: bid.contractor.name,
        bidAmount: bid.bidAmount
      });
    }

    res.json({
      success: true,
      message: 'Bid accepted successfully',
      bid: {
        id: bid._id,
        status: bid.status,
        contractor: {
          name: bid.contractor.name,
          email: bid.contractor.email
        }
      },
      issue: {
        id: issue._id,
        title: issue.title,
        contractorAssignment: issue.contractorAssignment
      }
    });
  } catch (error) {
    console.error('Accept bid error:', error);
    res.status(500).json({
      success: false,
      message: 'Error accepting bid',
      error: error.message
    });
  }
});

// List all contractors
router.get('/contractors', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, isVerified } = req.query;

    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { gstNumber: { $regex: search, $options: 'i' } }
      ];
    }
    if (isVerified !== undefined) {
      query.isVerified = isVerified === 'true';
    }

    const contractors = await Contractor.find(query)
      .select('-password -aadhaarNumber')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Contractor.countDocuments(query);

    res.json({
      success: true,
      contractors,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('List contractors error:', error);
    res.status(500).json({
      success: false,
      message: 'Error listing contractors',
      error: error.message
    });
  }
});

// Get contractor details
router.get('/contractor/:id', async (req, res) => {
  try {
    const contractor = await Contractor.findById(req.params.id)
      .select('-password')
      .populate('pastProjects.issueId', 'title category');

    if (!contractor) {
      return res.status(404).json({
        success: false,
        message: 'Contractor not found'
      });
    }

    // Get contractor's bids
    const bids = await Bid.find({ contractor: req.params.id })
      .populate('issue', 'title category status')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      contractor: {
        ...contractor.toObject(),
        aadhaarNumber: contractor.aadhaarNumber.slice(0, 4) + '****' + contractor.aadhaarNumber.slice(-4)
      },
      recentBids: bids
    });
  } catch (error) {
    console.error('Get contractor details error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching contractor details',
      error: error.message
    });
  }
});

// Verify/Unverify contractor
router.put('/contractor/:id/verify', async (req, res) => {
  try {
    const { isVerified } = req.body;

    const contractor = await Contractor.findByIdAndUpdate(
      req.params.id,
      { isVerified },
      { new: true }
    ).select('-password');

    if (!contractor) {
      return res.status(404).json({
        success: false,
        message: 'Contractor not found'
      });
    }

    res.json({
      success: true,
      message: `Contractor ${isVerified ? 'verified' : 'unverified'} successfully`,
      contractor
    });
  } catch (error) {
    console.error('Verify contractor error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating contractor verification',
      error: error.message
    });
  }
});

// Approve payment request
router.post('/bid/:bidId/approve-payment', async (req, res) => {
  try {
    const bid = await Bid.findById(req.params.bidId)
      .populate('contractor', 'name statistics');

    if (!bid) {
      return res.status(404).json({
        success: false,
        message: 'Bid not found'
      });
    }

    if (bid.status !== 'payment_requested') {
      return res.status(400).json({
        success: false,
        message: 'No payment request pending for this bid'
      });
    }

    // Approve payment
    bid.paymentRequest.status = 'approved';
    bid.paymentRequest.processedAt = new Date();
    bid.paymentRequest.processedBy = req.user._id;
    bid.status = 'paid';
    await bid.save();

    // Update issue
    await Issue.findByIdAndUpdate(bid.issue, {
      'contractorAssignment.status': 'paid',
      'contractorAssignment.paidAt': new Date()
    });

    // Add to contractor's past projects
    const contractor = await Contractor.findById(bid.contractor._id);
    contractor.pastProjects.push({
      issueId: bid.issue,
      bidId: bid._id,
      completedAt: bid.workProof?.submittedAt || new Date()
    });
    await contractor.save();

    res.json({
      success: true,
      message: 'Payment approved successfully',
      bid
    });
  } catch (error) {
    console.error('Approve payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving payment',
      error: error.message
    });
  }
});

// Verify submitted work and forward it to the reporting citizen
router.post('/bid/:bidId/verify-work', async (req, res) => {
  try {
    const { notes } = req.body;

    const bid = await Bid.findById(req.params.bidId)
      .populate('contractor', 'name')
      .populate('issue');

    if (!bid) {
      return res.status(404).json({ success: false, message: 'Bid not found' });
    }

    if (!bid.workProof?.afterImages?.length) {
      return res.status(400).json({ success: false, message: 'No submitted work proof found' });
    }

    bid.workProof.adminReview = {
      status: 'verified',
      verifiedAt: new Date(),
      verifiedBy: req.user._id,
      notes: notes || 'Verified by admin'
    };
    await bid.save();

    const issue = await Issue.findById(bid.issue._id);
    if (issue) {
      issue.contractorAssignment.status = 'payment_pending';
      issue.contractorAssignment.adminVerifiedAt = new Date();
      issue.contractorAssignment.adminVerifiedBy = req.user._id;
      issue.citizenFeedback = {
        status: 'pending',
        forwardedAt: new Date(),
        comment: notes || '',
        rewardCoins: issue.citizenFeedback?.rewardCoins || 0
      };
      await issue.save();

      if (issue.reportedBy && req.app.get('io')) {
        req.app.get('io').to(`user-${issue.reportedBy}`).emit('issue:status', {
          id: issue._id,
          status: 'awaiting_citizen_confirmation',
          coinsAwarded: 0
        });
      }
    }

    return res.json({
      success: true,
      message: 'Work verified and forwarded to citizen',
      bid
    });
  } catch (error) {
    console.error('Verify work error:', error);
    return res.status(500).json({ success: false, message: 'Error verifying work', error: error.message });
  }
});

// Rate contractor after work completion
router.post('/bid/:bidId/rate', async (req, res) => {
  try {
    const { quality, timeliness, cost, feedback } = req.body;
    const scores = [quality, timeliness, cost].map(Number);

    if (scores.some(score => !score || score < 1 || score > 5)) {
      return res.status(400).json({
        success: false,
        message: 'Quality, timeliness, and cost ratings must be between 1 and 5'
      });
    }

    const bid = await Bid.findById(req.params.bidId)
      .populate('contractor');

    if (!bid) {
      return res.status(404).json({
        success: false,
        message: 'Bid not found'
      });
    }

    if (!['completed', 'payment_requested', 'paid'].includes(bid.status)) {
      return res.status(400).json({
        success: false,
        message: 'Can only rate completed work'
      });
    }

    const averageScore = Math.round(((scores[0] + scores[1] + scores[2]) / 3) * 10) / 10;

    // Update bid rating
    bid.rating = {
      score: averageScore,
      quality: scores[0],
      timeliness: scores[1],
      cost: scores[2],
      feedback,
      ratedAt: new Date(),
      ratedBy: req.user._id
    };
    await bid.save();

    // Update contractor's average rating
    await bid.contractor.updateRating({
      quality: scores[0],
      timeliness: scores[1],
      cost: scores[2]
    });

    // Update past project with rating
    const contractor = await Contractor.findById(bid.contractor._id);
    const projectIndex = contractor.pastProjects.findIndex(
      p => p.bidId?.toString() === bid._id.toString()
    );
    if (projectIndex !== -1) {
      contractor.pastProjects[projectIndex].rating = averageScore;
      contractor.pastProjects[projectIndex].feedback = feedback;
      await contractor.save();
    }

    res.json({
      success: true,
      message: 'Contractor rated successfully',
      rating: bid.rating
    });
  } catch (error) {
    console.error('Rate contractor error:', error);
    res.status(500).json({
      success: false,
      message: 'Error rating contractor',
      error: error.message
    });
  }
});

// Get issues with contractor status
router.get('/issues-with-contractors', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const query = {
      'contractorAssignment.status': { $ne: 'none', $exists: true }
    };

    if (status) {
      query['contractorAssignment.status'] = status;
    }

    const issues = await Issue.find(query)
      .populate('contractorAssignment.acceptedContractor', 'name email phone statistics')
      .populate('contractorAssignment.acceptedBid', 'bidAmount completionDays status')
      .sort({ 'contractorAssignment.sentAt': -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Issue.countDocuments(query);

    res.json({
      success: true,
      issues,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Get issues with contractors error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching issues',
      error: error.message
    });
  }
});

module.exports = router;
