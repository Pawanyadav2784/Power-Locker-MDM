// ─────────────────────────────────────────────────────────────
//  routes/auth.js  —  Power Locker MDM
//
//  ✅ LOGIN: Ek hi endpoint — saare roles ke liye
//  ❌ Login page pe koi forgot/change password ka option NAHI
//  ✅ Password change: Sirf panel ke ANDAR se ho sakta hai
//     (old password ki zaroorat NAHI — sirf new + confirm)
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const { protect, adminOnly } = require('../middleware/auth');

const {
  login,
  getProfile,
  updateProfile,
  changePasswordSelf,
  changePasswordAdmin,
  toggleActive,
  logout,
} = require('../controllers/authController');

// ══════════════════════════════════════════════════════════
//  🔓 PUBLIC — Token NAHI chahiye (sirf login)
// ══════════════════════════════════════════════════════════

// ✅ SINGLE LOGIN for ALL roles
// POST /api/auth/login
// Body:     { email, password }
// Response: { success, token, panelType, redirectTo, role, user }
router.post('/login', login);

// ══════════════════════════════════════════════════════════
//  🔐 PROTECTED — Bearer token required (panel ke andar)
// ══════════════════════════════════════════════════════════

router.get('/profile', protect, getProfile);       // GET — apna profile dekho
router.put('/update',  protect, updateProfile);    // PUT { name, phone, city, ... }

// ✅ Password change — PANEL KE ANDAR SE (old password ki zaroorat nahi)
// PUT /api/auth/set-password
// Body: { newPassword, confirmPassword }
router.put('/set-password', protect, changePasswordSelf);

router.get('/logout', protect, logout);            // GET — session clear

// ══════════════════════════════════════════════════════════
//  👑 ADMIN ONLY
// ══════════════════════════════════════════════════════════

// Admin kisi bhi user ko on/off kare
router.put('/active-deactive/:id', protect, adminOnly, toggleActive);

// Admin kisi bhi user ka password change kare (old ki zaroorat nahi)
// PUT /api/auth/change-password-admin/:id
// Body: { newPassword }
router.put('/change-password-admin/:id', protect, adminOnly, changePasswordAdmin);

module.exports = router;
