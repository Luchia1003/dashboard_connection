// ── Action Center ─────────────────────────────────────────────────────────────
// Surfaces every loss-making order / SKU under one "Profit < 0" board, classified
// by root cause so each row maps to a concrete human action.
//
// Classification (the heart of the page): for each loss we first ask "was it
// already negative BEFORE any fee (just SALES_MARGIN − COGS)?". If yes → PRICING
// (the foundational problem). If it only went negative after a fee, we attribute
// the loss to that fee: DROPSHIP, COUPON, or (SKU level only) RETURN.
//
// Priority when the same key is hit by multiple sources:
//   PRICING (3) > DROPSHIP (2) = COUPON (2) > RETURN (1)
//
// Nothing is persisted — every visit recomputes the current snapshot. Each
// insight carries a stable `key` (no date) for dedup + as a future persistence
// hook.

const AC = {
  CAUSE_PRIORITY: { PRICING: 3, DROPSHIP: 2, COUPON: 2, RETURN: 1 },
  CAUSE_CLASS:    { PRICING: 'ac-pricing', DROPSHIP: 'ac-dropship', COUPON: 'ac-coupon', RETURN: 'ac-return' },
  CAUSE_SUGGEST: {
    PRICING:  'Loss before any fee → raise price / cut product',
    DROPSHIP: 'Dropship fee turned it negative → switch supplier / adjust price',
    COUPON:   'Coupon turned it negative → pause / adjust coupon',
    RETURN:   'Returns turned it negative → check quality / listing / return reasons',
  },
};

function acNum(v) { return Number(v) || 0; }

// Platform pill colours, matching the rest of the dashboard.
function acPlatPill(platform) {
  const p = String(platform || '').trim();
  const low = p.toLowerCase();
  const color = low === 'shopify' ? '#10b981' : low === 'amazon' ? '#f59e0b' : 'var(--text2)';
  const bg    = low === 'shopify' ? 'rgba(16,185,129,.12)' : low === 'amazon' ? 'rgba(245,158,11,.12)' : 'rgba(100,116,139,.12)';
  if (!p) return '';
  return `<span class="ac-plat" style="color:${color};background:${bg};">${p}</span>`;
}

// ── Data load (parallel, fills any missing dataset) ───────────────────────────

function acRenderLoading() {
  const el = document.getElementById('actionBody');
  if (!el) return;
  el.innerHTML = `
    <div class="card" style="padding:48px;text-align:center;color:var(--text3);">
      <div style="display:inline-block;width:30px;height:30px;border:2px solid var(--border);border-top-color:#0ea5e9;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:12px;"></div>
      <div style="font-size:13px;">Crunching loss-making orders &amp; SKUs…</div>
    </div>`;
}

async function acFetchJSON(url) {
  const r = await fetch(url);
  if (r.status === 401) { window.location.href = '/login.html'; throw new Error('unauthorized'); }
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

async function loadActionCenterData() {
  const ready = Array.isArray(S.orderDetail) && Array.isArray(S.couponOrder) &&
                Array.isArray(S.couponSku)   && Array.isArray(S.sku);
  if (ready) { renderActionCenterPage(); return; }

  acRenderLoading();
  try {
    const jobs = [];
    if (!Array.isArray(S.orderDetail)) jobs.push(acFetchJSON('/api/order-detail').then(d => { S.orderDetail = d; }));
    if (!Array.isArray(S.couponOrder)) jobs.push(acFetchJSON('/api/coupon-order').then(d => { S.couponOrder = d; }));
    if (!Array.isArray(S.couponSku))   jobs.push(acFetchJSON('/api/coupon-sku').then(d => { S.couponSku = d; }));
    if (!Array.isArray(S.sku))         jobs.push(acFetchJSON('/api/sku').then(d => { S.sku = d; }));
    await Promise.all(jobs);
    renderActionCenterPage();
  } catch (err) {
    if (err.message === 'unauthorized') return;
    const el = document.getElementById('actionBody');
    if (el) el.innerHTML = `<div class="card" style="padding:40px;text-align:center;color:#ef4444;font-size:13px;">${err.message}</div>`;
  }
}
window.loadActionCenterData = loadActionCenterData;

// ── Compute: Order Level ──────────────────────────────────────────────────────

// 2a. ORDER_LEVEL_PROFIT → PRICING / DROPSHIP. The table is a ~5-day rolling
// window on the Snowflake side, so we just scan every loss-making row.
function acOrderPricingDropship() {
  const out = [];
  (S.orderDetail || []).forEach(r => {
    const profit = acNum(r.PROFIT);
    if (profit >= 0) return;

    const qty         = acNum(r.QTY);
    const salesMargin = acNum(r.SALES_MARGIN);
    const dropshipFee = acNum(r.DROPSHIP_FEE);
    const unitCost    = acNum(r.UNIT_COST);
    // SALES_MARGIN is already net of the dropship fee → add it back to recover
    // the pre-dropship profit (non-dropship rows have DROPSHIP_FEE = 0).
    const preFee = salesMargin + dropshipFee - unitCost * qty;
    const ds     = typeof isDropShip === 'function' ? isDropShip(r) : false;

    let cause;
    if (preFee < 0)   cause = 'PRICING';
    else if (ds)      cause = 'DROPSHIP';
    else {
      cause = 'PRICING';
      console.warn('[ActionCenter] Non-dropship order positive pre-fee yet PROFIT<0 — verify data', r.ORDER_ID, r.SKU);
    }

    out.push({
      key: `order:${r.ORDER_ID}:${r.SKU}`,
      level: 'order', cause,
      orderId: r.ORDER_ID, sku: r.SKU, platform: r.PLATFORM || '',
      profit, preFreeProfit: preFee,
      productSales: acNum(r.PRODUCT_SALES),
      salesMargin, unitCost, qty, dropshipFee,
    });
  });
  return out;
}

// 2b. DAILY_ORDER_COUPON_PROFIT → COUPON. Losses already negative before the
// coupon are PRICING and left for dedup to merge with the 2a hit.
function acOrderCoupon() {
  const out = [];
  (S.couponOrder || []).forEach(r => {
    const profit = acNum(r.PROFIT);
    if (profit >= 0) return;

    const qty         = acNum(r.QUANTITY);
    const salesMargin = acNum(r.SALES_MARGIN); // pre-coupon, pre-COGS in this table
    const unitCost    = acNum(r.UNIT_COST);
    const preCoupon   = salesMargin - unitCost * qty;
    if (preCoupon < 0) return; // PRICING — handled by 2a / dedup

    out.push({
      key: `order:${r.ORDER_ID}:${r.SKU}`,
      level: 'order', cause: 'COUPON',
      orderId: r.ORDER_ID, sku: r.SKU, platform: r.PLATFORM || '',
      profit, preFreeProfit: preCoupon,
      productSales: acNum(r.PRODUCT_SALES),
      salesMargin, unitCost, qty,
      couponFee: acNum(r.COUPON_FEE),
    });
  });
  return out;
}

// ── Compute: SKU Level ────────────────────────────────────────────────────────

// 3a. SKU_SUMMARY_METRICS → PRICING / RETURN. Must aggregate by
// (SALES_SKU, PLATFORM) within the Product Detail Time Range BEFORE judging,
// otherwise "loss one day, profit overall" SKUs get falsely flagged.
function acSkuPricingReturn() {
  const rows = filterData(S.sku, S.tr, S.customFrom, S.customTo); // time range, all platforms
  const groups = new Map();
  rows.forEach(r => {
    const sku = r.SALES_SKU || 'UNKNOWN';
    const platform = r.PLATFORM || '';
    const k = `${platform}|${sku}`;
    let g = groups.get(k);
    if (!g) { g = { sku, platform, orderProfit: 0, netProfit: 0, netSales: 0, netMargin: 0, netQty: 0, unitCost: 0 }; groups.set(k, g); }
    g.orderProfit += acNum(r.ORDER_PROFIT);
    g.netProfit   += acNum(r.NET_PROFIT);
    g.netSales    += acNum(r.NET_PRODUCT_SALES);
    g.netMargin   += acNum(r.NET_MARGIN);
    g.netQty      += acNum(r.NET_QUANTITY);
    if (!g.unitCost) g.unitCost = acNum(r.UNIT_COST);
  });

  const out = [];
  groups.forEach(g => {
    let cause, profit, preFree;
    if (g.orderProfit < 0) {            // loses money before returns → pricing
      cause = 'PRICING'; profit = g.orderProfit; preFree = g.orderProfit;
    } else if (g.netProfit < 0) {       // profitable pre-return, returns sink it
      cause = 'RETURN';  profit = g.netProfit;   preFree = g.orderProfit;
    } else {
      return;
    }
    out.push({
      key: `sku:${g.platform}:${g.sku}`,
      level: 'sku', cause,
      sku: g.sku, platform: g.platform,
      profit, preFreeProfit: preFree,
      productSales: g.netSales, salesMargin: g.netMargin,
      unitCost: g.unitCost, qty: g.netQty,
    });
  });
  return out;
}

// 3b. DAILY_SKU_COUPON_PROFIT → COUPON (SKU level). Data is only ~3 days and has
// no platform column, so we aggregate by SKU across its inherent window.
function acSkuCoupon() {
  const groups = new Map();
  (S.couponSku || []).forEach(r => {
    const sku = r.SKU || 'UNKNOWN';
    let g = groups.get(sku);
    if (!g) { g = { sku, margin: 0, qty: 0, profit: 0, couponFee: 0, productSales: 0, unitCost: acNum(r.UNIT_COST) }; groups.set(sku, g); }
    g.margin       += acNum(r.TOTAL_MARGIN);
    g.qty          += acNum(r.TOTAL_QUANTITY);
    g.profit       += acNum(r.TOTAL_PROFIT);
    g.couponFee    += acNum(r.TOTAL_COUPON_FEE);
    g.productSales += acNum(r.TOTAL_PRODUCT_SALES);
    if (!g.unitCost) g.unitCost = acNum(r.UNIT_COST);
  });

  const out = [];
  groups.forEach(g => {
    if (g.profit >= 0) return;
    const preCoupon = g.margin - g.unitCost * g.qty;
    if (preCoupon < 0) return; // PRICING — left for 3a
    out.push({
      key: `sku::${g.sku}`, // no platform in this table
      level: 'sku', cause: 'COUPON',
      sku: g.sku, platform: '',
      profit: g.profit, preFreeProfit: preCoupon,
      productSales: g.productSales, salesMargin: g.margin,
      unitCost: g.unitCost, qty: g.qty, couponFee: g.couponFee,
    });
  });
  return out;
}

// ── Dedup by key, keep highest-priority cause ─────────────────────────────────

function acDedup(candidates) {
  const byKey = new Map();
  candidates.forEach(c => {
    const cur = byKey.get(c.key);
    if (!cur) { byKey.set(c.key, c); return; }
    const pNew = AC.CAUSE_PRIORITY[c.cause] || 0;
    const pCur = AC.CAUSE_PRIORITY[cur.cause] || 0;
    if (pNew > pCur) byKey.set(c.key, c);
    else if (pNew === pCur && c.cause !== cur.cause) {
      console.warn('[ActionCenter] Same key, two equal-priority causes — keeping first', c.key, cur.cause, c.cause);
    }
  });
  return [...byKey.values()];
}

function acBuildInsights() {
  const candidates = [
    ...acOrderPricingDropship(),
    ...acOrderCoupon(),
    ...acSkuPricingReturn(),
    ...acSkuCoupon(),
  ];
  return acDedup(candidates);
}

// ── Render ────────────────────────────────────────────────────────────────────

function acCauseCounts(list) {
  const c = {};
  list.forEach(i => { c[i.cause] = (c[i.cause] || 0) + 1; });
  return c;
}

// Inline metric chips shown in the middle of each row.
function acMetrics(i) {
  const chips = [];
  const chip = (label, val, color) =>
    `<span class="ac-metric"><span class="ac-metric-l">${label}</span> <span class="ac-metric-v"${color ? ` style="color:${color};"` : ''}>${val}</span></span>`;
  if (i.productSales != null) chips.push(chip('Product Sales', fmt(i.productSales)));
  if (i.salesMargin  != null) chips.push(chip('Sales Margin', fmt(i.salesMargin), i.salesMargin < 0 ? '#ef4444' : ''));
  if (i.unitCost)             chips.push(chip('Unit Cost', fmt(i.unitCost)));
  if (i.qty != null)          chips.push(chip('Qty', Math.round(i.qty).toLocaleString()));
  if (i.dropshipFee)          chips.push(chip('DS Fee', fmt(i.dropshipFee), '#f59e0b'));
  if (i.couponFee)            chips.push(chip('Coupon Fee', fmt(i.couponFee), '#a855f7'));
  return chips.join('');
}

function acRow(i) {
  // Attribution line — only for non-PRICING causes (PRICING is self-evident from
  // the board title). Emphasised so the "why" stands out.
  let explain = '';
  if (i.cause === 'DROPSHIP') explain = `pre-dropship ${fmt(i.preFreeProfit)} · DS fee ${fmt(i.dropshipFee)}`;
  else if (i.cause === 'COUPON') explain = `pre-coupon ${fmt(i.preFreeProfit)} · coupon ${fmt(i.couponFee)}`;
  else if (i.cause === 'RETURN') explain = `pre-return ${fmt(i.preFreeProfit)}`;

  // Order level → Order ID is the headline (used to search on Amazon/Shopify),
  // SKU sits underneath. SKU level → SKU is the headline.
  const platPill = acPlatPill(i.platform);
  const ident = i.level === 'order'
    ? `<div class="ac-orderid">${i.orderId || '—'}</div>
       <div class="ac-subline">${i.sku || '—'} ${platPill}</div>`
    : `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
         <span class="ac-skubig">${i.sku || '—'}</span>${platPill}
       </div>`;

  // Flag order rows that have $0 product sales — likely missing data, not a real loss.
  const missing = (i.level === 'order' && !i.productSales)
    ? `<span class="ac-missing">⚠ possibly missing data</span>` : '';

  return `
    <div class="ac-row">
      <div><span class="ac-cause-badge ${AC.CAUSE_CLASS[i.cause]}">${i.cause}</span></div>
      <div class="ac-ident">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${ident}${missing}</div>
        <div class="ac-metrics">${acMetrics(i)}</div>
      </div>
      <div class="ac-nums">
        <div class="ac-loss">${fmt(i.profit)}</div>
        ${explain ? `<div class="ac-explain">${explain}</div>` : ''}
      </div>
    </div>`;
}

// Clickable legend = filter chips + explanation of what each cause means.
function acLegend(counts, causeOrder, active) {
  return `<div class="ac-legend">` + causeOrder
    .filter(c => counts[c])
    .map(c => {
      const cls = active && active !== c ? 'ac-filter-chip dim' : (active === c ? 'ac-filter-chip active' : 'ac-filter-chip');
      return `
        <button class="${cls}" onclick="acToggleCause('${c}')">
          <span class="ac-cause-badge ${AC.CAUSE_CLASS[c]}">${c}</span>
          <div style="min-width:0;">
            <span class="ac-chip-count">${counts[c]}</span>
            <div class="ac-chip-desc">${AC.CAUSE_SUGGEST[c]}</div>
          </div>
        </button>`;
    }).join('') + `</div>`;
}

function acSetLevel(level) {
  S.acLevel = level;
  S.acCause = '';           // reset filter — causes differ between levels
  renderActionCenterPage();
}
window.acSetLevel = acSetLevel;

function acToggleCause(cause) {
  S.acCause = (S.acCause === cause) ? '' : cause;
  renderActionCenterPage();
}
window.acToggleCause = acToggleCause;

function renderActionCenterPage() {
  const el = document.getElementById('actionBody');
  if (!el) return;
  const ready = Array.isArray(S.orderDetail) && Array.isArray(S.couponOrder) &&
                Array.isArray(S.couponSku)   && Array.isArray(S.sku);
  if (!ready) { loadActionCenterData(); return; }

  const insights = acBuildInsights();
  const orderInsights = insights.filter(i => i.level === 'order');
  const skuInsights   = insights.filter(i => i.level === 'sku');

  const level    = S.acLevel || 'order';
  const fullList = level === 'order' ? orderInsights : skuInsights;
  const counts   = acCauseCounts(fullList);
  const causeOrder = level === 'order' ? ['PRICING', 'DROPSHIP', 'COUPON'] : ['PRICING', 'RETURN', 'COUPON'];

  // Apply the active cause filter.
  let list = S.acCause ? fullList.filter(i => i.cause === S.acCause) : fullList;
  list = [...list].sort((a, b) => {
    const pa = AC.CAUSE_PRIORITY[a.cause] || 0, pb = AC.CAUSE_PRIORITY[b.cause] || 0;
    if (pa !== pb) return pb - pa;
    return a.profit - b.profit; // most negative first
  });

  const subtitle = level === 'order'
    ? 'Recent orders · 5-day rolling (dropship) · last 3 days (coupon)'
    : `Follows Product Detail Time Range · ${typeof trDisplay === 'function' ? trDisplay() : 'All time'} (coupon: last 3 days)`;

  const header = `
    <div class="card" style="padding:18px 20px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span style="font-size:22px;">⚠️</span>
        <div>
          <div style="font-size:18px;font-weight:800;color:var(--text);">Profit &lt; 0</div>
          <div style="font-size:12px;color:var(--text3);">Loss-making orders &amp; SKUs grouped by root cause — click a card to filter</div>
        </div>
        <div style="flex:1;"></div>
        <div class="ac-level-toggle">
          <button class="ac-level-btn ${level === 'order' ? 'active' : ''}" onclick="acSetLevel('order')">
            Order Level <span class="ac-lvl-count">${orderInsights.length}</span>
          </button>
          <button class="ac-level-btn ${level === 'sku' ? 'active' : ''}" onclick="acSetLevel('sku')">
            SKU Level <span class="ac-lvl-count">${skuInsights.length}</span>
          </button>
        </div>
      </div>
      <div style="margin-top:16px;">
        ${Object.keys(counts).length
          ? acLegend(counts, causeOrder, S.acCause)
          : '<span style="font-size:13px;color:var(--text3);">No losses detected in this view 🎉</span>'}
      </div>
    </div>`;

  const body = list.length
    ? list.map(acRow).join('')
    : `<div class="ac-empty">${S.acCause ? `No ${S.acCause} ${level === 'order' ? 'orders' : 'SKUs'}` : `No loss-making ${level === 'order' ? 'orders' : 'SKUs'} 🎉`}</div>`;

  const section = `
    <div class="card" style="overflow:hidden;">
      <div class="ac-section-title">
        <h3 style="font-size:15px;font-weight:700;color:var(--text);">${level === 'order' ? 'Order Level' : 'SKU Level'}</h3>
        <span style="font-size:12px;color:var(--text3);">${subtitle}</span>
        <div style="flex:1;"></div>
        <span style="font-size:13px;font-weight:700;color:${list.length ? '#ef4444' : 'var(--text3)'};">${list.length}${S.acCause ? ` / ${fullList.length}` : ''}</span>
      </div>
      <div>${body}</div>
    </div>`;

  el.innerHTML = header + section;
}
window.renderActionCenterPage = renderActionCenterPage;
