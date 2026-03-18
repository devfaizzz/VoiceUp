const mongoose = require('mongoose');

const issueSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    maxlength: 2000
  },
  category: {
    type: String,
    required: true,
    enum: ['pothole', 'streetlight', 'garbage', 'water', 'sewage', 'traffic', 'other']
  },
  status: {
    type: String,
    default: 'new',
    enum: ['new', 'approved', 'rejected', 'hold', 'acknowledged', 'in_progress', 'resolved', 'closed']
  },
  priority: {
    type: String,
    default: 'medium',
    enum: ['low', 'medium', 'high', 'critical']
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      required: true
    },
    coordinates: {
      type: [Number],
      required: true
    },
    address: String,
    area: String,
    city: String,
    postalCode: String
  },
  images: [{
    url: String,
    publicId: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  audioRecording: {
    url: String,
    publicId: String,
    duration: Number,
    uploadedAt: Date
  },
  reportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  assignedTo: {
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department'
    },
    staff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    assignedAt: Date
  },
  aiClassification: {
    category: String,
    confidence: Number,
    suggestedPriority: String,
    processedAt: Date
  },
  timeline: [{
    status: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    notes: String
  }],
  resolution: {
    resolvedAt: Date,
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    resolutionNotes: String,
    resolutionImages: [{
      url: String,
      publicId: String
    }]
  },
  feedback: {
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    comment: String,
    submittedAt: Date
  },
  notifications: [{
    type: {
      type: String,
      enum: ['sms', 'email', 'push', 'in_app']
    },
    sentAt: Date,
    status: String,
    message: String
  }],
  viewCount: {
    type: Number,
    default: 0
  },
  upvotes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  comments: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    text: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  tags: [String],
  isPublic: {
    type: Boolean,
    default: true
  },
  metadata: {
    browser: String,
    device: String,
    ipAddress: String,
    userAgent: String
  },
  contractorAssignment: {
    status: {
      type: String,
      enum: ['none', 'sent_to_contractors', 'bidding_open', 'bid_accepted', 'work_in_progress', 'completed', 'payment_pending', 'paid'],
      default: 'none'
    },
    sentAt: Date,
    acceptedBid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bid'
    },
    acceptedContractor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contractor'
    },
    acceptedAt: Date,
    completedAt: Date,
    paidAt: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
issueSchema.index({ location: '2dsphere' });
issueSchema.index({ status: 1, priority: -1 });
issueSchema.index({ category: 1 });
issueSchema.index({ reportedBy: 1 });
issueSchema.index({ 'assignedTo.department': 1 });
issueSchema.index({ createdAt: -1 });
issueSchema.index({ 'contractorAssignment.status': 1 });

// Virtual for resolution time
issueSchema.virtual('resolutionTime').get(function() {
  if (this.resolution && this.resolution.resolvedAt) {
    return Math.floor((this.resolution.resolvedAt - this.createdAt) / (1000 * 60 * 60 * 24)); // in days
  }
  return null;
});

// Pre-save middleware to update timeline
issueSchema.pre('save', function(next) {
  if (this.isModified('status')) {
    this.timeline.push({
      status: this.status,
      timestamp: new Date()
    });
  }
  next();
});

// Static method to get issues near a location
issueSchema.statics.findNearby = function(coordinates, maxDistance = 5000) {
  return this.find({
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: coordinates
        },
        $maxDistance: maxDistance
      }
    }
  });
};

// Method to add a comment
issueSchema.methods.addComment = function(userId, text) {
  this.comments.push({
    user: userId,
    text: text
  });
  return this.save();
};

// Method to upvote
issueSchema.methods.toggleUpvote = function(userId) {
  const index = this.upvotes.indexOf(userId);
  if (index > -1) {
    this.upvotes.splice(index, 1);
  } else {
    this.upvotes.push(userId);
  }
  return this.save();
};

module.exports = mongoose.model('Issue', issueSchema);
