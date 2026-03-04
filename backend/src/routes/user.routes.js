const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');
const Issue = require('../models/Issue');

// Badge tier helper
function getBadge(totalReports) {
  if (totalReports >= 100) return { label: 'GOD', emoji: '⚡', color: '#F59E0B' };
  if (totalReports >= 80) return { label: 'Knight', emoji: '🛡️', color: '#8B5CF6' };
  if (totalReports >= 50) return { label: 'Superman', emoji: '🦸', color: '#3B82F6' };
  if (totalReports >= 25) return { label: 'Warrior', emoji: '⚔️', color: '#EF4444' };
  if (totalReports >= 10) return { label: 'Saviour', emoji: '🌟', color: '#10B981' };
  return { label: 'Newcomer', emoji: '👋', color: '#6B7280' };
}

// GET /api/users/me — full profile + coins + badge + stats
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -verificationToken -resetPasswordToken -resetPasswordExpire -loginAttempts -lockUntil -deviceTokens');
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Count issues for this user
    const totalReports = await Issue.countDocuments({ reportedBy: req.user.id });
    const resolvedReports = await Issue.countDocuments({ reportedBy: req.user.id, status: { $in: ['resolved', 'closed'] } });
    const approvedReports = await Issue.countDocuments({ reportedBy: req.user.id, status: 'approved' });

    // Update statistics in DB if changed
    if (user.statistics.totalReports !== totalReports) {
      user.statistics.totalReports = totalReports;
      user.statistics.resolvedReports = resolvedReports;
      await user.save();
    }

    const badge = getBadge(totalReports);

    res.json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        profile: user.profile,
        voiceCoins: user.voiceCoins || 0,
        preferences: user.preferences,
        isVerified: user.isVerified,
        createdAt: user.createdAt,
        statistics: {
          totalReports,
          resolvedReports,
          approvedReports,
        },
        badge
      }
    });
  } catch (err) {
    console.error('GET /users/me error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/users/me — update profile fields
router.put('/me', authenticateToken, async (req, res) => {
  try {
    const { name, phone, bio, city, state, address, postalCode, preferences } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (name) user.name = name;
    if (phone) user.phone = phone;
    if (bio !== undefined) user.profile.bio = bio;
    if (city !== undefined) user.profile.city = city;
    if (state !== undefined) user.profile.state = state;
    if (address !== undefined) user.profile.address = address;
    if (postalCode !== undefined) user.profile.postalCode = postalCode;
    if (preferences) {
      if (preferences.notifications) user.preferences.notifications = { ...user.preferences.notifications, ...preferences.notifications };
      if (preferences.language) user.preferences.language = preferences.language;
    }

    await user.save();
    res.json({ message: 'Profile updated', user: { name: user.name, phone: user.phone, profile: user.profile } });
  } catch (err) {
    console.error('PUT /users/me error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
