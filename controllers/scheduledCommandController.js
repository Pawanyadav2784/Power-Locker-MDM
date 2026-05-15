const ScheduledCommand = require('../models/ScheduledCommand');
const Device = require('../models/Device');

// @desc    Create scheduled command
// @route   POST /api/scheduled-commands
const createSchedule = async (req, res) => {
  try {
    const { device_id, command_type, schedule_type, scheduled_at, label, delivery_method, payload } = req.body;
    const device = await Device.findOne(
      device_id.length === 24 ? { _id: device_id } : { deviceId: device_id }
    );
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

    const cmd = await ScheduledCommand.create({
      deviceId: device._id, commandType: command_type,
      scheduleType: schedule_type || 'one_time',
      scheduledAt: new Date(scheduled_at),
      label: label || '', deliveryMethod: delivery_method || 'fcm',
      payload: payload || {}, createdBy: req.user._id,
    });

    res.status(201).json({ success: true, message: 'Command scheduled', command: cmd });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Get all scheduled commands
// @route   GET /api/scheduled-commands
const getAllScheduled = async (req, res) => {
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
};

// @desc    Cancel scheduled command
// @route   DELETE /api/scheduled-commands/:id
const cancelSchedule = async (req, res) => {
  try {
    await ScheduledCommand.findByIdAndUpdate(req.params.id, { status: 'cancelled' });
    res.json({ success: true, message: 'Command cancelled' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createSchedule, getAllScheduled, cancelSchedule };
