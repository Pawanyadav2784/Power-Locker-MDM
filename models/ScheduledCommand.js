const mongoose = require('mongoose');

const scheduledCommandSchema = new mongoose.Schema({
  deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true },
  commandType: {
    type: String,
    enum: ['LOCK_DEVICE', 'UNLOCK_DEVICE', 'REBOOT', 'WIPE', 'MESSAGE', 'PLAY_ALERT'],
    required: true,
  },
  scheduleType: {
    type: String,
    enum: ['one_time', 'recurring'],
    default: 'one_time',
  },
  scheduledAt: { type: Date, required: true },
  label: { type: String, default: '' },
  deliveryMethod: {
    type: String,
    enum: ['fcm', 'sms', 'both'],
    default: 'fcm',
  },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: {
    type: String,
    enum: ['pending', 'executed', 'cancelled', 'failed'],
    default: 'pending',
  },
  executedAt: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('ScheduledCommand', scheduledCommandSchema);
