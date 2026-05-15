require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');

// ─── Routes ───────────────────────────────────────────────
const authRoutes            = require('./routes/auth');
const deviceRoutes          = require('./routes/deviceRoutes');
const customerRoutes        = require('./routes/customerRoutes');
const keyRoutes             = require('./routes/keys');
const vendorRoutes          = require('./routes/vendors');
const commandRoutes         = require('./routes/commandRoutes');
const miscRoutes            = require('./routes/miscRoutes');
const postsRoutes           = require('./routes/postsRoutes');
const smsRoutes             = require('./routes/smsRoutes');
const appUpdateRoutes       = require('./routes/appUpdateRoutes');
const dashboardRoutes       = require('./routes/dashboard');
const qrRoutes              = require('./routes/qr');
const scheduledCmdRoutes    = require('./routes/scheduledCommands');
const downloadPageRoutes    = require('./routes/downloadPage'); // ✅ APK download page

const app = express();

// ─── DB Connection ────────────────────────────────────────
connectDB();

// ── Create folders ────────────────────────────────────────
if (!fs.existsSync('./uploads'))       fs.mkdirSync('./uploads');
if (!fs.existsSync('./uploads/apk'))   fs.mkdirSync('./uploads/apk'); // APK hosting

// ─── Core Middleware ──────────────────────────────────────
app.use(cors({
  origin: '*',                // Development: sab allow
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-device-secret'],
  credentials: false,
}));
app.options('*', cors());   // Preflight requests handle karo
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ✅ Download page (QR scan karne pe browser mein khulta hai)
app.use(downloadPageRoutes);

app.use('/api/auth',               authRoutes);
app.use('/api/dashboard',          dashboardRoutes);
app.use('/api/devices',            deviceRoutes);
app.use('/api/customers',          customerRoutes);
app.use('/api/keys',               keyRoutes);
app.use('/api/vendors',            vendorRoutes);
app.use('/api/cmd',                commandRoutes);    // ✅ Unified command
app.use('/api/commands',           commandRoutes);    // backward compat
app.use('/api/qr',                 qrRoutes);         // ✅ QR Enrollment
app.use('/api/scheduled-commands', scheduledCmdRoutes); // ✅ Scheduled
app.use('/api/posts',              postsRoutes);
app.use('/api/sms',                smsRoutes);
app.use('/api/appupdate',          appUpdateRoutes);
app.use('/api/v1/auth',            authRoutes);       // APK backward compat
app.use('/api',                    miscRoutes);       // misc last

// ─── Health Check ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: '✅ Running Key MDM Server is live!', time: new Date() });
});

// ─── 404 Handler ──────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.originalUrl} not found` });
});

// ─── Global Error Handler ─────────────────────────────────
app.use(errorHandler);

// ─── Cron: Execute Scheduled Commands (every minute) ─────
const ScheduledCommand = require('./models/ScheduledCommand');
const Device = require('./models/Device');
const { sendFCM } = require('./utils/fcmHelper');

cron.schedule('* * * * *', async () => {
  try {
    const now = new Date();
    const due = await ScheduledCommand.find({ status: 'pending', scheduledAt: { $lte: now } }).populate('deviceId');
    for (const cmd of due) {
      const device = cmd.deviceId;
      if (device?.fcmToken) {
        await sendFCM(device.fcmToken, cmd.commandType, cmd.label, {
          command: cmd.commandType, deviceId: device.deviceId, ...cmd.payload,
        });
      }
      if (cmd.commandType === 'LOCK_DEVICE') {
        await Device.findByIdAndUpdate(device._id, { isLocked: true, status: 'locked' });
      } else if (cmd.commandType === 'UNLOCK_DEVICE') {
        await Device.findByIdAndUpdate(device._id, { isLocked: false, status: 'active' });
      }
      cmd.status = 'executed'; cmd.executedAt = now;
      await cmd.save();
      console.log(`✅ Cron executed: ${cmd.commandType} → ${device?.deviceId}`);
    }
  } catch (err) {
    console.error('Cron error:', err.message);
  }
});

// ─── Start Server ─────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Running Key MDM Server → http://localhost:${PORT}`);
  console.log(`📡 Health: http://localhost:${PORT}/api/health`);
});
