# VPS — clone จาก Git แล้วรัน (Cursor)

## Repo

https://github.com/isnooker21/Https-3000

## บน VPS

```bash
git clone https://github.com/isnooker21/Https-3000.git
cd Https-3000
cp .env.example .env
nano .env
npm install
npm start
```

หรือใช้ **Cursor SSH** เปิดโฟลเดอร์ `Https-3000` แล้วรันในเทอร์มินัล

## 3) ถาวร

```bash
npm install -g pm2
pm2 start server.js --name ea-platform
pm2 save && pm2 startup
```

## 4) อัปเดตโค้ดทีหลัง

```bash
cd Https-3000 && git pull && npm install
pm2 restart ea-platform
```

Admin: `http://VPS_IP:3000/admin.html`
