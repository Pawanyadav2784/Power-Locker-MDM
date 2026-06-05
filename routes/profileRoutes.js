/**
 * profileRoutes.js — Cloudinary backed
 *
 *   GET    /api/profile           — Profile fetch
 *   PUT    /api/profile           — Profile update
 *   POST   /api/profile/picture   — Pic upload → Cloudinary
 *   DELETE /api/profile/picture   — Pic delete  → Cloudinary
 */

const express  = require('express');
const router   = express.Router();
const { protect } = require('../middleware/auth');
const { uploadProfilePic } = require('../config/cloudinary');

const {
  getProfile,
  updateProfile,
  uploadProfilePicture,
  deleteProfilePicture,
} = require('../controllers/profileController');

router.get   ('/',        protect, getProfile);
router.put   ('/',        protect, updateProfile);
router.post  ('/picture', protect, uploadProfilePic.single('picture'), uploadProfilePicture);
router.delete('/picture', protect, deleteProfilePicture);

module.exports = router;
