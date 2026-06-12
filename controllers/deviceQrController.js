const mongoose = require('mongoose');
const Device = require('../models/Device');
const { generateDeviceQr, verifyQrImageToken } = require('../utils/deviceQr');

const getPLockerDeviceQr = async (req, res) => {
  try {
    const identifier = req.params.id;
    const lookup = mongoose.isValidObjectId(identifier)
      ? { $or: [{ _id: identifier }, { deviceId: identifier }] }
      : { deviceId: identifier };

    if (req.user.role !== 'super_admin') {
      lookup.retailerId = req.user._id;
    }

    const device = await Device.findOne(lookup);
    if (!device) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Device not found.',
      });
    }

    const qr = await generateDeviceQr(req, device);
    return res.json({
      success: true,
      status: 200,
      message: 'Device QR generated.',
      data: {
        deviceId: device.deviceId,
        qrCode: qr.qrImage,
        qrImage: qr.qrImage,
        enrollmentLink: qr.downloadUrl,
        expiresIn: 'No expiry',
      },
    });
  } catch (err) {
    console.error('P Locker device QR error:', err);
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || 'QR generation failed.',
    });
  }
};

const getPLockerDeviceQrImage = async (req, res) => {
  try {
    const token = String(req.query.token || '');
    if (!token || !verifyQrImageToken(token, req.params.id)) {
      return res.status(401).json({ success: false, message: 'QR image token invalid hai.' });
    }

    const device = await Device.findById(req.params.id);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found.' });
    }

    const qr = await generateDeviceQr(req, device);
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': qr.qrPng.length,
      'Cache-Control': 'private, max-age=300',
    });
    return res.send(qr.qrPng);
  } catch (err) {
    const status = ['JsonWebTokenError', 'TokenExpiredError'].includes(err.name) ? 401 : 500;
    return res.status(status).json({
      success: false,
      message: status === 401 ? 'QR image link expire ya invalid hai.' : err.message,
    });
  }
};

module.exports = { getPLockerDeviceQr, getPLockerDeviceQrImage };
