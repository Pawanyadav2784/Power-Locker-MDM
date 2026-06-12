const { getPublicOrigin } = require('./deviceQr');

const DEVICE_TYPE_BY_KEY = {
  new_key: 'new',
  android: 'new',
  running_key: 'running',
  iphone_key: 'iPhone',
  iphone: 'iPhone',
};

const KEY_CODE_BY_TYPE = {
  new_key: '1',
  android: '1',
  running_key: '2',
  iphone_key: '3',
  iphone: '3',
};

const CUSTOMER_STATUS_MAP = {
  active: 'active',
  locked: 'lock',
  pending: 'pending',
  removed: 'removed',
  completed: 'active',
  defaulted: 'lock',
  closed: 'removed',
};

function absoluteUrl(req, value) {
  if (!value) return '';
  if (/^(https?:|data:)/i.test(value)) return value;
  return `${getPublicOrigin(req)}${value.startsWith('/') ? '' : '/'}${value}`;
}

function idOf(value) {
  if (!value) return '';
  return String(value._id || value.id || value);
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapCustomerStatus(customer, device) {
  if (device?.status === 'released' || device?.status === 'removed') return 'removed';
  if (device?.isLocked || device?.status === 'locked') return 'lock';
  return CUSTOMER_STATUS_MAP[customer.status] || 'pending';
}

function serializeDevice(device) {
  if (!device) return null;
  return {
    _id: idOf(device),
    device_id: device.deviceId || '',
    deviceId: device.deviceId || '',
    enrollment_token: device.deviceId || '',
    fcm_token: device.fcmToken || '',
    fcm_token_updated_at: iso(device.updatedAt),
    fcm_platform: 'android',
    imei1: device.imei || '',
    imei2: device.imei2 || '',
    serial_number: device.serialNumber || '',
    mac_address: device.macAddress || '',
    android_version: device.androidVersion || '',
    sdk_version: Number(device.sdkVersion) || 0,
    manufacturer: device.manufacturer || '',
    model: device.model || '',
    device_name: device.deviceName || '',
    status: device.status || 'pending',
    compliance_state: device.isLocked ? 'non_compliant' : 'compliant',
    setup_status: device.isEnrolled ? 'completed' : 'pending',
    setup_progress: device.isEnrolled ? 100 : 0,
    current_setup_step: device.isEnrolled ? 'enrolled' : 'waiting_for_enrollment',
    download_percentage: device.isEnrolled ? 100 : 0,
    install_percentage: device.isEnrolled ? 100 : 0,
    setup_error: '',
    network_type: '',
    is_wifi_connected: false,
    is_mobile_hotspot: false,
    network_speed_category: '',
    adaptive_timeout: 0,
    network_switch_count: 0,
    battery_level: Number(device.batteryLevel) || 0,
    play_protect_status: '',
    play_protect_disabled: false,
    installation_method: device.keyType === 'new_key' ? 'qr_provisioning' : 'manual',
    applied_policies: device.appPolicy || [],
    last_check_in: iso(device.lastSeen),
    last_heartbeat: iso(device.lastSeen),
    enrolled_at: iso(device.enrolledAt),
    error_count: 0,
    retry_count: 0,
    max_retries: 10,
    factory_reset_locked: Boolean(device.isDeviceOwner && device.mdmActive),
    launcher_mode: Boolean(device.kioskMode),
    company_name: '',
    tags: [],
    installed_apps: [],
    createdAt: iso(device.createdAt),
    updatedAt: iso(device.updatedAt),
  };
}

function serializeEmi(customer) {
  const now = new Date();
  const nextDue = customer.nextEmiDate ? new Date(customer.nextEmiDate) : null;
  const isOverdue = Boolean(
    nextDue
    && !Number.isNaN(nextDue.getTime())
    && nextDue < now
    && !['completed', 'closed', 'removed'].includes(customer.status)
  );
  const overdueDays = isOverdue
    ? Math.max(0, Math.floor((now.getTime() - nextDue.getTime()) / 86400000))
    : 0;

  let status = customer.paymentType === 'without_emi' ? 'not_applicable' : 'active';
  if (customer.status === 'completed' || customer.emiRemaining === 0 && customer.emiMonths > 0) {
    status = 'completed';
  } else if (isOverdue) {
    status = 'overdue';
  } else if (customer.status === 'defaulted') {
    status = 'defaulted';
  }

  return {
    total_amount: Number(customer.productPrice) || 0,
    down_payment: Number(customer.downPayment) || 0,
    loan_amount: Number(customer.balancePayment || customer.totalAmount) || 0,
    interest_rate: Number(customer.interestRate) || 0,
    emi_amount: Number(customer.monthlyEmi) || 0,
    tenure_months: Number(customer.emiMonths) || 0,
    total_emi_paid: Number(customer.emiPaid) || 0,
    total_emi_remaining: Number(customer.emiRemaining) || 0,
    start_date: iso(customer.emiStartDate || customer.loanStartDate),
    end_date: null,
    next_due_date: iso(customer.nextEmiDate),
    bank_id: '',
    loan_provider: customer.loanProvider || '',
    loan_account_number: '',
    payment_history: (customer.emiHistory || []).map((payment) => ({
      _id: idOf(payment),
      amount: Number(payment.amount) || 0,
      paid_at: iso(payment.paidAt),
      payment_mode: payment.method || '',
      reference_no: payment.referenceNo || '',
      note: payment.note || '',
    })),
    status,
    is_overdue: isOverdue,
    overdue_days: overdueDays,
    overdue_amount: Number(customer.overdueAmount) || 0,
  };
}

function serializeCustomer(req, customer) {
  const device = customer.deviceId && typeof customer.deviceId === 'object'
    ? customer.deviceId
    : null;
  const status = mapCustomerStatus(customer, device);
  const retailerId = idOf(customer.retailerId);
  const isEnrollment = Boolean(device?.isEnrolled);

  return {
    _id: idOf(customer),
    userId: idOf(device),
    qrCode: customer.qrCode || device?.deviceId || '',
    deviceId: device?.deviceId || customer.qrCode || '',
    profileImage: absoluteUrl(req, customer.profileImage || customer.photo),
    name: customer.name || '',
    email: customer.email || '',
    phone: customer.phone || '',
    dob: null,
    aadhaarNumber: customer.aadhar || '',
    aadhaarFront: absoluteUrl(req, customer.aadhaarFront || customer.aadharPhoto),
    aadhaarBack: absoluteUrl(req, customer.aadhaarBack),
    signature: absoluteUrl(req, customer.signature || customer.customerSignature),
    imei1: customer.imei1 || device?.imei || '',
    imei2: customer.imei2 || device?.imei2 || '',
    deviceType: DEVICE_TYPE_BY_KEY[customer.keyType] || 'running',
    loanBy: customer.loanProvider || '',
    key_type: KEY_CODE_BY_TYPE[customer.keyType] || '2',
    retailer_id: retailerId,
    brand_id: '',
    bank_id: '',
    author: idOf(customer.createdBy),
    is_link: Boolean(device),
    isActive: status === 'active',
    kycStatus: 'pending',
    kycRejectionReason: null,
    kycVerifiedAt: null,
    emi: serializeEmi(customer),
    deleted_at: status === 'removed' ? iso(customer.updatedAt) : null,
    deletedAt: status === 'removed' ? iso(customer.updatedAt) : null,
    createdAt: iso(customer.createdAt) || '',
    updatedAt: iso(customer.updatedAt) || '',
    status,
    isEnrollment,
    device: serializeDevice(device),
    keyActions: {
      remove: status === 'removed',
    },
  };
}

function statusBucket(rows = []) {
  const result = { total: 0, active: 0, lock: 0, remove: 0, pending: 0 };
  for (const row of rows) {
    const status = row._id;
    const count = Number(row.count) || 0;
    result.total += count;
    if (['active', 'completed'].includes(status)) result.active += count;
    else if (['locked', 'defaulted'].includes(status)) result.lock += count;
    else if (['removed', 'released', 'closed'].includes(status)) result.remove += count;
    else if (status === 'pending') result.pending += count;
  }
  return result;
}

module.exports = {
  absoluteUrl,
  serializeCustomer,
  serializeDevice,
  statusBucket,
};
