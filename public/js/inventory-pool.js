// ── Shared inventory read + platform aggregation (spec §1) ───────────────────
// Source: DASHBOARD_DB.SKU_INVENTORY_POOL (sku_key, pool 'FBA'|'HnP', available).
// Used by BOTH Product Detail (inventory column) and Action Center (SKU-level
// loss entries). One implementation, two callers.
//
// The HnP pool is shared by Amazon-FBM and Shopify (same physical stock), so any
// merged view (All, Amazon+Shopify) counts HnP exactly once. FBA is independent.

// Same single regex clean as SKU_SUMMARY_METRICS' SALES_SKU.
const INV_CLEAN_RE = /(-FORFBA-USEUPC|-FORFBA-AMAZON-BARCODE|-FORFBA--|-FORFBA-|-FORFBA|-AMZFBA)$/;

function cleanSkuKey(s) {
  return String(s == null ? '' : s).toUpperCase().trim().replace(INV_CLEAN_RE, '');
}
window.cleanSkuKey = cleanSkuKey;

// Snowflake returns SELECT * columns uppercased; tolerate either casing.
function pick(row, upper, lower) {
  return row[upper] != null ? row[upper] : row[lower];
}

// base_sku → { fba, hnp }. Cached on S._invIndex.
function buildInventoryIndex() {
  const idx = new Map();
  (S.inventoryPool || []).forEach(r => {
    const base = cleanSkuKey(pick(r, 'SKU_KEY', 'sku_key'));
    if (!base) return;
    const pool = String(pick(r, 'POOL', 'pool') || '').toUpperCase();
    const av   = Number(pick(r, 'AVAILABLE', 'available')) || 0;
    let g = idx.get(base);
    if (!g) { g = { fba: 0, hnp: 0 }; idx.set(base, g); }
    if (pool === 'FBA') g.fba += av;
    else if (pool === 'HNP') g.hnp += av;
  });
  S._invIndex = idx;
  return idx;
}
window.buildInventoryIndex = buildInventoryIndex;

// Inventory for a base SKU under a platform view.
//   amazon / all → fba + hnp (HnP counted once), with an FBA/HnP split
//   shopify      → hnp only
// Returns { found:false } when the SKU isn't in the pool at all.
function inventoryForView(baseSku, view) {
  const idx = S._invIndex || buildInventoryIndex();
  const g = idx.get(cleanSkuKey(baseSku));
  if (!g) return { found: false };
  const v = String(view || 'all').toLowerCase();
  if (v === 'shopify') {
    return { found: true, total: g.hnp, fba: 0, hnp: g.hnp, split: false };
  }
  return { found: true, total: g.fba + g.hnp, fba: g.fba, hnp: g.hnp, split: true };
}
window.inventoryForView = inventoryForView;

// ── Restock signal from INVENTORY_FORECAST (spec §3.2) ───────────────────────
// Aggregate restock_needed / est_restock_profit across ALL matching channel
// rows for a platform (never a single channel, never the 'total' aggregate row).

function forecastPlatform(channel) {
  const c = String(channel || '').toLowerCase().trim();
  if (c === 'amazon_fba' || c === 'amazon_nonfba') return 'amazon';
  if (c === 'shopify') return 'shopify';
  return null; // skip 'total' and anything else to avoid double counting
}

// `${platform}|${base}` → { units, profit }. Cached on S._restockIndex.
function buildRestockIndex() {
  const idx = new Map();
  (S.inventoryForecast || []).forEach(r => {
    const platform = forecastPlatform(r.CHANNEL);
    if (!platform) return;
    const base = cleanSkuKey(r.ORIGINAL_SKU);
    if (!base) return;
    const key = `${platform}|${base}`;
    let g = idx.get(key);
    if (!g) { g = { units: 0, profit: 0 }; idx.set(key, g); }
    g.units  += Number(r.RESTOCK_NEEDED)     || 0;
    g.profit += Number(r.EST_RESTOCK_PROFIT) || 0;
  });
  S._restockIndex = idx;
  return idx;
}
window.buildRestockIndex = buildRestockIndex;

// Returns { units, profit } only when the system still suggests restocking
// (units > 0); otherwise null. Platform must be Amazon or Shopify.
function lookupRestock(platform, baseSku) {
  const idx = S._restockIndex || buildRestockIndex();
  const p = String(platform || '').toLowerCase();
  const plat = p === 'amazon' ? 'amazon' : p === 'shopify' ? 'shopify' : null;
  if (!plat) return null;
  const g = idx.get(`${plat}|${cleanSkuKey(baseSku)}`);
  if (!g || !(g.units > 0)) return null;
  return g;
}
window.lookupRestock = lookupRestock;
