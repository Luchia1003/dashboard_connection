// ── Coupon Order Page ─────────────────────────────────────────────────────────

// Filter coupon data by the time-range selector using ORDER_DATE
function getCouponSkuFiltered() {
  if (!S.couponSku) return [];
  const r = computeRange(S.tr, S.customFrom, S.customTo);
  if (!r) return S.couponSku;
  return S.couponSku.filter(row => row.ORDER_DATE >= r.f && row.ORDER_DATE <= r.t);
}

function getCouponOrderFiltered() {
  if (!S.couponOrder) return [];
  const r = computeRange(S.tr, S.customFrom, S.customTo);
  if (!r) return S.couponOrder;
  return S.couponOrder.filter(row => row.ORDER_DATE >= r.f && row.ORDER_DATE <= r.t);
}

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

function renderCouponSkuTable() {
  const data     = getCouponSkuFiltered();
  const sortBy   = (document.getElementById('couponSkuSort') || {}).value || 'product_sales';
  const sortDir  = (document.getElementById('couponSkuDir')  || {}).value || 'desc';
  const topN     = parseInt((document.getElementById('couponSkuTop') || {}).value || '20');
  const searchRaw = (document.getElementById('couponSkuSearch') || {}).value || '';
  const query    = searchRaw.trim().toLowerCase();

  const clrBtn = document.getElementById('couponSkuSearchClear');
  if (clrBtn) clrBtn.style.display = query ? '' : 'none';

  // Set header
  document.getElementById('couponHead').innerHTML = `
    <tr>
      <th style="text-align:left;min-width:200px;"># SKU</th>
      <th style="min-width:90px;">Quantity</th>
      <th style="min-width:120px;">Product Sales</th>
      <th style="min-width:120px;">Margin</th>
      <th style="min-width:120px;">Coupon Fee</th>
      <th style="min-width:120px;">New Margin</th>
      <th style="min-width:120px;">Profit</th>
      <th style="min-width:110px;">Avg Unit Cost</th>
    </tr>`;

  // Aggregate by SKU
  const map = {};
  data.forEach(r => {
    const k = r.SKU || 'UNKNOWN';
    if (!map[k]) map[k] = { sku: k, qty: 0, sales: 0, margin: 0, couponFee: 0, newMargin: 0, profit: 0, costSum: 0, costCount: 0 };
    const m = map[k];
    m.qty       += Number(r.TOTAL_QUANTITY)      || 0;
    m.sales     += Number(r.TOTAL_PRODUCT_SALES) || 0;
    m.margin    += Number(r.TOTAL_MARGIN)        || 0;
    m.couponFee += Number(r.TOTAL_COUPON_FEE)    || 0;
    m.newMargin += Number(r.TOTAL_NEW_MARGIN)    || 0;
    m.profit    += Number(r.TOTAL_PROFIT)        || 0;
    m.costSum   += Number(r.UNIT_COST)           || 0;
    m.costCount += 1;
  });

  let rows = Object.values(map).map(m => ({ ...m, unitCost: m.costCount ? m.costSum / m.costCount : 0 }));

  if (query) rows = rows.filter(r => r.sku.toLowerCase().includes(query));

  const keyMap = { product_sales: 'sales', profit: 'profit', qty: 'qty', coupon_fee: 'couponFee', new_margin: 'newMargin', margin: 'margin' };
  const sortKey = keyMap[sortBy] || 'sales';
  rows.sort((a, b) => sortDir === 'asc' ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]);

  const visible = query ? rows : rows.slice(0, topN);

  const tbody = document.getElementById('couponBody');
  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text3);">${query ? `No SKUs matching "${searchRaw}"` : 'No data for selected period'}</td></tr>`;
    return;
  }

  const V = 'font-size:15px;font-weight:700;';
  tbody.innerHTML = visible.map((s, i) => `
    <tr>
      <td style="text-align:left;vertical-align:middle;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;color:var(--text3);min-width:20px;">${i + 1}</span>
          <span style="font-weight:700;color:var(--text);font-size:14px;">${s.sku}</span>
        </div>
      </td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${Math.round(s.qty).toLocaleString()}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmt(s.sales)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${s.margin < 0 ? '#ef4444' : 'var(--text)'};">${fmt(s.margin)}</span></td>
      <td style="text-align:right;"><span style="${V}color:#f59e0b;">${fmt(s.couponFee)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${s.newMargin < 0 ? '#ef4444' : '#10b981'};">${fmt(s.newMargin)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${s.profit < 0 ? '#ef4444' : '#10b981'};">${fmt(s.profit)}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text2);">${fmt(s.unitCost)}</span></td>
    </tr>`).join('');
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
      <th style="text-align:left;min-width:190px;">Order ID</th>
      <th style="text-align:left;min-width:130px;">SKU</th>
      <th style="text-align:left;min-width:130px;">Clean SKU</th>
      <th style="min-width:100px;">Order Date</th>
      <th style="min-width:80px;">Qty</th>
      <th style="min-width:120px;">Product Sales</th>
      <th style="min-width:120px;">Coupon Fee</th>
      <th style="min-width:120px;">New Margin</th>
      <th style="min-width:120px;">Profit</th>
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
  tbody.innerHTML = rows.map(r => {
    const newMargin = Number(r.NEW_MARGIN) || 0;
    const profit    = Number(r.PROFIT)     || 0;
    return `
    <tr>
      <td style="text-align:left;font-size:12px;color:var(--text2);font-family:monospace;">${r.ORDER_ID || '—'}</td>
      <td style="text-align:left;font-weight:700;font-size:13px;color:var(--text);">${r.SKU || '—'}</td>
      <td style="text-align:left;font-size:12px;color:var(--text2);">${r.CLEAN_SKU || '—'}</td>
      <td style="text-align:right;font-size:12px;color:var(--text2);">${r.ORDER_DATE || '—'}</td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${Math.round(Number(r.QUANTITY) || 0).toLocaleString()}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmt(Number(r.PRODUCT_SALES) || 0)}</span></td>
      <td style="text-align:right;"><span style="${V}color:#f59e0b;">${fmt(Number(r.COUPON_FEE) || 0)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${newMargin < 0 ? '#ef4444' : '#10b981'};">${fmt(newMargin)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${profit < 0 ? '#ef4444' : '#10b981'};">${fmt(profit)}</span></td>
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
