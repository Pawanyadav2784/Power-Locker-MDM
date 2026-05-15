const Device = require('../models/Device');
const Customer = require('../models/Customer');
const User = require('../models/User');

// @desc    Get dashboard stats
// @route   GET /api/dashboard
const getDashboard = async (req, res) => {
  try {
    const isAdmin = req.user.role === 'super_admin';
    const q = isAdmin ? {} : { retailerId: req.user._id };
    const cq = isAdmin ? {} : { retailerId: req.user._id };

    const [totalDevices, activeDevices, lockedDevices, todayEnrolled, totalCustomers] = await Promise.all([
      Device.countDocuments(q),
      Device.countDocuments({ ...q, status: 'active' }),
      Device.countDocuments({ ...q, isLocked: true }),
      Device.countDocuments({ ...q, enrolledAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
      Customer.countDocuments(cq),
    ]);

    const retailer = await User.findById(req.user._id).select('androidBalance runningKeyBalance iphoneBalance');

    const [androidStats, rkStats] = await Promise.all([
      Device.aggregate([{ $match: { ...q, keyType: 'android' } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Device.aggregate([{ $match: { ...q, keyType: 'running_key' } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);

    const fmt = (stats) => {
      const obj = { active: 0, locked: 0, removed: 0, pending: 0 };
      stats.forEach(s => { obj[s._id] = s.count; });
      return obj;
    };

    res.json({
      success: true,
      stats: { totalDevices, activeDevices, lockedDevices, todayEnrolled, totalCustomers },
      balance: { android: retailer.androidBalance, runningKey: retailer.runningKeyBalance, iphone: retailer.iphoneBalance },
      keyDetails: {
        android: { total: androidStats.reduce((a, b) => a + b.count, 0), ...fmt(androidStats) },
        runningKey: { total: rkStats.reduce((a, b) => a + b.count, 0), ...fmt(rkStats) },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Get key summary
// @route   GET /api/dashboard/key-summary
const getKeySummary = async (req, res) => {
  try {
    const q = req.user.role === 'super_admin' ? {} : { retailerId: req.user._id };
    const summary = await Device.aggregate([
      { $match: q },
      { $group: { _id: { keyType: '$keyType', status: '$status' }, count: { $sum: 1 } } },
    ]);
    res.json({ success: true, summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getDashboard, getKeySummary };
