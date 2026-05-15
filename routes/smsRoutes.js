// ─────────────────────────────────────────────────────────────
//  routes/smsRoutes.js
//  POST /api/sms/send-lock   — Offline SMS-based lock
//  POST /api/sms/send-unlock — Offline SMS-based unlock
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const Device  = require('../models/Device');
const Command = require('../models/Command');
const { protect } = require('../middleware/auth');

// ── Helper: Fast91 / Any SMS Gateway sender
// Agar tumhara SMS gateway alag hai to yahan URL change karo
const sendSms = async (phone, message) => {
  try {
    // Example: Fast2SMS API
    // Apna SMS API key .env me rakh: SMS_API_KEY=xxx
    // Filhal log karta hai — production me uncomment karo
    /*
    const axios = require('axios');
    await axios.get('https://www.fast2sms.com/dev/bulkV2', {
      params: {
        authorization: process.env.SMS_API_KEY,
        message,
        language: 'english',
        route: 't',
        numbers: phone,
      },
    });
    */
    console.log(`📱 SMS to ${phone}: ${message}`);
    return { success: true };
  } catch (err) {
    console.error('SMS failed:', err.message);
    return { success: false, error: err.message };
  }
};

// ── POST /api/sms/send-lock — Lock device via SMS (Offline fallback)
//    Body: { deviceId, phone_number?, message? }
router.post('/send-lock', protect, async (req, res) => {
  try {
    const { deviceId, phone_number, message } = req.body;
    if (!deviceId) return res.status(400).json({ success: false, message: 'deviceId required' });

    const filter = req.user.role === 'super_admin'
      ? { deviceId }
      : { deviceId, retailerId: req.user._id };

    const device = await Device.findOne(filter);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found or access denied' });

    // Update device state
    device.isLocked = true;
    device.status   = 'locked';
    device.lockMessage = message || 'Device locked. Please pay your EMI.';
    await device.save();

    // Log command
    await Command.create({
      deviceId:       device._id,
      commandType:    'LOCK_DEVICE',
      deliveryMethod: 'sms',
      payload:        { message, phone_number },
      status:         'sent',
      sentAt:         new Date(),
      createdBy:      req.user._id,
    });

    // Send SMS
    const targetPhone = phone_number || device.simNumber;
    const smsText = `[Power Locker] LOCK:${device.deviceId} Your device has been locked. ${device.lockMessage}`;
    if (targetPhone) await sendSms(targetPhone, smsText);

    res.json({
      success: true,
      message: 'SMS lock command sent',
      smsTo: targetPhone || 'Not available',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/sms/send-unlock — Unlock device via SMS (Offline fallback)
//    Body: { deviceId, phone_number? }
router.post('/send-unlock', protect, async (req, res) => {
  try {
    const { deviceId, phone_number } = req.body;
    if (!deviceId) return res.status(400).json({ success: false, message: 'deviceId required' });

    const filter = req.user.role === 'super_admin'
      ? { deviceId }
      : { deviceId, retailerId: req.user._id };

    const device = await Device.findOne(filter);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found or access denied' });

    device.isLocked   = false;
    device.status     = 'active';
    device.lockMessage = '';
    await device.save();

    await Command.create({
      deviceId:       device._id,
      commandType:    'UNLOCK_DEVICE',
      deliveryMethod: 'sms',
      payload:        { phone_number },
      status:         'sent',
      sentAt:         new Date(),
      createdBy:      req.user._id,
    });

    const targetPhone = phone_number || device.simNumber;
    const smsText = `[Power Locker] UNLOCK:${device.deviceId} Your device has been unlocked. Please keep up your payments.`;
    if (targetPhone) await sendSms(targetPhone, smsText);

    res.json({
      success: true,
      message: 'SMS unlock command sent',
      smsTo: targetPhone || 'Not available',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
