// ─────────────────────────────────────────────────────────────
//  controllers/vendorController.js
//  Strict Parent Hierarchy:
//  super_admin       → Super Distributor (no parent)
//  Super Distributor → Distributor       (parentId = SD._id)
//  Distributor       → Sub Distributor   (parentId = D._id)
//  Sub Distributor   → Retailer          (parentId = SubD._id)
// ─────────────────────────────────────────────────────────────
const User   = require('../models/User');
const { generateToken } = require('../middleware/auth');

// ── Who can create whom ────────────────────────────────────
const CAN_CREATE = {
  super_admin:       ['super_distributor', 'distributor', 'sub_distributor', 'retailer'],
  super_distributor: ['distributor', 'sub_distributor'],
  distributor:       ['sub_distributor', 'retailer'],
  sub_distributor:   ['retailer'],
  retailer:          [],
};

// ── Required parent role for each target role ─────────────
// null = no parent needed (Super Admin creates Super Distributor)
const REQUIRED_PARENT_ROLE = {
  super_distributor: null,
  distributor:       'super_distributor',
  sub_distributor:   'distributor',
  retailer:          'sub_distributor',
};

// ── Normalize incoming type string → DB role ──────────────
const normalizeType = (type = '') => {
  const t = type.toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (t.includes('super') && t.includes('dist')) return 'super_distributor';
  if (t.includes('sub')   && t.includes('dist')) return 'sub_distributor';
  if (t.includes('dist'))                        return 'distributor';
  if (t === 'company')                           return 'super_distributor';
  if (t === 'individual')                        return 'retailer';
  return 'retailer';
};

// ══════════════════════════════════════════════════════════
//  @desc   Create vendor/distributor/retailer
//  @route  POST /api/vendors/create
//  @access Protected — strict parent hierarchy enforced
// ══════════════════════════════════════════════════════════
const createVendor = async (req, res) => {
  try {
    const {
      email, password, name, phone, company, city, state, address,
      gst, type, parent, parentId, growthExecutive,
    } = req.body;

    // ── Required fields ──────────────────────────────────────
    if (!email || !password || !name || !phone)
      return res.status(400).json({ success: false, message: 'name, email, phone, password required hain' });

    const targetRole  = normalizeType(type);
    const creatorRole = req.user.role;

    // ── Creator permission check ──────────────────────────────
    if (!CAN_CREATE[creatorRole]?.includes(targetRole))
      return res.status(403).json({
        success: false,
        message: `${creatorRole.replace(/_/g, ' ')} → ${targetRole.replace(/_/g, ' ')} create nahi kar sakta`,
        allowed: CAN_CREATE[creatorRole] || [],
      });

    // ── Duplicate email check ─────────────────────────────────
    const exists = await User.findOne({ email: email.toLowerCase().trim() });
    if (exists) return res.status(400).json({ success: false, message: 'Yeh email already registered hai' });

    // ══════════════════════════════════════════════════════════
    //  STRICT PARENT HIERARCHY VALIDATION
    //  super_distributor → no parent needed
    //  distributor       → parentId must be a super_distributor
    //  sub_distributor   → parentId must be a distributor
    //  retailer          → parentId must be a sub_distributor
    // ══════════════════════════════════════════════════════════
    const requiredParentRole = REQUIRED_PARENT_ROLE[targetRole];
    const rawParentId        = parent || parentId || null;
    let   resolvedParentId   = null;

    if (requiredParentRole === null) {
      // Super Distributor — only super_admin can create, no parent needed
      if (creatorRole !== 'super_admin')
        return res.status(403).json({ success: false, message: 'Sirf Super Admin hi Super Distributor create kar sakta hai' });
      resolvedParentId = null;

    } else {
      // Distributor / Sub Distributor / Retailer — parentId compulsory
      if (!rawParentId)
        return res.status(400).json({
          success: false,
          message: `${targetRole.replace(/_/g, ' ')} banane ke liye ${requiredParentRole.replace(/_/g, ' ')} select karna zaroori hai (parentId missing)`,
        });

      // Verify parent exists in DB with correct role
      const parentUser = await User.findById(rawParentId).select('role isActive name isDeleted');

      if (!parentUser)
        return res.status(404).json({ success: false, message: 'Parent user nahi mila — galat parentId diya hai' });

      if (parentUser.isDeleted)
        return res.status(400).json({ success: false, message: `Parent account (${parentUser.name}) delete ho chuka hai` });

      if (!parentUser.isActive)
        return res.status(400).json({ success: false, message: `Parent account (${parentUser.name}) abhi active nahi hai` });

      if (parentUser.role !== requiredParentRole)
        return res.status(400).json({
          success: false,
          message: `${targetRole.replace(/_/g, ' ')} ke liye parent ek ${requiredParentRole.replace(/_/g, ' ')} hona chahiye. Aapne diya: ${parentUser.role.replace(/_/g, ' ')}`,
        });

      resolvedParentId = rawParentId;
    }

    // ── File uploads ──────────────────────────────────────────
    const files    = req.files || {};
    const buildFile = (key) => {
      const f = files[key]?.[0];
      if (!f) return { url: null, filename: null, mimetype: null, size: null, uploadedAt: null };
      return { url: `/uploads/${f.filename}`, filename: f.filename, mimetype: f.mimetype, size: f.size, uploadedAt: new Date() };
    };
    const documents = (files.document || []).map(f => ({
      type: f.originalname, url: `/uploads/${f.filename}`,
      filename: f.filename, uploadedAt: new Date(),
    }));

    // ── Create user ───────────────────────────────────────────
    const user = await User.create({
      name, email, password, phone,
      company:         company         || '',
      city:            city            || '',
      state:           state           || '',
      address:         address         || '',
      gst:             gst             || '',
      growthExecutive: growthExecutive || '',
      role:            targetRole,
      parentId:        resolvedParentId,
      profileImage:    buildFile('profileImage'),
      logoImage:       buildFile('logoImage'),
      documents,
    });

    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: `${targetRole.replace(/_/g, ' ')} successfully create ho gaya`,
      token,
      user: user.toPublicProfile(),
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  @desc   Get all vendors (paginated + filtered)
//  @route  GET /api/vendors
//  @access Protected — Admin: all | Others: own downline
// ══════════════════════════════════════════════════════════
const getAllVendors = async (req, res) => {
  try {
    // Frontend sends ?type=super_distributor  OR  ?role=super_distributor
    const {
      role, type, isActive, search,
      page = 1, limit = 100, parentId,
    } = req.query;

    const roleFilter = role || type;   // accept both
    const isAdmin    = req.user.role === 'super_admin';

    const query = { role: { $ne: 'super_admin' }, isDeleted: { $ne: true } };

    // Non-admin sees only their direct children
    if (!isAdmin) query.parentId = req.user._id;

    if (roleFilter)   query.role     = roleFilter;
    if (parentId)     query.parentId = parentId;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (search) {
      query.$or = [
        { name:    new RegExp(search, 'i') },
        { email:   new RegExp(search, 'i') },
        { phone:   new RegExp(search, 'i') },
        { company: new RegExp(search, 'i') },
      ];
    }

    const total   = await User.countDocuments(query);
    const vendors = await User.find(query)
      .select('-password -activeToken -otp -otpExpiry')
      .populate('parentId', 'name email role company')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const mappedVendors = vendors.map(v => v.toPublicProfile());

    res.json({
      success:     true,
      total,
      vendors:     mappedVendors,   // ✅ frontend extractRawList: response.data?.vendors
      data:        mappedVendors,   // alias
      totalPages:  Math.ceil(total / limit),
      currentPage: Number(page),
      pagination: {
        total,
        page:        Number(page),
        limit:       Number(limit),
        totalPages:  Math.ceil(total / limit),
        hasNextPage: Number(page) < Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ══════════════════════════════════════════════════════════
//  @desc   Get single vendor by ID
//  @route  GET /api/vendors/:id
//  @access Protected
// ══════════════════════════════════════════════════════════
const getVendor = async (req, res) => {
  try {
    const vendor = await User.findById(req.params.id)
      .select('-password -activeToken -otp -otpExpiry')
      .populate('parentId', 'name email role company');
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    res.json({ success: true, vendor: vendor.toPublicProfile() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  @desc   Update vendor (id in URL)
//  @route  PUT /api/vendors/:id
//  @access Admin only
// ══════════════════════════════════════════════════════════
const updateVendor = async (req, res) => {
  try {
    const { password, role, ...updateData } = req.body;
    const vendor = await User.findByIdAndUpdate(req.params.id, updateData, { new: true })
      .select('-password -activeToken');
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    res.json({ success: true, message: 'Vendor updated', vendor: vendor.toPublicProfile() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  @desc   Update vendor (id in body — apiService.js compat)
//  @route  PUT /api/vendors/update
//  @access Admin or parent
// ══════════════════════════════════════════════════════════
const updateVendorByBody = async (req, res) => {
  try {
    const { id, password, role, ...updateData } = req.body;
    if (!id) return res.status(400).json({ success: false, message: 'id required in body' });

    const isAdmin = req.user.role === 'super_admin';
    if (!isAdmin) {
      const target = await User.findById(id);
      if (!target || String(target.parentId) !== String(req.user._id))
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const vendor = await User.findByIdAndUpdate(id, updateData, { new: true })
      .select('-password -activeToken');
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    res.json({ success: true, message: 'Vendor updated', vendor: vendor.toPublicProfile() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  @desc   Toggle active status (id in body)
//  @route  PUT /api/vendors/toggle-active
//  @access Admin or parent
// ══════════════════════════════════════════════════════════
const toggleVendorStatus = async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, message: 'id required in body' });

    const vendor = await User.findById(id);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

    const isAdmin  = req.user.role === 'super_admin';
    const isParent = String(vendor.parentId) === String(req.user._id);
    if (!isAdmin && !isParent)
      return res.status(403).json({ success: false, message: 'Access denied' });

    vendor.isActive = !vendor.isActive;
    await vendor.save();
    res.json({
      success:  true,
      message:  vendor.isActive ? '✅ Vendor activated' : '🔴 Vendor deactivated',
      isActive: vendor.isActive,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  @desc   Soft delete vendor with reason (id + reason in body)
//  @route  PUT /api/vendors/delete
//  @access Admin or parent
// ══════════════════════════════════════════════════════════
const softDeleteVendor = async (req, res) => {
  try {
    const { id, reason } = req.body;
    if (!id) return res.status(400).json({ success: false, message: 'id required in body' });

    const isAdmin  = req.user.role === 'super_admin';
    const target   = await User.findById(id);
    if (!target) return res.status(404).json({ success: false, message: 'Vendor not found' });

    const isParent = String(target.parentId) === String(req.user._id);
    if (!isAdmin && !isParent)
      return res.status(403).json({ success: false, message: 'Access denied' });

    target.isDeleted     = true;
    target.deletedAt     = new Date();
    target.deletedReason = reason || '';
    target.isActive      = false;
    target.activeToken   = null;
    await target.save();

    res.json({ success: true, message: 'Vendor removed successfully', vendorId: id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  @desc   Hard delete vendor (permanent)
//  @route  DELETE /api/vendors/:id
//  @access Admin only
// ══════════════════════════════════════════════════════════
const hardDeleteVendor = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Vendor permanently deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createVendor,
  getAllVendors,
  getVendor,
  updateVendor,
  updateVendorByBody,
  toggleVendorStatus,
  softDeleteVendor,
  hardDeleteVendor,
};
