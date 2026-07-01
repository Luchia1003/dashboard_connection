const https = require('https');
const crypto = require('crypto');
const snowflake = require('snowflake-sdk');
const requireAuth = require('../lib/auth');

const API_BASE = 'api.informedrepricer.com';
const US_MARKETPLACE = '18508';
const LISTINGS_TABLE = 'SKU_PROFIT_PROJECT.DASHBOARD_DB.INFORMED_LISTINGS';
// Same suffix-strip the dashboard uses, applied in SQL to match a clean SKU
// against the raw Informed listing SKUs.
const CLEAN_SQL = `REGEXP_REPLACE(UPPER(TRIM(SKU)),'((-FORFBA-USEUPC|-FORFBA-USE-UPC|-FORFBA-AMAZON-BARCODE|-FORFBA--|-FORFBA-|-FORFBA|-AMZFBA))+$','')`;

// ── Snowflake: fetch a clean SKU's US variants + current (daily-refreshed) price.
// Source table is refreshed by the Informed Listings Sync GitHub Action.
function getPrivateKey() {
  const key = process.env.SNOWFLAKE_PRIVATE_KEY.replace(/\\n/g, '\n');
  return crypto.createPrivateKey({ key, format: 'pem' }).export({ type: 'pkcs8', format: 'pem' });
}
// Bulk mode (?bulk=1): one row per clean SKU with the lowest current US price —
// used by the Action Center to mark loss rows whose price was already raised.
// LIVE_MIN prefers live listings; ANY_MIN is the fallback when none are live.
function fetchBulkPrices() {
  return new Promise((resolve, reject) => {
    const conn = snowflake.createConnection({
      account: process.env.SNOWFLAKE_ACCOUNT, username: process.env.SNOWFLAKE_USERNAME,
      authenticator: 'SNOWFLAKE_JWT', privateKey: getPrivateKey(),
      database: process.env.SNOWFLAKE_DATABASE, schema: process.env.SNOWFLAKE_SCHEMA,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE, role: process.env.SNOWFLAKE_ROLE,
    });
    conn.connect(err => {
      if (err) return reject(err);
      conn.execute({
        sqlText: `SELECT ${CLEAN_SQL} AS K,
            MIN(CASE WHEN UPPER(STATUS) LIKE 'LIVE%' THEN TRY_TO_DOUBLE(CURRENT_PRICE) END) AS LIVE_MIN,
            MIN(TRY_TO_DOUBLE(CURRENT_PRICE)) AS ANY_MIN
          FROM ${LISTINGS_TABLE}
          WHERE MARKETPLACE_ID = '${US_MARKETPLACE}'
          GROUP BY 1`,
        complete: (e, stmt, rows) => {
          conn.destroy(() => {});
          if (e) return reject(e);
          const prices = {};
          (rows || []).forEach(r => {
            const p = r.LIVE_MIN != null ? r.LIVE_MIN : r.ANY_MIN;
            if (r.K && p != null) prices[r.K] = p;
          });
          resolve(prices);
        },
      });
    });
  });
}

function fetchVariants(cleanSku) {
  return new Promise((resolve, reject) => {
    const conn = snowflake.createConnection({
      account: process.env.SNOWFLAKE_ACCOUNT, username: process.env.SNOWFLAKE_USERNAME,
      authenticator: 'SNOWFLAKE_JWT', privateKey: getPrivateKey(),
      database: process.env.SNOWFLAKE_DATABASE, schema: process.env.SNOWFLAKE_SCHEMA,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE, role: process.env.SNOWFLAKE_ROLE,
    });
    const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
    conn.connect(err => {
      if (err) return reject(err);
      conn.execute({
        sqlText: `SELECT SKU,
            CASE WHEN UPPER(LISTING_TYPE) LIKE '%FBA%' THEN 'FBA' ELSE 'FBM' END AS T,
            STATUS AS ST, CURRENT_PRICE AS P, MIN_PRICE AS MN, MAX_PRICE AS MX
          FROM ${LISTINGS_TABLE}
          WHERE MARKETPLACE_ID = '${US_MARKETPLACE}' AND ${CLEAN_SQL} = ?
          ORDER BY (CASE WHEN UPPER(LISTING_TYPE) LIKE '%FBA%' THEN 1 ELSE 0 END), SKU`,
        binds: [String(cleanSku).toUpperCase().trim()],
        complete: (e, stmt, rows) => {
          conn.destroy(() => {});
          if (e) return reject(e);
          resolve((rows || []).map(r => ({ s: r.SKU, t: r.T, st: r.ST || '', p: num(r.P), mn: num(r.MN), mx: num(r.MX) })));
        },
      });
    });
  });
}

// ── Informed API helpers ──────────────────────────────────────────────────────
function apiRequest({ method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: API_BASE, path, method, headers: { 'x-api-key': process.env.INFORMED_API_KEY, accept: 'application/json', ...headers } },
      res => { const c = []; res.on('data', d => c.push(d));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') })); }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const asJson = s => { try { return JSON.parse(s); } catch { return null; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findFeedId(o) {
  if (!o || typeof o !== 'object') return null;
  for (const [k, v] of Object.entries(o))
    if (/feed.*submission.*id/i.test(k) && (typeof v === 'string' || typeof v === 'number')) return String(v);
  for (const v of Object.values(o)) if (v && typeof v === 'object') { const id = findFeedId(v); if (id) return id; }
  return null;
}

// Build the Set_Manual_Prices feed CSV. price = null|0 REMOVES the manual price
// (Informed ignores a blank cell — only a literal 0 clears it).
function buildCsv(items) {
  const esc = v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const lines = ['SKU,MARKETPLACE_ID,MANUAL_PRICE'];
  for (const it of items)
    lines.push([esc(it.sku), esc(it.marketplaceId || US_MARKETPLACE), esc(it.price == null ? 0 : it.price)].join(','));
  return lines.join('\n') + '\n';
}

async function submitFeed(csv) {
  const r = await apiRequest({ method: 'POST', path: '/v1/feed', headers: { 'Content-Type': 'text/csv' }, body: csv });
  if (r.status >= 300) throw new Error(`submit HTTP ${r.status}: ${r.body.slice(0, 300)}`);
  const id = findFeedId(asJson(r.body));
  if (!id) throw new Error(`no FeedSubmissionID in response: ${r.body.slice(0, 300)}`);
  return id;
}

async function pollFeed(id, { tries = 10, gap = 1500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = await apiRequest({ method: 'GET', path: `/v1/feed/submissions/${encodeURIComponent(id)}` });
    const j = asJson(r.body);
    const rec = Array.isArray(j) ? j[0] : j;
    if (rec && (rec.ProcessedPercent === 100 || /complete/i.test(rec.Status || ''))) return rec;
    await sleep(gap);
  }
  return null;
}

// ── Shopify Admin API (GraphQL) ───────────────────────────────────────────────
// Shopify SKU = one variant (no FBA/FBM, no marketplace split). Private-app
// Basic auth. Price updates are instant (no async feed).
function shopifyGql(query, variables) {
  return new Promise((resolve, reject) => {
    const auth = 'Basic ' + Buffer.from(`${process.env.SHOP_API_KEY}:${process.env.SHOP_API_PASSWORD}`).toString('base64');
    const ver = process.env.SHOP_API_VERSION || '2024-10';
    const data = JSON.stringify({ query, variables });
    const r = https.request({ host: process.env.SHOP_DOMAIN, path: `/admin/api/${ver}/graphql.json`, method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json', accept: 'application/json' } },
      x => { const c = []; x.on('data', d => c.push(d)); x.on('end', () => { try { resolve(JSON.parse(Buffer.concat(c).toString('utf8') || '{}')); } catch (e) { reject(e); } }); });
    r.on('error', reject); r.write(data); r.end();
  });
}
async function shopifyVariant(sku) {
  const j = await shopifyGql(`query($q:String!){ productVariants(first:1, query:$q){ edges{ node{ id price sku product{ id title } } } } }`, { q: `sku:${sku}` });
  return j.data?.productVariants?.edges?.[0]?.node || null;
}
async function shopifySetPrice(sku, price) {
  const v = await shopifyVariant(sku);
  if (!v) return { ok: false, error: `no Shopify variant for ${sku}` };
  const j = await shopifyGql(
    `mutation($productId:ID!,$variants:[ProductVariantsBulkInput!]!){ productVariantsBulkUpdate(productId:$productId,variants:$variants){ productVariants{ id price } userErrors{ field message } } }`,
    { productId: v.product.id, variants: [{ id: v.id, price: String(price) }] });
  const errs = j.data?.productVariantsBulkUpdate?.userErrors || [];
  if (errs.length || j.errors) return { ok: false, error: (errs.map(e => e.message).join('; ') || JSON.stringify(j.errors)) };
  return { ok: true, price: j.data.productVariantsBulkUpdate.productVariants?.[0]?.price };
}

// ── handler ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = requireAuth(req, res);
  if (!user) return;

  // GET ?sku=&platform= → the SKU's variants with current price, for the dropdown.
  // amazon → US Informed variants (daily INFORMED_LISTINGS table). shopify → the
  // single Shopify variant (live).
  if (req.method === 'GET') {
    const platform = String((req.query && req.query.platform) || 'amazon').toLowerCase();
    if (req.query && req.query.bulk) {
      try { return res.status(200).json({ prices: await fetchBulkPrices() }); }
      catch (err) { console.error('[set-price GET bulk]', err); return res.status(502).json({ error: err.message }); }
    }
    const sku = String((req.query && req.query.sku) || '').trim();
    if (!sku) return res.status(400).json({ error: 'sku query param required' });
    try {
      if (platform === 'shopify') {
        const v = await shopifyVariant(sku);
        const variants = v ? [{ s: v.sku, t: 'Shopify', st: '', p: parseFloat(v.price), mn: null, mx: null }] : [];
        return res.status(200).json({ sku, platform, variants });
      }
      return res.status(200).json({ sku, variants: await fetchVariants(sku.toUpperCase()) });
    } catch (err) { console.error('[set-price GET]', err); return res.status(502).json({ error: err.message }); }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Accept { items:[{sku,marketplaceId?,price}] } or a single { sku, price, marketplaceId? }.
  let body = req.body;
  if (typeof body === 'string') body = asJson(body);
  if (!body) { try { body = asJson(await new Promise((rs, rj) => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => rs(Buffer.concat(c).toString('utf8'))); req.on('error', rj); })); } catch { body = null; } }

  const items = Array.isArray(body?.items) ? body.items
    : (body?.sku ? [{ sku: body.sku, marketplaceId: body.marketplaceId, price: body.price }] : null);
  if (!items || !items.length) return res.status(400).json({ error: 'Provide { sku, price } or { items: [...] }' });
  for (const it of items) {
    if (!it.sku) return res.status(400).json({ error: 'each item needs a sku' });
    if (it.price !== null && !(Number(it.price) > 0)) return res.status(400).json({ error: `invalid price for ${it.sku}` });
  }

  const platform = String(body.platform || 'amazon').toLowerCase();
  try {
    // Shopify: update each variant directly (no expansion, no feed — instant).
    if (platform === 'shopify') {
      const results = [];
      for (const it of items) results.push(await shopifySetPrice(it.sku, it.price));
      const ok = results.filter(r => r.ok).length;
      return res.status(200).json({
        platform: 'shopify', successCount: ok, errorCount: results.length - ok,
        errors: results.filter(r => !r.ok).map(r => r.error),
        submitted: items.map((i, idx) => ({ sku: i.sku, price: i.price, ok: results[idx].ok })),
      });
    }

    // Amazon (Informed feed). Expand each clean base SKU to all its US variants
    // (FBM + FBA) unless { expand:false }. Variant SKUs come from Snowflake.
    if (!process.env.INFORMED_API_KEY) return res.status(500).json({ error: 'INFORMED_API_KEY not configured' });
    const expand = body.expand !== false;
    const targets = [];
    for (const it of items) {
      const variants = expand ? (await fetchVariants(it.sku)).map(v => v.s) : null;
      if (variants && variants.length) variants.forEach(v => targets.push({ sku: v, marketplaceId: it.marketplaceId, price: it.price }));
      else targets.push(it);
    }
    const feedId = await submitFeed(buildCsv(targets));
    const rec = await pollFeed(feedId);
    return res.status(200).json({
      feedSubmissionId: feedId,
      status: rec?.Status || 'Submitted',
      successCount: rec?.SuccessCount ?? null,
      errorCount: rec?.ErrorCount ?? null,
      submitted: targets.map(i => ({ sku: i.sku, marketplaceId: i.marketplaceId || US_MARKETPLACE, price: i.price })),
    });
  } catch (err) {
    console.error('[set-price]', err);
    return res.status(502).json({ error: err.message });
  }
};
