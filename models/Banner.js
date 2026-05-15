const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
  title: { type: String, required: true },
  bannerType: {
    type: String,
    enum: ['admin', 'retailer', 'all'],
    default: 'all',
  },
  redirectUrl: { type: String, default: '' },
  bannerImage: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  startDate: { type: Date },
  endDate: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Banner', bannerSchema);
