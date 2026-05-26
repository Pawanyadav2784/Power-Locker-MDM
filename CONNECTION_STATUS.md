# ✅ Running Key MDM — Connection Status

## 🔗 Teeno Connected Hain? → **HAAN!**

```
┌─────────────────┐         HTTPS/FCM        ┌──────────────────┐
│   Admin Panel   │◄────────────────────────►│    Backend       │
│  (lockpepro-    │   REST API (JWT Auth)     │  (Node.js)       │
│   admin)        │                           │  Render.com      │
└─────────────────┘                           └────────┬─────────┘
                                                       │
                                                  FCM Push
                                                  Notification
                                                       │
                                              ┌────────▼─────────┐
                                              │   MDM APK         │
                                              │  (Android App)    │
                                              │  Customer Phone   │
                                              └──────────────────┘
```

---

## 1️⃣ Admin Panel → Backend ✅

| Feature | Endpoint | Status |
|---------|----------|--------|
| Login | `POST /api/auth/login` | ✅ |
| Device List | `GET /api/devices` | ✅ |
| Lock Device | `POST /api/devices/lock` | ✅ |
| Unlock Device | `POST /api/devices/unlock` | ✅ |
| **Remove Key** (FRP-safe) | `POST /api/devices/release` | ✅ NEW |
| Customer List | `GET /api/customers/getAllCustomerWithDevices` | ✅ |
| **Customer Status Change** | `POST /api/customers/:id/change-status` | ✅ NEW |
| QR Generate | `POST /api/qr/generate` | ✅ |
| Keys/Wallet | `GET /api/keys/balance` | ✅ |

---

## 2️⃣ Backend → MDM APK ✅ (FCM Push)

| Command | MDM APK Action | Status |
|---------|---------------|--------|
| `LOCK_DEVICE` | Lock screen dikhao | ✅ |
| `UNLOCK_DEVICE` | Lock screen hatao | ✅ |
| `RELEASE_DEVICE` | FRP clear + MDM uninstall | ✅ NEW |
| `DEACTIVE_RESTRICTION` | Saari restrictions hatao (phone free) | ✅ NEW |
| `ACTIVE_RESTRICTION` | Saari restrictions wapas lagao | ✅ NEW |
| `GET_LOCATION` | Location bhejo | ✅ |
| `GET_NUMBER` | SIM number bhejo | ✅ |
| `MESSAGE` | Message dikhao | ✅ |
| `SOFT_RESET` | App restart | ✅ |
| `HARD_RESET` | Factory reset | ✅ |

---

## 3️⃣ MDM APK → Backend ✅ (API Calls)

| Event | Endpoint | Status |
|-------|----------|--------|
| Enrollment | `POST /api/qr/enroll` | ✅ |
| Heartbeat | `GET /api/cmd/:deviceId` | ✅ |
| Command ACK | `POST /api/cmd/ack` | ✅ |
| Location Update | Backend pe bhejta hai | ✅ |
| SIM Number | Backend pe bhejta hai | ✅ |

---

## 🆕 Aaj Jo Banaya (Is Session Mein)

### Customer Table → Phone Flow:
```
Remove ▼ → DEACTIVE_RESTRICTION → Phone FREE (restrictions off, app installed)
Active ▼ → ACTIVE_RESTRICTION  → MDM ACTIVE (restrictions on, sab commands kaam)
```

### Devices Page → Phone Flow:
```
🔑 Remove Key → RELEASE_DEVICE → FRP clear + MDM uninstall (permanent EMI complete)
```

### Guard System:
```
Released device → Koi bhi command BLOCK (backend 403)
Released device → UI mein koi button nahi dikhta
```

---

## ⚠️ Ek Cheez Baki Hai

**Customer "Active" karne ke baad MDM app phir se device owner ban sakti hai?**

Nahi bhai — `ACTIVE_RESTRICTION` sirf restrictions on karti hai.
Agar device owner already hai → sab kuch kaam karega.
Agar device owner nahi hai (pehle release hua tha) → restrictions lagne ki koshish karegi
lekin device owner wale commands nahi chalenge.

**Solution:** Agar "remove" ke baad "active" karna hai permanently,
toh customer ko fresh QR enrollment karna hoga (naya device jaisa).

---

## 🚀 Production URL

```
Backend:      https://power-locker-mdm.onrender.com/api
Admin Panel:  localhost:5174 (build karke deploy karo)
MDM APK:      Customer phone pe installed
```
