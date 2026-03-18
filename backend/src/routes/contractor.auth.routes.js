const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Contractor = require('../models/Contractor');
const upload = require('../middleware/upload');

// Generate JWT token for contractor
const generateContractorToken = (contractorId) => {
  return jwt.sign(
    { id: contractorId, type: 'contractor' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

// Generate refresh token
const generateRefreshToken = (contractorId) => {
  return jwt.sign(
    { id: contractorId, type: 'contractor' },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
};

// Contractor Signup
router.post('/signup', (req, res, next) => {
  // Try to upload file, but don't fail if upload provider is not configured
  upload.single('profilePicture')(req, res, (err) => {
    if (err) {
      console.error('File upload error (continuing without profile picture):', err);
      // Don't fail - just continue without the profile picture
      // The file won't be attached to req.file
    }
    next();
  });
}, async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      aadhaarNumber,
      gstNumber,
      address,
      latitude,
      longitude
    } = req.body;

    // Validate required fields
    if (!name || !email || !phone || !password || !aadhaarNumber || !gstNumber || !address) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required: name, email, phone, password, aadhaarNumber, gstNumber, address'
      });
    }

    // Validate Aadhaar number (12 digits)
    if (!/^\d{12}$/.test(aadhaarNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Aadhaar number must be exactly 12 digits'
      });
    }

    // Validate GST number (15 characters alphanumeric)
    if (!/^[0-9A-Z]{15}$/.test(gstNumber.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'GST number must be exactly 15 alphanumeric characters'
      });
    }

    // Validate location
    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Location (latitude and longitude) is required'
      });
    }

    // Check if contractor already exists
    const existingContractor = await Contractor.findOne({
      $or: [
        { email: email.toLowerCase() },
        { phone },
        { aadhaarNumber },
        { gstNumber: gstNumber.toUpperCase() }
      ]
    });

    if (existingContractor) {
      let field = 'Email';
      if (existingContractor.phone === phone) field = 'Phone number';
      else if (existingContractor.aadhaarNumber === aadhaarNumber) field = 'Aadhaar number';
      else if (existingContractor.gstNumber === gstNumber.toUpperCase()) field = 'GST number';
      
      return res.status(400).json({
        success: false,
        message: `${field} is already registered`
      });
    }

    // Prepare contractor data
    const contractorData = {
      name,
      email: email.toLowerCase(),
      phone,
      password,
      aadhaarNumber,
      gstNumber: gstNumber.toUpperCase(),
      address,
      location: {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)],
        address
      }
    };

    // Handle profile picture upload
    if (req.file) {
      contractorData.profilePicture = {
        url: req.file.path || req.file.location,
        publicId: req.file.filename || req.file.key
      };
    }

    // Create contractor
    const contractor = new Contractor(contractorData);
    await contractor.save();

    // Generate tokens
    const token = generateContractorToken(contractor._id);
    const refreshToken = generateRefreshToken(contractor._id);

    // Update last login
    contractor.lastLogin = new Date();
    await contractor.save();

    res.status(201).json({
      success: true,
      message: 'Contractor registered successfully',
      token,
      refreshToken,
      contractor: {
        id: contractor._id,
        name: contractor.name,
        email: contractor.email,
        phone: contractor.phone,
        gstNumber: contractor.gstNumber,
        address: contractor.address,
        profilePicture: contractor.profilePicture,
        location: contractor.location,
        statistics: contractor.statistics,
        isVerified: contractor.isVerified
      }
    });
  } catch (error) {
    console.error('Contractor signup error:', error);
    
    // Handle MongoDB duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        message: `${field} is already registered`
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }
    
    res.status(500).json({
      success: false,
      message: error.message || 'Error registering contractor'
    });
  }
});

// Contractor Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Find contractor
    const contractor = await Contractor.findOne({ email: email.toLowerCase() });

    if (!contractor) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check if account is locked
    if (contractor.isLocked) {
      return res.status(403).json({
        success: false,
        message: 'Account is temporarily locked. Please try again later.'
      });
    }

    // Check if account is active
    if (!contractor.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account has been deactivated. Please contact support.'
      });
    }

    // Verify password
    const isMatch = await contractor.comparePassword(password);

    if (!isMatch) {
      await contractor.incLoginAttempts();
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Reset login attempts on successful login
    await contractor.resetLoginAttempts();

    // Update last login
    contractor.lastLogin = new Date();
    await contractor.save();

    // Generate tokens
    const token = generateContractorToken(contractor._id);
    const refreshToken = generateRefreshToken(contractor._id);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      refreshToken,
      contractor: {
        id: contractor._id,
        name: contractor.name,
        email: contractor.email,
        phone: contractor.phone,
        gstNumber: contractor.gstNumber,
        aadhaarNumber: contractor.aadhaarNumber.slice(0, 4) + '****' + contractor.aadhaarNumber.slice(-4),
        address: contractor.address,
        profilePicture: contractor.profilePicture,
        location: contractor.location,
        statistics: contractor.statistics,
        isVerified: contractor.isVerified
      }
    });
  } catch (error) {
    console.error('Contractor login error:', error);
    res.status(500).json({
      success: false,
      message: 'Error logging in',
      error: error.message
    });
  }
});

// Get current contractor profile
router.get('/me', async (req, res) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.type !== 'contractor') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type'
      });
    }

    // Find contractor
    const contractor = await Contractor.findById(decoded.id).select('-password');

    if (!contractor) {
      return res.status(404).json({
        success: false,
        message: 'Contractor not found'
      });
    }

    res.json({
      success: true,
      contractor: {
        id: contractor._id,
        name: contractor.name,
        email: contractor.email,
        phone: contractor.phone,
        gstNumber: contractor.gstNumber,
        aadhaarNumber: contractor.aadhaarNumber.slice(0, 4) + '****' + contractor.aadhaarNumber.slice(-4),
        address: contractor.address,
        profilePicture: contractor.profilePicture,
        location: contractor.location,
        statistics: contractor.statistics,
        pastProjects: contractor.pastProjects,
        isVerified: contractor.isVerified,
        createdAt: contractor.createdAt
      }
    });
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    console.error('Get contractor profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching profile',
      error: error.message
    });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
    );

    if (decoded.type !== 'contractor') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type'
      });
    }

    // Find contractor
    const contractor = await Contractor.findById(decoded.id);

    if (!contractor || !contractor.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    // Generate new access token
    const newToken = generateContractorToken(contractor._id);

    res.json({
      success: true,
      token: newToken
    });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }
    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Error refreshing token',
      error: error.message
    });
  }
});

// Update contractor profile
router.put('/me', upload.single('profilePicture'), async (req, res) => {
  try {
    // Get token from header
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

    if (!contractor) {
      return res.status(404).json({
        success: false,
        message: 'Contractor not found'
      });
    }

    // Fields that can be updated
    const { name, phone, address, latitude, longitude } = req.body;

    if (name) contractor.name = name;
    if (phone) contractor.phone = phone;
    if (address) contractor.address = address;

    if (latitude && longitude) {
      contractor.location = {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)],
        address: address || contractor.address
      };
    }

    if (req.file) {
      contractor.profilePicture = {
        url: req.file.path || req.file.location,
        publicId: req.file.filename || req.file.key
      };
    }

    await contractor.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      contractor: {
        id: contractor._id,
        name: contractor.name,
        email: contractor.email,
        phone: contractor.phone,
        address: contractor.address,
        profilePicture: contractor.profilePicture,
        location: contractor.location
      }
    });
  } catch (error) {
    console.error('Update contractor profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile',
      error: error.message
    });
  }
});

module.exports = router;
