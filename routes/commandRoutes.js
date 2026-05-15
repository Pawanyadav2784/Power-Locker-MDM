/**
 * routes/commandRoutes.js
 *
 * SIRF 3 ROUTES:
 *   POST /api/cmd           → koi bhi command bhejo (auth required)
 *   POST /api/cmd/ack       → device command complete karta hai (no auth)
 *   GET  /api/cmd/:deviceId → device pending commands poll karta hai (no auth)
 *   GET  /api/cmd           → admin list (auth required)
 */
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const { sendCommand, ackCommand, pollCommands, listCommands } = require('../controllers/commandController');

router.post('/ack',         ackCommand);            // Device APK → no auth
router.get('/:deviceId',    pollCommands);          // Device APK poll → no auth (must be before GET /)
router.get('/',   protect,  listCommands);          // Admin panel list
router.post('/',  protect,  sendCommand);           // Send any command

module.exports = router;
