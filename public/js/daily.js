// ── Sales Page ────────────────────────────────────────────────────────────────

function renderSalesPage() {
  const filtered = getDaily();
  const full = S.daily;
  const mode = S.salesMode || 'net';
  renderKPIs(filtered, mode);
  renderTimeComparisons(full);    // always full data, always NET fields
  renderCharts(filtered, mode);
  renderYoYChart(filtered, full, mode);
  renderInsights(full);           // always full data, always NET fields
}
window.renderSalesPage = renderSalesPage;

// ── Field Maps ────────────────────────────────────────────────────────────────

function salesF(mode) {
  return {
    net:    { orders: 'NET_QUANTITY',    rev: 'NET_GROSS_SALES',    profit: 'NET_PROFIT',    pSales: 'NET_PRODUCT_SALES',    margin: 'NET_MARGIN',    mPct: 'NET_MARGIN_PCT' },
    order:  { orders: 'ORDER_QUANTITY',  rev: 'ORDER_GROSS_SALES',  profit: 'ORDER_PROFIT',  pSales: 'ORDER_PRODUCT_SALES',  margin: 'ORDER_MARGIN',  mPct: null },
    refund: { orders: 'REFUND_QUANTITY', rev: 'REFUND_GROSS_SALES', profit: 'REFUND_PROFIT', pSales: 'REFUND_PRODUCT_SALES', margin: 'REFUND_MARGIN', mPct: null },
  }[mode] || {};
}

// ── Chart granularity ─────────────────────────────────────────────────────────

function gran(data) { return data.length <= 90 ? 'day' : 'month'; }

function groupBy(data, g, field) {
  const map = {};
  data.forEach(r => {
    const k = g === 'day' ? r.DATE : r.DATE.slice(0, 7);
    map[k] = (map[k] || 0) + (Number(r[field]) || 0);
  });
  return map;
}

function groupByMulti(data, g, fields) {
  // fields: { key: fieldName, ... }
  const map = {};
  data.forEach(r => {
    const k = g === 'day' ? r.DATE : r.DATE.slice(0, 7);
    if (!map[k]) map[k] = {};
    Object.entries(fields).forEach(([name, f]) => {
      map[k][name] = (map[k][name] || 0) + (Number(r[f]) || 0);
    });
  });
  return map;
}

// ── KPI Cards ─────────────────────────────────────────────────────────────────

function renderKPIs(data, mode) {
  const f = salesF(mode);
  if (!data.length) {
    document.getElementById('kpiSection').innerHTML =
      `<div style="grid-column:span 4;text-align:center;padding:32px;color:var(--text3);font-size:14px;">No data for selected period</div>`;
    return;
  }

  const revenue   = sum(data, f.rev);
  const profit    = sum(data, f.profit);
  const orders    = sum(data, f.orders);
  const marginAmt = sum(data, f.margin);
  const marginPct = revenue !== 0 ? marginAmt / revenue : 0;
  const ml = mode.charAt(0).toUpperCase() + mode.slice(1);

  const cards = [
    {
      label: `${ml} Revenue`, val: fmt(revenue),
      sub: `${data.length} days of data`,
      color: 'rgba(14,165,233,.12)', accent: '#0ea5e9',
      icon: `<svg width="18" height="18" fill="none" stroke="#0ea5e9" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
    },
    {
      label: `${ml} Profit`, val: fmt(profit),
      sub: revenue ? `${fmt(Math.abs(profit / revenue), 'pct')} of revenue` : '–',
      color: profit >= 0 ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)',
      accent: profit >= 0 ? '#10b981' : '#ef4444',
      icon: `<svg width="18" height="18" fill="none" stroke="${profit >= 0 ? '#10b981' : '#ef4444'}" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>`,
    },
    {
      label: `${ml} Quantity`, val: fmt(orders, 'int'),
      sub: `${ml} units sold`,
      color: 'rgba(139,92,246,.12)', accent: '#8b5cf6',
      icon: `<svg width="18" height="18" fill="none" stroke="#8b5cf6" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>`,
    },
    {
      label: 'Margin', val: fmt(marginAmt),
      sub: revenue ? `${fmt(Math.abs(marginPct), 'pct')} of revenue` : '–',
      color: 'rgba(245,158,11,.12)', accent: '#f59e0b',
      icon: `<svg width="18" height="18" fill="none" stroke="#f59e0b" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>`,
    },
  ];

  document.getElementById('kpiSection').innerHTML = cards.map(c => `
    <div class="kpi-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div style="width:36px;height:36px;border-radius:9px;background:${c.color};display:flex;align-items:center;justify-content:center;">${c.icon}</div>
        <span style="font-size:22px;font-weight:800;color:var(--text2);letter-spacing:.01em;">${c.label}</span>
      </div>
      <div style="font-size:38px;font-weight:800;color:var(--text);line-height:1;margin-bottom:10px;">${c.val}</div>
      <div style="font-size:19px;font-weight:600;color:var(--text2);">${c.sub}</div>
    </div>
  `).join('');
}

// ── Time Comparisons (always full data, always NET) ───────────────────────────

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
    { l: 'Quantity',      f: 'NET_QUANTITY',      t: 'int' },
    { l: 'Revenue',       f: 'NET_GROSS_SALES',   t: 'currency' },
    { l: 'Profit',        f: 'NET_PROFIT',        t: 'currency' },
    { l: 'Product Sales', f: 'NET_PRODUCT_SALES', t: 'currency' },
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
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--sep);">
          <span style="font-size:14px;font-weight:600;color:var(--text2);">${m.l}</span>
          <div style="display:flex;align-items:center;gap:7px;">
            <span style="font-size:17px;font-weight:800;color:var(--text);">${fmt(cTotal, m.t)}</span>
            <span class="${cls}" style="font-size:11px;padding:2px 8px;border-radius:20px;white-space:nowrap;font-weight:600;">${label}</span>
          </div>
        </div>`;
    }).join('');

    return `
      <div style="background:var(--input);border-radius:10px;padding:14px;border:1px solid var(--border);">
        <div style="margin-bottom:12px;">
          <div style="font-size:16px;font-weight:800;color:var(--text);">${cfg.title}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:3px;">${cfg.sub}</div>
        </div>
        ${rows}
      </div>`;
  }).join('');
}

// ── Trend Charts (adaptive granularity, mode-aware) ───────────────────────────

function renderCharts(data, mode) {
  document.getElementById('skelChart1').style.display = 'none';
  document.getElementById('skelChart2').style.display = 'none';

  const f = salesF(mode);
  const g = gran(data);
  const monthly = groupByMulti(data, g, { orders: f.orders, rev: f.rev, profit: f.profit, mSum: f.mPct || f.margin });

  const labels = Object.keys(monthly).sort();
  const vals = labels.map(k => monthly[k]);
  const displayLabels = labels.map(k => g === 'day' ? k.slice(5) : k);

  const isLight = S.theme === 'light';
  const grid = isLight ? '#E5E7EB' : '#1e3a5f';
  const tick = isLight ? '#6B7280' : '#94a3b8';
  const tip = { backgroundColor: isLight ? '#fff' : '#1e293b', borderColor: isLight ? '#E5E7EB' : '#334155', borderWidth: 1, titleColor: isLight ? '#1A1A2E' : '#e2e8f0', bodyColor: tick };

  if (S.charts.c1) { S.charts.c1.destroy(); S.charts.c1 = null; }
  if (S.charts.c2) { S.charts.c2.destroy(); S.charts.c2 = null; }

  const ml = mode.charAt(0).toUpperCase() + mode.slice(1);

  S.charts.c1 = new Chart(document.getElementById('orderTrendChart'), {
    type: 'bar',
    data: { labels: displayLabels, datasets: [{ label: `${ml} Quantity`, data: vals.map(v => v.orders || 0), backgroundColor: 'rgba(14,165,233,.7)', borderColor: '#0ea5e9', borderWidth: 1, borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { display: false }, tooltip: { ...tip, callbacks: { label: c => ` Orders: ${Math.round(c.raw).toLocaleString()}` } } },
      scales: { x: { grid: { display: false }, ticks: { color: tick, maxTicksLimit: 12 } }, y: { grid: { color: grid }, ticks: { color: tick, callback: v => Math.round(v).toLocaleString() } } },
    },
  });

  // For margin: if mode has mPct, show percentage; otherwise show dollar margin
  const showMgnPct = !!f.mPct;
  const mgnVals = labels.map((k, i) => {
    const v = vals[i];
    if (showMgnPct) {
      // average margin pct for the grouped period
      const count = data.filter(r => (g === 'day' ? r.DATE : r.DATE.slice(0, 7)) === k).length || 1;
      return v.mSum / count * 100;
    }
    return v.mSum || 0; // dollar margin
  });

  S.charts.c2 = new Chart(document.getElementById('financialChart'), {
    type: 'line',
    data: {
      labels: displayLabels,
      datasets: [
        { label: 'Revenue', data: vals.map(v => v.rev || 0),    borderColor: '#0ea5e9', tension: .4, pointRadius: g === 'day' ? 1 : 2, borderWidth: 2, backgroundColor: 'transparent', yAxisID: 'y' },
        { label: 'Profit',  data: vals.map(v => v.profit || 0), borderColor: '#10b981', tension: .4, pointRadius: g === 'day' ? 1 : 2, borderWidth: 2, backgroundColor: 'transparent', yAxisID: 'y' },
        { label: showMgnPct ? 'Margin%' : 'Margin$', data: mgnVals, borderColor: '#f59e0b', tension: .4, pointRadius: g === 'day' ? 1 : 2, borderWidth: 2, backgroundColor: 'transparent', yAxisID: showMgnPct ? 'y1' : 'y', borderDash: [4, 3] },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { boxWidth: 10, padding: 10, font: { size: 11 }, color: tick } },
        tooltip: { ...tip, callbacks: { label: c => c.dataset.yAxisID === 'y1' ? ` Margin: ${c.raw.toFixed(1)}%` : ` ${c.dataset.label}: ${fmt(c.raw)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: tick, maxTicksLimit: 12 } },
        y:  { position: 'left',  grid: { color: grid }, ticks: { color: tick, callback: v => fmt(v) } },
        y1: { position: 'right', grid: { display: false }, ticks: { color: tick, callback: v => v.toFixed(1) + '%' } },
      },
    },
  });
}
window.renderCharts = renderCharts;

// ── YoY Comparison Chart ─────────────────────────────────────────────────────

function shiftYear(dateStr, yrs) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setFullYear(d.getFullYear() + yrs);
  return d.toISOString().slice(0, 10);
}

function shiftMonthKey(ym, yrs) {
  const [y, m] = ym.split('-').map(Number);
  return `${y + yrs}-${String(m).padStart(2, '0')}`;
}

function renderYoYChart(filtered, all, mode) {
  document.getElementById('skelYoy').style.display = 'none';

  const yoyMetric = S.yoyMetric || 'revenue';
  const f = salesF(mode);
  const fieldMap = { orders: f.orders, revenue: f.rev, profit: f.profit, productSales: f.pSales, margin: f.margin };
  const field = fieldMap[yoyMetric] || f.rev;
  const g = gran(filtered);

  // Current period
  const curMap = groupBy(filtered, g, field);
  const labels = Object.keys(curMap).sort();
  const curVals = labels.map(k => curMap[k] || 0);

  // Last year period
  const minDate = filtered[0]?.DATE;
  const maxDate = filtered[filtered.length - 1]?.DATE;
  let lyVals = labels.map(() => null);

  if (minDate && maxDate) {
    const lyMin = shiftYear(minDate, -1);
    const lyMax = shiftYear(maxDate, -1);
    const lyData = all.filter(r => r.DATE >= lyMin && r.DATE <= lyMax);
    const lyMap = groupBy(lyData, g, field);
    lyVals = labels.map(k => {
      const lyKey = g === 'day' ? shiftYear(k, -1) : shiftMonthKey(k, -1);
      return lyMap[lyKey] !== undefined ? lyMap[lyKey] : null;
    });
  }

  // Format display labels
  const dispLabels = labels.map(k => g === 'day' ? k.slice(5) : k);

  if (S.charts.yoy) { S.charts.yoy.destroy(); S.charts.yoy = null; }

  const isLight = S.theme === 'light';
  const grid = isLight ? '#E5E7EB' : '#1e3a5f';
  const tick = isLight ? '#6B7280' : '#94a3b8';
  const tip = { backgroundColor: isLight ? '#fff' : '#1e293b', borderColor: isLight ? '#E5E7EB' : '#334155', borderWidth: 1, titleColor: isLight ? '#1A1A2E' : '#e2e8f0', bodyColor: tick };

  const metricLabel = { orders: 'Orders', revenue: 'Revenue', profit: 'Profit', productSales: 'Product Sales', margin: 'Margin $' }[yoyMetric] || 'Revenue';
  const isOrders = yoyMetric === 'orders';

  // Determine year labels from data
  const curYear = filtered[filtered.length - 1]?.DATE?.slice(0, 4) || new Date().getFullYear().toString();
  const lyYear = String(parseInt(curYear) - 1);

  S.charts.yoy = new Chart(document.getElementById('yoyChart'), {
    type: 'line',
    data: {
      labels: dispLabels,
      datasets: [
        {
          label: `${curYear} (Current)`,
          data: curVals,
          borderColor: '#0ea5e9',
          backgroundColor: 'rgba(14,165,233,.08)',
          fill: true,
          tension: .4,
          pointRadius: g === 'day' ? 1 : 3,
          borderWidth: 2.5,
        },
        {
          label: `${lyYear} (Last Year)`,
          data: lyVals,
          borderColor: '#94a3b8',
          backgroundColor: 'transparent',
          borderDash: [5, 4],
          tension: .4,
          pointRadius: g === 'day' ? 1 : 3,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { boxWidth: 12, padding: 12, font: { size: 11 }, color: tick } },
        tooltip: {
          ...tip,
          callbacks: {
            label: c => c.raw == null ? ` ${c.dataset.label}: No data` : ` ${c.dataset.label}: ${isOrders ? Math.round(c.raw).toLocaleString() : fmt(c.raw)}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: tick, maxTicksLimit: 12 } },
        y: { grid: { color: grid }, ticks: { color: tick, callback: v => isOrders ? Math.round(v).toLocaleString() : fmt(v) } },
      },
    },
  });
}
window.renderYoYChart = renderYoYChart;

// ── Advanced Insights (always full data, always NET) ──────────────────────────

function renderInsights(full) {
  const d7  = lastN(full, 7);
  const d14 = lastN(full, 14);
  const d30 = lastN(full, 30);

  const avg7Rev  = avg(d7,  'NET_GROSS_SALES');
  const avg30Rev = avg(d30, 'NET_GROSS_SALES');
  const avg14Mgn = avg(d14, 'NET_MARGIN_PCT');
  const avg30Mgn = avg(d30, 'NET_MARGIN_PCT');

  const items = [];
  if (avg7Rev > avg30Rev * 1.5)
    items.push({ c: '#10b981', icon: '⚡', title: 'Sales Surge Detected', desc: `7d avg revenue ${fmt(avg7Rev)}/day is ${((avg7Rev / avg30Rev - 1) * 100).toFixed(0)}% above 30d avg (${fmt(avg30Rev)}/day).` });
  if (avg7Rev < avg30Rev * 0.6)
    items.push({ c: '#ef4444', icon: '⚠️', title: 'Sales Drop Alert', desc: `7d avg revenue ${fmt(avg7Rev)}/day is ${((1 - avg7Rev / avg30Rev) * 100).toFixed(0)}% below 30d avg (${fmt(avg30Rev)}/day).` });
  if (avg30Mgn && (avg30Mgn - avg14Mgn) / Math.abs(avg30Mgn) > 0.05)
    items.push({ c: '#f59e0b', icon: '📉', title: 'Margin Compression', desc: `14d avg margin (${fmt(avg14Mgn, 'pct')}) is 5%+ below 30d avg (${fmt(avg30Mgn, 'pct')}).` });

  const el = document.getElementById('insights');
  if (!items.length) {
    el.innerHTML = `<div style="display:flex;align-items:center;gap:12px;padding:14px;border-radius:8px;background:rgba(16,185,129,.08);border-left:3px solid #10b981;"><span style="font-size:20px;">✅</span><div><div style="font-size:14px;font-weight:600;color:#10b981;">All Systems Normal</div><div style="font-size:13px;color:var(--text2);margin-top:3px;">No performance anomalies detected.</div></div></div>`;
    return;
  }
  el.innerHTML = items.map(i => `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:14px;border-radius:8px;background:rgba(0,0,0,.04);border-left:3px solid ${i.c};margin-bottom:8px;">
      <span style="font-size:20px;margin-top:1px;">${i.icon}</span>
      <div>
        <div style="font-size:14px;font-weight:600;color:${i.c};">${i.title}</div>
        <div style="font-size:13px;color:var(--text2);margin-top:3px;">${i.desc}</div>
      </div>
    </div>`).join('');
}
