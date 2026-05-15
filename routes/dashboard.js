const express  = require('express');
const router   = express.Router();
const mongoose = require('mongoose');
const Device   = require('../models/Device');
const Customer = require('../models/Customer');
const User     = require('../models/User');
const { protect } = require('../middleware/auth');

// ════════════════════════════════════════════════════════════
//  GET /api/dashboard
// ════════════════════════════════════════════════════════════
router.get('/', protect, async (req, res) => {
  try {
    const isAdmin   = req.user.role === 'super_admin';
    const uid       = new mongoose.Types.ObjectId(req.user._id);
    const devQuery  = isAdmin ? {} : { retailerId: uid };
    const custQuery = isAdmin ? {} : { retailerId: uid };

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      totalDevices, activeDevices, lockedDevices, pendingDevices, todayEnrolled,
      totalCustomers, activeCustomers, overdueCustomers,
      retailer,
    ] = await Promise.all([
      Device.countDocuments(devQuery),
      Device.countDocuments({ ...devQuery, status: 'active' }),
      Device.countDocuments({ ...devQuery, isLocked: true }),
      Device.countDocuments({ ...devQuery, status: 'pending' }),
      Device.countDocuments({ ...devQuery, enrolledAt: { $gte: todayStart } }),
      Customer.countDocuments(custQuery),
      Customer.countDocuments({ ...custQuery, status: 'active' }),
      Customer.countDocuments({ ...custQuery, status: { $in: ['active','locked'] }, nextEmiDate: { $lt: new Date() } }),
      User.findById(req.user._id).select('androidBalance runningKeyBalance iphoneBalance'),
    ]);

    // Key breakdown
    const [androidStats, rkStats, iphoneStats] = await Promise.all([
      Device.aggregate([{ $match: { ...devQuery, keyType: 'android' } },      { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Device.aggregate([{ $match: { ...devQuery, keyType: 'running_key' } },  { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Device.aggregate([{ $match: { ...devQuery, keyType: 'iphone' } },       { $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);

    const fmt = (stats) => {
      const obj = { active: 0, locked: 0, removed: 0, pending: 0, unenrolled: 0 };
      stats.forEach(s => { if (s._id) obj[s._id] = s.count; });
      return obj;
    };

    // ── Hierarchy stats — ADMIN ONLY ─────────────────────────
    let hierarchyStats = null;
    if (isAdmin) {
      const [totalSuperDist, totalDistributors, totalSubDist, totalRetailers] = await Promise.all([
        User.countDocuments({ role: 'super_distributor', isDeleted: false }),
        User.countDocuments({ role: 'distributor',       isDeleted: false }),
        User.countDocuments({ role: 'sub_distributor',   isDeleted: false }),
        User.countDocuments({ role: 'retailer',          isDeleted: false }),
      ]);
      hierarchyStats = { totalSuperDist, totalDistributors, totalSubDist, totalRetailers };
    }

    res.json({
      success: true,
      stats: {
        totalDevices, activeDevices, lockedDevices, pendingDevices,
        todayEnrolled, totalCustomers, activeCustomers, overdueCustomers,
      },
      balance: {
        android:    retailer?.androidBalance    || 0,
        runningKey: retailer?.runningKeyBalance || 0,
        iphone:     retailer?.iphoneBalance     || 0,
      },
      keyDetails: {
        android:    { total: androidStats.reduce((a, b) => a + b.count, 0), ...fmt(androidStats) },
        runningKey: { total: rkStats.reduce((a, b) => a + b.count, 0),      ...fmt(rkStats) },
        iphone:     { total: iphoneStats.reduce((a, b) => a + b.count, 0),  ...fmt(iphoneStats) },
      },
      ...(hierarchyStats && { hierarchyStats }),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  GET /api/dashboard/monthly-registrations
//  ✅ SalesChart ke liye — last 12 months ka data
//  Returns: [ { month: "Jan", superDistributor, distributor, subDistributor, retailer } ]
// ════════════════════════════════════════════════════════════
router.get('/monthly-registrations', protect, async (req, res) => {
  try {
    const months = Number(req.query.months) || 12;
    const from   = new Date();
    from.setMonth(from.getMonth() - months + 1);
    from.setDate(1);
    from.setHours(0, 0, 0, 0);

    const pipeline = [
      { $match: { createdAt: { $gte: from }, isDeleted: false } },
      {
        $group: {
          _id: {
            year:  { $year:  '$createdAt' },
            month: { $month: '$createdAt' },
            role:  '$role',
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ];

    const raw = await User.aggregate(pipeline);

    // Build 12-month map
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const resultMap   = {};

    for (let i = 0; i < months; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() - (months - 1 - i));
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      resultMap[key] = {
        month:            MONTH_NAMES[d.getMonth()],
        year:             d.getFullYear(),
        superDistributor: 0,
        distributor:      0,
        subDistributor:   0,
        retailer:         0,
      };
    }

    raw.forEach(({ _id, count }) => {
      const key  = `${_id.year}-${_id.month}`;
      if (!resultMap[key]) return;
      const role = _id.role;
      if (role === 'super_distributor') resultMap[key].superDistributor += count;
      else if (role === 'distributor')  resultMap[key].distributor      += count;
      else if (role === 'sub_distributor') resultMap[key].subDistributor += count;
      else if (role === 'retailer')     resultMap[key].retailer         += count;
    });

    res.json({ success: true, data: Object.values(resultMap) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  GET /api/dashboard/key-summary
// ════════════════════════════════════════════════════════════
router.get('/key-summary', protect, async (req, res) => {
  try {
    const uid   = new mongoose.Types.ObjectId(req.user._id);
    const query = req.user.role === 'super_admin' ? {} : { retailerId: uid };

    const summary = await Device.aggregate([
      { $match: query },
      { $group: { _id: { keyType: '$keyType', status: '$status' }, count: { $sum: 1 } } },
      { $sort: { '_id.keyType': 1 } },
    ]);

    const formatted = {};
    summary.forEach(({ _id, count }) => {
      if (!formatted[_id.keyType]) formatted[_id.keyType] = {};
      formatted[_id.keyType][_id.status] = count;
    });

    res.json({ success: true, summary: formatted });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  GET /api/dashboard/stats — Quick counts
// ════════════════════════════════════════════════════════════
router.get('/stats', protect, async (req, res) => {
  try {
    const uid       = new mongoose.Types.ObjectId(req.user._id);
    const isAdmin   = req.user.role === 'super_admin';
    const devQuery  = isAdmin ? {} : { retailerId: uid };

    const [total, active, locked, pending] = await Promise.all([
      Device.countDocuments(devQuery),
      Device.countDocuments({ ...devQuery, status: 'active' }),
      Device.countDocuments({ ...devQuery, isLocked: true }),
      Device.countDocuments({ ...devQuery, status: 'pending' }),
    ]);

    res.json({ success: true, total, active, locked, pending });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
