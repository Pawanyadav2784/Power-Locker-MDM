const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  compatLogin,
  compatProfile,
  setSecurityPin,
  verifySecurityPin
} = require('../controllers/userCompatibilityController');

router.post('/login', compatLogin);
router.get('/profile', protect, compatProfile);
router.post('/setSecurityPin/add', protect, setSecurityPin);
router.post('/verifySecurityPin/add', protect, verifySecurityPin);

module.exports = router;
