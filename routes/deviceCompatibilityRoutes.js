const express = require('express');
const { protect } = require('../middleware/auth');
const {
  getPLockerDeviceQr,
  getPLockerDeviceQrImage,
} = require('../controllers/deviceQrController');

const router = express.Router();

router.get('/:id/qr.png', getPLockerDeviceQrImage);
router.get('/:id/qr', protect, getPLockerDeviceQr);

module.exports = router;
