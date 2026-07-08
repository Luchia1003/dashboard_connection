// ── Sales Page ────────────────────────────────────────────────────────────────

function renderSalesPage() {
  const filtered = getDaily();
  const full = getDailyFull();    // platform-filtered, but not date-filtered
  const mode = S.salesMode || 'net';
  renderKPIs(filtered, mode);
  renderTimeComparisons(full);    // always full date range, always NET fields, platform-filtered
  renderCharts(filtered, mode);
  renderYoYChart(filtered, full, mode);
  renderInsights(full);           // always full date range, always NET fields, platform-filtered
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
// Count unique dates so multi-platform rows don't flip granularity prematurely.

function gran(data) {
  const uniq = new Set();
  data.forEach(r => uniq.add(r.DATE));
  return uniq.size <= 90 ? 'day' : 'month';
}

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
      sub: `${new Set(data.map(r => r.DATE)).size} days of data`,
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

// Returns the latest date in `data` that is at least 3 days before today,
// skipping the 2 most-recent days (yesterday + day-before) due to data delay.
function getComparisonAnchor(data) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 3);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const eligible = data.filter(r => r.DATE <= cutoffStr);
  return eligible.length ? eligible[eligible.length - 1].DATE : data[data.length - 1]?.DATE || null;
}

function lastN(data, n, anchor) {
  const last = anchor !== undefined ? anchor : data[data.length - 1]?.DATE;
  if (!last) return [];
  const ms = new Date(last).getTime();
  return data.filter(r => { const m = new Date(r.DATE).getTime(); return m <= ms && m > ms - n * 86400000; });
}

function prevN(data, n, offset, anchor) {
  const last = anchor !== undefined ? anchor : data[data.length - 1]?.DATE;
  if (!last) return [];
  const end = new Date(last).getTime() - offset * 86400000;
  return data.filter(r => { const m = new Date(r.DATE).getTime(); return m <= end && m > end - n * 86400000; });
}

function renderTimeComparisons(full) {
  const anchor = getComparisonAnchor(full);
  const anchorDisp = anchor ? anchor.slice(5) : '—';
  const configs = [
    { title: 'Yesterday',    sub: `${anchorDisp} · vs 7d Avg`,          cur: lastN(full, 1,  anchor), base: prevN(full, 7,  1,  anchor) },
    { title: 'Last 7 Days',  sub: `ending ${anchorDisp} · vs 30d Avg`,  cur: lastN(full, 7,  anchor), base: prevN(full, 30, 7,  anchor) },
    { title: 'Last 14 Days', sub: `ending ${anchorDisp} · vs 30d Avg`,  cur: lastN(full, 14, anchor), base: prevN(full, 30, 14, anchor) },
    { title: 'Last 30 Days', sub: `ending ${anchorDisp} · vs 60d Avg`,  cur: lastN(full, 30, anchor), base: prevN(full, 60, 30, anchor) },
  ];

  const metrics = [
    { l: 'Quantity',      f: 'NET_QUANTITY',      t: 'int' },
    { l: 'Revenue',       f: 'NET_GROSS_SALES',   t: 'currency' },
    { l: 'Profit',        f: 'NET_PROFIT',        t: 'currency' },
    { l: 'Product Sales', f: 'NET_PRODUCT_SALES', t: 'currency' },
  ];

  document.getElementById('timeComparisons').innerHTML = configs.map(cfg => {
    // Per-day averages divide by distinct dates, not row count (2 rows/day
    // with Platform=All) — same fix as renderInsights.
    const days = rows => new Set(rows.map(r => r.DATE)).size || 1;
    const cd = days(cfg.cur), bd = days(cfg.base);
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
  const monthly = groupByMulti(data, g, { orders: f.orders, rev: f.rev, profit: f.profit, mSum: f.margin });

  const labels = Object.keys(monthly).sort();
  const vals = labels.map(k => monthly[k]);
  // Keep the year in day labels when the range spans multiple years, otherwise
  // "07-01" of two different years is indistinguishable on the axis.
  const multiYear = new Set(labels.map(k => k.slice(0, 4))).size > 1;
  const displayLabels = labels.map(k => g === 'day' ? (multiYear ? k.slice(2) : k.slice(5)) : k);

  // Subtitle reflects the actual bucketing (day for ≤90 unique dates).
  const granLabel = g === 'day' ? 'Daily' : 'Monthly';
  ['chart1Gran', 'chart2Gran'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = granLabel;
  });

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
      plugins: { legend: { display: false }, tooltip: { ...tip, callbacks: { label: c => ` ${c.dataset.label}: ${Math.round(c.raw).toLocaleString()}` } } },
      scales: { x: { grid: { display: false }, ticks: { color: tick, maxTicksLimit: 12 } }, y: { grid: { color: grid }, ticks: { color: tick, callback: v => Math.round(v).toLocaleString() } } },
    },
  });

  // For margin: if mode has mPct, show percentage; otherwise show dollar margin
  const showMgnPct = !!f.mPct;
  const mgnVals = labels.map((k, i) => {
    const v = vals[i];
    if (showMgnPct) {
      // Weighted margin % per bucket: sum(margin $) / sum(gross $) — matches
      // the KPI card (was an unweighted average of per-row NET_MARGIN_PCT).
      return v.rev ? v.mSum / v.rev * 100 : 0;
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

// Pretty date formatter: "2026-06-07" → "Jun 7, 2026" (avoids Date() timezone issues)
function ymdPretty(s, includeYear = true) {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return includeYear ? `${months[m - 1]} ${d}, ${y}` : `${months[m - 1]} ${d}`;
}

// Format a date range concisely; drop the year on the start if both ends are same year
function ymdRange(from, to) {
  if (!from || !to) return '—';
  const fY = String(from).slice(0, 4), tY = String(to).slice(0, 4);
  if (fY === tY) return `${ymdPretty(from, false)} – ${ymdPretty(to)}`;
  return `${ymdPretty(from)} – ${ymdPretty(to)}`;
}

// Populate the inline totals next to the YoY title
function renderYoYTotals({ filtered, lyData, field, metricLabel, isOrders, minDate, maxDate, lyMin, lyMax, curYear, lyYear }) {
  const el = document.getElementById('yoyTotals');
  if (!el) return;

  if (!filtered.length) {
    el.innerHTML = `<span style="font-size:12px;color:var(--text3);">No data for selected period</span>`;
    return;
  }

  const curTotal  = sum(filtered, field);
  const lyTotal   = sum(lyData,   field);
  const lyHasData = lyData.length > 0;

  const fmtVal = v => isOrders ? Math.round(v).toLocaleString() : fmt(v);
  const d = lyHasData ? pdiff(curTotal, lyTotal) : null;

  let diffBadge = '';
  if (d !== null) {
    const up    = d >= 0;
    const arrow = up ? '↑' : '↓';
    const cls   = up ? 'badge-up' : 'badge-down';
    diffBadge = `<span class="${cls}" style="font-size:11px;padding:2px 8px;border-radius:20px;font-weight:700;white-space:nowrap;">${arrow} ${(Math.abs(d) * 100).toFixed(1)}% YoY</span>`;
  } else {
    diffBadge = `<span class="badge-neu" style="font-size:11px;padding:2px 8px;border-radius:20px;font-weight:600;white-space:nowrap;">No LY data</span>`;
  }

  // Match the "Year over Year" heading style: 14px / weight 600
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:14px;font-weight:600;color:var(--text);">
      <span><span style="color:#0ea5e9;">${curYear}</span> ${fmtVal(curTotal)}</span>
      <span style="color:var(--text3);font-weight:400;">·</span>
      <span style="color:var(--text2);"><span style="color:var(--text3);">${lyYear}</span> ${lyHasData ? fmtVal(lyTotal) : '—'}</span>
      ${diffBadge}
    </div>
    <div style="font-size:11px;color:var(--text3);margin-top:2px;">${ymdRange(minDate, maxDate)} · ${metricLabel}</div>
  `;
}

function renderYoYChart(filtered, all, mode) {
  document.getElementById('skelYoy').style.display = 'none';

  // A multi-year Time Range (e.g. All) would sum every year into the "current"
  // series and compare it against a 1-year-shifted window that mostly overlaps
  // itself — both totals and the YoY % become meaningless. When the selected
  // range spans more than a year, clamp the YoY view to the latest calendar
  // year in the range (YTD), so "last year" truly is the previous year's same
  // period. Ranges ≤ 1 year are untouched.
  if (filtered.length) {
    const first = filtered[0].DATE, last = filtered[filtered.length - 1].DATE;
    const spanDays = (new Date(last + 'T00:00:00') - new Date(first + 'T00:00:00')) / 86400000;
    if (spanDays > 366) {
      const jan1 = last.slice(0, 4) + '-01-01';
      filtered = filtered.filter(r => r.DATE >= jan1);
    }
  }

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
  let lyMin = null, lyMax = null, lyData = [];

  if (minDate && maxDate) {
    lyMin = shiftYear(minDate, -1);
    lyMax = shiftYear(maxDate, -1);
    lyData = all.filter(r => r.DATE >= lyMin && r.DATE <= lyMax);
    const lyMap = groupBy(lyData, g, field);
    lyVals = labels.map(k => {
      const lyKey = g === 'day' ? shiftYear(k, -1) : shiftMonthKey(k, -1);
      return lyMap[lyKey] !== undefined ? lyMap[lyKey] : null;
    });
  }

  // Format display labels (keep the year when the clamped range still crosses
  // a Dec→Jan boundary, so "12-30" and "01-02" aren't yearless).
  const yoyMultiYear = new Set(labels.map(k => k.slice(0, 4))).size > 1;
  const dispLabels = labels.map(k => g === 'day' ? (yoyMultiYear ? k.slice(2) : k.slice(5)) : k);

  if (S.charts.yoy) { S.charts.yoy.destroy(); S.charts.yoy = null; }

  const isLight = S.theme === 'light';
  const grid = isLight ? '#E5E7EB' : '#1e3a5f';
  const tick = isLight ? '#6B7280' : '#94a3b8';
  const tip = { backgroundColor: isLight ? '#fff' : '#1e293b', borderColor: isLight ? '#E5E7EB' : '#334155', borderWidth: 1, titleColor: isLight ? '#1A1A2E' : '#e2e8f0', bodyColor: tick };

  const metricLabel = { orders: 'Orders', revenue: 'Revenue', profit: 'Profit', productSales: 'Product Sales', margin: 'Margin $' }[yoyMetric] || 'Revenue';
  const isOrders = yoyMetric === 'orders';

  // Determine year labels from the ACTUAL series spans — a range crossing a
  // Dec→Jan boundary is labeled "2025–26", not just the end year.
  const spanLabel = (a, b) => {
    if (!a || !b) return new Date().getFullYear().toString();
    const y1 = a.slice(0, 4), y2 = b.slice(0, 4);
    return y1 === y2 ? y2 : `${y1}–${y2.slice(2)}`;
  };
  const curYear = spanLabel(minDate, maxDate);
  const lyYear  = spanLabel(lyMin, lyMax);

  // ── Period totals (current vs LY same period) ────────────────────────────
  renderYoYTotals({
    filtered, lyData, field, metricLabel, isOrders,
    minDate, maxDate, lyMin, lyMax, curYear, lyYear,
  });

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
  const anchor = getComparisonAnchor(full);
  const d7  = lastN(full, 7,  anchor);
  const d14 = lastN(full, 14, anchor);
  const d30 = lastN(full, 30, anchor);

  // Per-DAY averages: divide by distinct dates, not row count (with Platform =
  // All there are 2 rows per day, which used to halve the $/day figures).
  const perDay = (rows, fld) => { const n = new Set(rows.map(r => r.DATE)).size; return n ? sum(rows, fld) / n : 0; };
  // Weighted margin %: sum(margin $) / sum(gross $), not an average of pcts.
  const mgnPct = rows => { const gs = sum(rows, 'NET_GROSS_SALES'); return gs ? sum(rows, 'NET_MARGIN') / gs : 0; };
  const avg7Rev  = perDay(d7,  'NET_GROSS_SALES');
  const avg30Rev = perDay(d30, 'NET_GROSS_SALES');
  const avg14Mgn = mgnPct(d14);
  const avg30Mgn = mgnPct(d30);

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
