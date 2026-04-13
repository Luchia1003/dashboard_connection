// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(val, type = 'currency') {
  if (val == null || isNaN(val)) return '—';
  if (type === 'currency') {
    const abs = Math.abs(val);
    if (abs >= 1_000_000) return (val < 0 ? '-' : '') + '$' + (abs / 1_000_000).toFixed(2) + 'M';
    if (abs >= 1_000) return (val < 0 ? '-' : '') + '$' + (abs / 1_000).toFixed(1) + 'K';
    return '$' + val.toFixed(2);
  }
  if (type === 'pct') return (val * 100).toFixed(1) + '%';
  if (type === 'int') return Math.round(val).toLocaleString();
  return val;
}

function pctDiff(current, base) {
  if (!base) return null;
  return (current - base) / Math.abs(base);
}

function sumField(rows, field) {
  return rows.reduce((acc, r) => acc + (r[field] || 0), 0);
}

function avgField(rows, field) {
  if (!rows.length) return 0;
  return sumField(rows, field) / rows.length;
}

// Get last N days of rows (excluding today if incomplete)
function lastNDays(data, n, referenceDate) {
  const ref = referenceDate || data[data.length - 1]?.DATE;
  const refMs = new Date(ref).getTime();
  return data.filter(r => {
    const ms = new Date(r.DATE).getTime();
    return ms <= refMs && ms > refMs - n * 86400000;
  });
}

function prevNDays(data, n, offset, referenceDate) {
  const ref = referenceDate || data[data.length - 1]?.DATE;
  const refMs = new Date(ref).getTime();
  const endMs = refMs - offset * 86400000;
  return data.filter(r => {
    const ms = new Date(r.DATE).getTime();
    return ms <= endMs && ms > endMs - n * 86400000;
  });
}

// ── Chart.js defaults ─────────────────────────────────────────────────────────

Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = '#334155';
Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
Chart.defaults.font.size = 11;

// ── KPI Cards ─────────────────────────────────────────────────────────────────

function renderKPIs(data) {
  const totalRevenue = sumField(data, 'NET_GROSS_SALES');
  const totalProfit = sumField(data, 'NET_PROFIT');
  const totalOrders = sumField(data, 'NET_ORDER_COUNT');
  const avgMargin = avgField(data, 'NET_MARGIN_PCT');

  const kpis = [
    { label: 'Net Revenue', value: fmt(totalRevenue), icon: '💰', sub: 'All-time cumulative', color: 'from-sky-500/20 to-blue-600/20' },
    { label: 'Net Profit', value: fmt(totalProfit), icon: '📈', sub: 'All-time cumulative', color: 'from-emerald-500/20 to-green-600/20' },
    { label: 'Total Orders', value: fmt(totalOrders, 'int'), icon: '🛒', sub: 'Net order count', color: 'from-violet-500/20 to-purple-600/20' },
    { label: 'Avg Margin', value: fmt(avgMargin, 'pct'), icon: '📊', sub: 'Full period average', color: 'from-amber-500/20 to-orange-600/20' },
  ];

  const container = document.getElementById('kpiSection');
  container.innerHTML = kpis.map(k => `
    <div class="kpi-card p-5 bg-gradient-to-br ${k.color}">
      <div class="flex items-start justify-between mb-3">
        <span class="text-xl">${k.icon}</span>
        <span class="text-xs text-slate-500 font-medium uppercase tracking-wider">${k.label}</span>
      </div>
      <div class="text-2xl font-bold text-white mb-1">${k.value}</div>
      <div class="text-xs text-slate-400">${k.sub}</div>
    </div>
  `).join('');
}

// ── Time Comparison Blocks ─────────────────────────────────────────────────────

function renderComparison(period, current, base) {
  const metrics = [
    { label: 'Orders', field: 'NET_ORDER_COUNT', type: 'int' },
    { label: 'Revenue', field: 'NET_GROSS_SALES', type: 'currency' },
    { label: 'Profit', field: 'NET_PROFIT', type: 'currency' },
    { label: 'Product Sales', field: 'NET_PRODUCT_SALES', type: 'currency' },
  ];

  const rows = metrics.map(m => {
    const cur = sumField(current, m.field) / (current.length || 1);
    const avg = sumField(base, m.field) / (base.length || 1);
    const diff = pctDiff(cur, avg);
    const isSurge = diff !== null && diff > 0.5;
    const isUp = diff !== null && diff > 0;
    const badgeClass = isSurge ? 'badge-surge' : isUp ? 'badge-up' : diff === null ? 'badge-neutral' : 'badge-down';
    const arrow = isUp ? '↑' : '↓';
    const diffLabel = diff !== null ? `${arrow} ${Math.abs(diff * 100).toFixed(1)}%${isSurge ? ' ⚡' : ''}` : '—';

    return `
      <div class="flex items-center justify-between py-1.5 border-b border-[#1e3048] last:border-0">
        <span class="text-xs text-slate-400">${m.label}</span>
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-white">${fmt(cur * current.length, m.type)}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${badgeClass}">${diffLabel}</span>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="bg-[#0f1f35] rounded-lg p-4 border border-[#2a3f55]">
      <div class="text-xs font-semibold text-sky-400 mb-3 uppercase tracking-wider">${period}</div>
      ${rows}
    </div>
  `;
}

function renderTimeComparisons(data) {
  const lastDate = data[data.length - 1]?.DATE;

  const yesterday = lastNDays(data, 1, lastDate);
  const prev7 = prevNDays(data, 7, 1, lastDate);

  const last7 = lastNDays(data, 7, lastDate);
  const prev30 = prevNDays(data, 30, 7, lastDate);

  const last14 = lastNDays(data, 14, lastDate);
  const prev30b = prevNDays(data, 30, 14, lastDate);

  const last30 = lastNDays(data, 30, lastDate);
  const prev60 = prevNDays(data, 60, 30, lastDate);

  const container = document.getElementById('timeComparisons');
  container.innerHTML = [
    renderComparison('Yesterday vs 7d Avg', yesterday, prev7),
    renderComparison('Last 7d vs 30d Avg', last7, prev30),
    renderComparison('Last 14d vs 30d Avg', last14, prev30b),
    renderComparison('Last 30d vs 60d Avg', last30, prev60),
  ].join('');
}

// ── Charts ─────────────────────────────────────────────────────────────────────

function groupByMonth(data) {
  const map = {};
  data.forEach(r => {
    const d = new Date(r.DATE);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!map[key]) map[key] = { orders: 0, revenue: 0, profit: 0, marginSum: 0, days: 0 };
    map[key].orders += r.NET_ORDER_COUNT || 0;
    map[key].revenue += r.NET_GROSS_SALES || 0;
    map[key].profit += r.NET_PROFIT || 0;
    map[key].marginSum += r.NET_MARGIN_PCT || 0;
    map[key].days++;
  });
  return map;
}

function renderCharts(data) {
  const monthly = groupByMonth(data);
  const labels = Object.keys(monthly).sort();
  const vals = labels.map(k => monthly[k]);

  document.getElementById('orderChartSkeleton').style.display = 'none';
  document.getElementById('financialChartSkeleton').style.display = 'none';

  // Order Count Trend
  new Chart(document.getElementById('orderTrendChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Net Orders',
        data: vals.map(v => v.orders),
        borderColor: '#0ea5e9',
        backgroundColor: 'rgba(14,165,233,0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: '#334155',
          borderWidth: 1,
          callbacks: {
            label: ctx => ` Orders: ${Math.round(ctx.raw).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
        y: { grid: { color: '#1e3a5f' }, ticks: { callback: v => Math.round(v).toLocaleString() } },
      },
    },
  });

  // Financials Over Time
  new Chart(document.getElementById('financialChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Revenue',
          data: vals.map(v => v.revenue),
          borderColor: '#0ea5e9',
          backgroundColor: 'transparent',
          tension: 0.4, pointRadius: 2, borderWidth: 2, yAxisID: 'y',
        },
        {
          label: 'Profit',
          data: vals.map(v => v.profit),
          borderColor: '#10b981',
          backgroundColor: 'transparent',
          tension: 0.4, pointRadius: 2, borderWidth: 2, yAxisID: 'y',
        },
        {
          label: 'Margin %',
          data: vals.map(v => v.days ? (v.marginSum / v.days) * 100 : 0),
          borderColor: '#f59e0b',
          backgroundColor: 'transparent',
          tension: 0.4, pointRadius: 2, borderWidth: 2, yAxisID: 'y1',
          borderDash: [4, 3],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: { boxWidth: 12, padding: 10, font: { size: 10 } },
        },
        tooltip: {
          backgroundColor: '#1e293b',
          borderColor: '#334155',
          borderWidth: 1,
          callbacks: {
            label: ctx => {
              if (ctx.dataset.yAxisID === 'y1') return ` Margin: ${ctx.raw.toFixed(1)}%`;
              return ` ${ctx.dataset.label}: ${fmt(ctx.raw)}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
        y: { grid: { color: '#1e3a5f' }, position: 'left', ticks: { callback: v => fmt(v) } },
        y1: { position: 'right', grid: { display: false }, ticks: { callback: v => v.toFixed(1) + '%' } },
      },
    },
  });
}

// ── Advanced Insights ─────────────────────────────────────────────────────────

function renderInsights(data) {
  const lastDate = data[data.length - 1]?.DATE;
  const d7 = lastNDays(data, 7, lastDate);
  const d14 = lastNDays(data, 14, lastDate);
  const d30 = lastNDays(data, 30, lastDate);

  const avg7Rev = avgField(d7, 'NET_GROSS_SALES');
  const avg30Rev = avgField(d30, 'NET_GROSS_SALES');
  const avg14Margin = avgField(d14, 'NET_MARGIN_PCT');
  const avg30Margin = avgField(d30, 'NET_MARGIN_PCT');

  const insights = [];

  if (avg7Rev > avg30Rev * 1.5) {
    insights.push({
      type: 'surge',
      icon: '⚡',
      title: 'Sales Surge Detected',
      desc: `7-day avg revenue (${fmt(avg7Rev)}/day) is ${((avg7Rev / avg30Rev - 1) * 100).toFixed(0)}% above the 30-day avg (${fmt(avg30Rev)}/day).`,
    });
  }

  if (avg7Rev < avg30Rev * 0.6) {
    insights.push({
      type: 'warning',
      icon: '⚠️',
      title: 'Sales Drop Alert',
      desc: `7-day avg revenue (${fmt(avg7Rev)}/day) is ${((1 - avg7Rev / avg30Rev) * 100).toFixed(0)}% below the 30-day avg (${fmt(avg30Rev)}/day).`,
    });
  }

  if (avg30Margin && (avg30Margin - avg14Margin) / Math.abs(avg30Margin) > 0.05) {
    insights.push({
      type: 'caution',
      icon: '📉',
      title: 'Margin Compression',
      desc: `14-day avg margin (${fmt(avg14Margin, 'pct')}) is more than 5% below the 30-day avg (${fmt(avg30Margin, 'pct')}).`,
    });
  }

  const container = document.getElementById('insights');

  if (!insights.length) {
    container.innerHTML = `
      <div class="flex items-center gap-3 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
        <span class="text-xl">✅</span>
        <div>
          <div class="text-sm font-medium text-emerald-400">All Systems Normal</div>
          <div class="text-xs text-slate-400 mt-0.5">No anomalies detected in current performance metrics.</div>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = insights.map(ins => `
    <div class="flex items-start gap-3 p-4 rounded-lg insight-${ins.type}">
      <span class="text-xl mt-0.5">${ins.icon}</span>
      <div>
        <div class="text-sm font-semibold ${ins.type === 'surge' ? 'text-emerald-400' : ins.type === 'warning' ? 'text-red-400' : 'text-amber-400'}">${ins.title}</div>
        <div class="text-xs text-slate-400 mt-1">${ins.desc}</div>
      </div>
    </div>
  `).join('');
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  try {
    const res = await fetch('/api/daily');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!Array.isArray(data) || !data.length) {
      throw new Error('No data returned from API');
    }

    // Update loading badge
    const badge = document.getElementById('loadingBadge');
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400"></span> ${data.length} days loaded`;
    badge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs';

    // Last updated
    const lastDate = data[data.length - 1]?.DATE;
    document.getElementById('lastUpdated').textContent = `Last data: ${lastDate || 'unknown'}`;

    renderKPIs(data);
    renderTimeComparisons(data);
    renderCharts(data);
    renderInsights(data);

  } catch (err) {
    console.error(err);
    const badge = document.getElementById('loadingBadge');
    badge.innerHTML = `⚠ Error loading data`;
    badge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-xs';

    document.getElementById('kpiSection').innerHTML = `
      <div class="col-span-4 p-6 text-center text-red-400 text-sm">
        Failed to load data: ${err.message}
      </div>
    `;
  }
}

main();
