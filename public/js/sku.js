// ── Products Page ─────────────────────────────────────────────────────────────

function renderProductsPage() {
  renderSKUTable(getSku(), S.sku);
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

// ── Compute per-SKU metrics ───────────────────────────────────────────────────

function computeSku(filteredRows, fullRows, f) {
  const rev       = sum(filteredRows, f.rev);
  const profit    = sum(filteredRows, f.profit);
  const orders    = sum(filteredRows, f.orders);
  const marginAmt = sum(filteredRows, f.margin);

  let mPct = null;
  if (f.mPct) {
    mPct = avg(filteredRows, f.mPct);
  } else {
    mPct = rev !== 0 ? profit / rev : null;
  }

  // Return rate: always based on full rows
  const full30 = skuLastN(fullRows, 30);
  const rr30   = full30.length   ? Math.abs(sum(full30, 'REFUND_QUANTITY'))   / (sum(full30, 'ORDER_QUANTITY')   || 1) : null;
  const rrAll  = fullRows.length ? Math.abs(sum(fullRows, 'REFUND_QUANTITY')) / (sum(fullRows, 'ORDER_QUANTITY') || 1) : null;

  let retAlert = null;
  if (rr30 !== null) {
    if (rrAll !== null && rr30 > rrAll * 1.5) retAlert = 'danger';
    else if (rr30 > 0.10)                     retAlert = 'warn';
  }

  // Rolling (7/14/30d) — always full rows
  // badge: daily avg vs full-period daily avg; sort: period total
  const fd      = fullRows.length || 1;
  const baseRev  = sum(fullRows, 'NET_GROSS_SALES') / fd;
  const baseProf = sum(fullRows, 'NET_PROFIT')      / fd;
  const baseOrd  = sum(fullRows, 'NET_QUANTITY')    / fd;
  const baseMarg = sum(fullRows, 'NET_MARGIN')      / fd;

  const rolling = [7, 14, 30].map(n => {
    const p  = skuLastN(fullRows, n);
    const pd = p.length || 1;
    return {
      n,
      // Daily averages → used for % badges
      revP:  sum(p, 'NET_GROSS_SALES') / pd,  revA:  baseRev,
      profP: sum(p, 'NET_PROFIT')      / pd,  profA: baseProf,
      ordP:  sum(p, 'NET_QUANTITY')    / pd,  ordA:  baseOrd,
      margP: sum(p, 'NET_MARGIN')      / pd,  margA: baseMarg,
      // Period totals → used for absolute-value sort
      revTotal:  sum(p, 'NET_GROSS_SALES'),
      profTotal: sum(p, 'NET_PROFIT'),
      ordTotal:  sum(p, 'NET_QUANTITY'),
      margTotal: sum(p, 'NET_MARGIN'),
      rrP: p.length ? Math.abs(sum(p, 'REFUND_QUANTITY')) / (sum(p, 'ORDER_QUANTITY') || 1) : null,
      rrA: rrAll,
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

// ── Render Table ──────────────────────────────────────────────────────────────

function renderSKUTable(filteredData, fullData) {
  const f      = fields(S.mode);
  const metric = (document.getElementById('sortMetric') || {}).value || 'revenue';
  const period = (document.getElementById('sortPeriod') || {}).value || 'total';
  const dir    = (document.getElementById('sortDir')    || {}).value || 'desc';
  const topN   = parseInt(document.getElementById('topSel').value);

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

  const skus = Object.values(fMap).map(({ sku, desc, rows }) => ({
    sku, desc, ...computeSku(rows, fullMap[sku] || [], f),
  }));

  // Sort: use PERIOD TOTALS for rolling (absolute value), not daily avg
  function getSortVal(s) {
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
  skus.sort((a, b) => {
    const diff = getSortVal(b) - getSortVal(a);
    return dir === 'asc' ? -diff : diff;
  });

  const visible = skus.slice(0, topN);

  document.getElementById('returnHeader').style.display = f.showRet ? '' : 'none';

  const tbody = document.getElementById('skuBody');
  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text3);">No data for selected period</td></tr>`;
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
      </td>` : '<td></td>';

    return `
      <tr>
        <td style="text-align:left;vertical-align:top;">
          <div style="display:flex;align-items:flex-start;gap:8px;">
            <span style="font-size:11px;color:var(--text3);min-width:18px;padding-top:3px;">${i + 1}</span>
            <div>
              <div style="font-weight:700;color:var(--text);font-size:14px;">${s.sku}</div>
              ${s.desc ? `<div style="font-size:11px;color:var(--text3);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${s.desc}">${s.desc}</div>` : ''}
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
      </tr>`;
  }).join('');
}
