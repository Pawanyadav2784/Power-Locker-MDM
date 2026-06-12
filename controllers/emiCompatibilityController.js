const mongoose = require('mongoose');
const Command = require('../models/Command');
const Customer = require('../models/Customer');
const { getManagedUserIds } = require('../utils/deviceAccess');
const { sendFCM } = require('../utils/fcmHelper');
const {
  ensureEmiSchedule,
  idOf,
  iso,
  projectEmiSchedule,
} = require('../utils/emiSchedule');

const ACTIVE_EMI_STATUSES = ['pending', 'active', 'locked', 'defaulted'];
const PAYMENT_MODES = {
  CASH: 'cash',
  ONLINE: 'online',
  UPI: 'upi',
  BANK: 'bank',
  OTHER: 'other',
};

function customerScope(user, managedIds) {
  if (managedIds === null) return {};
  return { retailerId: { $in: managedIds.length ? managedIds : [user._id] } };
}

function parseVirtualEmiId(value) {
  const match = String(value || '').trim().match(/^([a-f\d]{24}):(\d+)$/i);
  if (!match) return null;
  return {
    customerId: match[1],
    installmentNo: Number(match[2]),
  };
}

function normalizePaymentMode(value) {
  return PAYMENT_MODES[String(value || 'CASH').trim().toUpperCase()] || null;
}

async function findAccessibleInstallment(user, emiId) {
  const managedIds = await getManagedUserIds(user);
  const scope = customerScope(user, managedIds);
  const virtual = parseVirtualEmiId(emiId);
  let identifier;

  if (virtual) {
    identifier = { _id: virtual.customerId };
  } else if (mongoose.isValidObjectId(emiId)) {
    identifier = { 'emiSchedule._id': emiId };
  } else {
    return null;
  }

  const query = Object.keys(scope).length
    ? { $and: [scope, identifier] }
    : identifier;
  const customer = await Customer.findOne(query).populate('deviceId');
  if (!customer) return null;

  ensureEmiSchedule(customer);
  const installment = virtual
    ? customer.emiSchedule.find(
      (item) => Number(item.installmentNo) === virtual.installmentNo
    )
    : customer.emiSchedule.id(emiId);

  if (!installment || Number(installment.installmentNo) > Number(customer.emiMonths)) {
    return null;
  }

  return { customer, installment };
}

async function queueUnlock(device, userId) {
  const existing = await Command.findOne({
    deviceId: device._id,
    commandType: 'UNLOCK_DEVICE',
    status: { $in: ['pending', 'sent', 'delivered'] },
  }).sort({ createdAt: -1 });
  if (existing) return existing;

  const hasFcm = Boolean(device.fcmToken);
  const command = await Command.create({
    deviceId: device._id,
    commandType: 'UNLOCK_DEVICE',
    payload: { reason: 'emi_paid' },
    label: 'EMI Paid - Auto Unlock',
    priority: 1,
    deliveryMethod: hasFcm ? 'fcm' : 'poll',
    status: hasFcm ? 'sent' : 'pending',
    sentAt: hasFcm ? new Date() : undefined,
    createdBy: userId,
  });

  if (hasFcm) {
    const result = await sendFCM(
      device.fcmToken,
      'UNLOCK_DEVICE',
      'EMI Paid - Auto Unlock',
      {
        command: 'UNLOCK_DEVICE',
        commandType: 'UNLOCK_DEVICE',
        commandId: idOf(command),
        deviceId: device.deviceId || '',
        reason: 'emi_paid',
      }
    );
    if (!result.success) {
      command.deliveryMethod = 'poll';
      command.status = 'pending';
      command.errorMessage = result.error || 'FCM delivery failed';
      await command.save();
    }
  }

  return command;
}

function installmentResponse(installment, requestedId) {
  return {
    emiId: requestedId || idOf(installment),
    installmentNo: Number(installment.installmentNo) || 0,
    status: String(installment.status || 'pending').toUpperCase(),
    paymentMode: String(installment.paymentMode || '').toUpperCase(),
    paidAt: iso(installment.paidAt),
    dueDate: iso(installment.dueDate),
    amount: Number(installment.amount) || 0,
    overdueAmount: Number(installment.overdueAmount) || 0,
  };
}

const getUpcomingEmisPLocker = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
    const managedIds = await getManagedUserIds(req.user);
    const scope = customerScope(req.user, managedIds);
    const query = {
      ...scope,
      paymentType: { $ne: 'without_emi' },
      emiMonths: { $gt: 0 },
      status: { $in: ACTIVE_EMI_STATUSES },
    };

    const customers = await Customer.find(query)
      .populate('deviceId', 'deviceId status')
      .select(
        'name phone qrCode retailerId deviceId paymentType emiType emiMonths '
        + 'monthlyEmi emiPaid emiStartDate loanStartDate nextEmiDate overdueAmount '
        + 'emiSchedule status createdAt updatedAt'
      );

    const upcoming = customers
      .map((customer) => {
        const schedule = projectEmiSchedule(customer);
        const installment = schedule.list.find((item) => item.status !== 'PAID');
        if (!installment) return null;

        const device = customer.deviceId && typeof customer.deviceId === 'object'
          ? customer.deviceId
          : null;
        return {
          emiId: installment._id,
          customerId: idOf(customer),
          keyId: device?.deviceId || customer.qrCode || idOf(customer),
          customerName: customer.name || '',
          phone: customer.phone || '',
          dueDate: installment.dueDate,
          amount: Number(installment.amount) || 0,
          overdueAmount: Number(installment.overdueAmount) || 0,
          status: installment.status,
          installmentNo: installment.installmentNo,
          totalEmi: schedule.progress.totalEmi,
          paidEmi: schedule.progress.paidEmi,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    const total = upcoming.length;
    const data = upcoming.slice((page - 1) * limit, page * limit);
    return res.json({
      success: true,
      status: 200,
      meta: { total, page, limit },
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || 'Upcoming EMI load nahi ho payi.',
    });
  }
};

const updateEmiPLocker = async (req, res) => {
  try {
    const requestedStatus = String(req.body.status || '').trim().toUpperCase();
    if (!['PAID', 'PENDING'].includes(requestedStatus)) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'status PAID ya PENDING hona chahiye.',
      });
    }

    const paymentMode = normalizePaymentMode(req.body.paymentMode);
    if (!paymentMode) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'paymentMode CASH, ONLINE, UPI, BANK ya OTHER hona chahiye.',
      });
    }

    let paidAt = null;
    if (requestedStatus === 'PAID') {
      paidAt = new Date(req.body.paidAt || Date.now());
      if (Number.isNaN(paidAt.getTime())) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'paidAt valid date honi chahiye.',
        });
      }
    }

    const overdueAmount = Number(req.body.overdueAmount || 0);
    if (!Number.isFinite(overdueAmount) || overdueAmount < 0) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'overdueAmount valid non-negative number hona chahiye.',
      });
    }

    const result = await findAccessibleInstallment(req.user, req.params.emiId);
    if (!result) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'EMI not found ya access denied.',
      });
    }

    const { customer, installment } = result;
    if (['removed', 'closed'].includes(customer.status)) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: 'Removed ya closed customer ki EMI update nahi ho sakti.',
      });
    }

    const wasPaid = installment.status === 'paid';
    const willBePaid = requestedStatus === 'PAID';
    const oldOverdue = Number(installment.overdueAmount) || 0;
    const baseAmount = Number(installment.amount) || 0;
    const oldContribution = wasPaid ? baseAmount + oldOverdue : 0;
    const newContribution = willBePaid ? baseAmount + overdueAmount : 0;
    const contributionDelta = newContribution - oldContribution;

    installment.status = willBePaid ? 'paid' : 'pending';
    installment.paymentMode = paymentMode;
    installment.paidAt = willBePaid ? paidAt : null;
    installment.overdueAmount = willBePaid ? overdueAmount : 0;
    installment.referenceNo = String(req.body.referenceNo || '').trim();
    installment.note = String(req.body.note || '').trim();
    installment.updatedBy = req.user._id;

    const transitionChanged = wasPaid !== willBePaid;
    const contributionChanged = contributionDelta !== 0;
    if (transitionChanged || contributionChanged) {
      customer.emiHistory.push({
        amount: contributionDelta,
        paidAt: paidAt || new Date(),
        method: paymentMode,
        referenceNo: installment.referenceNo,
        note: installment.note || (
          willBePaid
            ? `EMI installment ${installment.installmentNo} paid`
            : `EMI installment ${installment.installmentNo} reopened`
        ),
        emiId: req.params.emiId,
        installmentNo: installment.installmentNo,
        action: willBePaid ? 'paid' : 'reopened',
        overdueAmount: willBePaid ? overdueAmount : -oldOverdue,
        recordedBy: req.user._id,
      });
      customer.totalPaid = Math.max(
        0,
        (Number(customer.totalPaid) || 0) + contributionDelta
      );
    }

    const schedule = projectEmiSchedule(customer);
    const unpaid = schedule.list.filter((item) => item.status !== 'PAID');
    const now = new Date();
    const overdueUnpaid = unpaid.filter((item) => new Date(item.dueDate) < now);
    customer.emiPaid = schedule.progress.paidEmi;
    customer.emiRemaining = Math.max(0, schedule.progress.totalEmi - schedule.progress.paidEmi);
    customer.nextEmiDate = unpaid.length ? new Date(unpaid[0].dueDate) : null;
    customer.lastEmiDate = willBePaid ? paidAt : customer.lastEmiDate;
    customer.overdueCount = overdueUnpaid.length;
    customer.overdueAmount = overdueUnpaid.reduce(
      (sum, item) => sum + (Number(item.overdueAmount) || 0),
      0
    );

    let unlockCommand = null;
    if (customer.emiRemaining === 0 && customer.emiMonths > 0) {
      customer.status = 'completed';
    } else if (customer.status === 'defaulted') {
      customer.status = overdueUnpaid.length ? 'defaulted' : 'active';
    }

    const device = customer.deviceId && typeof customer.deviceId === 'object'
      ? customer.deviceId
      : null;
    if (
      device
      && customer.isDeviceLocked
      && customer.lockReason === 'emi_overdue'
      && overdueUnpaid.length === 0
      && !['removed', 'released', 'unenrolled'].includes(device.status)
    ) {
      device.isLocked = false;
      device.status = 'active';
      device.lockMessage = '';
      device.lockPhone = '';
      await device.save();

      customer.isDeviceLocked = false;
      customer.lockReason = '';
      customer.lastUnlockedAt = new Date();
      if (customer.status === 'locked') {
        customer.status = customer.emiRemaining === 0 ? 'completed' : 'active';
      }
      unlockCommand = await queueUnlock(device, req.user._id);
    }

    await customer.save();
    return res.json({
      success: true,
      status: 200,
      message: transitionChanged
        ? `EMI ${requestedStatus.toLowerCase()} mark ho gayi.`
        : 'EMI pehle se isi status me thi; details sync ho gayi.',
      already_same_status: !transitionChanged,
      data: installmentResponse(installment, req.params.emiId),
      progress: {
        totalEmi: Number(customer.emiMonths) || 0,
        paidEmi: Number(customer.emiPaid) || 0,
        remainingEmi: Number(customer.emiRemaining) || 0,
        totalPaid: Number(customer.totalPaid) || 0,
      },
      unlockCommand: unlockCommand ? {
        _id: idOf(unlockCommand),
        status: unlockCommand.status,
        deliveryMethod: unlockCommand.deliveryMethod,
      } : null,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      status: 500,
      message: err.message || 'EMI update nahi ho payi.',
    });
  }
};

module.exports = {
  findAccessibleInstallment,
  getUpcomingEmisPLocker,
  normalizePaymentMode,
  parseVirtualEmiId,
  updateEmiPLocker,
};
