const Customer = require('../models/Customer');
const Device   = require('../models/Device');
const Command  = require('../models/Command');
const User     = require('../models/User');
const { sendFCM } = require('../utils/fcmHelper');

// ──────────────────────────────────────────────────────────
//  HELPER: BFS — all retailer IDs under a parent
// ──────────────────────────────────────────────────────────
const getAllRetailerIds = async (startId) => {
  const visited = new Set();
  const queue   = [String(startId)];
  const ids     = [];
  while (queue.length) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    const children = await User.find({ parentId: cur, isDeleted: { $ne: true } }).select('_id role');
    for (const c of children) {
      if (c.role === 'retailer') ids.push(c._id);
      else queue.push(String(c._id));
    }
  }
  return ids;
};

// ──────────────────────────────────────────────────────────
//  HELPER: Build role-based base query
// ──────────────────────────────────────────────────────────
const buildBaseQuery = async (user) => {
  if (user.role === 'super_admin') return {};
  if (user.role === 'retailer') return { retailerId: user._id };
  const ids = await getAllRetailerIds(user._id);
  if (!ids.length) return null; // no retailers → empty result
  return { retailerId: { $in: ids } };
};

// ──────────────────────────────────────────────────────────
//  HELPER: Dispatch MDM command via FCM
// ──────────────────────────────────────────────────────────
const dispatchMDM = async (device, commandType, payload = {}, label = '', createdBy = null) => {
  const cmd = await Command.create({
    deviceId: device._id, commandType, payload, label,
    deliveryMethod: 'fcm', status: 'sent',
    sentAt: new Date(), createdBy,
  });
  if (device.fcmToken) {
    const r = await sendFCM(device.fcmToken, commandType, label || commandType, {
      command: commandType, deviceId: device.deviceId, ...payload,
    });
    if (!r.success) { cmd.status = 'failed'; await cmd.save(); }
  }
  return cmd;
};

// ══════════════════════════════════════════════════════════
//  1. ADD CUSTOMER
//  POST /api/customers/add
// ══════════════════════════════════════════════════════════
const addCustomer = async (req, res) => {
  try {
    const { deviceId: deviceIdStr, ...data } = req.body;

    // Calculate total & EMI remaining
    if (data.emiMonths) data.emiRemaining = Number(data.emiMonths);
    if (data.productPrice && data.downPayment) {
      data.totalAmount = Number(data.productPrice) - Number(data.downPayment);
      data.balancePayment = data.totalAmount;
    }

    const customer = await Customer.create({
      ...data,
      retailerId: req.user._id,
      createdBy:  req.user._id,
    });

    // Link device if QR/deviceId given
    if (deviceIdStr) {
      const device = await Device.findOneAndUpdate(
        { deviceId: deviceIdStr },
        { customerId: customer._id },
        { new: true }
      );
      if (device) {
        customer.deviceId = device._id;
        customer.qrCode   = deviceIdStr;
        await customer.save();
      }
    }

    res.status(201).json({ success: true, message: 'Customer added', customer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  2. GET ALL CUSTOMERS (paginated, filtered, role-based)
//  GET /api/customers
// ══════════════════════════════════════════════════════════
const getAllCustomers = async (req, res) => {
  try {
    const { page = 1, limit = 50, search, filter_type, filter_date, status } = req.query;

    const base = await buildBaseQuery(req.user);
    if (base === null) {
      return res.json({ success: true, total: 0, count: 0, customers: [], data: [],
        totalPages: 0, currentPage: 1, pagination: { total: 0, hasNextPage: false } });
    }

    const query = { ...base };
    if (status && status !== 'all')      query.status = status;
    if (filter_type && filter_type !== 'all') query.paymentType = filter_type;
    if (filter_date) {
      const d = new Date(filter_date);
      query.createdAt = { $gte: d, $lt: new Date(d.getTime() + 86400000) };
    }
    if (search) {
      query.$or = [
        { name:   new RegExp(search, 'i') },
        { phone:  new RegExp(search, 'i') },
        { qrCode: new RegExp(search, 'i') },
        { email:  new RegExp(search, 'i') },
        { aadhar: new RegExp(search, 'i') },
      ];
    }

    const total     = await Customer.countDocuments(query);
    const customers = await Customer.find(query)
      .populate('deviceId',   'deviceId status isLocked fcmToken lastSeen batteryLevel brand model')
      .populate('retailerId', 'name phone company')
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    res.json({
      success: true, total, count: customers.length,
      customers, data: customers,
      totalPages: Math.ceil(total / limit),
      currentPage: Number(page),
      pagination: { total, page: Number(page), limit: Number(limit),
        totalPages: Math.ceil(total / limit),
        hasNextPage: Number(page) < Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  3. GET CUSTOMER BY ID
//  GET /api/customers/:id
// ══════════════════════════════════════════════════════════
const getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id || req.body.id)
      .populate('deviceId')
      .populate('retailerId', 'name phone email');
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, customer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  4. UPDATE CUSTOMER
//  PUT /api/customers/:id
// ══════════════════════════════════════════════════════════
const updateCustomer = async (req, res) => {
  try {
    const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, customer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  5. DELETE CUSTOMER
//  DELETE /api/customers/:id
// ══════════════════════════════════════════════════════════
const deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    // Unlink device
    if (customer.deviceId) {
      await Device.findByIdAndUpdate(customer.deviceId, { customerId: null });
    }
    await Customer.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Customer deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  6. LOCK / UNLOCK DEVICE (MDM Action)
//  POST /api/customers/action
//  POST /api/customers/key-action  (APK alias)
// ══════════════════════════════════════════════════════════
const customerAction = async (req, res) => {
  try {
    const { customerId, action, message, phone_number } = req.body;
    const customer = await Customer.findById(customerId).populate('deviceId');
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const device = customer.deviceId;
    if (!device) return res.status(404).json({ success: false, message: 'No device linked to customer' });

    const isLock       = action === 'lock';
    const commandType  = isLock ? 'LOCK_DEVICE' : 'UNLOCK_DEVICE';

    // Update device
    device.isLocked    = isLock;
    device.lockMessage = isLock ? (message || 'EMI Due — Contact your dealer') : '';
    device.lockPhone   = isLock ? (phone_number || '') : '';
    device.status      = isLock ? 'locked' : 'active';
    await device.save();

    // Update customer
    customer.status         = isLock ? 'locked' : 'active';
    customer.isDeviceLocked = isLock;
    customer.lockReason     = isLock ? 'manual' : '';
    if (isLock) customer.lastLockedAt   = new Date();
    else        customer.lastUnlockedAt = new Date();
    await customer.save();

    // Dispatch MDM command via FCM
    await dispatchMDM(device, commandType, { message, phone_number }, isLock ? 'Lock Device' : 'Unlock Device', req.user._id);

    res.json({ success: true, message: `Device ${action} command sent` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Alias for retailer APK
const keyAction = customerAction;

// ══════════════════════════════════════════════════════════
//  7. LINK DEVICE TO CUSTOMER
//  POST /api/customers/:id/link-device
// ══════════════════════════════════════════════════════════
const linkDevice = async (req, res) => {
  try {
    const { deviceId: deviceIdStr } = req.body;
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const device = await Device.findOneAndUpdate(
      { deviceId: deviceIdStr },
      { customerId: customer._id },
      { new: true }
    );
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

    customer.deviceId = device._id;
    customer.qrCode   = deviceIdStr;
    await customer.save();

    res.json({ success: true, message: 'Device linked to customer', customer, device });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  8. UNLINK DEVICE FROM CUSTOMER
//  POST /api/customers/:id/unlink-device
// ══════════════════════════════════════════════════════════
const unlinkDevice = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    if (customer.deviceId) {
      await Device.findByIdAndUpdate(customer.deviceId, { customerId: null });
    }
    customer.deviceId = null;
    customer.qrCode   = '';
    await customer.save();

    res.json({ success: true, message: 'Device unlinked from customer' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  9. RECORD EMI PAYMENT
//  POST /api/customers/:id/emi/pay
// ══════════════════════════════════════════════════════════
const recordEmiPayment = async (req, res) => {
  try {
    const { amount, method = 'cash', referenceNo = '', note = '' } = req.body;
    if (!amount) return res.status(400).json({ success: false, message: 'amount required' });

    const customer = await Customer.findById(req.params.id).populate('deviceId');
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    // Push to history
    customer.emiHistory.push({
      amount: Number(amount), method, referenceNo, note,
      paidAt: new Date(), recordedBy: req.user._id,
    });

    // Update counts
    customer.emiPaid      = (customer.emiPaid || 0) + 1;
    customer.emiRemaining = Math.max(0, (customer.emiRemaining ?? customer.emiMonths) - 1);
    customer.totalPaid    = (customer.totalPaid || 0) + Number(amount);
    customer.overdueCount  = 0;
    customer.overdueAmount = 0;
    customer.lastEmiDate   = new Date();

    // Advance next EMI date
    const next = new Date(customer.nextEmiDate || new Date());
    if (customer.emiType === 'daily')   next.setDate(next.getDate() + 1);
    else if (customer.emiType === 'weekly') next.setDate(next.getDate() + 7);
    else next.setMonth(next.getMonth() + 1);
    customer.nextEmiDate = next;

    // Auto-complete & auto-unlock
    if (customer.emiRemaining === 0) {
      customer.status = 'completed';
      // Unlock device if it was locked for EMI
      if (customer.deviceId && customer.isDeviceLocked && customer.lockReason === 'emi_overdue') {
        const dev = customer.deviceId;
        dev.isLocked = false; dev.status = 'active'; dev.lockMessage = '';
        await dev.save();
        await dispatchMDM(dev, 'UNLOCK_DEVICE', {}, 'EMI Complete — Auto Unlock', req.user._id);
        customer.isDeviceLocked = false; customer.lockReason = '';
        customer.lastUnlockedAt = new Date();
      }
    } else {
      customer.status = 'active';
    }

    await customer.save();
    res.json({ success: true, message: 'EMI payment recorded', customer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  10. GET EMI HISTORY
//  GET /api/customers/:id/emi
// ══════════════════════════════════════════════════════════
const getEmiHistory = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id)
      .select('name phone emiPaid emiRemaining emiMonths monthlyEmi totalPaid totalAmount nextEmiDate lastEmiDate loanStartDate status overdueCount overdueAmount emiHistory isDeviceLocked lockReason')
      .populate('deviceId', 'deviceId status isLocked');
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, customer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  11. GET OVERDUE EMI CUSTOMERS
//  GET /api/customers/overdue
// ══════════════════════════════════════════════════════════
const getOverdueCustomers = async (req, res) => {
  try {
    const base = await buildBaseQuery(req.user);
    if (base === null) return res.json({ success: true, count: 0, data: [] });

    const query = {
      ...base,
      status:      { $in: ['active', 'locked'] },
      nextEmiDate: { $lt: new Date() },
    };

    const customers = await Customer.find(query)
      .populate('deviceId', 'deviceId status isLocked fcmToken')
      .sort({ nextEmiDate: 1 });

    res.json({ success: true, count: customers.length, data: customers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  12. SEARCH CUSTOMERS
//  GET /api/customers/search?q=...
// ══════════════════════════════════════════════════════════
const searchCustomers = async (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    if (!q) return res.status(400).json({ success: false, message: 'q param required' });

    const base = await buildBaseQuery(req.user);
    if (base === null) return res.json({ success: true, total: 0, data: [] });

    const query = {
      ...base,
      $or: [
        { name:   new RegExp(q, 'i') },
        { phone:  new RegExp(q, 'i') },
        { qrCode: new RegExp(q, 'i') },
        { email:  new RegExp(q, 'i') },
        { aadhar: new RegExp(q, 'i') },
      ],
    };

    const [total, customers] = await Promise.all([
      Customer.countDocuments(query),
      Customer.find(query)
        .populate('deviceId', 'deviceId status isLocked')
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit)),
    ]);

    res.json({ success: true, total, data: customers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  13. BULK LOCK / UNLOCK (multiple customers)
//  POST /api/customers/bulk-action
//  Body: { customerIds: [...], action: 'lock'|'unlock', message }
// ══════════════════════════════════════════════════════════
const bulkAction = async (req, res) => {
  try {
    const { customerIds, action, message } = req.body;
    if (!customerIds?.length) return res.status(400).json({ success: false, message: 'customerIds required' });

    const isLock = action === 'lock';
    const results = [];

    for (const cid of customerIds) {
      try {
        const customer = await Customer.findById(cid).populate('deviceId');
        if (!customer || !customer.deviceId) continue;
        const device = customer.deviceId;

        device.isLocked    = isLock;
        device.lockMessage = isLock ? (message || 'EMI Due') : '';
        device.status      = isLock ? 'locked' : 'active';
        await device.save();

        customer.status         = isLock ? 'locked' : 'active';
        customer.isDeviceLocked = isLock;
        customer.lockReason     = isLock ? 'manual' : '';
        if (isLock) customer.lastLockedAt   = new Date();
        else        customer.lastUnlockedAt = new Date();
        await customer.save();

        await dispatchMDM(device, isLock ? 'LOCK_DEVICE' : 'UNLOCK_DEVICE',
          { message }, isLock ? 'Bulk Lock' : 'Bulk Unlock', req.user._id);

        results.push({ customerId: cid, success: true });
      } catch (e) {
        results.push({ customerId: cid, success: false, error: e.message });
      }
    }

    res.json({ success: true, message: `Bulk ${action} done`, results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  14. AUTO LOCK OVERDUE (Cron trigger)
//  POST /api/customers/auto-lock-overdue
// ══════════════════════════════════════════════════════════
const autoLockOverdue = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Super admin only' });
    }

    const now = new Date();
    const overdue = await Customer.find({
      status:          { $in: ['active'] },
      nextEmiDate:     { $lt: now },
      autoLockEnabled: true,
      isDeviceLocked:  false,
    }).populate('deviceId');

    let locked = 0;
    for (const customer of overdue) {
      try {
        const graceDays  = customer.lockGraceDays || 3;
        const graceDate  = new Date(customer.nextEmiDate);
        graceDate.setDate(graceDate.getDate() + graceDays);
        if (now < graceDate) continue; // Still in grace period

        const device = customer.deviceId;
        if (!device?.fcmToken) continue;

        device.isLocked    = true;
        device.lockMessage = 'EMI Due — Contact your dealer';
        device.status      = 'locked';
        await device.save();

        customer.status         = 'locked';
        customer.isDeviceLocked = true;
        customer.lockReason     = 'emi_overdue';
        customer.overdueCount   = (customer.overdueCount || 0) + 1;
        customer.overdueAmount  = (customer.overdueAmount || 0) + (customer.monthlyEmi || 0);
        customer.lastLockedAt   = now;
        await customer.save();

        await dispatchMDM(device, 'LOCK_DEVICE', { message: 'EMI Due' }, 'Auto Lock — EMI Overdue', null);
        locked++;
      } catch (_) {}
    }

    res.json({ success: true, message: `Auto locked ${locked} devices` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  15. CUSTOMER STATS (for dashboard)
//  GET /api/customers/stats
// ══════════════════════════════════════════════════════════
const getCustomerStats = async (req, res) => {
  try {
    const base = await buildBaseQuery(req.user);
    if (base === null) return res.json({ success: true, stats: {} });

    const [total, active, locked, completed, overdue] = await Promise.all([
      Customer.countDocuments(base),
      Customer.countDocuments({ ...base, status: 'active' }),
      Customer.countDocuments({ ...base, status: 'locked' }),
      Customer.countDocuments({ ...base, status: 'completed' }),
      Customer.countDocuments({ ...base, status: { $in: ['active', 'locked'] }, nextEmiDate: { $lt: new Date() } }),
    ]);

    // Total collection amount
    const agg = await Customer.aggregate([
      { $match: base },
      { $group: { _id: null, totalCollection: { $sum: '$totalPaid' }, totalLoan: { $sum: '$totalAmount' } } },
    ]);

    res.json({
      success: true,
      stats: {
        total, active, locked, completed, overdue,
        totalCollection: agg[0]?.totalCollection || 0,
        totalLoan:       agg[0]?.totalLoan || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════
module.exports = {
  addCustomer, getAllCustomers, getCustomerById,
  updateCustomer, deleteCustomer,
  customerAction, keyAction,
  linkDevice, unlinkDevice,
  recordEmiPayment, getEmiHistory,
  getOverdueCustomers, searchCustomers,
  bulkAction, autoLockOverdue, getCustomerStats,
};
