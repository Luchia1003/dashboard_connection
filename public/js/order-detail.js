// ── Order Detail Page ─────────────────────────────────────────────────────────
// Shows the last 5 calendar days (today-5 … today-1) from ORDER_LEVEL_PROFIT.
// The underlying table holds ~90 days (for Action Center's loss board); this
// page's window filter below is what keeps the display at 5 days.

// Compute the allowed 5-day window: [today-5, today-1]
function getOrderDetailWindow() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const to   = new Date(today); to.setDate(to.getDate() - 1);
  const from = new Date(today); from.setDate(from.getDate() - 5);
  return {
    from: from.toISOString().slice(0, 10),
    to:   to.toISOString().slice(0, 10),
  };
}

// True/false test that's tolerant of the various shapes Snowflake / JSON can
// return for a BOOLEAN column (true, "true", 1, "1", "TRUE", etc.).
function isDropShip(r) {
  const v = r.IS_DROPSHIP;
  if (v === true || v === 1) return true;
  if (typeof v === 'string') return v.toLowerCase() === 'true' || v === '1';
  return false;
}

// Filter to the 5-day window, then optionally to a single selected date,
// then optionally to a single platform, then optionally by drop-ship status.
function getOrderDetailFiltered() {
  if (!S.orderDetail) return [];
  const { from, to } = getOrderDetailWindow();
  let rows = S.orderDetail.filter(r => {
    const d = String(r.ORDER_DATE).slice(0, 10);
    return d >= from && d <= to;
  });
  if (S.orderDetailDate) {
    rows = rows.filter(r => String(r.ORDER_DATE).slice(0, 10) === S.orderDetailDate);
  }
  const p = (S.platform || 'all').toLowerCase();
  if (p !== 'all') {
    rows = rows.filter(r => String(r.PLATFORM || '').toLowerCase() === p);
  }
  const ds = (document.getElementById('orderDetailDropship') || {}).value || '';
  if (ds === 'yes') rows = rows.filter(r =>  isDropShip(r));
  if (ds === 'no')  rows = rows.filter(r => !isDropShip(r));
  return rows;
}
window.isDropShip = isDropShip;

// Populate the date dropdown with up to 5 dates present in the window
function populateOrderDetailDates() {
  const { from, to } = getOrderDetailWindow();
  const dates = new Set();
  (S.orderDetail || []).forEach(r => {
    const d = String(r.ORDER_DATE).slice(0, 10);
    if (d >= from && d <= to) dates.add(d);
  });
  const sorted = [...dates].sort().reverse(); // newest first
  const sel = document.getElementById('orderDetailDateSel');
  if (!sel) return;
  sel.innerHTML = `<option value="">All Dates</option>` +
    sorted.map(d => `<option value="${d}">${d}</option>`).join('');
  if (S.orderDetailDate && sorted.includes(S.orderDetailDate)) {
    sel.value = S.orderDetailDate;
  } else {
    S.orderDetailDate = ''; sel.value = '';
  }
}

function setOrderDetailDate(val) {
  S.orderDetailDate = val;
  renderOrderDetailPage();
}
window.setOrderDetailDate     = setOrderDetailDate;
window.getOrderDetailFiltered = getOrderDetailFiltered;

// ── Load (lazy) ───────────────────────────────────────────────────────────────

async function loadOrderDetailData() {
  if (S.orderDetail) { renderOrderDetailPage(); return; }

  document.getElementById('orderDetailBody').innerHTML =
    `<tr><td colspan="13" style="text-align:center;padding:48px;color:var(--text3);">
       <div style="display:inline-block;width:28px;height:28px;border:2px solid var(--border);border-top-color:#0ea5e9;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:10px;"></div>
       <div>Loading order data…</div>
     </td></tr>`;

  try {
    const r = await fetch('/api/order-detail');
    if (r.status === 401) { window.location.href = '/login.html'; return; }
    if (!r.ok) throw new Error(`Order Detail API: HTTP ${r.status}`);
    S.orderDetail = await r.json();
    populateOrderDetailDates();
    renderOrderDetailPage();
  } catch (err) {
    document.getElementById('orderDetailBody').innerHTML =
      `<tr><td colspan="13" style="text-align:center;padding:40px;color:#ef4444;font-size:13px;">${err.message}</td></tr>`;
  }
}
window.loadOrderDetailData = loadOrderDetailData;

// ── Render ────────────────────────────────────────────────────────────────────

function renderOrderDetailPage() {
  if (!S.orderDetail) { loadOrderDetailData(); return; }
  if (typeof updateDownloadHints === 'function') updateDownloadHints();

  const sortBy    = (document.getElementById('orderDetailSort') || {}).value || 'order_date';
  const sortDir   = (document.getElementById('orderDetailDir')  || {}).value || 'desc';
  const searchRaw = (document.getElementById('orderDetailSearch') || {}).value || '';
  const query     = searchRaw.trim().toLowerCase();

  const clrBtn = document.getElementById('orderDetailSearchClear');
  if (clrBtn) clrBtn.style.display = query ? '' : 'none';

  let rows = getOrderDetailFiltered();

  if (query) {
    rows = rows.filter(r =>
      (r.ORDER_ID || '').toLowerCase().includes(query) ||
      (r.SKU      || '').toLowerCase().includes(query)
    );
  }

  const sortFn = {
    order_date:    r => String(r.ORDER_DATE    || ''),
    sku:           r => String(r.SKU           || ''),
    qty:           r => Number(r.QTY)           || 0,
    product_sales: r => Number(r.PRODUCT_SALES) || 0,
    sales_margin:  r => Number(r.SALES_MARGIN)  || 0,
    unit_cost:     r => Number(r.UNIT_COST)     || 0,
    profit:        r => Number(r.PROFIT)        || 0,
  }[sortBy] || (r => String(r.ORDER_DATE || ''));

  rows.sort((a, b) => {
    const va = sortFn(a), vb = sortFn(b);
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  const tbody = document.getElementById('orderDetailBody');
  if (!rows.length) {
    const msg = query ? `No orders matching "${searchRaw}"` : 'No data for selected period';
    tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;padding:40px;color:var(--text3);">${msg}</td></tr>`;
    return;
  }

  const V = 'font-size:14px;font-weight:700;';
  tbody.innerHTML = rows.map((r, i) => {
    const salesMargin = Number(r.SALES_MARGIN) || 0;
    const profit      = Number(r.PROFIT)       || 0;
    const plat        = String(r.PLATFORM || '').trim();
    const platLow     = plat.toLowerCase();
    const platColor   = platLow === 'shopify' ? '#10b981' : platLow === 'amazon' ? '#f59e0b' : 'var(--text2)';
    const platBg      = platLow === 'shopify' ? 'rgba(16,185,129,.12)' : platLow === 'amazon' ? 'rgba(245,158,11,.12)' : 'rgba(100,116,139,.12)';
    const ds          = isDropShip(r);
    const dsFee       = Number(r.DROPSHIP_FEE) || 0;
    const dsBadge     = ds
      ? `<span style="font-size:11px;font-weight:600;color:#a855f7;background:rgba(168,85,247,.14);padding:2px 8px;border-radius:6px;">Drop Ship</span>`
      : `<span style="font-size:11px;font-weight:500;color:var(--text3);background:var(--input);padding:2px 8px;border-radius:6px;">Direct</span>`;
    const dsFeeCell   = dsFee > 0
      ? `<span style="${V}color:var(--text2);">${fmt(dsFee)}</span>`
      : `<span style="color:var(--text3);">—</span>`;
    const shipFee     = Number(r.SHIPPING_FEE) || 0;
    const shipFeeCell = shipFee > 0
      ? `<span style="${V}color:var(--text2);">${fmt(shipFee)}</span>`
      : `<span style="color:var(--text3);">—</span>`;
    return `
    <tr>
      <td style="text-align:right;font-size:12px;color:var(--text3);">${i + 1}</td>
      <td style="text-align:left;font-size:12px;color:var(--text2);font-family:monospace;">${r.ORDER_ID || '—'}</td>
      <td style="text-align:left;font-weight:700;font-size:13px;color:var(--text);">${r.SKU || '—'}</td>
      <td style="text-align:right;"><span style="font-size:11px;font-weight:600;color:${platColor};background:${platBg};padding:2px 8px;border-radius:6px;">${plat || '—'}</span></td>
      <td style="text-align:right;">${dsBadge}</td>
      <td style="text-align:right;">${dsFeeCell}</td>
      <td style="text-align:right;">${shipFeeCell}</td>
      <td style="text-align:right;font-size:12px;color:var(--text2);">${String(r.ORDER_DATE || '—').slice(0, 10)}</td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${Math.round(Number(r.QTY) || 0).toLocaleString()}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmt(Number(r.PRODUCT_SALES) || 0)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${salesMargin < 0 ? '#ef4444' : 'var(--text)'};">${fmt(salesMargin)}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text2);">${fmt(Number(r.UNIT_COST) || 0)}</span></td>
      <td style="text-align:right;"><span style="${V}color:${profit < 0 ? '#ef4444' : '#10b981'};">${fmt(profit)}</span></td>
    </tr>`;
  }).join('');
}
window.renderOrderDetailPage = renderOrderDetailPage;

// ── Search clear ──────────────────────────────────────────────────────────────

function clearOrderDetailSearch() {
  const inp = document.getElementById('orderDetailSearch');
  if (inp) inp.value = '';
  const btn = document.getElementById('orderDetailSearchClear');
  if (btn) btn.style.display = 'none';
  renderOrderDetailPage();
}
window.clearOrderDetailSearch = clearOrderDetailSearch;
