const Command = require('../models/Command');
const Customer = require('../models/Customer');
const Device = require('../models/Device');
const ScheduledCommand = require('../models/ScheduledCommand');
const { sendFCM } = require('./fcmHelper');

async function syncScheduledState(device, commandType, now) {
  const deviceUpdate = { lastCommandAt: now };
  const customerUpdate = {};

  if (commandType === 'LOCK_DEVICE') {
    Object.assign(deviceUpdate, { isLocked: true, status: 'locked' });
    Object.assign(customerUpdate, {
      status: 'locked',
      isDeviceLocked: true,
      lockReason: 'scheduled',
      lastLockedAt: now,
    });
  } else if (commandType === 'UNLOCK_DEVICE') {
    Object.assign(deviceUpdate, { isLocked: false, status: 'active' });
    Object.assign(customerUpdate, {
      status: 'active',
      isDeviceLocked: false,
      lockReason: '',
      lastUnlockedAt: now,
    });
  }

  await Device.findByIdAndUpdate(device._id, deviceUpdate);
  if (device.customerId && Object.keys(customerUpdate).length) {
    await Customer.findByIdAndUpdate(device.customerId, customerUpdate);
  }
}

async function executeDueScheduledCommands(now = new Date()) {
  const due = await ScheduledCommand.find({
    status: 'pending',
    scheduledAt: { $lte: now },
  }).populate('deviceId');
  const results = [];

  for (const scheduled of due) {
    try {
      const device = scheduled.deviceId;
      if (!device) {
        scheduled.status = 'failed';
        await scheduled.save();
        results.push({ scheduleId: String(scheduled._id), status: 'failed' });
        continue;
      }

      const scheduleId = String(scheduled._id);
      const payload = {
        ...(scheduled.payload || {}),
        scheduleId,
        scheduledAt: scheduled.scheduledAt.toISOString(),
      };
      let command = await Command.findOne({
        deviceId: device._id,
        commandType: scheduled.commandType,
        'payload.scheduleId': scheduleId,
      });

      if (!command) {
        const hasFcm = Boolean(device.fcmToken);
        command = await Command.create({
          deviceId: device._id,
          commandType: scheduled.commandType,
          payload,
          label: scheduled.label || `Scheduled ${scheduled.commandType}`,
          deliveryMethod: hasFcm ? 'fcm' : 'poll',
          status: hasFcm ? 'sent' : 'pending',
          sentAt: hasFcm ? now : undefined,
          createdBy: scheduled.createdBy,
        });

        if (hasFcm) {
          const fcm = await sendFCM(
            device.fcmToken,
            scheduled.commandType,
            scheduled.label || scheduled.commandType,
            {
              command: scheduled.commandType,
              commandType: scheduled.commandType,
              commandId: String(command._id),
              deviceId: device.deviceId,
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
      }

      await syncScheduledState(device, scheduled.commandType, now);
      scheduled.status = 'executed';
      scheduled.executedAt = now;
      await scheduled.save();
      results.push({
        scheduleId,
        commandId: String(command._id),
        status: 'executed',
      });
    } catch (error) {
      scheduled.status = 'failed';
      await scheduled.save().catch(() => {});
      results.push({
        scheduleId: String(scheduled._id),
        status: 'failed',
        error: error.message,
      });
    }
  }

  return results;
}

module.exports = {
  executeDueScheduledCommands,
  syncScheduledState,
};
