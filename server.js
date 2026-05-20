require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const { openDatabase, defaultExpireIso, todayYmdGmt } = require('./db');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const API_KEY = process.env.API_KEY || '';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DEFAULT_TRIAL_DAYS = Number(process.env.DEFAULT_TRIAL_DAYS || 7);
const DB_PATH = process.env.DATABASE_PATH || './data/platform.json';
const LOGS_DIR = path.join(__dirname, 'data', 'logs');

const db = openDatabase(path.resolve(__dirname, DB_PATH));
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '32mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
  const [user, pass] = decoded.split(':');
  if (user === ADMIN_USER && pass === ADMIN_PASSWORD) return next();
  res.set('WWW-Authenticate', 'Basic realm="EA Platform Admin"');
  return res.status(401).send('Invalid credentials');
}

function getAccount(login) {
  return db.prepare('SELECT * FROM accounts WHERE account_login = ?').get(str(login));
}

function upsertAccountFromQuery(q, trialDays) {
  const login = str(q.account_login);
  if (!login) return null;

  const now = new Date().toISOString();
  const existing = getAccount(login);

  if (!existing) {
    const expire = defaultExpireIso(trialDays);
    db.prepare(`
      INSERT INTO accounts (account_login, account_name, account_company, approved, expire_iso, notes, updated_at)
      VALUES (?, ?, ?, 0, ?, 'auto_created', ?)
    `).run(login, str(q.account_name), str(q.account_company), expire, now);
    return getAccount(login);
  }

  db.prepare(`
    UPDATE accounts SET account_name = ?, account_company = ?, updated_at = ? WHERE account_login = ?
  `).run(str(q.account_name), str(q.account_company), now, login);

  return getAccount(login);
}

function legacyLicenseResponse(acc) {
  const approved = acc && (acc.approved === 1 || acc.approved === true);
  const expire = (acc && acc.expire_iso) || defaultExpireIso(DEFAULT_TRIAL_DAYS);
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
      endpoints: ['GET ?action=license', 'GET ?action=daily', 'POST JSON action=logs', '/admin.html'],
    });
  }
  if (action === 'license') return handleLicense(req, res);
  if (action === 'daily') return handleDaily(req, res);
  if (action === 'dashboard') return handleDashboard(req, res);
  return res.status(400).type('text/plain').send('error,Unknown action');
});

app.post('/', eaAuth, (req, res) => handleLogsPost(req, res));

function handleLicense(req, res) {
  const trialDays = parseInt(req.query.trial_expire_in_days || DEFAULT_TRIAL_DAYS, 10) || DEFAULT_TRIAL_DAYS;
  const login = req.query.account_login;
  if (!login) return res.status(400).type('text/plain').send('error,Missing account_login');

  upsertAccountFromQuery(req.query, trialDays);
  const acc = getAccount(login);
  res.type('text/plain').send(legacyLicenseResponse(acc));
}

function handleDaily(req, res) {
  const login = str(req.query.account_login);
  const dateGmt = parseInt(req.query.date_gmt || todayYmdGmt(), 10);
  const now = new Date().toISOString();

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
  );

  upsertAccountFromQuery(req.query, DEFAULT_TRIAL_DAYS);
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
    db.prepare('UPDATE accounts SET approved = ?, updated_at = ? WHERE account_login = ?')
      .run(approved ? 1 : 0, now, login);
  }
  if (expire_iso !== undefined) {
    db.prepare('UPDATE accounts SET expire_iso = ?, updated_at = ? WHERE account_login = ?')
      .run(str(expire_iso), now, login);
  }
  if (notes !== undefined) {
    db.prepare('UPDATE accounts SET notes = ?, updated_at = ? WHERE account_login = ?')
      .run(str(notes), now, login);
  }

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

app.listen(PORT, HOST, () => {
  console.log(`EA Platform server http://${HOST}:${PORT}`);
  console.log(`Admin UI: http://<VPS_IP>:${PORT}/admin.html`);
  if (!API_KEY) console.warn('WARN: API_KEY empty — set in .env for production');
});

