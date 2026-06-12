const fs = require('fs');
const path = require('path');
const multer = require('multer');

const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

let storage;

if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  storage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder: 'running-key/customers',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      public_id: (req, file) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        return `${unique}-${file.fieldname}`;
      },
    },
  });
} else {
  const uploadDir = path.join(__dirname, '../uploads/customers');
  storage = multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}-${file.fieldname}${ext.toLowerCase()}`);
    },
  });
}

const imageOnly = (req, file, cb) => {
  if (file.mimetype?.startsWith('image/')) return cb(null, true);
  cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
};

const upload = multer({
  storage,
  fileFilter: imageOnly,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 4,
  },
}).fields([
  { name: 'profileImage', maxCount: 1 },
  { name: 'aadhaarFront', maxCount: 1 },
  { name: 'aadhaarBack', maxCount: 1 },
  { name: 'signature', maxCount: 1 },
]);

const cleanupPartialUpload = (files = {}) => {
  Object.values(files).flat().forEach((file) => {
    if (file?.path && !/^https?:\/\//i.test(file.path)) {
      fs.unlink(file.path, () => {});
    }
  });
};

const customerEnrollmentUpload = (req, res, next) => {
  upload(req, res, (err) => {
    if (!err) return next();
    cleanupPartialUpload(req.files);
    return res.status(400).json({
      success: false,
      status: 400,
      message: err.code === 'LIMIT_FILE_SIZE'
        ? 'Har image maximum 5 MB honi chahiye.'
        : 'Sirf profileImage, aadhaarFront, aadhaarBack aur signature image files allowed hain.',
    });
  });
};

module.exports = customerEnrollmentUpload;
