const fs = require('fs');
const path = require('path');
const multer = require('multer');

const uploadDir = path.join(__dirname, '../uploads/keys');

const storage = multer.diskStorage({
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

const imageOnly = (req, file, cb) => {
  if (file.mimetype?.startsWith('image/')) return cb(null, true);
  return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
};

const upload = multer({
  storage,
  fileFilter: imageOnly,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 2,
  },
}).fields([
  { name: 'productImages', maxCount: 1 },
  { name: 'signature', maxCount: 1 },
]);

const keyCompatibilityUpload = (req, res, next) => {
  upload(req, res, (err) => {
    if (!err) return next();
    return res.status(400).json({
      success: false,
      status: 400,
      message: err.code === 'LIMIT_FILE_SIZE'
        ? 'Har image maximum 5 MB honi chahiye.'
        : 'Sirf productImages aur signature image files allowed hain.',
    });
  });
};

module.exports = keyCompatibilityUpload;
