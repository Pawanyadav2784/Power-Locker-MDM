const mongoose = require('mongoose');

// Posts = Announcements / Notices for retailers/distributors
const postSchema = new mongoose.Schema({
  title:   { type: String, required: true, trim: true },
  content: { type: String, required: true },
  type: {
    type: String,
    enum: ['announcement', 'notice', 'update', 'offer'],
    default: 'announcement',
  },
  targetRole: {
    type: String,
    enum: ['all', 'retailer', 'distributor', 'sub_distributor', 'super_distributor'],
    default: 'all',
  },
  imageUrl:  { type: String, default: '' },
  isActive:  { type: Boolean, default: true },
  isPinned:  { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Post', postSchema);
