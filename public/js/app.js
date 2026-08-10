// ── Global State ──────────────────────────────────────────────────────────────

const S = {
  daily: null,
  sku: null,
  orderDetail: null,
  orderDetailDate: '',
  couponSku: null,
  couponOrder: null,
  couponView: 'sku',
  couponPlatform: 'amazon',
  couponDate: '',
  inventoryForecast: null,
  inventoryPool: null,
  fbaAging: null,
  inventoryView: 'forecast',
  acLevel: 'order',
  acCause: '',
  page: 'sales',
  tr: 'all',
  customFrom: '',
  customTo: '',
  theme: localStorage.getItem('theme') || 'dark',
  salesMode: 'net',
  mode: 'net',
  yoyMetric: 'revenue',
  platform: localStorage.getItem('platform') || 'all',
  charts: {},
};
window.S = S;

// ── Shared click-to-sort header machinery ────────────────────────────────────
// Same UX as the Coupon page (coupon.js cp* helpers): click a header to sort,
// click again to flip, Shift+Click a second column for a secondary sort.
// Each table registers a "view" here: defaults = initial sort (k2/d2 = optional
// secondary), text/ascFirst = columns whose first click sorts ascending,
// render = window fn re-run after a header click.

const HDR_VIEWS = {
  pd:     { defaults: { k: 'revenue',               d: 'desc', k2: null,         d2: 'desc' }, ascFirst: ['sku'],                                              render: 'renderProductsPage' },
  od:     { defaults: { k: 'order_date',            d: 'desc', k2: null,         d2: 'desc' }, ascFirst: ['order_id', 'sku', 'platform'],                      render: 'renderOrderDetailPage' },
  if:     { defaults: { k: 'restock_needed',        d: 'desc', k2: null,         d2: 'desc' }, ascFirst: ['sku', 'manufacturer', 'status'],                    render: 'renderInventoryPage' },
  ia:     { defaults: { k: 'days_since_last_order', d: 'asc',  k2: null,         d2: 'desc' }, ascFirst: ['sku', 'warehouse', 'priority'],                     render: 'renderInventoryPage' },
  ac_ord: { defaults: { k: 'cause',                 d: 'desc', k2: 'profit',     d2: 'asc'  }, ascFirst: ['order_id', 'sku', 'platform', 'supplier'],          render: 'acLossRerender' },
  ac_sku: { defaults: { k: 'cause',                 d: 'desc', k2: 'profit',     d2: 'asc'  }, ascFirst: ['sku', 'platform', 'supplier'],                      render: 'acLossRerender' },
  ac_inv: { defaults: { k: 'diff',                  d: 'desc', k2: null,         d2: 'desc' }, ascFirst: ['sku', 'status', 'master_flag', 'override', 'missed', 'warehouse'], render: 'acInvRerender' },
  ac_rst: { defaults: { k: 'urgency',               d: 'desc', k2: 'est_profit', d2: 'desc' }, ascFirst: ['sku', 'channel', 'cover'],                          render: 'acRestockRerender' },
  mk:     { defaults: { k: 'cost',                  d: 'desc', k2: null,         d2: 'desc' }, ascFirst: ['product', 'brand', 'tier'],                         render: 'renderMarketingPage' },
};

function hdrState(view) {
  if (!S.hdrSort) S.hdrSort = {};
  if (!S.hdrSort[view]) S.hdrSort[view] = Object.assign({}, HDR_VIEWS[view].defaults);
  return S.hdrSort[view];
}

function hdrClick(view, key, ev) {
  const cfg = HDR_VIEWS[view];
  const st = hdrState(view);
  const defDir = (cfg.ascFirst || []).includes(key) ? 'asc' : 'desc';
  if (ev && ev.shiftKey && key !== st.k) {
    if (st.k2 === key) st.d2 = st.d2 === 'asc' ? 'desc' : 'asc';
    else { st.k2 = key; st.d2 = defDir; }
  } else if (st.k === key) {
    st.d = st.d === 'asc' ? 'desc' : 'asc';
  } else {
    st.k = key; st.d = defDir; st.k2 = null;
  }
  const rf = window[cfg.render];
  if (typeof rf === 'function') rf();
}
window.hdrClick = hdrClick;

// Sortable <th>. opts: { align, min, w }. Unsorted columns show a faint ⇅.
function hdrTh(view, key, label, opts) {
  const o = opts || {};
  const st = hdrState(view);
  let indHtml = ` <span style="font-size:9px;color:var(--text3);opacity:.5;">⇅</span>`;
  if (st.k === key) {
    indHtml = ` <span style="font-size:9px;color:#0ea5e9;">${(st.d === 'asc' ? '▲' : '▼') + (st.k2 ? '¹' : '')}</span>`;
  } else if (st.k2 === key) {
    indHtml = ` <span style="font-size:9px;color:#0ea5e9;">${(st.d2 === 'asc' ? '▲' : '▼') + '²'}</span>`;
  }
  const style = `${o.align ? `text-align:${o.align};` : ''}${o.min ? `min-width:${o.min};` : ''}` +
    `${o.w ? `width:${o.w};` : ''}cursor:pointer;user-select:none;white-space:nowrap;`;
  return `<th style="${style}" title="Click to sort · Shift+Click = secondary sort (sort within the first sort)"
    onclick="hdrClick('${view}','${key}',event)">${label}${indHtml}</th>`;
}
window.hdrTh = hdrTh;

function hdrSortRows(rows, view, fns) {
  const st = hdrState(view);
  const f1 = fns[st.k] || (() => 0);
  const f2 = st.k2 ? fns[st.k2] : null;
  const cmp = (f, dir) => (a, b) => {
    const va = f(a), vb = f(b);
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ?  1 : -1;
    return 0;
  };
  const c1 = cmp(f1, st.d), c2 = f2 ? cmp(f2, st.d2) : null;
  return [...rows].sort((a, b) => c1(a, b) || (c2 ? c2(a, b) : 0));
}
window.hdrSortRows = hdrSortRows;

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmt(v, type = 'currency') {
  if (v == null || isNaN(v)) return '—';
  if (type === 'currency') {
    const a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(1) + 'K';
    return s + '$' + a.toFixed(2);
  }
  if (type === 'pct') return (v * 100).toFixed(1) + '%';
  if (type === 'int') return Math.round(v).toLocaleString();
  return String(v);
}

function sum(rows, f) { return rows.reduce((a, r) => a + (Number(r[f]) || 0), 0); }
function avg(rows, f) { return rows.length ? sum(rows, f) / rows.length : 0; }
// Escape a string for safe interpolation into HTML text or attribute values
// (product names can contain " for inch sizes, plus & and <).
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
window.escHtml = escHtml;
function pdiff(cur, base) { return base ? (cur - base) / Math.abs(base) : null; }

window.fmt = fmt; window.sum = sum; window.avg = avg; window.pdiff = pdiff;

// ── CSV download ──────────────────────────────────────────────────────────────
// Each per-page helper applies the same filters the user sees in the UI, then
// writes a UTF-8 CSV (with BOM so Excel detects encoding). Filenames encode
// the active filters so downloads are self-describing.

function downloadCSV(rows, filename, columns) {
  if (!Array.isArray(rows) || !rows.length) {
    alert('No data to download yet. Try again once the table has loaded.');
    return;
  }

  let headers;
  if (Array.isArray(columns) && columns.length) {
    headers = columns;
  } else {
    // Union of all row keys so we don't lose columns that are null in row 0.
    const headerSet = new Set();
    rows.forEach(r => Object.keys(r || {}).forEach(k => headerSet.add(k)));
    headers = [...headerSet];
  }

  const escape = v => {
    if (v == null) return '';
    let s;
    if (v instanceof Date) {
      s = v.toISOString().slice(0, 10);
    } else if (typeof v === 'object') {
      s = JSON.stringify(v);
    } else {
      s = String(v);
    }
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const lines = [headers.map(escape).join(',')];
  rows.forEach(r => {
    lines.push(headers.map(h => escape(r ? r[h] : null)).join(','));
  });

  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Filename helpers ──────────────────────────────────────────────────────────

function todayStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function dateForFile(s) {
  if (!s) return '';
  return String(s).slice(0, 10).replace(/-/g, '');
}

// Compact label describing the currently selected global Time Range.
function trLabel() {
  if (!S.tr || S.tr === 'all') return 'alltime';
  const r = computeRange(S.tr, S.customFrom, S.customTo);
  if (!r) return 'alltime';
  const f = dateForFile(r.f), t = dateForFile(r.t);
  return f === t ? f : `${f}-${t}`;
}

window.downloadCSV  = downloadCSV;
window.todayStamp   = todayStamp;
window.dateForFile  = dateForFile;
window.trLabel      = trLabel;

// ── Per-page download helpers ────────────────────────────────────────────────

// Product Detail → matches the global Time Range, Platform, and Net/Order/Refund mode.
function downloadSkuCSV() {
  if (!S.sku) { alert('Data not loaded yet.'); return; }
  const mode = S.mode || 'net';
  const platform = (S.platform || 'all').toLowerCase();

  // Match the table: only the SKUs currently shown (current sort + Show limit,
  // or all search matches). Keep the raw daily rows, ordered by that ranking.
  const { visible } = selectSkus(getSku(), getSkuFull());
  const rank = new Map(visible.map((s, idx) => [s.sku, idx]));
  let rows = getSku().filter(r => rank.has(r.SALES_SKU || 'UNKNOWN'));
  rows.sort((a, b) => {
    const ra = rank.get(a.SALES_SKU || 'UNKNOWN'), rb = rank.get(b.SALES_SKU || 'UNKNOWN');
    if (ra !== rb) return ra - rb;
    return String(a.DATE || '').localeCompare(String(b.DATE || ''));
  });

  const base = ['DATE', 'PLATFORM', 'SALES_SKU', 'DESCRIPTION', 'UNIT_COST'];
  const modeCols = {
    net:    base.concat(['NET_ORDER_COUNT','NET_QUANTITY','NET_PRODUCT_SALES','NET_GROSS_SALES','NET_MARGIN','NET_COGS','NET_PROFIT','NET_MARGIN_PCT','RETURN_RATE_PLATFORM','RETURN_RATE_ALL']),
    order:  base.concat(['ORDER_COUNT','ORDER_QUANTITY','ORDER_PRODUCT_SALES','ORDER_GROSS_SALES','ORDER_MARGIN','ORDER_COGS','ORDER_PROFIT']),
    refund: base.concat(['REFUND_COUNT','REFUND_QUANTITY','REFUND_PRODUCT_SALES','REFUND_GROSS_SALES','REFUND_MARGIN','REFUND_COGS','REFUND_PROFIT']),
  };
  const cols = modeCols[mode] || modeCols.net;
  const topSlug = topDisplay().toLowerCase().replace(/\s+/g, '');
  downloadCSV(rows, `product_detail_${platform}_${mode}_${trLabel()}_${topSlug}.csv`, cols);
}

// Order Detail → matches the platform toggle and the Date dropdown.
function downloadOrderDetailCSV() {
  if (!S.orderDetail) { loadOrderDetailData(); return; }
  const rows = (typeof getOrderDetailFiltered === 'function')
    ? getOrderDetailFiltered()
    : (S.orderDetail || []);
  const platform  = (S.platform || 'all').toLowerCase();
  const dateLabel = S.orderDetailDate ? dateForFile(S.orderDetailDate) : 'alldates';
  const ds        = (document.getElementById('orderDetailDropship') || {}).value || '';
  const dsLabel   = ds === 'yes' ? 'dropship_only' : ds === 'no' ? 'non_dropship' : 'all_types';
  downloadCSV(rows, `order_detail_${platform}_${dateLabel}_${dsLabel}_${todayStamp()}.csv`);
}

// Coupon Order → mirrors the filters the user sees (date dropdown + search),
// same contract as every other page's CSV. Filename reflects view + date filter.
function downloadCouponCSV() {
  // Shopify coupon view: download exactly what the current Level/Scope/Search shows.
  if (S.couponPlatform === 'shopify') {
    if (!S.couponShopSku || !S.couponShopOrder) { renderCouponPage(); return; }
    const rows = typeof getCouponShopFiltered === 'function' ? getCouponShopFiltered() : [];
    if (!rows.length) { alert('No rows match the current Shopify coupon filters.'); return; }
    const lvl = S.couponShopLevel || 'sku';
    downloadCSV(typeof cpWithSupplier === 'function' ? cpWithSupplier(rows) : rows,
      `shopify_coupon_${lvl}_level_${todayStamp()}.csv`);
    return;
  }
  if (!S.couponSku || !S.couponOrder) { loadCouponData(); return; }
  const dateLabel = S.couponDate === '__prev' ? 'last_month' : (S.couponDate || 'mtd');
  const isSku = (S.couponView || 'sku') === 'sku';
  let rows = isSku
    ? (typeof getCouponSkuFiltered === 'function' ? getCouponSkuFiltered() : S.couponSku)
    : (typeof getCouponOrderFiltered === 'function' ? getCouponOrderFiltered() : S.couponOrder);
  const searchEl = document.getElementById(isSku ? 'couponSkuSearch' : 'couponOrdSearch');
  const q = String((searchEl || {}).value || '').trim().toLowerCase();
  if (q) rows = rows.filter(r => String(r.SKU || '').toLowerCase().includes(q)
    || (!isSku && String(r.ORDER_ID || '').toLowerCase().includes(q)));
  if (!rows.length) { alert('No rows match the current coupon filters.'); return; }
  downloadCSV(typeof cpWithSupplier === 'function' ? cpWithSupplier(rows) : rows,
    `${isSku ? 'sku' : 'order'}_level_coupon_order_${dateLabel}_${todayStamp()}.csv`);
}

// Coupon Order → previous FULL month (e.g. in July this downloads all of June).
// Served by PREV_MONTH_*_COUPON_PROFIT, rebuilt daily so late refunds keep landing.
async function downloadCouponPrevMonthCSV() {
  if (S.couponPlatform === 'shopify') { alert('The Shopify coupon view accumulates from the batch start date — no last-month window.'); return; }
  const btn = document.getElementById('couponPrevDlBtn');
  try {
    if (!S.couponSkuPrev || !S.couponOrderPrev) {
      if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
      const [sr, or_] = await Promise.all([
        fetch('/api/coupon-sku?window=prev'),
        fetch('/api/coupon-order?window=prev'),
      ]);
      if (sr.status === 401 || or_.status === 401) { window.location.href = '/login.html'; return; }
      if (!sr.ok)  throw new Error(`Coupon SKU prev API: HTTP ${sr.status}`);
      if (!or_.ok) throw new Error(`Coupon Order prev API: HTTP ${or_.status}`);
      S.couponSkuPrev   = await sr.json();
      S.couponOrderPrev = await or_.json();
    }
    const rows = (S.couponView || 'sku') === 'sku' ? S.couponSkuPrev : S.couponOrderPrev;
    if (!rows || !rows.length) { alert('No coupon data for last month.'); return; }
    const month = rows.reduce((m, r) => {
      const d = String(r.ORDER_DATE || '').slice(0, 7);
      return d > m ? d : m;
    }, '');
    const lvl = (S.couponView || 'sku') === 'sku' ? 'sku_level' : 'order_level';
    downloadCSV(typeof cpWithSupplier === 'function' ? cpWithSupplier(rows) : rows,
      `${lvl}_coupon_order_${month}_full_month.csv`);
  } catch (err) {
    alert(err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

// Inventory → Forecast matches Channel + Status; Slow Traffic matches Warehouse + Priority.
function downloadInventoryCSV() {
  if (!S.inventoryForecast || !S.fbaAging) { loadInventoryData(); return; }

  if ((S.inventoryView || 'forecast') === 'forecast') {
    const chSel  = document.getElementById('forecastChannel');
    const stSel  = document.getElementById('forecastStatus');
    const channel   = (chSel && chSel.value) || 'total';
    const statusRaw = (stSel && stSel.value) || '';

    const horizonN = (typeof invHorizonN === 'function') ? invHorizonN() : 2;
    let rows = (S.inventoryForecast || []).filter(
      r => String(r.CHANNEL || '').toLowerCase() === channel
    );
    // derived horizon columns (same math as the table view)
    rows = rows.map(r => {
      const d = (typeof fcHorizonCalc === 'function') ? fcHorizonCalc(r, horizonN) : null;
      if (!d) return r;
      return { ...r,
        FC_HORIZON_MONTHS: horizonN, FC_HORIZON_DAYS: d.days,
        FC_HORIZON: d.fc, RESTOCK_NEEDED_HORIZON: d.restock,
        THRESHOLD_MET_HORIZON: d.met, STATUS_HORIZON: d.status,
        EST_RESTOCK_PROFIT_HORIZON: d.estProfit, EST_RESTOCK_COST_HORIZON: d.estCost };
    });
    if (statusRaw === 'threshold') {
      rows = rows.filter(r => String(r.THRESHOLD_MET_HORIZON || r.RESTOCK_THRESHOLD_MET || '') === 'Y');
    } else if (statusRaw) {
      rows = rows.filter(r => String(r.STATUS_HORIZON || r.INVENTORY_STATUS || '') === statusRaw);
    }
    const mfr = (document.getElementById('forecastManufacturer') || {}).value || '';
    if (mfr === '__unknown__') {
      rows = rows.filter(r => !r.MANUFACTURER || !String(r.MANUFACTURER).trim());
    } else if (mfr) {
      rows = rows.filter(r => String(r.MANUFACTURER || '') === mfr);
    }
    const catSel = (S.invCatSel instanceof Set) ? S.invCatSel : new Set();
    if (catSel.size) {
      rows = rows.filter(r => {
        const c = String(r.CATEGORY || '').trim();
        return c ? catSel.has(c) : catSel.has('__unknown__');
      });
    }

    const statusSlug = !statusRaw ? 'all'
      : statusRaw === 'threshold' ? 'threshold_met'
      : statusRaw.toLowerCase().replace(/\s+/g, '_');
    const mfrSlug = mfr === '__unknown__' ? '_unknown' : mfr ? `_${mfr.toLowerCase().replace(/\s+/g, '_')}` : '';
    downloadCSV(rows, `inventory_forecast_${channel}_${statusSlug}${mfrSlug}_${todayStamp()}.csv`);
  } else {
    const whSel  = document.getElementById('agingChannel');
    const priSel = document.getElementById('agingPriority');
    const wh  = (whSel  && whSel.value)  || '';
    const pri = (priSel && priSel.value) || '';

    let rows = [...(S.fbaAging || [])];
    if (wh)  rows = rows.filter(r => String(r.CHANNEL || '').toLowerCase() === wh);
    if (pri) rows = rows.filter(r => String(r.REVIEW_PRIORITY || '').startsWith(pri + '.'));

    const whSlug  = wh  || 'all_warehouses';
    const priSlug = pri ? `tier${pri}` : 'all_tiers';
    downloadCSV(rows, `slow_traffic_${whSlug}_${priSlug}_${todayStamp()}.csv`);
  }
}

window.downloadSkuCSV         = downloadSkuCSV;
window.downloadOrderDetailCSV = downloadOrderDetailCSV;
window.downloadCouponCSV      = downloadCouponCSV;
window.downloadCouponPrevMonthCSV = downloadCouponPrevMonthCSV;
window.downloadInventoryCSV   = downloadInventoryCSV;

// ── Download hints ────────────────────────────────────────────────────────────
// Renders a small text next to each CSV button summarising what will be
// downloaded given the currently active filters / toggles.

const PLATFORM_LABEL = { all: 'All Platforms', amazon: 'Amazon', shopify: 'Shopify' };
const MODE_LABEL     = { net: 'Net', order: 'Order', refund: 'Refund' };
const FCST_CHANNEL_LABEL = {
  total: 'Total (Non-FBA + Shopify)',
  amazon_fba: 'Amazon FBA',
  amazon_nonfba: 'Amazon Non-FBA',
  shopify: 'Shopify',
};
const FCST_STATUS_LABEL = {
  '': 'All statuses',
  'Restock Needed': 'Restock Needed',
  'Out of Stock':   'Out of Stock',
  'Sufficient':     'Sufficient',
  'threshold':      'Threshold met (Y)',
};
const AGING_WAREHOUSE_LABEL = {
  '': 'All warehouses',
  amazon_fba: 'Amazon FBA',
  hooves_and_paws: 'Hooves and Paws',
};
const AGING_PRIORITY_LABEL = {
  '': 'All tiers',
  '1': 'Tier 1 (Warning)',
  '2': 'Tier 2 (Review)',
  '3': 'Tier 3 (Discontinue Candidate)',
  '4': 'Tier 4 (Definitely Discontinue)',
};
const TR_LABEL = {
  all: 'All time', yesterday: 'Yesterday',
  thisWeek: 'This week', lastWeek: 'Last week',
  thisMonth: 'This month', lastMonth: 'Last month',
  last7: 'Last 7 days', last14: 'Last 14 days',
  last30: 'Last 30 days', last90: 'Last 90 days',
  thisYear: 'This year', lastYear: 'Last year',
};

function trDisplay() {
  if (!S.tr) return 'All time';
  if (TR_LABEL[S.tr]) return TR_LABEL[S.tr];
  if (S.tr === 'custom') return (S.customFrom && S.customTo) ? `${S.customFrom} → ${S.customTo}` : 'All time';
  if (S.tr.startsWith('m:')) return S.tr.slice(2);
  return 'All time';
}

function platformDisplay() { return PLATFORM_LABEL[(S.platform || 'all').toLowerCase()] || 'All Platforms'; }

// Human label for the Product Detail "Show" limit. While a search is active the
// table ignores the limit and shows every match, so reflect that.
function topDisplay() {
  const q = ((document.getElementById('skuSearch') || {}).value || '').trim();
  if (q) return 'Search matches';
  const v = (document.getElementById('topSel') || {}).value || '100';
  if (v === 'all') return 'All';
  if (v === 'custom') {
    const c = parseInt((document.getElementById('topCustom') || {}).value, 10);
    return (c && c > 0) ? `Top ${c}` : 'All';
  }
  return `Top ${v}`;
}
window.topDisplay = topDisplay;

function hintParts(parts) {
  return parts.map(p => `<b>${p}</b>`).join('<span class="sep">·</span>');
}

const HINT_PREFIX = 'Will download:&nbsp;';

function updateDownloadHints() {
  // Product Detail → mode · platform · time range
  const skuH = document.getElementById('skuDlHint');
  if (skuH) {
    const mode = MODE_LABEL[S.mode || 'net'];
    skuH.innerHTML = HINT_PREFIX + hintParts([mode, platformDisplay(), trDisplay(), topDisplay()]);
  }

  // Order Detail → platform · date · drop-ship filter
  const odH = document.getElementById('orderDetailDlHint');
  if (odH) {
    const date    = S.orderDetailDate || 'All dates';
    const ds      = (document.getElementById('orderDetailDropship') || {}).value || '';
    const dsLabel = ds === 'yes' ? 'Drop Ship Only' : ds === 'no' ? 'Non-Drop Ship Only' : 'All types';
    odH.innerHTML = HINT_PREFIX + hintParts([platformDisplay(), date, dsLabel]);
  }

  // Coupon → SKU level / Order level · date filter · search (mirrors the CSV)
  const cpH = document.getElementById('couponDlHint');
  if (cpH) {
    if (S.couponPlatform === 'shopify') {
      const lvl = (S.couponShopLevel || 'sku') === 'order' ? 'Order level' : 'SKU level';
      const scope = ((document.getElementById('couponShopScope') || {}).value || 'target') === 'all' ? 'All variants' : 'Target SKUs';
      const q = String(((document.getElementById('couponShopSearch') || {}).value || '')).trim();
      cpH.innerHTML = HINT_PREFIX + hintParts(q ? ['Shopify', lvl, scope, `search: "${q}"`] : ['Shopify', lvl, scope]);
    } else {
      const view = (S.couponView === 'order') ? 'Order level' : 'SKU level';
      const date = S.couponDate === '__prev' ? 'Last month' : (S.couponDate || 'Month-to-date');
      const sEl = document.getElementById(S.couponView === 'order' ? 'couponOrdSearch' : 'couponSkuSearch');
      const q = String((sEl || {}).value || '').trim();
      cpH.innerHTML = HINT_PREFIX + hintParts(q ? [view, date, `search: "${q}"`] : [view, date]);
    }
  }

  // Inventory → either Forecast (channel · status) or Slow Traffic (warehouse · priority)
  const invH = document.getElementById('inventoryDlHint');
  if (invH) {
    if ((S.inventoryView || 'forecast') === 'forecast') {
      const ch = (document.getElementById('forecastChannel') || {}).value || 'total';
      const st = (document.getElementById('forecastStatus')  || {}).value || '';
      const mf = (document.getElementById('forecastManufacturer') || {}).value || '';
      const mfLabel = mf === '__unknown__' ? 'Unknown' : mf || 'All manufacturers';
      invH.innerHTML = HINT_PREFIX + hintParts(['Forecast', FCST_CHANNEL_LABEL[ch] || ch, FCST_STATUS_LABEL[st] || st, mfLabel]);
    } else {
      const wh  = (document.getElementById('agingChannel')  || {}).value || '';
      const pri = (document.getElementById('agingPriority') || {}).value || '';
      invH.innerHTML = HINT_PREFIX + hintParts(['Slow Traffic', AGING_WAREHOUSE_LABEL[wh] || wh, AGING_PRIORITY_LABEL[pri] || pri]);
    }
  }
}

window.updateDownloadHints = updateDownloadHints;

// ── Date Range ────────────────────────────────────────────────────────────────

function toStr(d) { return d.toISOString().slice(0, 10); }

function computeRange(key, from, to) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const dow = now.getDay();
  const monOff = dow === 0 ? -6 : 1 - dow;
  switch (key) {
    case 'all': return null;
    case 'yesterday': { const d = new Date(now); d.setDate(d.getDate() - 1); return { f: toStr(d), t: toStr(d) }; }
    case 'thisWeek': { const d = new Date(now); d.setDate(d.getDate() + monOff); return { f: toStr(d), t: toStr(now) }; }
    case 'lastWeek': { const m = new Date(now); m.setDate(m.getDate() + monOff - 7); const s = new Date(m); s.setDate(s.getDate() + 6); return { f: toStr(m), t: toStr(s) }; }
    case 'thisMonth': return { f: toStr(new Date(now.getFullYear(), now.getMonth(), 1)), t: toStr(now) };
    case 'lastMonth': return { f: toStr(new Date(now.getFullYear(), now.getMonth() - 1, 1)), t: toStr(new Date(now.getFullYear(), now.getMonth(), 0)) };
    case 'last7': { const d = new Date(now); d.setDate(d.getDate() - 6); return { f: toStr(d), t: toStr(now) }; }
    case 'last14': { const d = new Date(now); d.setDate(d.getDate() - 13); return { f: toStr(d), t: toStr(now) }; }
    case 'last30': { const d = new Date(now); d.setDate(d.getDate() - 29); return { f: toStr(d), t: toStr(now) }; }
    case 'last90': { const d = new Date(now); d.setDate(d.getDate() - 89); return { f: toStr(d), t: toStr(now) }; }
    case 'thisYear': return { f: toStr(new Date(now.getFullYear(), 0, 1)), t: toStr(now) };
    case 'lastYear': return { f: toStr(new Date(now.getFullYear() - 1, 0, 1)), t: toStr(new Date(now.getFullYear() - 1, 11, 31)) };
    case 'custom': return (from && to) ? { f: from, t: to } : null;
    default:
      if (key.startsWith('m:')) {
        const [y, m] = key.slice(2).split('-').map(Number);
        return { f: toStr(new Date(y, m - 1, 1)), t: toStr(new Date(y, m, 0)) };
      }
      return null;
  }
}

function filterData(data, key, from, to) {
  if (!data) return [];
  const r = computeRange(key, from, to);
  if (!r) return data;
  return data.filter(row => row.DATE >= r.f && row.DATE <= r.t);
}

// ── Platform filtering ────────────────────────────────────────────────────────

function filterByPlatform(data) {
  if (!data) return [];
  const p = (S.platform || 'all').toLowerCase();
  if (p === 'all') return data;
  return data.filter(row => String(row.PLATFORM || '').toLowerCase() === p);
}

function getDailyFull() { return filterByPlatform(S.daily); }
function getSkuFull()   { return filterByPlatform(S.sku); }

function getDaily() { return filterData(getDailyFull(), S.tr, S.customFrom, S.customTo); }
function getSku()   { return filterData(getSkuFull(),   S.tr, S.customFrom, S.customTo); }

window.getDaily = getDaily;
window.getSku = getSku;
window.getDailyFull = getDailyFull;
window.getSkuFull = getSkuFull;
window.filterByPlatform = filterByPlatform;
window.filterData = filterData;

// ── Time Range — 3-box UI ─────────────────────────────────────────────────────

function onQuickRange(sel) {
  if (!sel.value) { clearTR(); return; }
  document.getElementById('trMonth').value = '';
  document.getElementById('trFrom').value = '';
  document.getElementById('trTo').value = '';
  S.tr = sel.value; S.customFrom = ''; S.customTo = '';
  showClear(sel.options[sel.selectedIndex].text);
  rerender();
}

function onMonthRange(sel) {
  if (!sel.value) { clearTR(); return; }
  document.getElementById('trQuick').value = '';
  document.getElementById('trFrom').value = '';
  document.getElementById('trTo').value = '';
  S.tr = 'm:' + sel.value; S.customFrom = ''; S.customTo = '';
  showClear(sel.value);
  rerender();
}

function onCustomRange() {
  const f = document.getElementById('trFrom').value;
  const t = document.getElementById('trTo').value;
  if (!f || !t) return;
  document.getElementById('trQuick').value = '';
  document.getElementById('trMonth').value = '';
  S.tr = 'custom'; S.customFrom = f; S.customTo = t;
  showClear(`${f} – ${t}`);
  rerender();
}

function clearTR() {
  document.getElementById('trQuick').value = '';
  document.getElementById('trMonth').value = '';
  document.getElementById('trFrom').value = '';
  document.getElementById('trTo').value = '';
  S.tr = 'all'; S.customFrom = ''; S.customTo = '';
  document.getElementById('trClear').style.display = 'none';
  rerender();
}

function showClear(label) {
  const btn = document.getElementById('trClear');
  btn.textContent = `✕  ${label}`;
  btn.style.display = '';
}

function populateMonths(data) {
  const months = [...new Set(data.map(r => r.DATE.slice(0, 7)))].sort().reverse();
  const sel = document.getElementById('trMonth');
  sel.innerHTML = `<option value="">By Month</option>` + months.map(m => `<option value="${m}">${m}</option>`).join('');
}

window.onQuickRange = onQuickRange;
window.onMonthRange = onMonthRange;
window.onCustomRange = onCustomRange;
window.clearTR = clearTR;

function rerender() {
  if (S.page === 'action')       { renderActionCenterPage(); return; }
  if (S.page === 'coupon')       { renderCouponPage();      updateDownloadHints(); return; }
  if (S.page === 'orderDetail')  { renderOrderDetailPage(); updateDownloadHints(); return; }
  if (S.page === 'inventory')    { renderInventoryPage();   updateDownloadHints(); return; }
  if (!S.daily || !S.sku) return;
  if (S.page === 'sales') renderSalesPage();
  else renderProductsPage();
  updateDownloadHints();
}

// ── Navigation ────────────────────────────────────────────────────────────────

// Pages whose body is a single full-height table (content doesn't scroll; the
// table body does). Everything else is a normal vertical-scroll page.
const TABLE_PAGES = ['products', 'orderDetail', 'coupon', 'inventory', 'action', 'marketing'];

function switchPage(page) {
  S.page = page;
  // Table pages use display:flex so the section can be a flex column; scroll
  // pages use block.
  const isTable = TABLE_PAGES.includes(page);
  document.body.classList.toggle('tableview', isTable);
  const shown = isTable ? 'flex' : 'block';
  document.getElementById('salesSection').style.display       = page === 'sales'       ? 'block' : 'none';
  document.getElementById('productsSection').style.display    = page === 'products'    ? shown  : 'none';
  document.getElementById('orderDetailSection').style.display = page === 'orderDetail' ? shown  : 'none';
  document.getElementById('couponSection').style.display      = page === 'coupon'      ? shown  : 'none';
  document.getElementById('inventorySection').style.display   = page === 'inventory'   ? shown  : 'none';
  document.getElementById('actionSection').style.display      = page === 'action'      ? shown  : 'none';
  document.getElementById('marketingSection').style.display   = page === 'marketing'   ? shown  : 'none';
  document.getElementById('navSales').classList.toggle('active',       page === 'sales');
  document.getElementById('navProducts').classList.toggle('active',    page === 'products');
  document.getElementById('navOrderDetail').classList.toggle('active', page === 'orderDetail');
  document.getElementById('navCoupon').classList.toggle('active',      page === 'coupon');
  document.getElementById('navInventory').classList.toggle('active',   page === 'inventory');
  document.getElementById('navAction').classList.toggle('active',      page === 'action');
  document.getElementById('navMarketing').classList.toggle('active',   page === 'marketing');
  const titles = {
    sales: 'Sales Dashboard',
    products: 'Product Detail',
    orderDetail: 'Order Detail',
    coupon: 'Coupon Order',
    inventory: 'Inventory',
    action: 'Action Center',
    marketing: 'Marketing · Ads P&L',
  };
  document.getElementById('pageTitle').textContent = titles[page] || 'Dashboard';
  // Inventory / Coupon / Order Detail have their own internal filters and don't use the global time range.
  // Action Center keeps the topbar Time Range because its SKU-level insights follow it.
  // Marketing is a fixed trailing-30d view, so the global time range doesn't apply either.
  const hideTopbar = page === 'coupon' || page === 'orderDetail' || page === 'inventory' || page === 'marketing';
  document.getElementById('trControls').style.display = hideTopbar ? 'none' : 'flex';

  // Page-level toggles live in the topbar (next to the title) to save a row.
  document.getElementById('topbarPlatform').style.display  = (page === 'sales' || page === 'products' || page === 'orderDetail') ? 'inline-flex' : 'none';
  document.getElementById('couponToggle').style.display    = page === 'coupon'    ? 'flex' : 'none';
  document.getElementById('inventoryToggle').style.display = page === 'inventory' ? 'flex' : 'none';
  document.getElementById('acLevelToggle').style.display   = page === 'action'    ? 'flex' : 'none';
  syncPlatformButtons(); // keep the topbar platform group's active state in sync
  closeNavMenu();
  if (page === 'coupon') {
    loadCouponData();
  } else if (page === 'orderDetail') {
    loadOrderDetailData();
  } else if (page === 'inventory') {
    loadInventoryData();
  } else if (page === 'action') {
    loadActionCenterData();
  } else if (page === 'marketing') {
    loadMarketingData();
  } else if (S.daily && S.sku) {
    if (page === 'sales') renderSalesPage();
    else renderProductsPage();
  }
  updateDownloadHints();
}
window.switchPage = switchPage;

// ── Navigation dropdown (brand-button menu) ───────────────────────────────────

function toggleNavMenu() {
  const open = document.getElementById('navDropdown').classList.toggle('open');
  document.getElementById('brandBtn').classList.toggle('open', open);
  document.getElementById('navBackdrop').classList.toggle('open', open);
}
function closeNavMenu() {
  document.getElementById('navDropdown').classList.remove('open');
  document.getElementById('brandBtn').classList.remove('open');
  document.getElementById('navBackdrop').classList.remove('open');
}
window.toggleNavMenu = toggleNavMenu;
window.closeNavMenu  = closeNavMenu;

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNavMenu(); });

// ── Theme ─────────────────────────────────────────────────────────────────────

function applyTheme(t) {
  document.documentElement.classList.toggle('light', t === 'light');
  document.getElementById('themeBtn').textContent = t === 'light' ? '☀️' : '🌙';
  S.theme = t;
  localStorage.setItem('theme', t);
}
function toggleTheme() {
  applyTheme(S.theme === 'dark' ? 'light' : 'dark');
  if (S.daily) {
    renderCharts(getDaily(), S.salesMode);
    // YoY chart bakes theme colors into its config too — recolor it as well.
    if (typeof renderYoYChart === 'function') renderYoYChart(getDaily(), getDailyFull(), S.salesMode);
  }
}
window.toggleTheme = toggleTheme;
applyTheme(S.theme);

// ── Metric Modes ──────────────────────────────────────────────────────────────

function setSalesMode(mode, btn) {
  S.salesMode = mode;
  document.querySelectorAll('#salesToggle .toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (S.daily) renderSalesPage();
}
window.setSalesMode = setSalesMode;

function setMode(mode, btn) {
  S.mode = mode;
  document.querySelectorAll('#productsSection .toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderProductsPage();
  updateDownloadHints();
}
window.setMode = setMode;

// Keep all three platform toggle button-groups visually in sync
function syncPlatformButtons() {
  const p = (S.platform || 'all').toLowerCase();
  document.querySelectorAll('.platform-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.platform === p);
  });
}

function setPlatform(plat, btn) {
  S.platform = plat;
  localStorage.setItem('platform', plat);
  syncPlatformButtons();
  rerender();
}
window.setPlatform = setPlatform;
window.syncPlatformButtons = syncPlatformButtons;

function setYoyMetric(metric) {
  S.yoyMetric = metric;
  // Pass the platform-filtered dataset (getDailyFull), NOT raw S.daily —
  // otherwise the Last-Year series silently ignores the Platform toggle.
  if (S.daily) renderYoYChart(getDaily(), getDailyFull(), S.salesMode);
}
window.setYoyMetric = setYoyMetric;

// ── Init ──────────────────────────────────────────────────────────────────────

// Background revalidation delivered fresher data (see cache.js) — refresh the
// date-dependent chrome and re-render whatever page is showing.
function refreshAfterDataUpdate() {
  if (!Array.isArray(S.daily) || !Array.isArray(S.sku)) return;
  const lastDate = S.daily[S.daily.length - 1]?.DATE;
  document.getElementById('sidebarStatus').textContent = `Updated: ${lastDate || '–'}`;
  populateMonths(S.daily);
  rerender();
}

async function init() {
  try {
    const [daily, sku, pool] = await Promise.all([
      swrJSON('/api/daily', d => { S.daily = d; refreshAfterDataUpdate(); }),
      swrJSON('/api/sku',   d => { S.sku   = d; refreshAfterDataUpdate(); }),
      // Inventory pool is supplementary — never block the dashboard if it fails.
      swrJSON('/api/inventory-pool', d => {
        S.inventoryPool = Array.isArray(d) ? d : [];
        buildInventoryIndex();
        refreshAfterDataUpdate();
      }).catch(() => []),
    ]);

    S.daily = daily;
    S.sku   = sku;

    if (!Array.isArray(S.daily) || !Array.isArray(S.sku)) throw new Error('Invalid API response');

    S.inventoryPool = Array.isArray(pool) ? pool : [];
    buildInventoryIndex();

    const lastDate = S.daily[S.daily.length - 1]?.DATE;
    document.getElementById('sidebarStatus').textContent = `Updated: ${lastDate || '–'}`;

    populateMonths(S.daily);
    syncPlatformButtons();

    document.getElementById('loadingOverlay').style.display = 'none';

    renderSalesPage();
    renderProductsPage();
    switchPage('sales'); // syncs topbar toggles (shows the platform group on Sales)
    updateDownloadHints();

  } catch (err) {
    if (err.message === 'unauthorized') return; // swrJSON already redirected to login
    console.error(err);
    document.getElementById('loadingOverlay').innerHTML = `
      <div style="text-align:center;padding:24px;">
        <div style="font-size:28px;margin-bottom:12px;">⚠</div>
        <div style="font-size:15px;font-weight:600;color:#ef4444;margin-bottom:6px;">Failed to load</div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:16px;">${err.message}</div>
        <button onclick="init()" style="background:#0ea5e9;color:white;border:none;border-radius:8px;padding:8px 18px;cursor:pointer;font-size:13px;font-weight:500;">Retry</button>
      </div>`;
  }
}

init();
