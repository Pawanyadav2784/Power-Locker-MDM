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
const upload = require('../middleware/upload');
const {
  changeManagedPassword,
  changeOwnPassword,
  createVendor,
  getVendor,
  hierarchy,
  listVendors,
  toggleVendor,
  updateFrpEmail,
  updateVendor,
  uploadDocument,
  uploadProfile,
} = require('../controllers/vendorCompatibilityController');

const {
  login,
  getProfile,
  updateProfile,
  changePasswordSelf,
  changeAdminCredentials,
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
router.put('/admin-credentials', protect, adminOnly, changeAdminCredentials);

router.get('/logout', protect, logout);            // GET — session clear

// P Locker compatibility aliases. Existing auth/vendor APIs remain unchanged.
const vendorUpload = upload.fields([
  { name: 'profileImage', maxCount: 1 },
  { name: 'image', maxCount: 1 },
  { name: 'signature', maxCount: 1 },
]);

router.post('/vendor/create-form', protect, vendorUpload, createVendor);
router.post('/register/vendor', protect, vendorUpload, createVendor);
router.get('/vendor/all', protect, listVendors);
router.get('/vendor/hierarchy', protect, hierarchy);
router.put('/vendor/toggle', protect, toggleVendor);
router.put('/vendor/update/:id', protect, vendorUpload, updateVendor);
router.put('/vendor/update', protect, vendorUpload, updateVendor);
router.get('/vendor/:id', protect, getVendor);

router.put('/change-password', protect, changeOwnPassword);
router.put('/change-password-admin', protect, changeManagedPassword);
router.put('/frp-email/update', protect, updateFrpEmail);
router.put('/upload/profile', protect, upload.single('image'), uploadProfile);
router.put('/upload/id', protect, upload.single('image'), uploadDocument);

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
