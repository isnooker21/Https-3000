const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function openDatabase(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      account_login TEXT PRIMARY KEY,
      account_name TEXT,
      account_company TEXT,
      approved INTEGER NOT NULL DEFAULT 0,
      expire_iso TEXT,
      notes TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_gmt INTEGER NOT NULL,
      account_login TEXT NOT NULL,
      ea_name TEXT,
      balance REAL,
      equity REAL,
      profit REAL,
      currency TEXT,
      company TEXT,
      recorded_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_daily_login_date
      ON daily_snapshots(account_login, date_gmt);

    CREATE TABLE IF NOT EXISTS log_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_gmt INTEGER NOT NULL,
      account_login TEXT NOT NULL,
      ea_name TEXT,
      line_count INTEGER,
      file_path TEXT,
      received_at TEXT
    );

    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ea_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ea_name TEXT NOT NULL,
      min_version TEXT,
      download_url TEXT,
      message TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT
    );
  `);

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
