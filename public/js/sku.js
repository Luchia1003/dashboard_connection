// ── Products Page ─────────────────────────────────────────────────────────────

function renderProductsPage() {
  renderSKUTable(getSku(), getSkuFull());
  if (typeof updateDownloadHints === 'function') updateDownloadHints();
}
window.renderProductsPage = renderProductsPage;

// ── Field maps ────────────────────────────────────────────────────────────────

function fields(mode) {
  return {
    net:    { rev: 'NET_GROSS_SALES',    profit: 'NET_PROFIT',    orders: 'NET_QUANTITY',    margin: 'NET_MARGIN',    mPct: 'NET_MARGIN_PCT', showRet: true  },
    order:  { rev: 'ORDER_GROSS_SALES',  profit: 'ORDER_PROFIT',  orders: 'ORDER_QUANTITY',  margin: 'ORDER_MARGIN',  mPct: null,             showRet: false },
    refund: { rev: 'REFUND_GROSS_SALES', profit: 'REFUND_PROFIT', orders: 'REFUND_QUANTITY', margin: 'REFUND_MARGIN', mPct: null,             showRet: false },
  }[mode] || {};
}

// ── Rolling helpers (always full SKU rows) ────────────────────────────────────

function skuLastN(rows, n) {
  if (!rows.length) return [];
  const last = rows.reduce((m, r) => r.DATE > m ? r.DATE : m, '');
  const ms = new Date(last).getTime();
  return rows.filter(r => { const t = new Date(r.DATE).getTime(); return t <= ms && t > ms - n * 86400000; });
}

// Previous N days starting offset days before the latest date (mirrors daily.js prevN)
function skuPrevN(rows, n, offset) {
  if (!rows.length) return [];
  const last = rows.reduce((m, r) => r.DATE > m ? r.DATE : m, '');
  const end = new Date(last).getTime() - offset * 86400000;
  return rows.filter(r => { const t = new Date(r.DATE).getTime(); return t <= end && t > end - n * 86400000; });
}

// ── Compute per-SKU metrics ───────────────────────────────────────────────────

function computeSku(filteredRows, fullRows, f) {
  const rev       = sum(filteredRows, f.rev);
  const profit    = sum(filteredRows, f.profit);
  const orders    = sum(filteredRows, f.orders);
  const marginAmt = sum(filteredRows, f.margin);

  // Weighted margin %: sum(margin $) / sum(gross $) in EVERY mode — same
  // metric under the Margin column whether Net / Order / Refund is selected.
  // (NOT an average of per-day pct rows — a $10 day must not weigh like a
  // $10k day — and not profit/rev, which is a different metric.)
  const mPct = rev !== 0 ? marginAmt / rev : null;

  // Return rate: always based on full rows
  const full30 = skuLastN(fullRows, 30);
  const rr30   = full30.length   ? Math.abs(sum(full30, 'REFUND_QUANTITY'))   / (sum(full30, 'ORDER_QUANTITY')   || 1) : null;
  const rrAll  = fullRows.length ? Math.abs(sum(fullRows, 'REFUND_QUANTITY')) / (sum(fullRows, 'ORDER_QUANTITY') || 1) : null;

  let retAlert = null;
  if (rr30 !== null) {
    if (rrAll !== null && rr30 > rrAll * 1.5) retAlert = 'danger';
    else if (rr30 > 0.10)                     retAlert = 'warn';
  }

  // Rolling — mirrors Time Comparisons baseline logic:
  //   7d  vs prev 30d avg  (30 days before the last 7 days)
  //   14d vs prev 30d avg  (30 days before the last 14 days)
  //   30d vs prev 60d avg  (60 days before the last 30 days)
  const WINDOWS = [
    { n: 7,  baseN: 30, offset: 7  },
    { n: 14, baseN: 30, offset: 14 },
    { n: 30, baseN: 60, offset: 30 },
  ];

  function davg(rows, f) { return rows.length ? sum(rows, f) / rows.length : 0; }

  const rolling = WINDOWS.map(({ n, baseN, offset }) => {
    const cur  = skuLastN(fullRows, n);
    const base = skuPrevN(fullRows, baseN, offset);
    return {
      n,
      revP:  davg(cur,  'NET_GROSS_SALES'), revA:  davg(base, 'NET_GROSS_SALES'),
      profP: davg(cur,  'NET_PROFIT'),      profA: davg(base, 'NET_PROFIT'),
      ordP:  davg(cur,  'NET_QUANTITY'),    ordA:  davg(base, 'NET_QUANTITY'),
      margP: davg(cur,  'NET_MARGIN'),      margA: davg(base, 'NET_MARGIN'),
      rrP:   cur.length  ? Math.abs(sum(cur,  'REFUND_QUANTITY')) / (sum(cur,  'ORDER_QUANTITY') || 1) : null,
      rrA:   base.length ? Math.abs(sum(base, 'REFUND_QUANTITY')) / (sum(base, 'ORDER_QUANTITY') || 1) : null,
    };
  });

  return { rev, profit, orders, marginAmt, mPct, rr30, retAlert, rolling };
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function badge(cur, base) {
  if (base == null || base === 0)
    return `<span class="badge-neu" style="font-size:10px;padding:1px 5px;border-radius:20px;">—</span>`;
  const d   = (cur - base) / Math.abs(base);
  const cls = d >= 0 ? 'badge-up' : 'badge-down';
  return `<span class="${cls}" style="font-size:10px;padding:1px 5px;border-radius:20px;">${d >= 0 ? '↑' : '↓'}${Math.abs(d * 100).toFixed(0)}%</span>`;
}

// ── Rolling badges column (to the LEFT of the main value) ────────────────────

function rollingStack(rolling, pKey, aKey) {
  return `<div style="display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-start;gap:3px;padding-top:2px;">
    ${rolling.map(r => `
      <div style="display:flex;align-items:center;gap:2px;">
        <span style="font-size:10px;color:var(--text3);min-width:20px;text-align:right;">${r.n}d</span>
        ${badge(r[pKey], r[aKey])}
      </div>`).join('')}
  </div>`;
}

// ── Exact-number formatter (no K/M) ──────────────────────────────────────────

function fmtExact(v, type) {
  if (v == null || isNaN(v)) return '—';
  if (type === 'int') return Math.round(v).toLocaleString('en-US');
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1) return s + '$' + Math.round(a).toLocaleString('en-US');
  return s + '$' + a.toFixed(2);
}

// ── SKU Search clear helper ───────────────────────────────────────────────────

// Toggle the custom-N input when "Custom…" is picked, then re-render.
function onTopChange() {
  const sel = document.getElementById('topSel');
  const inp = document.getElementById('topCustom');
  if (inp) inp.style.display = (sel && sel.value === 'custom') ? '' : 'none';
  if (sel && sel.value === 'custom' && inp && !inp.value) { inp.focus(); return; }
  renderProductsPage();
}
window.onTopChange = onTopChange;

function clearSkuSearch() {
  const inp = document.getElementById('skuSearch');
  if (inp) { inp.value = ''; }
  document.getElementById('skuSearchClear').style.display = 'none';
  renderProductsPage();
}
window.clearSkuSearch = clearSkuSearch;

// ── Render Table ──────────────────────────────────────────────────────────────

// Resolve the "Show" control to a row limit (Infinity for All / blank custom).
function getTopN() {
  const topRaw = (document.getElementById('topSel') || {}).value || '100';
  if (topRaw === 'all') return Infinity;
  if (topRaw === 'custom') {
    const c = parseInt((document.getElementById('topCustom') || {}).value, 10);
    return (c && c > 0) ? c : Infinity;
  }
  return parseInt(topRaw, 10) || 100;
}
window.getTopN = getTopN;

// Group → compute → search-filter → sort → limit. Shared by the table render
// and the CSV export so both show exactly the same SKUs.
function selectSkus(filteredData, fullData) {
  const f      = fields(S.mode);
  const period = (document.getElementById('sortPeriod') || {}).value || 'total';
  const topN   = getTopN();

  const searchRaw = (document.getElementById('skuSearch') || {}).value || '';
  const query = searchRaw.trim().toLowerCase();

  // Group filtered rows by SKU
  const fMap = {};
  filteredData.forEach(r => {
    const k = r.SALES_SKU || 'UNKNOWN';
    if (!fMap[k]) fMap[k] = { sku: k, desc: r.DESCRIPTION || '', rows: [] };
    fMap[k].rows.push(r);
  });

  // Group full rows by SKU
  const fullMap = {};
  fullData.forEach(r => {
    const k = r.SALES_SKU || 'UNKNOWN';
    if (!fullMap[k]) fullMap[k] = [];
    fullMap[k].push(r);
  });

  let skus = Object.values(fMap).map(({ sku, desc, rows }) => ({
    sku, desc, ...computeSku(rows, fullMap[sku] || [], f),
  }));

  if (query) {
    skus = skus.filter(s =>
      s.sku.toLowerCase().includes(query) ||
      s.desc.toLowerCase().includes(query)
    );
  }

  // Sort (click-to-sort headers): use PERIOD TOTALS for rolling (absolute
  // value), not daily avg. The "Sort basis" dropdown picks Value vs Rolling %.
  function getSortVal(s, metric) {
    if (metric === 'sku') return s.sku.toLowerCase();
    // Inventory is a current snapshot — no rolling concept, sort by total stock
    // under the active platform view regardless of the period selector.
    if (metric === 'inventory') {
      const inv = (typeof inventoryForView === 'function') ? inventoryForView(s.sku, S.platform) : { found: false };
      // Large finite sentinel, not -Infinity: (-Inf) - (-Inf) = NaN breaks the
      // comparator for pairs of no-inventory SKUs (inconsistent ordering).
      return inv.found ? inv.total : -1e15;
    }
    if (period === 'total') {
      return { revenue: s.rev, profit: s.profit, orders: s.orders, margin: s.marginAmt, returnRate: s.rr30 || 0 }[metric] ?? 0;
    }
    const n    = parseInt(period);
    const ri   = n === 7 ? 0 : n === 14 ? 1 : 2;
    const r    = s.rolling[ri] || s.rolling[0];
    // Sort by the badge percentage: (rolling daily avg − baseline) / |baseline|
    const pKey = { revenue: 'revP', profit: 'profP', orders: 'ordP', margin: 'margP', returnRate: 'rrP' }[metric];
    const aKey = { revenue: 'revA', profit: 'profA', orders: 'ordA', margin: 'margA', returnRate: 'rrA' }[metric];
    const base = r[aKey];
    return (base && base !== 0) ? (r[pKey] - base) / Math.abs(base) : 0;
  }
  const PD_FNS = {};
  ['sku', 'revenue', 'profit', 'orders', 'margin', 'returnRate', 'inventory']
    .forEach(m => { PD_FNS[m] = s => getSortVal(s, m); });
  skus = hdrSortRows(skus, 'pd', PD_FNS);

  // Search shows every match; otherwise cap at the Show limit.
  const visible = query ? skus : skus.slice(0, topN);
  return { f, query, searchRaw, visible };
}
window.selectSkus = selectSkus;

function renderSKUTable(filteredData, fullData) {
  const { f, query, searchRaw, visible } = selectSkus(filteredData, fullData);

  const clearBtn = document.getElementById('skuSearchClear');
  if (clearBtn) clearBtn.style.display = query ? '' : 'none';

  // Header (click-to-sort). Return Rate column only exists in Net mode.
  document.getElementById('skuHead').innerHTML = `
    <tr>
      ${hdrTh('pd', 'sku', '# SKU / Product', { align: 'left', min: '220px' })}
      ${hdrTh('pd', 'revenue', 'Revenue', { min: '140px' })}
      ${hdrTh('pd', 'profit', 'Profit', { min: '140px' })}
      ${hdrTh('pd', 'orders', 'Qty', { min: '120px' })}
      ${hdrTh('pd', 'margin', 'Margin <span style="font-size:10px;font-weight:400;color:var(--text3);white-space:nowrap;">(% = margin ÷ revenue)</span>', { min: '150px' })}
      ${f.showRet ? hdrTh('pd', 'returnRate', 'Return Rate', { min: '110px' }) : ''}
      ${hdrTh('pd', 'inventory', 'Inventory', { min: '120px' })}
    </tr>`;

  const tbody = document.getElementById('skuBody');
  if (!visible.length) {
    const msg = query ? `No SKUs matching "${searchRaw}"` : 'No data for selected period';
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text3);">${msg}</td></tr>`;
    return;
  }

  const VAL = 'font-size:16px;font-weight:700;';

  tbody.innerHTML = visible.map((s, i) => {
    const retCell = f.showRet ? `
      <td style="text-align:right;vertical-align:top;">
        <div style="${VAL}color:${s.retAlert === 'danger' ? '#ef4444' : s.retAlert === 'warn' ? '#f59e0b' : 'var(--text)'};">
          ${s.rr30 !== null ? fmt(s.rr30, 'pct') : '—'}
        </div>
        ${s.retAlert === 'danger' ? `<div style="margin-top:4px;"><span class="badge-down" style="font-size:9px;padding:1px 5px;border-radius:10px;">⚠ Abnormal</span></div>` : ''}
        ${s.retAlert === 'warn'   ? `<div style="margin-top:4px;"><span class="badge-surge" style="font-size:9px;padding:1px 5px;border-radius:10px;">High</span></div>` : ''}
      </td>` : '';  // emit no cell when hidden — the header th is likewise
                    // omitted in Order/Refund mode, keeping columns aligned

    // Inventory — current snapshot per the active platform view (not time-range
    // dependent). Amazon / All show an FBA · warehouse split underneath.
    const inv = (typeof inventoryForView === 'function')
      ? inventoryForView(s.sku, S.platform) : { found: false };
    const invCell = `
      <td style="text-align:right;vertical-align:top;">
        ${inv.found
          ? `<div style="${VAL}color:var(--text);">${Math.round(inv.total).toLocaleString()}</div>
             ${inv.split ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;white-space:nowrap;">FBA ${Math.round(inv.fba).toLocaleString()} · Whse ${Math.round(inv.hnp).toLocaleString()}</div>` : ''}`
          : `<div style="${VAL}color:var(--text3);">—</div>`}
      </td>`;

    return `
      <tr>
        <td style="text-align:left;vertical-align:top;">
          <div style="display:flex;align-items:flex-start;gap:8px;">
            <span style="font-size:11px;color:var(--text3);min-width:18px;padding-top:3px;">${i + 1}</span>
            <div>
              <div style="font-weight:700;color:var(--text);font-size:14px;">${s.sku}</div>
              ${s.desc ? `<div style="font-size:11px;color:var(--text3);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(s.desc)}">${escHtml(s.desc)}</div>` : ''}
            </div>
          </div>
        </td>
        <td style="vertical-align:top;">
          <div style="display:flex;align-items:flex-start;justify-content:flex-end;gap:8px;">
            ${rollingStack(s.rolling, 'revP', 'revA')}
            <div style="${VAL}color:var(--text);min-width:80px;text-align:right;">${fmtExact(s.rev)}</div>
          </div>
        </td>
        <td style="vertical-align:top;">
          <div style="display:flex;align-items:flex-start;justify-content:flex-end;gap:8px;">
            ${rollingStack(s.rolling, 'profP', 'profA')}
            <div style="${VAL}color:${s.profit < 0 ? '#ef4444' : '#10b981'};min-width:80px;text-align:right;">${fmtExact(s.profit)}</div>
          </div>
        </td>
        <td style="vertical-align:top;">
          <div style="display:flex;align-items:flex-start;justify-content:flex-end;gap:8px;">
            ${rollingStack(s.rolling, 'ordP', 'ordA')}
            <div style="${VAL}color:var(--text);min-width:60px;text-align:right;">${fmtExact(s.orders, 'int')}</div>
          </div>
        </td>
        <td style="vertical-align:top;">
          <div style="display:flex;align-items:flex-start;justify-content:flex-end;gap:8px;">
            ${rollingStack(s.rolling, 'margP', 'margA')}
            <div style="text-align:right;min-width:80px;">
              <div style="${VAL}color:${s.marginAmt < 0 ? '#ef4444' : 'var(--text)'};">${fmtExact(s.marginAmt)}</div>
              ${s.mPct !== null ? `<div style="font-size:12px;color:var(--text3);margin-top:1px;">${fmt(s.mPct, 'pct')}</div>` : ''}
            </div>
          </div>
        </td>
        ${retCell}
        ${invCell}
      </tr>`;
  }).join('');
}
