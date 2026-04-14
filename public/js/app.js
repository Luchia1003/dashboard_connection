// ── Global State ──────────────────────────────────────────────────────────────

const S = {
  daily: null,
  sku: null,
  page: 'sales',
  tr: 'all',         // time range key
  customFrom: '',
  customTo: '',
  theme: localStorage.getItem('theme') || 'dark',
  salesMode: 'net',  // net | order | refund  (Sales Overview)
  mode: 'net',       // net | order | refund  (Product Detail)
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
    case 'today': return { f: toStr(now), t: toStr(now) };
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

// ── Time Range UI ─────────────────────────────────────────────────────────────

const LABELS = {
  all:'All Time', today:'Today', yesterday:'Yesterday', thisWeek:'This Week',
  lastWeek:'Last Week', thisMonth:'This Month', lastMonth:'Last Month',
  last7:'Last 7 Days', last14:'Last 14 Days', last30:'Last 30 Days', last90:'Last 90 Days',
  thisYear:'This Year', lastYear:'Last Year', custom:'Custom Range',
};

function toggleTRMenu(e) {
  e.stopPropagation();
  const m = document.getElementById('trMenu');
  m.style.display = m.style.display === 'none' ? 'block' : 'none';
}
window.toggleTRMenu = toggleTRMenu;

document.addEventListener('click', () => { document.getElementById('trMenu').style.display = 'none'; });
document.getElementById('trMenu').addEventListener('click', e => e.stopPropagation());

function setTR(key, label) {
  if (key === 'custom') {
    const p = document.getElementById('customPanel');
    p.style.display = p.style.display === 'none' ? 'block' : 'none';
    return;
  }
  S.tr = key;
  document.getElementById('trLabel').textContent = label || LABELS[key] || key;
  document.getElementById('trMenu').style.display = 'none';
  document.querySelectorAll('#trMenu .di[data-r]').forEach(el => el.classList.toggle('active', el.dataset.r === key));
  rerender();
}

function applyCustom() {
  const f = document.getElementById('customFrom').value;
  const t = document.getElementById('customTo').value;
  if (!f || !t) return;
  S.tr = 'custom'; S.customFrom = f; S.customTo = t;
  document.getElementById('trLabel').textContent = `${f} → ${t}`;
  document.getElementById('trMenu').style.display = 'none';
  document.querySelectorAll('#trMenu .di[data-r]').forEach(el => el.classList.toggle('active', false));
  rerender();
}
window.applyCustom = applyCustom;

document.querySelectorAll('#trMenu .di[data-r]').forEach(el => {
  el.addEventListener('click', () => setTR(el.dataset.r, el.textContent.trim()));
});

function populateMonths(data) {
  const months = [...new Set(data.map(r => r.DATE.slice(0, 7)))].sort().reverse();
  document.getElementById('monthsList').innerHTML = months.map(m =>
    `<div class="di" data-r="m:${m}" onclick="setTR('m:${m}','${m}')">${m}</div>`
  ).join('');
}

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
  if (S.daily) renderCharts(getDaily());
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
  if (S.daily) renderYoYChart(getDaily(), S.daily);
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
    // Pre-render products for instant switching
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
