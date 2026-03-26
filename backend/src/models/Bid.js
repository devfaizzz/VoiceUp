const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema({
  issue: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Issue',
    required: true
  },
  contractor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contractor',
    required: true
  },
  bidAmount: {
    type: Number,
    required: true,
    min: 0
  },
  completionDays: {
    type: Number,
    required: true,
    min: 1
  },
  rawMaterialCost: {
    type: Number,
    min: 0,
    default: 0
  },
  completionDeadline: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'work_in_progress', 'completed', 'payment_requested', 'paid'],
    default: 'pending'
  },
  isAIRecommended: {
    type: Boolean,
    default: false
  },
  aiRecommendationReason: {
    type: String
  },
  aiScore: {
    type: Number,
    min: 0,
    max: 100
  },
  workProof: {
    beforeImages: [{
      url: String,
      publicId: String,
      uploadedAt: {
        type: Date,
        default: Date.now
      }
    }],
    afterImages: [{
      url: String,
      publicId: String,
      uploadedAt: {
        type: Date,
        default: Date.now
      }
    }],
    submittedAt: Date,
    contractorLocation: {
      type: {
        type: String,
        enum: ['Point']
      },
      coordinates: [Number]
    },
    notes: String,
    distanceFromIssue: Number,
    adminReview: {
      status: {
        type: String,
        enum: ['pending', 'verified', 'rejected'],
        default: 'pending'
      },
      verifiedAt: Date,
      verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      notes: String
    }
  },
  paymentRequest: {
    requestedAt: Date,
    contractorLocationAtRequest: {
      type: {
        type: String,
        enum: ['Point']
      },
      coordinates: [Number]
    },
    isWithinRadius: Boolean,
    distanceFromSite: Number,
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    processedAt: Date,
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  timeline: [{
    status: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    notes: String
  }],
  rating: {
    score: {
      type: Number,
      min: 1,
      max: 5
    },
    quality: {
      type: Number,
      min: 1,
      max: 5
    },
    timeliness: {
      type: Number,
      min: 1,
      max: 5
    },
    cost: {
      type: Number,
      min: 1,
      max: 5
    },
    feedback: String,
    ratedAt: Date,
    ratedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }
}, {
  timestamps: true
});

// Indexes
bidSchema.index({ issue: 1 });
bidSchema.index({ contractor: 1 });
bidSchema.index({ status: 1 });
bidSchema.index({ isAIRecommended: 1 });
bidSchema.index({ createdAt: -1 });

// Pre-save middleware to update timeline
bidSchema.pre('save', function(next) {
  if (this.isModified('status')) {
    this.timeline.push({
      status: this.status,
      timestamp: new Date()
    });
  }
  next();
});

// Static method to get bids for an issue with AI recommendation
bidSchema.statics.getBidsWithRecommendation = async function(issueId) {
  return this.find({ issue: issueId })
    .populate('contractor', 'name email phone gstNumber aadhaarNumber location statistics profilePicture')
    .sort({ isAIRecommended: -1, aiScore: -1, bidAmount: 1 });
};

// Static method to get contractor's active bids
bidSchema.statics.getContractorActiveBids = function(contractorId) {
  return this.find({
    contractor: contractorId,
    status: { $in: ['pending', 'accepted', 'work_in_progress'] }
  }).populate('issue', 'title description category location images priority');
};

// Method to accept bid
bidSchema.methods.acceptBid = async function() {
  this.status = 'accepted';
  
  // Reject all other bids for this issue
  await this.constructor.updateMany(
    { issue: this.issue, _id: { $ne: this._id }, status: 'pending' },
    { status: 'rejected' }
  );
  
  return this.save();
};

// Method to submit work proof
bidSchema.methods.submitWorkProof = function(beforeImages, afterImages, location, notes) {
  this.workProof = {
    beforeImages,
    afterImages,
    submittedAt: new Date(),
    contractorLocation: {
      type: 'Point',
      coordinates: location
    },
    notes
  };
  this.status = 'completed';
  return this.save();
};

// Method to request payment
bidSchema.methods.requestPayment = function(location, isWithinRadius, distance) {
  this.paymentRequest = {
    requestedAt: new Date(),
    contractorLocationAtRequest: {
      type: 'Point',
      coordinates: location
    },
    isWithinRadius,
    distanceFromSite: distance,
    status: 'pending'
  };
  this.status = 'payment_requested';
  return this.save();
};

module.exports = mongoose.model('Bid', bidSchema);
