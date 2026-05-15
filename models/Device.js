const mongoose = require('mongoose');

// ── Auto-increment Device ID counter ──────────────────────
const counterSchema = new mongoose.Schema({
  name:  { type: String, required: true, unique: true },
  value: { type: Number, default: 0 },
});
const Counter = mongoose.model('Counter', counterSchema);

// ── App Policy Schema ──────────────────────────────────────
const appPolicySchema = new mongoose.Schema({
  packageName: { type: String },
  blocked:     { type: Boolean, default: false },
  hidden:      { type: Boolean, default: false },
}, { _id: false });

const deviceSchema = new mongoose.Schema({
  // ── Identity ───────────────────────────────────────────────
  deviceId:       { type: String, unique: true },   // Auto: 2026-00001
  imei:           { type: String, default: '' },
  imei2:          { type: String, default: '' },
  serialNumber:   { type: String, default: '' },
  deviceName:     { type: String, default: '' },
  brand:          { type: String, default: '' },
  model:          { type: String, default: '' },
  androidVersion: { type: String, default: '' },
  sdkVersion:     { type: String, default: '' },
  manufacturer:   { type: String, default: '' },

  // ── Network ────────────────────────────────────────────────
  fcmToken:    { type: String, default: '' },
  simNumber:   { type: String, default: '' },
  simNumber2:  { type: String, default: '' },
  simOperator: { type: String, default: '' },
  macAddress:  { type: String, default: '' },
  ipAddress:   { type: String, default: '' },

  // ── Hardware Status ────────────────────────────────────────
  batteryLevel:    { type: Number, default: 0 },
  isCharging:      { type: Boolean, default: false },
  storageTotal:    { type: Number, default: 0 },   // MB
  storageFree:     { type: Number, default: 0 },   // MB
  ramTotal:        { type: Number, default: 0 },   // MB
  ramFree:         { type: Number, default: 0 },   // MB

  // ── Lock / MDM Status ──────────────────────────────────────
  isLocked:        { type: Boolean, default: false },
  lockMessage:     { type: String, default: '' },
  lockPhone:       { type: String, default: '' },   // Number to show on lock screen
  isEnrolled:      { type: Boolean, default: false },
  isDeviceOwner:   { type: Boolean, default: false },
  mdmActive:       { type: Boolean, default: false },

  // ── Key / Subscription ────────────────────────────────────
  keyType: {
    type: String,
    enum: ['android', 'running_key', 'iphone'],
    default: 'running_key',
  },
  keyExpiryDate:   { type: Date },                  // When MDM key expires
  keyActivatedAt:  { type: Date },

  // ── Device Status ─────────────────────────────────────────
  status: {
    type: String,
    enum: ['pending', 'active', 'locked', 'removed', 'unenrolled', 'expired'],
    default: 'pending',
  },

  // ── Location ──────────────────────────────────────────────
  lastLocation: {
    lat:       { type: Number, default: 0 },
    lng:       { type: Number, default: 0 },
    address:   { type: String, default: '' },
    accuracy:  { type: Number, default: 0 },
    timestamp: { type: Date },
  },

  // ── App Policy ────────────────────────────────────────────
  appPolicy:         [appPolicySchema],
  kioskMode:         { type: Boolean, default: false },
  kioskPackageName:  { type: String, default: '' },
  screenTimeout:     { type: Number, default: 0 },  // Seconds; 0 = default

  // ── Linked Refs ───────────────────────────────────────────
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  retailerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // ── Timestamps ────────────────────────────────────────────
  lastSeen:   { type: Date, default: Date.now },
  enrolledAt: { type: Date },
  lastCommandAt: { type: Date },

  // ── Notes ─────────────────────────────────────────────────
  notes: { type: String, default: '' },

}, { timestamps: true });

// ── Auto-generate DeviceId before first save ──────────────
deviceSchema.pre('save', async function (next) {
  if (this.deviceId) return next();
  const year = new Date().getFullYear();
  const counter = await Counter.findOneAndUpdate(
    { name: 'deviceId' },
    { $inc: { value: 1 } },
    { new: true, upsert: true }
  );
  this.deviceId = `${year}-${String(counter.value).padStart(5, '0')}`;
  next();
});

// ── Indexes ───────────────────────────────────────────────
deviceSchema.index({ deviceId: 1 });
deviceSchema.index({ retailerId: 1, status: 1 });
deviceSchema.index({ imei: 1 });
deviceSchema.index({ fcmToken: 1 });
deviceSchema.index({ customerId: 1 });

module.exports = mongoose.model('Device', deviceSchema);
