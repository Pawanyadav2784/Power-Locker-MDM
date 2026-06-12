const mongoose = require('mongoose');
const AppUpdate = require('../models/AppUpdate');
const Banner = require('../models/Banner');
const Customer = require('../models/Customer');
const Device = require('../models/Device');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const { absoluteUrl, statusBucket } = require('../utils/pLockerCompatibility');
const { createQrImageUrl, getPublicOrigin } = require('../utils/deviceQr');

const ACTIVE_CUSTOMER_STATUSES = ['active', 'locked'];

function emptyKeyStats() {
  return {
    total: 0,
    active: 0,
    locked: 0,
    removed: 0,
    pending: 0,
    expired: 0,
    unenrolled: 0,
  };
}

function addDeviceRow(target, row) {
  const count = Number(row.count) || 0;
  const status = row._id.status;
  const locked = Boolean(row._id.isLocked) || status === 'locked';

  target.total += count;
  if (locked) target.locked += count;
  else if (status === 'active') target.active += count;
  else if (['removed', 'released'].includes(status)) target.removed += count;
  else if (status === 'expired') target.expired += count;
  else if (status === 'unenrolled') target.unenrolled += count;
  else target.pending += count;
}

function buildDeviceStats(rows = []) {
  const android = emptyKeyStats();
  const running = emptyKeyStats();
  const iphone = emptyKeyStats();
  const legacy = {};

  for (const row of rows) {
    const keyType = row._id.keyType || 'running_key';
    const status = row._id.status || 'pending';
    if (!legacy[keyType]) legacy[keyType] = {};
    legacy[keyType][status] = (legacy[keyType][status] || 0) + (Number(row.count) || 0);

    if (['new_key', 'android'].includes(keyType)) addDeviceRow(android, row);
    else if (['iphone_key', 'iphone'].includes(keyType)) addDeviceRow(iphone, row);
    else addDeviceRow(running, row);
  }

  return { android, running, iphone, legacy };
}

function toPLockerKeyStats(stats) {
  return {
    active: stats.active,
    lock: stats.locked,
    remove: stats.removed,
    pending: stats.pending,
  };
}

function buildUsageSummary(deviceStats, balance) {
  const usedKeys = deviceStats.android.total
    + deviceStats.running.total
    + deviceStats.iphone.total;
  const totalKeys = usedKeys + balance;

  return {
    totalKeys,
    usedKeys,
    availableKeys: balance,
    totalUsageLimit: totalKeys,
    totalUsed: usedKeys,
    totalBalance: balance,
    usagePercentage: totalKeys ? Math.round((usedKeys / totalKeys) * 100) : 0,
  };
}

function emptyVendorType() {
  return { total: 0, active: 0, inactive: 0, deleted: 0 };
}

function buildVendorStats(users = []) {
  const byType = {
    distributor: emptyVendorType(),
    sub_distributor: emptyVendorType(),
    vendor: emptyVendorType(),
    retailer: emptyVendorType(),
  };
  const roleMap = {
    distributor: 'distributor',
    sub_distributor: 'sub_distributor',
    super_distributor: 'vendor',
    retailer: 'retailer',
  };

  for (const user of users) {
    const bucket = byType[roleMap[user.role]];
    if (!bucket) continue;
    bucket.total += 1;
    if (user.isDeleted) bucket.deleted += 1;
    else if (user.isActive) bucket.active += 1;
    else bucket.inactive += 1;
  }

  const summary = Object.values(byType).reduce(
    (result, bucket) => ({
      total: result.total + bucket.total,
      active: result.active + bucket.active,
      inactive: result.inactive + bucket.inactive,
      deleted: result.deleted + bucket.deleted,
    }),
    emptyVendorType()
  );

  return { summary, by_type: byType };
}

async function getDescendants(user) {
  if (user.role === 'super_admin') {
    return User.find({ role: { $ne: 'super_admin' } })
      .select('_id role isActive isDeleted');
  }

  const descendants = [];
  let parentIds = [user._id];
  const visited = new Set([String(user._id)]);
  while (parentIds.length) {
    const children = await User.find({ parentId: { $in: parentIds } })
      .select('_id role isActive isDeleted');
    if (!children.length) break;
    const newChildren = children.filter((child) => !visited.has(String(child._id)));
    if (!newChildren.length) break;
    newChildren.forEach((child) => visited.add(String(child._id)));
    descendants.push(...newChildren);
    parentIds = newChildren.map((child) => child._id);
  }
  return descendants;
}

function ownershipQuery(user, descendants) {
  if (user.role === 'super_admin') return {};
  if (user.role === 'retailer') return { retailerId: user._id };
  const retailerIds = descendants
    .filter((item) => item.role === 'retailer')
    .map((item) => item._id);
  return { retailerId: { $in: retailerIds } };
}

function publicUser(req, user) {
  const profile = typeof user.toPublicProfile === 'function'
    ? user.toPublicProfile()
    : user.toObject();
  const profileImage = profile.profileImage || {};

  return {
    ...profile,
    id: String(user._id),
    status: user.isActive ? 'active' : 'inactive',
    profileImage: {
      ...profileImage,
      url: absoluteUrl(req, profileImage.url),
    },
  };
}

function qrRecord(req, device, user, description) {
  if (!device) return null;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  return {
    id: String(device._id),
    token: device.deviceId,
    company_name: user.company || user.name || '',
    qr_label: device.deviceId,
    description,
    qr_image_url: createQrImageUrl(req, device),
    enrollment_link: `${getPublicOrigin(req)}/download?deviceId=${encodeURIComponent(device.deviceId)}&type=${encodeURIComponent(device.keyType)}`,
    status: device.status,
    expires_at: expiresAt.toISOString(),
    createdAt: device.createdAt ? new Date(device.createdAt).toISOString() : null,
  };
}

function mapBanners(req, banners) {
  return banners.map((banner) => ({
    _id: String(banner._id),
    title: banner.title,
    imageUrl: absoluteUrl(req, banner.bannerImage),
    redirectUrl: banner.redirectUrl || '',
    isActive: Boolean(banner.isActive),
  }));
}

function mapAppUpdate(req, update) {
  if (!update) return null;
  const downloadUrl = absoluteUrl(req, update.apkUrl);
  return {
    versionCode: String(update.versionCode),
    versionName: update.versionName,
    fileName: downloadUrl.split('/').pop() || '',
    fileSize: 0,
    downloadUrl,
    changelog: update.releaseNotes || '',
    forceUpdate: Boolean(update.isForced),
    uploadDate: update.createdAt ? new Date(update.createdAt).toISOString() : null,
    packageName: update.packageName,
  };
}

async function loadDashboardState(req) {
  const user = await User.findById(req.user._id);
  if (!user) {
    const err = new Error('User not found.');
    err.statusCode = 404;
    throw err;
  }

  const descendants = await getDescendants(user);
  const deviceQuery = ownershipQuery(user, descendants);
  const customerQuery = ownershipQuery(user, descendants);
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const userObjectId = new mongoose.Types.ObjectId(user._id);
  const bannerAudience = user.role === 'super_admin' ? 'admin' : 'retailer';

  const [
    deviceRows,
    customerRows,
    todayCustomerRows,
    linkedCustomers,
    thisMonthCustomers,
    emiActive,
    emiCompleted,
    emiDefaulted,
    emiOverdue,
    walletRows,
    lastTransaction,
    banners,
    appUpdate,
    latestRunning,
    latestNew,
  ] = await Promise.all([
    Device.aggregate([
      { $match: deviceQuery },
      {
        $group: {
          _id: { keyType: '$keyType', status: '$status', isLocked: '$isLocked' },
          count: { $sum: 1 },
        },
      },
    ]),
    Customer.aggregate([
      { $match: customerQuery },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Customer.aggregate([
      { $match: { ...customerQuery, createdAt: { $gte: todayStart } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Customer.countDocuments({ ...customerQuery, deviceId: { $ne: null } }),
    Customer.countDocuments({ ...customerQuery, createdAt: { $gte: monthStart } }),
    Customer.countDocuments({
      ...customerQuery,
      paymentType: { $ne: 'without_emi' },
      status: { $in: ACTIVE_CUSTOMER_STATUSES },
    }),
    Customer.countDocuments({ ...customerQuery, status: 'completed' }),
    Customer.countDocuments({ ...customerQuery, status: 'defaulted' }),
    Customer.countDocuments({
      ...customerQuery,
      status: { $in: ACTIVE_CUSTOMER_STATUSES },
      nextEmiDate: { $lt: now },
    }),
    WalletTransaction.aggregate([
      { $match: { userId: userObjectId } },
      {
        $group: {
          _id: null,
          totalCredits: {
            $sum: {
              $cond: [{ $in: ['$type', ['credit', 'credit_foc']] }, '$amount', 0],
            },
          },
          totalDebits: {
            $sum: {
              $cond: [{ $in: ['$type', ['debit', 'transfer']] }, '$amount', 0],
            },
          },
        },
      },
    ]),
    WalletTransaction.findOne({ userId: user._id }).sort({ createdAt: -1 }),
    Banner.find({
      isActive: true,
      bannerType: { $in: ['all', bannerAudience] },
      $and: [
        { $or: [{ startDate: null }, { startDate: { $exists: false } }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null }, { endDate: { $exists: false } }, { endDate: { $gte: now } }] },
      ],
    }).sort({ createdAt: -1 }),
    AppUpdate.findOne({ isActive: true }).sort({ versionCode: -1 }),
    Device.findOne({
      ...deviceQuery,
      keyType: 'running_key',
      status: { $nin: ['removed', 'released'] },
    }).sort({ createdAt: -1 }),
    Device.findOne({
      ...deviceQuery,
      keyType: { $in: ['new_key', 'android'] },
      status: { $nin: ['removed', 'released'] },
    }).sort({ createdAt: -1 }),
  ]);

  return {
    user,
    descendants,
    deviceRows,
    customerRows,
    todayCustomerRows,
    linkedCustomers,
    thisMonthCustomers,
    emiActive,
    emiCompleted,
    emiDefaulted,
    emiOverdue,
    wallet: walletRows[0] || { totalCredits: 0, totalDebits: 0 },
    lastTransaction,
    banners,
    appUpdate,
    latestRunning,
    latestNew,
  };
}

function buildKeySummaryData(deviceStats, balance) {
  const usage = buildUsageSummary(deviceStats, balance);
  return {
    totalKey: usage.usedKeys,
    newKey: deviceStats.android.total,
    total: toPLockerKeyStats(deviceStats.android),
    runningKey: deviceStats.running.total,
    running: toPLockerKeyStats(deviceStats.running),
    androidAvailable: balance,
    iphoneAvailable: balance,
    iphone: toPLockerKeyStats(deviceStats.iphone),
    loanZoneKey: 0,
    eMandate: 0,
    keySummary: usage,
  };
}

const getDashboardPLocker = async (req, res) => {
  try {
    const state = await loadDashboardState(req);
    const deviceStats = buildDeviceStats(state.deviceRows);
    const customers = statusBucket(state.customerRows);
    const todayCustomers = statusBucket(state.todayCustomerRows);
    const balance = Number(state.user.runningKeyBalance) || 0;
    const usage = buildUsageSummary(deviceStats, balance);
    const activeKeys = deviceStats.android.active
      + deviceStats.running.active
      + deviceStats.iphone.active;
    const expiredKeys = deviceStats.android.expired
      + deviceStats.running.expired
      + deviceStats.iphone.expired;
    const vendorStats = buildVendorStats(state.descendants);
    const inactiveCustomers = Math.max(0, customers.total - customers.active);

    const data = {
      user: publicUser(req, state.user),
      wallet: {
        id: String(state.user._id),
        balance,
        currency: 'KEY',
        totalCredits: Number(state.wallet.totalCredits) || 0,
        totalDebits: Number(state.wallet.totalDebits) || 0,
        status: state.user.isActive ? 'active' : 'inactive',
        lastTransactionAt: state.lastTransaction?.createdAt
          ? new Date(state.lastTransaction.createdAt).toISOString()
          : null,
      },
      keys: {
        ...usage,
        activeKeys,
        expiredKeys,
        canAddCustomer: balance > 0,
        android: deviceStats.android,
        running: deviceStats.running,
        iphone: deviceStats.iphone,
      },
      customers: {
        self: {
          total: customers.total,
          active: customers.active,
          pending: customers.pending,
          deleted: customers.remove,
          lock: customers.lock,
          new_today: todayCustomers,
        },
        total: customers.total,
        active: customers.active,
        inactive: inactiveCustomers,
        linked: state.linkedCustomers,
        unlinked: Math.max(0, customers.total - state.linkedCustomers),
        new_today: todayCustomers.total,
        new_this_month: state.thisMonthCustomers,
        kyc: {
          pending: customers.total,
          verified: 0,
          rejected: 0,
        },
        emi: {
          active: state.emiActive,
          completed: state.emiCompleted,
          defaulted: state.emiDefaulted,
          overdue: state.emiOverdue,
        },
      },
      vendorStats,
      banners: mapBanners(req, state.banners),
      appUpdate: mapAppUpdate(req, state.appUpdate),
      homeQR: qrRecord(req, state.latestRunning, state.user, 'Running key enrollment QR'),
      qrCodeRecord: qrRecord(req, state.latestNew, state.user, 'New key enrollment QR'),
    };

    return res.json({
      success: true,
      message: 'Dashboard loaded successfully.',
      data,
      stats: {
        totalDevices: usage.usedKeys,
        activeDevices: activeKeys,
        lockedDevices: deviceStats.android.locked
          + deviceStats.running.locked
          + deviceStats.iphone.locked,
        pendingDevices: deviceStats.android.pending
          + deviceStats.running.pending
          + deviceStats.iphone.pending,
        todayEnrolled: todayCustomers.total,
        totalCustomers: customers.total,
        activeCustomers: customers.active,
        overdueCustomers: state.emiOverdue,
      },
      balance: {
        android: Number(state.user.androidBalance) || 0,
        runningKey: balance,
        iphone: Number(state.user.iphoneBalance) || 0,
      },
      keyDetails: {
        android: deviceStats.android,
        runningKey: deviceStats.running,
        iphone: deviceStats.iphone,
      },
      hierarchyStats: {
        totalSuperDist: state.descendants.filter((item) => item.role === 'super_distributor').length,
        totalDistributors: state.descendants.filter((item) => item.role === 'distributor').length,
        totalSubDist: state.descendants.filter((item) => item.role === 'sub_distributor').length,
        totalRetailers: state.descendants.filter((item) => item.role === 'retailer').length,
      },
    });
  } catch (err) {
    console.error('P Locker dashboard error:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Dashboard load failed.',
    });
  }
};

const getKeySummaryPLocker = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, status: 404, message: 'User not found.' });
    }

    const descendants = await getDescendants(user);
    const query = ownershipQuery(user, descendants);
    const rows = await Device.aggregate([
      { $match: query },
      {
        $group: {
          _id: { keyType: '$keyType', status: '$status', isLocked: '$isLocked' },
          count: { $sum: 1 },
        },
      },
    ]);
    const deviceStats = buildDeviceStats(rows);
    const balance = Number(user.runningKeyBalance) || 0;

    return res.json({
      success: true,
      status: 200,
      data: buildKeySummaryData(deviceStats, balance),
      summary: deviceStats.legacy,
    });
  } catch (err) {
    console.error('P Locker key summary error:', err);
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || 'Key summary load failed.',
    });
  }
};

module.exports = {
  buildDeviceStats,
  buildKeySummaryData,
  buildUsageSummary,
  buildVendorStats,
  getDashboardPLocker,
  getKeySummaryPLocker,
};
