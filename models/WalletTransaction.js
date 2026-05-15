const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────
//  WalletTransaction Model  —  Power Locker MDM
//  Har transaction record hota hai yahan
//
//  Transfer case mein:
//    Sender  → type: 'debit',  toUserId   = receiver
//    Receiver → type: 'credit', fromUserId = sender
// ─────────────────────────────────────────────────────────────
const walletTransactionSchema = new mongoose.Schema({

  // Jis user ka ye transaction hai
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Transaction type
  type: {
    type: String,
    enum: ['credit', 'debit', 'credit_foc', 'request', 'transfer'],
    required: true,
  },

  // Key type
  keyType: {
    type: String,
    enum: ['android', 'running_key', 'iphone'],
    default: 'running_key',
  },

  amount:        { type: Number, required: true },
  balanceBefore: { type: Number, default: 0 },
  balanceAfter:  { type: Number, default: 0 },
  description:   { type: String, default: '' },
  referenceId:   { type: String, default: '' }, // device ID or order ID

  // ── Transfer tracking ─────────────────────────────────────
  // Sender ne kise bheja (sender ke debit record mein)
  toUserId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Kisne bheja (receiver ke credit record mein)
  fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Note — internal tag (admin_generate, admin_credit, admin_set, admin_foc)
  note: { type: String, default: '' },

  // Status — sirf 'request' type ke liye relevant
  status: {
    type: String,
    enum: ['pending', 'completed', 'approved', 'rejected'],
    default: function () {
      return this.type === 'request' ? 'pending' : 'completed';
    },
  },

  // Kisne create kiya ye transaction
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

}, { timestamps: true });

// Index for fast ledger queries
walletTransactionSchema.index({ userId: 1, createdAt: -1 });
walletTransactionSchema.index({ toUserId: 1, createdAt: -1 });
walletTransactionSchema.index({ fromUserId: 1, createdAt: -1 });
walletTransactionSchema.index({ type: 1, status: 1 });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
