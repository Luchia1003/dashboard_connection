// ── Coupon Order Page ─────────────────────────────────────────────────────────
// Data = month-to-date: 1st of current month → yesterday.
// (On the 1st of a month the tables hold the FULL previous month, since order
// data only exists up to "yesterday".) Rebuilt daily by the coupon pipeline.

// Coupon uses its own date selector — independent of the global topbar filter.
function getCouponSkuFiltered() {
  if (!S.couponSku) return [];
  let rows = S.couponSku;
  if (S.couponDate) rows = rows.filter(row => String(row.ORDER_DATE).slice(0, 10) === S.couponDate);
  return cpSupplierFilter(rows);
}

function getCouponOrderFiltered() {
  if (!S.couponOrder) return [];
  let rows = S.couponOrder;
  if (S.couponDate) rows = rows.filter(row => String(row.ORDER_DATE).slice(0, 10) === S.couponDate);
  return cpSupplierFilter(rows);
}

// Populate the date dropdown from every ORDER_DATE present (the MTD window).
function populateCouponDates() {
  const allDates = new Set();
  (S.couponSku   || []).forEach(r => r.ORDER_DATE && allDates.add(String(r.ORDER_DATE).slice(0, 10)));
  (S.couponOrder || []).forEach(r => r.ORDER_DATE && allDates.add(String(r.ORDER_DATE).slice(0, 10)));
  const sorted = [...allDates].sort().reverse();
  const sel = document.getElementById('couponDateSel');
  if (!sel) return;
  sel.innerHTML = `<option value="">This Month</option>` +
    sorted.map(d => `<option value="${d}">${d}</option>`).join('');
  // Restore previously selected date if still valid
  if (S.couponDate && sorted.includes(S.couponDate)) sel.value = S.couponDate;
  else { S.couponDate = ''; sel.value = ''; }
}

function setCouponDate(val) {
  S.couponDate = val;
  renderCouponPage();
}
window.setCouponDate = setCouponDate;

// ── Shared cell helpers ───────────────────────────────────────────────────────

const CP_V = 'font-size:14px;font-weight:700;';

function cpDsBadge(r) {
  // Tolerant of the shapes Snowflake/JSON can return for BOOLEAN
  // (true, 1, "true", "1") — same idiom as order-detail.js isDropShip.
  const v = r.IS_DROPSHIP;
  const isDs = v === true || v === 1 ||
    (typeof v === 'string' && (v.toLowerCase() === 'true' || v === '1')) ||
    Number(v) === 1;
  if (!isDs) return '';
  const fee = Number(r.ORDER_DROPSHIP_FEE) || 0;
  return ` <span title="Dropship order — supplier fee ${fmt(fee)} (already included in margin)"
    style="font-size:10px;font-weight:700;padding:1px 5px;border-radius:6px;vertical-align:middle;
    background:rgba(168,85,247,.15);color:#a855f7;border:1px solid rgba(168,85,247,.3);">DS</span>`;
}

// Informational fee cell (margin is already net of these fees) — dash when 0.
function cpFeeCell(v) {
  const n = Number(v) || 0;
  if (!n) return `<td style="text-align:right;"><span style="color:var(--text3);">—</span></td>`;
  return `<td style="text-align:right;"><span style="${CP_V}color:var(--text2);">${fmt(n)}</span></td>`;
}

function cpRefundCells(r) {
  const rq = Number(r.REFUND_QTY) || 0;
  const rs = Number(r.REFUND_PRODUCT_SALES) || 0;
  if (!rq && !rs) {
    return `<td style="text-align:right;"><span style="color:var(--text3);">—</span></td>
            <td style="text-align:right;"><span style="color:var(--text3);">—</span></td>`;
  }
  return `<td style="text-align:right;"><span style="${CP_V}color:#ef4444;">${Math.round(rq).toLocaleString()}</span></td>
          <td style="text-align:right;"><span style="${CP_V}color:#ef4444;">${fmt(rs)}</span></td>`;
}

// ── Supplier lookup ───────────────────────────────────────────────────────────
// Same source as Action Center's loss tables: MASTER_COST supplier map
// (/api/sku?suppliers=1) + inventory-forecast MANUFACTURER heuristics, indexed
// by acManuIdx() in action-center.js. Fetched lazily on first coupon render.
function cpEnsureSuppliers() {
  if (Array.isArray(S.supplierMap) || S._cpSupLoading) return;
  S._cpSupLoading = true;
  swrJSON('/api/sku?suppliers=1')
    .then(d => { S.supplierMap = Array.isArray(d) ? d : []; })
    .catch(() => { S.supplierMap = []; })
    .finally(() => { S._acManuIdx = null; renderCouponPage(); });
}

function cpSupplier(sku) {
  return typeof acManu === 'function' ? acManu(sku) : '';
}

function cpSupplierCell(sku) {
  const m = cpSupplier(sku);
  if (typeof manufacturerChip === 'function') return `<td style="text-align:left;">${manufacturerChip(m)}</td>`;
  return `<td style="text-align:left;">${m || '<span style="color:var(--text3);">—</span>'}</td>`;
}

// Adds a SUPPLIER column to rows for CSV downloads (used by app.js).
function cpWithSupplier(rows) {
  return (rows || []).map(r => Object.assign({}, r, { SUPPLIER: cpSupplier(r.SKU) }));
}
window.cpWithSupplier = cpWithSupplier;

// ── Supplier filter (toolbar select, applies to table + CSV) ─────────────────

function cpSupplierFilter(rows) {
  const v = ((document.getElementById('couponSupplierSel') || {}).value) || '';
  if (!v) return rows;
  if (v === '__unknown') return rows.filter(r => !cpSupplier(r.SKU));
  return rows.filter(r => cpSupplier(r.SKU) === v);
}

// Rebuild the supplier dropdown from the current platform's data, keeping the
// current selection when still present.
function cpPopulateSupplierSel() {
  const sel = document.getElementById('couponSupplierSel');
  if (!sel) return;
  const isShop = (S.couponPlatform || 'amazon') === 'shopify';
  const src = isShop
    ? [...(S.couponShopSku || []), ...(S.couponShopOrder || [])]
    : [...(S.couponSku || []), ...(S.couponOrder || [])];
  const names = new Set();
  let hasUnknown = false;
  src.forEach(r => { const m = cpSupplier(r.SKU); if (m) names.add(m); else hasUnknown = true; });
  const prev = sel.value;
  sel.innerHTML = `<option value="">All Suppliers</option>` +
    [...names].sort((a, b) => a.localeCompare(b)).map(n => `<option value="${n}">${n}</option>`).join('') +
    (hasUnknown ? `<option value="__unknown">Unknown</option>` : '');
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

// ── Column-header sorting (click = sort, Shift+Click = secondary sort) ───────
// One sort state per view: k/d = primary column & direction, k2/d2 = optional
// secondary (tie-breaker within equal primary values).

const CP_SORT_DEFAULTS = {
  a_sku: { k: 'order_date', d: 'desc', k2: null, d2: 'desc' },
  a_ord: { k: 'order_date', d: 'desc', k2: null, d2: 'desc' },
  s_sku: { k: 'profit',     d: 'desc', k2: null, d2: 'desc' },
  s_ord: { k: 'profit',     d: 'desc', k2: null, d2: 'desc' },
};

// Text columns start ascending on first click; numbers/dates start descending.
const CP_TEXT_COLS = new Set(['sku', 'supplier', 'order_id', 'order']);

function cpSortState(view) {
  if (!S.cpSort) S.cpSort = {};
  if (!S.cpSort[view]) S.cpSort[view] = Object.assign({}, CP_SORT_DEFAULTS[view]);
  return S.cpSort[view];
}

function cpHeaderClick(view, key, ev) {
  const st = cpSortState(view);
  const defDir = CP_TEXT_COLS.has(key) ? 'asc' : 'desc';
  if (ev && ev.shiftKey && key !== st.k) {
    if (st.k2 === key) st.d2 = st.d2 === 'asc' ? 'desc' : 'asc';
    else { st.k2 = key; st.d2 = defDir; }
  } else if (st.k === key) {
    st.d = st.d === 'asc' ? 'desc' : 'asc';
  } else {
    st.k = key; st.d = defDir; st.k2 = null;
  }
  renderCouponPage();
}
window.cpHeaderClick = cpHeaderClick;

// Sortable <th>. opts: { align, min, w }
// Unsorted columns show a faint ⇅ so it's clear every header is clickable.
function cpTh(view, key, label, opts) {
  const o = opts || {};
  const st = cpSortState(view);
  let indHtml = ` <span style="font-size:9px;color:var(--text3);opacity:.5;">⇅</span>`;
  if (st.k === key) {
    indHtml = ` <span style="font-size:9px;color:#0ea5e9;">${(st.d === 'asc' ? '▲' : '▼') + (st.k2 ? '¹' : '')}</span>`;
  } else if (st.k2 === key) {
    indHtml = ` <span style="font-size:9px;color:#0ea5e9;">${(st.d2 === 'asc' ? '▲' : '▼') + '²'}</span>`;
  }
  const style = `${o.align ? `text-align:${o.align};` : ''}${o.min ? `min-width:${o.min};` : ''}` +
    `${o.w ? `width:${o.w};` : ''}cursor:pointer;user-select:none;white-space:nowrap;`;
  return `<th style="${style}" title="Click to sort · Shift+Click = secondary sort (sort within the first sort)"
    onclick="cpHeaderClick('${view}','${key}',event)">${label}${indHtml}</th>`;
}

function cpSortRows(rows, view, fns) {
  const st = cpSortState(view);
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

// Sort accessors — Amazon tables (SKU + order level share one map).
const CP_AMZ_FNS = {
  order_date:    r => r.ORDER_DATE || '',
  order_id:      r => String(r.ORDER_ID || '').toLowerCase(),
  sku:           r => String(r.SKU || '').toLowerCase(),
  supplier:      r => (cpSupplier(r.SKU) || '').toLowerCase(),
  qty:           r => Number(r.ORDER_QTY)           || 0,
  product_sales: r => Number(r.ORDER_PRODUCT_SALES) || 0,
  margin:        r => Number(r.ORDER_MARGIN)        || 0,
  coupon_fee:    r => Number(r.ORDER_COUPON_FEE)    || 0,
  shipping_fee:  r => Number(r.ORDER_SHIPPING_FEE)  || 0,
  dropship_fee:  r => Number(r.ORDER_DROPSHIP_FEE)  || 0,
  new_margin:    r => Number(r.ORDER_NEW_MARGIN)    || 0,
  profit:        r => Number(r.ORDER_PROFIT)        || 0,
  refund_qty:    r => Number(r.REFUND_QTY)          || 0,
  refund_amt:    r => Number(r.REFUND_PRODUCT_SALES)|| 0,
  net_qty:       r => Number(r.NET_QTY)             || 0,
  net_profit:    r => Number(r.NET_PROFIT)          || 0,
  unit_cost:     r => Number(r.UNIT_COST)           || 0,
};

// Sort accessors — Shopify SKU level.
const CP_SHOP_SKU_FNS = {
  sku:        r => String(r.SKU || '').toLowerCase(),
  supplier:   r => (cpSupplier(r.SKU) || '').toLowerCase(),
  pct:        r => Number(r.GROUP_PCT)           || 0,
  price_push: r => Number(r.PRICE_AT_PUSH)       || 0,
  unit_cost:  r => Number(r.UNIT_COST)           || 0,
  avail:      r => Number(r.AVAILABLE_AT_PUSH)   || 0,
  orders:     r => Number(r.ORDER_COUNT)         || 0,
  qty:        r => Number(r.ORDER_QTY)           || 0,
  sales:      r => Number(r.ORDER_PRODUCT_SALES) || 0,
  discount:   r => Number(r.EST_COUPON_DISCOUNT) || 0,
  margin:     r => Number(r.ORDER_MARGIN)        || 0,
  profit:     r => Number(r.ORDER_PROFIT)        || 0,
  date:       r => r.LAST_COUPON_ORDER_DATE || '',
};

// Sort accessors — Shopify order level.
const CP_SHOP_ORD_FNS = {
  order:      r => String(r.ORDER_NAME || r.ORDER_ID || '').toLowerCase(),
  date:       r => r.ORDER_DATE || '',
  sku:        r => String(r.SKU || '').toLowerCase(),
  supplier:   r => (cpSupplier(r.SKU) || '').toLowerCase(),
  qty:        r => Number(r.ORDER_QTY)             || 0,
  price:      r => Number(r.PRICE)                 || 0,
  discount:   r => Number(r.EST_COUPON_DISCOUNT)   || 0,
  order_disc: r => Number(r.ORDER_TOTAL_DISCOUNTS) || 0,
  sales:      r => Number(r.ORDER_PRODUCT_SALES)   || 0,
  margin:     r => Number(r.ORDER_MARGIN)          || 0,
  profit:     r => Number(r.ORDER_PROFIT)          || 0,
};

// ── Load (lazy, first visit only) ────────────────────────────────────────────

async function loadCouponData() {
  if (S.couponSku && S.couponOrder) {
    renderCouponPage();
    return;
  }

  document.getElementById('couponHead').innerHTML = '';
  document.getElementById('couponBody').innerHTML =
    `<tr><td colspan="17" style="text-align:center;padding:48px;color:var(--text3);">
       <div style="display:inline-block;width:28px;height:28px;border:2px solid var(--border);border-top-color:#0ea5e9;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:10px;"></div>
       <div>Loading coupon data…</div>
     </td></tr>`;

  try {
    const [couponSku, couponOrder] = await Promise.all([
      swrJSON('/api/coupon-sku',   d => { S.couponSku = d;   populateCouponDates(); if (S.page === 'coupon') renderCouponPage(); }),
      swrJSON('/api/coupon-order', d => { S.couponOrder = d; if (S.page === 'coupon') renderCouponPage(); }),
    ]);

    S.couponSku   = couponSku;
    S.couponOrder = couponOrder;

    populateCouponDates();
    renderCouponPage();
  } catch (err) {
    if (err.message === 'unauthorized') return; // swrJSON already redirected to login
    document.getElementById('couponBody').innerHTML =
      `<tr><td colspan="17" style="text-align:center;padding:40px;color:#ef4444;font-size:13px;">${err.message}</td></tr>`;
  }
}
window.loadCouponData = loadCouponData;

// ── View toggle ───────────────────────────────────────────────────────────────

// Topbar toggle = platform (Amazon | Shopify); the SKU/Order level is a pair of
// .lvl-pill buttons in the controls row (couponAmzLevel / couponShopLevelWrap).
function applyCouponControls() {
  const isShop = (S.couponPlatform || 'amazon') === 'shopify';
  const view = S.couponView || 'sku';
  const show = (id, on, disp) => {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? (disp || 'flex') : 'none';
  };
  show('couponAmzLevel',    !isShop);
  show('couponDateWrap',    !isShop);
  show('couponSkuControls', !isShop && view === 'sku');
  show('couponOrdControls', !isShop && view === 'order');
  show('couponShopControls', isShop);
  show('couponShopSummary',  isShop, 'block');
  const prevBtn = document.getElementById('couponPrevDlBtn');
  if (prevBtn) prevBtn.style.display = isShop ? 'none' : '';
}

function setCouponPlatform(platform, btn) {
  S.couponPlatform = platform;
  document.querySelectorAll('#couponToggle .toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  applyCouponControls();
  renderCouponPage();
}
window.setCouponPlatform = setCouponPlatform;

function setCouponLevel(view, btn) {
  S.couponView = view;
  if (btn) {
    document.querySelectorAll('#couponAmzLevel .lvl-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  applyCouponControls();
  renderCouponPage();
}
window.setCouponLevel = setCouponLevel;

function setCouponShopLevel(view, btn) {
  S.couponShopLevel = view;
  if (btn) {
    document.querySelectorAll('#couponShopLevelWrap .lvl-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  renderCouponPage();
}
window.setCouponShopLevel = setCouponShopLevel;

// ── Main render dispatcher ────────────────────────────────────────────────────

function renderCouponPage() {
  cpEnsureSuppliers();
  cpPopulateSupplierSel();
  cpPopulateShopPct();
  if ((S.couponPlatform || 'amazon') === 'shopify') {
    if (!S.couponShopSku || !S.couponShopOrder) { loadCouponShopData(); return; }
    renderCouponShopify();
  } else {
    if (!S.couponSku || !S.couponOrder) { loadCouponData(); return; }
    if ((S.couponView || 'sku') === 'sku') renderCouponSkuTable();
    else renderCouponOrderTable();
  }
  if (typeof updateDownloadHints === 'function') updateDownloadHints();
}
window.renderCouponPage = renderCouponPage;

// ── SKU Level ─────────────────────────────────────────────────────────────────
// One row per (ORDER_DATE, SKU) from DAILY_SKU_COUPON_PROFIT, month-to-date.

function renderCouponSkuTable() {
  const data      = getCouponSkuFiltered();
  const searchRaw = (document.getElementById('couponSkuSearch') || {}).value || '';
  const query     = searchRaw.trim().toLowerCase();

  const clrBtn = document.getElementById('couponSkuSearchClear');
  if (clrBtn) clrBtn.style.display = query ? '' : 'none';

  // Set header
  document.getElementById('couponHead').innerHTML = `
    <tr>
      <th style="text-align:right;min-width:40px;width:40px;">#</th>
      ${cpTh('a_sku', 'sku', 'SKU', { align: 'left', min: '130px' })}
      ${cpTh('a_sku', 'supplier', 'Supplier', { align: 'left', min: '110px' })}
      ${cpTh('a_sku', 'order_date', 'Order Date', { min: '100px' })}
      ${cpTh('a_sku', 'qty', 'Qty', { min: '70px' })}
      ${cpTh('a_sku', 'product_sales', 'Product Sales', { min: '115px' })}
      ${cpTh('a_sku', 'margin', 'Margin', { min: '110px' })}
      ${cpTh('a_sku', 'coupon_fee', 'Coupon Fee', { min: '105px' })}
      ${cpTh('a_sku', 'shipping_fee', 'Shipping Fee', { min: '100px' })}
      ${cpTh('a_sku', 'dropship_fee', 'Dropship Fee', { min: '100px' })}
      ${cpTh('a_sku', 'new_margin', 'New Margin', { min: '110px' })}
      ${cpTh('a_sku', 'profit', 'Profit', { min: '105px' })}
      ${cpTh('a_sku', 'refund_qty', 'Refund Qty', { min: '90px' })}
      ${cpTh('a_sku', 'refund_amt', 'Refund Amt', { min: '105px' })}
      ${cpTh('a_sku', 'net_qty', 'Net Qty', { min: '80px' })}
      ${cpTh('a_sku', 'net_profit', 'Net Profit', { min: '110px' })}
      ${cpTh('a_sku', 'unit_cost', 'Unit Cost', { min: '95px' })}
    </tr>`;

  let rows = [...data];

  if (query) rows = rows.filter(r => (r.SKU || '').toLowerCase().includes(query));

  rows = cpSortRows(rows, 'a_sku', CP_AMZ_FNS);

  const tbody = document.getElementById('couponBody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="17" style="text-align:center;padding:40px;color:var(--text3);">${query ? `No SKUs matching "${searchRaw}"` : 'No data for selected period'}</td></tr>`;
    return;
  }

  const V = CP_V;
  tbody.innerHTML = rows.map((r, i) => {
    const margin    = Number(r.ORDER_MARGIN)     || 0;
    const couponFee = Number(r.ORDER_COUPON_FEE) || 0;
    const newMargin = Number(r.ORDER_NEW_MARGIN) || 0;
    const profit    = Number(r.ORDER_PROFIT)     || 0;
    const netQty    = Number(r.NET_QTY)          || 0;
    const netProfit = Number(r.NET_PROFIT)       || 0;
    return `
    <tr>
      <td style="text-align:right;font-size:12px;color:var(--text3);">${i + 1}</td>
      <td style="text-align:left;font-weight:700;color:var(--text);font-size:14px;">${r.SKU || '—'}${cpDsBadge(r)}</td>
      ${cpSupplierCell(r.SKU)}
      <td style="text-align:right;font-size:12px;color:var(--text2);">${String(r.ORDER_DATE || '—').slice(0, 10)}</td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${Math.round(Number(r.ORDER_QTY) || 0).toLocaleString()}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmt(Number(r.ORDER_PRODUCT_SALES) || 0)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${margin < 0 ? '#ef4444' : 'var(--text)'};">${fmt(margin)}</span></td>
      <td style="text-align:right;"><span style="${V}color:#f59e0b;">${fmt(couponFee)}</span></td>
      ${cpFeeCell(r.ORDER_SHIPPING_FEE)}
      ${cpFeeCell(r.ORDER_DROPSHIP_FEE)}
      <td style="text-align:right;"><span style="${V}color:${newMargin < 0 ? '#ef4444' : '#10b981'};">${fmt(newMargin)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${profit < 0 ? '#ef4444' : '#10b981'};">${fmt(profit)}</span></td>
      ${cpRefundCells(r)}
      <td style="text-align:right;"><span style="${V}color:var(--text);">${Math.round(netQty).toLocaleString()}</span></td>
      <td style="text-align:right;"><span style="${V}color:${netProfit < 0 ? '#ef4444' : '#10b981'};">${fmt(netProfit)}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text2);">${fmt(Number(r.UNIT_COST) || 0)}</span></td>
    </tr>`;
  }).join('');
}

// ── Order Level ───────────────────────────────────────────────────────────────
// One row per (ORDER_ID, SKU) from DAILY_ORDER_COUPON_PROFIT, month-to-date.

function renderCouponOrderTable() {
  const data     = getCouponOrderFiltered();
  const searchRaw = (document.getElementById('couponOrdSearch') || {}).value || '';
  const query    = searchRaw.trim().toLowerCase();

  const clrBtn = document.getElementById('couponOrdSearchClear');
  if (clrBtn) clrBtn.style.display = query ? '' : 'none';

  // Set header
  document.getElementById('couponHead').innerHTML = `
    <tr>
      <th style="text-align:right;min-width:40px;width:40px;">#</th>
      ${cpTh('a_ord', 'order_id', 'Order ID', { align: 'left', min: '185px' })}
      ${cpTh('a_ord', 'sku', 'SKU', { align: 'left', min: '130px' })}
      ${cpTh('a_ord', 'supplier', 'Supplier', { align: 'left', min: '110px' })}
      ${cpTh('a_ord', 'order_date', 'Order Date', { min: '100px' })}
      ${cpTh('a_ord', 'qty', 'Qty', { min: '60px' })}
      ${cpTh('a_ord', 'product_sales', 'Product Sales', { min: '115px' })}
      ${cpTh('a_ord', 'margin', 'Margin', { min: '110px' })}
      ${cpTh('a_ord', 'coupon_fee', 'Coupon Fee', { min: '105px' })}
      ${cpTh('a_ord', 'shipping_fee', 'Shipping Fee', { min: '100px' })}
      ${cpTh('a_ord', 'dropship_fee', 'Dropship Fee', { min: '100px' })}
      ${cpTh('a_ord', 'new_margin', 'New Margin', { min: '110px' })}
      ${cpTh('a_ord', 'profit', 'Profit', { min: '105px' })}
      ${cpTh('a_ord', 'refund_qty', 'Refund Qty', { min: '90px' })}
      ${cpTh('a_ord', 'refund_amt', 'Refund Amt', { min: '105px' })}
      ${cpTh('a_ord', 'net_profit', 'Net Profit', { min: '110px' })}
      ${cpTh('a_ord', 'unit_cost', 'Unit Cost', { min: '95px' })}
    </tr>`;

  let rows = [...data];

  if (query) {
    rows = rows.filter(r =>
      (r.ORDER_ID || '').toLowerCase().includes(query) ||
      (r.SKU      || '').toLowerCase().includes(query)
    );
  }

  rows = cpSortRows(rows, 'a_ord', CP_AMZ_FNS);

  const tbody = document.getElementById('couponBody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="17" style="text-align:center;padding:40px;color:var(--text3);">${query ? `No orders matching "${searchRaw}"` : 'No data for selected period'}</td></tr>`;
    return;
  }

  const V = CP_V;
  tbody.innerHTML = rows.map((r, i) => {
    const margin    = Number(r.ORDER_MARGIN)     || 0;
    const newMargin = Number(r.ORDER_NEW_MARGIN) || 0;
    const profit    = Number(r.ORDER_PROFIT)     || 0;
    const netProfit = Number(r.NET_PROFIT)       || 0;
    return `
    <tr>
      <td style="text-align:right;font-size:12px;color:var(--text3);">${i + 1}</td>
      <td style="text-align:left;font-size:12px;color:var(--text2);font-family:monospace;">${r.ORDER_ID || '—'}</td>
      <td style="text-align:left;font-weight:700;font-size:13px;color:var(--text);">${r.SKU || '—'}${cpDsBadge(r)}</td>
      ${cpSupplierCell(r.SKU)}
      <td style="text-align:right;font-size:12px;color:var(--text2);">${String(r.ORDER_DATE || '—').slice(0, 10)}</td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${Math.round(Number(r.ORDER_QTY) || 0).toLocaleString()}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmt(Number(r.ORDER_PRODUCT_SALES) || 0)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${margin < 0 ? '#ef4444' : 'var(--text)'};">${fmt(margin)}</span></td>
      <td style="text-align:right;"><span style="${V}color:#f59e0b;">${fmt(Number(r.ORDER_COUPON_FEE) || 0)}</span></td>
      ${cpFeeCell(r.ORDER_SHIPPING_FEE)}
      ${cpFeeCell(r.ORDER_DROPSHIP_FEE)}
      <td style="text-align:right;"><span style="${V}color:${newMargin < 0 ? '#ef4444' : '#10b981'};">${fmt(newMargin)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${profit < 0 ? '#ef4444' : '#10b981'};">${fmt(profit)}</span></td>
      ${cpRefundCells(r)}
      <td style="text-align:right;"><span style="${V}color:${netProfit < 0 ? '#ef4444' : '#10b981'};">${fmt(netProfit)}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text2);">${fmt(Number(r.UNIT_COST) || 0)}</span></td>
    </tr>`;
  }).join('');
}

// ── Clear search helpers ──────────────────────────────────────────────────────

function clearCouponSkuSearch() {
  const inp = document.getElementById('couponSkuSearch');
  if (inp) inp.value = '';
  const btn = document.getElementById('couponSkuSearchClear');
  if (btn) btn.style.display = 'none';
  renderCouponPage();
}
window.clearCouponSkuSearch = clearCouponSkuSearch;

function clearCouponOrdSearch() {
  const inp = document.getElementById('couponOrdSearch');
  if (inp) inp.value = '';
  const btn = document.getElementById('couponOrdSearchClear');
  if (btn) btn.style.display = 'none';
  renderCouponPage();
}
window.clearCouponOrdSearch = clearCouponOrdSearch;

// ── Shopify coupon (Summer Sale batch) ───────────────────────────────────────
// Attribution rule: any sale of a SKU in MARKETING.COUPON_EXECUTION_LOG between
// the batch start/end dates counts as a coupon sale. ORDER_TOTAL_DISCOUNTS is
// the cross-check (did the order actually carry a discount). SALES_MARGIN from
// the mart is already net of the discount, so Profit = margin − cost×qty (real, not est-coupon based).

const CP_SHOP_START = '2026-07-14';

function cpBool(v) {
  return v === true || v === 1 || Number(v) === 1 ||
    (typeof v === 'string' && (v.toLowerCase() === 'true' || v === '1'));
}

// Batch labels: SUMMER_2026 = the July run, AUGUST_2026 = the August run, etc.
const CP_BATCH_NAMES = { SUMMER_2026: 'July', AUGUST_2026: 'August' };
function cpBatchName(b)  { return CP_BATCH_NAMES[b] || String(b || '—'); }
function cpBatchDates(r) {
  const f = d => String(d || '').slice(5, 10).replace('-', '/');
  return r && r.START_DATE ? `${f(r.START_DATE)}–${f(r.END_DATE)}` : '';
}

async function loadCouponShopData() {
  document.getElementById('couponHead').innerHTML = '';
  document.getElementById('couponBody').innerHTML =
    `<tr><td colspan="14" style="text-align:center;padding:48px;color:var(--text3);">
       <div style="display:inline-block;width:28px;height:28px;border:2px solid var(--border);border-top-color:#0ea5e9;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:10px;"></div>
       <div>Loading Shopify coupon data…</div>
     </td></tr>`;
  try {
    const [shopSku, shopOrder] = await Promise.all([
      swrJSON('/api/coupon-sku?window=shopify',   d => { S.couponShopSku = d;   if (S.page === 'coupon') renderCouponPage(); }),
      swrJSON('/api/coupon-order?window=shopify', d => { S.couponShopOrder = d; if (S.page === 'coupon') renderCouponPage(); }),
    ]);
    S.couponShopSku   = shopSku;
    S.couponShopOrder = shopOrder;
    renderCouponPage();
  } catch (err) {
    if (err.message === 'unauthorized') return; // swrJSON already redirected to login
    document.getElementById('couponBody').innerHTML =
      `<tr><td colspan="14" style="text-align:center;padding:40px;color:#ef4444;font-size:13px;">${err.message}</td></tr>`;
  }
}

function getCouponShopFiltered() {
  const level = S.couponShopLevel || 'sku';
  const scope = (document.getElementById('couponShopScope') || {}).value || 'target';
  const query = String(((document.getElementById('couponShopSearch') || {}).value || '')).trim().toLowerCase();
  let rows = level === 'sku' ? (S.couponShopSku || []) : (S.couponShopOrder || []);
  if (scope === 'target') rows = rows.filter(r => cpBool(r.IS_TARGET));
  const pctV = ((document.getElementById('couponShopPct') || {}).value) || '';
  if (pctV) rows = rows.filter(r => Math.round(Number(r.GROUP_PCT) || 0) === Number(pctV));
  // SKU-level-only toggles (order rows always have qty, and lack avail-at-push)
  if (level === 'sku') {
    if ((document.getElementById('couponShopSoldOnly')  || {}).checked) rows = rows.filter(r => (Number(r.ORDER_QTY) || 0) > 0);
    if ((document.getElementById('couponShopAvailOnly') || {}).checked) rows = rows.filter(r => (Number(r.AVAILABLE_AT_PUSH) || 0) > 0);
  }
  if (query) {
    rows = rows.filter(r =>
      String(r.SKU || '').toLowerCase().includes(query) ||
      String(r.ORDER_NAME || '').toLowerCase().includes(query) ||
      String(r.ORDER_ID || '').toLowerCase().includes(query));
  }
  return cpSupplierFilter(rows);
}
window.getCouponShopFiltered = getCouponShopFiltered;

// Populate the Discount % filter from the distinct GROUP_PCT tiers in the data.
function cpPopulateShopPct() {
  const sel = document.getElementById('couponShopPct');
  if (!sel) return;
  const pcts = new Set();
  [...(S.couponShopSku || []), ...(S.couponShopOrder || [])].forEach(r => {
    const p = Math.round(Number(r.GROUP_PCT) || 0);
    if (p) pcts.add(p);
  });
  const prev = sel.value;
  sel.innerHTML = `<option value="">All %</option>` +
    [...pcts].sort((a, b) => a - b).map(p => `<option value="${p}">${p}%</option>`).join('');
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function cpShopSummary() {
  const scope = (document.getElementById('couponShopScope') || {}).value || 'target';
  const box = document.getElementById('couponShopSummary');
  if (!box) return;
  // one line per batch (July / August / …), chronological
  const batches = {};
  const put = (r, key) => {
    const b = batches[r.BATCH] = batches[r.BATCH] || { skus: [], ords: [], start: r.START_DATE, row: r };
    b[key].push(r);
    if (r.START_DATE && (!b.start || String(r.START_DATE) < String(b.start))) { b.start = r.START_DATE; b.row = r; }
  };
  (S.couponShopSku   || []).forEach(r => put(r, 'skus'));
  (S.couponShopOrder || []).forEach(r => put(r, 'ords'));
  const lines = Object.keys(batches)
    .sort((a, b) => String(batches[a].start).localeCompare(String(batches[b].start)))
    .map(name => {
      const b = batches[name];
      const skus = b.skus.filter(r => scope !== 'target' || cpBool(r.IS_TARGET));
      const ords = b.ords.filter(r => scope !== 'target' || cpBool(r.IS_TARGET));
      const nTarget = b.skus.filter(r => cpBool(r.IS_TARGET)).length;
      const nSwept  = b.skus.length - nTarget;
      const orderIds = new Set(ords.map(r => r.ORDER_ID));
      const units  = ords.reduce((s, r) => s + (Number(r.ORDER_QTY) || 0), 0);
      const sales  = ords.reduce((s, r) => s + (Number(r.ORDER_PRODUCT_SALES) || 0), 0);
      const disc   = ords.reduce((s, r) => s + (Number(r.EST_COUPON_DISCOUNT) || 0), 0);
      const profit = ords.reduce((s, r) => s + (Number(r.ORDER_PROFIT) || 0), 0);
      const sold   = skus.filter(r => (Number(r.ORDER_QTY) || 0) > 0).length;
      return `<b style="color:var(--text);">${cpBatchName(name)}</b>` +
        ` <span style="color:var(--text3);">(${cpBatchDates(b.row)})</span>` +
        ` · <b style="color:var(--text);">${nTarget.toLocaleString()}</b> target SKUs` +
        (nSwept ? ` + ${nSwept.toLocaleString()} swept` : '') +
        ` · orders <b style="color:var(--text);">${orderIds.size.toLocaleString()}</b>` +
        ` · units <b style="color:var(--text);">${Math.round(units).toLocaleString()}</b>` +
        ` · sales <b style="color:var(--text);">${fmt(sales)}</b>` +
        ` · est. coupon <b style="color:#f59e0b;">${fmt(disc)}</b>` +
        ` · profit <b style="color:${profit < 0 ? '#ef4444' : '#10b981'};">${fmt(profit)}</b>` +
        (sold ? ` · SKUs with sales: <b style="color:var(--text);">${sold.toLocaleString()}</b>` : '');
    });
  box.innerHTML = lines.length ? lines.join('<div style="height:6px;"></div>') : 'No coupon batches found.';
}

function renderCouponShopify() {
  cpShopSummary();
  const level = S.couponShopLevel || 'sku';
  // Sold/In-stock toggles only make sense at SKU level
  const skuOnly = document.getElementById('couponShopSkuOnlyFilters');
  if (skuOnly) skuOnly.style.display = level === 'sku' ? 'flex' : 'none';
  const searchRaw = String(((document.getElementById('couponShopSearch') || {}).value || '')).trim();
  const clrBtn = document.getElementById('couponShopSearchClear');
  if (clrBtn) clrBtn.style.display = searchRaw ? '' : 'none';

  let rows = getCouponShopFiltered();
  rows = level === 'sku'
    ? cpSortRows(rows, 's_sku', CP_SHOP_SKU_FNS)
    : cpSortRows(rows, 's_ord', CP_SHOP_ORD_FNS);

  if (level === 'sku') renderCouponShopSkuTable(rows, searchRaw);
  else renderCouponShopOrderTable(rows, searchRaw);
}

function cpShopBadges(r) {
  const pct = Math.round(Number(r.GROUP_PCT) || 0);
  const tgt = cpBool(r.IS_TARGET);
  const batch = r.BATCH
    ? `<span style="font-size:10px;font-weight:700;padding:1px 5px;border-radius:6px;vertical-align:middle;
        background:var(--input);color:var(--text3);border:1px solid var(--border);">${(cpBatchName(r.BATCH) || '').slice(0, 3).toUpperCase()}</span> `
    : '';
  return batch +
    `<span style="font-size:11px;font-weight:700;padding:1px 6px;border-radius:6px;background:rgba(14,165,233,.12);color:#0ea5e9;border:1px solid rgba(14,165,233,.3);">${pct}%</span>` +
    (tgt ? '' : ` <span title="Not a slow-traffic target — variant swept in because Shopify discounts apply per product"
      style="font-size:10px;font-weight:700;padding:1px 5px;border-radius:6px;vertical-align:middle;
      background:rgba(168,85,247,.15);color:#a855f7;border:1px solid rgba(168,85,247,.3);">SWEPT</span>`);
}

function renderCouponShopSkuTable(rows, searchRaw) {
  document.getElementById('couponHead').innerHTML = `
    <tr>
      <th style="text-align:right;min-width:40px;width:40px;">#</th>
      ${cpTh('s_sku', 'sku', 'SKU', { align: 'left', min: '150px' })}
      ${cpTh('s_sku', 'supplier', 'Supplier', { align: 'left', min: '110px' })}
      ${cpTh('s_sku', 'pct', 'Discount', { min: '75px' })}
      ${cpTh('s_sku', 'price_push', 'Price @ Push', { min: '100px' })}
      ${cpTh('s_sku', 'unit_cost', 'Unit Cost', { min: '95px' })}
      ${cpTh('s_sku', 'avail', 'Avail @ Push', { min: '95px' })}
      ${cpTh('s_sku', 'orders', 'Orders', { min: '75px' })}
      ${cpTh('s_sku', 'qty', 'Qty Sold', { min: '80px' })}
      ${cpTh('s_sku', 'sales', 'Product Sales', { min: '115px' })}
      ${cpTh('s_sku', 'discount', 'Est Coupon $', { min: '110px' })}
      ${cpTh('s_sku', 'margin', 'Margin', { min: '110px' })}
      ${cpTh('s_sku', 'profit', 'Profit', { min: '105px' })}
      ${cpTh('s_sku', 'date', 'Last Order', { min: '105px' })}
    </tr>`;
  const tbody = document.getElementById('couponBody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:40px;color:var(--text3);">${searchRaw ? `No SKUs matching "${searchRaw}"` : 'No SKUs in scope'}</td></tr>`;
    return;
  }
  const V = CP_V;
  tbody.innerHTML = rows.map((r, i) => {
    const qty    = Number(r.ORDER_QTY)    || 0;
    const profit = Number(r.ORDER_PROFIT) || 0;
    const noSale = !qty;
    return `
    <tr>
      <td style="text-align:right;font-size:12px;color:var(--text3);">${i + 1}</td>
      <td style="text-align:left;font-weight:700;color:var(--text);font-size:14px;">${r.SKU || '—'} ${cpShopBadges(r)}</td>
      ${cpSupplierCell(r.SKU)}
      <td style="text-align:right;font-size:12px;color:var(--text2);">${Math.round(Number(r.GROUP_PCT) || 0)}%</td>
      <td style="text-align:right;"><span style="${V}color:var(--text2);">${fmt(Number(r.PRICE_AT_PUSH) || 0)}</span></td>
      <td style="text-align:right;">${r.UNIT_COST == null ? '<span style="color:var(--text3);">—</span>' : `<span style="${V}color:var(--text2);">${fmt(Number(r.UNIT_COST))}</span>`}</td>
      <td style="text-align:right;font-size:12px;color:var(--text2);">${r.AVAILABLE_AT_PUSH == null ? '—' : Math.round(Number(r.AVAILABLE_AT_PUSH)).toLocaleString()}</td>
      <td style="text-align:right;"><span style="${V}color:${noSale ? 'var(--text3)' : 'var(--text)'};">${Math.round(Number(r.ORDER_COUNT) || 0).toLocaleString()}</span></td>
      <td style="text-align:right;"><span style="${V}color:${noSale ? 'var(--text3)' : 'var(--text)'};">${Math.round(qty).toLocaleString()}</span></td>
      <td style="text-align:right;"><span style="${V}color:${noSale ? 'var(--text3)' : 'var(--text)'};">${fmt(Number(r.ORDER_PRODUCT_SALES) || 0)}</span></td>
      <td style="text-align:right;"><span style="${V}color:#f59e0b;">${fmt(Number(r.EST_COUPON_DISCOUNT) || 0)}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmt(Number(r.ORDER_MARGIN) || 0)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${noSale ? 'var(--text3)' : profit < 0 ? '#ef4444' : '#10b981'};">${fmt(profit)}</span></td>
      <td style="text-align:right;font-size:12px;color:var(--text2);">${r.LAST_COUPON_ORDER_DATE ? String(r.LAST_COUPON_ORDER_DATE).slice(0, 10) : '—'}</td>
    </tr>`;
  }).join('');
}

function renderCouponShopOrderTable(rows, searchRaw) {
  document.getElementById('couponHead').innerHTML = `
    <tr>
      <th style="text-align:right;min-width:40px;width:40px;">#</th>
      ${cpTh('s_ord', 'order', 'Order', { align: 'left', min: '110px' })}
      ${cpTh('s_ord', 'date', 'Order Date', { min: '100px' })}
      ${cpTh('s_ord', 'sku', 'SKU', { align: 'left', min: '150px' })}
      ${cpTh('s_ord', 'supplier', 'Supplier', { align: 'left', min: '110px' })}
      ${cpTh('s_ord', 'qty', 'Qty', { min: '60px' })}
      ${cpTh('s_ord', 'price', 'Price', { min: '90px' })}
      ${cpTh('s_ord', 'discount', 'Est Coupon $', { min: '110px' })}
      ${cpTh('s_ord', 'order_disc', 'Order Discount $', { min: '120px' })}
      ${cpTh('s_ord', 'sales', 'Product Sales', { min: '115px' })}
      ${cpTh('s_ord', 'margin', 'Margin', { min: '110px' })}
      ${cpTh('s_ord', 'profit', 'Profit', { min: '105px' })}
    </tr>`;
  const tbody = document.getElementById('couponBody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:40px;color:var(--text3);">${searchRaw ? `No orders matching "${searchRaw}"` : `No coupon orders yet — accumulating since ${CP_SHOP_START}`}</td></tr>`;
    return;
  }
  const V = CP_V;
  tbody.innerHTML = rows.map((r, i) => {
    const profit = Number(r.ORDER_PROFIT) || 0;
    const od = Number(r.ORDER_TOTAL_DISCOUNTS) || 0;
    return `
    <tr>
      <td style="text-align:right;font-size:12px;color:var(--text3);">${i + 1}</td>
      <td style="text-align:left;font-size:12px;color:var(--text2);font-family:monospace;">${r.ORDER_NAME || r.ORDER_ID || '—'}</td>
      <td style="text-align:right;font-size:12px;color:var(--text2);">${String(r.ORDER_DATE || '—').slice(0, 10)}</td>
      <td style="text-align:left;font-weight:700;font-size:13px;color:var(--text);">${r.SKU || '—'} ${cpShopBadges(r)}</td>
      ${cpSupplierCell(r.SKU)}
      <td style="text-align:right;"><span style="${V}color:var(--text);">${Math.round(Number(r.ORDER_QTY) || 0).toLocaleString()}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text2);">${fmt(Number(r.PRICE) || 0)}</span></td>
      <td style="text-align:right;"><span style="${V}color:#f59e0b;">${fmt(Number(r.EST_COUPON_DISCOUNT) || 0)}</span></td>
      <td style="text-align:right;">${od ? `<span style="${V}color:#f59e0b;">${fmt(od)}</span>` : `<span style="color:var(--text3);" title="Order carried no discount — sold at full price">—</span>`}</td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmt(Number(r.ORDER_PRODUCT_SALES) || 0)}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmt(Number(r.ORDER_MARGIN) || 0)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${profit < 0 ? '#ef4444' : '#10b981'};">${fmt(profit)}</span></td>
    </tr>`;
  }).join('');
}

function clearCouponShopSearch() {
  const inp = document.getElementById('couponShopSearch');
  if (inp) inp.value = '';
  const btn = document.getElementById('couponShopSearchClear');
  if (btn) btn.style.display = 'none';
  renderCouponPage();
}
window.clearCouponShopSearch = clearCouponShopSearch;
