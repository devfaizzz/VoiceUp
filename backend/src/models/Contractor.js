const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const contractorSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  aadhaarNumber: {
    type: String,
    required: true,
    unique: true
  },
  gstNumber: {
    type: String,
    required: true,
    unique: true
  },
  address: {
    type: String,
    required: true
  },
  profilePicture: {
    url: String,
    publicId: String
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      required: true
    },
    address: String
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  statistics: {
    totalBids: {
      type: Number,
      default: 0
    },
    acceptedBids: {
      type: Number,
      default: 0
    },
    completedProjects: {
      type: Number,
      default: 0
    },
    averageRating: {
      type: Number,
      default: 0
    },
    totalRatings: {
      type: Number,
      default: 0
    }
  },
  pastProjects: [{
    issueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Issue'
    },
    bidId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bid'
    },
    completedAt: Date,
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    feedback: String
  }],
  lastLogin: Date,
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: Date
}, {
  timestamps: true
});

// Indexes
contractorSchema.index({ email: 1 });
contractorSchema.index({ phone: 1 });
contractorSchema.index({ aadhaarNumber: 1 });
contractorSchema.index({ gstNumber: 1 });
contractorSchema.index({ location: '2dsphere' });

// Hash password before saving
contractorSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
contractorSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Check if account is locked
contractorSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Increment login attempts
contractorSchema.methods.incLoginAttempts = function() {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };
  const maxAttempts = 5;
  const lockTime = 2 * 60 * 60 * 1000; // 2 hours

  if (this.loginAttempts + 1 >= maxAttempts && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + lockTime };
  }

  return this.updateOne(updates);
};

// Reset login attempts
contractorSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 }
  });
};

// Update rating after project completion
contractorSchema.methods.updateRating = function(newRating) {
  const totalRatings = this.statistics.totalRatings;
  const currentAvg = this.statistics.averageRating;
  
  const newTotal = totalRatings + 1;
  const newAvg = ((currentAvg * totalRatings) + newRating) / newTotal;
  
  this.statistics.averageRating = Math.round(newAvg * 10) / 10;
  this.statistics.totalRatings = newTotal;
  
  return this.save();
};

// Get success rate
contractorSchema.virtual('successRate').get(function() {
  if (this.statistics.acceptedBids === 0) return 0;
  return Math.round((this.statistics.completedProjects / this.statistics.acceptedBids) * 100);
});

module.exports = mongoose.model('Contractor', contractorSchema);
