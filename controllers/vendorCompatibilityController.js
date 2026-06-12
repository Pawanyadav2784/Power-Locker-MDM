const mongoose = require('mongoose');
const User = require('../models/User');
const Customer = require('../models/Customer');
const { absoluteUrl } = require('../utils/pLockerCompatibility');
const { getManagedUserIds } = require('../utils/deviceAccess');

const CAN_CREATE = {
  super_admin: ['super_distributor', 'distributor', 'sub_distributor', 'retailer'],
  super_distributor: ['distributor', 'sub_distributor'],
  distributor: ['sub_distributor', 'retailer'],
  sub_distributor: ['retailer'],
  retailer: [],
};

const VALID_PARENTS = {
  super_distributor: [],
  distributor: ['super_distributor'],
  sub_distributor: ['super_distributor', 'distributor'],
  retailer: ['distributor', 'sub_distributor'],
};

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (role.includes('super') && role.includes('dist')) return 'super_distributor';
  if (role.includes('sub') && role.includes('dist')) return 'sub_distributor';
  if (role === 'vendor' || role === 'individual' || role.includes('retail')) return 'retailer';
  if (role.includes('dist')) return 'distributor';
  return 'retailer';
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'active'].includes(String(value || '').toLowerCase());
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function storedFile(file) {
  if (!file) return null;
  return {
    url: `/uploads/${file.filename}`,
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size,
    uploadedAt: new Date(),
  };
}

function firstFile(req, ...names) {
  for (const name of names) {
    const file = req.files?.[name]?.[0];
    if (file) return file;
  }
  return null;
}

function serializeVendor(req, user) {
  const profile = user.profileImage?.toObject
    ? user.profileImage.toObject()
    : (user.profileImage || {});
  const image = absoluteUrl(req, profile.url);
  const id = String(user._id);
  const balance = Number(user.runningKeyBalance) || 0;

  return {
    _id: id,
    id,
    customId: id,
    retailerId: id,
    retailerCode: id,
    name: user.name || '',
    fullName: user.name || '',
    retailerName: user.name || '',
    ownerName: user.name || '',
    email: user.email || '',
    phone: user.phone || '',
    mobile: user.phone || '',
    company: user.company || '',
    companyName: user.company || '',
    city: user.city || '',
    state: user.state || '',
    address: user.address || '',
    streetAddress: user.address || '',
    gst: user.gst || '',
    gstNumber: user.gst || '',
    frpEmail: user.frpEmail || '',
    role: user.role,
    type: user.role === 'retailer' ? 'vendor' : 'company',
    userType: user.userType,
    parentId: user.parentId?._id || user.parentId || null,
    isActive: Boolean(user.isActive),
    status: Boolean(user.isActive),
    kycStatus: user.kycStatus || 'pending',
    balance,
    membershipPlan: '',
    profileImage: { ...profile, url: image || null },
    image: image || null,
    key_balance: {
      total_available: balance,
      running_key: balance,
    },
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

async function accessibleUser(actor, targetId, allowSelf = true) {
  if (!mongoose.isValidObjectId(targetId)) return null;
  if (!allowSelf && String(targetId) === String(actor._id)) return null;

  if (actor.role !== 'super_admin') {
    const managedIds = await getManagedUserIds(actor);
    const allowed = new Set((managedIds || []).map(String));
    if (!allowed.has(String(targetId))) return null;
  }

  return User.findOne({ _id: targetId, isDeleted: { $ne: true } });
}

async function resolveParent(actor, targetRole, rawParentId) {
  if (targetRole === 'super_distributor') {
    if (actor.role !== 'super_admin') throw Object.assign(new Error('Sirf Super Admin Super Distributor bana sakta hai.'), { status: 403 });
    return null;
  }

  const parentId = rawParentId || (actor.role === 'super_admin' ? null : actor._id);
  if (!parentId) throw Object.assign(new Error('Parent account select karna required hai.'), { status: 400 });

  const parent = await accessibleUser(actor, parentId);
  if (!parent) throw Object.assign(new Error('Parent account aapki hierarchy mein nahi hai.'), { status: 403 });
  if (!parent.isActive) throw Object.assign(new Error('Inactive parent ke niche account create nahi ho sakta.'), { status: 409 });
  if (!VALID_PARENTS[targetRole]?.includes(parent.role)) {
    throw Object.assign(new Error(`${parent.role} ke niche ${targetRole} create nahi ho sakta.`), { status: 400 });
  }
  return parent._id;
}

async function listVendors(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const query = { role: { $ne: 'super_admin' }, isDeleted: { $ne: true } };

    if (req.user.role !== 'super_admin') {
      const ids = await getManagedUserIds(req.user);
      query._id = { $in: (ids || []).filter((id) => String(id) !== String(req.user._id)) };
    }

    if (req.query.type || req.query.role) query.role = normalizeRole(req.query.type || req.query.role);
    const status = String(req.query.status || '').toLowerCase();
    if (status === 'active') query.isActive = true;
    if (['inactive', 'deactive', 'disabled'].includes(status)) query.isActive = false;

    const search = String(req.query.search || '').trim();
    if (search) {
      const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ name: pattern }, { email: pattern }, { phone: pattern }, { company: pattern }];
    }

    const [total, users] = await Promise.all([
      User.countDocuments(query),
      User.find(query)
        .select('-password -activeToken -otp -otpExpiry')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);
    const data = await Promise.all(users.map(async (user) => {
      const serialized = serializeVendor(req, user);
      serialized.customers = await Customer.countDocuments({ retailerId: user._id });
      return serialized;
    }));
    return res.json({
      success: true,
      status: 200,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      total,
      data,
      vendors: data,
    });
  } catch (err) {
    return res.status(500).json({ success: false, status: 500, message: err.message, data: [] });
  }
}

async function getVendor(req, res) {
  try {
    const user = await accessibleUser(req.user, req.params.id);
    if (!user) return res.status(404).json({ success: false, status: 404, message: 'Retailer not found ya access denied.' });
    const data = serializeVendor(req, user);
    data.customers = await Customer.countDocuments({ retailerId: user._id });
    return res.json({ success: true, status: 200, data });
  } catch (err) {
    return res.status(500).json({ success: false, status: 500, message: err.message });
  }
}

async function createVendor(req, res) {
  try {
    const { email, password, name, phone } = req.body;
    if (!email || !password || !name || !phone) {
      return res.status(400).json({ success: false, status: 400, message: 'name, email, phone aur password required hain.' });
    }
    if (!isEmail(email)) {
      return res.status(400).json({ success: false, status: 400, message: 'Valid email required hai.' });
    }

    const targetRole = normalizeRole(req.body.role || req.body.type);
    if (!CAN_CREATE[req.user.role]?.includes(targetRole)) {
      return res.status(403).json({ success: false, status: 403, message: `${req.user.role} ${targetRole} account create nahi kar sakta.` });
    }
    if (await User.findOne({ email: String(email).trim().toLowerCase() })) {
      return res.status(409).json({ success: false, status: 409, message: 'Yeh email already registered hai.' });
    }

    const parentId = await resolveParent(req.user, targetRole, req.body.parent || req.body.parentId);
    const profileFile = firstFile(req, 'profileImage', 'image');
    const user = await User.create({
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      password,
      phone: String(phone).trim(),
      company: String(req.body.company || '').trim(),
      city: String(req.body.city || '').trim(),
      state: String(req.body.state || '').trim(),
      address: String(req.body.address || '').trim(),
      gst: String(req.body.gst || req.body.gstNumber || '').trim(),
      role: targetRole,
      parentId,
      profileImage: storedFile(profileFile) || undefined,
    });
    const data = serializeVendor(req, user);
    return res.status(201).json({
      success: true,
      status: 201,
      message: `${targetRole.replace(/_/g, ' ')} successfully create ho gaya.`,
      token: null,
      user: data,
      data,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, status: err.status || 500, message: err.message });
  }
}

async function updateVendor(req, res) {
  try {
    const targetId = req.params.id || req.body.id || req.user._id;
    const user = await accessibleUser(req.user, targetId);
    if (!user) return res.status(404).json({ success: false, status: 404, message: 'Retailer not found ya access denied.' });

    const fields = {
      name: req.body.name ?? req.body.retailerName ?? req.body.fullName,
      email: req.body.email,
      phone: req.body.phone ?? req.body.mobile,
      company: req.body.company ?? req.body.companyName ?? req.body.ownerName,
      city: req.body.city,
      state: req.body.state,
      address: req.body.address ?? req.body.streetAddress,
      gst: req.body.gst ?? req.body.gstNumber,
      frpEmail: req.body.frpEmail,
    };

    if (fields.email && String(fields.email).trim().toLowerCase() !== user.email) {
      if (!isEmail(fields.email)) {
        return res.status(400).json({ success: false, status: 400, message: 'Valid email required hai.' });
      }
      const duplicate = await User.findOne({
        email: String(fields.email).trim().toLowerCase(),
        _id: { $ne: user._id },
      });
      if (duplicate) return res.status(409).json({ success: false, status: 409, message: 'Email already use ho raha hai.' });
    }
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined) user[key] = String(value).trim();
    });

    if (req.body.password) {
      if (req.body.confirmPassword && req.body.password !== req.body.confirmPassword) {
        return res.status(400).json({ success: false, status: 400, message: 'Passwords match nahi kar rahe.' });
      }
      if (String(req.body.password).length < 6) {
        return res.status(400).json({ success: false, status: 400, message: 'Password kam se kam 6 characters ka hona chahiye.' });
      }
      user.password = req.body.password;
    }

    const profileFile = firstFile(req, 'profileImage', 'image');
    if (profileFile) user.profileImage = storedFile(profileFile);
    const signature = firstFile(req, 'signature');
    if (signature) {
      user.documents.push({
        type: 'signature',
        url: `/uploads/${signature.filename}`,
        filename: signature.filename,
        uploadedAt: new Date(),
      });
    }

    await user.save();
    const data = serializeVendor(req, user);
    return res.json({ success: true, status: 200, message: 'Profile updated successfully.', data, user: data });
  } catch (err) {
    return res.status(500).json({ success: false, status: 500, message: err.message });
  }
}

async function toggleVendor(req, res) {
  try {
    const targetId = req.body.id || req.body.retailerId;
    const user = await accessibleUser(req.user, targetId, false);
    if (!user) return res.status(404).json({ success: false, status: 404, message: 'Retailer not found ya access denied.' });

    const explicit = req.body.isActive ?? req.body.newValue;
    user.isActive = explicit === undefined ? !user.isActive : parseBoolean(explicit);
    if (!user.isActive) user.activeToken = null;
    await user.save();
    return res.json({
      success: true,
      status: 200,
      message: user.isActive ? 'Account activated.' : 'Account deactivated.',
      isActive: user.isActive,
      data: { id: user._id, isActive: user.isActive },
    });
  } catch (err) {
    return res.status(500).json({ success: false, status: 500, message: err.message });
  }
}

async function hierarchy(req, res) {
  try {
    const root = await accessibleUser(req.user, req.query.id || req.user._id);
    if (!root) return res.status(404).json({ success: false, status: 404, message: 'Hierarchy root not found ya access denied.' });

    const ids = await getManagedUserIds(root);
    const users = await User.find(
      ids === null
        ? { isDeleted: { $ne: true } }
        : { _id: { $in: ids }, isDeleted: { $ne: true } }
    ).select('-password -activeToken -otp -otpExpiry').sort({ createdAt: 1 });

    const byParent = new Map();
    users.forEach((user) => {
      const isRoot = String(user._id) === String(root._id);
      const key = user.parentId
        ? String(user.parentId)
        : (!isRoot && root.role === 'super_admin' ? String(root._id) : 'root');
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(user);
    });
    const build = (user, seen = new Set()) => {
      const id = String(user._id);
      if (seen.has(id)) return null;
      const nextSeen = new Set(seen);
      nextSeen.add(id);
      return {
        ...serializeVendor(req, user),
        children: (byParent.get(id) || []).map((child) => build(child, nextSeen)).filter(Boolean),
      };
    };
    return res.json({ success: true, status: 200, hierarchy: build(root) });
  } catch (err) {
    return res.status(500).json({ success: false, status: 500, message: err.message });
  }
}

async function changeOwnPassword(req, res) {
  try {
    const currentPassword = req.body.currentPassword || req.body.oldPassword;
    const newPassword = req.body.newPassword;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, status: 400, message: 'Current password aur new password required hain.' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ success: false, status: 400, message: 'Password kam se kam 6 characters ka hona chahiye.' });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user || !(await user.matchPassword(currentPassword))) {
      return res.status(400).json({ success: false, status: 400, message: 'Current password galat hai.' });
    }
    user.password = newPassword;
    await user.save();
    return res.json({ success: true, status: 200, message: 'Password successfully changed.' });
  } catch (err) {
    return res.status(500).json({ success: false, status: 500, message: err.message });
  }
}

async function changeManagedPassword(req, res) {
  try {
    const targetId = req.body.targetId || req.body.id;
    const newPassword = req.body.newPassword;
    if (!targetId || !newPassword) {
      return res.status(400).json({ success: false, status: 400, message: 'targetId aur newPassword required hain.' });
    }
    if (req.body.confirmPassword && newPassword !== req.body.confirmPassword) {
      return res.status(400).json({ success: false, status: 400, message: 'Passwords match nahi kar rahe.' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ success: false, status: 400, message: 'Password kam se kam 6 characters ka hona chahiye.' });
    }

    const user = await accessibleUser(req.user, targetId, false);
    if (!user) return res.status(404).json({ success: false, status: 404, message: 'Target user not found ya access denied.' });
    user.password = newPassword;
    user.activeToken = null;
    await user.save();
    return res.json({ success: true, status: 200, message: 'Password updated successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, status: 500, message: err.message });
  }
}

async function updateFrpEmail(req, res) {
  try {
    const nextEmail = String(req.body.frpEmail || req.body.email || '').trim().toLowerCase();
    if (!nextEmail) return res.status(400).json({ success: false, status: 400, message: 'FRP email required hai.' });
    if (!isEmail(nextEmail)) return res.status(400).json({ success: false, status: 400, message: 'Valid FRP email required hai.' });

    const user = await accessibleUser(req.user, req.body.id || req.user._id);
    if (!user) return res.status(404).json({ success: false, status: 404, message: 'User not found ya access denied.' });
    const oldEmail = user.frpEmail || '';
    user.frpEmail = nextEmail;
    user.frpEmailHistory.push({ oldEmail, newEmail: nextEmail, changedBy: req.user._id });
    await user.save();
    return res.json({
      success: true,
      status: 200,
      message: 'FRP email updated successfully.',
      data: {
        id: String(user._id),
        old_email: oldEmail,
        new_email: nextEmail,
        history_count: user.frpEmailHistory.length,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, status: 500, message: err.message });
  }
}

async function uploadProfile(req, res) {
  try {
    if (!req.file) return res.status(400).json({ success: false, status: 400, message: 'Image required hai.' });
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, status: 404, message: 'User not found.' });
    user.profileImage = storedFile(req.file);
    await user.save();
    return res.json({
      success: true,
      status: 200,
      message: 'Profile image uploaded.',
      data: { profileImage: absoluteUrl(req, user.profileImage.url) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, status: 500, message: err.message });
  }
}

async function uploadDocument(req, res) {
  try {
    if (!req.file) return res.status(400).json({ success: false, status: 400, message: 'Document required hai.' });
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, status: 404, message: 'User not found.' });

    const path = `/uploads/${req.file.filename}`;
    user.documents.push({
      type: req.body.type || req.file.originalname,
      url: path,
      filename: req.file.filename,
      uploadedAt: new Date(),
    });
    await user.save();
    const url = absoluteUrl(req, path);
    return res.json({
      success: true,
      status: 200,
      message: 'Document uploaded successfully.',
      data: [{ img: url, url }],
    });
  } catch (err) {
    return res.status(500).json({ success: false, status: 500, message: err.message });
  }
}

module.exports = {
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
};
