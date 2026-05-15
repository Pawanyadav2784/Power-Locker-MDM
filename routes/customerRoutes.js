const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const {
  addCustomer, getAllCustomers, getCustomerById,
  updateCustomer, deleteCustomer,
  customerAction, keyAction,
  linkDevice, unlinkDevice,
  recordEmiPayment, getEmiHistory,
  getOverdueCustomers, searchCustomers,
  bulkAction, autoLockOverdue, getCustomerStats,
} = require('../controllers/customerController');

// ── Stats & Search (specific routes first) ─────────────────
router.get('/stats',                protect, getCustomerStats);
router.get('/search',               protect, searchCustomers);
router.get('/overdue',              protect, getOverdueCustomers);

// ── Bulk / Auto-lock ──────────────────────────────────────
router.post('/bulk-action',         protect, bulkAction);
router.post('/auto-lock-overdue',   protect, autoLockOverdue);

// ── MDM Actions ───────────────────────────────────────────
router.post('/action',              protect, customerAction);
router.post('/key-action',          protect, keyAction);   // Retailer APK alias

// ── CRUD ─────────────────────────────────────────────────
router.post('/add',                 protect, addCustomer);
router.get('/',                     protect, getAllCustomers);
router.get('/getAllCustomerWithDevices', protect, getAllCustomers); // backward compat
router.get('/:id',                  protect, getCustomerById);
router.post('/getCustomerById',     protect, getCustomerById);     // backward compat
router.put('/:id',                  protect, updateCustomer);
router.delete('/:id',               protect, deleteCustomer);

// ── Device Linking ────────────────────────────────────────
router.post('/:id/link-device',     protect, linkDevice);
router.post('/:id/unlink-device',   protect, unlinkDevice);

// ── EMI ───────────────────────────────────────────────────
router.get('/:id/emi',              protect, getEmiHistory);
router.post('/:id/emi/pay',         protect, recordEmiPayment);

module.exports = router;
