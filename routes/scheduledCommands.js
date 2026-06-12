const express = require('express');
const router = express.Router();
const ScheduledCommand = require('../models/ScheduledCommand');
const Command = require('../models/Command');
const { protect } = require('../middleware/auth');
const { sendFCM } = require('../utils/fcmHelper');
const { findAccessibleDevice } = require('../utils/deviceAccess');

const SCHEDULE_COMMANDS = new Set([
  'LOCK_DEVICE',
  'UNLOCK_DEVICE',
  'REBOOT',
  'WIPE',
  'MESSAGE',
  'PLAY_ALERT',
]);
const DELIVERY_METHODS = new Set(['fcm', 'sms', 'both']);

// POST /api/scheduled-commands/
router.post('/', protect, async (req, res) => {
  try {
    const {
      device_id,
      command_type,
      schedule_type,
      scheduled_at,
      label,
      delivery_method,
      payload,
    } = req.body;
    const deviceIdentifier = String(device_id || '').trim();
    const commandType = String(command_type || '').trim().toUpperCase();
    const scheduleType = String(schedule_type || 'one_time').trim().toLowerCase();
    const deliveryMethod = String(delivery_method || 'fcm').trim().toLowerCase();
    const scheduledAt = new Date(scheduled_at);

    if (!deviceIdentifier || !commandType || !scheduled_at) {
      return res.status(400).json({
        success: false,
        message: 'device_id, command_type aur scheduled_at required hain.',
      });
    }
    if (!SCHEDULE_COMMANDS.has(commandType)) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported scheduled command.',
      });
    }
    if (!['one_time', 'recurring'].includes(scheduleType)) {
      return res.status(400).json({
        success: false,
        message: 'schedule_type one_time ya recurring hona chahiye.',
      });
    }
    if (!DELIVERY_METHODS.has(deliveryMethod)) {
      return res.status(400).json({
        success: false,
        message: 'delivery_method fcm, sms ya both hona chahiye.',
      });
    }
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'scheduled_at valid future date honi chahiye.',
      });
    }

    const device = await findAccessibleDevice(req.user, deviceIdentifier);
    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Device not found ya access denied.',
      });
    }
    if (['removed', 'released'].includes(device.status)) {
      return res.status(409).json({
        success: false,
        message: 'Removed ya released device par schedule allowed nahi hai.',
      });
    }

    const cmd = await ScheduledCommand.create({
      deviceId: device._id,
      commandType,
      scheduleType,
      scheduledAt,
      label: label || '',
      deliveryMethod,
      payload: payload || {},
      createdBy: req.user._id,
    });

    const localSchedulePayload = {
      ...(payload || {}),
      scheduleId: String(cmd._id),
      scheduleCommandType: commandType,
      scheduledAt: cmd.scheduledAt.toISOString(),
      label: label || '',
    };

    const setupCommand = await Command.create({
      deviceId: device._id,
      commandType: 'SCHEDULER_LOCK',
      payload: localSchedulePayload,
      label: label || `Schedule ${commandType}`,
      deliveryMethod: device.fcmToken ? 'fcm' : 'poll',
      status: device.fcmToken ? 'sent' : 'pending',
      sentAt: device.fcmToken ? new Date() : undefined,
      createdBy: req.user._id,
    });

    let setupDelivery = { success: false, via: 'poll' };
    if (device.fcmToken) {
      setupDelivery = await sendFCM(
        device.fcmToken,
        'Schedule Command',
        label || commandType,
        {
          command: 'SCHEDULER_LOCK',
          commandType: 'SCHEDULER_LOCK',
          deviceId: device.deviceId,
          ...localSchedulePayload,
        }
      );

      if (!setupDelivery.success) {
        setupCommand.deliveryMethod = 'poll';
        setupCommand.status = 'pending';
        setupCommand.errorMessage = setupDelivery.error || 'FCM delivery failed';
        await setupCommand.save();
      }
    }

    res.status(201).json({
      success: true,
      message: 'Command scheduled',
      command: cmd,
      localSetup: {
        commandId: setupCommand._id,
        deliveryMethod: setupCommand.deliveryMethod,
        status: setupCommand.status,
        fcm: setupDelivery,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/scheduled-commands/
router.get('/', protect, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const query = req.user.role === 'super_admin'
      ? {}
      : { createdBy: req.user._id };
    if (status) query.status = status;
    const total = await ScheduledCommand.countDocuments(query);
    const commands = await ScheduledCommand.find(query)
      .populate('deviceId', 'deviceId deviceName')
      .sort({ scheduledAt: 1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    res.json({ success: true, total, data: commands });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/scheduled-commands/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    const query = req.user.role === 'super_admin'
      ? { _id: req.params.id }
      : { _id: req.params.id, createdBy: req.user._id };
    const command = await ScheduledCommand.findOneAndUpdate(
      { ...query, status: 'pending' },
      { status: 'cancelled' },
      { new: true }
    );
    if (!command) {
      return res.status(404).json({
        success: false,
        message: 'Pending schedule not found ya access denied.',
      });
    }
    res.json({ success: true, message: 'Command cancelled' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
