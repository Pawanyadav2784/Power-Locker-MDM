// ─────────────────────────────────────────────────────────────
//  routes/vendors.js  —  Vendor Management Routes
//  Logic: controllers/vendorController.js
//  Auth:  middleware/auth.js (protect, adminOnly)
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router  = express.Router();

const { protect, adminOnly }  = require('../middleware/auth');
const upload                  = require('../middleware/upload');
const {
  createVendor,
  getAllVendors,
  getVendor,
  updateVendor,
  updateVendorByBody,
  toggleVendorStatus,
  softDeleteVendor,
  hardDeleteVendor,
} = require('../controllers/vendorController');

// ── File upload fields ────────────────────────────────────
const uploadFields = upload.fields([
  { name: 'profileImage', maxCount: 1 },
  { name: 'logoImage',    maxCount: 1 },
  { name: 'document',     maxCount: 5 },
]);

// ── Create (3 aliases — same handler) ────────────────────
router.post('/create',          protect, uploadFields, createVendor);
router.post('/create-form',     protect, uploadFields, createVendor);   // alias
router.post('/register/vendor', protect, uploadFields, createVendor);   // v1 alias

// ── Body-based routes (id in body — apiService.js pattern)
router.put('/update',        protect, updateVendorByBody);
router.put('/toggle-active', protect, toggleVendorStatus);
router.put('/delete',        protect, softDeleteVendor);

// ── List & Read ───────────────────────────────────────────
router.get('/',    protect, getAllVendors);
router.get('/:id', protect, getVendor);

// ── Standard REST (id in URL) ─────────────────────────────
router.put('/:id',    protect, adminOnly, updateVendor);
router.delete('/:id', protect, adminOnly, hardDeleteVendor);

module.exports = router;
