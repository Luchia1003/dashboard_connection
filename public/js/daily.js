// ── Sales Page ────────────────────────────────────────────────────────────────

function renderSalesPage() {
  const filtered = getDaily();
  const full = S.daily;
  renderKPIs(filtered);
  renderTimeComparisons(full);  // always full data
  renderCharts(filtered);
  renderInsights(full);         // always full data
}
window.renderSalesPage = renderSalesPage;

// ── KPI Cards ─────────────────────────────────────────────────────────────────

function renderKPIs(data) {
  if (!data.length) {
    document.getElementById('kpiSection').innerHTML =
      `<div style="grid-column:span 4;text-align:center;padding:32px;color:var(--text3);">No data for selected period</div>`;
    return;
  }

  const revenue   = sum(data, 'NET_GROSS_SALES');
  const profit    = sum(data, 'NET_PROFIT');
  const orders    = sum(data, 'NET_ORDER_COUNT');
  const marginPct = avg(data, 'NET_MARGIN_PCT');
  const marginAmt = sum(data, 'NET_MARGIN');

  const cards = [
    {
      label: 'NET REVENUE', val: fmt(revenue), sub: `${data.length} days of data`,
      color: 'rgba(14,165,233,.12)', accent: '#0ea5e9',
      icon: `<svg width="18" height="18" fill="none" stroke="#0ea5e9" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
    },
    {
      label: 'NET PROFIT', val: fmt(profit),
      sub: revenue ? `${fmt(profit / revenue, 'pct')} of revenue` : '',
      color: profit >= 0 ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)',
      accent: profit >= 0 ? '#10b981' : '#ef4444',
      icon: `<svg width="18" height="18" fill="none" stroke="${profit >= 0 ? '#10b981' : '#ef4444'}" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>`,
    },
    {
      label: 'TOTAL ORDERS', val: fmt(orders, 'int'), sub: 'Net order count',
      color: 'rgba(139,92,246,.12)', accent: '#8b5cf6',
      icon: `<svg width="18" height="18" fill="none" stroke="#8b5cf6" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>`,
    },
    {
      label: 'MARGIN', val: fmt(marginPct, 'pct'), val2: fmt(marginAmt),
      sub: 'Avg margin % · Total margin $', isMargin: true,
      color: 'rgba(245,158,11,.12)', accent: '#f59e0b',
      icon: `<svg width="18" height="18" fill="none" stroke="#f59e0b" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>`,
    },
  ];

  document.getElementById('kpiSection').innerHTML = cards.map(c => `
    <div class="kpi-card" style="background:linear-gradient(135deg,var(--card),var(--card));border:1px solid var(--border);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="width:34px;height:34px;border-radius:8px;background:${c.color};display:flex;align-items:center;justify-content:center;">${c.icon}</div>
        <span style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.08em;">${c.label}</span>
      </div>
      <div style="font-size:34px;font-weight:800;color:var(--text);line-height:1;margin-bottom:${c.isMargin ? '4px' : '8px'};">${c.val}</div>
      ${c.isMargin ? `<div style="font-size:14px;font-weight:500;color:var(--text2);margin-bottom:6px;">${c.val2}</div>` : ''}
      <div style="font-size:11px;color:var(--text3);">${c.sub}</div>
    </div>
  `).join('');
}

// ── Time Comparisons (always uses full data) ───────────────────────────────────

function lastN(data, n) {
  const last = data[data.length - 1]?.DATE;
  if (!last) return [];
  const ms = new Date(last).getTime();
  return data.filter(r => { const m = new Date(r.DATE).getTime(); return m <= ms && m > ms - n * 86400000; });
}

function prevN(data, n, offset) {
  const last = data[data.length - 1]?.DATE;
  if (!last) return [];
  const end = new Date(last).getTime() - offset * 86400000;
  return data.filter(r => { const m = new Date(r.DATE).getTime(); return m <= end && m > end - n * 86400000; });
}

function renderTimeComparisons(full) {
  const configs = [
    { title: 'Yesterday',    sub: 'vs 7d Avg',  cur: lastN(full, 1),  base: prevN(full, 7, 1) },
    { title: 'Last 7 Days',  sub: 'vs 30d Avg', cur: lastN(full, 7),  base: prevN(full, 30, 7) },
    { title: 'Last 14 Days', sub: 'vs 30d Avg', cur: lastN(full, 14), base: prevN(full, 30, 14) },
    { title: 'Last 30 Days', sub: 'vs 60d Avg', cur: lastN(full, 30), base: prevN(full, 60, 30) },
  ];

  const metrics = [
    { l: 'Orders',       f: 'NET_ORDER_COUNT',   t: 'int' },
    { l: 'Revenue',      f: 'NET_GROSS_SALES',   t: 'currency' },
    { l: 'Profit',       f: 'NET_PROFIT',        t: 'currency' },
    { l: 'Product Sales',f: 'NET_PRODUCT_SALES', t: 'currency' },
  ];

  document.getElementById('timeComparisons').innerHTML = configs.map(cfg => {
    const cd = cfg.cur.length || 1, bd = cfg.base.length || 1;
    const rows = metrics.map(m => {
      const cTotal = sum(cfg.cur, m.f);
      const cAvg = cTotal / cd;
      const bAvg = sum(cfg.base, m.f) / bd;
      const d = pdiff(cAvg, bAvg);
      const surge = d !== null && d > 0.5;
      const up = d !== null && d > 0;
      const cls = surge ? 'badge-surge' : up ? 'badge-up' : d === null ? 'badge-neu' : 'badge-down';
      const label = d === null ? '—' : surge ? `↑ ${(d*100).toFixed(1)}% ⚡` : up ? `↑ ${(d*100).toFixed(1)}%` : `↓ ${(Math.abs(d)*100).toFixed(1)}%`;
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--sep);">
          <span style="font-size:11px;color:var(--text3);">${m.l}</span>
          <div style="display:flex;align-items:center;gap:5px;">
            <span style="font-size:12px;font-weight:600;color:var(--text);">${fmt(cTotal, m.t)}</span>
            <span class="${cls}" style="font-size:10px;padding:1px 6px;border-radius:20px;white-space:nowrap;">${label}</span>
          </div>
        </div>`;
    }).join('');

    return `
      <div style="background:var(--input);border-radius:10px;padding:14px;border:1px solid var(--border);">
        <div style="font-size:11px;font-weight:700;color:#0ea5e9;letter-spacing:.05em;margin-bottom:10px;">
          ${cfg.title} <span style="color:var(--text3);font-weight:400;">${cfg.sub}</span>
        </div>
        ${rows}
      </div>`;
  }).join('');
}

// ── Charts (respects time range) ─────────────────────────────────────────────

function renderCharts(data) {
  document.getElementById('skelChart1').style.display = 'none';
  document.getElementById('skelChart2').style.display = 'none';

  const monthly = {};
  data.forEach(r => {
    const k = r.DATE.slice(0, 7);
    if (!monthly[k]) monthly[k] = { orders: 0, rev: 0, profit: 0, mSum: 0, days: 0 };
    monthly[k].orders += r.NET_ORDER_COUNT || 0;
    monthly[k].rev    += r.NET_GROSS_SALES || 0;
    monthly[k].profit += r.NET_PROFIT || 0;
    monthly[k].mSum   += r.NET_MARGIN_PCT || 0;
    monthly[k].days++;
  });

  const labels = Object.keys(monthly).sort();
  const vals = labels.map(k => monthly[k]);

  const isLight = S.theme === 'light';
  const grid = isLight ? '#E5E7EB' : '#1e3a5f';
  const tick = isLight ? '#6B7280' : '#94a3b8';
  const tip = { backgroundColor: isLight ? '#fff' : '#1e293b', borderColor: isLight ? '#E5E7EB' : '#334155', borderWidth: 1, titleColor: isLight ? '#1A1A2E' : '#e2e8f0', bodyColor: tick };

  if (S.charts.c1) { S.charts.c1.destroy(); S.charts.c1 = null; }
  if (S.charts.c2) { S.charts.c2.destroy(); S.charts.c2 = null; }

  S.charts.c1 = new Chart(document.getElementById('orderTrendChart'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Net Orders', data: vals.map(v => v.orders), backgroundColor: 'rgba(14,165,233,.7)', borderColor: '#0ea5e9', borderWidth: 1, borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { display: false }, tooltip: { ...tip, callbacks: { label: c => ` Orders: ${Math.round(c.raw).toLocaleString()}` } } },
      scales: { x: { grid: { display: false }, ticks: { color: tick, maxTicksLimit: 8 } }, y: { grid: { color: grid }, ticks: { color: tick, callback: v => Math.round(v).toLocaleString() } } },
    },
  });

  S.charts.c2 = new Chart(document.getElementById('financialChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Revenue', data: vals.map(v => v.rev),    borderColor: '#0ea5e9', tension: .4, pointRadius: 2, borderWidth: 2, backgroundColor: 'transparent', yAxisID: 'y' },
        { label: 'Profit',  data: vals.map(v => v.profit), borderColor: '#10b981', tension: .4, pointRadius: 2, borderWidth: 2, backgroundColor: 'transparent', yAxisID: 'y' },
        { label: 'Margin%', data: vals.map(v => v.days ? (v.mSum / v.days) * 100 : 0), borderColor: '#f59e0b', tension: .4, pointRadius: 2, borderWidth: 2, backgroundColor: 'transparent', yAxisID: 'y1', borderDash: [4, 3] },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { boxWidth: 10, padding: 10, font: { size: 10 }, color: tick } },
        tooltip: { ...tip, callbacks: { label: c => c.dataset.yAxisID === 'y1' ? ` Margin: ${c.raw.toFixed(1)}%` : ` ${c.dataset.label}: ${fmt(c.raw)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: tick, maxTicksLimit: 8 } },
        y:  { position: 'left',  grid: { color: grid }, ticks: { color: tick, callback: v => fmt(v) } },
        y1: { position: 'right', grid: { display: false }, ticks: { color: tick, callback: v => v.toFixed(1) + '%' } },
      },
    },
  });
}
window.renderCharts = renderCharts;

// ── Advanced Insights (always full data) ──────────────────────────────────────

function renderInsights(full) {
  const d7  = lastN(full, 7);
  const d14 = lastN(full, 14);
  const d30 = lastN(full, 30);

  const avg7Rev    = avg(d7,  'NET_GROSS_SALES');
  const avg30Rev   = avg(d30, 'NET_GROSS_SALES');
  const avg14Mgn   = avg(d14, 'NET_MARGIN_PCT');
  const avg30Mgn   = avg(d30, 'NET_MARGIN_PCT');

  const items = [];
  if (avg7Rev > avg30Rev * 1.5)
    items.push({ type: 'surge', icon: '⚡', title: 'Sales Surge Detected', c: '#10b981', desc: `7d avg revenue ${fmt(avg7Rev)}/day is ${((avg7Rev / avg30Rev - 1) * 100).toFixed(0)}% above 30d avg (${fmt(avg30Rev)}/day).` });
  if (avg7Rev < avg30Rev * 0.6)
    items.push({ type: 'warning', icon: '⚠️', title: 'Sales Drop Alert', c: '#ef4444', desc: `7d avg revenue ${fmt(avg7Rev)}/day is ${((1 - avg7Rev / avg30Rev) * 100).toFixed(0)}% below 30d avg (${fmt(avg30Rev)}/day).` });
  if (avg30Mgn && (avg30Mgn - avg14Mgn) / Math.abs(avg30Mgn) > 0.05)
    items.push({ type: 'caution', icon: '📉', title: 'Margin Compression', c: '#f59e0b', desc: `14d avg margin (${fmt(avg14Mgn, 'pct')}) is 5%+ below 30d avg (${fmt(avg30Mgn, 'pct')}).` });

  const el = document.getElementById('insights');
  if (!items.length) {
    el.innerHTML = `<div style="display:flex;align-items:center;gap:12px;padding:14px;border-radius:8px;background:rgba(16,185,129,.08);border-left:3px solid #10b981;"><span style="font-size:20px;">✅</span><div><div style="font-size:13px;font-weight:600;color:#10b981;">All Systems Normal</div><div style="font-size:12px;color:var(--text3);margin-top:2px;">No anomalies detected.</div></div></div>`;
    return;
  }
  el.innerHTML = items.map(i => `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:14px;border-radius:8px;background:rgba(0,0,0,.04);border-left:3px solid ${i.c};margin-bottom:8px;">
      <span style="font-size:20px;margin-top:1px;">${i.icon}</span>
      <div>
        <div style="font-size:13px;font-weight:600;color:${i.c};">${i.title}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:3px;">${i.desc}</div>
      </div>
    </div>`).join('');
}
