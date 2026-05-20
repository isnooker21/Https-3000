/**
 * JSON file database — no native build (works on Windows Server 2012 R2 + Node 16).
 * API compatible with the better-sqlite3 calls used in server.js.
 */
const fs = require('fs');
const path = require('path');

function emptyStore() {
  return {
    accounts: {},
    daily_snapshots: [],
    log_uploads: [],
    news: [],
    ea_versions: [],
    _seq: { daily_snapshots: 0, log_uploads: 0, news: 0, ea_versions: 0 },
  };
}

function normalizePath(dbPath) {
  if (dbPath.endsWith('.json')) return dbPath;
  if (dbPath.endsWith('.db')) return dbPath.replace(/\.db$/i, '.json');
  return `${dbPath}.json`;
}

function loadStore(filePath) {
  if (!fs.existsSync(filePath)) return emptyStore();
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { ...emptyStore(), ...raw, accounts: raw.accounts || {} };
  } catch (e) {
    console.error('DB read error, starting fresh:', e.message);
    return emptyStore();
  }
}

function accountRow(login, store) {
  const a = store.accounts[String(login)];
  if (!a) return undefined;
  return {
    account_login: String(login),
    account_name: a.account_name || '',
    account_company: a.account_company || '',
    approved: a.approved ? 1 : 0,
    expire_iso: a.expire_iso || '',
    first_seen_at: a.first_seen_at || a.updated_at || '',
    notes: a.notes || '',
    account_class: a.account_class || 'standard',
    account_server: a.account_server || '',
    account_currency: a.account_currency || '',
    last_balance: a.last_balance != null ? a.last_balance : 0,
    last_equity: a.last_equity != null ? a.last_equity : 0,
    updated_at: a.updated_at || '',
  };
}

function allAccounts(store) {
  return Object.keys(store.accounts)
    .map((login) => accountRow(login, store))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, ' ').trim();
  }

  get(...params) {
    const s = this.db.store;
    const sql = this.sql;

    if (sql.includes('FROM accounts WHERE account_login')) {
      return accountRow(params[0], s);
    }
    if (sql.includes('COUNT(*) AS c FROM accounts WHERE approved = 1')) {
      const c = Object.values(s.accounts).filter((a) => a.approved).length;
      return { c };
    }
    if (sql.includes('COUNT(*) AS c FROM accounts') && !sql.includes('approved')) {
      return { c: Object.keys(s.accounts).length };
    }
    if (sql.includes('COUNT(*) AS c FROM daily_snapshots WHERE date_gmt')) {
      const c = s.daily_snapshots.filter((r) => r.date_gmt === params[0]).length;
      return { c };
    }
    if (sql.includes('COUNT(*) AS c FROM log_uploads')) {
      return { c: s.log_uploads.length };
    }
    if (sql.includes('COALESCE(SUM(balance)')) {
      const sum = s.daily_snapshots
        .filter((r) => r.date_gmt === params[0])
        .reduce((t, r) => t + (Number(r.balance) || 0), 0);
      return { s: sum };
    }
    return undefined;
  }

  all(...params) {
    const s = this.db.store;
    const sql = this.sql;

    if (sql.includes('FROM daily_snapshots WHERE date_gmt')) {
      return s.daily_snapshots.filter((r) => r.date_gmt === params[0]);
    }
    if (sql.includes('FROM accounts ORDER BY updated_at DESC')) {
      return allAccounts(s);
    }
    if (sql.includes('FROM daily_snapshots ORDER BY recorded_at DESC LIMIT')) {
      const limit = params[0] || 100;
      return [...s.daily_snapshots]
        .sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)))
        .slice(0, limit);
    }
    if (sql.includes('FROM log_uploads ORDER BY received_at DESC LIMIT')) {
      const limit = params[0] || 50;
      return [...s.log_uploads]
        .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)))
        .slice(0, limit);
    }
    return [];
  }

  run(...params) {
    const s = this.db.store;
    const sql = this.sql;

    if (sql.includes('INSERT INTO accounts')) {
      const [login, name, company, approved, expire, notes, updated] = params;
      const extra = params.length >= 8 ? params[7] : updated;
      s.accounts[String(login)] = {
        account_name: name,
        account_company: company,
        approved: !!approved,
        expire_iso: expire,
        first_seen_at: extra,
        notes: notes || '',
        updated_at: updated,
      };
    } else if (sql.includes('UPDATE accounts SET account_name')) {
      const [name, company, updated, login] = params;
      const a = s.accounts[String(login)];
      if (a) {
        a.account_name = name;
        a.account_company = company;
        a.updated_at = updated;
      }
    } else if (sql.includes('UPDATE accounts SET approved')) {
      const [approved, updated, login] = params;
      const a = s.accounts[String(login)];
      if (a) {
        a.approved = !!approved;
        a.updated_at = updated;
      }
    } else if (sql.includes('UPDATE accounts SET expire_iso')) {
      const [expire, updated, login] = params;
      const a = s.accounts[String(login)];
      if (a) {
        a.expire_iso = expire;
        a.updated_at = updated;
      }
    } else if (sql.includes('UPDATE accounts SET notes')) {
      const [notes, updated, login] = params;
      const a = s.accounts[String(login)];
      if (a) {
        a.notes = notes;
        a.updated_at = updated;
      }
    } else if (sql.includes('INSERT INTO daily_snapshots')) {
      s._seq.daily_snapshots += 1;
      s.daily_snapshots.push({
        id: s._seq.daily_snapshots,
        date_gmt: params[0],
        account_login: params[1],
        ea_name: params[2],
        balance: params[3],
        equity: params[4],
        profit: params[5],
        currency: params[6],
        company: params[7],
        recorded_at: params[8],
        account_class: params[9] || 'standard',
      });
    } else if (sql.includes('INSERT INTO log_uploads')) {
      s._seq.log_uploads += 1;
      s.log_uploads.push({
        id: s._seq.log_uploads,
        date_gmt: params[0],
        account_login: params[1],
        ea_name: params[2],
        line_count: params[3],
        file_path: params[4],
        received_at: params[5],
      });
    }

    this.db.save();
  }
}

class JsonDatabase {
  constructor(filePath) {
    this.filePath = filePath;
    this.store = loadStore(filePath);
  }

  save() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.store, null, 2), 'utf8');
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  patchAccount(login, patch) {
    const key = String(login);
    if (!this.store.accounts[key]) return false;
    Object.assign(this.store.accounts[key], patch);
    this.save();
    return true;
  }

  pragma() {
    /* no-op for compatibility */
  }

  exec() {
    /* schema created on first save */
  }
}

function openDatabase(dbPath) {
  const filePath = normalizePath(path.resolve(dbPath));
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new JsonDatabase(filePath);
  if (!fs.existsSync(filePath)) db.save();
  return db;
}

function defaultExpireIso(trialDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + trialDays);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function todayYmdGmt() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return Number(`${y}${m}${day}`);
}

module.exports = { openDatabase, defaultExpireIso, todayYmdGmt };
