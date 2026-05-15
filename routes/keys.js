// ─────────────────────────────────────────────────────────────
//  routes/keys.js  —  Power Locker MDM
//  Key / Wallet Management Routes
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router  = express.Router();

const { protect, adminOnly } = require('../middleware/auth');
const {
  generateKeys, generateSelf, bulkCredit, setBalance,
  transferKeys,
  creditKeys, debitKey, creditFoc, getBalance,
  getLedger, getLedgerAll, getLedgerSummary, getLedgerByUser,
  getMyKeys, requestKeys, approveKeyRequest, getKeyRequests,
  adminTransfer,
  getChildrenByParent,
  getDescendantsByUser,
} = require('../controllers/keyController');

// ── Super Admin — Unlimited Key Generation ──
router.post('/generate',      protect, adminOnly, generateKeys);
router.post('/generate-self', protect, adminOnly, generateSelf);
router.post('/bulk-credit',   protect, adminOnly, bulkCredit);
router.put ('/set-balance',   protect, adminOnly, setBalance);

// ── Admin Hierarchy Transfer (panel se kisi ke andar) ──
router.post('/admin-transfer',      protect, adminOnly, adminTransfer);          // POST { fromUserId, toUserId, amount }
router.get ('/children/:parentId',  protect, adminOnly, getChildrenByParent);    // GET  direct children
router.get ('/descendants/:userId', protect, adminOnly, getDescendantsByUser);   // GET  all descendants (BFS)

// ── Hierarchy Transfer (sab roles use kar sakte hain) ──
router.post('/transfer', protect, transferKeys);

// ── Standard Ops ──
router.post('/credit',     protect, adminOnly, creditKeys);
router.post('/debit',      protect,            debitKey);
router.post('/credit-foc', protect, adminOnly, creditFoc);
router.get ('/balance',    protect,            getBalance);

// ── Ledger ──
router.get('/ledger/all',          protect, adminOnly, getLedgerAll);
router.get('/ledger/summary',      protect, adminOnly, getLedgerSummary);
router.get('/ledger/user/:userId', protect, adminOnly, getLedgerByUser);
router.get('/ledger',              protect,            getLedger);

// ── Key Requests ──
router.post('/request/approve', protect, adminOnly, approveKeyRequest);
router.get ('/requests',        protect, adminOnly, getKeyRequests);
router.post('/request',         protect,            requestKeys);

// ── My Stats ──
router.get('/my-keys', protect, getMyKeys);

module.exports = router;

