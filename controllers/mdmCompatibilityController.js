const Command = require('../models/Command');
const Customer = require('../models/Customer');
const Device = require('../models/Device');
const { sendFCM } = require('../utils/fcmHelper');
const { absoluteUrl } = require('../utils/pLockerCompatibility');
const { findAccessibleDevice, getDeviceScope } = require('../utils/deviceAccess');

const COMMAND_ALIASES = {
  DEVICE_LOCK: 'LOCK_DEVICE',
  DEVICE_UNLOCK: 'UNLOCK_DEVICE',
  GET_MOBILE_NUMBER: 'GET_NUMBER',
  GET_SIM: 'GET_NUMBER',
  GET_SIM_INFO: 'GET_NUMBER',
  MOBILE_NO_ON: 'GET_NUMBER',
  MOBILE_NO_OFF: 'GET_NUMBER',
  LOCATION_ON: 'GET_LOCATION',
  LOCATION_OFF: 'GET_LOCATION',
  OFFLINE_LOCATION_ON: 'GET_LOCATION',
  OFFLINE_LOCATION_OFF: 'GET_LOCATION',
  UPDATE_APP: 'MDM_APP_UPDATE',
  APP_BLOCK: 'SOCIALMEDIA_LOCK',
  APP_UNBLOCK: 'SOCIALMEDIA_UNLOCK',
  PLAY_SOUND: 'PLAY_ALERT',
  AUDIO_ON: 'PLAY_ALERT',
  STOP_SOUND: 'CUSTOM',
  AUDIO_OFF: 'CUSTOM',
};

const SUPPORTED_COMMANDS = new Set([
  'LOCK_DEVICE', 'UNLOCK_DEVICE', 'OFFLINE_LOCK', 'OFFLINE_UNLOCK',
  'SCHEDULER_LOCK', 'REBOOT', 'SOFT_RESET', 'HARD_RESET', 'WIPE',
  'GET_LOCATION', 'GET_SIM', 'GET_NUMBER', 'GET_SIM_INFO', 'CHECK_IN',
  'MESSAGE', 'PLAY_ALERT', 'INSTALL_APP', 'REMOVE_APP', 'MDM_APP_UPDATE',
  'UNENROLL', 'ENROLL', 'UNENROLL_DEVICE', 'RELEASE_DEVICE',
  'ACTIVE_RESTRICTION', 'DEACTIVE_RESTRICTION', 'RUNNING_KEY_REMOVE',
  'DEBUGGING_ON', 'DEBUGGING_OFF', 'FACTORY_RESET_ON', 'FACTORY_RESET_OFF',
  'SOCIALMEDIA_LOCK', 'SOCIALMEDIA_UNLOCK', 'CUSTOM',
]);

const ALLOWED_ON_REMOVED_DEVICE = new Set([
  'ACTIVE_RESTRICTION',
  'RUNNING_KEY_REMOVE',
  'UNENROLL_DEVICE',
  'RELEASE_DEVICE',
  'GET_LOCATION',
  'GET_NUMBER',
]);

const KEY_TYPES = {
  NEW: ['new_key', 'android'],
  RUNNING: ['running_key'],
  IPHONE: ['iphone', 'iphone_key'],
};

function normalizeCommand(value) {
  const requested = String(value || '').trim().toUpperCase();
  return COMMAND_ALIASES[requested] || requested;
}

function displayStatus(device) {
  if (device.isLocked || device.status === 'locked') return 'lock';
  if (['removed', 'released'].includes(device.status)) return 'remove';
  return device.status || 'pending';
}

function displayDeviceType(keyType) {
  return ['iphone', 'iphone_key'].includes(keyType) ? 'IPHONE' : 'ANDROID';
}

function intersectTypes(current, next) {
  return current ? current.filter((value) => next.includes(value)) : next;
}

function serializeDeviceListItem(req, device) {
  const customer = device.customerId && typeof device.customerId === 'object'
    ? device.customerId
    : {};
  const image = absoluteUrl(req, customer.profileImage || customer.photo);
  const signature = absoluteUrl(req, customer.signature || customer.customerSignature);

  return {
    _id: String(device._id),
    userId: String(device._id),
    keyId: String(device._id),
    deviceId: device.deviceId || '',
    device_id: device.deviceId || '',
    deviceType: displayDeviceType(device.keyType),
    key_type: device.keyType,
    brandModel: [device.brand, device.model].filter(Boolean).join(' ').trim(),
    productImage: image ? [image] : [],
    profileImage: image,
    name: customer.name || '',
    customerName: customer.name || '',
    phone: customer.phone || '',
    mobile: customer.phone || '',
    imei1: customer.imei1 || device.imei || '',
    imei: customer.imei1 || device.imei || '',
    imei2: customer.imei2 || device.imei2 || '',
    signature,
    loanBy: customer.loanProvider || '',
    loanProvider: customer.loanProvider || '',
    emiStatus: customer.paymentType === 'without_emi' ? 'not_applicable' : 'active',
    status: displayStatus(device),
    isEnrollment: Boolean(device.isEnrolled),
    isLocked: Boolean(device.isLocked),
    batteryLevel: Number(device.batteryLevel) || 0,
    lastSeen: device.lastSeen || null,
    retailerId: device.retailerId?._id || device.retailerId || null,
    retailerName: device.retailerId?.name || '',
    emi: {
      total_amount: Number(customer.productPrice) || 0,
      down_payment: Number(customer.downPayment) || 0,
      loan_amount: Number(customer.balancePayment || customer.totalAmount) || 0,
      tenure_months: Number(customer.emiMonths) || 0,
      interest_rate: Number(customer.interestRate) || 0,
      emi_amount: Number(customer.monthlyEmi) || 0,
    },
    createdAt: device.createdAt || customer.createdAt || null,
    updatedAt: device.updatedAt || customer.updatedAt || null,
  };
}

async function buildDeviceListQuery(req) {
  const scope = await getDeviceScope(req.user);
  const conditions = Object.keys(scope).length ? [scope] : [];
  const type = String(req.query.type || '').trim().toUpperCase();
  const platform = String(req.query.deviceType || '').trim().toUpperCase();
  let keyTypes = null;

  if (KEY_TYPES[type]) keyTypes = intersectTypes(keyTypes, KEY_TYPES[type]);
  else if (type === 'ACTIVE') conditions.push({ status: 'active' });
  else if (['LOCK', 'LOCKED'].includes(type)) {
    conditions.push({ $or: [{ status: 'locked' }, { isLocked: true }] });
  } else if (['REMOVE', 'REMOVED'].includes(type)) {
    conditions.push({ status: { $in: ['removed', 'released'] } });
  } else if (type === 'PENDING') conditions.push({ status: 'pending' });

  if (platform === 'IPHONE') keyTypes = intersectTypes(keyTypes, KEY_TYPES.IPHONE);
  else if (platform === 'ANDROID') {
    keyTypes = intersectTypes(keyTypes, [...KEY_TYPES.NEW, ...KEY_TYPES.RUNNING]);
  } else if (platform === 'RUNNING') {
    keyTypes = intersectTypes(keyTypes, KEY_TYPES.RUNNING);
  }
  if (keyTypes) conditions.push({ keyType: { $in: keyTypes } });

  if (String(req.query.today || '') === '1') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    conditions.push({
      createdAt: { $gte: start, $lt: new Date(start.getTime() + 86400000) },
    });
  }

  const search = String(req.query.search || '').trim();
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    const customers = await Customer.find({
      ...scope,
      $or: [
        { name: pattern },
        { phone: pattern },
        { email: pattern },
        { imei1: pattern },
        { imei2: pattern },
      ],
    }).select('_id');

    conditions.push({
      $or: [
        { deviceId: pattern },
        { imei: pattern },
        { imei2: pattern },
        { deviceName: pattern },
        { brand: pattern },
        { model: pattern },
        { serialNumber: pattern },
        { customerId: { $in: customers.map((customer) => customer._id) } },
      ],
    });
  }

  if (!conditions.length) return {};
  return conditions.length === 1 ? conditions[0] : { $and: conditions };
}

const getDevicesPLocker = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const query = await buildDeviceListQuery(req);

    const [total, devices] = await Promise.all([
      Device.countDocuments(query),
      Device.find(query)
        .populate('customerId')
        .populate('retailerId', 'name phone company role')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    return res.json({
      success: true,
      status: 200,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      data: devices.map((device) => serializeDeviceListItem(req, device)),
    });
  } catch (err) {
    console.error('P Locker MDM device list error:', err);
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || 'Device list load failed.',
      data: [],
    });
  }
};

function serializeLocation(device) {
  const location = device.lastLocation || {};
  return {
    latitude: Number(location.lat) || 0,
    longitude: Number(location.lng) || 0,
    accuracy: Number(location.accuracy) || 0,
    timestamp: location.timestamp || device.lastSeen || null,
    provider: location.provider || 'device',
    address: location.address || '',
  };
}

const getDeviceLocationPLocker = async (req, res) => {
  try {
    const device = await findAccessibleDevice(
      req.user,
      req.params.identifier,
      'deviceId lastLocation lastSeen retailerId'
    );
    if (!device) {
      return res.status(404).json({ success: false, status: 404, message: 'Device not found.' });
    }
    return res.json({
      success: true,
      status: 200,
      deviceId: device.deviceId,
      location: serializeLocation(device),
      lastSeen: device.lastSeen || null,
    });
  } catch (err) {
    return res.status(500).json({ success: false, status: 500, message: err.message });
  }
};

const getDeviceSimInfoPLocker = async (req, res) => {
  try {
    const device = await findAccessibleDevice(
      req.user,
      req.params.identifier,
      'deviceId simNumber simNumber2 simOperator lastSeen retailerId'
    );
    if (!device) {
      return res.status(404).json({ success: false, status: 404, message: 'Device not found.' });
    }
    const currentSimInfo = {
      sim1_number: device.simNumber || null,
      sim2_number: device.simNumber2 || null,
      sim1_operator: device.simOperator || null,
    };
    return res.json({
      success: true,
      status: 200,
      deviceId: device.deviceId,
      simNumber: device.simNumber || null,
      simNumber2: device.simNumber2 || null,
      simOperator: device.simOperator || null,
      current_sim_info: currentSimInfo,
      sim_info: currentSimInfo,
      lastSeen: device.lastSeen || null,
    });
  } catch (err) {
    return res.status(500).json({ success: false, status: 500, message: err.message });
  }
};

async function syncCustomerState(device, command) {
  if (!device.customerId) return;

  const update = {};
  if (['LOCK_DEVICE', 'OFFLINE_LOCK'].includes(command)) {
    Object.assign(update, {
      status: 'locked',
      isDeviceLocked: true,
      lockReason: 'manual',
      lastLockedAt: new Date(),
    });
  } else if (['UNLOCK_DEVICE', 'OFFLINE_UNLOCK', 'ACTIVE_RESTRICTION'].includes(command)) {
    Object.assign(update, {
      status: 'active',
      isDeviceLocked: false,
      lockReason: '',
      lastUnlockedAt: new Date(),
    });
  } else if (['UNENROLL', 'UNENROLL_DEVICE', 'RUNNING_KEY_REMOVE'].includes(command)) {
    Object.assign(update, {
      status: 'removed',
      isDeviceLocked: false,
      lockReason: 'key_removed',
    });
  }

  if (Object.keys(update).length) {
    await Customer.findByIdAndUpdate(device.customerId, update);
  }
}

async function applyDeviceState(device, command, payload) {
  if (['LOCK_DEVICE', 'OFFLINE_LOCK'].includes(command)) {
    device.isLocked = true;
    device.status = 'locked';
    device.lockMessage = payload.message || 'Device locked';
    device.lockPhone = payload.phone_number || payload.phoneNumber || '';
  } else if (['UNLOCK_DEVICE', 'OFFLINE_UNLOCK'].includes(command)) {
    device.isLocked = false;
    device.status = 'active';
    device.lockMessage = '';
    device.lockPhone = '';
  } else if (command === 'ACTIVE_RESTRICTION') {
    device.status = 'active';
    device.isLocked = false;
    device.isEnrolled = true;
    device.mdmActive = true;
  } else if (command === 'DEACTIVE_RESTRICTION') {
    device.mdmActive = false;
  } else if (['UNENROLL', 'UNENROLL_DEVICE', 'RUNNING_KEY_REMOVE'].includes(command)) {
    device.status = 'removed';
    device.isLocked = false;
    device.mdmActive = false;
    device.isEnrolled = command === 'RUNNING_KEY_REMOVE';
    device.lockMessage = '';
    device.lockPhone = '';
  } else if (command === 'RELEASE_DEVICE') {
    device.status = 'released';
    device.isLocked = false;
    device.mdmActive = false;
    device.isEnrolled = false;
    device.releasedAt = new Date();
    device.releaseNote = payload.note || 'Device released';
  }

  device.lastCommandAt = new Date();
  await device.save();
  await syncCustomerState(device, command);
}

function commandResponse(command, device, fcm, alreadyExists = false) {
  return {
    success: true,
    status: 200,
    message: alreadyExists
      ? `${command.commandType} command already pending hai.`
      : `${command.commandType} command sent.`,
    already_exists: alreadyExists,
    command: {
      _id: String(command._id),
      device_id: String(device._id),
      command_type: command.commandType,
      status: command.status,
      priority: Number(command.priority) || 5,
      result: command.deviceResponse || null,
      error: command.errorMessage || null,
      retry_count: 0,
      max_retries: 10,
      executed_at: command.executedAt || null,
      created_by: command.createdBy || null,
      policy_id: null,
      command_id: String(command._id),
      createdAt: command.createdAt || null,
      updatedAt: command.updatedAt || null,
    },
    fcm: {
      success: Boolean(fcm?.success),
      error: fcm?.error || null,
      error_code: fcm?.errorCode || null,
    },
  };
}

const sendDeviceCommandPLocker = async (req, res) => {
  try {
    const identifier = req.body.deviceId || req.body.device_id || req.body.id;
    const requestedCommand = req.body.command || req.body.command_type || req.body.commandType;
    const commandType = normalizeCommand(requestedCommand);

    if (!identifier || !commandType) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'device_id aur command_type required hain.',
      });
    }
    if (!SUPPORTED_COMMANDS.has(commandType)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: `Unsupported MDM command: ${requestedCommand}`,
      });
    }

    const device = await findAccessibleDevice(req.user, identifier);
    if (!device) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Device not found ya access denied.',
      });
    }
    if (device.status === 'released' && commandType !== 'RELEASE_DEVICE') {
      return res.status(403).json({
        success: false,
        status: 403,
        message: 'Released device par MDM command allowed nahi hai.',
      });
    }
    if (
      device.status === 'removed'
      && !ALLOWED_ON_REMOVED_DEVICE.has(commandType)
    ) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: 'Removed device par yeh MDM command allowed nahi hai.',
      });
    }

    const payload = { ...(req.body.payload || {}) };
    const reserved = new Set([
      'deviceId', 'device_id', 'id', 'command', 'command_type', 'commandType', 'payload',
    ]);
    Object.entries(req.body).forEach(([key, value]) => {
      if (!reserved.has(key)) payload[key] = value;
    });
    if (String(requestedCommand).toUpperCase() !== commandType) {
      payload.requestedCommand = requestedCommand;
    }
    if (commandType === 'CUSTOM') payload.action = requestedCommand;

    const existing = await Command.findOne({
      deviceId: device._id,
      commandType,
      status: { $in: ['pending', 'sent'] },
      createdAt: { $gte: new Date(Date.now() - 5000) },
    }).sort({ createdAt: -1 });
    if (existing) return res.json(commandResponse(existing, device, null, true));

    await applyDeviceState(device, commandType, payload);

    const hasFcm = Boolean(device.fcmToken);
    const command = await Command.create({
      deviceId: device._id,
      commandType,
      payload,
      label: req.body.label || commandType,
      priority: Number(req.body.priority) || 5,
      deliveryMethod: hasFcm ? 'fcm' : 'poll',
      status: hasFcm ? 'sent' : 'pending',
      sentAt: hasFcm ? new Date() : undefined,
      createdBy: req.user._id,
    });

    let fcm = { success: false, error: hasFcm ? null : 'FCM token not available' };
    if (hasFcm) {
      fcm = await sendFCM(
        device.fcmToken,
        commandType,
        req.body.label || commandType,
        {
          command: commandType,
          commandType,
          deviceId: device.deviceId,
          commandId: String(command._id),
          ...payload,
        }
      );
      if (!fcm.success) {
        command.deliveryMethod = 'poll';
        command.status = 'pending';
        command.errorMessage = fcm.error || 'FCM delivery failed';
        await command.save();
      }
    }

    return res.json(commandResponse(command, device, fcm));
  } catch (err) {
    console.error('P Locker MDM command error:', err);
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || 'MDM command failed.',
    });
  }
};

function commandAlias(commandType) {
  return (req, res) => {
    req.body = {
      ...req.body,
      command_type: commandType,
      payload: {
        ...(req.body.payload || {}),
        ...(req.body.reason ? { reason: req.body.reason } : {}),
        ...(req.body.message ? { message: req.body.message } : {}),
      },
    };
    return sendDeviceCommandPLocker(req, res);
  };
}

module.exports = {
  buildDeviceListQuery,
  commandAlias,
  getDeviceLocationPLocker,
  getDeviceSimInfoPLocker,
  getDevicesPLocker,
  normalizeCommand,
  sendDeviceCommandPLocker,
  serializeDeviceListItem,
};
