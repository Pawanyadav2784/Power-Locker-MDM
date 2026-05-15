const QRCode = require('qrcode');
const Device = require('../models/Device');
const Customer = require('../models/Customer');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const { modifyBalance } = require('./keyController');

// @desc    Generate QR for a new device
// @route   POST /api/qr/generate
const generateQR = async (req, res) => {
  try {
    const { keyType = 'running_key' } = req.body;
    const balanceField = { android: 'androidBalance', running_key: 'runningKeyBalance', iphone: 'iphoneBalance' }[keyType];
    const retailer = await User.findById(req.user._id);

    if (retailer[balanceField] < 1)
      return res.status(400).json({ success: false, message: `Insufficient ${keyType} key balance` });

    const device = await Device.create({ keyType, retailerId: req.user._id, status: 'pending' });

    retailer[balanceField] -= 1;
    await retailer.save();
    await WalletTransaction.create({
      userId: req.user._id, type: 'debit', keyType, amount: 1,
      description: `Device created: ${device.deviceId}`,
      referenceId: device.deviceId, createdBy: req.user._id,
    });

    const qrPayload = JSON.stringify({ deviceId: device.deviceId, server: process.env.BASE_URL, type: keyType });
    const qrImage = await QRCode.toDataURL(qrPayload);

    res.json({ success: true, deviceId: device.deviceId, qrImage, device });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Get QR payload by deviceId
// @route   GET /api/qr/payload/:deviceId
const getPayload = async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId })
      .populate('customerId', 'name phone')
      .populate('retailerId', 'name phone');
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({
      success: true,
      payload: {
        deviceId: device.deviceId, server: process.env.BASE_URL,
        type: device.keyType, customer: device.customerId, retailer: device.retailerId,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Get retailer's QR/device list
// @route   GET /api/qr/list
const getQRList = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const query = { retailerId: req.user._id };
    if (status) query.status = status;
    const total = await Device.countDocuments(query);
    const devices = await Device.find(query)
      .populate('customerId', 'name phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    res.json({ success: true, total, data: devices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Enroll device (called by MDM app when QR scanned)
// @route   POST /api/qr/enroll
const enrollDevice = async (req, res) => {
  try {
    const { deviceId, imei, imei2, deviceName, brand, model, androidVersion, fcmToken, simNumber } = req.body;
    const device = await Device.findOne({ deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Invalid Device ID' });
    if (device.status === 'active')
      return res.status(400).json({ success: false, message: 'Device already enrolled' });

    Object.assign(device, {
      imei: imei || '', imei2: imei2 || '', deviceName: deviceName || '',
      brand: brand || '', model: model || '', androidVersion: androidVersion || '',
      fcmToken: fcmToken || '', simNumber: simNumber || '',
      status: 'active', isEnrolled: true, enrolledAt: new Date(),
    });
    await device.save();

    if (device.customerId) {
      await Customer.findByIdAndUpdate(device.customerId, { status: 'active' });
    }

    const customer = device.customerId ? await Customer.findById(device.customerId) : null;
    res.json({
      success: true, message: 'Device enrolled successfully',
      device: { deviceId: device.deviceId, status: device.status, keyType: device.keyType, isLocked: device.isLocked },
      customer: customer ? {
        name: customer.name, phone: customer.phone,
        emiType: customer.emiType, monthlyEmi: customer.monthlyEmi, loanStartDate: customer.loanStartDate,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Update FCM token
// @route   POST /api/qr/update-fcm
const updateFCM = async (req, res) => {
  try {
    const { deviceId, fcmToken } = req.body;
    const device = await Device.findOneAndUpdate({ deviceId }, { fcmToken, lastSeen: new Date() }, { new: true });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, message: 'FCM token updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { generateQR, getPayload, getQRList, enrollDevice, updateFCM };
