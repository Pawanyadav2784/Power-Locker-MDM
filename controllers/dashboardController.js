const Device   = require('../models/Device');
const Customer = require('../models/Customer');
const User     = require('../models/User');

// ── Date helpers ──────────────────────────────────────────
const startOfDay   = () => new Date(new Date().setHours(0, 0, 0, 0));
const startOfWeek  = () => {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay()); // Sunday
  d.setHours(0, 0, 0, 0);
  return d;
};
const startOfMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
};

// ─────────────────────────────────────────────────────────
// @route  GET /api/dashboard
// @desc   Super Admin - full dashboard data
// ─────────────────────────────────────────────────────────
const getDashboard = async (req, res) => {
  try {
    const isAdmin = req.user.role === 'super_admin';
    const devQ    = isAdmin ? {} : { retailerId: req.user._id };
    const cusQ    = isAdmin ? {} : { retailerId: req.user._id };

    // ── 1. User Role Counts ──────────────────────────────
    const [superDistributors, distributors, subDistributors, retailers] = await Promise.all([
      User.countDocuments({ role: 'super_distributor', isDeleted: false }),
      User.countDocuments({ role: 'distributor',       isDeleted: false }),
      User.countDocuments({ role: 'sub_distributor',   isDeleted: false }),
      User.countDocuments({ role: 'retailer',          isDeleted: false }),
    ]);

    // ── 2. Device Stats ───────────────────────────────────
    const [totalDevices, activeDevices, lockedDevices, todayEnrolled] = await Promise.all([
      Device.countDocuments(devQ),
      Device.countDocuments({ ...devQ, status: 'active' }),
      Device.countDocuments({ ...devQ, isLocked: true }),
      Device.countDocuments({ ...devQ, enrolledAt: { $gte: startOfDay() } }),
    ]);

    // ── 3. Customer Status Breakdown ─────────────────────
    const customerStatusAgg = await Customer.aggregate([
      { $match: cusQ },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const customerStatus = { total: 0, active: 0, pending: 0, removed: 0, locked: 0, completed: 0, defaulted: 0, closed: 0 };
    customerStatusAgg.forEach(s => {
      customerStatus[s._id] = s.count;
      customerStatus.total += s.count;
    });

    // ── 4. Customer Key Usage (by time range) ─────────────
    const keyUsageByRange = async (matchExtra = {}) => {
      const agg = await Customer.aggregate([
        { $match: { ...cusQ, ...matchExtra } },
        { $group: { _id: '$keyType', count: { $sum: 1 } } },
      ]);
      const result = { total: 0, new_key: 0, running_key: 0, iphone_key: 0 };
      agg.forEach(s => {
        result[s._id] = s.count;
        result.total += s.count;
      });
      return result;
    };

    const [keyUsageAll, keyUsageToday, keyUsageWeek, keyUsageMonth] = await Promise.all([
      keyUsageByRange(),
      keyUsageByRange({ createdAt: { $gte: startOfDay() } }),
      keyUsageByRange({ createdAt: { $gte: startOfWeek() } }),
      keyUsageByRange({ createdAt: { $gte: startOfMonth() } }),
    ]);

    // ── 5. Top 10 Retailers by Customer Count ─────────────
    const top10Retailers = await Customer.aggregate([
      ...(isAdmin ? [] : [{ $match: cusQ }]),
      { $group: { _id: '$retailerId', customerCount: { $sum: 1 } } },
      { $sort:  { customerCount: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from:         'users',
          localField:   '_id',
          foreignField: '_id',
          as:           'retailer',
        },
      },
      { $unwind: { path: '$retailer', preserveNullAndEmpty: true } },
      {
        $project: {
          _id:           1,
          customerCount: 1,
          name:          '$retailer.name',
          phone:         '$retailer.phone',
          city:          '$retailer.city',
          company:       '$retailer.company',
        },
      },
    ]);

    // ── 6. Device Model Breakdown ─────────────────────────
    const deviceModelAgg = await Device.aggregate([
      { $match: devQ },
      {
        $group: {
          _id:   {
            brand: { $ifNull: [{ $trim: { input: { $toUpper: '$brand' } } }, 'Unknown'] },
            model: { $ifNull: [{ $trim: { input: '$model' } }, 'Unknown'] },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 20 },
      {
        $project: {
          brand: '$_id.brand',
          model: '$_id.model',
          count: 1,
          _id:   0,
        },
      },
    ]);

    // Brand-level summary
    const brandSummary = {};
    deviceModelAgg.forEach(d => {
      const b = d.brand || 'Unknown';
      if (!brandSummary[b]) brandSummary[b] = 0;
      brandSummary[b] += d.count;
    });
    const deviceBrands = Object.entries(brandSummary)
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => b.count - a.count);

    // ── 7. Monthly Registrations (last 12 months) ─────────
    const monthlyAgg = await User.aggregate([
      {
        $match: {
          isDeleted: false,
          role: { $in: ['super_distributor', 'distributor', 'sub_distributor', 'retailer'] },
          createdAt: { $gte: new Date(new Date().setFullYear(new Date().getFullYear() - 1)) },
        },
      },
      {
        $group: {
          _id: {
            year:  { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            role:  '$role',
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // ── 8. Key Balance Summary (admin sees all) ────────────
    let balanceSummary = null;
    if (isAdmin) {
      const balAgg = await User.aggregate([
        { $match: { isDeleted: false, role: { $in: ['retailer', 'sub_distributor', 'distributor', 'super_distributor'] } } },
        {
          $group: {
            _id:                  null,
            totalAndroid:         { $sum: '$androidBalance' },
            totalRunningKey:      { $sum: '$runningKeyBalance' },
            totalIphone:          { $sum: '$iphoneBalance' },
          },
        },
      ]);
      balanceSummary = balAgg[0] || { totalAndroid: 0, totalRunningKey: 0, totalIphone: 0 };
    } else {
      const retailer = await User.findById(req.user._id).select('androidBalance runningKeyBalance iphoneBalance');
      balanceSummary = {
        totalAndroid:    retailer?.androidBalance    || 0,
        totalRunningKey: retailer?.runningKeyBalance || 0,
        totalIphone:     retailer?.iphoneBalance     || 0,
      };
    }

    // ── 9. Key Type usage on devices ─────────────────────
    const [androidStats, rkStats, iphoneStats] = await Promise.all([
      Device.aggregate([{ $match: { ...devQ, keyType: { $in: ['android', 'new_key'] } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Device.aggregate([{ $match: { ...devQ, keyType: 'running_key' } },                   { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Device.aggregate([{ $match: { ...devQ, keyType: { $in: ['iphone', 'iphone_key'] } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);

    const fmtStatus = (stats) => {
      const obj = { active: 0, locked: 0, removed: 0, pending: 0 };
      stats.forEach(s => { if (s._id) obj[s._id] = s.count; });
      return obj;
    };
    const androidDetails    = { total: androidStats.reduce((a, b) => a + b.count, 0),  ...fmtStatus(androidStats) };
    const runningKeyDetails = { total: rkStats.reduce((a, b) => a + b.count, 0),       ...fmtStatus(rkStats) };
    const iphoneDetails     = { total: iphoneStats.reduce((a, b) => a + b.count, 0),   ...fmtStatus(iphoneStats) };
    const totalUsed         = androidDetails.total + runningKeyDetails.total + iphoneDetails.total;

    // ── Final Response ────────────────────────────────────
    res.json({
      success: true,

      // Counts
      userCounts: { superDistributors, distributors, subDistributors, retailers },
      stats:      { totalDevices, activeDevices, lockedDevices, todayEnrolled, totalCustomers: customerStatus.total },

      // Customer
      customerStatus,

      // Customer Key Usage by time period
      customerKeyUsage: {
        all:       keyUsageAll,
        today:     keyUsageToday,
        thisWeek:  keyUsageWeek,
        thisMonth: keyUsageMonth,
      },

      // Top 10 performers (retailer with most customers)
      top10Retailers,

      // Device models breakdown
      deviceModels:  deviceModelAgg,
      deviceBrands,

      // Monthly registrations raw data
      monthlyRegistrations: monthlyAgg,

      // Key balances
      balance: balanceSummary,

      // Device key type breakdown
      keyDetails: {
        android:    androidDetails,
        runningKey: runningKeyDetails,
        iphone:     iphoneDetails,
        totalUsed,
      },
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────
// @route  GET /api/dashboard/key-summary
// ─────────────────────────────────────────────────────────
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
