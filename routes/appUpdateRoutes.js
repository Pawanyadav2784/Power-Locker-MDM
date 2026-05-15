// ─────────────────────────────────────────────────────────────
//  routes/appUpdateRoutes.js
//  GET  /api/appupdate/get-by-package?package=com.xxx
//  POST /api/appupdate/create     (Admin)
//  PUT  /api/appupdate/:id        (Admin)
//  GET  /api/appupdate/list       (Admin)
// ─────────────────────────────────────────────────────────────
const express   = require('express');
const router    = express.Router();
const AppUpdate = require('../models/AppUpdate');
const { protect, adminOnly } = require('../middleware/auth');

// ── GET /api/appupdate/get-by-package
//    Called by Android app on startup to check for updates
//    Query: ?package=com.runningkey.mdm&currentVersion=10
router.get('/get-by-package', async (req, res) => {
  try {
    const { package: packageName, currentVersion } = req.query;
    if (!packageName)
      return res.status(400).json({ success: false, message: 'package query param required' });

    const update = await AppUpdate.findOne({ packageName, isActive: true });
    if (!update)
      return res.json({ success: true, updateAvailable: false });

    const cv = Number(currentVersion) || 0;
    const updateAvailable = update.versionCode > cv;
    const forceUpdate = updateAvailable && update.isForced && cv < (update.minVersion || 0);

    res.json({
      success: true,
      updateAvailable,
      forceUpdate,
      versionName:  update.versionName,
      versionCode:  update.versionCode,
      apkUrl:       update.apkUrl,
      releaseNotes: update.releaseNotes,
      appName:      update.appName,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/appupdate/list — All apps (Admin)
router.get('/list', protect, adminOnly, async (req, res) => {
  try {
    const apps = await AppUpdate.find().sort({ updatedAt: -1 });
    res.json({ success: true, data: apps });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/appupdate/create — Add/update APK version (Admin)
router.post('/create', protect, adminOnly, async (req, res) => {
  try {
    const { packageName, appName, versionName, versionCode, apkUrl, releaseNotes, isForced, minVersion } = req.body;

    // Upsert — agar same package hai to update karo
    const app = await AppUpdate.findOneAndUpdate(
      { packageName },
      { appName, versionName, versionCode: Number(versionCode), apkUrl, releaseNotes, isForced, minVersion, createdBy: req.user._id },
      { new: true, upsert: true }
    );
    res.json({ success: true, message: 'App update info saved', app });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /api/appupdate/:id — Edit (Admin)
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const app = await AppUpdate.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!app) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, app });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/appupdate/:id (Admin)
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    await AppUpdate.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
