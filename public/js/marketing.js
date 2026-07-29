// ── Marketing Page (Google Ads P&L) ───────────────────────────────────────────
// One dataset: DASHBOARD_DB.ADS_PL_ENRICHED via /api/ads-pl — trailing 30 days
// of Google Ads spend per product (variants rolled up to the Shopify product),
// joined with cart-data basket metrics (lead = the advertised product itself was
// bought; cross-sell = other products in the same order), our own Shopify
// orders, COGS-adjusted margin, and the GMC market price benchmark.
//
// TIER (computed in the view):
//   PROFITABLE      — est. ad profit (ads revenue × margin − cost) > 0
//   UNPROFITABLE    — generated sales, but est. ad profit ≤ 0
//   NO_BASKET_SALES — ad clicks led to zero attributed purchases (sort by Ad
//                     Cost to find the big burners inside this tier)

async function loadMarketingData() {
  if (S.adsPl) {
    renderMarketingPage();
    return;
  }

  document.getElementById('marketingHead').innerHTML = '';
  document.getElementById('marketingBody').innerHTML =
    `<tr><td colspan="14" style="text-align:center;padding:48px;color:var(--text3);">
       <div style="display:inline-block;width:28px;height:28px;border:2px solid var(--border);border-top-color:#0ea5e9;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:10px;"></div>
       <div>Loading ads P&amp;L…</div>
     </td></tr>`;

  try {
    const rows = await swrJSON('/api/ads-pl', d => {
      S.adsPl = d;
      populateMarketingBrands();
      if (S.page === 'marketing') renderMarketingPage();
    });
    S.adsPl = rows;
    populateMarketingBrands();
    renderMarketingPage();
  } catch (err) {
    if (err.message === 'unauthorized') return; // swrJSON already redirected to login
    document.getElementById('marketingBody').innerHTML =
      `<tr><td colspan="14" style="text-align:center;padding:40px;color:#ef4444;font-size:13px;">${err.message}</td></tr>`;
  }
}
window.loadMarketingData = loadMarketingData;

// ── Filters ───────────────────────────────────────────────────────────────────

function populateMarketingBrands() {
  const sel = document.getElementById('marketingBrand');
  if (!sel || !S.adsPl) return;
  const prev = sel.value;
  const brands = [...new Set(S.adsPl.map(r => String(r.VENDOR || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  sel.innerHTML = '<option value="">All</option>' +
    brands.map(b => `<option value="${escHtml(b)}">${escHtml(b)}</option>`).join('');
  sel.value = prev && brands.includes(prev) ? prev : '';
}

function clearMarketingSearch() {
  const inp = document.getElementById('marketingSearch');
  if (inp) inp.value = '';
  const btn = document.getElementById('marketingSearchClear');
  if (btn) btn.style.display = 'none';
  renderMarketingPage();
}
window.clearMarketingSearch = clearMarketingSearch;

// ── Chips ─────────────────────────────────────────────────────────────────────

const MK_TIER_META = {
  PROFITABLE:      { label: 'Profitable',      fg: '#10b981', bg: 'rgba(16,185,129,.12)' },
  UNPROFITABLE:    { label: 'Unprofitable',    fg: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
  NO_BASKET_SALES: { label: 'No Basket Sales', fg: '#ef4444', bg: 'rgba(239,68,68,.12)'  },
};

function mkTierChip(t) {
  const m = MK_TIER_META[t] || { label: t || '—', fg: 'var(--text2)', bg: 'rgba(100,116,139,.12)' };
  return `<span style="font-size:11px;font-weight:600;color:${m.fg};background:${m.bg};padding:2px 8px;border-radius:6px;white-space:nowrap;">${m.label}</span>`;
}

// ── Filtered rows (shared by table render + CSV) ──────────────────────────────

function marketingFilteredRows() {
  const tier   = (document.getElementById('marketingTier')   || {}).value || '';
  const brand  = (document.getElementById('marketingBrand')  || {}).value || '';
  const price  = (document.getElementById('marketingPrice')  || {}).value || '';
  const search = ((document.getElementById('marketingSearch') || {}).value || '').trim().toLowerCase();

  let rows = [...(S.adsPl || [])];
  if (tier)  rows = rows.filter(r => r.TIER === tier);
  if (brand) rows = rows.filter(r => String(r.VENDOR || '').trim() === brand);
  if (price === 'over')        rows = rows.filter(r => Number(r.PRICE_VS_BENCHMARK_PCT) > 10);
  if (price === 'benchmarked') rows = rows.filter(r => r.BENCHMARK_PRICE != null);
  if (search) {
    rows = rows.filter(r =>
      String(r.SAMPLE_SKU || '').toLowerCase().includes(search) ||
      String(r.TITLE || '').toLowerCase().includes(search) ||
      String(r.VENDOR || '').toLowerCase().includes(search));
  }
  return rows;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderMarketingPage() {
  if (!S.adsPl) { loadMarketingData(); return; }

  const searchRaw = (document.getElementById('marketingSearch') || {}).value || '';
  const clrBtn = document.getElementById('marketingSearchClear');
  if (clrBtn) clrBtn.style.display = searchRaw.trim() ? '' : 'none';

  // KPI strip is computed over ALL rows (the account truth), not the filter.
  const all = S.adsPl;
  const kCost   = sum(all, 'COST');
  const kRev    = sum(all, 'ADS_REVENUE');
  const kProfit = sum(all, 'AD_PROFIT_EST');
  const zero    = all.filter(r => r.TIER === 'NO_BASKET_SALES');
  const kZeroCost = sum(zero, 'COST');
  const kpi = (label, value, sub, color) => `
    <div class="card" style="padding:14px 16px;">
      <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.4px;">${label}</div>
      <div style="font-size:22px;font-weight:800;color:${color || 'var(--text)'};margin-top:2px;">${value}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:2px;">${sub}</div>
    </div>`;
  document.getElementById('marketingKpis').innerHTML =
    kpi('Ad Spend · 30d', fmtMoney(kCost, 0), `${fmt(sum(all, 'CLICKS'), 'int')} clicks · ${all.length.toLocaleString()} products`) +
    kpi('Basket Revenue · 30d', fmtMoney(kRev, 0), 'lead + cross-sell, from Google cart data') +
    kpi('Est. Ad Profit · 30d', fmtMoney(kProfit, 0), 'basket revenue × margin − spend',
        kProfit < 0 ? '#ef4444' : '#10b981') +
    kpi('Spend on Zero-Sale Products', fmtMoney(kZeroCost, 0),
        `${zero.length.toLocaleString()} products with no basket revenue`,
        kZeroCost > kCost * 0.3 ? '#f59e0b' : 'var(--text)');

  document.getElementById('marketingHead').innerHTML = `
    <tr>
      <th style="text-align:right;min-width:40px;width:40px;">#</th>
      ${hdrTh('mk', 'product', 'Product', { align: 'left', min: '220px' })}
      ${hdrTh('mk', 'brand', 'Brand', { min: '110px' })}
      ${hdrTh('mk', 'tier', 'Tier', { min: '110px' })}
      ${hdrTh('mk', 'clicks', 'Clicks', { min: '70px' })}
      ${hdrTh('mk', 'impr', 'Impr.', { min: '80px' })}
      ${hdrTh('mk', 'cost', 'Ad Cost', { min: '90px' })}
      ${hdrTh('mk', 'lead_units', 'Lead Units', { min: '90px' })}
      ${hdrTh('mk', 'ads_revenue', 'Basket Rev', { min: '100px' })}
      ${hdrTh('mk', 'margin_rate', 'Margin %', { min: '85px' })}
      ${hdrTh('mk', 'ad_profit', 'Est. Ad Profit', { min: '110px' })}
      ${hdrTh('mk', 'shop_units', 'Shop 30d', { min: '90px' })}
      ${hdrTh('mk', 'vs_market', 'vs Market', { min: '90px' })}
      ${hdrTh('mk', 'cpc', 'CPC', { min: '65px' })}
    </tr>`;

  let rows = marketingFilteredRows();
  rows = hdrSortRows(rows, 'mk', {
    product:     r => String(r.TITLE || '').toLowerCase(),
    brand:       r => String(r.VENDOR || '').toLowerCase(),
    tier:        r => String(r.TIER || ''),
    clicks:      r => Number(r.CLICKS)                 || 0,
    impr:        r => Number(r.IMPRESSIONS)            || 0,
    cost:        r => Number(r.COST)                   || 0,
    lead_units:  r => Number(r.LEAD_UNITS_SOLD)        || 0,
    ads_revenue: r => Number(r.ADS_REVENUE)            || 0,
    margin_rate: r => Number(r.MARGIN_RATE)            || 0,
    ad_profit:   r => Number(r.AD_PROFIT_EST)          || 0,
    shop_units:  r => Number(r.SHOP_UNITS_30D)         || 0,
    vs_market:   r => r.PRICE_VS_BENCHMARK_PCT == null ? -Infinity : Number(r.PRICE_VS_BENCHMARK_PCT),
    cpc:         r => Number(r.AVG_CPC)                || 0,
  });

  const meta = document.getElementById('marketingMeta');
  if (meta) {
    meta.textContent =
      `${rows.length.toLocaleString()} products · ${fmtMoney(sum(rows, 'COST'), 0)} spend · ` +
      `${fmtMoney(sum(rows, 'AD_PROFIT_EST'), 0)} est. profit (filtered)`;
  }

  const tbody = document.getElementById('marketingBody');
  if (!rows.length) {
    const msg = searchRaw.trim() ? `No products matching "${searchRaw}"` : 'No rows for this filter';
    tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:40px;color:var(--text3);">${msg}</td></tr>`;
    return;
  }

  const V = 'font-size:13px;font-weight:700;';
  tbody.innerHTML = rows.map((r, i) => {
    const profit = Number(r.AD_PROFIT_EST);
    const profitColor = isNaN(profit) ? 'var(--text3)' : profit < 0 ? '#ef4444' : '#10b981';
    const vsPct = r.PRICE_VS_BENCHMARK_PCT == null ? null : Number(r.PRICE_VS_BENCHMARK_PCT);
    const vsColor = vsPct == null ? 'var(--text3)' : vsPct > 10 ? '#ef4444' : vsPct < -5 ? '#10b981' : 'var(--text2)';
    const marginEst = r.MARGIN_SOURCE === 'ACCOUNT_AVG';
    return `
    <tr>
      <td style="text-align:right;font-size:12px;color:var(--text3);">${i + 1}</td>
      <td style="text-align:left;vertical-align:top;">
        <div style="font-size:12px;color:var(--text);font-weight:600;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(r.TITLE || '')}">${escHtml(r.TITLE || '—')}</div>
        <div style="font-size:11px;color:var(--text3);font-family:monospace;">${escHtml(r.SAMPLE_SKU || '')}${Number(r.SKU_COUNT) > 1 ? ` +${Number(r.SKU_COUNT) - 1} SKUs` : ''}</div>
      </td>
      <td style="text-align:right;">${manufacturerChip(r.VENDOR)}</td>
      <td style="text-align:right;">${mkTierChip(r.TIER)}</td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmtInt(r.CLICKS)}</span></td>
      <td style="text-align:right;"><span style="font-size:13px;color:var(--text2);">${fmtInt(r.IMPRESSIONS)}</span></td>
      <td style="text-align:right;"><span style="${V}color:var(--text);">${fmtMoney(r.COST)}</span></td>
      <td style="text-align:right;" title="Units of THIS product bought after its ad was clicked (Google cart data)"><span style="${V}color:var(--text);">${fmtNum(r.LEAD_UNITS_SOLD, 1)}</span></td>
      <td style="text-align:right;vertical-align:top;" title="lead ${fmtMoney(r.LEAD_REVENUE)} + cross-sell ${fmtMoney(r.CROSS_SELL_REVENUE)}">
        <div style="${V}color:var(--text);">${fmtMoney(r.ADS_REVENUE)}</div>
        <div style="font-size:10px;color:var(--text3);">L ${fmtMoney(r.LEAD_REVENUE, 0)} · X ${fmtMoney(r.CROSS_SELL_REVENUE, 0)}</div>
      </td>
      <td style="text-align:right;" title="${marginEst ? 'No product sales history with cost data in 90d — account-average margin used' : 'Product’s own 90d margin (after platform fees and COGS)'}">
        <span style="font-size:13px;color:var(--text2);">${r.MARGIN_RATE == null ? '—' : (Number(r.MARGIN_RATE) * 100).toFixed(1) + '%'}${marginEst ? '<span style="color:var(--text3);">*</span>' : ''}</span>
      </td>
      <td style="text-align:right;"><span style="${V}color:${profitColor};">${fmtMoney(r.AD_PROFIT_EST)}</span></td>
      <td style="text-align:right;vertical-align:top;" title="Our own Shopify orders in the same 30 days (all traffic, not just ads)">
        <div style="${V}color:var(--text);">${fmtInt(r.SHOP_UNITS_30D)}</div>
        <div style="font-size:10px;color:var(--text3);">${fmtMoney(r.SHOP_SALES_30D, 0)}</div>
      </td>
      <td style="text-align:right;" title="${vsPct == null ? 'No Google market benchmark for this product' : `Our ${fmtMoney(r.OUR_PRICE)} vs market ${fmtMoney(r.BENCHMARK_PRICE)} (click-weighted)`}">
        <span style="${V}color:${vsColor};">${vsPct == null ? '—' : (vsPct > 0 ? '+' : '') + vsPct.toFixed(1) + '%'}</span>
      </td>
      <td style="text-align:right;"><span style="font-size:13px;color:var(--text2);">${fmtMoney(r.AVG_CPC)}</span></td>
    </tr>`;
  }).join('');
}
window.renderMarketingPage = renderMarketingPage;

// ── CSV download ──────────────────────────────────────────────────────────────

function downloadMarketingCSV() {
  const rows = marketingFilteredRows();
  if (!rows.length) return;
  const cols = ['PRODUCT_KEY', 'TITLE', 'VENDOR', 'SAMPLE_SKU', 'SKU_COUNT', 'TIER',
    'CLICKS', 'IMPRESSIONS', 'COST', 'AVG_CPC', 'LEAD_UNITS_SOLD', 'LEAD_REVENUE',
    'CROSS_SELL_UNITS_SOLD', 'CROSS_SELL_REVENUE', 'ADS_REVENUE', 'MARGIN_RATE',
    'MARGIN_SOURCE', 'AD_PROFIT_EST', 'SHOP_UNITS_30D', 'SHOP_SALES_30D',
    'SHOP_PROFIT_30D', 'OUR_PRICE', 'BENCHMARK_PRICE', 'PRICE_VS_BENCHMARK_PCT'];
  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [cols.join(',')]
    .concat(rows.map(r => cols.map(c => esc(r[c])).join(',')))
    .join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `ads_pl_30d_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
window.downloadMarketingCSV = downloadMarketingCSV;
