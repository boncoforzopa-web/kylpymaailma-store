// Store state in Upstash Redis: stock, orders, customers, messages, newsletter, settings, visits.
// Base product data comes from data/products.json; everything that changes at runtime lives here.
'use strict';
const crypto = require('crypto');
const D = require('./data');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const enabled = () => !!(URL_ && TOKEN);
const SECRET = process.env.CART_SECRET || 'tw-dev-secret';

async function redis(cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
async function pipeline(cmds) {
  if (!cmds.length) return [];
  const r = await fetch(`${URL_}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  const j = await r.json();
  return j.map((x) => x.result);
}
const day = (d = new Date()) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' }); // YYYY-MM-DD

// ---------------- stock & price overlays
let cache = { at: 0 };
async function load(force = false) {
  if (!enabled()) return;
  if (!force && Date.now() - cache.at < 30000) return;
  try {
    const [sold, prices] = await pipeline([['HGETALL', 'tw:sold'], ['HGETALL', 'tw:price']]);
    const overlay = {};
    for (let i = 0; i < (sold || []).length; i += 2) { const v = D.BY_VARIANT[Number(sold[i])]; if (v) overlay[sold[i]] = v.__qty - (Number(sold[i + 1]) || 0); }
    D.setStockOverlay(overlay);
    const po = {};
    for (let i = 0; i < (prices || []).length; i += 2) po[prices[i]] = Number(prices[i + 1]);
    D.setPriceOverlay(po);
    cache = { at: Date.now() };
  } catch (e) { console.error('stock load failed', e.message); }
}
const AUTO_RESTOCK = parseInt(process.env.AUTO_RESTOCK_QTY || '0', 10); // >0: when a variant hits 0 after a sale, reset it to this and alert Telegram. Off by default so sold-out sizes stay sold out.
async function recordSale(lines) {
  if (!enabled()) return;
  lines = (lines || []).filter((l) => /^\d+$/.test(String(l.id))); // free gifts etc. have no stock
  if (!lines.length) return;
  const after = await pipeline(lines.map((l) => ['HINCRBY', 'tw:sold', String(l.id), String(l.quantity)]));
  const restocked = [];
  const cmds = [];
  lines.forEach((l, i) => {
    const v = D.BY_VARIANT[Number(l.id)]; if (!v || l.quantity <= 0) return;
    const left = v.__qty - (Number(after[i]) || 0);
    if (left <= 0 && AUTO_RESTOCK > 0) { cmds.push(['HSET', 'tw:sold', String(l.id), String(v.__qty - AUTO_RESTOCK)]); restocked.push({ id: l.id, title: l.title || (v.product && v.product.title) || v.title || String(l.id), was: left }); }
  });
  if (cmds.length) await pipeline(cmds);
  await load(true);
  if (restocked.length) {
    logActivity('restock', `Auto-restock: ${restocked.map((r) => r.title).join(', ')} → ${AUTO_RESTOCK}`, {}).catch(() => {});
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    require('./telegram').notify(`🔄 <b>Auto-Restock erfolgreich</b>\n${restocked.map((r) => `• ${esc(r.title)} war ausverkauft → Bestand jetzt <b>${AUTO_RESTOCK}</b>`).join('\n')}`).catch(() => {});
  }
}
// absolute stock for a variant (admin): sold = base − wanted
async function setStock(variantId, qty) {
  const v = D.BY_VARIANT[Number(variantId)];
  if (!v || !enabled()) return false;
  await redis(['HSET', 'tw:sold', String(variantId), String(v.__qty - Math.max(0, Math.round(qty)))]);
  await load(true);
  return true;
}
async function setPrice(variantId, cents) {
  if (!enabled()) return false;
  if (cents === null) await redis(['HDEL', 'tw:price', String(variantId)]);
  else await redis(['HSET', 'tw:price', String(variantId), String(Math.round(cents))]);
  await load(true);
  return true;
}

// ---------------- orders
async function nextOrderNumber() {
  if (!enabled()) return null;
  const n = await redis(['INCR', 'tw:ordernum']);
  if (n < 1100) { await redis(['SET', 'tw:ordernum', '1100']); return '#1100'; }
  return `#${n}`;
}
async function claimOrder(id) {
  if (!enabled()) return true;
  return !!(await redis(['SET', `tw:claim:${id}`, '1', 'NX', 'EX', String(60 * 60 * 24 * 30)]));
}
async function saveOrder(order, { list = true } = {}) {
  if (!enabled()) return;
  const listed = await redis(['SISMEMBER', 'tw:orders:set', order.id]);
  const cmds = [['SET', `tw:order:${order.id}`, JSON.stringify(order)]];
  if (list && order.status !== 'pending' && !listed) {
    cmds.push(['LPUSH', 'tw:orders', order.id], ['SADD', 'tw:orders:set', order.id]);
    if (order.email) cmds.push(['SADD', `tw:cust:${order.email.toLowerCase()}:orders`, order.id], ['SADD', 'tw:customers', order.email.toLowerCase()]);
    if (order.number) cmds.push(['HSET', 'tw:ordernums', order.number.replace('#', ''), order.id]);
  }
  await pipeline(cmds);
}
async function getOrder(id) { if (!enabled() || !id) return null; const s = await redis(['GET', `tw:order:${id}`]); return s ? JSON.parse(s) : null; }
async function getOrderByNumber(num) { if (!enabled()) return null; const id = await redis(['HGET', 'tw:ordernums', String(num).replace('#', '')]); return id ? getOrder(id) : null; }
async function listOrders(limit = 200) {
  if (!enabled()) return [];
  const ids = (await redis(['LRANGE', 'tw:orders', '0', String(limit - 1)])) || [];
  if (!ids.length) return [];
  const vals = await redis(['MGET', ...ids.map((i) => `tw:order:${i}`)]);
  return vals.filter(Boolean).map((s) => JSON.parse(s));
}
async function addEvent(orderId, type, text) {
  if (!enabled()) return;
  await redis(['LPUSH', `tw:events:${orderId}`, JSON.stringify({ type, text, at: new Date().toISOString() })]);
}
async function listEvents(orderId) { if (!enabled()) return []; return ((await redis(['LRANGE', `tw:events:${orderId}`, '0', '99'])) || []).map((s) => JSON.parse(s)); }

// ---------------- customers
async function listCustomers() {
  if (!enabled()) return [];
  const emails = (await redis(['SMEMBERS', 'tw:customers'])) || [];
  if (!emails.length) return [];
  const orderIds = await pipeline(emails.map((e) => ['SMEMBERS', `tw:cust:${e}:orders`]));
  const all = [...new Set(orderIds.flat())];
  const vals = all.length ? await redis(['MGET', ...all.map((i) => `tw:order:${i}`)]) : [];
  const byId = Object.fromEntries(all.map((id, i) => [id, vals[i] ? JSON.parse(vals[i]) : null]));
  return emails.map((e, i) => {
    const os = (orderIds[i] || []).map((id) => byId[id]).filter(Boolean).sort((a, b) => b.created.localeCompare(a.created));
    const paid = os.filter((o) => o.status !== 'refunded' && o.status !== 'cancelled');
    return { email: e, name: os[0] && os[0].name, orders: os.length, revenue: paid.reduce((a, o) => a + o.total, 0), last: os[0] && os[0].created, first: os[os.length - 1] && os[os.length - 1].created, city: os[0] && os[0].address && os[0].address.city, list: os };
  }).sort((a, b) => (b.last || '').localeCompare(a.last || ''));
}

// ---------------- messages / newsletter / back-in-stock / abandoned carts
async function saveMessage(kind, data) { if (!enabled()) return; await redis(['LPUSH', `tw:${kind}`, JSON.stringify({ ...data, at: new Date().toISOString() })]); }
async function listMessages(kind, limit = 200) { if (!enabled()) return []; return ((await redis(['LRANGE', `tw:${kind}`, '0', String(limit - 1)])) || []).map((s) => JSON.parse(s)); }
async function subscribe(email) { if (enabled()) await redis(['HSET', 'tw:subscribers', email.toLowerCase(), new Date().toISOString()]); }
async function unsubscribe(email) { if (enabled()) await redis(['HDEL', 'tw:subscribers', email.toLowerCase()]); }
async function listSubscribers() { if (!enabled()) return []; const a = (await redis(['HGETALL', 'tw:subscribers'])) || []; const out = []; for (let i = 0; i < a.length; i += 2) out.push({ email: a[i], at: a[i + 1] }); return out.sort((x, y) => y.at.localeCompare(x.at)); }
async function addBackInStock(variantId, email) { if (enabled()) await redis(['HSET', `tw:bis:${variantId}`, email.toLowerCase(), new Date().toISOString()]); }
async function takeBackInStock(variantId) { if (!enabled()) return []; const a = (await redis(['HGETALL', `tw:bis:${variantId}`])) || []; const emails = []; for (let i = 0; i < a.length; i += 2) emails.push(a[i]); if (emails.length) await redis(['DEL', `tw:bis:${variantId}`]); return emails; }
async function countBackInStock() { if (!enabled()) return {}; const keys = (await redis(['KEYS', 'tw:bis:*'])) || []; if (!keys.length) return {}; const lens = await pipeline(keys.map((k) => ['HLEN', k])); return Object.fromEntries(keys.map((k, i) => [k.replace('tw:bis:', ''), lens[i]])); }
async function saveCart(token, data) { if (enabled()) await redis(['SET', `tw:cart:${token}`, JSON.stringify({ ...data, at: data.at || new Date().toISOString() }), 'EX', String(60 * 60 * 24 * 14)]); }
async function getCart(token) { if (!enabled()) return null; const s = await redis(['GET', `tw:cart:${token}`]); return s ? JSON.parse(s) : null; }
async function listCarts() { if (!enabled()) return []; const keys = (await redis(['KEYS', 'tw:cart:*'])) || []; if (!keys.length) return []; const vals = await redis(['MGET', ...keys]); return vals.filter(Boolean).map((s) => JSON.parse(s)).sort((a, b) => b.at.localeCompare(a.at)); }
async function deleteCart(token) { if (enabled()) await redis(['DEL', `tw:cart:${token}`]); }

// ---------------- settings (admin-editable, override env)
// one HGETALL per 20 s per server instance instead of one HGET per call (saves most of the Redis command budget)
let setCache = { at: 0, v: null, p: null };
async function allSettings(force = false) {
  if (!enabled()) return {};
  if (!force && setCache.v && Date.now() - setCache.at < 20000) return { ...setCache.v };
  if (!force && setCache.p) return { ...(await setCache.p) };
  setCache.p = (async () => { const a = (await redis(['HGETALL', 'tw:settings'])) || []; const o = {}; for (let i = 0; i < a.length; i += 2) o[a[i]] = a[i + 1]; setCache = { at: Date.now(), v: o, p: null }; return o; })().catch((e) => { setCache.p = null; throw e; });
  return { ...(await setCache.p) };
}
async function getSetting(key, fallback = null) { if (!enabled()) return fallback; const o = await allSettings(); const v = o[key]; return v === null || v === undefined ? fallback : v; }
async function setSetting(key, value) {
  if (!enabled()) return;
  if (value === null || value === '') await redis(['HDEL', 'tw:settings', key]); else await redis(['HSET', 'tw:settings', key, String(value)]);
  if (setCache.v) { if (value === null || value === '') delete setCache.v[key]; else setCache.v[key] = String(value); }
}

// ---------------- visits (lightweight analytics)
const minuteKey = (d = new Date()) => new Date(d).toISOString().slice(0, 16); // UTC, YYYY-MM-DDTHH:MM
async function recordVisit({ path, country, city, ref, product, device }) {
  if (!enabled()) return;
  const d = day();
  const hr = String(Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Helsinki', hour: '2-digit', hour12: false })) % 24).padStart(2, '0');
  const cmds = [['HINCRBY', `tw:visits:${d}`, 'views', '1'], ['HINCRBY', `tw:visits:${d}`, `h:${hr}`, '1']];
  if (Math.random() < 0.05) cmds.push(['EXPIRE', `tw:visits:${d}`, String(60 * 60 * 24 * 100)]);
  if (country) cmds.push(['HINCRBY', `tw:visits:${d}`, `c:${country}`, '1']);
  if (city) cmds.push(['HINCRBY', `tw:visits:${d}`, `city:${city}`, '1']);
  if (ref) cmds.push(['HINCRBY', `tw:visits:${d}`, `ref:${ref}`, '1']);
  if (device) cmds.push(['HINCRBY', `tw:visits:${d}`, `dev:${device}`, '1']);
  if (product) cmds.push(['HINCRBY', 'tw:productviews', product, '1'], ['HINCRBY', `tw:visits:${d}`, `p:${product}`, '1']);
  // live view: per-minute buckets, kept for one hour
  const lk = `tw:live:${minuteKey()}`;
  cmds.push(['HINCRBY', lk, 'views', '1'], ['EXPIRE', lk, '3600']);
  // compact per-minute counter (one hash per UTC hour, kept 26 h) for the traffic chart's longer ranges
  const mk = minuteKey(); cmds.push(['HINCRBY', `tw:lm:${mk.slice(0, 13)}`, mk.slice(14, 16), '1'], ['EXPIRE', `tw:lm:${mk.slice(0, 13)}`, String(26 * 3600)]);
  if (path) cmds.push(['HINCRBY', lk, `u:${String(path).slice(0, 80)}`, '1']);
  await pipeline(cmds);
}
// page views per minute for the last N minutes (oldest first) from the compact hour hashes: [{ t: ms, v }]
async function minuteSeries(minutes = 60) {
  if (!enabled()) return [];
  const end = Math.floor(Date.now() / 60000) * 60000, start = end - (minutes - 1) * 60000;
  const hours = []; for (let t = Math.floor(start / 3600e3) * 3600e3; t <= end; t += 3600e3) hours.push(new Date(t).toISOString().slice(0, 13));
  const res = await pipeline(hours.map((h) => ['HGETALL', `tw:lm:${h}`]));
  const map = {}; hours.forEach((h, i) => { const a = res[i] || []; for (let j = 0; j < a.length; j += 2) map[`${h}:${a[j]}`] = Number(a[j + 1]); });
  const out = []; for (let t = start; t <= end; t += 60000) out.push({ t, v: map[new Date(t).toISOString().slice(0, 16)] || 0 });
  return out;
}
// last N minutes of live buckets (oldest first)
async function liveStats(minutes = 30) {
  if (!enabled()) return [];
  const keys = [];
  for (let i = minutes - 1; i >= 0; i--) keys.push(minuteKey(Date.now() - i * 60000));
  const res = await pipeline(keys.map((k) => ['HGETALL', `tw:live:${k}`]));
  return keys.map((k, i) => { const a = res[i] || []; const o = {}; for (let j = 0; j < a.length; j += 2) o[a[j]] = Number(a[j + 1]); return { minute: k, ...o }; });
}
// activity feed shown in the admin (orders, checkouts, messages, stock changes …)
async function logActivity(type, text, meta = {}) {
  if (!enabled()) return;
  try { await pipeline([['LPUSH', 'tw:activity', JSON.stringify({ type, text, at: new Date().toISOString(), ...meta })], ['LTRIM', 'tw:activity', '0', '399']]); } catch (e) { /* never break the request */ }
}
// ---------------- live visitor sessions (anonymous id from the browser's sessionStorage; no IP stored)
const SESS_TTL = String(60 * 60 * 3);
async function touchSession({ vid, path, country, city, region, lat, lon, ref, device, browser, os, heartbeat, first }) {
  if (!enabled() || !vid) return;
  const now = Date.now(); const k = `tw:sess:${vid}`; const cur = String(path || '/').slice(0, 160);
  if (heartbeat) { await pipeline([['HSET', k, 'last', String(now)], ['ZADD', 'tw:sess:active', String(now), vid]]); return; }
  const f = ['last', String(now), 'cur', cur];
  if (first) { f.push('first', String(now)); for (const [n, v] of [['country', country], ['city', city], ['region', region], ['lat', lat], ['lon', lon], ['ref', ref], ['device', device], ['browser', browser], ['os', os]]) if (v) f.push(n, String(v)); }
  const cmds = [['HSET', k, ...f], ['HINCRBY', k, 'views', '1'], ['EXPIRE', k, SESS_TTL], ['ZADD', 'tw:sess:active', String(now), vid], ['LPUSH', `${k}:p`, JSON.stringify({ at: now, path: cur })], ['EXPIRE', `${k}:p`, SESS_TTL]];
  if (Math.random() < 0.2) cmds.push(['LTRIM', `${k}:p`, '0', '79']);
  if (Math.random() < 0.05) cmds.push(['ZREMRANGEBYSCORE', 'tw:sess:active', '-inf', String(now - 3 * 3600e3)]);
  await pipeline(cmds);
}
async function identifySession(vid, fields) {
  if (!enabled() || !vid) return;
  const cmds = Object.entries(fields).filter(([, v]) => v).map(([f, v]) => ['HSET', `tw:sess:${vid}`, f, String(v).slice(0, 200)]);
  if (cmds.length) await pipeline([...cmds, ['EXPIRE', `tw:sess:${vid}`, SESS_TTL]]);
}
async function listSessions(minutes = 30, trail = 20) {
  if (!enabled()) return [];
  const ids = (await redis(['ZRANGEBYSCORE', 'tw:sess:active', String(Date.now() - minutes * 60000), '+inf'])) || [];
  if (!ids.length) return [];
  const res = await pipeline(ids.flatMap((id) => [['HGETALL', `tw:sess:${id}`], ['LRANGE', `tw:sess:${id}:p`, '0', String(trail - 1)]]));
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const a = res[i * 2] || []; if (!a.length) continue; const o = { id: ids[i] };
    for (let j = 0; j < a.length; j += 2) o[a[j]] = a[j + 1];
    o.last = Number(o.last); o.first = Number(o.first || o.last); o.views = Number(o.views || 0); o.lat = o.lat ? Number(o.lat) : null; o.lon = o.lon ? Number(o.lon) : null;
    o.trail = (res[i * 2 + 1] || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
    out.push(o);
  }
  return out.sort((a, b) => b.last - a.last);
}
// visitor time-outs set from the admin live view (tw:block:<vid>, expires on its own)
async function setTimeoutFor(vid, minutes, reason = '') {
  if (!enabled() || !vid) return null;
  const m = Math.max(1, Math.min(1440, Math.round(Number(minutes) || 5)));
  const until = Date.now() + m * 60000;
  await pipeline([['SET', `tw:block:${vid}`, JSON.stringify({ until, minutes: m, reason: String(reason || '').slice(0, 140), at: Date.now() })], ['EXPIRE', `tw:block:${vid}`, String(m * 60)], ['HSET', `tw:sess:${vid}`, 'blockedUntil', String(until)], ['ZADD', 'tw:blocks', String(until), vid]]);
  blockCache = { at: 0, ids: null };
  return { until, minutes: m };
}
async function clearTimeoutFor(vid) { if (!enabled() || !vid) return; await pipeline([['DEL', `tw:block:${vid}`], ['HDEL', `tw:sess:${vid}`, 'blockedUntil'], ['ZREM', 'tw:blocks', vid]]); blockCache = { at: 0, ids: null }; }
let blockCache = { at: 0, ids: null };
async function blockedIds() {
  if (blockCache.ids && Date.now() - blockCache.at < 20000) return blockCache.ids;
  const ids = (await redis(['ZRANGEBYSCORE', 'tw:blocks', String(Date.now()), '+inf'])) || [];
  blockCache = { at: Date.now(), ids: new Set(ids) };
  return blockCache.ids;
}
async function getTimeoutFor(vid) {
  if (!enabled() || !vid) return null;
  if (!(await blockedIds()).has(vid)) return null;
  const raw = await redis(['GET', `tw:block:${vid}`]); if (!raw) return null;
  try { const b = JSON.parse(raw); return b.until > Date.now() ? b : null; } catch (e) { return null; }
}
async function getSession(vid) { const l = await listSessions(60 * 3, 80); return l.find((s) => s.id === vid) || null; }
async function listActivity(limit = 50) { if (!enabled()) return []; return ((await redis(['LRANGE', 'tw:activity', '0', String(limit - 1)])) || []).map((s) => JSON.parse(s)); }
async function visitStats(days = 30) {
  if (!enabled()) return [];
  const list = [];
  for (let i = days - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); list.push(day(d)); }
  const res = await pipeline(list.map((d) => ['HGETALL', `tw:visits:${d}`]));
  return list.map((d, i) => { const a = res[i] || []; const o = {}; for (let k = 0; k < a.length; k += 2) o[a[k]] = Number(a[k + 1]); return { day: d, ...o }; });
}
async function productViews() { if (!enabled()) return {}; const a = (await redis(['HGETALL', 'tw:productviews'])) || []; const o = {}; for (let i = 0; i < a.length; i += 2) o[a[i]] = Number(a[i + 1]); return o; }

// signed links (newsletter confirm / unsubscribe / order status)
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url').slice(0, 22);
const verify = (s, t) => { try { return crypto.timingSafeEqual(Buffer.from(sign(s)), Buffer.from(String(t || ''))); } catch (e) { return false; } };

// Database usage for the admin (Upstash Redis): number of keys + memory used.
async function dbUsage() {
  if (!enabled()) return null;
  try {
    const [keys, info] = await pipeline([['DBSIZE'], ['INFO']]);
    const g = (k) => { const m = new RegExp(`^${k}:(.*)$`, 'm').exec(String(info || '')); return m ? m[1].trim() : ''; };
    const host = (() => { try { return new URL(URL_).hostname.split('.')[0]; } catch (e) { return ''; } })();
    return { keys: Number(keys) || 0, mem: Number(g('used_memory')) || 0, memHuman: g('used_memory_human'), maxMem: Number(g('maxmemory')) || 0, host };
  } catch (e) { return { error: e.message }; }
}

module.exports = { dbUsage, minuteSeries,
  enabled, redis, pipeline, load, recordSale, setStock, setPrice,
  nextOrderNumber, claimOrder, saveOrder, getOrder, getOrderByNumber, listOrders, addEvent, listEvents, listCustomers,
  saveMessage, listMessages, subscribe, unsubscribe, listSubscribers, addBackInStock, takeBackInStock, countBackInStock, saveCart, getCart, listCarts, deleteCart,
  getSetting, setSetting, allSettings, recordVisit, visitStats, productViews, liveStats, logActivity, listActivity, touchSession, identifySession, listSessions, getSession, setTimeoutFor, clearTimeoutFor, getTimeoutFor, sign, verify, day,
};
