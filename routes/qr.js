const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Device = require('../models/Device');
const Customer = require('../models/Customer');
const WalletTransaction = require('../models/WalletTransaction');
const { protect } = require('../middleware/auth');

// ── Multer config for customer images & signatures ──────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/customers');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${file.fieldname}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const uploadFields = upload.fields([
  { name: 'customerImage', maxCount: 1 },
  { name: 'customerSignature', maxCount: 1 },
]);

// ── Key type → balance field map ─────────────────────────────
const BALANCE_FIELD = {
  new_key:     'androidBalance',
  running_key: 'runningKeyBalance',
  iphone_key:  'iphoneBalance',
  android:     'androidBalance',
  iphone:      'iphoneBalance',
};

// POST /api/qr/generate — Customer enroll + QR generate
router.post('/generate', protect, uploadFields, async (req, res) => {
  try {
    const {
      // Key type
      keyType = 'running_key',
      // Customer personal
      name, phone, fatherName, address, city, state, aadhar, pan,
      // Device
      imei1, imei2, mobileNo,
      // Loan
      loanProvider,
      // Payment
      paymentType = 'with_emi',
      emiMonths, emiStartDate, monthlyEmi, totalAmount, downPayment,
      // Product
      productName, productPrice,
    } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Customer name aur phone required hai' });
    }

    // ── Balance check ────────────────────────────────────────
    const User = require('../models/User');
    const isAdmin = req.user.role === 'super_admin' || req.user.role === 'admin';
    // Admin ki taraf se retailer ka ID body mein aa sakta hai (Enroll Customer popup)
    const targetRetailerId = (isAdmin && req.body.retailerId) ? req.body.retailerId : req.user._id;
    const retailer = await User.findById(targetRetailerId);
    if (!retailer) return res.status(404).json({ success: false, message: 'Retailer not found' });

    const balanceField = BALANCE_FIELD[keyType] || 'runningKeyBalance';
    if (!retailer[balanceField] || retailer[balanceField] < 1) {
      return res.status(400).json({
        success: false,
        message: `Insufficient key balance! Aapke paas ${keyType.replace(/_/g, ' ')} ke liye keys nahi hain.`
      });
    }

    // ── File paths ───────────────────────────────────────────
    const BASE_URL = process.env.BASE_URL || (req.protocol + '://' + req.get('host'));
    const APK_URL = process.env.APK_DOWNLOAD_URL || 'https://github.com/Pawanyadav2784/mdmlocker/raw/main/PowerLocker-v1.0.apk';
    const files = req.files || {};
    const photoUrl     = files.customerImage?.[0]
      ? `/uploads/customers/${files.customerImage[0].filename}` : '';
    const signatureUrl = files.customerSignature?.[0]
      ? `/uploads/customers/${files.customerSignature[0].filename}` : '';

    // ── Create Device ────────────────────────────────────────
    const device = await Device.create({
      keyType,
      retailerId: targetRetailerId,
      status: 'pending',
      imei: imei1 || '',
      imei2: imei2 || '',
    });

    // ── Create Customer ──────────────────────────────────────
    const customer = await Customer.create({
      name:             name.trim(),
      phone:            phone.trim(),
      fatherName:       fatherName || '',
      address:          address || '',
      city:             city || '',
      state:            state || '',
      aadhar:           aadhar || '',
      pan:              pan || '',
      keyType,
      imei1:            imei1 || '',
      imei2:            imei2 || '',
      mobileNo:         mobileNo || phone,
      loanProvider:     loanProvider || '',
      paymentType:      paymentType,
      emiMonths:        Number(emiMonths) || 0,
      emiStartDate:     emiStartDate ? new Date(emiStartDate) : null,
      nextEmiDate:      emiStartDate ? new Date(emiStartDate) : null,
      monthlyEmi:       Number(monthlyEmi) || 0,
      totalAmount:      Number(totalAmount) || 0,
      downPayment:      Number(downPayment) || 0,
      productName:      productName || '',
      productPrice:     Number(productPrice) || 0,
      photo:            photoUrl,
      customerSignature: signatureUrl,
      deviceId:         device._id,
      retailerId:       targetRetailerId,
      createdBy:        req.user._id,
      status:           'pending',
      qrCode:           device.deviceId,
    });

    // ── Link customer to device ──────────────────────────────
    device.customerId = customer._id;
    await device.save();

    // ── Deduct balance ───────────────────────────────────────
    retailer[balanceField] -= 1;
    await retailer.save();
    await WalletTransaction.create({
      userId:      targetRetailerId,
      type:        'debit',
      keyType,
      amount:      1,
      description: `Device created: ${device.deviceId} — ${name}`,
      referenceId: device.deviceId,
    });

    // ── Generate QR ──────────────────────────────────────────
    // QR content per key type (new_key=JSON, others=URL)
    let qrPayload, downloadUrl;
    if (keyType === 'new_key') {
      const crypto = require('crypto');
      const secret = process.env.QR_SECRET || 'power-locker-mdm-secret';
      const checksum = crypto.createHash('sha256').update(device.deviceId + secret).digest('hex').substring(0, 16);
      downloadUrl = BASE_URL + '/download?deviceId=' + device.deviceId + '&type=new_key';
      qrPayload = JSON.stringify({ deviceId: device.deviceId, server: BASE_URL, type: 'new_key', apk: APK_URL, checksum });
    } else {
      // running_key / iphone_key - browser URL -> download page -> APK
      downloadUrl = BASE_URL + '/download?deviceId=' + device.deviceId + '&type=' + keyType;
      qrPayload = downloadUrl;
    }
    const qrImage = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: 'M', width: 400 });

    res.json({
      success:     true,
      deviceId:    device.deviceId,
      qrImage,
      downloadUrl,
      apkUrl: APK_URL,
      device,
      customer: {
        id:   customer._id,
        name: customer.name,
        phone: customer.phone,
        keyType,
      },
      remainingBalance: retailer[balanceField],
    });
  } catch (err) {
    console.error('QR generate error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/qr/get-qr/:deviceId — Existing device ka QR regenerate
router.get('/get-qr/:deviceId', protect, async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

    const BASE_URL = process.env.BASE_URL || (req.protocol + '://' + req.get('host'));
    const APK_URL = process.env.APK_DOWNLOAD_URL || 'https://github.com/Pawanyadav2784/mdmlocker/raw/main/PowerLocker-v1.0.apk';
    const downloadUrl = `${BASE_URL}/download?deviceId=${device.deviceId}&type=${device.keyType}`;
    const qrImage = await QRCode.toDataURL(downloadUrl, {
      errorCorrectionLevel: 'M', width: 400,
    });

    res.json({ success: true, deviceId: device.deviceId, qrImage, downloadUrl });
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
