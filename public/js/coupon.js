// ── Coupon Order Page ─────────────────────────────────────────────────────────
// Data = month-to-date: 1st of current month → yesterday.
// (On the 1st of a month the tables hold the FULL previous month, since order
// data only exists up to "yesterday".) Rebuilt daily by the coupon pipeline.

// Coupon uses its own date selector — independent of the global topbar filter.
function getCouponSkuFiltered() {
  if (!S.couponSku) return [];
  if (!S.couponDate) return S.couponSku;
  return S.couponSku.filter(row => String(row.ORDER_DATE).slice(0, 10) === S.couponDate);
}

function getCouponOrderFiltered() {
  if (!S.couponOrder) return [];
  if (!S.couponDate) return S.couponOrder;
  return S.couponOrder.filter(row => String(row.ORDER_DATE).slice(0, 10) === S.couponDate);
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

// ── Load (lazy, first visit only) ────────────────────────────────────────────

async function loadCouponData() {
  if (S.couponSku && S.couponOrder) {
    renderCouponPage();
    return;
  }

  document.getElementById('couponHead').innerHTML = '';
  document.getElementById('couponBody').innerHTML =
    `<tr><td colspan="16" style="text-align:center;padding:48px;color:var(--text3);">
       <div style="display:inline-block;width:28px;height:28px;border:2px solid var(--border);border-top-color:#0ea5e9;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:10px;"></div>
       <div>Loading coupon data…</div>
     </td></tr>`;

  try {
    const [sr, or_] = await Promise.all([
      fetch('/api/coupon-sku'),
      fetch('/api/coupon-order'),
    ]);
    if (sr.status === 401 || or_.status === 401) { window.location.href = '/login.html'; return; }
    if (!sr.ok)  throw new Error(`Coupon SKU API: HTTP ${sr.status}`);
    if (!or_.ok) throw new Error(`Coupon Order API: HTTP ${or_.status}`);

    S.couponSku   = await sr.json();
    S.couponOrder = await or_.json();

    populateCouponDates();
    renderCouponPage();
  } catch (err) {
    document.getElementById('couponBody').innerHTML =
      `<tr><td colspan="16" style="text-align:center;padding:40px;color:#ef4444;font-size:13px;">${err.message}</td></tr>`;
  }
}
window.loadCouponData = loadCouponData;

// ── View toggle ───────────────────────────────────────────────────────────────

function setCouponView(view, btn) {
  S.couponView = view;
  document.querySelectorAll('#couponToggle .toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('couponSkuControls').style.display  = view === 'sku'     ? 'flex' : 'none';
  document.getElementById('couponOrdControls').style.display  = view === 'order'   ? 'flex' : 'none';
  const shopCtl = document.getElementById('couponShopControls');
  if (shopCtl) shopCtl.style.display = view === 'shopify' ? 'flex' : 'none';
  // The MTD date filter + "Last Month" CSV only apply to the Amazon coupon views.
  const dateWrap = document.getElementById('couponDateWrap');
  if (dateWrap) dateWrap.style.display = view === 'shopify' ? 'none' : 'flex';
  const prevBtn = document.getElementById('couponPrevDlBtn');
  if (prevBtn) prevBtn.style.display = view === 'shopify' ? 'none' : '';
  const shopSum = document.getElementById('couponShopSummary');
  if (shopSum) shopSum.style.display = view === 'shopify' ? '' : 'none';
  renderCouponPage();
}
window.setCouponView = setCouponView;

// ── Main render dispatcher ────────────────────────────────────────────────────

function renderCouponPage() {
  const view = S.couponView || 'sku';
  if (view === 'shopify') {
    if (!S.couponShopSku || !S.couponShopOrder) { loadCouponShopData(); return; }
    renderCouponShopify();
  } else {
    if (!S.couponSku || !S.couponOrder) { loadCouponData(); return; }
    if (view === 'sku') renderCouponSkuTable();
    else renderCouponOrderTable();
  }
  if (typeof updateDownloadHints === 'function') updateDownloadHints();
}
window.renderCouponPage = renderCouponPage;

// ── SKU Level ─────────────────────────────────────────────────────────────────
// One row per (ORDER_DATE, SKU) from DAILY_SKU_COUPON_PROFIT, month-to-date.

function renderCouponSkuTable() {
  const data      = getCouponSkuFiltered();
  const sortBy    = (document.getElementById('couponSkuSort') || {}).value || 'order_date';
  const sortDir   = (document.getElementById('couponSkuDir')  || {}).value || 'desc';
  const searchRaw = (document.getElementById('couponSkuSearch') || {}).value || '';
  const query     = searchRaw.trim().toLowerCase();

  const clrBtn = document.getElementById('couponSkuSearchClear');
  if (clrBtn) clrBtn.style.display = query ? '' : 'none';

  // Set header
  document.getElementById('couponHead').innerHTML = `
    <tr>
      <th style="text-align:right;min-width:40px;width:40px;">#</th>
      <th style="text-align:left;min-width:130px;">SKU</th>
      <th style="min-width:100px;">Order Date</th>
      <th style="min-width:70px;">Qty</th>
      <th style="min-width:115px;">Product Sales</th>
      <th style="min-width:110px;">Margin</th>
      <th style="min-width:105px;">Coupon Fee</th>
      <th style="min-width:100px;">Shipping Fee</th>
      <th style="min-width:100px;">Dropship Fee</th>
      <th style="min-width:110px;">New Margin</th>
      <th style="min-width:105px;">Profit</th>
      <th style="min-width:90px;">Refund Qty</th>
      <th style="min-width:105px;">Refund Amt</th>
      <th style="min-width:80px;">Net Qty</th>
      <th style="min-width:110px;">Net Profit</th>
      <th style="min-width:95px;">Unit Cost</th>
    </tr>`;

  let rows = [...data];

  if (query) rows = rows.filter(r => (r.SKU || '').toLowerCase().includes(query));

  const sortFn = {
    order_date:    r => r.ORDER_DATE || '',
    sku:           r => r.SKU || '',
    qty:           r => Number(r.ORDER_QTY)           || 0,
    product_sales: r => Number(r.ORDER_PRODUCT_SALES) || 0,
    coupon_fee:    r => Number(r.ORDER_COUPON_FEE)    || 0,
    new_margin:    r => Number(r.ORDER_NEW_MARGIN)    || 0,
    margin:        r => Number(r.ORDER_MARGIN)        || 0,
    profit:        r => Number(r.ORDER_PROFIT)        || 0,
    refund_qty:    r => Number(r.REFUND_QTY)          || 0,
    net_profit:    r => Number(r.NET_PROFIT)          || 0,
  }[sortBy] || (r => r.ORDER_DATE || '');

  rows.sort((a, b) => {
    const va = sortFn(a), vb = sortFn(b);
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  const tbody = document.getElementById('couponBody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="16" style="text-align:center;padding:40px;color:var(--text3);">${query ? `No SKUs matching "${searchRaw}"` : 'No data for selected period'}</td></tr>`;
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
  const sortBy   = (document.getElementById('couponOrdSort') || {}).value || 'order_date';
  const sortDir  = (document.getElementById('couponOrdDir')  || {}).value || 'desc';
  const searchRaw = (document.getElementById('couponOrdSearch') || {}).value || '';
  const query    = searchRaw.trim().toLowerCase();

  const clrBtn = document.getElementById('couponOrdSearchClear');
  if (clrBtn) clrBtn.style.display = query ? '' : 'none';

  // Set header
  document.getElementById('couponHead').innerHTML = `
    <tr>
      <th style="text-align:right;min-width:40px;width:40px;">#</th>
      <th style="text-align:left;min-width:185px;">Order ID</th>
      <th style="text-align:left;min-width:130px;">SKU</th>
      <th style="min-width:100px;">Order Date</th>
      <th style="min-width:60px;">Qty</th>
      <th style="min-width:115px;">Product Sales</th>
      <th style="min-width:110px;">Margin</th>
      <th style="min-width:105px;">Coupon Fee</th>
      <th style="min-width:100px;">Shipping Fee</th>
      <th style="min-width:100px;">Dropship Fee</th>
      <th style="min-width:110px;">New Margin</th>
      <th style="min-width:105px;">Profit</th>
      <th style="min-width:90px;">Refund Qty</th>
      <th style="min-width:105px;">Refund Amt</th>
      <th style="min-width:110px;">Net Profit</th>
      <th style="min-width:95px;">Unit Cost</th>
    </tr>`;

  let rows = [...data];

  if (query) {
    rows = rows.filter(r =>
      (r.ORDER_ID || '').toLowerCase().includes(query) ||
      (r.SKU      || '').toLowerCase().includes(query)
    );
  }

  const sortFn = {
    order_date: r => r.ORDER_DATE || '',
    sku:        r => r.SKU || '',
    qty:        r => Number(r.ORDER_QTY)           || 0,
    sales:      r => Number(r.ORDER_PRODUCT_SALES) || 0,
    coupon_fee: r => Number(r.ORDER_COUPON_FEE)    || 0,
    profit:     r => Number(r.ORDER_PROFIT)        || 0,
    net_profit: r => Number(r.NET_PROFIT)          || 0,
  }[sortBy] || (r => r.ORDER_DATE || '');

  rows.sort((a, b) => {
    const va = sortFn(a), vb = sortFn(b);
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  const tbody = document.getElementById('couponBody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="16" style="text-align:center;padding:40px;color:var(--text3);">${query ? `No orders matching "${searchRaw}"` : 'No data for selected period'}</td></tr>`;
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
// the mart is already net of the discount, so Est Profit = margin − cost×qty.

const CP_SHOP_START = '2026-07-14';

function cpBool(v) {
  return v === true || v === 1 || Number(v) === 1 ||
    (typeof v === 'string' && (v.toLowerCase() === 'true' || v === '1'));
}

async function loadCouponShopData() {
  document.getElementById('couponHead').innerHTML = '';
  document.getElementById('couponBody').innerHTML =
    `<tr><td colspan="14" style="text-align:center;padding:48px;color:var(--text3);">
       <div style="display:inline-block;width:28px;height:28px;border:2px solid var(--border);border-top-color:#0ea5e9;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:10px;"></div>
       <div>Loading Shopify coupon data…</div>
     </td></tr>`;
  try {
    const [sr, or_] = await Promise.all([
      fetch('/api/coupon-sku?window=shopify'),
      fetch('/api/coupon-order?window=shopify'),
    ]);
    if (sr.status === 401 || or_.status === 401) { window.location.href = '/login.html'; return; }
    if (!sr.ok)  throw new Error(`Shopify coupon SKU API: HTTP ${sr.status}`);
    if (!or_.ok) throw new Error(`Shopify coupon order API: HTTP ${or_.status}`);
    S.couponShopSku   = await sr.json();
    S.couponShopOrder = await or_.json();
    renderCouponPage();
  } catch (err) {
    document.getElementById('couponBody').innerHTML =
      `<tr><td colspan="14" style="text-align:center;padding:40px;color:#ef4444;font-size:13px;">${err.message}</td></tr>`;
  }
}

function getCouponShopFiltered() {
  const level = (document.getElementById('couponShopLevel') || {}).value || 'sku';
  const scope = (document.getElementById('couponShopScope') || {}).value || 'target';
  const query = String(((document.getElementById('couponShopSearch') || {}).value || '')).trim().toLowerCase();
  let rows = level === 'sku' ? (S.couponShopSku || []) : (S.couponShopOrder || []);
  if (scope === 'target') rows = rows.filter(r => cpBool(r.IS_TARGET));
  if (query) {
    rows = rows.filter(r =>
      String(r.SKU || '').toLowerCase().includes(query) ||
      String(r.ORDER_NAME || '').toLowerCase().includes(query) ||
      String(r.ORDER_ID || '').toLowerCase().includes(query));
  }
  return rows;
}
window.getCouponShopFiltered = getCouponShopFiltered;

function cpShopSummary() {
  const scope = (document.getElementById('couponShopScope') || {}).value || 'target';
  const skus = (S.couponShopSku || []).filter(r => scope !== 'target' || cpBool(r.IS_TARGET));
  const ords = (S.couponShopOrder || []).filter(r => scope !== 'target' || cpBool(r.IS_TARGET));
  const nTarget = (S.couponShopSku || []).filter(r => cpBool(r.IS_TARGET)).length;
  const nSwept  = (S.couponShopSku || []).length - nTarget;
  const orderIds = new Set(ords.map(r => r.ORDER_ID));
  const units    = ords.reduce((s, r) => s + (Number(r.ORDER_QTY) || 0), 0);
  const sales    = ords.reduce((s, r) => s + (Number(r.ORDER_PRODUCT_SALES) || 0), 0);
  const disc     = ords.reduce((s, r) => s + (Number(r.EST_COUPON_DISCOUNT) || 0), 0);
  const profit   = ords.reduce((s, r) => s + (Number(r.ORDER_PROFIT) || 0), 0);
  const sold     = skus.filter(r => (Number(r.ORDER_QTY) || 0) > 0).length;
  const box = document.getElementById('couponShopSummary');
  if (!box) return;
  box.innerHTML =
    `<b style="color:var(--text);">Summer Sale (HP_SUMMER5–30)</b> · accumulating since ${CP_SHOP_START}` +
    ` · live scope: <b style="color:var(--text);">${nTarget.toLocaleString()}</b> target SKUs + ${nSwept.toLocaleString()} swept variants` +
    ` · coupon orders: <b style="color:var(--text);">${orderIds.size.toLocaleString()}</b>` +
    ` · units <b style="color:var(--text);">${Math.round(units).toLocaleString()}</b>` +
    ` · sales <b style="color:var(--text);">${fmt(sales)}</b>` +
    ` · est. coupon given <b style="color:#f59e0b;">${fmt(disc)}</b>` +
    ` · est. profit <b style="color:${profit < 0 ? '#ef4444' : '#10b981'};">${fmt(profit)}</b>` +
    (sold ? ` · SKUs with sales: <b style="color:var(--text);">${sold.toLocaleString()}</b>` : '');
}

function renderCouponShopify() {
  cpShopSummary();
  const level = (document.getElementById('couponShopLevel') || {}).value || 'sku';
  const sortBy  = (document.getElementById('couponShopSort') || {}).value || 'profit';
  const sortDir = (document.getElementById('couponShopDir')  || {}).value || 'desc';
  const searchRaw = String(((document.getElementById('couponShopSearch') || {}).value || '')).trim();
  const clrBtn = document.getElementById('couponShopSearchClear');
  if (clrBtn) clrBtn.style.display = searchRaw ? '' : 'none';

  let rows = getCouponShopFiltered();

  const sortFn = level === 'sku' ? {
    profit:   r => Number(r.ORDER_PROFIT)         || 0,
    sales:    r => Number(r.ORDER_PRODUCT_SALES)  || 0,
    qty:      r => Number(r.ORDER_QTY)            || 0,
    discount: r => Number(r.EST_COUPON_DISCOUNT)  || 0,
    pct:      r => Number(r.GROUP_PCT)            || 0,
    date:     r => r.LAST_COUPON_ORDER_DATE || '',
    sku:      r => r.SKU || '',
  }[sortBy] : {
    profit:   r => Number(r.ORDER_PROFIT)         || 0,
    sales:    r => Number(r.ORDER_PRODUCT_SALES)  || 0,
    qty:      r => Number(r.ORDER_QTY)            || 0,
    discount: r => Number(r.EST_COUPON_DISCOUNT)  || 0,
    pct:      r => Number(r.GROUP_PCT)            || 0,
    date:     r => r.ORDER_DATE || '',
    sku:      r => r.SKU || '',
  }[sortBy];
  const fn = sortFn || (r => Number(r.ORDER_PROFIT) || 0);
  rows = [...rows].sort((a, b) => {
    const va = fn(a), vb = fn(b);
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  if (level === 'sku') renderCouponShopSkuTable(rows, searchRaw);
  else renderCouponShopOrderTable(rows, searchRaw);
}

function cpShopBadges(r) {
  const pct = Math.round(Number(r.GROUP_PCT) || 0);
  const tgt = cpBool(r.IS_TARGET);
  return `<span style="font-size:11px;font-weight:700;padding:1px 6px;border-radius:6px;background:rgba(14,165,233,.12);color:#0ea5e9;border:1px solid rgba(14,165,233,.3);">${pct}%</span>` +
    (tgt ? '' : ` <span title="Not a slow-traffic target — variant swept in because Shopify discounts apply per product"
      style="font-size:10px;font-weight:700;padding:1px 5px;border-radius:6px;vertical-align:middle;
      background:rgba(168,85,247,.15);color:#a855f7;border:1px solid rgba(168,85,247,.3);">SWEPT</span>`);
}

function renderCouponShopSkuTable(rows, searchRaw) {
  document.getElementById('couponHead').innerHTML = `
    <tr>
      <th style="text-align:right;min-width:40px;width:40px;">#</th>
      <th style="text-align:left;min-width:150px;">SKU</th>
      <th style="min-width:75px;">Discount</th>
      <th style="min-width:100px;">Price @ Push</th>
      <th style="min-width:95px;">Unit Cost</th>
      <th style="min-width:95px;">Avail @ Push</th>
      <th style="min-width:75px;">Orders</th>
      <th style="min-width:80px;">Qty Sold</th>
      <th style="min-width:115px;">Product Sales</th>
      <th style="min-width:110px;">Est Coupon $</th>
      <th style="min-width:110px;">Margin</th>
      <th style="min-width:105px;">Est Profit</th>
      <th style="min-width:105px;">Last Order</th>
    </tr>`;
  const tbody = document.getElementById('couponBody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;padding:40px;color:var(--text3);">${searchRaw ? `No SKUs matching "${searchRaw}"` : 'No SKUs in scope'}</td></tr>`;
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
      <th style="text-align:left;min-width:110px;">Order</th>
      <th style="min-width:100px;">Order Date</th>
      <th style="text-align:left;min-width:150px;">SKU</th>
      <th style="min-width:60px;">Qty</th>
      <th style="min-width:90px;">Price</th>
      <th style="min-width:110px;">Est Coupon $</th>
      <th style="min-width:120px;">Order Discount $</th>
      <th style="min-width:115px;">Product Sales</th>
      <th style="min-width:110px;">Margin</th>
      <th style="min-width:105px;">Est Profit</th>
    </tr>`;
  const tbody = document.getElementById('couponBody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text3);">${searchRaw ? `No orders matching "${searchRaw}"` : `No coupon orders yet — accumulating since ${CP_SHOP_START}`}</td></tr>`;
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
