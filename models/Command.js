const mongoose = require('mongoose');

const commandSchema = new mongoose.Schema({
  deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true },

  commandType: {
    type: String,
    enum: [
      // Lock / Unlock
      'LOCK_DEVICE', 'UNLOCK_DEVICE', 'OFFLINE_LOCK', 'OFFLINE_UNLOCK', 'SCHEDULER_LOCK',
      // Reset
      'REBOOT', 'SOFT_RESET', 'HARD_RESET', 'WIPE',
      // Device Info
      'GET_LOCATION', 'GET_SIM', 'GET_NUMBER', 'GET_SIM_INFO', 'CHECK_IN',
      // Communication
      'MESSAGE', 'PLAY_ALERT',
      // App Management
      'INSTALL_APP', 'REMOVE_APP', 'UPDATE_APP', 'MDM_APP_UPDATE',
      // Enrollment
      'UNENROLL', 'ENROLL', 'UNENROLL_DEVICE', 'RELEASE_DEVICE',
      // Restrictions
      'ACTIVE_RESTRICTION', 'DEACTIVE_RESTRICTION', 'RUNNING_KEY_REMOVE',
      'DEBUGGING_ON', 'DEBUGGING_OFF',
      'FACTORY_RESET_ON', 'FACTORY_RESET_OFF',
      'SOCIALMEDIA_LOCK', 'SOCIALMEDIA_UNLOCK',
      'SIM_LOCK', 'SIM_UNLOCK',
      'VOLUME_ON', 'VOLUME_OFF',
      'WALLPAPER_ON', 'WALLPAPER_OFF',
      'AUDIO_ON', 'AUDIO_OFF',
      // Custom
      'CUSTOM',
    ],
    required: true,
  },

  payload:  { type: mongoose.Schema.Types.Mixed, default: {} },
  label:    { type: String, default: '' },
  priority: { type: Number, default: 5, min: 1, max: 10 }, // 1=highest

  deliveryMethod: {
    type: String,
    enum: ['fcm', 'sms', 'both', 'poll'],  // 'poll' = FCM failed, device polll se lega
    default: 'fcm',
  },

  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'executed', 'failed', 'cancelled'],
    default: 'pending',
  },

  // Response from device after execution
  deviceResponse: { type: mongoose.Schema.Types.Mixed, default: null },
  errorMessage:   { type: String, default: '' },
  retryCount:     { type: Number, default: 0, min: 0 },
  maxRetries:     { type: Number, default: 3, min: 0, max: 10 },
  nextRetryAt:    { type: Date },
  lastAttemptAt:  { type: Date },
  failedAt:       { type: Date },

  sentAt:      { type: Date },
  deliveredAt: { type: Date },
  executedAt:  { type: Date },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Fast index for device check-in pending command fetch
commandSchema.index({ deviceId: 1, status: 1 });
commandSchema.index({ createdBy: 1, createdAt: -1 });

module.exports = mongoose.model('Command', commandSchema);
