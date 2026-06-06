// const express = require('express');
// const router = express.Router();
// const QRCode = require('qrcode');
// const multer = require('multer');
// const path = require('path');
// const fs = require('fs');
// const Device = require('../models/Device');
// const Customer = require('../models/Customer');
// const WalletTransaction = require('../models/WalletTransaction');
// const { protect } = require('../middleware/auth');

// const MDM_PACKAGE_NAME = 'com.runningkey.mdm';
// const MDM_ADMIN_COMPONENT = `${MDM_PACKAGE_NAME}/${MDM_PACKAGE_NAME}.receivers.AdminReceiver`;
// const DEFAULT_APK_URL = 'https://raw.githubusercontent.com/Pawanyadav2784/mdmlocker/main/PowerLocker-v34.0.apk';
// let apkChecksumCache = { url: null, checksum: null };

// function getPublicOrigin(req) {
//   const configuredBase = (process.env.PUBLIC_BASE_URL || process.env.BASE_URL || '').trim();
//   if (configuredBase) {
//     return configuredBase.replace(/\/api\/?$/i, '').replace(/\/$/, '');
//   }

//   const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
//   const forwardedHost = (req.get('x-forwarded-host') || '').split(',')[0].trim();
//   const proto = forwardedProto || req.protocol || 'https';
//   const host = forwardedHost || req.get('host');
//   return `${proto}://${host}`;
// }

// function toBase64Url(buffer) {
//   return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
// }

// function resolveApkSignatureChecksum() {
//   return (process.env.APK_SIGNATURE_CHECKSUM || 'zlqoVvQ2rvBvhZrq0YVCYqb8pvSatXsviWxNz-Cei2w').trim();
// }

// async function resolveApkProvisioningChecksum(apkUrl) {
//   const configuredChecksum = process.env.APK_PROVISIONING_CHECKSUM || process.env.APK_SIGNATURE_CHECKSUM || process.env.APK_SHA256_CHECKSUM || '';
//   if (configuredChecksum.trim()) return configuredChecksum.trim();
//   if (apkChecksumCache.url === apkUrl && apkChecksumCache.checksum) return apkChecksumCache.checksum;
//   if (typeof fetch !== 'function') return '';

//   try {
//     const response = await fetch(apkUrl);
//     if (!response.ok) throw new Error(`APK download failed: ${response.status}`);
//     const bytes = Buffer.from(await response.arrayBuffer());
//     const checksum = toBase64Url(require('crypto').createHash('sha256').update(bytes).digest());
//     apkChecksumCache = { url: apkUrl, checksum };
//     return checksum;
//   } catch (err) {
//     console.warn('APK provisioning checksum error:', err.message);
//     return '';
//   }
// }

// function buildProvisioningPayload({ deviceId, baseUrl, apkUrl, apkChecksum }) {
//   const signatureChecksum = resolveApkSignatureChecksum();
//   // Include package checksum by default for maximum compatibility with devices (e.g. Xiaomi/Redmi)
//   const includePackageChecksum = String(process.env.PROVISIONING_INCLUDE_PACKAGE_CHECKSUM || 'true')
//     .toLowerCase() === 'true';
//   const payload = {
//     'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME': MDM_ADMIN_COMPONENT,
//     'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_NAME': MDM_PACKAGE_NAME,
//     'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION': apkUrl,
//     'android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM': signatureChecksum,
//     'android.app.extra.PROVISIONING_SKIP_ENCRYPTION': true,
//     'android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED': true,
//     'android.app.extra.PROVISIONING_LOCALE': 'en_IN',
//     'android.app.extra.PROVISIONING_TIME_ZONE': 'Asia/Kolkata',
//     'android.app.extra.PROVISIONING_DOWNLOAD_TIMEOUT': 3600000,
//     'android.app.extra.PROVISIONING_SKIP_EDUCATION_SCREENS': true,
//     'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE': {
//       deviceId,
//       server: baseUrl,
//       type: 'new_key',
//       auto_enroll: 'true',
//       max_retries: '10',
//       bg_download: 'true',
//     },
//   };

//   if (includePackageChecksum && apkChecksum) {
//     payload['android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM'] = apkChecksum;
//   }

//   return JSON.stringify(payload);
// }

// async function getStrictNewKeyProvisioning(apkUrl) {
//   if (!/^https:\/\//i.test(apkUrl || '')) {
//     throw new Error('New key provisioning ke liye APK_DOWNLOAD_URL HTTPS hona chahiye.');
//   }

//   // Do not return early. We always need the package checksum for device provisioning when downloading from custom URL.
//   const apkChecksum = await resolveApkProvisioningChecksum(apkUrl);
//   if (!apkChecksum) {
//     throw new Error('New key provisioning checksum missing hai. APK_PROVISIONING_CHECKSUM set karo ya APK URL reachable rakho.');
//   }

//   return apkChecksum;
// }

// // ── Multer config for customer images & signatures ──────────
// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     const dir = path.join(__dirname, '../uploads/customers');
//     if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
//     cb(null, dir);
//   },
//   filename: (req, file, cb) => {
//     const ext = path.extname(file.originalname) || '.jpg';
//     cb(null, `${Date.now()}-${file.fieldname}${ext}`);
//   },
// });
// const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// const uploadFields = upload.fields([
//   { name: 'customerImage', maxCount: 1 },
//   { name: 'customerSignature', maxCount: 1 },
// ]);

// // ── Key type → balance field map ─────────────────────────────
// const BALANCE_FIELD = {
//   new_key:     'runningKeyBalance',
//   running_key: 'runningKeyBalance',
//   iphone_key:  'runningKeyBalance',
//   android:     'runningKeyBalance',
//   iphone:      'runningKeyBalance',
// };

// // POST /api/qr/generate — Customer enroll + QR generate
// router.post('/generate', protect, uploadFields, async (req, res) => {
//   try {
//     const {
//       // Key type
//       keyType = 'running_key',
//       // Customer personal
//       name, phone, fatherName, address, city, state, aadhar, pan,
//       // Device
//       imei1, imei2, mobileNo,
//       // Loan
//       loanProvider,
//       // Payment
//       paymentType = 'with_emi',
//       emiMonths, emiStartDate, monthlyEmi, totalAmount, downPayment,
//       // Product
//       productName, productPrice,
//     } = req.body;

//     if (!name || !phone) {
//       return res.status(400).json({ success: false, message: 'Customer name aur phone required hai' });
//     }

//     // ── Balance check ────────────────────────────────────────
//     const User = require('../models/User');
//     const isAdmin = req.user.role === 'super_admin' || req.user.role === 'admin';
//     // Admin ki taraf se retailer ka ID body mein aa sakta hai (Enroll Customer popup)
//     const targetRetailerId = (isAdmin && req.body.retailerId) ? req.body.retailerId : req.user._id;
//     const retailer = await User.findById(targetRetailerId);
//     if (!retailer) return res.status(404).json({ success: false, message: 'Retailer not found' });

//     const balanceField = BALANCE_FIELD[keyType] || 'runningKeyBalance';
//     if (!retailer[balanceField] || retailer[balanceField] < 1) {
//       return res.status(400).json({
//         success: false,
//         message: `Insufficient key balance! Aapke paas ${keyType.replace(/_/g, ' ')} ke liye keys nahi hain.`
//       });
//     }

//     // ✅ Public origin se URL banao, Render proxy ke peeche bhi HTTPS rahe.
//     const BASE_URL = getPublicOrigin(req);
//     // ✅ APK URL — env var se lo, fallback latest release
//     const APK_URL = process.env.APK_DOWNLOAD_URL || DEFAULT_APK_URL;
//     const newKeyApkChecksum = keyType === 'new_key'
//       ? await getStrictNewKeyProvisioning(APK_URL)
//       : '';
//     const files = req.files || {};
//     const photoUrl     = files.customerImage?.[0]
//       ? `/uploads/customers/${files.customerImage[0].filename}` : '';
//     const signatureUrl = files.customerSignature?.[0]
//       ? `/uploads/customers/${files.customerSignature[0].filename}` : '';

//     // ── Create Device ────────────────────────────────────────
//     const device = await Device.create({
//       keyType,
//       retailerId: targetRetailerId,
//       status: 'pending',
//       imei: imei1 || '',
//       imei2: imei2 || '',
//     });

//     // ── Create Customer ──────────────────────────────────────
//     const customer = await Customer.create({
//       name:             name.trim(),
//       phone:            phone.trim(),
//       fatherName:       fatherName || '',
//       address:          address || '',
//       city:             city || '',
//       state:            state || '',
//       aadhar:           aadhar || '',
//       pan:              pan || '',
//       keyType,
//       imei1:            imei1 || '',
//       imei2:            imei2 || '',
//       mobileNo:         mobileNo || phone,
//       loanProvider:     loanProvider || '',
//       paymentType:      paymentType,
//       emiMonths:        Number(emiMonths) || 0,
//       emiStartDate:     emiStartDate ? new Date(emiStartDate) : null,
//       nextEmiDate:      emiStartDate ? new Date(emiStartDate) : null,
//       monthlyEmi:       Number(monthlyEmi) || 0,
//       totalAmount:      Number(totalAmount) || 0,
//       downPayment:      Number(downPayment) || 0,
//       productName:      productName || '',
//       productPrice:     Number(productPrice) || 0,
//       photo:            photoUrl,
//       customerSignature: signatureUrl,
//       deviceId:         device._id,
//       retailerId:       targetRetailerId,
//       createdBy:        req.user._id,
//       status:           'pending',
//       qrCode:           device.deviceId,
//     });

//     // ── Link customer to device ──────────────────────────────
//     device.customerId = customer._id;
//     await device.save();

//     // ── Deduct balance ───────────────────────────────────────
//     retailer[balanceField] -= 1;
//     await retailer.save();
//     await WalletTransaction.create({
//       userId:      targetRetailerId,
//       type:        'debit',
//       keyType,
//       amount:      1,
//       description: `Device created: ${device.deviceId} — ${name}`,
//       referenceId: device.deviceId,
//     });

//     // ── Generate QR ──────────────────────────────────────────
//     // QR content per key type (new_key=JSON, others=URL)
//     let qrPayload, downloadUrl, provisioningWarning;
//     if (keyType === 'new_key') {
//       downloadUrl = BASE_URL + '/download?deviceId=' + device.deviceId + '&type=new_key';
//       qrPayload = buildProvisioningPayload({
//         deviceId: device.deviceId,
//         baseUrl: BASE_URL,
//         apkUrl: APK_URL,
//         apkChecksum: newKeyApkChecksum,
//       });
//     } else {
//       // running_key / iphone_key - browser URL -> download page -> APK
//       downloadUrl = BASE_URL + '/download?deviceId=' + device.deviceId + '&type=' + keyType;
//       qrPayload = downloadUrl;
//     }
//     // new_key provisioning QR: errorCorrectionLevel 'L' — payload bada hota hai, 'L' se dense nahi hoga
//     const qrEcLevel = keyType === 'new_key' ? 'L' : 'M';
//     const qrImage = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: qrEcLevel, width: 400 });

//     res.json({
//       success:     true,
//       deviceId:    device.deviceId,
//       qrImage,
//       downloadUrl,
//       apkUrl: APK_URL,
//       provisioningWarning,
//       device,
//       customer: {
//         id:   customer._id,
//         name: customer.name,
//         phone: customer.phone,
//         keyType,
//       },
//       remainingBalance: retailer[balanceField],
//     });
//   } catch (err) {
//     console.error('QR generate error:', err);
//     res.status(500).json({ success: false, message: err.message });
//   }
// });

// // GET /api/qr/get-qr/:deviceId — Existing device ka QR regenerate
// router.get('/get-qr/:deviceId', protect, async (req, res) => {
//   try {
//     const device = await Device.findOne({ deviceId: req.params.deviceId });
//     if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

//     // ✅ Public origin se URL banao, Render proxy ke peeche bhi HTTPS rahe.
//     const BASE_URL = getPublicOrigin(req);
//     const APK_URL = process.env.APK_DOWNLOAD_URL || DEFAULT_APK_URL;
//     const downloadUrl = BASE_URL + '/download?deviceId=' + device.deviceId + '&type=' + device.keyType;
//     let qrPayload = downloadUrl;
//     let provisioningWarning;
//     if (device.keyType === 'new_key') {
//       const apkChecksum = await getStrictNewKeyProvisioning(APK_URL);
//       qrPayload = buildProvisioningPayload({
//         deviceId: device.deviceId,
//         baseUrl: BASE_URL,
//         apkUrl: APK_URL,
//         apkChecksum,
//       });
//     }
//     const qrImage = await QRCode.toDataURL(qrPayload, {
//       errorCorrectionLevel: device.keyType === 'new_key' ? 'L' : 'M', width: 400,
//     });

//     res.json({ success: true, deviceId: device.deviceId, qrImage, downloadUrl, apkUrl: APK_URL, provisioningWarning });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });




// // GET /api/qr/payload/:deviceId — Get QR payload JSON
// router.get('/payload/:deviceId', protect, async (req, res) => {
//   try {
//     const device = await Device.findOne({ deviceId: req.params.deviceId })
//       .populate('customerId')
//       .populate('retailerId', 'name phone');
//     if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
//     res.json({
//       success: true,
//       payload: {
//         deviceId: device.deviceId,
//         server: process.env.BASE_URL,
//         type: device.keyType,
//         customerId: device.customerId,
//         retailer: device.retailerId,
//       },
//     });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });

// // GET /api/qr/list — Retailer's QR list (Admin = all, Retailer = own)
// router.get('/list', protect, async (req, res) => {
//   try {
//     const { page = 1, limit = 50, status } = req.query;
//     const isAdmin = req.user.role === 'super_admin' || req.user.role === 'admin';
//     // Admin ko sare devices dikho, retailer ko sirf apne
//     const query = isAdmin ? {} : { retailerId: req.user._id };
//     if (status) query.status = status;
//     const total = await Device.countDocuments(query);
//     const devices = await Device.find(query)
//       .populate('customerId', 'name phone')
//       .populate('retailerId', 'name company')
//       .sort({ createdAt: -1 })
//       .skip((page - 1) * limit)
//       .limit(Number(limit));
//     res.json({ success: true, total, data: devices });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });


// // POST /api/qr/enroll — MDM App calls this when QR scanned
// router.post('/enroll', async (req, res) => {
//   try {
//     const {
//       deviceId, imei, imei2, deviceName, brand, model, androidVersion,
//       fcmToken, simNumber, buildNumber, serialNumber, manufacturer, sdkVersion
//     } = req.body;

//     const device = await Device.findOne({ deviceId });
//     if (!device) return res.status(404).json({ success: false, message: 'Invalid Device ID' });
//     if (device.status === 'active') {
//       return res.status(400).json({ success: false, message: 'Device already enrolled' });
//     }

//     // Update device info
//     device.imei = imei || '';
//     device.imei2 = imei2 || '';
//     device.deviceName = deviceName || '';
//     device.brand = brand || '';
//     device.model = model || '';
//     device.androidVersion = androidVersion || '';
//     device.buildNumber = buildNumber || '';
//     device.serialNumber = serialNumber || '';
//     device.manufacturer = manufacturer || '';
//     device.sdkVersion = sdkVersion || '';
//     device.fcmToken = fcmToken || '';
//     device.simNumber = simNumber || '';
//     device.status = 'active';
//     device.isEnrolled = true;
//     device.enrolledAt = new Date();
//     await device.save();

//     // ✅ Customer status + isActive update
//     if (device.customerId) {
//       await Customer.findByIdAndUpdate(
//         device.customerId,
//         { $set: { status: 'active', isActive: true } },
//         { runValidators: true }
//       );
//       console.log('Customer status updated to active:', device.customerId);
//     }

//     const customer = device.customerId ? await Customer.findById(device.customerId) : null;

//     res.json({
//       success: true,
//       message: 'Device enrolled successfully',
//       device: {
//         deviceId: device.deviceId,
//         status: device.status,
//         keyType: device.keyType,
//         isLocked: device.isLocked,
//       },
//       customer: customer ? {
//         name: customer.name, phone: customer.phone,
//         emiType: customer.emiType, monthlyEmi: customer.monthlyEmi,
//         loanStartDate: customer.loanStartDate,
//       } : null,
//     });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });

// // POST /api/qr/update-fcm — App updates FCM token
// router.post('/update-fcm', async (req, res) => {
//     await WalletTransaction.create({
//       userId:      targetRetailerId,
//       type:        'debit',
//       keyType,
//       amount:      1,
//       description: `Device created: ${device.deviceId} — ${name}`,
//       referenceId: device.deviceId,
//     });

//     // ── Generate QR ──────────────────────────────────────────
//     // QR content per key type (new_key=JSON, others=URL)
//     let qrPayload, downloadUrl, provisioningWarning;
//     if (keyType === 'new_key') {
//       downloadUrl = BASE_URL + '/download?deviceId=' + device.deviceId + '&type=new_key';
//       qrPayload = buildProvisioningPayload({
//         deviceId: device.deviceId,
//         baseUrl: BASE_URL,
//         apkUrl: APK_URL,
//         apkChecksum: newKeyApkChecksum,
//       });
//     } else {
//       // running_key / iphone_key - browser URL -> download page -> APK
//       downloadUrl = BASE_URL + '/download?deviceId=' + device.deviceId + '&type=' + keyType;
//       qrPayload = downloadUrl;
//     }
//     // new_key provisioning QR: errorCorrectionLevel 'L' — payload bada hota hai, 'L' se dense nahi hoga
//     const qrEcLevel = keyType === 'new_key' ? 'L' : 'M';
//     const qrImage = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: qrEcLevel, width: 400 });

//     res.json({
//       success:     true,
//       deviceId:    device.deviceId,
//       qrImage,
//       downloadUrl,
//       apkUrl: APK_URL,
//       provisioningWarning,
//       device,
//       customer: {
//         id:   customer._id,
//         name: customer.name,
//         phone: customer.phone,
//         keyType,
//       },
//       remainingBalance: retailer[balanceField],
//     });
//   } catch (err) {
//     console.error('QR generate error:', err);
//     res.status(500).json({ success: false, message: err.message });
//   }
// });

// // GET /api/qr/get-qr/:deviceId — Existing device ka QR regenerate
// router.get('/get-qr/:deviceId', protect, async (req, res) => {
//   try {
//     const device = await Device.findOne({ deviceId: req.params.deviceId });
//     if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

//     // ✅ Public origin se URL banao, Render proxy ke peeche bhi HTTPS rahe.
//     const BASE_URL = getPublicOrigin(req);
//     const APK_URL = process.env.APK_DOWNLOAD_URL || DEFAULT_APK_URL;
//     const downloadUrl = BASE_URL + '/download?deviceId=' + device.deviceId + '&type=' + device.keyType;
//     let qrPayload = downloadUrl;
//     let provisioningWarning;
//     if (device.keyType === 'new_key') {
//       const apkChecksum = await getStrictNewKeyProvisioning(APK_URL);
//       qrPayload = buildProvisioningPayload({
//         deviceId: device.deviceId,
//         baseUrl: BASE_URL,
//         apkUrl: APK_URL,
//         apkChecksum,
//       });
//     }
//     const qrImage = await QRCode.toDataURL(qrPayload, {
//       errorCorrectionLevel: device.keyType === 'new_key' ? 'L' : 'M', width: 400,
//     });

//     res.json({ success: true, deviceId: device.deviceId, qrImage, downloadUrl, apkUrl: APK_URL, provisioningWarning });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });




// // GET /api/qr/payload/:deviceId — Get QR payload JSON
// router.get('/payload/:deviceId', protect, async (req, res) => {
//   try {
//     const device = await Device.findOne({ deviceId: req.params.deviceId })
//       .populate('customerId')
//       .populate('retailerId', 'name phone');
//     if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
//     res.json({
//       success: true,
//       payload: {
//         deviceId: device.deviceId,
//         server: process.env.BASE_URL,
//         type: device.keyType,
//         customerId: device.customerId,
//         retailer: device.retailerId,
//       },
//     });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });

// // GET /api/qr/list — Retailer's QR list (Admin = all, Retailer = own)
// router.get('/list', protect, async (req, res) => {
//   try {
//     const { page = 1, limit = 50, status } = req.query;
//     const isAdmin = req.user.role === 'super_admin' || req.user.role === 'admin';
//     // Admin ko sare devices dikho, retailer ko sirf apne
//     const query = isAdmin ? {} : { retailerId: req.user._id };
//     if (status) query.status = status;
//     const total = await Device.countDocuments(query);
//     const devices = await Device.find(query)
//       .populate('customerId', 'name phone')
//       .populate('retailerId', 'name company')
//       .sort({ createdAt: -1 })
//       .skip((page - 1) * limit)
//       .limit(Number(limit));
//     res.json({ success: true, total, data: devices });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });


// // POST /api/qr/enroll — MDM App calls this when QR scanned
// router.post('/enroll', async (req, res) => {
//   try {
//     const {
//       deviceId, imei, imei2, deviceName, brand, model, androidVersion,
//       fcmToken, simNumber, buildNumber, serialNumber, manufacturer, sdkVersion
//     } = req.body;

//     const device = await Device.findOne({ deviceId });
//     if (!device) return res.status(404).json({ success: false, message: 'Invalid Device ID' });
//     if (device.status === 'active') {
//       return res.status(400).json({ success: false, message: 'Device already enrolled' });
//     }

//     // Update device info
//     device.imei = imei || '';
//     device.imei2 = imei2 || '';
//     device.deviceName = deviceName || '';
//     device.brand = brand || '';
//     device.model = model || '';
//     device.androidVersion = androidVersion || '';
//     device.buildNumber = buildNumber || '';
//     device.serialNumber = serialNumber || '';
//     device.manufacturer = manufacturer || '';
//     device.sdkVersion = sdkVersion || '';
//     device.fcmToken = fcmToken || '';
//     device.simNumber = simNumber || '';
//     device.status = 'active';
//     device.isEnrolled = true;
//     device.enrolledAt = new Date();
//     await device.save();

//     // ✅ Customer status + isActive update
//     if (device.customerId) {
//       await Customer.findByIdAndUpdate(
//         device.customerId,
//         { $set: { status: 'active', isActive: true } },
//         { runValidators: true }
//       );
//       console.log('Customer status updated to active:', device.customerId);
//     }

//     const customer = device.customerId ? await Customer.findById(device.customerId) : null;

//     res.json({
//       success: true,
//       message: 'Device enrolled successfully',
//       device: {
//         deviceId: device.deviceId,
//         status: device.status,
//         keyType: device.keyType,
//         isLocked: device.isLocked,
//       },
//       customer: customer ? {
//         name: customer.name, phone: customer.phone,
//         emiType: customer.emiType, monthlyEmi: customer.monthlyEmi,
//         loanStartDate: customer.loanStartDate,
//       } : null,
//     });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });

// // POST /api/qr/update-fcm — App updates FCM token
// router.post('/update-fcm', async (req, res) => {
//   try {
//     const { deviceId, fcmToken } = req.body;
//     const device = await Device.findOneAndUpdate({ deviceId }, { fcmToken, lastSeen: new Date() }, { new: true });
//     if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
//     res.json({ success: true, message: 'FCM token updated' });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });

// module.exports = router;


const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Device = require('../models/Device');
const Customer = require('../models/Customer');
const WalletTransaction = require('../models/WalletTransaction');
const { protect } = require('../middleware/auth');

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
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function resolveApkSignatureChecksum() {
  return (process.env.APK_SIGNATURE_CHECKSUM || 'zlqoVvQ2rvBvhZrq0YVCYqb8pvSatXsviWxNz-Cei2w').trim();
}

async function resolveApkProvisioningChecksum(apkUrl) {
  const configuredChecksum = process.env.APK_PROVISIONING_CHECKSUM || process.env.APK_SHA256_CHECKSUM || '';
  if (configuredChecksum.trim()) return configuredChecksum.trim();
  if (apkChecksumCache.url === apkUrl && apkChecksumCache.checksum) return apkChecksumCache.checksum;
  if (typeof fetch !== 'function') return '';
  try {
    const response = await fetch(apkUrl);
    if (!response.ok) throw new Error(`APK download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const checksum = toBase64Url(require('crypto').createHash('sha256').update(bytes).digest());
    apkChecksumCache = { url: apkUrl, checksum };
    return checksum;
  } catch (err) {
    console.warn('APK provisioning checksum error:', err.message);
    return '';
  }
}

function buildProvisioningPayload({ deviceId, baseUrl, apkUrl, apkChecksum }) {
  const signatureChecksum = resolveApkSignatureChecksum();
  const includePackageChecksum = String(process.env.PROVISIONING_INCLUDE_PACKAGE_CHECKSUM || 'false')
    .toLowerCase() === 'true';
  const payload = {
    'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME': MDM_ADMIN_COMPONENT,
    'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION': apkUrl,
    'android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM': signatureChecksum,
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
  if (includePackageChecksum && apkChecksum) {
    payload['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM'] = apkChecksum;
  }
  return JSON.stringify(payload);
}

async function getStrictNewKeyProvisioning(apkUrl) {
  if (!/^https:\/\//i.test(apkUrl || '')) {
    throw new Error('New key provisioning ke liye APK_DOWNLOAD_URL HTTPS hona chahiye.');
  }
  const apkChecksum = await resolveApkProvisioningChecksum(apkUrl);
  if (!apkChecksum) {
    throw new Error('APK_PROVISIONING_CHECKSUM missing hai. Render pe set karo ya APK URL reachable rakho.');
  }
  return apkChecksum;
}

// ── Multer config ────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/customers');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${file.fieldname}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadFields = upload.fields([
  { name: 'customerImage', maxCount: 1 },
  { name: 'customerSignature', maxCount: 1 },
]);

const BALANCE_FIELD = {
  new_key:     'runningKeyBalance',
  running_key: 'runningKeyBalance',
  iphone_key:  'runningKeyBalance',
  android:     'runningKeyBalance',
  iphone:      'runningKeyBalance',
};

// POST /api/qr/generate
router.post('/generate', protect, uploadFields, async (req, res) => {
  try {
    const {
      keyType = 'running_key',
      name, phone, fatherName, address, city, state, aadhar, pan,
      imei1, imei2, mobileNo,
      loanProvider,
      paymentType = 'with_emi',
      emiMonths, emiStartDate, monthlyEmi, totalAmount, downPayment,
      productName, productPrice,
    } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Customer name aur phone required hai' });
    }

    const User = require('../models/User');
    const isAdmin = req.user.role === 'super_admin' || req.user.role === 'admin';
    const targetRetailerId = (isAdmin && req.body.retailerId) ? req.body.retailerId : req.user._id;
    const retailer = await User.findById(targetRetailerId);
    if (!retailer) return res.status(404).json({ success: false, message: 'Retailer not found' });

    const balanceField = BALANCE_FIELD[keyType] || 'runningKeyBalance';
    if (!retailer[balanceField] || retailer[balanceField] < 1) {
      return res.status(400).json({
        success: false,
        message: `Insufficient key balance! Aapke paas ${keyType.replace(/_/g, ' ')} ke liye keys nahi hain.`
      });
    }

    const BASE_URL = getPublicOrigin(req);
    const APK_URL = process.env.APK_DOWNLOAD_URL || DEFAULT_APK_URL;

    const includePackageChecksum = String(process.env.PROVISIONING_INCLUDE_PACKAGE_CHECKSUM || 'false')
      .toLowerCase() === 'true';

    const newKeyApkChecksum = (keyType === 'new_key' && includePackageChecksum)
      ? await getStrictNewKeyProvisioning(APK_URL)
      : '';

    const files = req.files || {};
    const photoUrl     = files.customerImage?.[0] ? `/uploads/customers/${files.customerImage[0].filename}` : '';
    const signatureUrl = files.customerSignature?.[0] ? `/uploads/customers/${files.customerSignature[0].filename}` : '';

    const device = await Device.create({
      keyType,
      retailerId: targetRetailerId,
      status: 'pending',
      imei: imei1 || '',
      imei2: imei2 || '',
    });

    const customer = await Customer.create({
      name: name.trim(), phone: phone.trim(),
      fatherName: fatherName || '', address: address || '',
      city: city || '', state: state || '',
      aadhar: aadhar || '', pan: pan || '',
      keyType, imei1: imei1 || '', imei2: imei2 || '',
      mobileNo: mobileNo || phone, loanProvider: loanProvider || '',
      paymentType, emiMonths: Number(emiMonths) || 0,
      emiStartDate: emiStartDate ? new Date(emiStartDate) : null,
      nextEmiDate: emiStartDate ? new Date(emiStartDate) : null,
      monthlyEmi: Number(monthlyEmi) || 0,
      totalAmount: Number(totalAmount) || 0,
      downPayment: Number(downPayment) || 0,
      productName: productName || '',
      productPrice: Number(productPrice) || 0,
      photo: photoUrl, customerSignature: signatureUrl,
      deviceId: device._id, retailerId: targetRetailerId,
      createdBy: req.user._id, status: 'pending',
      qrCode: device.deviceId,
    });

    device.customerId = customer._id;
    await device.save();

    retailer[balanceField] -= 1;
    await retailer.save();
    await WalletTransaction.create({
      userId: targetRetailerId, type: 'debit', keyType, amount: 1,
      description: `Device created: ${device.deviceId} — ${name}`,
      referenceId: device.deviceId,
    });

    let qrPayload, downloadUrl;
    if (keyType === 'new_key') {
      downloadUrl = BASE_URL + '/download?deviceId=' + device.deviceId + '&type=new_key';
      qrPayload = buildProvisioningPayload({
        deviceId: device.deviceId,
        baseUrl: BASE_URL,
        apkUrl: APK_URL,
        apkChecksum: newKeyApkChecksum,
      });
    } else {
      downloadUrl = BASE_URL + '/download?deviceId=' + device.deviceId + '&type=' + keyType;
      qrPayload = downloadUrl;
    }

    const qrEcLevel = keyType === 'new_key' ? 'L' : 'M';
    const qrImage = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: qrEcLevel, width: 400 });

    res.json({
      success: true, deviceId: device.deviceId, qrImage, downloadUrl,
      apkUrl: APK_URL, device,
      customer: { id: customer._id, name: customer.name, phone: customer.phone, keyType },
      remainingBalance: retailer[balanceField],
    });
  } catch (err) {
    console.error('QR generate error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/qr/get-qr/:deviceId
router.get('/get-qr/:deviceId', protect, async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

    const BASE_URL = getPublicOrigin(req);
    const APK_URL = process.env.APK_DOWNLOAD_URL || DEFAULT_APK_URL;
    const downloadUrl = BASE_URL + '/download?deviceId=' + device.deviceId + '&type=' + device.keyType;

    let qrPayload = downloadUrl;
    if (device.keyType === 'new_key') {
      const includePackageChecksum = String(process.env.PROVISIONING_INCLUDE_PACKAGE_CHECKSUM || 'false')
        .toLowerCase() === 'true';
      const apkChecksum = includePackageChecksum
        ? await getStrictNewKeyProvisioning(APK_URL)
        : '';
      qrPayload = buildProvisioningPayload({
        deviceId: device.deviceId,
        baseUrl: BASE_URL,
        apkUrl: APK_URL,
        apkChecksum,
      });
    }

    const qrImage = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: device.keyType === 'new_key' ? 'L' : 'M', width: 400,
    });

    res.json({ success: true, deviceId: device.deviceId, qrImage, downloadUrl, apkUrl: APK_URL });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/qr/payload/:deviceId
router.get('/payload/:deviceId', protect, async (req, res) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId })
      .populate('customerId')
      .populate('retailerId', 'name phone');
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({
      success: true,
      payload: {
        deviceId: device.deviceId,
        server: process.env.BASE_URL,
        type: device.keyType,
        customerId: device.customerId,
        retailer: device.retailerId,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/qr/list
router.get('/list', protect, async (req, res) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const isAdmin = req.user.role === 'super_admin' || req.user.role === 'admin';
    const query = isAdmin ? {} : { retailerId: req.user._id };
    if (status) query.status = status;
    const total = await Device.countDocuments(query);
    const devices = await Device.find(query)
      .populate('customerId', 'name phone')
      .populate('retailerId', 'name company')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    res.json({ success: true, total, data: devices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/qr/enroll
router.post('/enroll', async (req, res) => {
  try {
    const {
      deviceId, imei, imei2, deviceName, brand, model, androidVersion,
      fcmToken, simNumber, buildNumber, serialNumber, manufacturer, sdkVersion
    } = req.body;

    const device = await Device.findOne({ deviceId });
    if (!device) return res.status(404).json({ success: false, message: 'Invalid Device ID' });
    if (device.status === 'active') {
      return res.status(400).json({ success: false, message: 'Device already enrolled' });
    }

    device.imei = imei || ''; device.imei2 = imei2 || '';
    device.deviceName = deviceName || ''; device.brand = brand || '';
    device.model = model || ''; device.androidVersion = androidVersion || '';
    device.buildNumber = buildNumber || ''; device.serialNumber = serialNumber || '';
    device.manufacturer = manufacturer || ''; device.sdkVersion = sdkVersion || '';
    device.fcmToken = fcmToken || ''; device.simNumber = simNumber || '';
    device.status = 'active'; device.isEnrolled = true; device.enrolledAt = new Date();
    await device.save();

    if (device.customerId) {
      await Customer.findByIdAndUpdate(device.customerId, { $set: { status: 'active', isActive: true } });
    }

    const customer = device.customerId ? await Customer.findById(device.customerId) : null;
    res.json({
      success: true, message: 'Device enrolled successfully',
      device: { deviceId: device.deviceId, status: device.status, keyType: device.keyType, isLocked: device.isLocked },
      customer: customer ? { name: customer.name, phone: customer.phone } : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/qr/update-fcm
router.post('/update-fcm', async (req, res) => {
  try {
    const { deviceId, fcmToken } = req.body;
    const device = await Device.findOneAndUpdate({ deviceId }, { fcmToken, lastSeen: new Date() }, { new: true });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, message: 'FCM token updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
