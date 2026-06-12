const Customer = require('../models/Customer');
const User = require('../models/User');
const { serializeCustomer } = require('../utils/pLockerCompatibility');

const { getDeviceScope } = require('../utils/deviceAccess');

const buildBaseQuery = async (user) => {
  return await getDeviceScope(user);
};

const KEY_TYPE_FILTER = {
  '1': 'new_key',
  '2': 'running_key',
  '3': 'iphone_key',
};

const STATUS_FILTER = {
  active: 'active',
  lock: 'locked',
  remove: 'removed',
  removed: 'removed',
  pending: 'pending',
};

const getAllCustomersPLocker = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const baseQuery = await buildBaseQuery(req.user);

    if (baseQuery === null) {
      return res.json({
        success: true,
        role: req.user.role,
        count: 0,
        enrolled: 0,
        not_enrolled: 0,
        total: 0,
        totalPages: 0,
        currentPage: page,
        limit,
        data: [],
      });
    }

    const query = { ...baseQuery };
    const requestedStatus = String(req.query.type || req.query.status || '').toLowerCase();
    const keyType = KEY_TYPE_FILTER[String(req.query.key_type || '')];

    if (STATUS_FILTER[requestedStatus]) query.status = STATUS_FILTER[requestedStatus];
    if (keyType) query.keyType = keyType;

    if (String(req.query.today || '') === '1') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: start, $lt: new Date(start.getTime() + 86400000) };
    }

    const search = String(req.query.search || '').trim();
    if (search) {
      const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { name: pattern },
        { phone: pattern },
        { email: pattern },
        { imei1: pattern },
        { imei2: pattern },
        { qrCode: pattern },
        { aadhar: pattern },
      ];
    }

    let enrolledPromise;
    if (query.status === 'pending') {
      enrolledPromise = Promise.resolve(0);
    } else if (query.status) {
      enrolledPromise = Customer.countDocuments(query);
    } else {
      enrolledPromise = Customer.countDocuments({
        ...query,
        status: {
          $in: ['active', 'locked', 'completed', 'defaulted', 'closed', 'removed'],
        },
      });
    }

    const [total, enrolled, customers] = await Promise.all([
      Customer.countDocuments(query),
      enrolledPromise,
      Customer.find(query)
        .populate('deviceId')
        .populate('retailerId', 'name phone company')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    return res.json({
      success: true,
      role: req.user.role,
      count: customers.length,
      enrolled,
      not_enrolled: Math.max(0, total - enrolled),
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      limit,
      data: customers.map((customer) => serializeCustomer(req, customer)),
    });
  } catch (err) {
    console.error('P Locker customer list error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Customer list load failed.',
    });
  }
};

module.exports = { getAllCustomersPLocker };
