const mongoose = require('mongoose');

// App Update — tracks latest APK versions for auto-update
const appUpdateSchema = new mongoose.Schema({
  packageName:  { type: String, required: true, unique: true }, // e.g. com.runningkey.mdm
  appName:      { type: String, required: true },               // e.g. "Power Locker MDM"
  versionName:  { type: String, required: true },               // e.g. "1.2.3"
  versionCode:  { type: Number, required: true },               // e.g. 12
  apkUrl:       { type: String, required: true },               // Download URL
  releaseNotes: { type: String, default: '' },
  isForced:     { type: Boolean, default: false },              // Force update?
  minVersion:   { type: Number, default: 0 },                   // Min version to show update
  isActive:     { type: Boolean, default: true },
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('AppUpdate', appUpdateSchema);
