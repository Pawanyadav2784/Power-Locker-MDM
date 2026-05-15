const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ─── Generate JWT ─────────────────────────────────────────
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  });
};

// ─── Protect: Verify token + single session check ────────
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer '))
      return res.status(401).json({
        success: false,
        code: 'NO_TOKEN',
        message: 'Access denied. No token provided.',
      });

    const token   = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Select -password but include isDeleted, isActive, activeToken for checks
    const user = await User.findById(decoded.id)
      .select('-password');

    if (!user)
      return res.status(401).json({
        success: false,
        code: 'USER_NOT_FOUND',
        message: 'User not found. Token invalid.',
      });

    // ── Soft-deleted user ──────────────────────────────────
    if (user.isDeleted)
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_DELETED',
        message: 'This account has been removed. Contact admin.',
      });

    // ── Deactivated user ────────────────────────────────
    if (!user.isActive)
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_DEACTIVATED',
        message: 'Account is deactivated. Contact admin.',
      });

    // ── Single Session: reject old token if new login happened ──
    if (user.activeToken && user.activeToken !== token)
      return res.status(401).json({
        success: false,
        code: 'SESSION_EXPIRED',
        message: 'Session expired. You have logged in from another device.',
      });

    req.user  = user;
    req.token = token;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError')
      return res.status(401).json({
        success: false,
        code: 'TOKEN_EXPIRED',
        message: 'Session expired. Please login again.',
      });
    return res.status(401).json({
      success: false,
      code: 'INVALID_TOKEN',
      message: 'Invalid token.',
    });
  }
};

// ─── Admin only ───────────────────────────────────────────
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'super_admin')
    return res.status(403).json({ success: false, message: 'Super Admin access required.' });
  next();
};

// ─── Role guard — pass allowed roles array ────────────────
const roleGuard = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role))
    return res.status(403).json({
      success: false,
      message: `Access restricted. Required roles: ${roles.join(', ')}`,
    });
  next();
};

// ─── Hierarchy guard: can only manage roles below you ─────
const hierarchyOrder = ['super_admin', 'super_distributor', 'distributor', 'sub_distributor', 'retailer'];

const canManage = (targetRole) => (req, res, next) => {
  const myIndex     = hierarchyOrder.indexOf(req.user?.role);
  const targetIndex = hierarchyOrder.indexOf(targetRole);
  if (myIndex === -1 || targetIndex === -1 || myIndex >= targetIndex)
    return res.status(403).json({ success: false, message: 'You cannot manage this role.' });
  next();
};

// ─── Device Secret — Android app ke liye (no JWT, secret key) ──
// .env mein DEVICE_SECRET=your_secret_here set karo
const verifyDeviceSecret = (req, res, next) => {
  const secret = req.headers['x-device-secret'] || req.body?.deviceSecret;
  if (!secret || secret !== process.env.DEVICE_SECRET) {
    // Backward compat — agar DEVICE_SECRET .env mein nahi set toh allow karo
    if (!process.env.DEVICE_SECRET) return next();
    return res.status(401).json({ success: false, message: 'Invalid device secret' });
  }
  next();
};

module.exports = { generateToken, protect, adminOnly, roleGuard, canManage, verifyDeviceSecret };
