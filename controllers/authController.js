const User = require('../models/User');
const { generateToken } = require('../middleware/auth');

// ─── Role → Panel + Redirect mapping ────────────────────────
// Ek hi login endpoint — role se auto detect hota hai kahan bhejna hai
const ROLE_MAP = {
  super_admin:       { panelType: 'admin',       redirectTo: '/' },
  super_distributor: { panelType: 'distributor',  redirectTo: '/sd-dashboard' },
  distributor:       { panelType: 'distributor',  redirectTo: '/d-dashboard' },
  sub_distributor:   { panelType: 'distributor',  redirectTo: '/sub-dashboard' },
  retailer:          { panelType: 'retailer',     redirectTo: '/retailer-dashboard' },
};

const getRoleInfo = (role) => ROLE_MAP[role] || { panelType: 'retailer', redirectTo: '/retailer-dashboard' };

// @desc    Login user (single endpoint for ALL roles)
// @route   POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password required' });

    const user = await User.findOne({ email }).select('+password +loginAttempts +lockUntil +activeToken');
    if (!user)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    // ── Account lock check ──────────────────────────────────
    if (user.lockUntil && user.lockUntil > Date.now()) {
      const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(429).json({
        success: false,
        message: `Account temporarily locked. Try again in ${minutesLeft} minute(s).`,
      });
    }

    // ── Password check ──────────────────────────────────────
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= 5) {
        user.lockUntil = new Date(Date.now() + 15 * 60 * 1000); // Lock 15 min
        user.loginAttempts = 0;
      }
      await user.save();
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!user.isActive)
      return res.status(403).json({ success: false, message: 'Account deactivated. Contact admin.' });

    // ── Reset failed attempts on success ────────────────────
    user.loginAttempts = 0;
    user.lockUntil = null;
    user.lastLoginAt = new Date();
    user.lastLoginIp = req.ip || req.headers['x-forwarded-for'] || '';
    user.lastLoginAgent = req.headers['user-agent'] || '';

    const token = generateToken(user._id);
    user.activeToken = token; // Single session: new login invalidates old token
    await user.save();

    const { panelType, redirectTo } = getRoleInfo(user.role);

    res.json({
      success:    true,
      message:    'Login successful',
      token,
      panelType,   // 'admin' | 'distributor' | 'retailer'  — frontend panel decide karne ke liye
      redirectTo,  // exact route → '/' | '/sd-dashboard' | '/d-dashboard' | '/sub-dashboard' | '/retailer-dashboard'
      role:        user.role,   // full role for extra checks
      user:        user.toPublicProfile(),
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Get profile
// @route   GET /api/auth/profile
const getProfile = async (req, res) => {
  res.json({ success: true, user: req.user });
};

// @desc    Update profile
// @route   PUT /api/auth/update
const updateProfile = async (req, res) => {
  try {
    const allowed = ['name', 'phone', 'company', 'city', 'state', 'address', 'gst', 'frpEmail'];
    allowed.forEach(f => { if (req.body[f] !== undefined) req.user[f] = req.body[f]; });
    await req.user.save();
    res.json({ success: true, user: req.user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Change own password (andar se — panel ke andar se karo)
// @route   PUT /api/auth/set-password
// @access  Protected — login hone ke baad hi milega
// ⚠️  Login page pe koi option nahi — sirf panel ke andar Settings mein
// Body: { newPassword, confirmPassword }
// Old password ki koi zaroorat NAHI
const changePasswordSelf = async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;

    if (!newPassword || !confirmPassword)
      return res.status(400).json({ success: false, message: 'newPassword aur confirmPassword dono required hain' });

    if (newPassword !== confirmPassword)
      return res.status(400).json({ success: false, message: 'Passwords match nahi kar rahe' });

    if (newPassword.length < 6)
      return res.status(400).json({ success: false, message: 'Password kam se kam 6 characters ka hona chahiye' });

    const user = await User.findById(req.user._id);
    user.password = newPassword;   // pre-save hook mein bcrypt hash hoga
    await user.save();

    res.json({ success: true, message: '✅ Password successfully change ho gaya' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Toggle user active/inactive (Admin)
// @route   PUT /api/auth/active-deactive/:id
const toggleActive = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.isActive = !user.isActive;
    await user.save();
    res.json({ success: true, message: `User ${user.isActive ? 'activated' : 'deactivated'}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Change another user's password (Admin)
// @route   PUT /api/auth/change-password-admin/:id
const changePasswordAdmin = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.password = req.body.newPassword;
    await user.save();
    res.json({ success: true, message: 'Password updated by admin' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Logout
// @route   GET /api/auth/logout
const logout = (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
};

module.exports = {
  login,
  getProfile,
  updateProfile,
  changePasswordSelf,      // ✅ Panel ke andar — new + confirm (old ki zaroorat nahi)
  changePasswordAdmin,     // ✅ Admin kisi bhi user ka password change kare
  toggleActive,
  logout,
};
