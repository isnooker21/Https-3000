# Deploy บน Render.com (แทน VPS สำหรับ web/API)

Emprize VPS ใช้รัน **MT5 + EA** อย่างเดียว  
**Render** รัน **ea-platform-server** (license / admin / panel) — ไม่ต้องเปิด port / firewall

---

## ก่อนเริ่ม

1. Push โค้ดล่าสุดขึ้น GitHub: `https://github.com/isnooker21/Https-3000`
2. สมัคร https://render.com (GitHub login ได้)
3. **แนะนำแผน Starter (~$7/เดือน)** — รัน 24/7, ไม่หลับ (Free tier หลับ → EA license ช้า)
4. **Persistent Disk** (~$0.25/GB/เดือน) — เก็บ `data/platform.json` ไม่หายตอน redeploy

---

## ขั้นที่ 1 — สร้าง Web Service

1. Render Dashboard → **New +** → **Web Service**
2. Connect repo **Https-3000**
3. ตั้งค่า:

| ช่อง | ค่า |
|------|-----|
| **Root Directory** | *(ว่าง ถ้า repo root = ea-platform-server)* หรือ `ea-platform-server` |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Plan** | **Starter** (แนะนำ) |

4. **Environment** → Add:

```
API_KEY=mySecretKey123
ADMIN_USER=isnooker
ADMIN_PASSWORD=รหัสของคุณ
INSTALL_TRIAL_DAYS=7
DATABASE_PATH=./data/platform.json
```

(`PORT` — Render ใสให้อัตโนมัติ ไม่ต้องตั้ง)

5. **Advanced → Persistent Disk** (Starter เท่านั้น):
   - Mount Path: `/opt/render/project/src/data`
   - Size: 1 GB

6. **Create Web Service** → รอ deploy → ได้ URL เช่น  
   `https://ea-platform-xxxx.onrender.com`

---

## ขั้นที่ 2 — ทด admin

```
https://YOUR-SERVICE.onrender.com/login.html
```

Login ตาม `ADMIN_USER` / `ADMIN_PASSWORD`

---

## ขั้นที่ 3 — ย้ายข้อมูลลูกค้า (จาก VPS เก่า)

1. บน VPS (RDP): Admin → **ระบบ** → **ดาวน์โหลดสำรอง (.json)**
2. บน Render admin → **ระบบ** → **นำเข้าจากไฟล์สำรอง**

---

## ขั้นที่ 4 — แก้ EA แล้ว compile

`Include/EaPlatformBuildConfig.mqh`:

```mq5
#define EA_PLATFORM_BASE_URL  "https://YOUR-SERVICE.onrender.com"
#define EA_PLATFORM_API_KEY   "mySecretKey123"
```

Compile `Arbi_Gen5.mq5` → แจก `.ex5` ใหม่

---

## ขั้นที่ 5 — ปิด Node บน Emprize (ไม่บังคับ)

บน VPS:

```cmd
pm2 delete ea-platform
```

Emprize เหลือแค่ **MT5 เทรด** — ไม่ต้องรัน web บน VPS อีก

---

## อัปเดตโค้ดทีหลัง

```bash
git push origin main
```

Render auto-deploy (ถ้าเปิด Auto-Deploy)

---

## หมายเหตุ

| หัวข้อ | รายละเอียด |
|--------|-------------|
| Free tier | App หลับ ~15 นาที → **ไม่เหมาะ production EA** |
| HTTPS | Render ให้อัตโนมัติ — EA ใช้ `https://` ได้ |
| โดเมนของคุณ | Render → Settings → Custom Domain |
| ML logs | เก็บใน `data/logs/` บน disk เดียวกัน |
