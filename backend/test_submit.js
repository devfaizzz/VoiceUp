require('dotenv').config();
const { generateToken } = require('./src/middleware/auth');
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Issue = require('./src/models/Issue');
const axios = require('axios');

async function test() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/voiceup');

    // Find or create a user
    let user = await User.findOne();
    if (!user) {
        user = await User.create({ name: 'Test User', email: 'test@voiceup.test', role: 'citizen', password: 'abc', isActive: true });
    }

    // Generate token
    const token = generateToken(user._id.toString(), user.role);
    console.log('Using Token for User:', user._id.toString());

    // Make request to backend POST /api/issues
    try {
        const res = await axios.post('http://localhost:5000/api/issues', {
            title: 'TEST HTTP REQUEST',
            description: 'Testing if auth attaches',
            category: 'other',
            latitude: '28.61',
            longitude: '77.20',
            address: 'Delhi'
        }, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log('Response Status:', res.status);
        console.log('Response Body:', res.data);

        // Look it up in DB
        const issue = await Issue.findById(res.data.id);
        console.log('Issue in DB reportedBy:', issue.reportedBy);

    } catch (err) {
        console.error('API Error:', err.response?.data || err.message);
    }

    process.exit();
}

test();
