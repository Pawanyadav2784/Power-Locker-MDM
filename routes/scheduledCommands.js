const express = require('express');
const router = express.Router();
const ScheduledCommand = require('../models/ScheduledCommand');
const Device = require('../models/Device');
const Command = require('../models/Command');
const { protect } = require('../middleware/auth');
const { sendFCM } = require('../utils/fcmHelper');

// POST /api/scheduled-commands/
router.post('/', protect, async (req, res) => {
  try {
    const { device_id, command_type, schedule_type, scheduled_at, label, delivery_method, payload } = req.body;

    // Find device by deviceId string or _id
    const device = await Device.findOne(
      device_id.length === 24 ? { _id: device_id } : { deviceId: device_id }
    );
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

    const cmd = await ScheduledCommand.create({
      deviceId: device._id,
      commandType: command_type,
      scheduleType: schedule_type || 'one_time',
      scheduledAt: new Date(scheduled_at),
      label: label || '',
      deliveryMethod: delivery_method || 'fcm',
      payload: payload || {},
      createdBy: req.user._id,
    });

    const localSchedulePayload = {
      ...(payload || {}),
      scheduleId: String(cmd._id),
      scheduleCommandType: command_type,
      scheduledAt: cmd.scheduledAt.toISOString(),
      label: label || '',
    };

    const setupCommand = await Command.create({
      deviceId: device._id,
      commandType: 'SCHEDULER_LOCK',
      payload: localSchedulePayload,
      label: label || `Schedule ${command_type}`,
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
        label || command_type,
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
    const query = { createdBy: req.user._id };
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
    await ScheduledCommand.findByIdAndUpdate(req.params.id, { status: 'cancelled' });
    res.json({ success: true, message: 'Command cancelled' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
