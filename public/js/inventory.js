// ── Inventory Page ────────────────────────────────────────────────────────────
// Two sub-views:
//   1) Forecast (INVENTORY_FORECAST)   — per (SKU, channel) with restock recommendations
//   2) FBA Slow Traffic (FBA_AGING_INVENTORY) — FBA SKUs with no orders in > 60 days

// ── Lazy load both datasets ──────────────────────────────────────────────────

async function loadInventoryData() {
  if (S.inventoryForecast && S.fbaAging) {
    renderInventoryPage();
    return;
  }

  document.getElementById('inventoryHead').innerHTML = '';
  document.getElementById('inventoryBody').innerHTML =
    `<tr><td colspan="16" style="text-align:center;padding:48px;color:var(--text3);">
       <div style="display:inline-block;width:28px;height:28px;border:2px solid var(--border);border-top-color:#0ea5e9;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:10px;"></div>
       <div>Loading inventory data…</div>
     </td></tr>`;

  try {
    const [fr, ar] = await Promise.all([
      fetch('/api/inventory-forecast'),
      fetch('/api/fba-aging'),
    ]);
    if (fr.status === 401 || ar.status === 401) { window.location.href = '/login.html'; return; }
    if (!fr.ok) throw new Error(`Inventory Forecast API: HTTP ${fr.status}`);
    if (!ar.ok) throw new Error(`FBA Aging API: HTTP ${ar.status}`);

    S.inventoryForecast = await fr.json();
    S.fbaAging          = await ar.json();

    renderInventoryPage();
  } catch (err) {
    document.getElementById('inventoryBody').innerHTML =
      `<tr><td colspan="16" style="text-align:center;padding:40px;color:#ef4444;font-size:13px;">${err.message}</td></tr>`;
  }
}
window.loadInventoryData = loadInventoryData;

// ── View toggle ───────────────────────────────────────────────────────────────

function setInventoryView(view, btn) {
  S.inventoryView = view;
  document.querySelectorAll('#inventoryToggle .toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('forecastControls').style.display = view === 'forecast' ? 'flex' : 'none';
  document.getElementById('agingControls').style.display    = view === 'aging'    ? 'flex' : 'none';
  renderInventoryPage();
}
window.setInventoryView = setInventoryView;

// ── Main dispatcher ───────────────────────────────────────────────────────────

function renderInventoryPage() {
  if (!S.inventoryForecast || !S.fbaAging) { loadInventoryData(); return; }
  const view = S.inventoryView || 'forecast';
  if (view === 'forecast') renderForecastTable();
  else renderAgingTable();
}
window.renderInventoryPage = renderInventoryPage;

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtInt(v) {
  if (v == null || isNaN(v)) return '—';
  return Math.round(Number(v)).toLocaleString('en-US');
}

function fmtNum(v, digits = 1) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toFixed(digits);
}

function fmtDate(v) {
  if (!v) return '—';
  return String(v).slice(0, 10);
}

// Channel chip styling
function channelChip(ch) {
  const c = String(ch || '').toLowerCase();
  const label = {
    amazon_fba:    'Amazon FBA',
    amazon_nonfba: 'Amazon Non-FBA',
    shopify:       'Shopify',
    total:         'Total',
  }[c] || ch || '—';
  const color = {
    amazon_fba:    { fg: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
    amazon_nonfba: { fg: '#a16207', bg: 'rgba(161,98,7,.12)' },
    shopify:       { fg: '#10b981', bg: 'rgba(16,185,129,.12)' },
    total:         { fg: '#0ea5e9', bg: 'rgba(14,165,233,.12)' },
  }[c] || { fg: 'var(--text2)', bg: 'rgba(100,116,139,.12)' };
  return `<span style="font-size:11px;font-weight:600;color:${color.fg};background:${color.bg};padding:2px 8px;border-radius:6px;white-space:nowrap;">${label}</span>`;
}

function statusBadge(status) {
  const s = String(status || '');
  if (s === 'Out of Stock')    return `<span class="badge-down" style="font-size:10px;padding:2px 7px;border-radius:6px;font-weight:600;">${s}</span>`;
  if (s === 'Restock Needed')  return `<span class="badge-surge" style="font-size:10px;padding:2px 7px;border-radius:6px;font-weight:600;">${s}</span>`;
  if (s === 'Sufficient')      return `<span class="badge-up" style="font-size:10px;padding:2px 7px;border-radius:6px;font-weight:600;">${s}</span>`;
  return `<span class="badge-neu" style="font-size:10px;padding:2px 7px;border-radius:6px;">${s || '—'}</span>`;
}

function thresholdBadge(v) {
  const s = String(v || '');
  if (s === 'Y') return `<span class="badge-surge" style="font-size:10px;padding:2px 7px;border-radius:6px;font-weight:700;">Y</span>`;
  if (s === 'N') return `<span class="badge-neu"   style="font-size:10px;padding:2px 7px;border-radius:6px;font-weight:600;">N</span>`;
  return '—';
}

// Map review priority to a colored badge
function priorityBadge(p) {
  const s = String(p || '');
  if (!s) return '<span class="badge-neu" style="font-size:10px;padding:2px 7px;border-radius:6px;">—</span>';
  const cls =
    s.startsWith('1') ? 'badge-up'    :   // Warning  → green
    s.startsWith('2') ? 'badge-surge' :   // Review   → amber
    s.startsWith('3') ? 'badge-down'  :   // Discontinue Candidate → red
    s.startsWith('4') ? 'badge-down'  :   // Definitely Discontinue → red
    'badge-neu';
  return `<span class="${cls}" style="font-size:10px;padding:2px 7px;border-radius:6px;font-weight:600;white-space:nowrap;">${s}</span>`;
}

// ── Forecast Table ───────────────────────────────────────────────────────────

function renderForecastTable() {
  const channel  = (document.getElementById('forecastChannel') || {}).value || 'total';
  const status   = (document.getElementById('forecastStatus')  || {}).value || '';
  const sortBy   = (document.getElementById('forecastSort')    || {}).value || 'restock_needed';
  const sortDir  = (document.getElementById('forecastDir')     || {}).value || 'desc';
  const searchRaw = (document.getElementById('forecastSearch') || {}).value || '';
  const query    = searchRaw.trim().toLowerCase();

  const clrBtn = document.getElementById('forecastSearchClear');
  if (clrBtn) clrBtn.style.display = query ? '' : 'none';

  // Header
  document.getElementById('inventoryHead').innerHTML = `
    <tr>
      <th style="text-align:right;min-width:40px;width:40px;">#</th>
      <th style="text-align:left;min-width:200px;">SKU / Product</th>
      <th style="min-width:110px;">Channel</th>
      <th style="min-width:90px;">Available</th>
      <th style="min-width:110px;">Last Order</th>
      <th style="min-width:80px;">Days Since</th>
      <th style="min-width:80px;">Units 30d</th>
      <th style="min-width:80px;">Units 60d</th>
      <th style="min-width:80px;">Units 90d</th>
      <th style="min-width:80px;">ADU 30d</th>
      <th style="min-width:100px;">FC 60d</th>
      <th style="min-width:110px;">Restock Need</th>
      <th style="min-width:100px;">Profit / Unit</th>
      <th style="min-width:120px;">Est Restock Profit</th>
      <th style="min-width:90px;">Threshold</th>
      <th style="min-width:140px;">Status</th>
    </tr>`;

  // Filter by channel
  let rows = (S.inventoryForecast || []).filter(r => String(r.CHANNEL || '').toLowerCase() === channel);

  // Filter by status
  if (status === 'threshold') {
    rows = rows.filter(r => String(r.RESTOCK_THRESHOLD_MET || '') === 'Y');
  } else if (status) {
    rows = rows.filter(r => String(r.INVENTORY_STATUS || '') === status);
  }

  // Search
  if (query) {
    rows = rows.filter(r =>
      String(r.ORIGINAL_SKU  || '').toLowerCase().includes(query) ||
      String(r.PRODUCT_NAME  || '').toLowerCase().includes(query)
    );
  }

  const sortFn = {
    sku:                   r => String(r.ORIGINAL_SKU || ''),
    available:             r => Number(r.AVAILABLE)            || 0,
    days_since_last_order: r => Number(r.DAYS_SINCE_LAST_ORDER) || 0,
    units_30d:             r => Number(r.UNITS_30D)            || 0,
    units_60d:             r => Number(r.UNITS_60D)            || 0,
    units_90d:             r => Number(r.UNITS_90D)            || 0,
    adu_30d:               r => Number(r.ADU_30D)              || 0,
    forecast_60d:          r => Number(r.FORECAST_60D)         || 0,
    restock_needed:        r => Number(r.RESTOCK_NEEDED)       || 0,
    profit_per_unit:       r => Number(r.PROFIT_PER_UNIT)      || 0,
    est_restock_profit:    r => Number(r.EST_RESTOCK_PROFIT)   || 0,
  }[sortBy] || (r => Number(r.RESTOCK_NEEDED) || 0);

  rows.sort((a, b) => {
    const va = sortFn(a), vb = sortFn(b);
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  // Meta
  const meta = document.getElementById('inventoryMeta');
  if (meta) {
    const needCount = rows.filter(r => String(r.INVENTORY_STATUS) === 'Restock Needed' || String(r.INVENTORY_STATUS) === 'Out of Stock').length;
    meta.textContent = `${rows.length.toLocaleString()} rows · ${needCount.toLocaleString()} need restock`;
  }

  const tbody = document.getElementById('inventoryBody');
  if (!rows.length) {
    const msg = query ? `No SKUs matching "${searchRaw}"` : 'No inventory rows for this channel';
    tbody.innerHTML = `<tr><td colspan="16" style="text-align:center;padding:40px;color:var(--text3);">${msg}</td></tr>`;
    return;
  }

  const V = 'font-size:14px;font-weight:700;';
  tbody.innerHTML = rows.map((r, i) => {
    const avail        = Number(r.AVAILABLE)        || 0;
    const restockNeed  = Number(r.RESTOCK_NEEDED)   || 0;
    const fc60d        = Number(r.FORECAST_60D)     || 0;
    const adu30        = Number(r.ADU_30D)          || 0;
    const days         = Number(r.DAYS_SINCE_LAST_ORDER);
    const ppu          = r.PROFIT_PER_UNIT;
    const estProfit    = r.EST_RESTOCK_PROFIT;
    const ppuNum       = Number(ppu);
    const estNum       = Number(estProfit);
    const ppuMissing   = ppu == null || isNaN(ppuNum);
    const estMissing   = estProfit == null || isNaN(estNum);
    const availColor   = avail === 0 ? '#ef4444' : avail < fc60d ? '#f59e0b' : 'var(--text)';
    const needColor    = restockNeed > 0 ? '#ef4444' : 'var(--text3)';
    const daysColor    = days > 30 ? '#f59e0b' : 'var(--text2)';
    const ppuColor     = ppuMissing ? 'var(--text3)' : ppuNum < 0 ? '#ef4444' : ppuNum === 0 ? 'var(--text3)' : 'var(--text)';
    const estColor     = estMissing ? 'var(--text3)' : estNum < 0 ? '#ef4444' : estNum === 0 ? 'var(--text3)' : '#10b981';

    return `
    <tr>
      <td style="text-align:right;font-size:12px;color:var(--text3);">${i + 1}</td>
      <td style="text-align:left;vertical-align:top;">
        <div style="font-weight:700;color:var(--text);font-size:13px;font-family:monospace;">${r.ORIGINAL_SKU || '—'}</div>
        ${r.PRODUCT_NAME ? `<div style="font-size:11px;color:var(--text3);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.PRODUCT_NAME}">${r.PRODUCT_NAME}</div>` : ''}
      </td>
      <td style="text-align:right;">${channelChip(r.CHANNEL)}</td>
      <td style="text-align:right;"><span style="${V}color:${availColor};">${fmtInt(avail)}</span></td>
      <td style="text-align:right;font-size:12px;color:var(--text2);">${fmtDate(r.LAST_ORDER_DATE)}</td>
      <td style="text-align:right;"><span style="font-size:13px;font-weight:600;color:${daysColor};">${isNaN(days) ? '—' : days}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmtInt(r.UNITS_30D)}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmtInt(r.UNITS_60D)}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmtInt(r.UNITS_90D)}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmtNum(adu30, 2)}</span></td>
      <td style="text-align:right;">
        <div style="${V}color:var(--text);">${fmtInt(fc60d)}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:1px;">curr ${fmtInt(r.FORECAST_CURR_MONTH)} · next ${fmtInt(r.FORECAST_NEXT_MONTH)}</div>
      </td>
      <td style="text-align:right;"><span style="${V}color:${needColor};">${fmtInt(restockNeed)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${ppuColor};">${ppuMissing ? '—' : fmt(ppuNum)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${estColor};">${estMissing ? '—' : fmt(estNum)}</span></td>
      <td style="text-align:right;">${thresholdBadge(r.RESTOCK_THRESHOLD_MET)}</td>
      <td style="text-align:right;">${statusBadge(r.INVENTORY_STATUS)}</td>
    </tr>`;
  }).join('');
}

// ── FBA Aging Table ──────────────────────────────────────────────────────────

function renderAgingTable() {
  const priority  = (document.getElementById('agingPriority') || {}).value || '';
  const sortBy    = (document.getElementById('agingSort')     || {}).value || 'days_since_last_order';
  const sortDir   = (document.getElementById('agingDir')      || {}).value || 'asc';
  const searchRaw = (document.getElementById('agingSearch')   || {}).value || '';
  const query     = searchRaw.trim().toLowerCase();

  const clrBtn = document.getElementById('agingSearchClear');
  if (clrBtn) clrBtn.style.display = query ? '' : 'none';

  document.getElementById('inventoryHead').innerHTML = `
    <tr>
      <th style="text-align:right;min-width:40px;width:40px;">#</th>
      <th style="text-align:left;min-width:200px;">SKU / Product</th>
      <th style="min-width:90px;">Available</th>
      <th style="min-width:90px;">Total Qty</th>
      <th style="min-width:90px;">Reserved</th>
      <th style="min-width:90px;">Inbound</th>
      <th style="min-width:110px;">Last Order</th>
      <th style="min-width:90px;">Days Since</th>
      <th style="min-width:110px;">Lifetime Sold</th>
      <th style="min-width:240px;">Review Priority</th>
    </tr>`;

  let rows = [...(S.fbaAging || [])];

  if (priority) {
    rows = rows.filter(r => String(r.REVIEW_PRIORITY || '').startsWith(priority + '.'));
  }

  if (query) {
    rows = rows.filter(r =>
      String(r.ORIGINAL_SKU || '').toLowerCase().includes(query) ||
      String(r.BASE_SKU     || '').toLowerCase().includes(query) ||
      String(r.PRODUCT_NAME || '').toLowerCase().includes(query)
    );
  }

  const sortFn = {
    sku:                   r => String(r.ORIGINAL_SKU || ''),
    available:             r => Number(r.AVAILABLE)            || 0,
    total_quantity:        r => Number(r.TOTAL_QUANTITY)       || 0,
    inbound_total:         r => Number(r.INBOUND_TOTAL)        || 0,
    lifetime_units_sold:   r => Number(r.LIFETIME_UNITS_SOLD)  || 0,
    days_since_last_order: r => Number(r.DAYS_SINCE_LAST_ORDER) || 0,
  }[sortBy] || (r => Number(r.DAYS_SINCE_LAST_ORDER) || 0);

  rows.sort((a, b) => {
    const va = sortFn(a), vb = sortFn(b);
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  const meta = document.getElementById('inventoryMeta');
  if (meta) {
    const totalUnits = rows.reduce((a, r) => a + (Number(r.AVAILABLE) || 0), 0);
    meta.textContent = `${rows.length.toLocaleString()} aging SKUs · ${totalUnits.toLocaleString()} units sitting`;
  }

  const tbody = document.getElementById('inventoryBody');
  if (!rows.length) {
    const msg = query ? `No SKUs matching "${searchRaw}"` : 'No aging FBA inventory';
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text3);">${msg}</td></tr>`;
    return;
  }

  const V = 'font-size:14px;font-weight:700;';
  tbody.innerHTML = rows.map((r, i) => {
    const days = Number(r.DAYS_SINCE_LAST_ORDER);
    const daysColor =
      days > 365 ? '#ef4444' :
      days > 180 ? '#dc2626' :
      days > 90  ? '#f59e0b' :
      '#10b981';

    return `
    <tr>
      <td style="text-align:right;font-size:12px;color:var(--text3);">${i + 1}</td>
      <td style="text-align:left;vertical-align:top;">
        <div style="font-weight:700;color:var(--text);font-size:13px;font-family:monospace;">${r.ORIGINAL_SKU || r.BASE_SKU || '—'}</div>
        ${r.PRODUCT_NAME ? `<div style="font-size:11px;color:var(--text3);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.PRODUCT_NAME}">${r.PRODUCT_NAME}</div>` : ''}
      </td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmtInt(r.AVAILABLE)}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text2);">${fmtInt(r.TOTAL_QUANTITY)}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text3);">${fmtInt(r.RESERVED_TOTAL)}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text3);">${fmtInt(r.INBOUND_TOTAL)}</span></td>
      <td style="text-align:right;font-size:12px;color:var(--text2);">${fmtDate(r.LAST_ORDER_DATE)}</td>
      <td style="text-align:right;"><span style="font-size:14px;font-weight:700;color:${daysColor};">${isNaN(days) ? '—' : days}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmtInt(r.LIFETIME_UNITS_SOLD)}</span></td>
      <td style="text-align:right;">${priorityBadge(r.REVIEW_PRIORITY)}</td>
    </tr>`;
  }).join('');
}

// ── Search clear helpers ──────────────────────────────────────────────────────

function clearForecastSearch() {
  const inp = document.getElementById('forecastSearch');
  if (inp) inp.value = '';
  const btn = document.getElementById('forecastSearchClear');
  if (btn) btn.style.display = 'none';
  renderInventoryPage();
}
window.clearForecastSearch = clearForecastSearch;

function clearAgingSearch() {
  const inp = document.getElementById('agingSearch');
  if (inp) inp.value = '';
  const btn = document.getElementById('agingSearchClear');
  if (btn) btn.style.display = 'none';
  renderInventoryPage();
}
window.clearAgingSearch = clearAgingSearch;
