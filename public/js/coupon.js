// ── Coupon Order Page ─────────────────────────────────────────────────────────

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

// Populate the date dropdown from the 3 most-recent ORDER_DATEs in either table.
function populateCouponDates() {
  const allDates = new Set();
  (S.couponSku   || []).forEach(r => r.ORDER_DATE && allDates.add(String(r.ORDER_DATE).slice(0, 10)));
  (S.couponOrder || []).forEach(r => r.ORDER_DATE && allDates.add(String(r.ORDER_DATE).slice(0, 10)));
  const sorted = [...allDates].sort().reverse().slice(0, 3);
  const sel = document.getElementById('couponDateSel');
  if (!sel) return;
  sel.innerHTML = `<option value="">All Dates</option>` +
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

// ── Load (lazy, first visit only) ────────────────────────────────────────────

async function loadCouponData() {
  if (S.couponSku && S.couponOrder) {
    renderCouponPage();
    return;
  }

  document.getElementById('couponHead').innerHTML = '';
  document.getElementById('couponBody').innerHTML =
    `<tr><td colspan="9" style="text-align:center;padding:48px;color:var(--text3);">
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
      `<tr><td colspan="9" style="text-align:center;padding:40px;color:#ef4444;font-size:13px;">${err.message}</td></tr>`;
  }
}
window.loadCouponData = loadCouponData;

// ── View toggle ───────────────────────────────────────────────────────────────

function setCouponView(view, btn) {
  S.couponView = view;
  document.querySelectorAll('#couponToggle .toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('couponSkuControls').style.display  = view === 'sku'   ? 'flex' : 'none';
  document.getElementById('couponOrdControls').style.display  = view === 'order' ? 'flex' : 'none';
  renderCouponPage();
}
window.setCouponView = setCouponView;

// ── Main render dispatcher ────────────────────────────────────────────────────

function renderCouponPage() {
  if (!S.couponSku || !S.couponOrder) { loadCouponData(); return; }
  if ((S.couponView || 'sku') === 'sku') renderCouponSkuTable();
  else renderCouponOrderTable();
}
window.renderCouponPage = renderCouponPage;

// ── SKU Level ─────────────────────────────────────────────────────────────────
// Shows each raw row from DAILY_SKU_COUPON_PROFIT (one row per ORDER_DATE + SKU)

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
      <th style="min-width:90px;">Quantity</th>
      <th style="min-width:120px;">Product Sales</th>
      <th style="min-width:120px;">Margin</th>
      <th style="min-width:120px;">Coupon Fee</th>
      <th style="min-width:120px;">New Margin</th>
      <th style="min-width:120px;">Profit</th>
      <th style="min-width:110px;">Unit Cost</th>
    </tr>`;

  let rows = [...data];

  if (query) rows = rows.filter(r => (r.SKU || '').toLowerCase().includes(query));

  const sortFn = {
    order_date:    r => r.ORDER_DATE || '',
    sku:           r => r.SKU || '',
    qty:           r => Number(r.TOTAL_QUANTITY)      || 0,
    product_sales: r => Number(r.TOTAL_PRODUCT_SALES) || 0,
    coupon_fee:    r => Number(r.TOTAL_COUPON_FEE)    || 0,
    new_margin:    r => Number(r.TOTAL_NEW_MARGIN)    || 0,
    margin:        r => Number(r.TOTAL_MARGIN)        || 0,
    profit:        r => Number(r.TOTAL_PROFIT)        || 0,
  }[sortBy] || (r => r.ORDER_DATE || '');

  rows.sort((a, b) => {
    const va = sortFn(a), vb = sortFn(b);
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  const tbody = document.getElementById('couponBody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text3);">${query ? `No SKUs matching "${searchRaw}"` : 'No data for selected period'}</td></tr>`;
    return;
  }

  const V = 'font-size:14px;font-weight:700;';
  tbody.innerHTML = rows.map((r, i) => {
    const margin    = Number(r.TOTAL_MARGIN)        || 0;
    const couponFee = Number(r.TOTAL_COUPON_FEE)    || 0;
    const newMargin = Number(r.TOTAL_NEW_MARGIN)    || 0;
    const profit    = Number(r.TOTAL_PROFIT)        || 0;
    return `
    <tr>
      <td style="text-align:right;font-size:12px;color:var(--text3);">${i + 1}</td>
      <td style="text-align:left;font-weight:700;color:var(--text);font-size:14px;">${r.SKU || '—'}</td>
      <td style="text-align:right;font-size:12px;color:var(--text2);">${r.ORDER_DATE || '—'}</td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${Math.round(Number(r.TOTAL_QUANTITY) || 0).toLocaleString()}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmt(Number(r.TOTAL_PRODUCT_SALES) || 0)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${margin < 0 ? '#ef4444' : 'var(--text)'};">${fmt(margin)}</span></td>
      <td style="text-align:right;"><span style="${V}color:#f59e0b;">${fmt(couponFee)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${newMargin < 0 ? '#ef4444' : '#10b981'};">${fmt(newMargin)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${profit < 0 ? '#ef4444' : '#10b981'};">${fmt(profit)}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text2);">${fmt(Number(r.UNIT_COST) || 0)}</span></td>
    </tr>`;
  }).join('');
}

// ── Order Level ───────────────────────────────────────────────────────────────

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
      <th style="text-align:left;min-width:190px;">Order ID</th>
      <th style="text-align:left;min-width:130px;">SKU</th>
      <th style="min-width:100px;">Order Date</th>
      <th style="min-width:80px;">Qty</th>
      <th style="min-width:120px;">Product Sales</th>
      <th style="min-width:120px;">Sales Margin</th>
      <th style="min-width:120px;">Coupon Fee</th>
      <th style="min-width:120px;">New Margin</th>
      <th style="min-width:120px;">Profit</th>
      <th style="min-width:110px;">Unit Cost</th>
    </tr>`;

  let rows = [...data];

  if (query) {
    rows = rows.filter(r =>
      (r.ORDER_ID   || '').toLowerCase().includes(query) ||
      (r.SKU        || '').toLowerCase().includes(query) ||
      (r.CLEAN_SKU  || '').toLowerCase().includes(query)
    );
  }

  const sortFn = {
    order_date: r => r.ORDER_DATE || '',
    sku:        r => r.SKU || '',
    qty:        r => Number(r.QUANTITY)      || 0,
    sales:      r => Number(r.PRODUCT_SALES) || 0,
    coupon_fee: r => Number(r.COUPON_FEE)   || 0,
    profit:     r => Number(r.PROFIT)        || 0,
  }[sortBy] || (r => r.ORDER_DATE || '');

  rows.sort((a, b) => {
    const va = sortFn(a), vb = sortFn(b);
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  const tbody = document.getElementById('couponBody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text3);">${query ? `No orders matching "${searchRaw}"` : 'No data for selected period'}</td></tr>`;
    return;
  }

  const V = 'font-size:14px;font-weight:700;';
  tbody.innerHTML = rows.map((r, i) => {
    const salesMargin = Number(r.SALES_MARGIN) || 0;
    const newMargin   = Number(r.NEW_MARGIN)   || 0;
    const profit      = Number(r.PROFIT)       || 0;
    return `
    <tr>
      <td style="text-align:right;font-size:12px;color:var(--text3);">${i + 1}</td>
      <td style="text-align:left;font-size:12px;color:var(--text2);font-family:monospace;">${r.ORDER_ID || '—'}</td>
      <td style="text-align:left;font-weight:700;font-size:13px;color:var(--text);">${r.SKU || '—'}</td>
      <td style="text-align:right;font-size:12px;color:var(--text2);">${r.ORDER_DATE || '—'}</td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${Math.round(Number(r.QUANTITY) || 0).toLocaleString()}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmt(Number(r.PRODUCT_SALES) || 0)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${salesMargin < 0 ? '#ef4444' : 'var(--text)'};">${fmt(salesMargin)}</span></td>
      <td style="text-align:right;"><span style="${V}color:#f59e0b;">${fmt(Number(r.COUPON_FEE) || 0)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${newMargin < 0 ? '#ef4444' : '#10b981'};">${fmt(newMargin)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${profit < 0 ? '#ef4444' : '#10b981'};">${fmt(profit)}</span></td>
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
