const https = require('https');
const requireAuth = require('../lib/auth');

const API_BASE = 'api.informedrepricer.com';
const US_MARKETPLACE = '18508';

// Snapshot: clean-base-SKU → [{ s:variantSku, t:'FBA'|'FBM', st:status,
// p:currentPrice, mn:min, mx:max }] for US (18508) listings. Powers both the
// dropdown (GET, show current price per variant) and POST expansion (reprice all).
let PRICES = {};
try { PRICES = require('./informed-prices.json'); } catch { /* optional snapshot */ }

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

// Deep-scan JSON for the feed submission id.
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
  const r = await apiRequest({ method: 'POST', path: '/v1/feed',
    headers: { 'Content-Type': 'text/csv' }, body: csv });
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
    if (rec && (rec.ProcessedPercent === 100 || /complete/i.test(rec.Status || '')))
      return rec;
    await sleep(gap);
  }
  return null;
}

// ── handler ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = requireAuth(req, res);
  if (!user) return;

  // GET ?sku=CLEAN_SKU → the SKU's US variants with current (snapshot) price,
  // for the reprice dropdown. No Informed call — reads the bundled snapshot.
  if (req.method === 'GET') {
    const sku = String((req.query && req.query.sku) || '').toUpperCase().trim();
    if (!sku) return res.status(400).json({ error: 'sku query param required' });
    return res.status(200).json({ sku, variants: PRICES[sku] || [] });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.INFORMED_API_KEY) return res.status(500).json({ error: 'INFORMED_API_KEY not configured' });

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

  // Expand each clean base SKU to all its US Informed variants (FBM + FBA).
  // Unless the caller opts out with { expand:false }.
  const expand = body.expand !== false;
  const targets = [];
  for (const it of items) {
    const variants = expand ? (PRICES[String(it.sku).toUpperCase().trim()] || []).map(v => v.s) : null;
    if (variants && variants.length) variants.forEach(v => targets.push({ sku: v, marketplaceId: it.marketplaceId, price: it.price }));
    else targets.push(it);
  }

  try {
    const csv = buildCsv(targets);
    const feedId = await submitFeed(csv);
    const rec = await pollFeed(feedId);
    return res.status(200).json({
      feedSubmissionId: feedId,
      status: rec?.Status || 'Submitted',
      successCount: rec?.SuccessCount ?? null,
      errorCount: rec?.ErrorCount ?? null,
      submitted: targets.map(i => ({ sku: i.sku, marketplaceId: i.marketplaceId || US_MARKETPLACE, price: i.price })),
    });
  } catch (err) {
    console.error('[informed-set-price]', err);
    return res.status(502).json({ error: err.message });
  }
};
