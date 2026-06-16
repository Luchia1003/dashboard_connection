// ── Global State ──────────────────────────────────────────────────────────────

const S = {
  daily: null,
  sku: null,
  orderDetail: null,
  orderDetailDate: '',
  couponSku: null,
  couponOrder: null,
  couponView: 'sku',
  couponDate: '',
  inventoryForecast: null,
  fbaAging: null,
  inventoryView: 'forecast',
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
  const rows = getSku(); // already platform + time-range filtered
  const mode = S.mode || 'net';
  const platform = (S.platform || 'all').toLowerCase();

  const base = ['DATE', 'PLATFORM', 'SALES_SKU', 'DESCRIPTION', 'UNIT_COST'];
  const modeCols = {
    net:    base.concat(['NET_ORDER_COUNT','NET_QUANTITY','NET_PRODUCT_SALES','NET_GROSS_SALES','NET_MARGIN','NET_COGS','NET_PROFIT','NET_MARGIN_PCT','RETURN_RATE_PLATFORM','RETURN_RATE_ALL']),
    order:  base.concat(['ORDER_COUNT','ORDER_QUANTITY','ORDER_PRODUCT_SALES','ORDER_GROSS_SALES','ORDER_MARGIN','ORDER_COGS','ORDER_PROFIT']),
    refund: base.concat(['REFUND_COUNT','REFUND_QUANTITY','REFUND_PRODUCT_SALES','REFUND_GROSS_SALES','REFUND_MARGIN','REFUND_COGS','REFUND_PROFIT']),
  };
  const cols = modeCols[mode] || modeCols.net;
  downloadCSV(rows, `product_detail_${platform}_${mode}_${trLabel()}.csv`, cols);
}

// Order Detail → matches the platform toggle and the Date dropdown.
function downloadOrderDetailCSV() {
  if (!S.orderDetail) { loadOrderDetailData(); return; }
  const rows = (typeof getOrderDetailFiltered === 'function')
    ? getOrderDetailFiltered()
    : (S.orderDetail || []);
  const platform  = (S.platform || 'all').toLowerCase();
  const dateLabel = S.orderDetailDate ? dateForFile(S.orderDetailDate) : 'alldates';
  downloadCSV(rows, `order_detail_${platform}_${dateLabel}_${todayStamp()}.csv`);
}

// Coupon Order → no filters, filename reflects current view + today's date.
function downloadCouponCSV() {
  if (!S.couponSku || !S.couponOrder) { loadCouponData(); return; }
  if ((S.couponView || 'sku') === 'sku') {
    downloadCSV(S.couponSku,   `sku_level_coupon_order_${todayStamp()}.csv`);
  } else {
    downloadCSV(S.couponOrder, `order_level_coupon_order_${todayStamp()}.csv`);
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

    let rows = (S.inventoryForecast || []).filter(
      r => String(r.CHANNEL || '').toLowerCase() === channel
    );
    if (statusRaw === 'threshold') {
      rows = rows.filter(r => String(r.RESTOCK_THRESHOLD_MET || '') === 'Y');
    } else if (statusRaw) {
      rows = rows.filter(r => String(r.INVENTORY_STATUS || '') === statusRaw);
    }

    const statusSlug = !statusRaw ? 'all'
      : statusRaw === 'threshold' ? 'threshold_met'
      : statusRaw.toLowerCase().replace(/\s+/g, '_');
    downloadCSV(rows, `inventory_forecast_${channel}_${statusSlug}_${todayStamp()}.csv`);
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
window.downloadInventoryCSV   = downloadInventoryCSV;

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
  if (S.page === 'coupon')       { renderCouponPage();      return; }
  if (S.page === 'orderDetail')  { renderOrderDetailPage(); return; }
  if (S.page === 'inventory')    { renderInventoryPage();   return; }
  if (!S.daily || !S.sku) return;
  if (S.page === 'sales') renderSalesPage();
  else renderProductsPage();
}

// ── Navigation ────────────────────────────────────────────────────────────────

function switchPage(page) {
  S.page = page;
  document.getElementById('salesSection').style.display       = page === 'sales'       ? 'block' : 'none';
  document.getElementById('productsSection').style.display    = page === 'products'    ? 'block' : 'none';
  document.getElementById('orderDetailSection').style.display = page === 'orderDetail' ? 'block' : 'none';
  document.getElementById('couponSection').style.display      = page === 'coupon'      ? 'block' : 'none';
  document.getElementById('inventorySection').style.display   = page === 'inventory'   ? 'block' : 'none';
  document.getElementById('navSales').classList.toggle('active',       page === 'sales');
  document.getElementById('navProducts').classList.toggle('active',    page === 'products');
  document.getElementById('navOrderDetail').classList.toggle('active', page === 'orderDetail');
  document.getElementById('navCoupon').classList.toggle('active',      page === 'coupon');
  document.getElementById('navInventory').classList.toggle('active',   page === 'inventory');
  const titles = {
    sales: 'Sales Dashboard',
    products: 'Product Detail',
    orderDetail: 'Order Detail',
    coupon: 'Coupon Order',
    inventory: 'Inventory',
  };
  document.getElementById('pageTitle').textContent = titles[page] || 'Dashboard';
  // Inventory / Coupon / Order Detail have their own internal filters and don't use the global time range.
  const hideTopbar = page === 'coupon' || page === 'orderDetail' || page === 'inventory';
  document.getElementById('trControls').style.display = hideTopbar ? 'none' : 'flex';
  closeSidebar();
  if (page === 'coupon') {
    loadCouponData();
  } else if (page === 'orderDetail') {
    loadOrderDetailData();
  } else if (page === 'inventory') {
    loadInventoryData();
  } else if (S.daily && S.sku) {
    if (page === 'sales') renderSalesPage();
    else renderProductsPage();
  }
}
window.switchPage = switchPage;

// ── Sidebar Mobile ────────────────────────────────────────────────────────────

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('mobileBackdrop').classList.add('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('mobileBackdrop').classList.remove('show');
}
window.openSidebar = openSidebar; window.closeSidebar = closeSidebar;

// ── Theme ─────────────────────────────────────────────────────────────────────

function applyTheme(t) {
  document.documentElement.classList.toggle('light', t === 'light');
  document.getElementById('themeBtn').textContent = t === 'light' ? '☀️' : '🌙';
  S.theme = t;
  localStorage.setItem('theme', t);
}
function toggleTheme() {
  applyTheme(S.theme === 'dark' ? 'light' : 'dark');
  if (S.daily) renderCharts(getDaily(), S.salesMode);
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
  if (S.daily) renderYoYChart(getDaily(), S.daily, S.salesMode);
}
window.setYoyMetric = setYoyMetric;

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const [dr, sr] = await Promise.all([fetch('/api/daily'), fetch('/api/sku')]);
    if (dr.status === 401 || sr.status === 401) { window.location.href = '/login.html'; return; }
    if (!dr.ok) throw new Error(`Daily API: HTTP ${dr.status}`);
    if (!sr.ok) throw new Error(`SKU API: HTTP ${sr.status}`);

    S.daily = await dr.json();
    S.sku   = await sr.json();

    if (!Array.isArray(S.daily) || !Array.isArray(S.sku)) throw new Error('Invalid API response');

    const lastDate = S.daily[S.daily.length - 1]?.DATE;
    document.getElementById('sidebarStatus').textContent = `Updated: ${lastDate || '–'}`;

    populateMonths(S.daily);
    syncPlatformButtons();

    document.getElementById('loadingOverlay').style.display = 'none';

    renderSalesPage();
    renderProductsPage();

  } catch (err) {
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
