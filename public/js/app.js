// ── Global State ──────────────────────────────────────────────────────────────

const S = {
  daily: null,
  sku: null,
  page: 'sales',
  tr: 'all',
  customFrom: '',
  customTo: '',
  theme: localStorage.getItem('theme') || 'dark',
  salesMode: 'net',
  mode: 'net',
  yoyMetric: 'revenue',
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

function getDaily() { return filterData(S.daily, S.tr, S.customFrom, S.customTo); }
function getSku()   { return filterData(S.sku,   S.tr, S.customFrom, S.customTo); }
window.getDaily = getDaily; window.getSku = getSku; window.filterData = filterData;

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
  if (!S.daily || !S.sku) return;
  if (S.page === 'sales') renderSalesPage();
  else renderProductsPage();
}

// ── Navigation ────────────────────────────────────────────────────────────────

function switchPage(page) {
  S.page = page;
  document.getElementById('salesSection').style.display = page === 'sales' ? 'block' : 'none';
  document.getElementById('productsSection').style.display = page === 'products' ? 'block' : 'none';
  document.getElementById('navSales').classList.toggle('active', page === 'sales');
  document.getElementById('navProducts').classList.toggle('active', page === 'products');
  document.getElementById('pageTitle').textContent = page === 'sales' ? 'Sales Dashboard' : 'Product Detail';
  closeSidebar();
  if (S.daily && S.sku) {
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
