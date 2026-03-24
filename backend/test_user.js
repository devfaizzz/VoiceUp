require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');

async function test() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/voiceup');
    const count = await User.countDocuments();
    console.log('Total Users:', count);
    process.exit();
}

test();
