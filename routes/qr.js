const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const Device = require('../models/Device');
const Customer = require('../models/Customer');
const WalletTransaction = require('../models/WalletTransaction');
const { protect } = require('../middleware/auth');

// POST /api/qr/generate — Retailer creates customer + generates QR
router.post('/generate', protect, async (req, res) => {
  try {
    const { keyType = 'running_key' } = req.body;

    const balanceField = {
      android:     'androidBalance',
      running_key: 'runningKeyBalance',
      iphone:      'iphoneBalance',
    }[keyType];

    const User = require('../models/User');
    const retailer = await User.findById(req.user._id);
    if (retailer[balanceField] < 1) {
      return res.status(400).json({ success: false, message: 'Insufficient key balance' });
    }

    // Create device (auto device ID)
    const device = await Device.create({ keyType, retailerId: req.user._id, status: 'pending' });

    // Deduct balance
    retailer[balanceField] -= 1;
    await retailer.save();
    await WalletTransaction.create({
      userId: req.user._id, type: 'debit', keyType, amount: 1,
      description: `Device created: ${device.deviceId}`, referenceId: device.deviceId,
    });

    // APK URL — GitHub se ya server se
    const APK_URL = process.env.APK_DOWNLOAD_URL ||
      `${process.env.BASE_URL}/uploads/apk/app-release.apk`;

    // QR mein web link daalo — scan karo → browser → APK download → app khule → enroll
    // Format: BASE_URL/download?deviceId=XXX&type=running_key
    const downloadUrl = `${process.env.BASE_URL}/download?deviceId=${device.deviceId}&type=${keyType}`;

    const qrPayload = downloadUrl;  // Simple URL = camera directly browser mein kholta hai
    const qrImage   = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: 'M', width: 400 });

    res.json({
      success:    true,
      deviceId:   device.deviceId,
      qrImage,
      downloadUrl,
      apkUrl:     APK_URL,
      device,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// GET /api/qr/payload/:deviceId — Get QR payload JSON
router.get('/payload/:deviceId', protect, async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId })
      .populate('customerId')
      .populate('retailerId', 'name phone');
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({
      success: true,
      payload: {
        deviceId: device.deviceId,
        server: process.env.BASE_URL,
        type: device.keyType,
        customerId: device.customerId,
        retailer: device.retailerId,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/qr/list — Retailer's QR list
router.get('/list', protect, async (req, res) => {
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
});

// POST /api/qr/enroll — MDM App calls this when QR scanned
router.post('/enroll', async (req, res) => {
  try {
    const { deviceId, imei, imei2, deviceName, brand, model, androidVersion, fcmToken, simNumber } = req.body;

    const device = await Device.findOne({ deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Invalid Device ID' });
    if (device.status === 'active') {
      return res.status(400).json({ success: false, message: 'Device already enrolled' });
    }

    // Update device info
    device.imei = imei || '';
    device.imei2 = imei2 || '';
    device.deviceName = deviceName || '';
    device.brand = brand || '';
    device.model = model || '';
    device.androidVersion = androidVersion || '';
    device.fcmToken = fcmToken || '';
    device.simNumber = simNumber || '';
    device.status = 'active';
    device.isEnrolled = true;
    device.enrolledAt = new Date();
    await device.save();

    // Update customer status
    if (device.customerId) {
      await Customer.findByIdAndUpdate(device.customerId, { status: 'active' });
    }

    const customer = device.customerId ? await Customer.findById(device.customerId) : null;

    res.json({
      success: true,
      message: 'Device enrolled successfully',
      device: {
        deviceId: device.deviceId,
        status: device.status,
        keyType: device.keyType,
        isLocked: device.isLocked,
      },
      customer: customer ? {
        name: customer.name, phone: customer.phone,
        emiType: customer.emiType, monthlyEmi: customer.monthlyEmi,
        loanStartDate: customer.loanStartDate,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/qr/update-fcm — App updates FCM token
router.post('/update-fcm', async (req, res) => {
  try {
    const { deviceId, fcmToken } = req.body;
    const device = await Device.findOneAndUpdate({ deviceId }, { fcmToken, lastSeen: new Date() }, { new: true });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, message: 'FCM token updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
