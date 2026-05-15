const mongoose = require('mongoose');

const bankSchema = new mongoose.Schema({
  name: { type: String, required: true },
  accountNo: { type: String, default: '' },
  ifsc: { type: String, default: '' },
  branch: { type: String, default: '' },
  holderName: { type: String, default: '' },
  upiId: { type: String, default: '' },
  qrImage: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Bank', bankSchema);
