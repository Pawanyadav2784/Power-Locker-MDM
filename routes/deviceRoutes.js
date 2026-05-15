const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const {
  getAllDevices, getDevice, registerDevice, updateDevice, deleteDevice,
  getStatistics, checkIn, updateDeviceInfo,
  lockDevice, unlockDevice, rebootDevice, wipeDevice,
  getLocation, sendMessage, playAlert, unenrollDevice,
  installApp, removeApp, getSimNumber, getNumber,
  updateCommandStatus, bulkCommand, setKioskMode,
  getDeviceCommands, softReset, hardReset,
} = require('../controllers/deviceController');

// ── Public (MDM App — no auth) ────────────────────────────
router.post('/check-in',              checkIn);
router.post('/command/update-status', updateCommandStatus);
router.post('/update-info',           updateDeviceInfo);

// ── Statistics (before /:id) ──────────────────────────────
router.get('/statistics',             protect, getStatistics);
router.get('/search',                 protect, getAllDevices);  // search via query params
router.get('/sim/:deviceId',          protect, getSimNumber);

// ── CRUD ─────────────────────────────────────────────────
router.get('/',                       protect, getAllDevices);
router.post('/register',              protect, registerDevice);
router.get('/:id',                    protect, getDevice);
router.put('/:id',                    protect, updateDevice);
router.delete('/:id',                 protect, deleteDevice);

// ── Command History ───────────────────────────────────────
router.get('/:id/commands',           protect, getDeviceCommands);

// ── Lock / Unlock ─────────────────────────────────────────
router.post('/lock',                  protect, lockDevice);
router.post('/unlock',                protect, unlockDevice);

// ── MDM Commands ─────────────────────────────────────────
router.post('/reboot',                protect, rebootDevice);
router.post('/wipe',                  protect, wipeDevice);
router.post('/soft-reset',            protect, softReset);
router.post('/hard-reset',            protect, hardReset);
router.post('/get-location',          protect, getLocation);
router.post('/message',               protect, sendMessage);
router.post('/play-alert',            protect, playAlert);
router.post('/unenroll',              protect, unenrollDevice);
router.post('/get-number',            protect, getNumber);

// ── App Management ────────────────────────────────────────
router.post('/install-app',           protect, installApp);
router.post('/remove-app',            protect, removeApp);

// ── Bulk & Kiosk ─────────────────────────────────────────
router.post('/bulk-command',          protect, bulkCommand);
router.post('/kiosk',                 protect, setKioskMode);

// ── Location (GET last known) ─────────────────────────────
router.get('/location/:deviceId', protect, async (req, res) => {
  const Device = require('../models/Device');
  try {
    const d = await Device.findOne({ deviceId: req.params.deviceId }).select('deviceId lastLocation lastSeen');
    if (!d) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, deviceId: d.deviceId, location: d.lastLocation, lastSeen: d.lastSeen });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
