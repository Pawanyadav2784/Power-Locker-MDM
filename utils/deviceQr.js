const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');

const MDM_PACKAGE_NAME = 'com.runningkey.mdm';
const MDM_ADMIN_COMPONENT = `${MDM_PACKAGE_NAME}/${MDM_PACKAGE_NAME}.receivers.AdminReceiver`;
const DEFAULT_APK_URL = 'https://power-locker-mdm.onrender.com/uploads/apk/PowerLocker-v39.0.apk';

let apkChecksumCache = { url: null, checksum: null };

function getPublicOrigin(req) {
  const configuredBase = (process.env.PUBLIC_BASE_URL || process.env.BASE_URL || '').trim();
  if (configuredBase) {
    return configuredBase.replace(/\/api\/?$/i, '').replace(/\/$/, '');
  }

  const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = (req.get('x-forwarded-host') || '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol || 'https';
  const host = forwardedHost || req.get('host');
  return `${proto}://${host}`;
}

function toBase64Url(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function resolveApkSignatureChecksum() {
  return (process.env.APK_SIGNATURE_CHECKSUM
    || 'zlqoVvQ2rvBvhZrq0YVCYqb8pvSatXsviWxNz-Cei2w').trim();
}

async function resolveApkProvisioningChecksum(apkUrl) {
  const configured = process.env.APK_PROVISIONING_CHECKSUM
    || process.env.APK_SHA256_CHECKSUM
    || '';
  if (configured.trim()) return configured.trim();
  if (apkChecksumCache.url === apkUrl && apkChecksumCache.checksum) {
    return apkChecksumCache.checksum;
  }

  try {
    if (apkUrl.includes('/uploads/')) {
      const relativePath = apkUrl.split('/uploads/').pop();
      const localPath = path.join(__dirname, '../uploads', relativePath);
      if (fs.existsSync(localPath)) {
        const checksum = toBase64Url(
          crypto.createHash('sha256').update(fs.readFileSync(localPath)).digest()
        );
        apkChecksumCache = { url: apkUrl, checksum };
        return checksum;
      }
    }
  } catch (err) {
    console.warn('Local APK checksum calculation failed:', err.message);
  }

  if (typeof fetch !== 'function') return '';
  try {
    const response = await fetch(apkUrl);
    if (!response.ok) throw new Error(`APK download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const checksum = toBase64Url(crypto.createHash('sha256').update(bytes).digest());
    apkChecksumCache = { url: apkUrl, checksum };
    return checksum;
  } catch (err) {
    console.warn('APK provisioning checksum error:', err.message);
    return '';
  }
}

function buildProvisioningPayload({ deviceId, baseUrl, apkUrl, apkChecksum }) {
  const payload = {
    'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME': MDM_ADMIN_COMPONENT,
    'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION': apkUrl,
    'android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM': resolveApkSignatureChecksum(),
    'android.app.extra.PROVISIONING_SKIP_ENCRYPTION': true,
    'android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED': true,
    'android.app.extra.PROVISIONING_LOCALE': 'en_IN',
    'android.app.extra.PROVISIONING_TIME_ZONE': 'Asia/Kolkata',
    'android.app.extra.PROVISIONING_DOWNLOAD_TIMEOUT': 3600000,
    'android.app.extra.PROVISIONING_SKIP_EDUCATION_SCREENS': true,
    'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE': {
      deviceId,
      server: baseUrl,
      type: 'new_key',
    },
  };

  const includePackageChecksum = String(
    process.env.PROVISIONING_INCLUDE_PACKAGE_CHECKSUM || 'false'
  ).toLowerCase() === 'true';
  if (includePackageChecksum && apkChecksum) {
    payload['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM'] = apkChecksum;
  }

  return JSON.stringify(payload);
}

async function generateDeviceQr(req, device) {
  const baseUrl = getPublicOrigin(req);
  const apkUrl = process.env.APK_DOWNLOAD_URL || DEFAULT_APK_URL;
  const downloadUrl = `${baseUrl}/download?deviceId=${device.deviceId}&type=${device.keyType}`;
  let qrPayload = downloadUrl;

  if (device.keyType === 'new_key') {
    const includePackageChecksum = String(
      process.env.PROVISIONING_INCLUDE_PACKAGE_CHECKSUM || 'false'
    ).toLowerCase() === 'true';
    const apkChecksum = includePackageChecksum
      ? await resolveApkProvisioningChecksum(apkUrl)
      : '';

    if (includePackageChecksum && !apkChecksum) {
      throw new Error('APK_PROVISIONING_CHECKSUM missing hai.');
    }

    qrPayload = buildProvisioningPayload({
      deviceId: device.deviceId,
      baseUrl,
      apkUrl,
      apkChecksum,
    });
  }

  const qrPng = await QRCode.toBuffer(qrPayload, {
    type: 'png',
    errorCorrectionLevel: device.keyType === 'new_key' ? 'L' : 'M',
    width: 400,
  });
  const qrImage = `data:image/png;base64,${qrPng.toString('base64')}`;

  return { qrImage, qrPng, downloadUrl, apkUrl, qrPayload };
}

function createQrImageUrl(req, device) {
  const token = jwt.sign(
    {
      scope: 'device_qr_image',
      deviceId: String(device._id),
    },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
  return `${getPublicOrigin(req)}/api/v1/device/${device._id}/qr.png?token=${encodeURIComponent(token)}`;
}

function verifyQrImageToken(token, deviceId) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  return decoded.scope === 'device_qr_image' && String(decoded.deviceId) === String(deviceId);
}

module.exports = {
  DEFAULT_APK_URL,
  buildProvisioningPayload,
  createQrImageUrl,
  generateDeviceQr,
  getPublicOrigin,
  verifyQrImageToken,
};
