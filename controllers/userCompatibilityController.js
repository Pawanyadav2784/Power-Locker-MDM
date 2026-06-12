const User = require('../models/User');
const { generateToken } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

/**
 * @desc    Distributor / User Compatibility Login
 * @route   POST /user/login
 */
const compatLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Email and password are required.'
      });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: 'Invalid credentials.'
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: 'Invalid credentials.'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        status: 403,
        message: 'Account is deactivated. Contact admin.'
      });
    }

    user.lastLoginAt = new Date();
    user.lastLoginIp = req.ip || (req.headers && req.headers['x-forwarded-for']) || '';
    user.lastLoginAgent = (req.headers && req.headers['user-agent']) || '';
    await user.save();

    const token = generateToken(user._id);

    return res.json({
      success: true,
      status: 200,
      message: 'Login successful',
      token,
      user: user.toPublicProfile()
    });
  } catch (err) {
    console.error('Distributor login compatibility error:', err);
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || 'Login failed.'
    });
  }
};

/**
 * @desc    Get User Profile Compatibility
 * @route   GET /user/profile
 */
const compatProfile = async (req, res) => {
  try {
    return res.json({
      success: true,
      status: 200,
      user: req.user.toPublicProfile ? req.user.toPublicProfile() : req.user
    });
  } catch (err) {
    console.error('Profile fetch compatibility error:', err);
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || 'Profile fetch failed.'
    });
  }
};

/**
 * @desc    Set Security PIN
 * @route   POST /user/setSecurityPin/add
 */
const setSecurityPin = async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || String(pin).length < 4) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'PIN must be at least 4 digits.'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPin = await bcrypt.hash(String(pin), salt);

    const user = await User.findById(req.user._id);
    user.securityPin = hashedPin;
    await user.save();

    return res.json({
      success: true,
      status: 200,
      message: 'Security PIN set successfully.'
    });
  } catch (err) {
    console.error('Set security PIN error:', err);
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || 'Set security PIN failed.'
    });
  }
};

/**
 * @desc    Verify Security PIN
 * @route   POST /user/verifySecurityPin/add
 */
const verifySecurityPin = async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'PIN is required.'
      });
    }

    const user = await User.findById(req.user._id).select('+securityPin');
    if (!user.securityPin) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Security PIN has not been set.'
      });
    }

    const isMatch = await bcrypt.compare(String(pin), user.securityPin);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: 'Incorrect security PIN.'
      });
    }

    return res.json({
      success: true,
      status: 200,
      message: 'Security PIN verified successfully.'
    });
  } catch (err) {
    console.error('Verify security PIN error:', err);
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || 'Verify security PIN failed.'
    });
  }
};

module.exports = {
  compatLogin,
  compatProfile,
  setSecurityPin,
  verifySecurityPin
};
