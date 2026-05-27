/* EA Platform Admin — vanilla JS */
(function () {
  const AUTH_KEY = 'ea_admin_basic';

  function authHeaders() {
    const basic = sessionStorage.getItem(AUTH_KEY);
    if (!basic) return {};
    return { Authorization: `Basic ${basic}` };
  }

  if (!sessionStorage.getItem(AUTH_KEY)) {
    location.replace('/login.html');
    return;
  }

  const state = {
    summary: null,
    accounts: [],
    daily: [],
    logs: [],
    filterStatus: 'all',
    search: '',
    dailyLogin: '',
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return iso.slice(0, 10);
  }

  function fmtDateGmt(ymd) {
    if (!ymd) return '—';
    const s = String(ymd);
    if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    return s;
  }

  function fmtMoney(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '—';
    return x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function parseExpire(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function accountStatus(a) {
    const approved = a.approved === 1 || a.approved === true;
    const exp = parseExpire(a.expire_iso);
    const now = new Date();
    if (approved) {
      const lifetime = (a.expire_iso || '').startsWith('2099');
      return { key: 'approved', label: lifetime ? 'เปิด — ตลอดอายุ' : 'เปิดใช้งาน', badge: 'badge-ok' };
    }
    if (exp && exp > now) return { key: 'trial', label: 'ทดลอง 7 วัน', badge: 'badge-warn' };
    return { key: 'expired', label: 'หมดอายุ', badge: 'badge-bad' };
  }

  async function api(path, opts = {}) {
    const headers = { ...authHeaders(), ...(opts.headers || {}) };
    const r = await fetch(path, { credentials: 'include', ...opts, headers });
    if (r.status === 401) {
      sessionStorage.removeItem(AUTH_KEY);
      location.replace('/login.html');
      throw new Error('กรุณาเข้าสู่ระบบใหม่');
    }
    if (!r.ok) throw new Error((await r.text()) || r.statusText);
    return r.json();
  }

  function showErr(msg) {
    const el = $('#globalErr');
    el.textContent = msg;
    el.hidden = !msg;
  }

  function setPage(id) {
    $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${id}`));
    $$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === id));
    location.hash = id;
  }

  function filteredAccounts() {
    let list = [...state.accounts];
    const q = state.search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (a) =>
          String(a.account_login).includes(q) ||
          (a.account_name || '').toLowerCase().includes(q) ||
          (a.account_company || '').toLowerCase().includes(q),
      );
    }
    if (state.filterStatus !== 'all') {
      list = list.filter((a) => accountStatus(a).key === state.filterStatus);
    }
    return list;
  }

  function renderKpis() {
    const s = state.summary;
    if (!s) return;
    $('#kpiGrid').innerHTML = `
      <div class="kpi"><div class="label">บัญชีทั้งหมด</div><div class="value">${s.accounts_total}</div></div>
      <div class="kpi"><div class="label">อนุมัติแล้ว</div><div class="value" style="color:var(--ok)">${s.accounts_approved}</div></div>
      <div class="kpi"><div class="label">รายงานวันนี้ (GMT)</div><div class="value">${s.reported_today}</div><div class="hint">${fmtDateGmt(s.date_gmt)}</div></div>
      <div class="kpi"><div class="label">Balance รวมวันนี้</div><div class="value">${fmtMoney(s.total_balance_today)}</div></div>
      <div class="kpi"><div class="label">Log uploads</div><div class="value">${s.log_uploads_total}</div></div>
    `;
  }

  function renderChart() {
    const byDate = {};
    for (const r of state.daily) {
      const d = r.date_gmt;
      if (!byDate[d]) byDate[d] = { balance: 0, count: 0 };
      byDate[d].balance += Number(r.balance) || 0;
      byDate[d].count += 1;
    }
    const dates = Object.keys(byDate).sort().slice(-14);
    const el = $('#balanceChart');
    if (!dates.length) {
      el.innerHTML = '<div class="empty">ยังไม่มีข้อมูล daily สำหรับกราฟ</div>';
      return;
    }
    const max = Math.max(...dates.map((d) => byDate[d].balance), 1);
    el.innerHTML = dates
      .map((d) => {
        const h = Math.round((byDate[d].balance / max) * 100);
        return `<div class="chart-bar" style="height:${Math.max(h, 4)}%" title="${fmtDateGmt(d)}: ${fmtMoney(byDate[d].balance)} (${byDate[d].count} บัญชี)"><span>${String(d).slice(4, 6)}/${String(d).slice(6, 8)}</span></div>`;
      })
      .join('');
  }

  function renderAccountsTable() {
    const list = filteredAccounts();
    const tbody = $('#accountsBody');
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">ไม่พบบัญชี</td></tr>';
      return;
    }
    tbody.innerHTML = list
      .map((a) => {
        const st = accountStatus(a);
        const ok = a.approved === 1;
        return `<tr>
          <td><strong>${esc(a.account_login)}</strong></td>
          <td>${esc(a.account_name || '—')}</td>
          <td>${esc(a.account_company || '—')}</td>
          <td><span class="badge ${st.badge}">${esc(st.label)}</span></td>
          <td>${fmtDate(a.expire_iso)}</td>
          <td>${fmtDate(a.first_seen_at)}</td>
          <td class="actions">
            <button type="button" class="btn btn-sm btn-ghost" data-detail="${esc(a.account_login)}">รายละเอียด</button>
            <button type="button" class="btn btn-sm btn-ghost" data-promo>หน้าโปรโมต</button>
            <button type="button" class="btn btn-sm ${ok ? 'btn-danger' : 'btn-success'}" data-toggle="${esc(a.account_login)}" data-approved="${ok ? '1' : '0'}">${ok ? 'ปิด' : 'เปิด'}</button>
          </td>
        </tr>`;
      })
      .join('');

    tbody.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => toggleApproved(btn.dataset.toggle, btn.dataset.approved === '1'));
    });
    tbody.querySelectorAll('[data-detail]').forEach((btn) => {
      btn.addEventListener('click', () => openAccountModal(btn.dataset.detail));
    });
    tbody.querySelectorAll('[data-promo]').forEach((btn) => {
      btn.addEventListener('click', () => copyPublicPanelLink());
    });
  }

  function renderDailyTable() {
    let rows = state.daily;
    const login = state.dailyLogin.trim();
    if (login) rows = rows.filter((r) => String(r.account_login) === login);

    const tbody = $('#dailyBody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">ไม่มีข้อมูล</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map(
        (r) => `<tr>
          <td>${fmtDateGmt(r.date_gmt)}</td>
          <td>${esc(r.account_login)}</td>
          <td>${esc(r.ea_name)}</td>
          <td class="num">${fmtMoney(r.balance)}</td>
          <td class="num">${fmtMoney(r.equity)}</td>
          <td class="num">${fmtMoney(r.profit)}</td>
        </tr>`,
      )
      .join('');
  }

  function renderLogsTable() {
    const tbody = $('#logsBody');
    if (!state.logs.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">ยังไม่มี log upload</td></tr>';
      return;
    }
    tbody.innerHTML = state.logs
      .map(
        (r) => `<tr>
          <td>${fmtDateGmt(r.date_gmt)}</td>
          <td>${esc(r.account_login)}</td>
          <td>${esc(r.ea_name)}</td>
          <td class="num">${r.line_count}</td>
          <td><code class="path">${esc(r.file_path)}</code></td>
        </tr>`,
      )
      .join('');
  }

  async function toggleApproved(login, currentlyApproved) {
    if (currentlyApproved) {
      const ok = confirm(
        `ปิดการใช้งานบัญชี ${login}?\n\nEA จะถอนตัวออกหลังรอบตรวจ license ครั้งถัดไป (~24 ชม.) หรือเร็วกว่าถ้าลูกค้าเปิด EA ใหม่`,
      );
      if (!ok) return;
    }
    try {
      await api(`/admin/api/accounts/${encodeURIComponent(login)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: !currentlyApproved }),
      });
      await load(true);
    } catch (e) {
      showErr('บันทึกไม่สำเร็จ: ' + e.message);
    }
  }

  function openAccountModal(login) {
    const a = state.accounts.find((x) => String(x.account_login) === String(login));
    if (!a) return;
    const st = accountStatus(a);
    const history = state.daily.filter((r) => String(r.account_login) === String(login)).slice(0, 15);

    $('#modalTitle').textContent = `บัญชี ${login}`;
    $('#modalBody').innerHTML = `
      <dl class="dl-grid">
        <dt>สถานะ</dt><dd><span class="badge ${st.badge}">${esc(st.label)}</span></dd>
        <dt>ชื่อ</dt><dd>${esc(a.account_name || '—')}</dd>
        <dt>Broker</dt><dd>${esc(a.account_company || '—')}</dd>
        <dt>หมดอายุ</dt><dd>${fmtDate(a.expire_iso)} (GMT)</dd>
        <dt>เห็นครั้งแรก</dt><dd>${fmtDate(a.first_seen_at)}</dd>
        <dt>หมายเหตุ</dt><dd>${esc(a.notes || '—')}</dd>
        <dt>ประเภทบัญชี</dt><dd>${esc(a.account_class || 'standard')}</dd>
      </dl>
      <h4 style="margin:1.25rem 0 0.5rem;font-size:0.9rem">รายงานรายวันล่าสุด</h4>
      ${
        history.length
          ? `<table class="data"><thead><tr><th>วันที่</th><th>EA</th><th class="num">Balance</th><th class="num">Profit</th></tr></thead><tbody>${history
              .map(
                (r) => `<tr><td>${fmtDateGmt(r.date_gmt)}</td><td>${esc(r.ea_name)}</td><td class="num">${fmtMoney(r.balance)}</td><td class="num">${fmtMoney(r.profit)}</td></tr>`,
              )
              .join('')}</tbody></table>`
          : '<p class="empty" style="padding:1rem">ยังไม่มีรายงาน daily</p>'
      }
    `;
    $('#accountModal').hidden = false;
  }

  function publicPanelLink() {
    return `${location.origin}/panel.html`;
  }

  async function copyPublicPanelLink() {
    const url = publicPanelLink();
    try {
      await navigator.clipboard.writeText(url);
      alert('คัดลอกลิงก์หน้าโปรโมตแล้ว:\n' + url);
    } catch {
      prompt('คัดลอกลิงก์หน้าโปรโมต:', url);
    }
  }

  function closeModal() {
    $('#accountModal').hidden = true;
  }

  async function checkHealth() {
    const el = $('#healthStatus');
    try {
      const r = await fetch('/health');
      const j = await r.json();
      el.innerHTML = `<span class="health-ok">● ออนไลน์</span> — ${esc(j.time)}`;
    } catch (e) {
      el.innerHTML = `<span class="health-bad">● ออฟไลน์</span> — ${esc(e.message)}`;
    }
  }

  function showBackupResult(msg, ok) {
    const el = $('#backupResult');
    el.hidden = !msg;
    el.textContent = msg;
    el.className = 'backup-result ' + (ok ? 'backup-ok' : 'backup-err');
  }

  async function loadBackupInfo() {
    const el = $('#backupInfo');
    if (!el) return;
    try {
      const j = await api('/admin/api/backup/info');
      el.textContent = `บัญชี ${j.accounts_total} รายการ · อนุมัติแล้ว ${j.accounts_approved} · ไฟล์: ${j.database_path}`;
    } catch (e) {
      el.textContent = 'โหลดข้อมูลสำรองไม่ได้: ' + e.message;
    }
  }

  async function exportBackup() {
    showBackupResult('');
    try {
      const daily = $('#backupIncludeDaily')?.checked ? '1' : '0';
      const r = await fetch(`/admin/api/backup/export?include_daily=${daily}`, { credentials: 'include' });
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      const disp = r.headers.get('Content-Disposition') || '';
      const m = disp.match(/filename="([^"]+)"/);
      const name = m ? m[1] : `ea-platform-backup-${Date.now()}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      showBackupResult('ดาวน์โหลดสำรองแล้ว — เก็บไฟล์ไว้ก่อนย้าย VPS', true);
    } catch (e) {
      showBackupResult('ดาวน์โหลดไม่สำเร็จ: ' + e.message, false);
    }
  }

  async function importBackupFile(file) {
    if (!file) return;
    const ok = confirm(
      'นำเข้าข้อมูลลูกค้าจากไฟล์สำรอง?\n\nบัญชีที่มีในไฟล์จะอัปเดตสถานะ เปิด/ปิด และวันหมดอายุตามไฟล์สำรอง\n(ระบบจะสำรองข้อมูลปัจจุบันก่อนนำเข้าอัตโนมัติ)',
    );
    if (!ok) return;
    showBackupResult('กำลังนำเข้า…', true);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const includeDaily = !!$('#backupIncludeDaily')?.checked;
      const j = await api('/admin/api/backup/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup: payload, include_daily: includeDaily }),
      });
      showBackupResult(
        `${j.message} — เพิ่ม ${j.added}, อัปเดต ${j.updated}, อนุมัติ ${j.approved} บัญชี` +
          (j.dailyAdded ? `, daily +${j.dailyAdded}` : ''),
        true,
      );
      await load(true);
      await loadBackupInfo();
    } catch (e) {
      showBackupResult('นำเข้าไม่สำเร็จ: ' + e.message, false);
    }
    $('#backupImportFile').value = '';
  }

  async function load(silent) {
    if (!silent) showErr('');
    try {
      const [sum, acc, daily, logs] = await Promise.all([
        api('/admin/api/summary'),
        api('/admin/api/accounts'),
        api('/admin/api/daily?limit=200'),
        api('/admin/api/logs?limit=50'),
      ]);
      state.summary = sum;
      state.accounts = acc.accounts || [];
      state.daily = daily.rows || [];
      state.logs = logs.rows || [];

      renderKpis();
      renderChart();
      renderAccountsTable();
      renderDailyTable();
      renderLogsTable();
      $('#lastRefresh').textContent = new Date().toLocaleString('th-TH');
    } catch (e) {
      showErr('โหลดไม่สำเร็จ: ' + e.message + ' — ตรวจสอบรหัส admin (.env) และว่า server รันอยู่');
    }
  }

  function initNav() {
    $$('.nav button').forEach((btn) => {
      btn.addEventListener('click', () => setPage(btn.dataset.page));
    });
    const hash = (location.hash || '#dashboard').slice(1);
    setPage(['dashboard', 'accounts', 'daily', 'logs', 'system'].includes(hash) ? hash : 'dashboard');
  }

  function initControls() {
    $('#btnRefresh').addEventListener('click', () => load());
    $('#accSearch').addEventListener('input', (e) => {
      state.search = e.target.value;
      renderAccountsTable();
    });
    $('#accFilter').addEventListener('change', (e) => {
      state.filterStatus = e.target.value;
      renderAccountsTable();
    });
    $('#dailyLoginFilter').addEventListener('input', (e) => {
      state.dailyLogin = e.target.value;
      renderDailyTable();
    });
    $('#modalClose').addEventListener('click', closeModal);
    $('#accountModal').addEventListener('click', (e) => {
      if (e.target.id === 'accountModal') closeModal();
    });
    $('#btnHealth').addEventListener('click', checkHealth);
    $('#btnBackupExport')?.addEventListener('click', exportBackup);
    $('#backupImportFile')?.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importBackupFile(f);
    });
  }

  initNav();
  initControls();
  load();
  checkHealth();
  loadBackupInfo();
})();
