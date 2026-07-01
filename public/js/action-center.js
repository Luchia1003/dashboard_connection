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
    PRICING:  'Already negative before returns & fees → raise price / cut product',
    DROPSHIP: 'Dropship fee turned it negative → switch supplier / adjust price',
    COUPON:   'Coupon turned it negative → pause / adjust coupon',
    RETURN:   'Profitable before returns; returns sink it → check quality / listing / return reason',
  },
};

function acNum(v) { return Number(v) || 0; }

// (Re)build the shared inventory + restock lookups from S (spec §1 / §3.2).
function acBuildInvIndexes() {
  if (typeof buildInventoryIndex === 'function' && Array.isArray(S.inventoryPool))     buildInventoryIndex();
  if (typeof buildRestockIndex   === 'function' && Array.isArray(S.inventoryForecast)) buildRestockIndex();
}

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
    <tr><td colspan="11" style="text-align:center;padding:48px;color:var(--text3);">
      <div style="display:inline-block;width:30px;height:30px;border:2px solid var(--border);border-top-color:#0ea5e9;border-radius:50%;animation:spin .8s linear infinite;margin-bottom:12px;"></div>
      <div style="font-size:13px;">Crunching loss-making orders &amp; SKUs…</div>
    </td></tr>`;
}

async function acFetchJSON(url) {
  const r = await fetch(url);
  if (r.status === 401) { window.location.href = '/login.html'; throw new Error('unauthorized'); }
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

async function loadActionCenterData() {
  const ready = Array.isArray(S.orderDetail) && Array.isArray(S.couponOrder) &&
                Array.isArray(S.couponSku)   && Array.isArray(S.sku) &&
                Array.isArray(S.inventoryForecast) && Array.isArray(S.invRecon);
  if (ready) { acBuildInvIndexes(); renderActionCenterPage(); return; }

  acRenderLoading();
  try {
    const jobs = [];
    if (!Array.isArray(S.orderDetail)) jobs.push(acFetchJSON('/api/order-detail').then(d => { S.orderDetail = d; }));
    if (!Array.isArray(S.couponOrder)) jobs.push(acFetchJSON('/api/coupon-order').then(d => { S.couponOrder = d; }));
    if (!Array.isArray(S.couponSku))   jobs.push(acFetchJSON('/api/coupon-sku').then(d => { S.couponSku = d; }));
    if (!Array.isArray(S.sku))         jobs.push(acFetchJSON('/api/sku').then(d => { S.sku = d; }));
    // Inventory pool (current stock) + forecast (restock signal) — supplementary.
    if (!Array.isArray(S.inventoryPool))     jobs.push(acFetchJSON('/api/inventory-pool').then(d => { S.inventoryPool = d; }).catch(() => { S.inventoryPool = []; }));
    if (!Array.isArray(S.inventoryForecast)) jobs.push(acFetchJSON('/api/inventory-forecast').then(d => { S.inventoryForecast = d; }).catch(() => { S.inventoryForecast = []; }));
    // Amazon ⟷ supplier master inventory reconciliation (Inventory Check tab).
    if (!Array.isArray(S.invRecon)) jobs.push(acFetchJSON('/api/inventory-reconciliation').then(d => { S.invRecon = d; }).catch(() => { S.invRecon = []; }));
    await Promise.all(jobs);
    acBuildInvIndexes();
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
      orderDate: String(r.ORDER_DATE || '').slice(0, 10),
      profit, preFreeProfit: preFee,
      productSales: acNum(r.PRODUCT_SALES),
      salesMargin, unitCost, qty, dropshipFee,
      shippingFee: acNum(r.SHIPPING_FEE),
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
      orderDate: String(r.ORDER_DATE || '').slice(0, 10),
      profit, preFreeProfit: preCoupon,
      productSales: acNum(r.PRODUCT_SALES),
      salesMargin, unitCost, qty,
      couponFee: acNum(r.COUPON_FEE),
      shippingFee: acNum(r.SHIPPING_FEE),
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
    if (!g) {
      g = { sku, platform, orderProfit: 0, netProfit: 0,
            orderSales: 0, netSales: 0, orderMargin: 0, netMargin: 0,
            orderQty: 0, netQty: 0, refundQty: 0, unitCost: 0 };
      groups.set(k, g);
    }
    g.orderProfit += acNum(r.ORDER_PROFIT);
    g.netProfit   += acNum(r.NET_PROFIT);
    g.orderSales  += acNum(r.ORDER_PRODUCT_SALES);
    g.netSales    += acNum(r.NET_PRODUCT_SALES);
    g.orderMargin += acNum(r.ORDER_MARGIN);
    g.netMargin   += acNum(r.NET_MARGIN);
    g.orderQty    += acNum(r.ORDER_QUANTITY);
    g.netQty      += acNum(r.NET_QUANTITY);
    g.refundQty   += acNum(r.REFUND_QUANTITY);
    if (!g.unitCost) g.unitCost = acNum(r.UNIT_COST);
  });

  const out = [];
  groups.forEach(g => {
    let cause;
    if (g.orderProfit < 0)      cause = 'PRICING'; // negative before returns
    else if (g.netProfit < 0)   cause = 'RETURN';  // returns sink an otherwise-profitable SKU
    else return;

    // Return rate = |refund qty| / order qty over the window (matches Product Detail).
    const returnRate = g.orderQty ? Math.abs(g.refundQty) / g.orderQty : null;

    out.push({
      key: `sku:${g.platform}:${g.sku}`,
      level: 'sku', cause, skuKind: 'pr',
      sku: g.sku, platform: g.platform,
      // headline value used for sorting = the cause-driving profit
      profit: cause === 'PRICING' ? g.orderProfit : g.netProfit,
      orderProfit: g.orderProfit, netProfit: g.netProfit,
      orderSales: g.orderSales, netSales: g.netSales,
      orderMargin: g.orderMargin, netMargin: g.netMargin,
      orderQty: g.orderQty, netQty: g.netQty,
      unitCost: g.unitCost, returnRate,
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
      level: 'sku', cause: 'COUPON', skuKind: 'coupon',
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

// ── CSV download (all order-level / all SKU-level insights) ───────────────────

const AC_ORDER_COLS = ['CAUSE', 'ORDER_ID', 'SKU', 'PLATFORM', 'ORDER_DATE', 'QTY',
  'PRODUCT_SALES', 'SALES_MARGIN', 'UNIT_COST', 'DROPSHIP_FEE', 'SHIPPING_FEE', 'COUPON_FEE',
  'PRE_FEE_PROFIT', 'PROFIT'];
const AC_SKU_COLS = ['CAUSE', 'SKU', 'PLATFORM', 'ORDER_PROFIT', 'NET_PROFIT',
  'ORDER_PRODUCT_SALES', 'NET_PRODUCT_SALES', 'ORDER_MARGIN', 'NET_MARGIN',
  'ORDER_QTY', 'NET_QTY', 'UNIT_COST', 'RETURN_RATE', 'COUPON_FEE',
  'PRE_COUPON_PROFIT', 'PROFIT'];

const acRound = v => (v == null ? '' : Math.round(Number(v) * 100) / 100);

function acOrderCsvRow(i) {
  return {
    CAUSE: i.cause, ORDER_ID: i.orderId, SKU: i.sku, PLATFORM: i.platform,
    ORDER_DATE: i.orderDate || '', QTY: i.qty,
    PRODUCT_SALES: acRound(i.productSales), SALES_MARGIN: acRound(i.salesMargin),
    UNIT_COST: acRound(i.unitCost), DROPSHIP_FEE: i.dropshipFee ? acRound(i.dropshipFee) : '',
    SHIPPING_FEE: i.shippingFee ? acRound(i.shippingFee) : '',
    COUPON_FEE: i.couponFee ? acRound(i.couponFee) : '',
    PRE_FEE_PROFIT: acRound(i.preFreeProfit), PROFIT: acRound(i.profit),
  };
}

function acSkuCsvRow(i) {
  if (i.skuKind === 'coupon') {
    return {
      CAUSE: i.cause, SKU: i.sku, PLATFORM: i.platform,
      ORDER_PROFIT: '', NET_PROFIT: acRound(i.profit),
      ORDER_PRODUCT_SALES: '', NET_PRODUCT_SALES: acRound(i.productSales),
      ORDER_MARGIN: '', NET_MARGIN: acRound(i.salesMargin),
      ORDER_QTY: '', NET_QTY: i.qty, UNIT_COST: acRound(i.unitCost),
      RETURN_RATE: '', COUPON_FEE: acRound(i.couponFee),
      PRE_COUPON_PROFIT: acRound(i.preFreeProfit), PROFIT: acRound(i.profit),
    };
  }
  return {
    CAUSE: i.cause, SKU: i.sku, PLATFORM: i.platform,
    ORDER_PROFIT: acRound(i.orderProfit), NET_PROFIT: acRound(i.netProfit),
    ORDER_PRODUCT_SALES: acRound(i.orderSales), NET_PRODUCT_SALES: acRound(i.netSales),
    ORDER_MARGIN: acRound(i.orderMargin), NET_MARGIN: acRound(i.netMargin),
    ORDER_QTY: i.orderQty, NET_QTY: i.netQty, UNIT_COST: acRound(i.unitCost),
    RETURN_RATE: i.returnRate != null ? acRound(i.returnRate * 100) + '%' : '',
    COUPON_FEE: '', PRE_COUPON_PROFIT: '', PROFIT: acRound(i.profit),
  };
}

// Download every insight of one level (ignores the active cause filter).
function acDownload(level) {
  const list = acBuildInsights().filter(i => i.level === level);
  if (!list.length) { alert(`No ${level}-level insights to download.`); return; }
  const stamp = typeof todayStamp === 'function' ? todayStamp() : '';
  if (level === 'order') {
    downloadCSV(list.map(acOrderCsvRow), `action_center_order_level_${stamp}.csv`, AC_ORDER_COLS);
  } else {
    downloadCSV(list.map(acSkuCsvRow), `action_center_sku_level_${stamp}.csv`, AC_SKU_COLS);
  }
}
window.acDownload = acDownload;

// ── Render ────────────────────────────────────────────────────────────────────

function acCauseCounts(list) {
  const c = {};
  list.forEach(i => { c[i.cause] = (c[i.cause] || 0) + 1; });
  return c;
}

function acColor(v) { return v < 0 ? '#ef4444' : 'var(--text)'; }

// A keyed value line inside a cell, e.g. "order $26.0K" / "net $25.3K".
function acKV(key, valHtml) {
  return `<div class="ln"><span class="k">${key}</span>${valHtml}</div>`;
}
// A right-aligned cell with stacked order/net lines (net reddened when negative).
function acDualCell(orderVal, netVal, money, single) {
  const f = v => money ? fmt(v) : Math.round(v || 0).toLocaleString();
  if (single) return `<td class="num"><b>${f(netVal)}</b></td>`;
  return `<td class="num">` +
    acKV('order', `<b>${f(orderVal)}</b>`) +
    acKV('net', `<b style="color:${Number(netVal) < 0 ? '#ef4444' : 'var(--text)'};">${f(netVal)}</b>`) +
    `</td>`;
}
const acDash = '<span style="color:var(--text3);">—</span>';

// ── Frozen column headers ─────────────────────────────────────────────────────
function acOrderHead() {
  return `<tr>
    <th style="text-align:left;">Cause</th>
    <th style="text-align:left;">Order ID / SKU</th>
    <th style="text-align:left;">Platform</th>
    <th>Order Date</th>
    <th>DS Fee</th>
    <th>Shipping</th>
    <th>Product Sales</th>
    <th>Sales Margin</th>
    <th>Unit Cost</th>
    <th>Qty</th>
    <th>Profit</th>
  </tr>`;
}
function acSkuHead() {
  return `<tr>
    <th style="text-align:left;">Cause</th>
    <th style="text-align:left;">SKU</th>
    <th style="text-align:left;">Platform</th>
    <th>Inventory</th>
    <th>Product Sales</th>
    <th>Sales Margin</th>
    <th>Quantity</th>
    <th>Unit Cost</th>
    <th>Return Rate</th>
    <th>Restock</th>
    <th>Profit</th>
    <th>Reprice</th>
  </tr>`;
}

// ── Order level table row ─────────────────────────────────────────────────────
function acOrderTr(i) {
  const missing = !i.productSales
    ? `<div style="margin-top:5px;"><span class="ac-missing">⚠ possibly missing data</span></div>` : '';
  let explain = '';
  if (i.cause === 'DROPSHIP') explain = `pre-dropship ${fmt(i.preFreeProfit)} · DS fee ${fmt(i.dropshipFee)}`;
  else if (i.cause === 'COUPON') explain = `pre-coupon ${fmt(i.preFreeProfit)} · coupon ${fmt(i.couponFee)}`;
  return `<tr>
    <td style="text-align:left;"><span class="ac-cause-badge ${AC.CAUSE_CLASS[i.cause]}">${i.cause}</span></td>
    <td style="text-align:left;"><div class="ac-orderid">${i.orderId || '—'}</div><div class="ac-skusmall">${i.sku || '—'}</div></td>
    <td style="text-align:left;">${acPlatPill(i.platform) || acDash}${missing}</td>
    <td class="num" style="color:var(--text2);">${i.orderDate || acDash}</td>
    <td class="num">${i.dropshipFee ? `<b style="color:#f59e0b;">${fmt(i.dropshipFee)}</b>` : acDash}</td>
    <td class="num">${i.shippingFee ? `<b style="color:var(--text2);">${fmt(i.shippingFee)}</b>` : acDash}</td>
    <td class="num"><b>${fmt(i.productSales)}</b></td>
    <td class="num"><b style="color:${acColor(i.salesMargin)};">${fmt(i.salesMargin)}</b></td>
    <td class="num"><b>${fmt(i.unitCost)}</b></td>
    <td class="num"><b>${Math.round(i.qty || 0).toLocaleString()}</b></td>
    <td class="num"><div class="ac-loss">${fmt(i.profit)}</div>${explain ? `<div class="ac-explain">${explain}</div>` : ''}</td>
  </tr>`;
}

// ── SKU level table row (handles PRICING/RETURN and COUPON) ───────────────────
function acSkuTr(i) {
  const coupon = i.skuKind === 'coupon';
  const inv = (typeof inventoryForView === 'function') ? inventoryForView(i.sku, i.platform) : { found: false };
  let invCell;
  if (!inv.found) invCell = `<td class="num">${acDash}</td>`;
  else if (inv.split) invCell = `<td class="num">${acKV('FBA', `<b>${Math.round(inv.fba).toLocaleString()}</b>`)}${acKV('Whse', `<b>${Math.round(inv.hnp).toLocaleString()}</b>`)}</td>`;
  else invCell = `<td class="num">${acKV('Whse', `<b>${Math.round(inv.hnp).toLocaleString()}</b>`)}</td>`;

  const rrHigh = i.returnRate != null && i.returnRate > 0.10;
  const rrCell = coupon || i.returnRate == null
    ? `<td class="num">${acDash}</td>`
    : `<td class="num"><b style="color:${rrHigh ? '#f59e0b' : 'var(--text)'};">${fmt(i.returnRate, 'pct')}</b></td>`;

  const rs = (typeof lookupRestock === 'function') ? lookupRestock(i.platform, i.sku) : null;
  const restockCell = rs
    ? `<td class="num ac-restock">${acKV('suggest', `<b>${Math.round(rs.units).toLocaleString()}</b>`)}${rs.profit < 0 ? acKV('est loss', `<b>${fmt(Math.abs(rs.profit))}</b>`) : ''}</td>`
    : `<td class="num">${acDash}</td>`;

  // Profit cell: net (realised, larger) over order (pre-return). Coupon rows have
  // only one profit + a coupon attribution line.
  const profitCell = coupon
    ? `<td class="num"><b class="ac-loss">${fmt(i.profit)}</b><div class="ac-explain">pre-coupon ${fmt(i.preFreeProfit)} · coupon ${fmt(i.couponFee)}</div></td>`
    : `<td class="num">${acKV('net', `<b style="color:${acColor(i.netProfit)};font-size:18px;">${fmt(i.netProfit)}</b>`)}${acKV('order', `<b style="color:${acColor(i.orderProfit)};">${fmt(i.orderProfit)}</b>`)}</td>`;

  return `<tr>
    <td style="text-align:left;"><span class="ac-cause-badge ${AC.CAUSE_CLASS[i.cause]}">${i.cause}</span></td>
    <td style="text-align:left;"><span class="ac-skubig">${i.sku || '—'}</span></td>
    <td style="text-align:left;">${acPlatPill(i.platform) || acDash}</td>
    ${invCell}
    ${acDualCell(i.orderSales, coupon ? i.productSales : i.netSales, true, coupon)}
    ${acDualCell(i.orderMargin, coupon ? i.salesMargin : i.netMargin, true, coupon)}
    ${acDualCell(i.orderQty, coupon ? i.qty : i.netQty, false, coupon)}
    <td class="num"><b>${fmt(i.unitCost)}</b></td>
    ${rrCell}
    ${restockCell}
    ${profitCell}
    ${acRepriceCell(i)}
  </tr>`;
}

// Reprice control — Amazon & Shopify PRICING SKU rows. The button opens a
// dropdown of the SKU's listing(s) with current price; suggested price is a
// simple back-out to profit ≥ $2/unit from ORDER figures (fees already in):
//   suggested = current_unit_price + ($2 − order_profit_per_unit)
// Amazon → Informed manual price (all US variants); Shopify → the variant price.
function acRepriceCell(i) {
  const plat = String(i.platform || '').toLowerCase();
  const qty = i.orderQty || 0;
  if (i.skuKind === 'coupon' || !(plat === 'amazon' || plat === 'shopify') || i.cause !== 'PRICING' || !qty) return `<td class="num">${acDash}</td>`;
  const suggested = Math.max(0.01, (i.orderSales / qty) + (2 - i.orderProfit / qty)).toFixed(2);
  return `<td class="num"><button onclick="acRepriceOpen('${encodeURIComponent(i.sku)}',${suggested},'${plat}',this)"
      style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-weight:700;background:#2563eb;color:#fff;cursor:pointer;white-space:nowrap;">$${suggested} ▾</button></td>`;
}

const acMoney = v => v == null ? '—' : '$' + Number(v).toFixed(2);
let _acPop;
function acPopEl() {
  if (!_acPop) {
    _acPop = document.createElement('div');
    _acPop.style.cssText = 'position:fixed;z-index:9999;display:none;background:var(--card,#fff);color:var(--text,#111);border:1px solid var(--border,#ddd);border-radius:10px;box-shadow:0 10px 34px rgba(0,0,0,.2);padding:10px;min-width:330px;font-size:12px;';
    document.body.appendChild(_acPop);
    document.addEventListener('mousedown', e => { if (_acPop.style.display !== 'none' && !_acPop.contains(e.target) && !e.target.dataset.acOpen) _acPop.style.display = 'none'; });
    window.addEventListener('keydown', e => { if (e.key === 'Escape') _acPop.style.display = 'none'; });
  }
  return _acPop;
}
function acPopPlace(pop, r) {
  let left = r.right - pop.offsetWidth; if (left < 8) left = 8;
  let top = r.bottom + 6; if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - pop.offsetHeight - 6);
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
}

// Open the dropdown: fetch this SKU's listing variants (+ current price) and render.
window.acRepriceOpen = async function (skuEnc, suggested, platform, btn) {
  btn.dataset.acOpen = '1';
  const sku = decodeURIComponent(skuEnc);
  const pop = acPopEl(); const r = btn.getBoundingClientRect();
  pop.style.display = 'block'; pop.innerHTML = '<div style="color:var(--text3);padding:8px;">Loading…</div>';
  acPopPlace(pop, r);
  try {
    const res = await fetch(`/api/informed-set-price?platform=${encodeURIComponent(platform)}&sku=${encodeURIComponent(sku)}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
    pop.innerHTML = acPopHtml(sku, suggested, j.variants || [], platform);
  } catch (e) { pop.innerHTML = `<div style="color:#ef4444;padding:8px;">${e.message}</div>`; }
  acPopPlace(pop, r);
};

function acPopHtml(sku, suggested, vs, platform) {
  const shopify = platform === 'shopify';
  const cid = 'all_' + String(sku).replace(/[^A-Za-z0-9]/g, '_');
  const inp = (id, v) => `<span style="color:var(--text3);">$</span><input id="${id}" type="number" step="0.01" value="${v}" style="width:62px;padding:3px;border:1px solid var(--border);border-radius:5px;text-align:right;background:var(--bg);color:var(--text);"/>`;
  const rows = vs.map((v, idx) => {
    const id = 'v_' + idx;
    const badge = shopify ? '<b style="color:#10b981;">Shopify</b>' : (v.t === 'FBA' ? '<b style="color:#7c3aed;">FBA</b>' : '<b style="color:#0891b2;">FBM</b>');
    const live = /live/i.test(v.st) || !v.st ? '' : ` · ${v.st}`;
    return `<div style="display:flex;align-items:center;gap:6px;padding:6px 2px;border-top:1px solid var(--border);">
        <div style="flex:1;min-width:0;"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${v.s}</div>
          <div style="color:var(--text3);font-size:10px;">${badge} · now <b style="color:var(--text);">${acMoney(v.p)}</b>${live}</div></div>
        ${inp(id, suggested)}
        <button onclick="acSetVariant('${encodeURIComponent(v.s)}','${id}',this,false,'${platform}')" style="padding:3px 8px;border:none;border-radius:5px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer;">Set</button>
        <span class="vmsg" style="font-size:11px;min-width:16px;"></span>
      </div>`;
  }).join('');
  const setAll = shopify
    ? '' // Shopify has a single variant — the per-row Set is enough
    : `<div style="display:flex;align-items:center;gap:5px;">${inp(cid, suggested)}
        <button onclick="acSetVariant('${encodeURIComponent(sku)}','${cid}',this,true,'${platform}')" style="padding:3px 9px;border:none;border-radius:5px;background:#16a34a;color:#fff;font-weight:700;cursor:pointer;">Set all</button>
        <span class="vmsg" style="font-size:11px;min-width:16px;"></span></div>`;
  const note = shopify
    ? '"now" = current Shopify price. The change applies immediately.'
    : '"now" = price at last daily snapshot. Manual price pauses repricing until removed.';
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 2px 8px;">
      <b style="font-size:13px;">${sku}</b>${setAll}
    </div>
    ${vs.length ? rows : `<div style="color:var(--text3);padding:6px;">${shopify ? 'No Shopify variant found for this SKU.' : 'No US variants in snapshot.'}</div>`}
    <div style="color:var(--text3);font-size:10px;padding:7px 2px 0;">${note}</div>`;
}

// Submit a price. Amazon: manual price via Informed (expand=true → all US
// variants). Shopify: update the variant price directly (instant).
window.acSetVariant = async function (skuEnc, inputId, btn, expand, platform) {
  const sku = decodeURIComponent(skuEnc);
  const price = parseFloat((document.getElementById(inputId) || {}).value);
  const msg = btn.parentElement.querySelector('.vmsg');
  if (!(price > 0)) { msg.textContent = '✗'; msg.style.color = '#ef4444'; return; }
  const label = platform === 'shopify' ? `Shopify price for ${sku}` : `Amazon US manual price for ${sku}${expand ? ' (all variants)' : ''}`;
  if (!confirm(`Set ${label} to $${price.toFixed(2)}?`)) return;
  btn.disabled = true; msg.textContent = '…'; msg.style.color = 'var(--text3)';
  try {
    const res = await fetch('/api/informed-set-price', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ sku, price, expand, platform }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
    msg.textContent = '✓' + (j.successCount != null ? ' ' + j.successCount : '');
    msg.style.color = j.errorCount ? '#f59e0b' : '#16a34a';
  } catch (e) { msg.textContent = '✗'; msg.title = e.message; msg.style.color = '#ef4444'; }
  finally { btn.disabled = false; }
};

// Compact clickable cause chips (badge + count) for the single-row header.
// The cause meaning lives in the title tooltip to keep the row tight.
function acCauseChips(counts, causeOrder, active) {
  return causeOrder.filter(c => counts[c]).map(c => {
    const cls = active === c ? 'ac-cchip active' : (active ? 'ac-cchip dim' : 'ac-cchip');
    return `<button class="${cls}" onclick="acToggleCause('${c}')" title="${AC.CAUSE_SUGGEST[c]}">
        <span class="ac-cause-badge ${AC.CAUSE_CLASS[c]}">${c}</span><b>${counts[c]}</b>
      </button>`;
  }).join('');
}

// Keep the topbar level toggle (counts + active state) in sync with the data.
function acSyncLevelToggle(orderN, skuN, level) {
  const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  set('acOrderCount', orderN); set('acSkuCount', skuN);
  set('acInvCount', (S.invRecon || []).length);
  const ob = document.getElementById('acLevelOrderBtn'); if (ob) ob.classList.toggle('active', level === 'order');
  const sb = document.getElementById('acLevelSkuBtn');   if (sb) sb.classList.toggle('active', level === 'sku');
  const ib = document.getElementById('acLevelInvBtn');   if (ib) ib.classList.toggle('active', level === 'inv');
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
  const headEl = document.getElementById('actionHead');
  const bodyEl = document.getElementById('actionBody');
  const hdrEl  = document.getElementById('actionHeader');
  if (!bodyEl || !headEl || !hdrEl) return;
  const ready = Array.isArray(S.orderDetail) && Array.isArray(S.couponOrder) &&
                Array.isArray(S.couponSku)   && Array.isArray(S.sku) &&
                Array.isArray(S.invRecon);
  if (!ready) { loadActionCenterData(); return; }

  const insights = acBuildInsights();
  S._acInsights = insights;
  const orderInsights = insights.filter(i => i.level === 'order');
  const skuInsights   = insights.filter(i => i.level === 'sku');

  const level    = S.acLevel || 'order';
  const fullList = level === 'order' ? orderInsights : skuInsights;
  const counts   = acCauseCounts(fullList);
  const causeOrder = level === 'order' ? ['PRICING', 'DROPSHIP', 'COUPON'] : ['PRICING', 'RETURN', 'COUPON'];

  acSyncLevelToggle(orderInsights.length, skuInsights.length, level);

  // Inventory Check has its own header/table — everything below is the loss board.
  if (level === 'inv') { acRenderInvPage(); return; }

  const subtitle = level === 'order'
    ? 'Recent orders · 5-day rolling (dropship) · last 3 days (coupon)'
    : `Follows Product Detail Time Range · ${typeof trDisplay === 'function' ? trDisplay() : 'All time'} (coupon: last 3 days)`;

  const dlIcon = '<svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>';
  const ctrl = 'padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:var(--bg);color:var(--text);';
  const sortOpts = [['loss', 'Biggest loss'], ['smallest', 'Smallest loss'], ['sku', 'SKU A–Z'], ['sales', 'Product sales'], ['qty', 'Quantity']]
    .map(([v, l]) => `<option value="${v}"${(S.acSort || 'loss') === v ? ' selected' : ''}>${l}</option>`).join('');

  // Header card (stays fixed above the scrolling table): title · subtitle ·
  // cause chips · downloads.
  hdrEl.innerHTML = `
    <div class="card" style="padding:14px 20px;">
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:22px;">⚠️</span>
          <div>
            <div style="font-size:18px;font-weight:800;color:var(--text);">Profit &lt; 0</div>
            <div style="font-size:12px;color:var(--text3);">${level === 'order' ? 'Order Level' : 'SKU Level'} · ${subtitle} · <b id="acResultCount" style="color:#ef4444;"></b></div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          ${Object.keys(counts).length
            ? acCauseChips(counts, causeOrder, S.acCause)
            : '<span style="font-size:13px;color:var(--text3);">No losses detected 🎉</span>'}
        </div>
        <div style="flex:1;"></div>
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="position:relative;display:flex;align-items:center;">
            <input id="acSearch" value="${String(S.acSearch || '').replace(/"/g, '&quot;')}" oninput="acSearchChanged()" placeholder="Search SKU…" style="${ctrl}width:150px;padding-right:22px;"/>
            <button id="acSearchClear" onclick="acClearSearch()" title="Clear" style="position:absolute;right:4px;border:none;background:none;color:var(--text3);cursor:pointer;font-size:13px;display:${S.acSearch ? '' : 'none'};">✕</button>
          </div>
          <select id="acSort" onchange="acSortChanged()" style="${ctrl}">${sortOpts}</select>
        </div>
        <div class="dl-wrap" style="flex-direction:row;gap:8px;padding:6px 8px;">
          <button class="dl-btn" onclick="acDownload('order')" title="Download all order-level insights (ignores the cause filter)">${dlIcon} Order CSV</button>
          <button class="dl-btn" onclick="acDownload('sku')" title="Download all SKU-level insights (ignores the cause filter)">${dlIcon} SKU CSV</button>
        </div>
      </div>
    </div>`;

  headEl.innerHTML = level === 'order' ? acOrderHead() : acSkuHead();
  acRenderBody();
}
window.renderActionCenterPage = renderActionCenterPage;

// Filter (cause + SKU search) + sort + render the table body only. Called on
// search/sort change so the search box keeps focus (the header isn't rebuilt).
function acRenderBody() {
  const bodyEl = document.getElementById('actionBody');
  if (!bodyEl) return;
  const level = S.acLevel || 'order';
  const insights = S._acInsights || acBuildInsights();
  const fullList = insights.filter(i => i.level === level);

  let list = S.acCause ? fullList.filter(i => i.cause === S.acCause) : fullList;
  const q = String(S.acSearch || '').trim().toLowerCase();
  if (q) list = list.filter(i => String(i.sku || '').toLowerCase().includes(q) || String(i.orderId || '').toLowerCase().includes(q));

  const salesOf = i => level === 'order' ? (i.productSales || 0) : (i.orderSales || 0);
  const qtyOf   = i => level === 'order' ? (i.qty || 0) : (i.orderQty || 0);
  const cmp = {
    loss:     (a, b) => { const pa = AC.CAUSE_PRIORITY[a.cause] || 0, pb = AC.CAUSE_PRIORITY[b.cause] || 0; return pa !== pb ? pb - pa : a.profit - b.profit; },
    smallest: (a, b) => b.profit - a.profit,
    sku:      (a, b) => String(a.sku || '').localeCompare(String(b.sku || '')),
    sales:    (a, b) => salesOf(b) - salesOf(a),
    qty:      (a, b) => qtyOf(b) - qtyOf(a),
  }[S.acSort || 'loss'] || ((a, b) => a.profit - b.profit);
  list = [...list].sort(cmp);

  const cnt = document.getElementById('acResultCount');
  if (cnt) cnt.textContent = `${list.length}${(S.acCause || q) ? ` / ${fullList.length}` : ''}`;

  if (!list.length) {
    const noun = level === 'order' ? 'orders' : 'SKUs';
    const msg = q ? `No ${noun} matching "${S.acSearch}"` : (S.acCause ? `No ${S.acCause} ${noun}` : `No loss-making ${noun} 🎉`);
    bodyEl.innerHTML = `<tr><td colspan="${level === 'order' ? 11 : 12}" style="text-align:center;padding:40px;color:var(--text3);">${msg}</td></tr>`;
    return;
  }
  bodyEl.innerHTML = list.map(level === 'order' ? acOrderTr : acSkuTr).join('');
}

window.acSearchChanged = function () {
  S.acSearch = (document.getElementById('acSearch') || {}).value || '';
  const b = document.getElementById('acSearchClear'); if (b) b.style.display = S.acSearch ? '' : 'none';
  acRenderBody();
};
window.acClearSearch = function () {
  S.acSearch = '';
  const i = document.getElementById('acSearch'); if (i) i.value = '';
  const b = document.getElementById('acSearchClear'); if (b) b.style.display = 'none';
  acRenderBody();
};
window.acSortChanged = function () {
  S.acSort = (document.getElementById('acSort') || {}).value || 'loss';
  acRenderBody();
};

// ── Inventory Check (Amazon qty 0 · supplier master stock > 0) ────────────────
// Mirrors the daily manual reconciliation: All Listings Report vs
// MASTER_INVENTORY_SNAP. Data is precomputed daily on the Snowflake side
// (DASHBOARD_DB.INVENTORY_RECONCILIATION, rebuilt by the All Listings GitHub
// Action ~10:30 UTC) — the page just filters/sorts/renders it.

const AC_INV_COLS = ['SKU', 'AMAZON_INVENTORY', 'AMAZON_STATUS', 'MASTER_INVENTORY', 'DIFF',
  'WAREHOUSE_BREAKDOWN', 'MASTER_FLAG', 'OVERRIDE_FLAG', 'MISSED_SUPPLIER_INVENTORY', 'RUN_DATE'];

function acInvHead() {
  return `<tr>
    <th style="text-align:left;">SKU</th>
    <th style="text-align:left;">Amazon Status</th>
    <th>Amazon Qty</th>
    <th>Supplier Qty</th>
    <th>Diff</th>
    <th style="text-align:left;">Warehouse Breakdown</th>
    <th style="text-align:left;">Master Flag</th>
    <th style="text-align:left;">Override</th>
    <th style="text-align:left;">Missed Supplier</th>
  </tr>`;
}

function acInvTr(r) {
  const status = String(r.AMAZON_STATUS || '');
  const active = /^active$/i.test(status);
  const whs = String(r.WAREHOUSE_BREAKDOWN || '')
    .split(', ')
    .filter(Boolean)
    .map(w => `<div style="font-size:11px;color:var(--text2);white-space:nowrap;">${w}</div>`)
    .join('');
  const forced = r.OVERRIDE_FLAG === 'FORCED_ZERO';
  const missed = r.MISSED_SUPPLIER_INVENTORY === 'YES';
  return `<tr${forced ? ' style="opacity:.55;"' : ''}>
    <td style="text-align:left;"><span class="ac-skubig">${r.SKU || '—'}</span></td>
    <td style="text-align:left;"><b style="color:${active ? '#16a34a' : 'var(--text2)'};">${status || '—'}</b></td>
    <td class="num"><b>${Math.round(acNum(r.AMAZON_INVENTORY)).toLocaleString()}</b></td>
    <td class="num"><b>${Math.round(acNum(r.MASTER_INVENTORY)).toLocaleString()}</b></td>
    <td class="num"><b style="color:#ef4444;">+${Math.round(acNum(r.DIFF)).toLocaleString()}</b></td>
    <td style="text-align:left;">${whs || acDash}</td>
    <td style="text-align:left;color:var(--text2);">${r.MASTER_FLAG || acDash}</td>
    <td style="text-align:left;">${forced
      ? '<span class="ac-cause-badge" style="background:rgba(100,116,139,.15);color:var(--text2);">FORCED_ZERO</span>'
      : '<span style="color:var(--text3);">normal</span>'}</td>
    <td style="text-align:left;">${missed
      ? '<span class="ac-cause-badge" style="background:rgba(245,158,11,.15);color:#f59e0b;">YES</span>'
      : '<span style="color:var(--text3);">no</span>'}</td>
  </tr>`;
}

function acRenderInvPage() {
  const headEl = document.getElementById('actionHead');
  const hdrEl  = document.getElementById('actionHeader');
  if (!headEl || !hdrEl) return;

  const rows = S.invRecon || [];
  const first = rows[0] || {};
  const snapDate = String(first.RUN_DATE || '').slice(0, 10);
  const genAt    = String(first.GENERATED_AT || '').slice(0, 16).replace('T', ' ');
  const meta = rows.length
    ? `Amazon listing snapshot ${snapDate || '—'}${genAt ? ` · generated ${genAt} UTC` : ''}`
    : 'No reconciliation data yet — the daily job runs ~10:30 UTC';

  const dlIcon = '<svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>';
  const ctrl = 'padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:var(--bg);color:var(--text);';
  const sortOpts = [['diff', 'Biggest diff'], ['sku', 'SKU A–Z'], ['master', 'Supplier qty']]
    .map(([v, l]) => `<option value="${v}"${(S.acInvSort || 'diff') === v ? ' selected' : ''}>${l}</option>`).join('');

  hdrEl.innerHTML = `
    <div class="card" style="padding:14px 20px;">
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:22px;">📋</span>
          <div>
            <div style="font-size:18px;font-weight:800;color:var(--text);">Amazon 0 · Supplier &gt; 0</div>
            <div style="font-size:12px;color:var(--text3);">Inventory Check · ${meta} · <b id="acInvResultCount" style="color:#ef4444;"></b></div>
          </div>
        </div>
        <div style="flex:1;"></div>
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="position:relative;display:flex;align-items:center;">
            <input id="acInvSearch" value="${String(S.acInvSearch || '').replace(/"/g, '&quot;')}" oninput="acInvSearchChanged()" placeholder="Search SKU…" style="${ctrl}width:150px;padding-right:22px;"/>
            <button id="acInvSearchClear" onclick="acInvClearSearch()" title="Clear" style="position:absolute;right:4px;border:none;background:none;color:var(--text3);cursor:pointer;font-size:13px;display:${S.acInvSearch ? '' : 'none'};">✕</button>
          </div>
          <select id="acInvSort" onchange="acInvSortChanged()" style="${ctrl}">${sortOpts}</select>
        </div>
        <div class="dl-wrap" style="flex-direction:row;gap:8px;padding:6px 8px;">
          <button class="dl-btn" onclick="acInvDownload()" title="Download the full reconciliation list">${dlIcon} CSV</button>
        </div>
      </div>
    </div>`;

  headEl.innerHTML = acInvHead();
  acInvRenderBody();
}

function acInvRenderBody() {
  const bodyEl = document.getElementById('actionBody');
  if (!bodyEl) return;
  const full = S.invRecon || [];

  let list = full;
  const q = String(S.acInvSearch || '').trim().toLowerCase();
  if (q) list = list.filter(r => String(r.SKU || '').toLowerCase().includes(q));

  const cmp = {
    diff:   (a, b) => acNum(b.DIFF) - acNum(a.DIFF),
    sku:    (a, b) => String(a.SKU || '').localeCompare(String(b.SKU || '')),
    master: (a, b) => acNum(b.MASTER_INVENTORY) - acNum(a.MASTER_INVENTORY),
  }[S.acInvSort || 'diff'];
  list = [...list].sort(cmp);

  const cnt = document.getElementById('acInvResultCount');
  if (cnt) cnt.textContent = `${list.length}${q ? ` / ${full.length}` : ''} SKUs`;

  if (!list.length) {
    const msg = q ? `No SKUs matching "${S.acInvSearch}"` : 'No mismatches — Amazon and supplier inventory agree 🎉';
    bodyEl.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text3);">${msg}</td></tr>`;
    return;
  }
  bodyEl.innerHTML = list.map(acInvTr).join('');
}

window.acInvSearchChanged = function () {
  S.acInvSearch = (document.getElementById('acInvSearch') || {}).value || '';
  const b = document.getElementById('acInvSearchClear'); if (b) b.style.display = S.acInvSearch ? '' : 'none';
  acInvRenderBody();
};
window.acInvClearSearch = function () {
  S.acInvSearch = '';
  const i = document.getElementById('acInvSearch'); if (i) i.value = '';
  const b = document.getElementById('acInvSearchClear'); if (b) b.style.display = 'none';
  acInvRenderBody();
};
window.acInvSortChanged = function () {
  S.acInvSort = (document.getElementById('acInvSort') || {}).value || 'diff';
  acInvRenderBody();
};

// Download the full list (ignores search).
function acInvDownload() {
  const rows = (S.invRecon || []).map(r => {
    const o = {};
    AC_INV_COLS.forEach(c => { o[c] = c === 'RUN_DATE' ? String(r[c] || '').slice(0, 10) : (r[c] ?? ''); });
    return o;
  });
  if (!rows.length) { alert('No reconciliation rows to download.'); return; }
  const stamp = typeof todayStamp === 'function' ? todayStamp() : '';
  downloadCSV(rows, `inventory_reconciliation_${stamp}.csv`, AC_INV_COLS);
}
window.acInvDownload = acInvDownload;
