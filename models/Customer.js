const mongoose = require('mongoose');

const emiPaymentSchema = new mongoose.Schema({
  amount:      { type: Number, required: true },
  paidAt:      { type: Date, default: Date.now },
  method:      { type: String, enum: ['cash', 'online', 'upi', 'bank', 'other'], default: 'cash' },
  referenceNo: { type: String, default: '' },
  note:        { type: String, default: '' },
  recordedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { _id: true });

const customerSchema = new mongoose.Schema({
  // ── Personal Details ───────────────────────────────────────
  name:           { type: String, required: true, trim: true },
  fatherName:     { type: String, default: '' },
  phone:          { type: String, required: true },
  alternatePhone: { type: String, default: '' },
  email:          { type: String, default: '' },
  address:        { type: String, default: '' },
  city:           { type: String, default: '' },
  state:          { type: String, default: '' },
  pincode:        { type: String, default: '' },
  aadhar:         { type: String, default: '' },
  pan:            { type: String, default: '' },

  // ── Key Type ───────────────────────────────────────────────
  keyType: {
    type: String,
    enum: ['new_key', 'running_key', 'iphone_key'],
    default: 'new_key',
  },

  // ── Device Details ────────────────────────────────────────
  imei1:       { type: String, default: '' },
  imei2:       { type: String, default: '' },
  mobileNo:    { type: String, default: '' },

  // ── Loan Provider ─────────────────────────────────────────
  loanProvider: { type: String, default: '' },

  // ── Product Details ────────────────────────────────────────
  productName:    { type: String, default: '' },
  productPrice:   { type: Number, default: 0 },
  downPayment:    { type: Number, default: 0 },
  balancePayment: { type: Number, default: 0 },

  // ── Payment Type ───────────────────────────────────────────
  paymentType: {
    type: String,
    enum: ['with_emi', 'without_emi', 'ecs', 'e_mandate'],
    default: 'with_emi',
  },

  // ── EMI Details ────────────────────────────────────────────
  emiType: {
    type: String,
    enum: ['daily', 'weekly', 'monthly'],
    default: 'monthly',
  },
  emiMonths:     { type: Number, default: 0 },
  interestRate:  { type: Number, default: 0 },
  monthlyEmi:    { type: Number, default: 0 },
  emiPaid:       { type: Number, default: 0 },
  emiRemaining:  { type: Number, default: 0 },
  totalPaid:     { type: Number, default: 0 },
  totalAmount:   { type: Number, default: 0 },  // Full loan amount
  loanStartDate:  { type: Date },
  emiStartDate:   { type: Date },    // Next month ki EMI date
  nextEmiDate:    { type: Date },
  lastEmiDate:   { type: Date },
  overdueCount:  { type: Number, default: 0 },
  overdueAmount: { type: Number, default: 0 },

  // ── EMI Payment History ────────────────────────────────────
  emiHistory: [emiPaymentSchema],

  // ── Status ────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['pending', 'active', 'locked', 'completed', 'defaulted', 'closed'],
    default: 'pending',
  },

  // ── MDM Control ───────────────────────────────────────────
  isDeviceLocked:   { type: Boolean, default: false },
  lockReason:       { type: String, default: '' },   // 'emi_overdue' | 'manual' | 'expired'
  lastLockedAt:     { type: Date },
  lastUnlockedAt:   { type: Date },
  autoLockEnabled:  { type: Boolean, default: true }, // Auto lock on EMI due
  lockGraceDays:    { type: Number, default: 3 },     // Days after due before auto-lock

  // ── Documents ──────────────────────────────────────────────
  agreementUrl:       { type: String, default: '' },
  photo:              { type: String, default: '' },   // Customer image
  customerSignature:  { type: String, default: '' },   // Signature image URL
  aadharPhoto:        { type: String, default: '' },
  panPhoto:           { type: String, default: '' },

  // ── Notes ─────────────────────────────────────────────────
  internalNotes: { type: String, default: '' },
  tags:          [{ type: String }],

  // ── Linked Refs ───────────────────────────────────────────
  deviceId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Device', default: null },
  retailerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  qrCode:     { type: String, default: '' }, // Device ID embedded in QR
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

}, { timestamps: true });

// ── Indexes ───────────────────────────────────────────────
customerSchema.index({ phone: 1 });
customerSchema.index({ retailerId: 1, status: 1 });
customerSchema.index({ nextEmiDate: 1, status: 1 });
customerSchema.index({ qrCode: 1 });

module.exports = mongoose.model('Customer', customerSchema);
