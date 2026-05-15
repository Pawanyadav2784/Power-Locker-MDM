require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const seed = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');

  // Check if admin already exists
  const exists = await User.findOne({ email: 'admin@runningkey.com' });
  if (exists) {
    console.log('⚠️  Admin already exists:', exists.email);
    process.exit(0);
  }

  // Create Super Admin
  const admin = await User.create({
    name: 'Running Key Admin',
    email: 'admin@runningkey.com',
    password: 'Admin@2026',
    phone: '9999999999',
    role: 'super_admin',
    isActive: true,
    isVerified: true,
    androidBalance: 100,
    runningKeyBalance: 100,
    iphoneBalance: 0,
  });

  console.log('✅ Super Admin created!');
  console.log('   Email   :', admin.email);
  console.log('   Password: Admin@2026');
  console.log('   Role    :', admin.role);
  process.exit(0);
};

seed().catch(err => { console.error('❌ Seed error:', err.message); process.exit(1); });
