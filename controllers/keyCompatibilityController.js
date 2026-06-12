const mongoose = require('mongoose');
const Command = require('../models/Command');
const Customer = require('../models/Customer');
const Device = require('../models/Device');
const WalletTransaction = require('../models/WalletTransaction');
const { sendFCM } = require('../utils/fcmHelper');
const {
  findAccessibleDevice,
  getManagedUserIds,
} = require('../utils/deviceAccess');
const { absoluteUrl } = require('../utils/pLockerCompatibility');
const {
  ensureEmiSchedule,
  projectEmiSchedule,
} = require('../utils/emiSchedule');

const PAYMENT_TYPES = {
  EMI: 'with_emi',
  WITH_EMI: 'with_emi',
  WITHOUT_EMI: 'without_emi',
  ECS: 'ecs',
  E_MANDATE: 'e_mandate',
  EMANDATE: 'e_mandate',
};

const PAYMENT_TYPES_FOR_APP = {
  with_emi: 'EMI',
  without_emi: 'WITHOUT_EMI',
  ecs: 'ECS',
  e_mandate: 'E_MANDATE',
};

function idOf(value) {
  if (!value) return '';
  return String(value._id || value.id || value);
}

function iso(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function normalizePaymentType(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return PAYMENT_TYPES[normalized] || null;
}

function normalizeEmiType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['daily', 'weekly', 'monthly'].includes(normalized) ? normalized : null;
}

function parseOptionalNumber(body, field, options = {}) {
  if (body[field] === undefined || body[field] === null || body[field] === '') {
    return { present: false, value: null };
  }

  const value = Number(body[field]);
  if (!Number.isFinite(value)) {
    return { present: true, error: `${field} valid number hona chahiye.` };
  }
  if (options.integer && !Number.isInteger(value)) {
    return { present: true, error: `${field} whole number hona chahiye.` };
  }
  if (options.nonNegative && value < 0) {
    return { present: true, error: `${field} negative nahi ho sakta.` };
  }
  return { present: true, value };
}

function customerScope(managedIds) {
  return managedIds === null ? {} : { retailerId: { $in: managedIds } };
}

async function findAccessibleKey(user, identifier) {
  const value = String(identifier || '').trim();
  if (!value) return null;

  const managedIds = await getManagedUserIds(user);
  const scope = customerScope(managedIds);
  const conditions = [{ qrCode: value }];
  if (mongoose.isValidObjectId(value)) {
    conditions.unshift({ _id: value }, { deviceId: value });
  }

  const query = Object.keys(scope).length
    ? { $and: [scope, { $or: conditions }] }
    : { $or: conditions };

  let customer = await Customer.findOne(query).populate('deviceId');
  if (customer) {
    const populatedDevice = customer.deviceId && typeof customer.deviceId === 'object'
      ? customer.deviceId
      : null;
    return { customer, device: populatedDevice };
  }

  const device = await findAccessibleDevice(user, value);
  if (!device) return null;

  const linkedConditions = [{ deviceId: device._id }];
  if (device.customerId) linkedConditions.push({ _id: device.customerId });
  const linkedQuery = Object.keys(scope).length
    ? { $and: [scope, { $or: linkedConditions }] }
    : { $or: linkedConditions };

  customer = await Customer.findOne(linkedQuery).populate('deviceId');
  if (!customer) return null;

  return {
    customer,
    device: customer.deviceId && typeof customer.deviceId === 'object'
      ? customer.deviceId
      : device,
  };
}

function buildEmiSchedule(customer) {
  return projectEmiSchedule(customer);
}

function buildBrandModel(customer, device) {
  const combined = [device?.brand, device?.model].filter(Boolean).join(' ').trim();
  return combined || device?.deviceName || customer.productName || '';
}

function buildKeyDetails(req, customer, device) {
  const customerId = idOf(customer);
  const deviceMongoId = idOf(device);
  const image = absoluteUrl(req, customer.profileImage || customer.photo);
  const signature = absoluteUrl(req, customer.signature || customer.customerSignature);
  const productImages = (customer.productImages || [])
    .map((url) => absoluteUrl(req, url))
    .filter(Boolean);
  if (!productImages.length && image) productImages.push(image);
  const keyType = customer.keyType || device?.keyType || 'new_key';
  const deviceType = keyType === 'iphone_key' ? 'IPHONE' : 'ANDROID';
  const removed = ['removed', 'closed'].includes(customer.status)
    || ['removed', 'released', 'unenrolled'].includes(device?.status);

  return {
    keyInfo: {
      _id: customerId,
      keyId: device?.deviceId || customer.qrCode || customerId,
      keyType,
      status: String(customer.status || device?.status || 'pending').toUpperCase(),
      paymentType: PAYMENT_TYPES_FOR_APP[customer.paymentType] || 'EMI',
      loanProvider: customer.loanProvider || '',
    },
    customer: {
      _id: customerId,
      fullName: customer.name || '',
      phone: customer.phone || '',
      image,
      status: !removed,
    },
    device: {
      _id: deviceMongoId,
      deviceId: device?.deviceId || '',
      brandModel: buildBrandModel(customer, device),
      deviceType,
      keyType,
      status: String(device?.status || customer.status || 'pending').toUpperCase(),
      imei1: customer.imei1 || device?.imei || '',
      imei2: customer.imei2 || device?.imei2 || '',
      productImage: productImages,
      signatureImage: signature,
    },
    documents: {
      purchaseAgreement: absoluteUrl(req, customer.agreementUrl),
      aadhaarFront: absoluteUrl(req, customer.aadhaarFront || customer.aadharPhoto),
      aadhaarBack: absoluteUrl(req, customer.aadhaarBack),
      signature,
    },
    loan: {
      _id: customerId,
      retailerId: idOf(customer.retailerId),
      userId: customerId,
      deviceId: deviceMongoId,
      productPrice: Number(customer.productPrice) || 0,
      downPayment: Number(customer.downPayment) || 0,
      balancePayment: Number(customer.balancePayment || customer.totalAmount) || 0,
      emiType: String(customer.emiType || 'monthly').toUpperCase(),
      tenureMonths: Number(customer.emiMonths) || 0,
      interestRate: Number(customer.interestRate) || 0,
      emiAmount: Number(customer.monthlyEmi) || 0,
      processingFee: 0,
      loanStartDate: iso(customer.loanStartDate),
      status: String(customer.status || 'pending').toUpperCase(),
      createdAt: iso(customer.createdAt),
      updatedAt: iso(customer.updatedAt),
      __v: Number(customer.__v) || 0,
    },
    emi: buildEmiSchedule(customer),
  };
}

const getKeyDetailsPLocker = async (req, res) => {
  try {
    const result = await findAccessibleKey(req.user, req.params.id);
    if (!result) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Key not found ya access denied.',
      });
    }

    return res.json({
      success: true,
      status: 200,
      data: buildKeyDetails(req, result.customer, result.device),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || 'Key details load nahi ho paya.',
    });
  }
};

const updateKeyPLocker = async (req, res) => {
  try {
    const result = await findAccessibleKey(req.user, req.params.id);
    if (!result) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Key not found ya access denied.',
      });
    }

    const { customer, device } = result;
    if (customer.status === 'removed' || device?.status === 'released') {
      return res.status(409).json({
        success: false,
        status: 409,
        message: 'Removed ya released key edit nahi ho sakti.',
      });
    }

    const numericFields = {
      productPrice: parseOptionalNumber(req.body, 'productPrice', { nonNegative: true }),
      downPayment: parseOptionalNumber(req.body, 'downPayment', { nonNegative: true }),
      balancePayment: parseOptionalNumber(req.body, 'balancePayment', { nonNegative: true }),
      tenureMonths: parseOptionalNumber(req.body, 'tenureMonths', {
        integer: true,
        nonNegative: true,
      }),
      interestRate: parseOptionalNumber(req.body, 'interestRate', { nonNegative: true }),
      emiAmount: parseOptionalNumber(req.body, 'emiAmount', { nonNegative: true }),
    };
    const numericError = Object.values(numericFields).find((entry) => entry.error);
    if (numericError) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: numericError.error,
      });
    }
    if (
      numericFields.tenureMonths.present
      && numericFields.tenureMonths.value < (Number(customer.emiPaid) || 0)
    ) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Tenure paid EMI count se kam nahi ho sakta.',
      });
    }

    let paymentType = null;
    if (req.body.paymentType !== undefined) {
      paymentType = normalizePaymentType(req.body.paymentType);
      if (!paymentType) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'paymentType EMI, WITHOUT_EMI, ECS ya E_MANDATE hona chahiye.',
        });
      }
    }

    let emiType = null;
    if (req.body.emiType !== undefined) {
      emiType = normalizeEmiType(req.body.emiType);
      if (!emiType) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'emiType DAILY, WEEKLY ya MONTHLY hona chahiye.',
        });
      }
    }

    let loanStartDate = null;
    if (req.body.loanStartDate) {
      loanStartDate = new Date(req.body.loanStartDate);
      if (Number.isNaN(loanStartDate.getTime())) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'loanStartDate valid date honi chahiye.',
        });
      }
    }

    const imei = String(req.body.imeiNumber || '').trim();
    const imei2 = String(req.body.imei2 || '').trim();
    const loanProvider = String(req.body.loanProvider || '').trim();
    const brandModel = String(req.body.brandModel || '').trim();
    const customerName = String(req.body.customerName || req.body.name || '').trim();
    const mobileProvided = req.body.mobileNumber !== undefined
      || req.body.phone !== undefined;
    const mobileNumber = String(req.body.mobileNumber || req.body.phone || '').trim();

    if (mobileProvided && !/^\d{10}$/.test(mobileNumber)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Mobile number 10 digit ka hona chahiye.',
      });
    }

    const requestedImeis = [imei, imei2].filter(Boolean);
    if (new Set(requestedImeis).size !== requestedImeis.length) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'IMEI 1 aur IMEI 2 same nahi ho sakte.',
      });
    }
    if (requestedImeis.length) {
      const duplicateDevice = await Device.findOne({
        ...(device?._id ? { _id: { $ne: device._id } } : {}),
        status: { $nin: ['removed', 'released', 'expired', 'unenrolled'] },
        $or: [
          { imei: { $in: requestedImeis } },
          { imei2: { $in: requestedImeis } },
        ],
      }).select('_id deviceId');
      const duplicateCustomer = await Customer.findOne({
        _id: { $ne: customer._id },
        status: { $nin: ['removed', 'closed'] },
        $or: [
          { imei1: { $in: requestedImeis } },
          { imei2: { $in: requestedImeis } },
        ],
      }).select('_id name');

      if (duplicateDevice || duplicateCustomer) {
        return res.status(409).json({
          success: false,
          status: 409,
          message: 'Ye IMEI kisi doosre active customer/device me use ho raha hai.',
        });
      }
    }

    if (customerName) customer.name = customerName;
    if (mobileProvided) {
      customer.phone = mobileNumber;
      customer.mobileNo = mobileNumber;
    }
    if (imei) {
      customer.imei1 = imei;
      if (device) device.imei = imei;
    }
    if (req.body.imei2 !== undefined) {
      customer.imei2 = imei2;
      if (device) device.imei2 = imei2;
    }
    if (req.body.loanProvider !== undefined) customer.loanProvider = loanProvider;
    if (brandModel) {
      customer.productName = brandModel;
      if (device) {
        device.model = brandModel;
        device.deviceName = brandModel;
      }
    }
    if (paymentType) customer.paymentType = paymentType;
    if (emiType) customer.emiType = emiType;
    if (loanStartDate) {
      customer.loanStartDate = loanStartDate;
      customer.emiStartDate = loanStartDate;
    }

    if (numericFields.productPrice.present) {
      customer.productPrice = numericFields.productPrice.value;
    }
    if (numericFields.downPayment.present) {
      customer.downPayment = numericFields.downPayment.value;
    }
    if (numericFields.balancePayment.present) {
      customer.balancePayment = numericFields.balancePayment.value;
      customer.totalAmount = numericFields.balancePayment.value;
    }
    if (numericFields.tenureMonths.present) {
      customer.emiMonths = numericFields.tenureMonths.value;
      customer.emiRemaining = Math.max(
        0,
        numericFields.tenureMonths.value - (Number(customer.emiPaid) || 0)
      );
    }
    if (numericFields.interestRate.present) {
      customer.interestRate = numericFields.interestRate.value;
    }
    if (numericFields.emiAmount.present) {
      customer.monthlyEmi = numericFields.emiAmount.value;
    }

    if (customer.paymentType === 'without_emi') {
      customer.emiRemaining = 0;
      customer.nextEmiDate = null;
    } else {
      ensureEmiSchedule(customer);
      const nextInstallment = customer.emiSchedule.find(
        (item) => item.status !== 'paid'
          && Number(item.installmentNo) <= Number(customer.emiMonths)
      );
      customer.nextEmiDate = nextInstallment?.dueDate || null;
    }

    const productImage = req.files?.productImages?.[0];
    if (productImage) {
      const url = `/uploads/keys/${productImage.filename}`;
      customer.productImages = [
        url,
        ...(customer.productImages || []).filter((item) => item !== url),
      ];
    }

    const signatureFile = req.files?.signature?.[0];
    if (signatureFile) {
      const url = `/uploads/keys/${signatureFile.filename}`;
      customer.signature = url;
      customer.customerSignature = url;
    }

    await customer.save();
    if (device) await device.save();

    return res.json({
      success: true,
      status: 200,
      message: 'Key details update ho gayi.',
      data: buildKeyDetails(req, customer, device),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || 'Key update nahi ho payi.',
    });
  }
};

async function queueRemovalCommand(device, customer, user) {
  const commandType = customer.keyType === 'running_key'
    ? 'RUNNING_KEY_REMOVE'
    : 'UNENROLL_DEVICE';
  const existing = await Command.findOne({
    deviceId: device._id,
    commandType,
    status: { $in: ['pending', 'sent', 'delivered'] },
  }).sort({ createdAt: -1 });

  if (existing) return { command: existing, alreadyExists: true, fcm: null };

  const hasFcm = Boolean(device.fcmToken);
  const command = await Command.create({
    deviceId: device._id,
    commandType,
    payload: {
      reason: 'key_removed',
      customerId: idOf(customer),
      keyId: device.deviceId || '',
    },
    label: 'Remove Key',
    priority: 1,
    deliveryMethod: hasFcm ? 'fcm' : 'poll',
    status: hasFcm ? 'sent' : 'pending',
    sentAt: hasFcm ? new Date() : undefined,
    createdBy: user._id,
  });

  let fcm = null;
  if (hasFcm) {
    fcm = await sendFCM(device.fcmToken, commandType, 'Remove Key', {
      command: commandType,
      commandType,
      commandId: idOf(command),
      deviceId: device.deviceId || '',
      reason: 'key_removed',
    });
    if (!fcm.success) {
      command.deliveryMethod = 'poll';
      command.status = 'pending';
      command.errorMessage = fcm.error || 'FCM delivery failed';
      await command.save();
    }
  }

  return { command, alreadyExists: false, fcm };
}

const removeKeyPLocker = async (req, res) => {
  try {
    const result = await findAccessibleKey(req.user, req.params.id);
    if (!result) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Key not found ya access denied.',
      });
    }

    const { customer, device } = result;
    if (
      customer.status === 'removed'
      && (!device || ['removed', 'unenrolled', 'released'].includes(device.status))
    ) {
      return res.json({
        success: true,
        status: 200,
        message: 'Key pehle se soft-removed hai.',
        already_removed: true,
      });
    }

    let delivery = null;
    if (device) delivery = await queueRemovalCommand(device, customer, req.user);

    customer.status = 'removed';
    customer.isDeviceLocked = false;
    customer.lockReason = 'key_removed';
    await customer.save();

    if (device) {
      device.status = 'removed';
      device.isLocked = false;
      device.mdmActive = false;
      device.isEnrolled = customer.keyType === 'running_key';
      device.lockMessage = '';
      device.lockPhone = '';
      device.lastCommandAt = new Date();
      await device.save();
    }

    return res.json({
      success: true,
      status: 200,
      message: device
        ? 'Key soft-remove ho gayi aur device command queue ho gaya.'
        : 'Key soft-remove ho gayi.',
      hard_deleted: false,
      data: {
        customerId: idOf(customer),
        deviceId: device?.deviceId || '',
        keyType: customer.keyType,
        status: customer.status,
      },
      command: delivery?.command ? {
        _id: idOf(delivery.command),
        commandType: delivery.command.commandType,
        status: delivery.command.status,
        deliveryMethod: delivery.command.deliveryMethod,
        alreadyExists: delivery.alreadyExists,
      } : null,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || 'Key remove nahi ho payi.',
    });
  }
};

function normalizeWalletKeyTypes(value) {
  const type = String(value || '').trim().toUpperCase();
  if (['ANDROID', 'NEW', 'NEW_KEY'].includes(type)) return ['new_key', 'android'];
  if (['RUNNING', 'RUNNING_KEY'].includes(type)) return ['running_key'];
  if (['IPHONE', 'IPHONE_KEY'].includes(type)) return ['iphone', 'iphone_key'];
  return [];
}

function transactionSource(tx) {
  if (tx.note === 'p_locker_customer_add' || tx.referenceId) return 'usage';
  if (tx.toUserId || tx.fromUserId) return 'transfer';
  return 'direct';
}

function transactionParty(tx, perspectiveUserId) {
  const perspective = String(perspectiveUserId || '');
  const ownerId = idOf(tx.userId);
  if (ownerId === perspective) {
    return tx.type === 'debit'
      ? tx.toUserId || tx.createdBy
      : tx.fromUserId || tx.createdBy;
  }
  return tx.userId || tx.createdBy;
}

function serializeTransaction(tx, perspectiveUserId) {
  const party = transactionParty(tx, perspectiveUserId);
  const source = transactionSource(tx);
  const partyName = party?.name || party?.company || party?.email
    || (source === 'usage' ? tx.description : 'Power Locker');

  return {
    _id: idOf(tx),
    id: idOf(tx),
    type: tx.type,
    keyType: tx.keyType || 'running_key',
    amount: Number(tx.amount) || 0,
    totalUnits: Number(tx.amount) || 0,
    balanceBefore: Number(tx.balanceBefore) || 0,
    balanceAfter: Number(tx.balanceAfter) || 0,
    description: tx.description || '',
    referenceId: tx.referenceId || '',
    source,
    counterpartyName: partyName || 'Transaction',
    counterparty: party ? {
      _id: idOf(party),
      name: partyName || '',
      role: party.role || '',
      phone: party.phone || '',
      email: party.email || '',
    } : null,
    createdBy: tx.createdBy?.name || tx.createdBy?.email || '',
    status: tx.status || 'completed',
    createdAt: iso(tx.createdAt),
    updatedAt: iso(tx.updatedAt),
  };
}

const getKeyTransactionsPLocker = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const managedIds = await getManagedUserIds(req.user);
    const requestedUserId = String(req.query.userId || '').trim();
    let perspectiveUserId = requestedUserId || idOf(req.user);
    const query = {};

    if (requestedUserId) {
      const allowed = managedIds === null
        || managedIds.some((id) => String(id) === requestedUserId);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          status: 403,
          message: 'Requested user hierarchy ke bahar hai.',
        });
      }
    }

    if (req.user.role !== 'super_admin' || requestedUserId) {
      const targetId = requestedUserId || req.user._id;
      query.$or = [
        { userId: targetId },
        { toUserId: targetId },
        { fromUserId: targetId },
      ];
    } else {
      perspectiveUserId = '';
    }

    const rawType = req.query.keyType || req.query.type;
    const keyTypes = normalizeWalletKeyTypes(rawType);
    if (keyTypes.length === 1) query.keyType = keyTypes[0];
    else if (keyTypes.length > 1) query.keyType = { $in: keyTypes };
    else if (['credit', 'debit', 'credit_foc', 'request', 'transfer'].includes(rawType)) {
      query.type = rawType;
    }

    if (req.query.transactionType) query.type = req.query.transactionType;

    const [total, transactions] = await Promise.all([
      WalletTransaction.countDocuments(query),
      WalletTransaction.find(query)
        .populate('userId', 'name email phone role company')
        .populate('createdBy', 'name email phone role company')
        .populate('toUserId', 'name email phone role company')
        .populate('fromUserId', 'name email phone role company')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    return res.json({
      success: true,
      status: 200,
      meta: { total, page, limit },
      data: transactions.map((tx) => serializeTransaction(tx, perspectiveUserId)),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || 'Key transactions load nahi ho paye.',
    });
  }
};

module.exports = {
  buildEmiSchedule,
  buildKeyDetails,
  findAccessibleKey,
  getKeyDetailsPLocker,
  getKeyTransactionsPLocker,
  normalizeEmiType,
  normalizePaymentType,
  normalizeWalletKeyTypes,
  removeKeyPLocker,
  serializeTransaction,
  updateKeyPLocker,
};
