/**
 * cloudinary.js — Cloudinary configuration
 * 
 * .env mein ye 3 values chahiye:
 *   CLOUDINARY_CLOUD_NAME=your_cloud_name
 *   CLOUDINARY_API_KEY=your_api_key
 *   CLOUDINARY_API_SECRET=your_api_secret
 */

const cloudinary          = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer              = require('multer');

// ── Cloudinary configure ───────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Profile Picture Storage ────────────────────────────────────────────────
// Folder: running-key/profiles/
const profileStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:         'running-key/profiles',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }], // Auto crop face
    public_id: (_req, file) => {
      const name = file.originalname.split('.')[0].replace(/\s+/g, '-');
      return `profile-${Date.now()}-${name}`;
    },
  },
});

// ── Logo Storage ───────────────────────────────────────────────────────────
// Folder: running-key/logos/
const logoStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          'running-key/logos',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 300, height: 300, crop: 'pad', background: 'white' }],
    public_id: (_req, file) => {
      const name = file.originalname.split('.')[0].replace(/\s+/g, '-');
      return `logo-${Date.now()}-${name}`;
    },
  },
});

// ── Multer uploaders ───────────────────────────────────────────────────────
const uploadProfilePic = multer({
  storage: profileStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only JPEG, PNG, WEBP allowed'));
  },
});

const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only JPEG, PNG, WEBP allowed'));
  },
});

// ── Delete from Cloudinary ─────────────────────────────────────────────────
const deleteFromCloudinary = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error('Cloudinary delete error:', err.message);
  }
};

module.exports = { cloudinary, uploadProfilePic, uploadLogo, deleteFromCloudinary };
