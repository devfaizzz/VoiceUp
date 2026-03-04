const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { generateToken, generateRefreshToken, verifyRefreshToken, authenticateToken } = require('../middleware/auth');

const ADMIN_EMAIL = 'faizk12312.fk@gmail.com';
const ADMIN_PASS = 'admin';

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ message: 'Missing fields' });
    }

    const existing = await User.findOne({ $or: [{ email }, { phone }] });
    if (existing) {
      return res.status(409).json({ message: 'User already exists' });
    }

    // Citizens only — admin is auto-seeded, never self-registered
    const user = await User.create({ name, email, phone, password, role: 'citizen' });
    const token = generateToken(user._id.toString(), user.role);
    const refreshToken = generateRefreshToken(user._id.toString());

    res.status(201).json({
      token,
      refreshToken,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ message: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    // Auto-seed admin on first login attempt
    if (email.toLowerCase() === ADMIN_EMAIL && password === ADMIN_PASS) {
      let adminUser = await User.findOne({ email: ADMIN_EMAIL });
      if (!adminUser) {
        // Use save() with validateBeforeSave:false to bypass minlength:6 on password
        adminUser = new User({
          name: 'Super Admin',
          email: ADMIN_EMAIL,
          phone: '0000000000',
          password: ADMIN_PASS,
          role: 'admin',
          isActive: true,
          isVerified: true
        });
        await adminUser.save({ validateBeforeSave: false });
      }
      // Verify password (handles case where admin already exists with hashed pass)
      const ok = await adminUser.comparePassword(password);
      if (!ok) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
      const token = generateToken(adminUser._id.toString(), adminUser.role);
      const refreshToken = generateRefreshToken(adminUser._id.toString());
      return res.json({
        token,
        refreshToken,
        user: { id: adminUser._id, name: adminUser.name, email: adminUser.email, role: adminUser.role }
      });
    }

    // Normal login flow for all other users
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

    const token = generateToken(user._id.toString(), user.role);
    const refreshToken = generateRefreshToken(user._id.toString());

    res.json({
      token,
      refreshToken,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Login failed' });
  }
});

// GET /api/auth/me — returns current user from token
router.get('/me', authenticateToken, (req, res) => {
  res.json({
    user: { id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role }
  });
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded) return res.status(401).json({ message: 'Invalid refresh token' });
  const user = await User.findById(decoded.userId);
  if (!user) return res.status(401).json({ message: 'User not found' });
  const token = generateToken(decoded.userId, user.role);
  res.json({ token });
});

module.exports = router;
