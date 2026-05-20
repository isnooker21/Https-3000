(function () {
  PanelNav.render('home');
  const $ = (sel) => document.querySelector(sel);

  function fmtMoney(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '—';
    return x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtInt(n) {
    return Number(n || 0).toLocaleString('th-TH');
  }

  function metricHtml(label, value) {
    return `<div class="metric"><span class="m-label">${label}</span><span class="m-value">${value}</span></div>`;
  }

  function render(s) {
    $('#statOnline').textContent = fmtInt(s.customers_online);
    $('#statRunning').textContent = fmtInt(s.accounts_running);
    $('#statReported').textContent = fmtInt(s.reported_today);
    $('#onlineHours').textContent = s.online_hours;
    $('#lastUpdate').textContent = new Date(s.updated_at).toLocaleString('th-TH');

    $('#totalsRow').innerHTML = `
      <div class="kpi"><div class="label">Balance รวม</div><div class="value">${fmtMoney(s.totals.balance)}</div></div>
      <div class="kpi"><div class="label">Equity รวม</div><div class="value">${fmtMoney(s.totals.equity)}</div></div>
      <div class="kpi"><div class="label">Profit รวมวันนี้</div><div class="value">${fmtMoney(s.totals.profit)}</div></div>
      <div class="kpi"><div class="label">บัญชีในระบบทั้งหมด</div><div class="value">${fmtInt(s.accounts_total)}</div></div>
    `;

    $('#stdCount').textContent = `${fmtInt(s.standard.accounts)} บัญชี`;
    $('#centCount').textContent = `${fmtInt(s.cent.accounts)} บัญชี`;

    $('#stdMetrics').innerHTML = [
      metricHtml('Balance รวม', fmtMoney(s.standard.balance)),
      metricHtml('Equity รวม', fmtMoney(s.standard.equity)),
      metricHtml('Profit รวม', fmtMoney(s.standard.profit)),
    ].join('');

    $('#centMetrics').innerHTML = [
      metricHtml('Balance รวม', fmtMoney(s.cent.balance)),
      metricHtml('Equity รวม', fmtMoney(s.cent.equity)),
      metricHtml('Profit รวม', fmtMoney(s.cent.profit)),
    ].join('');
  }

  async function load() {
    try {
      const data = await panelFetchJson('/panel/api/stats');
      if (!data.ok) throw new Error(data.error || 'โหลดไม่สำเร็จ');
      $('#err').hidden = true;
      render(data.stats);
    } catch (e) {
      $('#err').textContent = e.message;
      $('#err').hidden = false;
    }
  }

  load();
  setInterval(load, 60000);
})();
