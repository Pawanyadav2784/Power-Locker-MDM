const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ─── Image/File sub-schema ────────────────────────────────
const fileSchema = new mongoose.Schema({
  url:        { type: String, default: null },
  filename:   { type: String, default: null },
  mimetype:   { type: String, default: null },
  size:       { type: Number, default: null },
  uploadedAt: { type: Date,   default: null },
}, { _id: false });

// ─── Document sub-schema ──────────────────────────────────
const documentSchema = new mongoose.Schema({
  type:       { type: String, default: '' },   // e.g. 'aadhar', 'pan', 'gst'
  url:        { type: String, default: null },
  filename:   { type: String, default: null },
  uploadedAt: { type: Date,   default: null },
  verified:   { type: Boolean, default: false },
}, { _id: true });

// ═════════════════════════════════════════════════════════
//  User Schema
// ═════════════════════════════════════════════════════════
const userSchema = new mongoose.Schema({

  // ─── Core Identity ─────────────────────────────────────
  name:     { type: String, required: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:    { type: String, required: true },
  password: { type: String, required: true },

  // ─── Business Info ─────────────────────────────────────
  company:         { type: String, default: '' },
  city:            { type: String, default: '' },
  state:           { type: String, default: '' },
  address:         { type: String, default: '' },
  gst:             { type: String, default: '' },
  frpEmail:        { type: String, default: '' },
  growthExecutive: { type: String, default: '' },   // dropdown in form

  // ─── Role & Hierarchy ──────────────────────────────────
  role: {
    type: String,
    enum: ['super_admin', 'super_distributor', 'distributor', 'sub_distributor', 'retailer'],
    default: 'retailer',
  },

  // userType — for compatibility with other project's response format
  // Maps: super_admin→'admin' | distributors→'vendor' | retailer→'retailer'
  userType: {
    type: String,
    enum: ['admin', 'vendor', 'retailer'],
    default: 'vendor',
  },

  // type — "company" for super_distributor/distributor, "individual" for retailer
  type: { type: String, default: 'company' },

  // companyId = self _id (set after creation, used by other project's token format)
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // parentId = who created this user (their manager)
  parentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  isActive:   { type: Boolean, default: true },
  isVerified: { type: Boolean, default: false },

  // ─── KYC ───────────────────────────────────────────────
  kycStatus: {
    type: String,
    enum: ['pending', 'submitted', 'approved', 'rejected'],
    default: 'pending',
  },

  // ─── Profile & Documents ───────────────────────────────
  profileImage: { type: fileSchema, default: () => ({}) },
  logoImage:    { type: fileSchema, default: () => ({}) },
  documents:    [documentSchema],

  // ─── OTP ───────────────────────────────────────────────
  otp:       { type: String, default: null },
  otpExpiry: { type: Date,   default: null },

  // ─── Wallet Balances ───────────────────────────────────
  androidBalance:    { type: Number, default: 0 },
  runningKeyBalance: { type: Number, default: 0 },
  iphoneBalance:     { type: Number, default: 0 },

  // ─── Single Session ────────────────────────────────────
  activeToken:    { type: String, default: null },
  lastLoginAt:    { type: Date,   default: null },
  lastLoginIp:    { type: String, default: null },
  lastLoginAgent: { type: String, default: null },

  // ─── Login Throttling ──────────────────────────────────
  loginAttempts: { type: Number, default: 0 },
  lockUntil:     { type: Date,   default: null },

  // ─── Soft Delete ───────────────────────────────────────
  isDeleted:     { type: Boolean, default: false },
  deletedAt:     { type: Date,    default: null },
  deletedReason: { type: String,  default: '' },

}, { timestamps: true });

// ─── Auto-set companyId + userType + type on create ──────
userSchema.pre('save', async function (next) {
  // Hash password
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }

  // Set companyId = own _id (if not set)
  if (!this.companyId) {
    this.companyId = this._id;
  }

  // Auto-set userType based on role
  if (this.isModified('role') || this.isNew) {
    if (this.role === 'super_admin') {
      this.userType = 'admin';
      this.type     = 'company';
    } else if (this.role === 'retailer') {
      this.userType = 'retailer';
      this.type     = 'individual';
    } else {
      // super_distributor, distributor, sub_distributor
      this.userType = 'vendor';
      this.type     = 'company';
    }
  }

  next();
});

// ─── Match password ───────────────────────────────────────
userSchema.methods.matchPassword = async function (entered) {
  return await bcrypt.compare(entered, this.password);
};

// ─── Is account locked (too many failed attempts)? ────────
userSchema.methods.isLocked = function () {
  return this.lockUntil && this.lockUntil > Date.now();
};

// ─── Get redirect URL based on role ───────────────────────
userSchema.methods.getRedirectPath = function () {
  const paths = {
    super_admin:       '/',
    super_distributor: '/sd-dashboard',
    distributor:       '/d-dashboard',
    sub_distributor:   '/sub-dashboard',
    retailer:          '/retailer-dashboard',
  };
  return paths[this.role] || '/';
};

// ─── Panel type for login response ────────────────────────
userSchema.methods.getPanelType = function () {
  if (this.role === 'super_admin')  return 'admin';
  if (this.role === 'retailer')     return 'retailer';
  return 'distributor';
};

// ─── Rich profile response (matches other project format) ─
userSchema.methods.toPublicProfile = function () {
  return {
    _id:          this._id,
    id:           this._id,
    email:        this.email,
    name:         this.name,
    phone:        this.phone,
    type:         this.type,
    companyId:    this.companyId || this._id,
    company:      this.company,
    userType:     this.userType,
    role:         this.role,
    parentId:     this.parentId,
    // ✅ 'parent' alias — frontend's getResolvedParent() reads item.parent
    // After .populate('parentId'), this.parentId becomes the full parent object
    parent:       this.parentId,
    city:         this.city,
    state:        this.state,
    address:      this.address,
    gst:          this.gst,
    growthExecutive: this.growthExecutive,
    profileImage: this.profileImage || { url: null, filename: null, mimetype: null, size: null, uploadedAt: null },
    logoImage:    this.logoImage    || { url: null, filename: null, mimetype: null, size: null, uploadedAt: null },
    documents:    this.documents    || [],
    kycStatus:    this.kycStatus,
    isActive:     this.isActive,
    isVerified:   this.isVerified,
    // ✅ Universal key balance — sabka ek hi field (running_key is the master)
    balance:           this.runningKeyBalance || 0,   // frontend reads data.balance
    runningKeyBalance: this.runningKeyBalance  || 0,
    androidBalance:    this.androidBalance     || 0,
    iphoneBalance:     this.iphoneBalance      || 0,
    lastLoginAt:  this.lastLoginAt,
    createdAt:    this.createdAt,
  };
};


// ─── Safe object (backward compat) ────────────────────────
userSchema.methods.toSafeObject = function () {
  return this.toPublicProfile();
};

module.exports = mongoose.model('User', userSchema);
