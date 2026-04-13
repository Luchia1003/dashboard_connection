// ── State ─────────────────────────────────────────────────────────────────────

let rawData = [];
let metricMode = 'net'; // 'net' | 'order' | 'refund'

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function sumField(rows, field) {
  return rows.reduce((acc, r) => acc + (r[field] || 0), 0);
}

function avgField(rows, field) {
  if (!rows.length) return 0;
  return sumField(rows, field) / rows.length;
}

function lastNDaysForSku(skuRows, n) {
  if (!skuRows.length) return [];
  const sorted = [...skuRows].sort((a, b) => new Date(b.DATE) - new Date(a.DATE));
  const lastDate = new Date(sorted[0].DATE).getTime();
  return skuRows.filter(r => {
    const ms = new Date(r.DATE).getTime();
    return ms <= lastDate && ms > lastDate - n * 86400000;
  });
}

// ── Field maps by mode ────────────────────────────────────────────────────────

function getFields(mode) {
  if (mode === 'net') return {
    revenue: 'NET_GROSS_SALES',
    profit: 'NET_PROFIT',
    orders: 'NET_ORDER_COUNT',
    margin: 'NET_MARGIN_PCT',
    productSales: 'NET_PRODUCT_SALES',
    showMargin: true,
    showReturn: true,
  };
  if (mode === 'order') return {
    revenue: 'ORDER_GROSS_SALES',
    profit: 'ORDER_PROFIT',
    orders: 'ORDER_COUNT',
    margin: null, // calculated
    productSales: 'NET_PRODUCT_SALES',
    showMargin: true,
    showReturn: false,
  };
  if (mode === 'refund') return {
    revenue: 'REFUND_GROSS_SALES',
    profit: 'REFUND_PROFIT',
    orders: 'REFUND_COUNT',
    margin: null,
    productSales: 'NET_PRODUCT_SALES',
    showMargin: false,
    showReturn: false,
  };
}

// ── Aggregate SKU rows ────────────────────────────────────────────────────────

function aggregateSkus(data) {
  const map = {};

  data.forEach(r => {
    const sku = r.SALES_SKU || 'UNKNOWN';
    if (!map[sku]) {
      map[sku] = {
        sku,
        desc: r.DESCRIPTION || '',
        rows: [],
      };
    }
    map[sku].rows.push(r);
  });

  return Object.values(map);
}

function computeSkuMetrics(skuObj, fields) {
  const { rows, sku, desc } = skuObj;

  const revenue = sumField(rows, fields.revenue);
  const profit = sumField(rows, fields.profit);
  const orders = sumField(rows, fields.orders);

  let margin = null;
  if (fields.showMargin) {
    if (fields.margin) {
      margin = avgField(rows, fields.margin);
    } else {
      const grossSales = sumField(rows, fields.revenue);
      margin = grossSales !== 0 ? profit / grossSales : null;
    }
  }

  // Return rate: 30-day window from last date in skuRows
  const last30 = lastNDaysForSku(rows, 30);
  const returnRate30 = last30.length
    ? (Math.abs(sumField(last30, 'REFUND_QUANTITY')) / (sumField(last30, 'ORDER_QUANTITY') || 1))
    : null;

  const allReturnRate = rows.length
    ? Math.abs(sumField(rows, 'REFUND_QUANTITY')) / (sumField(rows, 'ORDER_QUANTITY') || 1)
    : null;

  // Return rate warnings
  let returnAlert = null;
  if (returnRate30 !== null) {
    if (returnRate30 > 0.10) returnAlert = 'warn';
    if (allReturnRate !== null && returnRate30 > allReturnRate * 1.5) returnAlert = 'danger';
  }

  // Rolling comparisons (7d / 14d / 30d vs all-time avg)
  const rolling = [7, 14, 30].map(n => {
    const period = lastNDaysForSku(rows, n);
    const periodDays = period.length || 1;
    const allDays = rows.length || 1;

    const ordersAvg = sumField(rows, 'NET_ORDER_COUNT') / allDays;
    const ordersP = sumField(period, 'NET_ORDER_COUNT') / periodDays;

    const revenueAvg = sumField(rows, 'NET_GROSS_SALES') / allDays;
    const revenueP = sumField(period, 'NET_GROSS_SALES') / periodDays;

    const profitAvg = sumField(rows, 'NET_PROFIT') / allDays;
    const profitP = sumField(period, 'NET_PROFIT') / periodDays;

    const rrAvg = allReturnRate;
    const rrP = period.length
      ? Math.abs(sumField(period, 'REFUND_QUANTITY')) / (sumField(period, 'ORDER_QUANTITY') || 1)
      : null;

    return { n, ordersP, ordersAvg, revenueP, revenueAvg, profitP, profitAvg, rrP, rrAvg };
  });

  return { sku, desc, revenue, profit, orders, margin, returnRate30, returnAlert, rolling, rows };
}

function diffBadge(current, base) {
  if (base === 0 || base == null) return '<span class="badge-neutral text-[10px] px-1.5 py-0.5 rounded-full">—</span>';
  const d = (current - base) / Math.abs(base);
  const isUp = d >= 0;
  const cls = isUp ? 'badge-up' : 'badge-down';
  const arrow = isUp ? '↑' : '↓';
  return `<span class="${cls} text-[10px] px-1.5 py-0.5 rounded-full">${arrow} ${Math.abs(d * 100).toFixed(0)}%</span>`;
}

// ── Render Table ──────────────────────────────────────────────────────────────

function renderTable() {
  const fields = getFields(metricMode);
  const sortBy = document.getElementById('sortSelect').value;
  const topN = parseInt(document.getElementById('topSelect').value);
  const dateFrom = document.getElementById('dateFrom').value;
  const dateTo = document.getElementById('dateTo').value;

  // Filter by date range
  let filtered = rawData;
  if (dateFrom) filtered = filtered.filter(r => r.DATE >= dateFrom);
  if (dateTo) filtered = filtered.filter(r => r.DATE <= dateTo);

  // Aggregate per SKU
  const skus = aggregateSkus(filtered).map(s => computeSkuMetrics(s, fields));

  // Sort
  const sortFn = {
    revenue: (a, b) => b.revenue - a.revenue,
    profit: (a, b) => b.profit - a.profit,
    orders: (a, b) => b.orders - a.orders,
    returnRate: (a, b) => (b.returnRate30 || 0) - (a.returnRate30 || 0),
  };
  skus.sort(sortFn[sortBy] || sortFn.revenue);

  const visible = skus.slice(0, topN);

  // Header adjustments
  document.getElementById('marginHeader').style.display = fields.showMargin ? '' : 'none';
  document.getElementById('returnHeader').style.display = fields.showReturn ? '' : 'none';

  const tbody = document.getElementById('skuTableBody');

  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-500 text-sm">No SKU data found for selected filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = visible.map((s, i) => {
    const rollingHtml = s.rolling.map(r => `
      <div class="text-[10px] text-slate-500 flex items-center gap-1">
        <span class="font-medium text-slate-300">${r.n}d</span>
        ${diffBadge(r.revenueP, r.revenueAvg)}
      </div>
    `).join('');

    const returnCell = fields.showReturn
      ? `<td class="px-4 py-3 text-right">
          <div class="flex items-center justify-end gap-1.5">
            <span class="text-sm ${s.returnAlert === 'danger' ? 'text-red-400' : s.returnAlert === 'warn' ? 'text-amber-400' : 'text-slate-300'}">
              ${s.returnRate30 !== null ? fmt(s.returnRate30, 'pct') : '—'}
            </span>
            ${s.returnAlert === 'danger' ? '<span class="badge-danger text-[10px] px-1.5 py-0.5 rounded-full">⚠ Abnormal</span>' : ''}
            ${s.returnAlert === 'warn' && !s.returnAlert === 'danger' ? '<span class="badge-warn text-[10px] px-1.5 py-0.5 rounded-full">! High</span>' : ''}
          </div>
        </td>`
      : '';

    const marginCell = fields.showMargin
      ? `<td class="px-4 py-3 text-right text-sm ${s.margin !== null && s.margin < 0 ? 'text-red-400' : 'text-slate-300'}">${s.margin !== null ? fmt(s.margin, 'pct') : '—'}</td>`
      : '';

    return `
      <tr class="border-b border-[#1e3048] cursor-pointer">
        <td class="px-4 py-3">
          <div class="flex items-start gap-2">
            <span class="text-xs font-medium text-slate-500 w-5 shrink-0">${i + 1}</span>
            <div>
              <div class="text-sm font-semibold text-white">${s.sku}</div>
              ${s.desc ? `<div class="text-xs text-slate-500 truncate max-w-[200px]" title="${s.desc}">${s.desc}</div>` : ''}
            </div>
          </div>
        </td>
        <td class="px-4 py-3 text-right text-sm font-medium text-white">${fmt(s.revenue)}</td>
        <td class="px-4 py-3 text-right text-sm ${s.profit < 0 ? 'text-red-400' : 'text-emerald-400'}">${fmt(s.profit)}</td>
        <td class="px-4 py-3 text-right text-sm text-slate-300">${fmt(s.orders, 'int')}</td>
        ${marginCell}
        ${returnCell}
        <td class="px-4 py-3 text-right">
          <div class="flex flex-col items-end gap-1">${rollingHtml}</div>
        </td>
      </tr>
    `;
  }).join('');
}

// ── Controls ──────────────────────────────────────────────────────────────────

function setMetricMode(mode, btn) {
  metricMode = mode;
  document.querySelectorAll('.toggle-btn').forEach(b => {
    b.classList.remove('active');
    b.classList.add('text-slate-400');
  });
  btn.classList.add('active');
  btn.classList.remove('text-slate-400');
  renderTable();
}

function clearDates() {
  document.getElementById('dateFrom').value = '';
  document.getElementById('dateTo').value = '';
  renderTable();
}

document.getElementById('sortSelect').addEventListener('change', renderTable);
document.getElementById('topSelect').addEventListener('change', renderTable);
document.getElementById('dateFrom').addEventListener('change', renderTable);
document.getElementById('dateTo').addEventListener('change', renderTable);

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  try {
    const res = await fetch('/api/sku');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rawData = await res.json();

    if (!Array.isArray(rawData) || !rawData.length) throw new Error('No data');

    // Set date range defaults from data
    const dates = rawData.map(r => r.DATE).sort();
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value = '';
    document.getElementById('lastUpdated').textContent = `Last data: ${dates[dates.length - 1]}`;

    const badge = document.getElementById('loadingBadge');
    const skuCount = new Set(rawData.map(r => r.SALES_SKU)).size;
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400"></span> ${skuCount} SKUs · ${rawData.length} records`;
    badge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs';

    renderTable();

  } catch (err) {
    console.error(err);
    const badge = document.getElementById('loadingBadge');
    badge.innerHTML = `⚠ Error loading data`;
    badge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 text-xs';

    document.getElementById('skuTableBody').innerHTML = `
      <tr><td colspan="7" class="p-8 text-center text-red-400 text-sm">Failed to load data: ${err.message}</td></tr>
    `;
  }
}

main();
