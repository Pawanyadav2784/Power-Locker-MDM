function idOf(value) {
  if (!value) return '';
  return String(value._id || value.id || value);
}

function iso(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function addCycle(start, type, count) {
  const date = new Date(start);
  if (type === 'daily') date.setDate(date.getDate() + count);
  else if (type === 'weekly') date.setDate(date.getDate() + (7 * count));
  else date.setMonth(date.getMonth() + count);
  return date;
}

function scheduleStart(customer) {
  return customer.emiStartDate
    || customer.loanStartDate
    || customer.createdAt
    || new Date();
}

function projectEmiSchedule(customer, now = new Date()) {
  if (customer.paymentType === 'without_emi') {
    return { list: [], progress: { totalEmi: 0, paidEmi: 0, percentage: 0 } };
  }

  const total = Math.max(0, Number(customer.emiMonths) || 0);
  const legacyPaid = Math.min(total, Math.max(0, Number(customer.emiPaid) || 0));
  const persisted = new Map(
    (customer.emiSchedule || []).map((item) => [Number(item.installmentNo), item])
  );
  const start = scheduleStart(customer);
  const list = [];

  for (let index = 0; index < total; index += 1) {
    const installmentNo = index + 1;
    const stored = persisted.get(installmentNo);
    const dueDate = stored?.dueDate
      ? new Date(stored.dueDate)
      : addCycle(start, customer.emiType || 'monthly', index);
    const paid = stored ? stored.status === 'paid' : index < legacyPaid;
    const overdue = !paid && dueDate < now;
    const overdueAmount = Number(stored?.overdueAmount)
      || (overdue && index === legacyPaid ? Number(customer.overdueAmount) || 0 : 0);

    list.push({
      _id: stored?._id ? idOf(stored) : `${idOf(customer)}:${installmentNo}`,
      installmentNo,
      dueDate: iso(dueDate),
      amount: Number(stored?.amount ?? customer.monthlyEmi) || 0,
      overdueAmount,
      status: paid ? 'PAID' : overdue ? 'OVERDUE' : 'PENDING',
      paymentMode: String(stored?.paymentMode || '').toUpperCase(),
      paidAt: iso(stored?.paidAt),
      loanId: idOf(customer),
      createdAt: iso(stored?.createdAt || customer.createdAt),
      updatedAt: iso(stored?.updatedAt || customer.updatedAt),
      __v: 0,
    });
  }

  const paidEmi = list.filter((item) => item.status === 'PAID').length;
  return {
    list,
    progress: {
      totalEmi: total,
      paidEmi,
      percentage: total ? Number(((paidEmi / total) * 100).toFixed(2)) : 0,
    },
  };
}

function ensureEmiSchedule(customer) {
  const total = Math.max(0, Number(customer.emiMonths) || 0);
  const legacyPaid = Math.min(total, Math.max(0, Number(customer.emiPaid) || 0));
  const existing = new Map(
    (customer.emiSchedule || []).map((item) => [Number(item.installmentNo), item])
  );
  const start = scheduleStart(customer);

  for (let index = 0; index < total; index += 1) {
    const installmentNo = index + 1;
    let installment = existing.get(installmentNo);
    if (!installment) {
      customer.emiSchedule.push({
        installmentNo,
        dueDate: addCycle(start, customer.emiType || 'monthly', index),
        amount: Number(customer.monthlyEmi) || 0,
        overdueAmount: index === legacyPaid ? Number(customer.overdueAmount) || 0 : 0,
        status: index < legacyPaid ? 'paid' : 'pending',
        paidAt: index < legacyPaid ? customer.lastEmiDate || customer.updatedAt || new Date() : null,
      });
      installment = customer.emiSchedule[customer.emiSchedule.length - 1];
      existing.set(installmentNo, installment);
    } else if (installment.status !== 'paid') {
      installment.dueDate = addCycle(start, customer.emiType || 'monthly', index);
      installment.amount = Number(customer.monthlyEmi) || 0;
    }
  }

  return customer.emiSchedule;
}

module.exports = {
  addCycle,
  ensureEmiSchedule,
  idOf,
  iso,
  projectEmiSchedule,
};
