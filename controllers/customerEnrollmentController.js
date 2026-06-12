const fs = require('fs');
const Customer = require('../models/Customer');
const Device = require('../models/Device');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');

const BALANCE_FIELD = 'runningKeyBalance';

const KEY_TYPE_BY_CODE = {
  '1': 'new_key',
  '2': 'running_key',
  '3': 'iphone_key',
};

const KEY_TYPE_BY_DEVICE = {
  new: 'new_key',
  running: 'running_key',
  iphone: 'iphone_key',
};

const DEVICE_TYPE_BY_KEY = {
  new_key: 'new',
  running_key: 'running',
  iphone_key: 'iPhone',
};

const KEY_CODE_BY_TYPE = {
  new_key: '1',
  running_key: '2',
  iphone_key: '3',
};

function normalizeKeyType(body = {}) {
  const code = String(body.key_type || '').trim();
  const deviceType = String(body.deviceType || '').trim().toLowerCase();
  const direct = String(body.keyType || '').trim();
  const fromCode = KEY_TYPE_BY_CODE[code];
  const fromDevice = KEY_TYPE_BY_DEVICE[deviceType];
  const normalizedDirect = ['new_key', 'running_key', 'iphone_key'].includes(direct)
    ? direct
    : null;

  if ((code && !fromCode) || (deviceType && !fromDevice) || (direct && !normalizedDirect)) {
    return null;
  }

  const values = [fromCode, fromDevice, normalizedDirect].filter(Boolean);
  if (new Set(values).size > 1) return null;
  return values[0] || 'running_key';
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function uploadedUrl(file) {
  if (!file) return '';
  if (file.path && /^https?:\/\//i.test(file.path)) {
    return file.path;
  }
  return file.filename ? `/uploads/customers/${file.filename}` : '';
}

function cleanupUploadedFiles(files = {}) {
  Object.values(files).flat().forEach((file) => {
    if (!file?.path) return;
    if (/^https?:\/\//i.test(file.path)) return;
    fs.unlink(file.path, () => {});
  });
}

function serializeCustomer(customer, device) {
  return {
    _id: customer._id,
    id: customer._id,
    userId: device._id,
    keyId: device._id,
    deviceId: device.deviceId,
    qrCode: customer.qrCode || device.deviceId || '',
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    imei1: customer.imei1,
    imei2: customer.imei2,
    deviceType: DEVICE_TYPE_BY_KEY[customer.keyType],
    key_type: KEY_CODE_BY_TYPE[customer.keyType],
    keyType: customer.keyType,
    loanBy: customer.loanProvider,
    profileImage: customer.profileImage || customer.photo,
    aadhaarFront: customer.aadhaarFront || customer.aadharPhoto,
    aadhaarBack: customer.aadhaarBack,
    signature: customer.signature || customer.customerSignature,
    status: customer.status,
    emi: {
      totalAmount: customer.productPrice,
      downPayment: customer.downPayment,
      loanAmount: customer.balancePayment,
      interestRate: customer.interestRate,
      emiAmount: customer.monthlyEmi,
      tenureMonths: customer.emiMonths,
      loanProvider: customer.loanProvider,
      emiStatus: customer.paymentType === 'with_emi' ? 'active' : 'not_applicable',
    },
    createdAt: customer.createdAt,
  };
}

const enrollCustomerDevice = async (req, res) => {
  let balanceDebited = false;
  let customer = null;
  let device = null;
  let walletTransaction = null;

  const reject = (status, message) => {
    cleanupUploadedFiles(req.files);
    return res.status(status).json({ success: false, status, message });
  };

  try {
    const name = String(req.body.name || '').trim();
    const phone = String(req.body.phone || '').trim();
    const imei1 = String(req.body.imei1 || '').trim();
    const imei2 = String(req.body.imei2 || '').trim();
    const keyType = normalizeKeyType(req.body);

    if (!name || !phone || !imei1) {
      return reject(400, 'Name, phone aur IMEI 1 required hai.');
    }
    if (!keyType) {
      return reject(400, 'deviceType aur key_type match nahi kar rahe.');
    }
    if (!req.files?.signature?.[0]) {
      return reject(400, 'Customer signature required hai.');
    }

    const imeiConditions = [{ imei: imei1 }, { imei2: imei1 }];
    if (imei2) {
      imeiConditions.push({ imei: imei2 }, { imei2 });
    }

    const duplicateDevice = await Device.findOne({
      $or: imeiConditions,
      status: { $nin: ['removed', 'released', 'expired', 'unenrolled'] },
    }).select('_id deviceId');

    if (duplicateDevice) {
      return reject(409, `IMEI pehle se device ${duplicateDevice.deviceId} me enrolled hai.`);
    }

    const isAdmin = req.user.role === 'super_admin';
    const targetRetailerId = isAdmin && req.body.retailerId
      ? req.body.retailerId
      : req.user._id;

    const retailer = await User.findOneAndUpdate(
      {
        _id: targetRetailerId,
        isDeleted: { $ne: true },
        isActive: true,
        [BALANCE_FIELD]: { $gte: 1 },
      },
      { $inc: { [BALANCE_FIELD]: -1 } },
      { new: true }
    );

    if (!retailer) {
      return reject(400, 'Insufficient key balance ya retailer account inactive hai.');
    }
    balanceDebited = true;

    const files = req.files || {};
    const profileImage = uploadedUrl(files.profileImage?.[0]);
    const aadhaarFront = uploadedUrl(files.aadhaarFront?.[0]);
    const aadhaarBack = uploadedUrl(files.aadhaarBack?.[0]);
    const signature = uploadedUrl(files.signature?.[0]);

    const totalAmount = toNumber(req.body.totalAmount);
    const downPayment = toNumber(req.body.downPayment);
    const loanAmount = toNumber(req.body.loanAmount)
      || Math.max(0, totalAmount - downPayment);
    const tenureMonths = Math.max(0, Math.trunc(toNumber(req.body.tenureMonths)));
    const emiAmount = toNumber(req.body.emiAmount);
    const hasEmi = tenureMonths > 0 || loanAmount > 0 || emiAmount > 0;
    const loanProvider = String(req.body.loanProvider || req.body.loanBy || '').trim();

    device = await Device.create({
      keyType,
      retailerId: targetRetailerId,
      status: 'pending',
      imei: imei1,
      imei2,
    });

    customer = await Customer.create({
      name,
      phone,
      email: String(req.body.email || '').trim(),
      keyType,
      imei1,
      imei2,
      mobileNo: phone,
      loanProvider,
      productPrice: totalAmount,
      downPayment,
      balancePayment: loanAmount,
      paymentType: hasEmi ? 'with_emi' : 'without_emi',
      emiMonths: tenureMonths,
      emiRemaining: tenureMonths,
      interestRate: toNumber(req.body.interestRate),
      monthlyEmi: emiAmount,
      totalAmount: loanAmount,
      loanStartDate: hasEmi ? new Date() : null,
      photo: profileImage,
      profileImage,
      customerSignature: signature,
      signature,
      aadharPhoto: aadhaarFront,
      aadhaarFront,
      aadhaarBack,
      deviceId: device._id,
      retailerId: targetRetailerId,
      createdBy: req.user._id,
      status: 'pending',
      qrCode: device.deviceId,
    });

    device.customerId = customer._id;
    await device.save();

    walletTransaction = await WalletTransaction.create({
      userId: targetRetailerId,
      type: 'debit',
      keyType,
      amount: 1,
      balanceBefore: retailer[BALANCE_FIELD] + 1,
      balanceAfter: retailer[BALANCE_FIELD],
      description: `Device enrolled: ${device.deviceId} - ${name}`,
      referenceId: device.deviceId,
      note: 'p_locker_customer_add',
      createdBy: req.user._id,
    });

    return res.status(201).json({
      success: true,
      status: 201,
      message: 'Customer aur device enroll ho gaya.',
      data: {
        customer: serializeCustomer(customer, device),
        device: {
          _id: device._id,
          id: device._id,
          deviceId: device.deviceId,
          keyType: device.keyType,
          status: device.status,
          imei: device.imei,
          imei2: device.imei2,
        },
        remainingBalance: retailer[BALANCE_FIELD],
      },
    });
  } catch (err) {
    console.error('P Locker customer enrollment error:', err);

    try {
      if (walletTransaction?._id) {
        await WalletTransaction.findByIdAndDelete(walletTransaction._id);
      }
      if (customer?._id) await Customer.findByIdAndDelete(customer._id);
      if (device?._id) await Device.findByIdAndDelete(device._id);
      if (balanceDebited) {
        const targetRetailerId = req.user.role === 'super_admin' && req.body.retailerId
          ? req.body.retailerId
          : req.user._id;
        await User.findByIdAndUpdate(targetRetailerId, {
          $inc: { [BALANCE_FIELD]: 1 },
        });
      }
    } catch (rollbackError) {
      console.error('Customer enrollment rollback error:', rollbackError);
    }

    cleanupUploadedFiles(req.files);
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || 'Customer enrollment failed.',
    });
  }
};

module.exports = {
  enrollCustomerDevice,
  normalizeKeyType,
  serializeCustomer,
};
