const Banner  = require('../models/Banner');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');

// ─── Multer — Image Upload Setup ──────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/banners');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const name = `banner_${Date.now()}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits:    { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase())
             && allowed.test(file.mimetype);
    ok ? cb(null, true) : cb(new Error('Only image files allowed (jpg, png, gif, webp)'));
  },
});

// ══════════════════════════════════════════════════════════
//  1. GET ALL BANNERS
//  GET /api/banners
// ══════════════════════════════════════════════════════════
const getAllBanners = async (req, res) => {
  try {
    const { isActive, bannerType } = req.query;
    const query = {};
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (bannerType)             query.bannerType = bannerType;

    const banners = await Banner.find(query)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name email');

    res.json({ success: true, total: banners.length, data: banners, banners });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  2. GET SINGLE BANNER
//  GET /api/banners/:id
// ══════════════════════════════════════════════════════════
const getBannerById = async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) return res.status(404).json({ success: false, message: 'Banner not found' });
    res.json({ success: true, data: banner, banner });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  3. CREATE BANNER
//  POST /api/banners/create
//  multipart/form-data: { title, redirectUrl, bannerType, startDate, endDate, image? }
// ══════════════════════════════════════════════════════════
const createBanner = async (req, res) => {
  try {
    const { title, redirectUrl, bannerType, startDate, endDate, isActive } = req.body;

    if (!title) return res.status(400).json({ success: false, message: 'title required' });

    // Image URL — file upload kiya ya URL diya
    let bannerImage = req.body.imageUrl || req.body.bannerImage || '';
    if (req.file) {
      const baseUrl = process.env.BASE_URL?.replace('/api', '') || `http://localhost:${process.env.PORT || 5000}`;
      bannerImage = `${baseUrl}/uploads/banners/${req.file.filename}`;
    }

    const banner = await Banner.create({
      title,
      bannerImage,
      redirectUrl: redirectUrl || '',
      bannerType:  bannerType  || 'all',
      startDate:   startDate   || null,
      endDate:     endDate     || null,
      isActive:    isActive !== undefined ? isActive !== 'false' : true,
      createdBy:   req.user._id,
    });

    res.status(201).json({ success: true, message: 'Banner created', data: banner, banner });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  4. UPDATE BANNER
//  PUT /api/banners/:id
//  multipart/form-data or JSON
// ══════════════════════════════════════════════════════════
const updateBanner = async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) return res.status(404).json({ success: false, message: 'Banner not found' });

    const { title, redirectUrl, bannerType, startDate, endDate, isActive } = req.body;

    if (title)       banner.title       = title;
    if (redirectUrl !== undefined) banner.redirectUrl = redirectUrl;
    if (bannerType)  banner.bannerType  = bannerType;
    if (startDate)   banner.startDate   = startDate;
    if (endDate)     banner.endDate     = endDate;
    if (isActive !== undefined) banner.isActive = isActive !== 'false' && isActive !== false;

    // Naya image upload hua?
    if (req.file) {
      // Purani image delete karo
      if (banner.bannerImage && banner.bannerImage.includes('/uploads/banners/')) {
        const oldPath = path.join(__dirname, '../uploads/banners', path.basename(banner.bannerImage));
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      const baseUrl = process.env.BASE_URL?.replace('/api', '') || `http://localhost:${process.env.PORT || 5000}`;
      banner.bannerImage = `${baseUrl}/uploads/banners/${req.file.filename}`;
    } else if (req.body.imageUrl || req.body.bannerImage) {
      banner.bannerImage = req.body.imageUrl || req.body.bannerImage;
    }

    await banner.save();
    res.json({ success: true, message: 'Banner updated', data: banner, banner });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  5. DELETE BANNER
//  DELETE /api/banners/:id
// ══════════════════════════════════════════════════════════
const deleteBanner = async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) return res.status(404).json({ success: false, message: 'Banner not found' });

    // Image file bhi delete karo
    if (banner.bannerImage && banner.bannerImage.includes('/uploads/banners/')) {
      const imgPath = path.join(__dirname, '../uploads/banners', path.basename(banner.bannerImage));
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }

    await Banner.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Banner deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  6. TOGGLE ACTIVE/INACTIVE
//  PUT /api/banners/toggle/:id
// ══════════════════════════════════════════════════════════
const toggleBanner = async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) return res.status(404).json({ success: false, message: 'Banner not found' });

    banner.isActive = !banner.isActive;
    await banner.save();
    res.json({
      success: true,
      message: `Banner ${banner.isActive ? 'activated' : 'deactivated'}`,
      isActive: banner.isActive,
      data: banner,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { upload, getAllBanners, getBannerById, createBanner, updateBanner, deleteBanner, toggleBanner };
