/**
 * commandController.js  —  Power Locker MDM
 *
 * SINGLE endpoint  POST /api/cmd
 * Body: { deviceId, command, payload? }
 *
 * command values:
 *   LOCK_DEVICE | UNLOCK_DEVICE | REBOOT | SOFT_RESET | HARD_RESET | WIPE
 *   GET_LOCATION | MESSAGE | PLAY_ALERT | GET_NUMBER
 *   INSTALL_APP | REMOVE_APP | UNENROLL
 *   SOCIAL_LOCK | SOCIAL_UNLOCK | APPLY_POLICY
 *   CUSTOM (kuch bhi bhejo)
 *
 * Device app endpoints (no auth):
 *   POST /api/cmd/ack       — status update
 *   GET  /api/cmd/:deviceId — pending commands poll
 */

const Command = require('../models/Command');
const Device  = require('../models/Device');
const { sendFCM } = require('../utils/fcmHelper');

const DEFAULT_SOCIAL_APPS = [
  'com.facebook.katana', 'com.instagram.android', 'com.whatsapp',
  'com.twitter.android', 'com.snapchat.android', 'com.zhiliaoapp.musically',
  'com.google.android.youtube', 'com.linkedin.android',
];

// ── FCM dispatch helper ────────────────────────────────────
const dispatch = async (device, commandType, payload = {}, label = '', userId = null) => {
  const cmd = await Command.create({
    deviceId: device._id, commandType, payload, label,
    deliveryMethod: 'fcm', status: 'sent',
    sentAt: new Date(), createdBy: userId,
  });
  if (device.fcmToken) {
    const r = await sendFCM(device.fcmToken, commandType, label || commandType,
      { command: commandType, deviceId: device.deviceId, ...payload });
    if (!r.success) { cmd.status = 'failed'; await cmd.save(); }
  }
  return cmd;
};

// ── Auto state updates per command ────────────────────────
const applyStateChange = async (device, command, payload) => {
  if (command === 'LOCK_DEVICE') {
    device.isLocked = true; device.status = 'locked';
    device.lockMessage = payload?.message || 'Device locked';
    device.lockPhone   = payload?.phone_number || '';
  } else if (command === 'UNLOCK_DEVICE') {
    device.isLocked = false; device.status = 'active';
    device.lockMessage = ''; device.lockPhone = '';
  } else if (command === 'UNENROLL') {
    device.status = 'unenrolled'; device.isEnrolled = false; device.mdmActive = false;
  } else if (command === 'WIPE') {
    device.status = 'removed';
  }
  await device.save();
};

// ══════════════════════════════════════════════════════════
//  MAIN:  POST /api/cmd
//  Body:  { deviceId, command, payload? }
// ══════════════════════════════════════════════════════════
const sendCommand = async (req, res) => {
  try {
    const { deviceId, device_id, command, command_type, commandType, payload = {} } = req.body;

    const did = deviceId || device_id;
    const cmd = command || command_type || commandType;

    if (!did) return res.status(400).json({ success: false, message: 'deviceId required' });
    if (!cmd) return res.status(400).json({ success: false, message: 'command required' });

    // Role-based device access
    const filter = req.user.role === 'super_admin'
      ? { deviceId: did }
      : { deviceId: did, retailerId: req.user._id };

    const device = await Device.findOne(filter);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found or access denied' });

    // Build final payload per command type
    let finalPayload = { ...payload };
    if (cmd === 'LOCK_DEVICE')   finalPayload.message     = payload.message || 'EMI baaki hai — device locked';
    if (cmd === 'SOCIAL_LOCK')   finalPayload.apps        = payload.apps || DEFAULT_SOCIAL_APPS;
    if (cmd === 'INSTALL_APP' && !payload.apkUrl) return res.status(400).json({ success: false, message: 'payload.apkUrl required for INSTALL_APP' });
    if (cmd === 'REMOVE_APP'  && !payload.packageName) return res.status(400).json({ success: false, message: 'payload.packageName required for REMOVE_APP' });
    if (cmd === 'MESSAGE'     && !payload.message) return res.status(400).json({ success: false, message: 'payload.message required for MESSAGE' });

    // Apply device state change
    await applyStateChange(device, cmd, finalPayload);

    // Dispatch via FCM
    const command_record = await dispatch(device, cmd, finalPayload, payload.label || cmd, req.user._id);

    // Special: GET_NUMBER → return stored number instantly
    if (cmd === 'GET_NUMBER') {
      return res.json({
        success: true,
        message: device.simNumber ? 'Number fetched' : 'Refresh command sent — retry in 2s',
        commandId:   command_record._id,
        simNumber:   device.simNumber  || null,
        simNumber2:  device.simNumber2 || null,
        simOperator: device.simOperator || null,
        deviceId:    device.deviceId,
      });
    }

    res.json({
      success:   true,
      message:   `${cmd} command sent`,
      commandId: command_record._id,
      deviceId:  device.deviceId,
      status:    command_record.status,
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  ACK:  POST /api/cmd/ack  (Android APK calls — no auth)
//  Body: { commandId, status, deviceResponse?, errorMessage? }
// ══════════════════════════════════════════════════════════
const ackCommand = async (req, res) => {
  try {
    const { commandId, status, deviceResponse, errorMessage } = req.body;
    if (!commandId) return res.status(400).json({ success: false, message: 'commandId required' });

    const update = { status };
    if (status === 'executed')  update.executedAt  = new Date();
    if (status === 'delivered') update.deliveredAt = new Date();
    if (deviceResponse !== undefined) update.deviceResponse = deviceResponse;
    if (errorMessage) update.errorMessage = errorMessage;

    const command = await Command.findByIdAndUpdate(commandId, update, { new: true });

    // GET_NUMBER response → save simNumber to device
    if (command?.commandType === 'GET_NUMBER' && status === 'executed' && deviceResponse) {
      const num = deviceResponse?.simNumber || deviceResponse?.phoneNumber
        || deviceResponse?.number || (typeof deviceResponse === 'string' ? deviceResponse : null);
      if (num) {
        await Device.findByIdAndUpdate(command.deviceId, {
          simNumber:    num,
          simOperator:  deviceResponse?.simOperator  || '',
          simNumber2:   deviceResponse?.simNumber2   || '',
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  POLL:  GET /api/cmd/:deviceId  (Android APK — no auth)
//  Android app yahan se pending commands fetch karta hai
// ══════════════════════════════════════════════════════════
const pollCommands = async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

    const pending = await Command.find({
      deviceId: device._id,
      status:   { $in: ['pending', 'sent'] },
    }).sort({ priority: 1, createdAt: 1 });

    // Mark sent → delivered
    await Command.updateMany(
      { deviceId: device._id, status: 'sent' },
      { status: 'delivered', deliveredAt: new Date() }
    );

    res.json({
      success:     true,
      isLocked:    device.isLocked,
      lockMessage: device.lockMessage,
      lockPhone:   device.lockPhone || '',
      commands:    pending.map(c => ({ _id: c._id, commandType: c.commandType, payload: c.payload })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════
//  LIST:  GET /api/cmd  (Admin panel)
//  Query: ?deviceId&status&page&limit
// ══════════════════════════════════════════════════════════
const listCommands = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, commandType, deviceId } = req.query;
    const query = req.user.role === 'super_admin' ? {} : { createdBy: req.user._id };
    if (status)      query.status      = status;
    if (commandType) query.commandType = commandType;
    if (deviceId) {
      const dev = await Device.findOne({ deviceId });
      if (dev) query.deviceId = dev._id;
    }
    const total    = await Command.countDocuments(query);
    const commands = await Command.find(query)
      .populate('deviceId', 'deviceId deviceName brand model status isLocked')
      .populate('createdBy', 'name role')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit).limit(Number(limit));

    res.json({ success: true, total, totalPages: Math.ceil(total / limit), data: commands });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { sendCommand, ackCommand, pollCommands, listCommands };
