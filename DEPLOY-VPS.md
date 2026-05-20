# ติดตั้งบน VPS (ไม่มี domain — ใช้ IP ก่อน)

## สิ่งที่ต้องมี

- VPS Ubuntu 22/24 (root หรือ sudo)
- IP เช่น `123.45.67.89`
- พอร์ต `3000` เปิดใน firewall

---

## ขั้นที่ 1 — อัปโหลดโค้ดขึ้น VPS

จากเครื่อง Mac (โฟลเดอร์นี้อยู่ใน MQL5):

```bash
cd "/Users/isnooker/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/ea-platform-server"

scp -r . root@YOUR_VPS_IP:/opt/ea-platform-server
```

หรือใช้ FileZilla / WinSCP อัปโหลดทั้งโฟลเดอร์ `ea-platform-server` ไปที่ `/opt/ea-platform-server`

---

## ขั้นที่ 2 — ติดตั้ง Node บน VPS

SSH เข้า VPS:

```bash
ssh root@YOUR_VPS_IP
```

```bash
apt update
apt install -y curl build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v   # ควรได้ v18+
```

---

## ขั้นที่ 3 — รัน server

```bash
cd /opt/ea-platform-server
cp .env.example .env
nano .env
```

แก้ใน `.env`:

- `API_KEY` = รหัสยาวๆ (ใช้ใน EA ภายหลังถ้าเพิ่มใน mqh)
- `ADMIN_PASSWORD` = รหัสเข้าหน้า admin

```bash
npm install
npm start
```

ทดสอบจากเครื่องคุณ:

```bash
curl "http://YOUR_VPS_IP:3000/health"
```

เปิดเบราว์เซอร์: `http://YOUR_VPS_IP:3000/admin.html`

---

## ขั้นที่ 4 — เปิดพอร์ต firewall

```bash
ufw allow 22
ufw allow 3000/tcp
ufw enable
```

(ถ้า VPS มี firewall ใน panel ของผู้ให้บริการ — เปิด 3000 ที่นั่นด้วย)

---

## ขั้นที่ 5 — รันถาวร (pm2)

```bash
npm install -g pm2
cd /opt/ea-platform-server
pm2 start server.js --name ea-platform
pm2 save
pm2 startup
```

---

## ขั้นที่ 6 — ตั้งค่า MT5 + Arbi_Gen5

1. **Tools → Options → Expert Advisors**
2. เปิด **Allow WebRequest**
3. เพิ่ม URL: `http://YOUR_VPS_IP:3000`
4. Arbi_Gen5 inputs:
   - `InpUseEaPlatform` = true
   - `InpEaPlatformUrl` = `http://YOUR_VPS_IP:3000`
   - `InpEaPlatformRemoteMl` = true (ถ้าต้องการ log)

5. Compile EA ใหม่ แล้ว attach chart

6. ใน admin → กด **เปิด** บัญชี (approved) หลัง EA เรียก license ครั้งแรก (จะสร้างแถวอัตโนมัติ)

---

## ทดสอบ license ด้วย curl

```bash
curl "http://YOUR_VPS_IP:3000/?action=license&account_login=12345678&account_name=test&account_company=broker&trial_expire_in_days=7&account_currency=USD&account_balance=10000&account_equity=10000&account_profit=0&ea_name=Arbi_Gen5"
```

ควรได้ข้อความแบบ: `ok,ea_platform,12345678,...`

---

## Log เก็บที่ไหน

- SQLite: `/opt/ea-platform-server/data/platform.db`
- CSV ดิบ: `/opt/ea-platform-server/data/logs/YYYYMMDD/`

---

## มี domain แล้ว

1. DNS `api` → IP VPS  
2. ติด Caddy + HTTPS  
3. เปลี่ยน `InpEaPlatformUrl` เป็น `https://api.yourdomain.com`  
4. อัปเดต WebRequest whitelist
