require('dotenv').config();
const mongoose = require('mongoose');
const Issue = require('./src/models/Issue');

async function test() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/voiceup');
    const issues = await Issue.find({ reportedBy: { $ne: null } }).sort({ createdAt: -1 }).limit(5);
    console.log('Issues with valid reportedBy:');
    issues.forEach(i => {
        console.log(`- ID: ${i._id}, Title: ${i.title}, ReportedBy: ${i.reportedBy}, Status: ${i.status}`);
    });
    console.log('Done.');
    process.exit();
}

test();
