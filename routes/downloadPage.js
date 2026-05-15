const express = require('express');
const router  = express.Router();
const Device  = require('../models/Device');

/**
 * GET /download?deviceId=2026-00001&type=running_key
 *
 * QR scan karne pe yahi page khulta hai browser mein.
 * 
 * Flow:
 *   New Phone (android/iphone): APK download button + auto-link
 *   Running Key: APK download button + deviceId copy karne ka option
 */
router.get('/download', async (req, res) => {
  const { deviceId, type = 'running_key' } = req.query;

  // ✅ GitHub APK URL as primary — no server hosting needed
  const APK_URL = process.env.APK_DOWNLOAD_URL ||
    'https://raw.githubusercontent.com/Pawanyadav2784/mdmlocker/main/PowerLocker-v1.0.apk';

  // Device info fetch karo
  let deviceInfo = null;
  if (deviceId) {
    try {
      deviceInfo = await Device.findOne({ deviceId }).select('deviceId status keyType brand model');
    } catch (e) {}
  }

  const isRunningKey = type === 'running_key';
  const isNewPhone   = type === 'android' || type === 'iphone';

  // Deep link — agar app pehle se install hai toh directly khulega
  const deepLink = `mdm://enroll?deviceId=${deviceId}&type=${type}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Power Locker — Device Enrollment</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0D1117; color: #E6EDF3;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 20px;
    }
    .card {
      background: #161B22; border: 1px solid #30363D; border-radius: 16px;
      padding: 32px 24px; max-width: 420px; width: 100%; text-align: center;
    }
    .logo { font-size: 56px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 700; color: #fff; margin-bottom: 8px; }
    .sub { color: #8B949E; font-size: 14px; margin-bottom: 28px; line-height: 1.5; }
    .device-card {
      background: #21262D; border: 1px solid #30363D; border-radius: 12px;
      padding: 16px; margin-bottom: 24px; text-align: left;
    }
    .device-card .label { font-size: 11px; color: #8B949E; text-transform: uppercase; }
    .device-card .value { font-size: 20px; font-weight: 700; color: #58A6FF;
      letter-spacing: 2px; margin-top: 4px; font-family: monospace; }
    .btn {
      display: block; width: 100%; padding: 16px; border-radius: 12px;
      font-size: 16px; font-weight: 700; text-decoration: none; cursor: pointer;
      border: none; margin-bottom: 12px; transition: opacity 0.2s;
    }
    .btn:active { opacity: 0.8; }
    .btn-primary { background: #238636; color: #fff; }
    .btn-secondary { background: #1F6FEB; color: #fff; }
    .btn-outline {
      background: transparent; color: #58A6FF;
      border: 1px solid #58A6FF; font-size: 14px; padding: 12px;
    }
    .steps {
      text-align: left; margin-bottom: 24px;
      background: #0D1117; border-radius: 10px; padding: 16px;
    }
    .step {
      display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px;
    }
    .step:last-child { margin-bottom: 0; }
    .step-num {
      background: #238636; color: #fff; border-radius: 50%;
      width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 700; flex-shrink: 0; margin-top: 2px;
    }
    .step-text { font-size: 13px; color: #C9D1D9; line-height: 1.5; }
    .step-text strong { color: #fff; }
    .badge {
      display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px;
      font-weight: 600; margin-bottom: 20px;
    }
    .badge-rk { background: #1F6FEB22; color: #58A6FF; border: 1px solid #1F6FEB44; }
    .badge-new { background: #23863622; color: #3FB950; border: 1px solid #23863644; }
    .footer { color: #484F58; font-size: 11px; margin-top: 20px; }
    .copy-btn {
      background: #30363D; color: #8B949E; border: none; border-radius: 6px;
      padding: 4px 10px; font-size: 12px; cursor: pointer; margin-top: 8px;
    }
    .copy-btn:active { background: #238636; color: #fff; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🔒</div>
    <h1>Power Locker MDM</h1>

    ${isRunningKey ? `
      <span class="badge badge-rk">🔑 Running Key</span>
    ` : `
      <span class="badge badge-new">📱 New Device Setup</span>
    `}

    ${deviceId ? `
    <div class="device-card">
      <p class="label">Device ID</p>
      <p class="value">${deviceId}</p>
      <button class="copy-btn" onclick="copyId()">📋 Copy Device ID</button>
    </div>
    ` : ''}

    <div class="steps">
      ${isRunningKey ? `
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-text"><strong>APK Download karo</strong> — neeche button dabaao</div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-text"><strong>Install karo</strong> — Unknown sources allow karo Settings mein</div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-text"><strong>App kholo</strong> — Saare permissions do</div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-text"><strong>Device ID daalo:</strong> <code style="color:#58A6FF">${deviceId || 'XXXX-XXXXX'}</code> (upar se copy karo)</div>
      </div>
      ` : `
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-text"><strong>APK Download karo</strong> — neeche button dabaao</div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-text"><strong>Install karo</strong> — Unknown sources allow karo</div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-text"><strong>App khulega</strong> — Device automatically setup hoga!</div>
      </div>
      `}
    </div>

    <!-- Main Download Button -->
    <a href="${APK_URL}" class="btn btn-primary" id="downloadBtn">
      ⬇️ Download Power Locker APK
    </a>

    <!-- Agar app pehle se install hai -->
    <a href="${deepLink}" class="btn btn-secondary" id="openAppBtn">
      📱 App Already Installed? Open Here
    </a>

    <p class="sub" style="font-size:12px; margin-top: 8px;">
      ${isRunningKey
        ? '⚠️ APK install hone ke baad Device ID daalna padega'
        : '✅ APK install hone ke baad app automatically setup ho jayega'}
    </p>

    <div class="footer">
      Power Locker MDM · Secure Device Management<br>
      ${deviceInfo?.status ? `Status: ${deviceInfo.status}` : ''}
    </div>
  </div>

  <script>
    function copyId() {
      navigator.clipboard.writeText('${deviceId}').then(() => {
        const btn = document.querySelector('.copy-btn');
        btn.textContent = '✅ Copied!';
        btn.style.background = '#238636';
        btn.style.color = '#fff';
        setTimeout(() => {
          btn.textContent = '📋 Copy Device ID';
          btn.style.background = '';
          btn.style.color = '';
        }, 2000);
      });
    }

    // Auto-try deep link (agar app installed hai)
    ${isNewPhone ? `
    // New phone: try deep link automatically after 2 sec
    setTimeout(() => {
      window.location.href = '${deepLink}';
    }, 2000);
    ` : ''}
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

module.exports = router;
