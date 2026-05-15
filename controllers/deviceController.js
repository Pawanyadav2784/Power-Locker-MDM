const Device  = require('../models/Device');
const Command = require('../models/Command');
const Customer = require('../models/Customer');
const { sendFCM } = require('../utils/fcmHelper');

// ── FCM Command Helper ─────────────────────────────────────
const dispatchCommand = async (device, commandType, payload = {}, label = '', createdBy = null) => {
  const cmd = await Command.create({
    deviceId: device._id, commandType, payload, label,
    deliveryMethod: 'fcm', status: 'sent',
    sentAt: new Date(), createdBy,
  });
  if (device.fcmToken) {
    const r = await sendFCM(device.fcmToken, commandType, label || commandType,
      { command: commandType, deviceId: device.deviceId, ...payload });
    if (!r.success) { cmd.status = 'failed'; await cmd.save(); }
  }
  return cmd;
};

// ── Role-based device filter ───────────────────────────────
const deviceFilter = (user) =>
  user.role === 'super_admin' ? {} : { retailerId: user._id };

// ══ GET ALL DEVICES ════════════════════════════════════════
// GET /api/devices
const getAllDevices = async (req, res) => {
  try {
    const { status, keyType, search, page = 1, limit = 20 } = req.query;
    const query = deviceFilter(req.user);
    if (status)  query.status  = status;
    if (keyType) query.keyType = keyType;
    if (search) {
      query.$or = [
        { deviceId: new RegExp(search, 'i') }, { imei: new RegExp(search, 'i') },
        { deviceName: new RegExp(search, 'i') }, { simNumber: new RegExp(search, 'i') },
        { brand: new RegExp(search, 'i') }, { model: new RegExp(search, 'i') },
      ];
    }
    const total = await Device.countDocuments(query);
    const devices = await Device.find(query)
      .populate('customerId', 'name phone emiType monthlyEmi status nextEmiDate')
      .populate('retailerId', 'name phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit).limit(Number(limit));
    res.json({ success: true, total, totalPages: Math.ceil(total / limit), currentPage: Number(page), data: devices });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ GET SINGLE DEVICE ══════════════════════════════════════
// GET /api/devices/:id
const getDevice = async (req, res) => {
  try {
    const device = await Device.findById(req.params.id)
      .populate('customerId').populate('retailerId', 'name phone email');
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, device });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ REGISTER / CREATE DEVICE ═══════════════════════════════
// POST /api/devices/register
const registerDevice = async (req, res) => {
  try {
    const { imei, deviceName, brand, model, androidVersion, keyType, retailerId } = req.body;
    const assignRetailer = req.user.role === 'super_admin' ? (retailerId || req.user._id) : req.user._id;
    const device = await Device.create({
      imei, deviceName, brand, model, androidVersion,
      keyType: keyType || 'running_key',
      retailerId: assignRetailer,
    });
    res.status(201).json({ success: true, message: 'Device registered', device });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ UPDATE DEVICE ══════════════════════════════════════════
// PUT /api/devices/:id
const updateDevice = async (req, res) => {
  try {
    const allowed = ['deviceName','brand','model','androidVersion','keyType','keyExpiryDate','notes','simNumber','imei','imei2','serialNumber'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const device = await Device.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, device });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ DELETE DEVICE ══════════════════════════════════════════
// DELETE /api/devices/:id
const deleteDevice = async (req, res) => {
  try {
    const device = await Device.findById(req.params.id);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    if (device.customerId) await Customer.findByIdAndUpdate(device.customerId, { deviceId: null, qrCode: '' });
    await Device.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Device deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ DEVICE STATISTICS ══════════════════════════════════════
// GET /api/devices/statistics
const getStatistics = async (req, res) => {
  try {
    const q = deviceFilter(req.user);
    const [total, locked, active, pending, unenrolled] = await Promise.all([
      Device.countDocuments(q),
      Device.countDocuments({ ...q, isLocked: true }),
      Device.countDocuments({ ...q, status: 'active' }),
      Device.countDocuments({ ...q, status: 'pending' }),
      Device.countDocuments({ ...q, status: 'unenrolled' }),
    ]);
    res.json({ success: true, total, locked, active, pending, unenrolled, online: active });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ DEVICE CHECK-IN (MDM App Heartbeat) ════════════════════
// POST /api/devices/check-in  (no auth — called by APK)
const checkIn = async (req, res) => {
  try {
    const { deviceId, fcmToken, batteryLevel, simNumber, simNumber2, simOperator,
      lat, lng, isCharging, androidVersion, brand, model, imei, ipAddress, sdkVersion } = req.body;

    const updates = {
      lastSeen: new Date(),
      batteryLevel: batteryLevel || 0,
      ...(fcmToken      && { fcmToken }),
      ...(simNumber     && { simNumber }),
      ...(simNumber2    && { simNumber2 }),
      ...(simOperator   && { simOperator }),
      ...(androidVersion && { androidVersion }),
      ...(brand         && { brand }),
      ...(model         && { model }),
      ...(imei          && { imei }),
      ...(ipAddress     && { ipAddress }),
      ...(sdkVersion    && { sdkVersion }),
      ...(isCharging !== undefined && { isCharging }),
      ...(lat && { 'lastLocation.lat': lat, 'lastLocation.lng': lng, 'lastLocation.timestamp': new Date() }),
    };

    const device = await Device.findOneAndUpdate({ deviceId }, updates, { new: true });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

    // Mark enrolled if first check-in with fcmToken
    if (fcmToken && !device.isEnrolled) {
      device.isEnrolled = true; device.enrolledAt = new Date(); device.mdmActive = true;
      await device.save();
    }

    const pendingCommands = await Command.find({ deviceId: device._id, status: 'pending' });
    res.json({
      success: true,
      isLocked: device.isLocked,
      lockMessage: device.lockMessage,
      lockPhone: device.lockPhone,
      pendingCommands: pendingCommands.map(c => ({ _id: c._id, commandType: c.commandType, payload: c.payload })),
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ LOCK DEVICE ════════════════════════════════════════════
// POST /api/devices/lock
const lockDevice = async (req, res) => {
  try {
    const { deviceId, message, phone_number } = req.body;
    const filter = req.user.role === 'super_admin' ? { deviceId } : { deviceId, retailerId: req.user._id };
    const device = await Device.findOne(filter);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    device.isLocked = true;
    device.lockMessage = message || 'Device locked by administrator';
    device.lockPhone = phone_number || '';
    device.status = 'locked';
    await device.save();
    await dispatchCommand(device, 'LOCK_DEVICE', { message, phone_number }, 'Lock Device', req.user._id);
    res.json({ success: true, message: 'Lock command sent' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ UNLOCK DEVICE ══════════════════════════════════════════
// POST /api/devices/unlock
const unlockDevice = async (req, res) => {
  try {
    const { deviceId } = req.body;
    const filter = req.user.role === 'super_admin' ? { deviceId } : { deviceId, retailerId: req.user._id };
    const device = await Device.findOneAndUpdate(filter,
      { isLocked: false, lockMessage: '', lockPhone: '', status: 'active' }, { new: true });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    await dispatchCommand(device, 'UNLOCK_DEVICE', {}, 'Unlock Device', req.user._id);
    res.json({ success: true, message: 'Unlock command sent' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ REBOOT ════════════════════════════════════════════════
const rebootDevice = async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.body.deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    await dispatchCommand(device, 'REBOOT', {}, 'Reboot', req.user._id);
    res.json({ success: true, message: 'Reboot command sent' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ WIPE (Factory Reset) ═══════════════════════════════════
const wipeDevice = async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.body.deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    await dispatchCommand(device, 'WIPE', {}, 'Factory Reset', req.user._id);
    device.status = 'removed'; await device.save();
    res.json({ success: true, message: 'Wipe command sent' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ GET LOCATION ══════════════════════════════════════════
const getLocation = async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.body.deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    await dispatchCommand(device, 'GET_LOCATION', {}, 'Get Location', req.user._id);
    res.json({ success: true, message: 'Location request sent', lastLocation: device.lastLocation });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ SEND MESSAGE ══════════════════════════════════════════
const sendMessage = async (req, res) => {
  try {
    const { deviceId, message } = req.body;
    const device = await Device.findOne({ deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    await dispatchCommand(device, 'MESSAGE', { message }, message, req.user._id);
    res.json({ success: true, message: 'Message sent' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ PLAY ALERT ════════════════════════════════════════════
const playAlert = async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.body.deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    await dispatchCommand(device, 'PLAY_ALERT', {}, 'Play Alert', req.user._id);
    res.json({ success: true, message: 'Alert command sent' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ UNENROLL ══════════════════════════════════════════════
const unenrollDevice = async (req, res) => {
  try {
    const { deviceId, factoryReset = false } = req.body;
    const device = await Device.findOne({ deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    await dispatchCommand(device, factoryReset ? 'HARD_RESET' : 'SOFT_RESET', {}, 'Unenroll', req.user._id);
    device.status = 'unenrolled'; device.isEnrolled = false; device.mdmActive = false;
    await device.save();
    res.json({ success: true, message: 'Unenroll command sent' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ INSTALL APP ═══════════════════════════════════════════
const installApp = async (req, res) => {
  try {
    const { deviceId, apkUrl, packageName, appName } = req.body;
    if (!deviceId || !apkUrl) return res.status(400).json({ success: false, message: 'deviceId & apkUrl required' });
    const device = await Device.findOne({ deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    await dispatchCommand(device, 'INSTALL_APP', { apkUrl, packageName, appName }, 'Install App', req.user._id);
    res.json({ success: true, message: 'Install command sent' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ REMOVE APP ════════════════════════════════════════════
const removeApp = async (req, res) => {
  try {
    const { deviceId, packageName } = req.body;
    if (!deviceId || !packageName) return res.status(400).json({ success: false, message: 'deviceId & packageName required' });
    const device = await Device.findOne({ deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    await dispatchCommand(device, 'REMOVE_APP', { packageName }, 'Remove App', req.user._id);
    res.json({ success: true, message: 'Remove app command sent' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ GET SIM NUMBER ════════════════════════════════════════
const getSimNumber = async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId }).select('simNumber simNumber2 simOperator');
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, simNumber: device.simNumber, simNumber2: device.simNumber2, simOperator: device.simOperator });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ GET NUMBER (FCM trigger) ══════════════════════════════
const getNumber = async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.body.deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    await dispatchCommand(device, 'GET_NUMBER', {}, 'Get SIM Number', req.user._id);
    res.json({ success: true, message: 'Get number command sent', currentSimNumber: device.simNumber });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ UPDATE COMMAND STATUS (called by APK) ════════════════
const updateCommandStatus = async (req, res) => {
  try {
    const { commandId, status, deviceResponse } = req.body;
    await Command.findByIdAndUpdate(commandId, { status, executedAt: new Date(), ...(deviceResponse && { deviceResponse }) });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ UPDATE DEVICE INFO (called by APK) ═══════════════════
const updateDeviceInfo = async (req, res) => {
  try {
    const { deviceId, simNumber, simNumber2, simOperator, batteryLevel, lat, lng,
      brand, model, androidVersion, imei, ipAddress, isCharging, storageFree, storageTotal, ramFree, ramTotal } = req.body;
    const updates = {
      ...(simNumber    && { simNumber }),
      ...(simNumber2   && { simNumber2 }),
      ...(simOperator  && { simOperator }),
      ...(batteryLevel !== undefined && { batteryLevel }),
      ...(isCharging !== undefined && { isCharging }),
      ...(brand        && { brand }),
      ...(model        && { model }),
      ...(androidVersion && { androidVersion }),
      ...(imei         && { imei }),
      ...(ipAddress    && { ipAddress }),
      ...(storageFree !== undefined && { storageFree }),
      ...(storageTotal !== undefined && { storageTotal }),
      ...(ramFree !== undefined && { ramFree }),
      ...(ramTotal !== undefined && { ramTotal }),
      lastSeen: new Date(),
      ...(lat && { 'lastLocation.lat': lat, 'lastLocation.lng': lng, 'lastLocation.timestamp': new Date() }),
    };
    const device = await Device.findOneAndUpdate({ deviceId }, updates, { new: true });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, device });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ BULK COMMAND (multiple devices) ══════════════════════
// POST /api/devices/bulk-command
const bulkCommand = async (req, res) => {
  try {
    const { deviceIds, commandType, payload = {}, label } = req.body;
    if (!deviceIds?.length || !commandType) return res.status(400).json({ success: false, message: 'deviceIds & commandType required' });
    const results = [];
    for (const did of deviceIds) {
      try {
        const device = await Device.findOne({ deviceId: did });
        if (!device) { results.push({ deviceId: did, success: false, error: 'Not found' }); continue; }
        await dispatchCommand(device, commandType, payload, label || commandType, req.user._id);
        results.push({ deviceId: did, success: true });
      } catch (e) { results.push({ deviceId: did, success: false, error: e.message }); }
    }
    res.json({ success: true, results });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ SET KIOSK MODE ════════════════════════════════════════
const setKioskMode = async (req, res) => {
  try {
    const { deviceId, enable, packageName } = req.body;
    const device = await Device.findOne({ deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    device.kioskMode        = enable;
    device.kioskPackageName = enable ? (packageName || '') : '';
    await device.save();
    await dispatchCommand(device, 'CUSTOM', { kioskMode: enable, packageName }, enable ? 'Enable Kiosk' : 'Disable Kiosk', req.user._id);
    res.json({ success: true, message: `Kiosk mode ${enable ? 'enabled' : 'disabled'}` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ DEVICE COMMAND HISTORY ════════════════════════════════
// GET /api/devices/:id/commands
const getDeviceCommands = async (req, res) => {
  try {
    const device = await Device.findById(req.params.id);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    const { page = 1, limit = 20 } = req.query;
    const total    = await Command.countDocuments({ deviceId: device._id });
    const commands = await Command.find({ deviceId: device._id })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit).limit(Number(limit))
      .populate('createdBy', 'name role');
    res.json({ success: true, total, data: commands });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══ SOFT & HARD RESET ════════════════════════════════════
const softReset = async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.body.deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    await dispatchCommand(device, 'SOFT_RESET', {}, 'Soft Reset', req.user._id);
    res.json({ success: true, message: 'Soft reset command sent' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

const hardReset = async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.body.deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    await dispatchCommand(device, 'HARD_RESET', {}, 'Hard Reset', req.user._id);
    res.json({ success: true, message: 'Hard reset command sent' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

module.exports = {
  getAllDevices, getDevice, registerDevice, updateDevice, deleteDevice,
  getStatistics, checkIn, updateDeviceInfo,
  lockDevice, unlockDevice, rebootDevice, wipeDevice,
  getLocation, sendMessage, playAlert, unenrollDevice,
  installApp, removeApp, getSimNumber, getNumber,
  updateCommandStatus, bulkCommand, setKioskMode,
  getDeviceCommands, softReset, hardReset, dispatchCommand,
};
