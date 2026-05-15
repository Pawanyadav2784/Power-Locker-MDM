// ─────────────────────────────────────────────────────────────
//  createAdmin.js  —  Super Admin account banana
//  Run: node createAdmin.js
// ─────────────────────────────────────────────────────────────
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const User     = require('./models/User');

const ADMIN = {
  name:     'Power Locker Admin',
  email:    'admin@powerlocker.com',
  password: 'PowerLocker@2026',
  phone:    '9999999999',
  role:     'super_admin',
  isActive: true,
};

async function createAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');

    const existing = await User.findOne({ email: ADMIN.email });
    if (existing) {
      console.log('⚠️  Admin already exists!');
      console.log(`   Email   : ${ADMIN.email}`);
      console.log(`   Role    : ${existing.role}`);
      await mongoose.disconnect();
      return;
    }

    const hashed = await bcrypt.hash(ADMIN.password, 12);
    const admin  = await User.create({
      ...ADMIN,
      password:          hashed,
      androidBalance:    999999,
      runningKeyBalance: 999999,
      iphoneBalance:     999999,
    });

    console.log('\n🎉 Super Admin created!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  📧 Email    : ${ADMIN.email}`);
    console.log(`  🔑 Password : ${ADMIN.password}`);
    console.log(`  👑 Role     : ${admin.role}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    await mongoose.disconnect();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

createAdmin();
