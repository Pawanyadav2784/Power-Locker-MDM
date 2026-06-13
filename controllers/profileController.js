/**
 * profileController.js — Cloudinary backed
 *
 * APIs:
 *   GET    /api/profile          — Profile fetch karo
 *   PUT    /api/profile          — Profile update karo
 *   POST   /api/profile/picture  — Profile picture upload (Cloudinary)
 *   DELETE /api/profile/picture  — Profile picture remove (Cloudinary se bhi)
 */

const User                  = require('../models/User');
const { deleteFromCloudinary } = require('../config/cloudinary');

// ══════════════════════════════════════════════════════════
//  GET /api/profile
// ══════════════════════════════════════════════════════════
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password -otp -otpExpiry -activeToken')
      .populate({
        path: 'parentId',
        populate: {
          path: 'parentId',
          populate: {
            path: 'parentId'
          }
        }
      });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: user.toPublicProfile() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  PUT /api/profile — Profile fields update
// ══════════════════════════════════════════════════════════
const updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const ALLOWED = ['name', 'phone', 'company', 'city', 'state', 'address', 'gst'];
    ALLOWED.forEach((field) => {
      if (req.body[field] !== undefined) user[field] = req.body[field];
    });

    await user.save();
    await user.populate({
      path: 'parentId',
      populate: {
        path: 'parentId',
        populate: {
          path: 'parentId'
        }
      }
    });
    res.json({ success: true, message: 'Profile updated successfully', data: user.toPublicProfile() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  POST /api/profile/picture — Cloudinary upload
// ══════════════════════════════════════════════════════════
const uploadProfilePicture = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded. Field name must be "picture"' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Purani Cloudinary image delete karo
    if (user.profileImage?.filename) {
      await deleteFromCloudinary(user.profileImage.filename); // filename mein public_id store hoga
    }

    // Cloudinary se URL aur public_id aata hai req.file mein
    user.profileImage = {
      url:        req.file.path,            // Cloudinary URL
      filename:   req.file.filename,        // Cloudinary public_id (delete ke liye)
      mimetype:   req.file.mimetype,
      size:       req.file.size,
      uploadedAt: new Date(),
    };

    await user.save();

    res.json({
      success:      true,
      message:      'Profile picture uploaded to Cloudinary',
      profileImage: user.profileImage,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  DELETE /api/profile/picture — Cloudinary se bhi delete
// ══════════════════════════════════════════════════════════
const deleteProfilePicture = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Cloudinary se delete karo
    if (user.profileImage?.filename) {
      await deleteFromCloudinary(user.profileImage.filename);
    }

    user.profileImage = { url: null, filename: null, mimetype: null, size: null, uploadedAt: null };
    await user.save();

    res.json({ success: true, message: 'Profile picture removed' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getProfile, updateProfile, uploadProfilePicture, deleteProfilePicture };
