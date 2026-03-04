/**
 * Seed script — creates the admin user if it doesn't exist.
 * Run once: node src/seed.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const ADMIN_EMAIL = 'faizk12312.fk@gmail.com';
const ADMIN_PASS = 'admin';

async function seed() {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/civic-issue-tracker';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    const exists = await User.findOne({ email: ADMIN_EMAIL });
    if (exists) {
        console.log('Admin user already exists — skipping.');
    } else {
        await User.create({
            name: 'Super Admin',
            email: ADMIN_EMAIL,
            phone: '0000000000',
            password: ADMIN_PASS, // hashed by pre-save hook
            role: 'admin',
            isActive: true,
            isVerified: true
        });
        console.log('Admin user created successfully.');
    }

    await mongoose.disconnect();
    process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
