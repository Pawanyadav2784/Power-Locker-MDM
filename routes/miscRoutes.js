const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { generateQR, getPayload, getQRList, enrollDevice, updateFCM } = require('../controllers/qrController');
const { createSchedule, getAllScheduled, cancelSchedule } = require('../controllers/scheduledCommandController');
const { getDashboard, getKeySummary } = require('../controllers/dashboardController');
const {
  createBanner, getBanners, updateBanner, deleteBanner, toggleBanner,
  getBanks, createBank, updateBank, deleteBank, toggleBank,
} = require('../controllers/contentController');
const { dispatchCommand } = require('../controllers/deviceController');
const Device = require('../models/Device');
const Command = require('../models/Command');

// ── QR ───────────────────────────────────────────────────────
router.post('/qr/generate', protect, generateQR);
router.get('/qr/payload/:deviceId', protect, getPayload);
router.get('/qr/list', protect, getQRList);
router.post('/qr/enroll', enrollDevice);     // No auth - called by device
router.post('/qr/update-fcm', updateFCM);    // No auth - called by device

// ── Dashboard ────────────────────────────────────────────────
router.get('/dashboard', protect, getDashboard);
router.get('/dashboard/key-summary', protect, getKeySummary);

// ── Scheduled Commands ───────────────────────────────────────
router.post('/scheduled-commands', protect, createSchedule);
router.get('/scheduled-commands', protect, getAllScheduled);
router.delete('/scheduled-commands/:id', protect, cancelSchedule);

// ── Banners ──────────────────────────────────────────────────
router.post('/banners/create', protect, adminOnly, upload.single('bannerImage'), createBanner);
router.get('/banners', protect, getBanners);
router.put('/banners/toggle/:id', protect, adminOnly, toggleBanner);
router.put('/banners/:id', protect, adminOnly, updateBanner);
router.delete('/banners/:id', protect, adminOnly, deleteBanner);

// ── MDM Banner aliases (matches other project's URL pattern) ─
router.post('/mdm/banner/create', protect, adminOnly, upload.single('bannerImage'), createBanner);
router.get('/mdm/banner/list', protect, getBanners);
router.put('/mdm/banner/update/:id', protect, adminOnly, updateBanner);
router.delete('/mdm/banner/delete/:id', protect, adminOnly, deleteBanner);

// ── Banks ────────────────────────────────────────────────────
router.get('/banks', protect, getBanks);
router.post('/banks/create', protect, adminOnly, createBank);
router.put('/banks/toggle/:id', protect, adminOnly, toggleBank);
router.put('/banks/:id', protect, adminOnly, updateBank);
router.delete('/banks/:id', protect, adminOnly, deleteBank);

// ── Bank List aliases ────────────────────────────────────────
router.get('/banklist/list', protect, getBanks);
router.post('/banklist/create', protect, adminOnly, createBank);
router.put('/banklist/update/:id', protect, adminOnly, updateBank);
router.delete('/banklist/delete/:id', protect, adminOnly, deleteBank);

// ── Generic MDM Device sendCommand ──────────────────────────
//    POST /api/mdm/device/sendCommand
//    Body: { deviceId, command, payload, label, deliveryMethod }
//    Commands: LOCK_DEVICE | UNLOCK_DEVICE | REBOOT | WIPE |
//              GET_LOCATION | MESSAGE | PLAY_ALERT | GET_SIM_INFO
router.post('/mdm/device/sendCommand', protect, async (req, res) => {
  try {
    const { deviceId, command, payload = {}, label, deliveryMethod = 'fcm' } = req.body;

    if (!deviceId || !command)
      return res.status(400).json({ success: false, message: 'deviceId and command are required' });

    const VALID_COMMANDS = [
      'LOCK_DEVICE', 'UNLOCK_DEVICE', 'REBOOT', 'WIPE',
      'GET_LOCATION', 'MESSAGE', 'PLAY_ALERT', 'GET_SIM_INFO',
      'SOFT_RESET', 'HARD_RESET', 'CHECK_IN',
    ];
    if (!VALID_COMMANDS.includes(command))
      return res.status(400).json({ success: false, message: `Invalid command. Valid: ${VALID_COMMANDS.join(', ')}` });

    const filter = req.user.role === 'super_admin'
      ? { deviceId }
      : { deviceId, retailerId: req.user._id };

    const device = await Device.findOne(filter);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found or access denied' });

    // Auto-update device state for lock/unlock
    if (command === 'LOCK_DEVICE') {
      device.isLocked = true;
      device.status = 'locked';
      device.lockMessage = payload.message || 'Device locked';
      await device.save();
    } else if (command === 'UNLOCK_DEVICE') {
      device.isLocked = false;
      device.status = 'active';
      device.lockMessage = '';
      await device.save();
    }

    const cmd = await dispatchCommand(device, command, payload, label || command, req.user._id);

    res.json({
      success: true,
      message: `${command} sent to device`,
      commandId: cmd._id,
      deviceId: device.deviceId,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/mdm/devices/:deviceId/sim-info ──────────────────
//    apiService.js getSimInfoRequest uses this exact URL
router.get('/mdm/devices/:deviceId/sim-info', protect, async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId })
      .select('deviceId simNumber simOperator lastSeen');
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({
      success:     true,
      deviceId:    device.deviceId,
      simNumber:   device.simNumber   || null,
      simOperator: device.simOperator || null,
      lastSeen:    device.lastSeen,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /api/change-password-admin  — body-based (apiService.js compat) ──
//    apiService changePasswordRequest sends { id?, oldPassword?, newPassword }
//    This is a general-purpose admin password change without :id param
const User = require('../models/User');
router.put('/change-password-admin', protect, adminOnly, async (req, res) => {
  try {
    const { id, newPassword } = req.body;
    if (!id || !newPassword)
      return res.status(400).json({ success: false, message: 'id and newPassword required' });
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;


