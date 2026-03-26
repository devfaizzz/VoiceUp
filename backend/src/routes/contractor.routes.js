const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Contractor = require('../models/Contractor');
const Bid = require('../models/Bid');
const Issue = require('../models/Issue');
const upload = require('../middleware/upload');
const { isWithinRadius, calculateDistance } = require('../utils/locationUtils');

// Middleware to authenticate contractor
const authenticateContractor = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.type !== 'contractor') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type'
      });
    }

    const contractor = await Contractor.findById(decoded.id);
    if (!contractor || !contractor.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Contractor not found or inactive'
      });
    }

    req.contractor = contractor;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Authentication error',
      error: error.message
    });
  }
};

// Get available issues for bidding (sent to contractors)
router.get('/available-issues', authenticateContractor, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const query = {
      $or: [
        { 'contractorAssignment.status': { $in: ['sent_to_contractors', 'bidding_open'] } },
        { status: 'approved', 'contractorAssignment.status': 'none' }
      ]
    };

    // Find issues that have been sent to contractors or are newly approved
    const issues = await Issue.find(query)
      .sort({ 'contractorAssignment.sentAt': -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .select('title description category priority location images createdAt contractorAssignment');

    // Check if contractor has already bid on each issue
    const issuesWithBidStatus = await Promise.all(
      issues.map(async (issue) => {
        const existingBid = await Bid.findOne({
          issue: issue._id,
          contractor: req.contractor._id
        });
        return {
          ...issue.toObject(),
          hasBid: !!existingBid,
          bidId: existingBid?._id,
          bidStatus: existingBid?.status
        };
      })
    );

    const total = await Issue.countDocuments(query);

    res.json({
      success: true,
      issues: issuesWithBidStatus,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Get available issues error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching available issues',
      error: error.message
    });
  }
});

// Submit a bid for an issue
router.post('/bid', authenticateContractor, async (req, res) => {
  try {
    const { issueId, bidAmount, completionDays, completionDeadline, rawMaterialCost } = req.body;

    // Validate required fields
    if (!issueId || !bidAmount || !completionDays || !completionDeadline) {
      return res.status(400).json({
        success: false,
        message: 'Issue ID, bid amount, completion days, and deadline are required'
      });
    }

    // Check if issue exists and is open for bidding
    const issue = await Issue.findById(issueId);
    if (!issue) {
      return res.status(404).json({
        success: false,
        message: 'Issue not found'
      });
    }

    const caStatus = issue.contractorAssignment?.status || 'none';
    const isOpenForBidding = ['sent_to_contractors', 'bidding_open'].includes(caStatus) || 
                             (issue.status === 'approved' && caStatus === 'none');

    if (!isOpenForBidding) {
      return res.status(400).json({
        success: false,
        message: 'This issue is not open for bidding'
      });
    }

    // Check if contractor has already bid
    const existingBid = await Bid.findOne({
      issue: issueId,
      contractor: req.contractor._id
    });

    if (existingBid) {
      return res.status(400).json({
        success: false,
        message: 'You have already placed a bid on this issue'
      });
    }

    // Create bid
    const bid = new Bid({
      issue: issueId,
      contractor: req.contractor._id,
      bidAmount: parseFloat(bidAmount),
      completionDays: parseInt(completionDays),
      completionDeadline: new Date(completionDeadline),
      rawMaterialCost: rawMaterialCost ? parseFloat(rawMaterialCost) : 0,
      status: 'pending'
    });

    await bid.save();

    // Update contractor statistics
    req.contractor.statistics.totalBids += 1;
    await req.contractor.save();

    // Ensure the admin panel can surface the bids action once any bid exists.
    const contractorAssignment = issue.contractorAssignment || {};
    if (contractorAssignment.status === 'sent_to_contractors' || contractorAssignment.status === 'none' || !contractorAssignment.status) {
      contractorAssignment.status = 'bidding_open';
      contractorAssignment.sentAt = contractorAssignment.sentAt || new Date();
      issue.contractorAssignment = contractorAssignment;
      await issue.save();
    }

    // Emit socket event for admin room
    if (req.app.get('io')) {
      req.app.get('io').to('admins').emit('new_bid_submitted', {
        issueId,
        bidId: bid._id,
        contractorName: req.contractor.name,
        bidAmount: bid.bidAmount,
        completionDays: bid.completionDays,
        rawMaterialCost: bid.rawMaterialCost
      });
    }

    res.status(201).json({
      success: true,
      message: 'Bid submitted successfully',
      bid: {
        id: bid._id,
        issueId: bid.issue,
        bidAmount: bid.bidAmount,
        completionDays: bid.completionDays,
        completionDeadline: bid.completionDeadline,
        status: bid.status
      }
    });
  } catch (error) {
    console.error('Submit bid error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting bid',
      error: error.message
    });
  }
});

// Get contractor's bids
router.get('/my-bids', authenticateContractor, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;

    const query = { contractor: req.contractor._id };
    if (status) {
      query.status = status;
    }

    const bids = await Bid.find(query)
      .populate('issue', 'title description category priority location images status')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Bid.countDocuments(query);

    res.json({
      success: true,
      bids,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Get my bids error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching bids',
      error: error.message
    });
  }
});

// Get accepted bids (projects)
router.get('/accepted-bids', authenticateContractor, async (req, res) => {
  try {
    const bids = await Bid.find({
      contractor: req.contractor._id,
      status: { $in: ['accepted', 'work_in_progress', 'completed', 'payment_requested', 'paid'] }
    })
      .populate('issue', 'title description category priority location images status contractorAssignment')
      .sort({ updatedAt: -1 });

    res.json({
      success: true,
      bids
    });
  } catch (error) {
    console.error('Get accepted bids error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching accepted bids',
      error: error.message
    });
  }
});

// Get single bid details
router.get('/bid/:bidId', authenticateContractor, async (req, res) => {
  try {
    const bid = await Bid.findOne({
      _id: req.params.bidId,
      contractor: req.contractor._id
    }).populate('issue', 'title description category priority location images status contractorAssignment');

    if (!bid) {
      return res.status(404).json({
        success: false,
        message: 'Bid not found'
      });
    }

    res.json({
      success: true,
      bid
    });
  } catch (error) {
    console.error('Get bid details error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching bid details',
      error: error.message
    });
  }
});

// Start work on accepted bid
router.post('/bid/:bidId/start-work', authenticateContractor, async (req, res) => {
  try {
    const bid = await Bid.findOne({
      _id: req.params.bidId,
      contractor: req.contractor._id,
      status: 'accepted'
    });

    if (!bid) {
      return res.status(404).json({
        success: false,
        message: 'Accepted bid not found'
      });
    }

    bid.status = 'work_in_progress';
    await bid.save();

    // Update issue status
    await Issue.findByIdAndUpdate(bid.issue, {
      'contractorAssignment.status': 'work_in_progress'
    });

    res.json({
      success: true,
      message: 'Work started successfully',
      bid
    });
  } catch (error) {
    console.error('Start work error:', error);
    res.status(500).json({
      success: false,
      message: 'Error starting work',
      error: error.message
    });
  }
});

// Submit work completion with before/after images + location verification
router.post('/bid/:bidId/complete', authenticateContractor, upload.fields([
  { name: 'beforeImages', maxCount: 3 },
  { name: 'afterImages', maxCount: 3 }
]), async (req, res) => {
  try {
    const { latitude, longitude, notes } = req.body;

    // Location is REQUIRED for completion
    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Current location (latitude, longitude) is required to submit completion'
      });
    }

    const bid = await Bid.findOne({
      _id: req.params.bidId,
      contractor: req.contractor._id,
      status: { $in: ['accepted', 'work_in_progress'] }
    }).populate('issue', 'location');

    if (!bid) {
      return res.status(404).json({
        success: false,
        message: 'Active bid not found'
      });
    }

    // Validate 500m radius from issue location using Haversine
    const contractorCoords = [parseFloat(longitude), parseFloat(latitude)];
    const issueCoords = bid.issue.location.coordinates;
    const distance = calculateDistance(contractorCoords, issueCoords);

    if (distance > 500) {
      return res.status(400).json({
        success: false,
        message: 'You are not at the report location. Please try again from the correct site.',
        distance: Math.round(distance),
        requiredRadius: 500
      });
    }

    // Process uploaded images
    const beforeImages = (req.files?.beforeImages || []).map(file => ({
      url: file.path || file.location,
      publicId: file.filename || file.key
    }));

    const afterImages = (req.files?.afterImages || []).map(file => ({
      url: file.path || file.location,
      publicId: file.filename || file.key
    }));

    if (beforeImages.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one before image is required'
      });
    }

    if (afterImages.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one after image is required'
      });
    }

    // Submit work proof
    bid.workProof = {
      beforeImages,
      afterImages,
      submittedAt: new Date(),
      contractorLocation: {
        type: 'Point',
        coordinates: contractorCoords
      },
      notes,
      distanceFromIssue: Math.round(distance),
      adminReview: {
        status: 'pending'
      }
    };
    bid.status = 'completed';
    await bid.save();

    // Update issue status
    await Issue.findByIdAndUpdate(bid.issue._id, {
      'contractorAssignment.status': 'completed',
      'contractorAssignment.completedAt': new Date(),
      'citizenFeedback.status': 'none'
    });

    // Update contractor statistics
    req.contractor.statistics.completedProjects += 1;
    await req.contractor.save();

    // Emit socket event to admins room
    if (req.app.get('io')) {
      req.app.get('io').to('admins').emit('work:completed', {
        issueId: bid.issue._id,
        bidId: bid._id,
        contractorName: req.contractor.name,
        completedAt: new Date(),
        distance: Math.round(distance)
      });
    }

    res.json({
      success: true,
      message: 'Work completed successfully. Location verified.',
      bid,
      locationVerification: {
        distance: Math.round(distance),
        withinRadius: true
      }
    });
  } catch (error) {
    console.error('Complete work error:', error);
    res.status(500).json({
      success: false,
      message: 'Error completing work',
      error: error.message
    });
  }
});

// Request payment (with location verification)
router.post('/bid/:bidId/request-payment', authenticateContractor, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Current location (latitude, longitude) is required'
      });
    }

    const bid = await Bid.findOne({
      _id: req.params.bidId,
      contractor: req.contractor._id,
      status: 'completed'
    }).populate('issue', 'location');

    if (!bid) {
      return res.status(404).json({
        success: false,
        message: 'Completed bid not found'
      });
    }

    const contractorCoords = [parseFloat(longitude), parseFloat(latitude)];
    const issueCoords = bid.issue.location.coordinates;

    // Calculate distance and check if within 500m radius
    const distance = calculateDistance(contractorCoords, issueCoords);
    const withinRadius = isWithinRadius(contractorCoords, issueCoords, 500);

    if (!withinRadius) {
      return res.status(400).json({
        success: false,
        message: `You must be within 500 meters of the work site to request payment. Current distance: ${Math.round(distance)} meters`,
        distance: Math.round(distance),
        requiredRadius: 500
      });
    }

    // Process payment request
    bid.paymentRequest = {
      requestedAt: new Date(),
      contractorLocationAtRequest: {
        type: 'Point',
        coordinates: contractorCoords
      },
      isWithinRadius: true,
      distanceFromSite: Math.round(distance),
      status: 'pending'
    };
    bid.status = 'payment_requested';
    await bid.save();

    // Update issue status
    await Issue.findByIdAndUpdate(bid.issue._id, {
      'contractorAssignment.status': 'payment_pending'
    });

    res.json({
      success: true,
      message: 'Payment request submitted successfully',
      paymentRequest: {
        bidId: bid._id,
        distanceFromSite: Math.round(distance),
        requestedAt: bid.paymentRequest.requestedAt,
        status: 'pending'
      }
    });
  } catch (error) {
    console.error('Request payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error requesting payment',
      error: error.message
    });
  }
});

// Get contractor dashboard stats
router.get('/dashboard-stats', authenticateContractor, async (req, res) => {
  try {
    const contractor = req.contractor;

    // Get bid counts by status
    const bidStats = await Bid.aggregate([
      { $match: { contractor: contractor._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const stats = {
      totalBids: contractor.statistics.totalBids,
      acceptedBids: contractor.statistics.acceptedBids,
      completedProjects: contractor.statistics.completedProjects,
      averageRating: contractor.statistics.averageRating,
      pendingBids: 0,
      activeProjects: 0,
      paymentPending: 0
    };

    bidStats.forEach(stat => {
      if (stat._id === 'pending') stats.pendingBids = stat.count;
      if (['accepted', 'work_in_progress'].includes(stat._id)) stats.activeProjects += stat.count;
      if (stat._id === 'payment_requested') stats.paymentPending = stat.count;
    });

    // Get recent activity
    const recentBids = await Bid.find({ contractor: contractor._id })
      .populate('issue', 'title category')
      .sort({ updatedAt: -1 })
      .limit(5);

    res.json({
      success: true,
      stats,
      recentBids,
      contractor: {
        name: contractor.name,
        rating: contractor.statistics.averageRating,
        completedProjects: contractor.statistics.completedProjects,
        isVerified: contractor.isVerified
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard stats',
      error: error.message
    });
  }
});

module.exports = router;
