# 🔐 Running Key MDM — API Documentation

> **Base URL (Production):** `https://power-locker-mdm.onrender.com/api`
> **Base URL (Local Dev):** `http://localhost:5000/api`

---

## 📌 Authentication

Sabhi protected endpoints pe `Authorization` header mandatory hai:

```
Authorization: Bearer <token>
```

Token login se milta hai. Public endpoints (APK heartbeat, enroll, etc.) mein token ki zarurat **nahi** hai.

---

## 1. 🔑 AUTH — `/api/auth`

### POST `/api/auth/login`
Admin / Retailer login

**Request:**
```json
{
  "email": "admin@runningkey.com",
  "password": "yourpassword"
}
```
**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "_id": "664a...",
    "name": "Pawan Yadav",
    "email": "admin@runningkey.com",
    "role": "super_admin",
    "runningKeyBalance": 500
  }
}
```

### POST `/api/auth/register`
New user register (admin only)

**Request:**
```json
{
  "name": "Retailer Name",
  "email": "retailer@example.com",
  "password": "password123",
  "role": "retailer",
  "phone": "9876543210"
}
```

### GET `/api/auth/me` 🔒
Logged-in user ki info

---

## 2. 📱 DEVICES — `/api/devices`

> **Auth Required:** ✅ (except check-in, update-info)

### GET `/api/devices` 🔒
Sab devices ki list

**Query Params (optional):**
```
?status=active|locked|released|unenrolled
&search=imei_or_deviceId
&page=1&limit=20
```
**Response:**
```json
{
  "success": true,
  "total": 150,
  "totalPages": 8,
  "currentPage": 1,
  "data": [
    {
      "_id": "664a...",
      "deviceId": "2026-00001",
      "brand": "Samsung",
      "model": "Galaxy A54",
      "status": "active",
      "isLocked": false,
      "simNumber": "9876543210",
      "batteryLevel": 85,
      "lastSeen": "2026-05-24T09:00:00Z",
      "releasedAt": null
    }
  ]
}
```

### GET `/api/devices/:id` 🔒
Single device detail (MongoDB `_id` se)

### POST `/api/devices/register` 🔒
Manually device register karo

**Request:**
```json
{
  "imei": "123456789012345",
  "deviceName": "Samsung A54",
  "brand": "Samsung",
  "model": "Galaxy A54",
  "androidVersion": "14"
}
```

### PUT `/api/devices/:id` 🔒
Device update karo

### DELETE `/api/devices/:id` 🔒
Device delete karo

---

### GET `/api/devices/statistics` 🔒
Dashboard stats

**Response:**
```json
{
  "success": true,
  "total": 150,
  "locked": 12,
  "active": 120,
  "pending": 5,
  "unenrolled": 8,
  "online": 120
}
```

---

### POST `/api/devices/lock` 🔒
Device lock karo

**Request:**
```json
{
  "deviceId": "2026-00001",
  "message": "EMI baaki hai — please pay",
  "phone_number": "9876543210"
}
```

### POST `/api/devices/unlock` 🔒
Device unlock karo

**Request:**
```json
{
  "deviceId": "2026-00001"
}
```

---

### 🆕 POST `/api/devices/release` 🔒
**EMI Complete — FRP-safe Device Release**

> Ye endpoint tab call karo jab customer ka EMI poora ho jaye.
> Device pe Enterprise FRP clear hoti hai, Device Owner remove hota hai,
> aur MDM app uninstall ho jaati hai.
> Factory reset ke baad phone sirf customer ke Google account se open hoga.

**Request:**
```json
{
  "deviceId": "2026-00001",
  "note": "EMI complete on 24-May-2026"
}
```
**Response (Success):**
```json
{
  "success": true,
  "message": "✅ Device 2026-00001 released — FRP clear, MDM remove ho jayega",
  "deviceId": "2026-00001",
  "status": "released",
  "releasedAt": "2026-05-24T09:45:00.000Z",
  "releaseNote": "EMI complete on 24-May-2026",
  "commandId": "664b..."
}
```
**Response (Already Released):**
```json
{
  "success": false,
  "message": "Device already released",
  "releasedAt": "2026-05-24T09:45:00.000Z"
}
```

---

### POST `/api/devices/reboot` 🔒
```json
{ "deviceId": "2026-00001" }
```

### POST `/api/devices/wipe` 🔒
Factory reset (MDM se, forceful)
```json
{ "deviceId": "2026-00001" }
```

### POST `/api/devices/soft-reset` 🔒
App restart
```json
{ "deviceId": "2026-00001" }
```

### POST `/api/devices/unenroll` 🔒
```json
{ "deviceId": "2026-00001", "factoryReset": false }
```

### POST `/api/devices/get-location` 🔒
```json
{ "deviceId": "2026-00001" }
```

### POST `/api/devices/get-number` 🔒
```json
{ "deviceId": "2026-00001" }
```

### GET `/api/devices/sim/:deviceId` 🔒
Stored SIM number fetch karo
```json
{
  "success": true,
  "simNumber": "9876543210",
  "simNumber2": "",
  "simOperator": "Jio"
}
```

### POST `/api/devices/message` 🔒
```json
{
  "deviceId": "2026-00001",
  "message": "Please pay your EMI"
}
```

### POST `/api/devices/install-app` 🔒
```json
{
  "deviceId": "2026-00001",
  "apkUrl": "https://example.com/app.apk",
  "appName": "My App"
}
```

### POST `/api/devices/remove-app` 🔒
```json
{
  "deviceId": "2026-00001",
  "packageName": "com.example.app"
}
```

### POST `/api/devices/bulk-command` 🔒
Multiple devices pe ek saath command
```json
{
  "deviceIds": ["2026-00001", "2026-00002"],
  "commandType": "LOCK_DEVICE",
  "payload": { "message": "EMI due" }
}
```

### GET `/api/devices/:id/commands` 🔒
Device ka command history

### GET `/api/devices/location/:deviceId` 🔒
Last known location
```json
{
  "success": true,
  "deviceId": "2026-00001",
  "location": {
    "lat": 28.6139,
    "lng": 77.2090,
    "timestamp": "2026-05-24T08:00:00Z"
  },
  "lastSeen": "2026-05-24T09:00:00Z"
}
```

---

## 3. ⚡ COMMANDS — `/api/cmd`

### POST `/api/cmd` 🔒
Koi bhi command ek jagah se bhejo

**Request:**
```json
{
  "deviceId": "2026-00001",
  "command": "LOCK_DEVICE",
  "payload": {
    "message": "EMI baaki hai",
    "phone_number": "9876543210"
  }
}
```

**Available Commands:**
| Command | Description |
|---------|-------------|
| `LOCK_DEVICE` | Device lock karo |
| `UNLOCK_DEVICE` | Device unlock karo |
| `RELEASE_DEVICE` | EMI complete — FRP-safe release 🆕 |
| `REBOOT` | Reboot |
| `SOFT_RESET` | App restart |
| `HARD_RESET` | Factory reset (MDM) |
| `GET_LOCATION` | Location request |
| `GET_NUMBER` | SIM number fetch |
| `MESSAGE` | Message bhejo |
| `SOCIALMEDIA_LOCK` | Social media block |
| `SOCIALMEDIA_UNLOCK` | Social media unblock |
| `INSTALL_APP` | App install |
| `REMOVE_APP` | App remove |
| `UNENROLL_DEVICE` | MDM remove |
| `MDM_APP_UPDATE` | MDM app update |
| `ACTIVE_RESTRICTION` | Restrictions laga |
| `DEACTIVE_RESTRICTION` | Restrictions hata |

### GET `/api/cmd` 🔒
Command history
```
?deviceId=2026-00001&status=executed&page=1&limit=20
```

### POST `/api/cmd/ack` *(APK — No Auth)*
Device command execute hone ke baad
```json
{
  "commandId": "664c...",
  "status": "executed",
  "deviceResponse": {}
}
```

### GET `/api/cmd/:deviceId` *(APK — No Auth)*
Pending commands poll (Android app use karta hai)

---

## 4. 📷 QR ENROLLMENT — `/api/qr`

### POST `/api/qr/enroll` *(APK — No Auth)*
QR scan ke baad pehla enrollment call

**Request:**
```json
{
  "deviceId": "2026-00001",
  "fcmToken": "fcm_token_here",
  "imei": "123456789012345",
  "brand": "Samsung",
  "model": "Galaxy A54",
  "androidVersion": "14"
}
```

---

## 5. 🔑 KEYS / WALLET — `/api/keys`

### GET `/api/keys/balance` 🔒
Apna current balance

### POST `/api/keys/transfer` 🔒
```json
{
  "toUserId": "664a...",
  "keyType": "running_key",
  "amount": 10
}
```

### POST `/api/keys/generate` 🔒 *(Admin only)*
```json
{
  "userId": "664a...",
  "keyType": "running_key",
  "amount": 50
}
```

### GET `/api/keys/ledger` 🔒
Transaction history
```
?page=1&limit=20&type=credit|debit&from=2026-01-01&to=2026-05-31
```

---

## 6. 👥 CUSTOMERS — `/api/customers`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/customers` | Sab customers |
| POST | `/api/customers` | New customer |
| GET | `/api/customers/:id` | Single customer |
| PUT | `/api/customers/:id` | Update |
| DELETE | `/api/customers/:id` | Delete |

---

## 7. 📅 SCHEDULED COMMANDS — `/api/scheduled-commands`

### POST `/api/scheduled-commands` 🔒
```json
{
  "device_id": "2026-00001",
  "command_type": "LOCK_DEVICE",
  "schedule_type": "one_time",
  "scheduled_at": "2026-05-25T10:00:00Z",
  "label": "EMI due lock"
}
```

---

## 8. 📩 SMS COMMANDS — `/api/sms`

### POST `/api/sms/lock` 🔒
SMS se lock (offline device ke liye)

---

## 9. 🏥 HEALTH CHECK

### GET `/api/health` *(No Auth)*
```json
{
  "success": true,
  "message": "✅ Running Key MDM Server is live!",
  "time": "2026-05-24T09:57:00.000Z"
}
```

---

## 📊 Device Status Values

| Status | Meaning |
|--------|---------|
| `pending` | Enrolled nahi hua |
| `active` | Normal, unlocked |
| `locked` | EMI due — locked |
| `released` | 🆕 EMI complete — MDM removed |
| `unenrolled` | MDM manually removed |
| `removed` | Factory reset hua |
| `expired` | Key expired |

---

## 👤 User Roles (Hierarchy)

```
super_admin
    └── super_distributor
            └── distributor
                    └── sub_distributor
                                └── retailer
```

| Role | Description |
|------|-------------|
| `super_admin` | Full access |
| `super_distributor` | Distributors manage |
| `distributor` | Sub-dist + retailers manage |
| `sub_distributor` | Retailers manage |
| `retailer` | Devices manage karta hai |

---

## ⚠️ Error Response Format

```json
{
  "success": false,
  "message": "Error description yahan aayega"
}
```

**HTTP Status Codes:**
| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created |
| `400` | Bad Request (missing fields) |
| `401` | Unauthorized (no/invalid token) |
| `403` | Forbidden (role access denied) |
| `404` | Not Found |
| `500` | Server Error |
