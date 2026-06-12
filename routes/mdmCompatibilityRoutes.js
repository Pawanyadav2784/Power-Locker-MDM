const express = require('express');
const { protect } = require('../middleware/auth');
const {
  commandAlias,
  getDeviceLocationPLocker,
  getDeviceSimInfoPLocker,
  getDevicesPLocker,
  sendDeviceCommandPLocker,
} = require('../controllers/mdmCompatibilityController');

const router = express.Router();

router.get('/devices', protect, getDevicesPLocker);
router.get('/devices/:identifier/location', protect, getDeviceLocationPLocker);
router.get('/devices/:identifier/sim-info', protect, getDeviceSimInfoPLocker);

router.post('/device/sendCommand', protect, sendDeviceCommandPLocker);
router.post('/device/lock', protect, commandAlias('LOCK_DEVICE'));
router.post('/device/unlock', protect, commandAlias('UNLOCK_DEVICE'));

module.exports = router;
