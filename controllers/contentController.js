const Banner = require('../models/Banner');
const Bank = require('../models/Bank');

// ===== BANNER CONTROLLERS =====
const createBanner = async (req, res) => {
  try {
    const { title, bannerType, redirectUrl, isActive, startDate, endDate } = req.body;
    const banner = await Banner.create({
      title, bannerType, redirectUrl,
      isActive: isActive === 'true' || isActive === true,
      startDate, endDate,
      bannerImage: req.file ? `/uploads/${req.file.filename}` : '',
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, banner });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getBanners = async (req, res) => {
  try {
    const banners = await Banner.find().sort({ createdAt: -1 });
    res.json({ success: true, banners });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateBanner = async (req, res) => {
  try {
    const banner = await Banner.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!banner) return res.status(404).json({ success: false, message: 'Banner not found' });
    res.json({ success: true, banner });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteBanner = async (req, res) => {
  try {
    await Banner.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Banner deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const toggleBanner = async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) return res.status(404).json({ success: false, message: 'Banner not found' });
    banner.isActive = !banner.isActive;
    await banner.save();
    res.json({ success: true, message: `Banner ${banner.isActive ? 'activated' : 'deactivated'}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ===== BANK CONTROLLERS =====
const getBanks = async (req, res) => {
  try {
    const banks = await Bank.find();
    res.json({ success: true, banks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createBank = async (req, res) => {
  try {
    const bank = await Bank.create(req.body);
    res.status(201).json({ success: true, bank });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateBank = async (req, res) => {
  try {
    const bank = await Bank.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!bank) return res.status(404).json({ success: false, message: 'Bank not found' });
    res.json({ success: true, bank });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteBank = async (req, res) => {
  try {
    await Bank.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Bank deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const toggleBank = async (req, res) => {
  try {
    const bank = await Bank.findById(req.params.id);
    if (!bank) return res.status(404).json({ success: false, message: 'Bank not found' });
    bank.isActive = !bank.isActive;
    await bank.save();
    res.json({ success: true, message: `Bank ${bank.isActive ? 'activated' : 'deactivated'}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createBanner, getBanners, updateBanner, deleteBanner, toggleBanner,
  getBanks, createBank, updateBank, deleteBank, toggleBank,
};
