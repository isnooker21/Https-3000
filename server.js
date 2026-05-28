const path = require('path');
const fs = require('fs');

/** โหลด .env บน Windows (ตัด BOM / ช่องว่าง) */
function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  let raw = fs.readFileSync(envPath, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadEnvFile();
require('dotenv').config({ path: path.join(__dirname, '.env'), override: false });

const express = require('express');
const { openDatabase, defaultExpireIso, todayYmdGmt } = require('./db');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const API_KEY = (process.env.API_KEY || '').trim();
const ADMIN_USER = (process.env.ADMIN_USER || 'admin').trim();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();
/** ยังไม่กดเปิด: ทดลอง INSTALL_TRIAL_DAYS วันจาก first_seen | กดเปิด: ตลอดอายุ */
const INSTALL_TRIAL_DAYS = Number(process.env.INSTALL_TRIAL_DAYS || 7);
/** กดเปิดแล้ว: หมดอายุชั่วคราว (EA อ่านเป็น approved=true) */
const LIFETIME_EXPIRE_ISO = process.env.LIFETIME_EXPIRE_ISO || '2099-12-31T23:59:59Z';
const DB_PATH = process.env.DATABASE_PATH || './data/platform.json';
const LOGS_DIR = path.join(__dirname, 'data', 'logs');
/** ถือว่า EA ยังออนไลน์ถ้ามีการเชื่อมต่อภายในกี่ชม. */
const ONLINE_HOURS = Number(process.env.ONLINE_HOURS || 36);
const EA_DOWNLOAD_URL = process.env.EA_DOWNLOAD_URL || '/downloads/Arbi_Gen5.ex5';
const EA_FILE_NAME = process.env.EA_FILE_NAME || 'Arbi_Gen5.ex5';
const EA_DISPLAY_VERSION = process.env.EA_DISPLAY_VERSION || '1.00';
const DOWNLOADS_DIR = path.join(__dirname, 'public', 'downloads');

const db = openDatabase(path.resolve(__dirname, DB_PATH));
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '32mb' }));

// --- helpers ---
function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v) {
  return v == null ? '' : String(v);
}

function checkEaApiKey(req) {
  if (!API_KEY) return true;
  const header = req.get('X-Api-Key') || req.get('x-api-key');
  const query = req.query.api_key;
  return header === API_KEY || query === API_KEY;
}

function eaAuth(req, res, next) {
  if (!checkEaApiKey(req)) {
    return res.status(403).type('text/plain').send('denied,Invalid API key');
  }
  next();
}

function adminAuth(req, res, next) {
  if (!ADMIN_PASSWORD) return next();
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="EA Platform Admin"');
    return res.status(401).send('Authentication required');
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  const user = colon >= 0 ? decoded.slice(0, colon) : decoded;
  const pass = colon >= 0 ? decoded.slice(colon + 1) : '';
  if (user === ADMIN_USER && pass === ADMIN_PASSWORD) return next();
  res.set('WWW-Authenticate', 'Basic realm="EA Platform Admin"');
  return res.status(401).send('Invalid credentials');
}

function getAccount(login) {
  return db.prepare('SELECT * FROM accounts WHERE account_login = ?').get(str(login));
}

function isApproved(acc) {
  return acc && (acc.approved === 1 || acc.approved === true);
}

function isoNow(offsetSec = 0) {
  const d = new Date();
  if (offsetSec) d.setUTCSeconds(d.getUTCSeconds() + offsetSec);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function trialExpireIso(firstSeenIso) {
  const firstSeen = firstSeenIso ? new Date(firstSeenIso) : new Date();
  const cap = new Date(firstSeen);
  cap.setUTCDate(cap.getUTCDate() + INSTALL_TRIAL_DAYS);
  return cap.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function normalizeExpireIso(raw) {
  const s = str(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T23:59:59Z`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** ยังไม่กดเปิด: ไม่เกิน first_seen + 7 วัน | กดเปิดแล้ว: ไม่แตะ expire */
function syncExpiryPolicy(login) {
  const key = str(login);
  const row = db.prepare('SELECT * FROM accounts WHERE account_login = ?').get(key);
  if (!row || isApproved(row)) return;
  const raw = db.getRawStore().accounts[key];
  if (raw && raw.expire_manual) return;

  const now = new Date();
  const capIso = trialExpireIso(row.first_seen_at);
  const cap = new Date(capIso);
  const current = row.expire_iso ? new Date(row.expire_iso) : cap;
  if (current > cap) {
    db.patchAccount(key, { expire_iso: capIso, updated_at: now.toISOString() });
  }
}

function detectAccountClass(q, existing) {
  const raw = str(q.account_class || q.account_type).toLowerCase();
  if (raw === 'cent' || raw === 'micro') return 'cent';
  if (raw === 'standard' || raw === 'std') return 'standard';
  const hay = `${q.account_server || ''} ${q.account_name || ''} ${q.account_company || ''}`.toLowerCase();
  if (/\b(cent|micro|mini)\b/.test(hay)) return 'cent';
  const bal = num(q.account_balance);
  const cur = str(q.account_currency).toUpperCase();
  if (bal >= 50000 && (cur === 'USD' || cur === 'USC')) return 'cent';
  return (existing && existing.account_class) || 'standard';
}

function accountMetaFromQuery(q, existing) {
  const now = new Date().toISOString();
  return {
    account_name: str(q.account_name),
    account_company: str(q.account_company),
    account_server: str(q.account_server),
    account_currency: str(q.account_currency),
    account_class: detectAccountClass(q, existing),
    last_balance: num(q.account_balance),
    last_equity: num(q.account_equity),
    last_profit: num(q.account_profit),
    updated_at: now,
  };
}

function upsertAccountFromQuery(q) {
  const login = str(q.account_login);
  if (!login) return null;

  const now = new Date().toISOString();
  const existing = getAccount(login);
  const meta = accountMetaFromQuery(q, existing);

  if (!existing) {
    db.prepare(`
      INSERT INTO accounts (account_login, account_name, account_company, approved, expire_iso, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      login,
      meta.account_name,
      meta.account_company,
      0,
      defaultExpireIso(INSTALL_TRIAL_DAYS),
      'auto_created',
      now,
    );
    db.patchAccount(login, { ...meta, first_seen_at: now });
    syncExpiryPolicy(login);
    return getAccount(login);
  }

  if (!existing.first_seen_at) {
    meta.first_seen_at = now;
  }

  db.patchAccount(login, meta);
  syncExpiryPolicy(login);
  return getAccount(login);
}

function buildPublicStats() {
  const today = todayYmdGmt();
  const now = Date.now();
  const onlineMs = ONLINE_HOURS * 3600 * 1000;
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY updated_at DESC').all();
  const todayRows = db.prepare('SELECT * FROM daily_snapshots WHERE date_gmt = ?').all(today);

  const latestToday = new Map();
  for (const r of todayRows) {
    latestToday.set(String(r.account_login), r);
  }

  const out = {
    date_gmt: today,
    updated_at: new Date().toISOString(),
    online_hours: ONLINE_HOURS,
    customers_online: 0,
    accounts_running: 0,
    accounts_approved: 0,
    accounts_total: accounts.length,
    reported_today: latestToday.size,
    standard: { accounts: 0, balance: 0, equity: 0, profit: 0 },
    cent: { accounts: 0, balance: 0, equity: 0, profit: 0 },
    totals: { balance: 0, equity: 0, profit: 0 },
  };

  for (const acc of accounts) {
    const login = String(acc.account_login);
    const updated = acc.updated_at ? new Date(acc.updated_at).getTime() : 0;
    const snap = latestToday.get(login);
    const isOnline = now - updated < onlineMs || !!snap;

    if (isApproved(acc)) out.accounts_approved += 1;
    if (!isOnline) continue;

    out.customers_online += 1;
    const st = accountLicenseStatus(acc);
    if (st.can_use_ea) out.accounts_running += 1;

    const cls = str(acc.account_class || snap?.account_class || 'standard').toLowerCase() === 'cent' ? 'cent' : 'standard';
    const bal = snap ? num(snap.balance) : num(acc.last_balance);
    const eq = snap ? num(snap.equity) : num(acc.last_equity);
    const pr = snap ? num(snap.profit) : num(acc.last_profit);

    const bucket = out[cls];
    bucket.accounts += 1;
    bucket.balance += bal;
    bucket.equity += eq;
    bucket.profit += pr;
    out.totals.balance += bal;
    out.totals.equity += eq;
    out.totals.profit += pr;
  }

  return out;
}

function accountLicenseStatus(acc) {
  const approved = isApproved(acc);
  const exp = acc && acc.expire_iso ? new Date(acc.expire_iso) : null;
  const now = new Date();
  if (approved) {
    const lifetime = (acc.expire_iso || '').startsWith('2099');
    return {
      key: 'approved',
      label: lifetime ? 'ใช้งานได้ — อนุมัติแล้ว (ตลอดอายุ)' : 'ใช้งานได้ — อนุมัติแล้ว',
      can_use_ea: true,
    };
  }
  if (exp && exp > now) {
    return {
      key: 'trial',
      label: `ทดลอง ${INSTALL_TRIAL_DAYS} วัน — รออนุมัติ`,
      can_use_ea: true,
    };
  }
  return { key: 'expired', label: 'หมดอายุ — ติดต่อผู้ดูแล', can_use_ea: false };
}

function legacyLicenseResponse(acc) {
  const approved = acc && (acc.approved === 1 || acc.approved === true);
  const expire = (acc && acc.expire_iso) || defaultExpireIso(INSTALL_TRIAL_DAYS);
  const name = (acc && acc.account_name) || '';
  const login = (acc && acc.account_login) || '';
  return ['ok', 'ea_platform', login, name, expire, approved ? 'true' : 'false'].join(',');
}

// --- EA endpoints (EaPlatformClient.mqh) ---
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/', eaAuth, (req, res) => {
  const action = str(req.query.action || '').toLowerCase();
  if (!action) {
    return res.json({
      ok: true,
      service: 'ea-platform-server',
      endpoints: ['GET ?action=license', 'GET ?action=daily', 'POST JSON action=logs', '/admin.html', '/panel.html'],
    });
  }
  if (action === 'license') return handleLicense(req, res);
  if (action === 'daily') return handleDaily(req, res);
  if (action === 'dashboard') return handleDashboard(req, res);
  return res.status(400).type('text/plain').send('error,Unknown action');
});

app.post('/', eaAuth, (req, res) => handleLogsPost(req, res));

function handleLicense(req, res) {
  const login = req.query.account_login;
  if (!login) return res.status(400).type('text/plain').send('error,Missing account_login');

  upsertAccountFromQuery(req.query);
  syncExpiryPolicy(login);
  const acc = getAccount(login);
  res.type('text/plain').send(legacyLicenseResponse(acc));
}

function handleDaily(req, res) {
  const login = str(req.query.account_login);
  const dateGmt = parseInt(req.query.date_gmt || todayYmdGmt(), 10);
  const now = new Date().toISOString();

  const acc = upsertAccountFromQuery(req.query);
  const cls = acc ? acc.account_class : detectAccountClass(req.query, null);
  db.prepare(`
    INSERT INTO daily_snapshots (date_gmt, account_login, ea_name, balance, equity, profit, currency, company, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    dateGmt,
    login,
    str(req.query.ea_name),
    num(req.query.account_balance),
    num(req.query.account_equity),
    num(req.query.account_profit),
    str(req.query.account_currency),
    str(req.query.account_company),
    now,
    cls,
  );

  res.json({ ok: true, saved: true });
}

function handleLogsPost(req, res) {
  const body = req.body || {};
  if (body.action && body.action !== 'logs') {
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  }

  const login = str(body.account_login);
  const dateGmt = parseInt(body.date_gmt || todayYmdGmt(), 10);
  const eaName = str(body.ea_name || 'unknown');
  const payload = str(body.payload);
  const lineCount = parseInt(body.line_count || 0, 10) || (payload ? payload.split('\n').length : 0);

  const dayDir = path.join(LOGS_DIR, String(dateGmt));
  if (!fs.existsSync(dayDir)) fs.mkdirSync(dayDir, { recursive: true });

  const safeEa = eaName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `${login}_${safeEa}.csv`;
  const filePath = path.join(dayDir, filename);
  const header = 'Event,AccountLogin,Server,ClientTag,Magic,GlobalTradeKey,TradeId,Time';
  const needsHeader = !fs.existsSync(filePath) || fs.statSync(filePath).size === 0;

  let toAppend = payload;
  if (needsHeader && payload && !payload.startsWith('Event,')) {
    toAppend = header + '\n' + payload;
  }
  fs.appendFileSync(filePath, (toAppend.endsWith('\n') ? toAppend : toAppend + '\n'), 'utf8');

  const relPath = path.relative(__dirname, filePath);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO log_uploads (date_gmt, account_login, ea_name, line_count, file_path, received_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(dateGmt, login, eaName, lineCount, relPath, now);

  res.json({ ok: true, lines: lineCount, file: relPath });
}

function handleDashboard(req, res) {
  const today = todayYmdGmt();
  const todayRows = db.prepare('SELECT * FROM daily_snapshots WHERE date_gmt = ?').all(today);
  let totalBalance = 0;
  for (const r of todayRows) totalBalance += num(r.balance);

  res.json({
    ok: true,
    date_gmt: today,
    accounts_total: db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c,
    reported_today: todayRows.length,
    total_balance_reported_today: totalBalance,
  });
}

// --- Admin API ---
/** หน้า login แบบฟอร์ม (ไม่ใช้ popup Basic ของเบราว์เซอร์) */
app.post('/admin/api/login', express.json(), (req, res) => {
  const user = str(req.body && req.body.user).trim();
  const password = str(req.body && req.body.password);
  if (!ADMIN_PASSWORD) return res.json({ ok: true });
  if (user === ADMIN_USER && password === ADMIN_PASSWORD) {
    return res.json({ ok: true, user: ADMIN_USER });
  }
  return res.status(401).json({ ok: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
});

app.get('/admin/api/summary', adminAuth, (req, res) => {
  const today = todayYmdGmt();
  const accounts = db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
  const approved = db.prepare('SELECT COUNT(*) AS c FROM accounts WHERE approved = 1').get().c;
  const reported = db.prepare('SELECT COUNT(*) AS c FROM daily_snapshots WHERE date_gmt = ?').get(today).c;
  const sum = db.prepare('SELECT COALESCE(SUM(balance),0) AS s FROM daily_snapshots WHERE date_gmt = ?').get(today);
  const logs = db.prepare('SELECT COUNT(*) AS c FROM log_uploads').get().c;

  res.json({
    ok: true,
    date_gmt: today,
    accounts_total: accounts,
    accounts_approved: approved,
    reported_today: reported,
    total_balance_today: sum.s,
    log_uploads_total: logs,
  });
});

app.get('/admin/api/accounts', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM accounts ORDER BY updated_at DESC').all();
  res.json({ ok: true, accounts: rows });
});

app.patch('/admin/api/accounts/:login', adminAuth, express.json(), (req, res) => {
  const login = req.params.login;
  const acc = getAccount(login);
  if (!acc) return res.status(404).json({ ok: false, error: 'Account not found' });

  const { approved, expire_iso, notes } = req.body || {};
  const now = new Date().toISOString();

  if (approved !== undefined) {
    const patch = {
      approved: !!approved,
      updated_at: now,
      notes: approved ? 'approved_lifetime' : 'locked_by_admin',
    };
    if (approved) {
      patch.expire_iso = LIFETIME_EXPIRE_ISO;
    } else {
      patch.expire_iso = isoNow(-60);
      patch.notes = 'locked_by_admin';
    }
    db.patchAccount(login, patch);
  }
  if (expire_iso !== undefined) {
    const normalized = normalizeExpireIso(expire_iso);
    if (!normalized) {
      return res.status(400).json({ ok: false, error: 'รูปแบบวันหมดอายุไม่ถูกต้อง (ใช้ YYYY-MM-DD)' });
    }
    db.patchAccount(login, {
      expire_iso: normalized,
      expire_manual: true,
      updated_at: now,
    });
  }
  if (notes !== undefined) {
    db.prepare('UPDATE accounts SET notes = ?, updated_at = ? WHERE account_login = ?')
      .run(str(notes), now, login);
  }

  syncExpiryPolicy(login);
  res.json({ ok: true, account: getAccount(login) });
});

app.get('/admin/api/daily', adminAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  const rows = db.prepare(`
    SELECT * FROM daily_snapshots ORDER BY recorded_at DESC LIMIT ?
  `).all(limit);
  res.json({ ok: true, rows });
});

app.get('/admin/api/logs', adminAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const rows = db.prepare(`
    SELECT * FROM log_uploads ORDER BY received_at DESC LIMIT ?
  `).all(limit);
  res.json({ ok: true, rows });
});

const BACKUPS_DIR = path.join(__dirname, 'data', 'backups');
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

/** สำรองข้อมูลลูกค้า — ดาวน์โหลด JSON ก่อนย้าย VPS */
app.get('/admin/api/backup/export', adminAuth, (req, res) => {
  const includeDaily = req.query.include_daily === '1' || req.query.include_daily === 'true';
  const includeLogs = req.query.include_logs === '1' || req.query.include_logs === 'true';
  const payload = db.exportBackup({ includeDaily, includeLogs });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `ea-platform-backup-${stamp}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(payload, null, 2));
});

/** นำเข้าข้อมูลลูกคชา — คงสถานะอนุมัติหลังย้าย server */
app.post('/admin/api/backup/import', adminAuth, (req, res) => {
  const body = req.body || {};
  const payload = body.backup || body;
  let accounts = payload.accounts;

  if (!accounts || typeof accounts !== 'object') {
    const keys = Object.keys(payload).filter((k) => !k.startsWith('_') && k !== 'format' && k !== 'version');
    if (keys.length && payload[keys[0]] && typeof payload[keys[0]] === 'object' && ('approved' in payload[keys[0]] || 'expire_iso' in payload[keys[0]])) {
      accounts = payload;
    }
  }

  if (!accounts || typeof accounts !== 'object' || !Object.keys(accounts).length) {
    return res.status(400).json({ ok: false, error: 'Invalid backup — need accounts object or ea-platform-backup file' });
  }

  const includeDaily = !!body.include_daily;
  const preBackupPath = path.join(BACKUPS_DIR, `pre-import-${Date.now()}.json`);
  fs.writeFileSync(preBackupPath, JSON.stringify(db.getRawStore(), null, 2), 'utf8');

  try {
    const result = db.importBackupPayload(payload, { includeDaily });
    res.json({
      ok: true,
      message: 'นำเข้าสำเร็จ — สถานะอนุมัติและวันหมดอายุถูกคืนแล้ว',
      ...result,
      pre_import_backup: path.relative(__dirname, preBackupPath),
    });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }
});

/** ข้อมูล path ไฟล์ DB (ย้าย server แบบ copy ไฟล์) */
app.get('/admin/api/backup/info', adminAuth, (req, res) => {
  const abs = path.resolve(__dirname, DB_PATH);
  const accounts = db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
  const approved = db.prepare('SELECT COUNT(*) AS c FROM accounts WHERE approved = 1').get().c;
  res.json({
    ok: true,
    database_path: path.relative(__dirname, abs),
    database_absolute: abs,
    accounts_total: accounts,
    accounts_approved: approved,
    tip: 'ย้าย VPS: ดาวน์โหลดสำรองจากหน้านี้ หรือ copy ไฟล์ data/platform.json ไป server ใหม่',
  });
});

/** หน้าโปรโมต — สรุปรวมเท่านั้น ไม่เปิดเผยเลขบัญชี */
app.get('/panel/api/stats', (req, res) => {
  res.json({ ok: true, stats: buildPublicStats() });
});

app.get('/panel/api/info', (req, res) => {
  const localFile = path.join(DOWNLOADS_DIR, EA_FILE_NAME);
  const hasFile = fs.existsSync(localFile);
  res.json({
    ok: true,
    ea_name: 'Arbi_Gen5',
    version: EA_DISPLAY_VERSION,
    file_name: EA_FILE_NAME,
    download_url: EA_DOWNLOAD_URL,
    download_available: hasFile || !!EA_DOWNLOAD_URL,
  });
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, HOST, () => {
  console.log(`EA Platform server http://${HOST}:${PORT}`);
  console.log(`Admin UI:  http://<host>:${PORT}/admin.html`);
  console.log(`Panel:     http://<host>:${PORT}/panel.html`);
  console.log(`Download:  http://<host>:${PORT}/panel-download.html`);
  console.log(`Install:   http://<host>:${PORT}/panel-install.html`);
  if (!API_KEY) console.warn('WARN: API_KEY empty — set in .env for production');
  console.log(`Admin login: user="${ADMIN_USER}" password=${ADMIN_PASSWORD ? 'set' : 'empty (no auth)'}`);
});

