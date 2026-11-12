// Storefront extras that Shopify could not do: visit beacon, back-in-stock alerts, order status page, cart restore, cron.
'use strict';
const D = require('./data');
const C = require('./cart');
const stock = require('./stock');
const B = require('./brand');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const json = (res, status, obj) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };

// POST /api/visit  {path, product, ref}  – anonymous counters only (no cookie, no IP stored)
function deviceInfo(ua) {
  ua = String(ua || '');
  const device = /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return { device, browser, os };
}
async function visit(req, res, body) {
  try {
    const b = body || {};
    const path = String(b.path || '').slice(0, 200);
    const vid = /^[a-z0-9]{8,24}$/i.test(String(b.vid || '')) ? String(b.vid) : '';
    const geo = { country: String(req.headers['x-vercel-ip-country'] || '').slice(0, 2), city: decodeURIComponent(String(req.headers['x-vercel-ip-city'] || '')).slice(0, 40), region: decodeURIComponent(String(req.headers['x-vercel-ip-country-region'] || '')).slice(0, 40), lat: String(req.headers['x-vercel-ip-latitude'] || '').slice(0, 12), lon: String(req.headers['x-vercel-ip-longitude'] || '').slice(0, 12) };
    if (vid && path && !/^\/(admin|api)/.test(path)) {
      let sref = '';
      try { const r = String(b.ref || ''); if (r) { const h = new URL(r).hostname.replace(/^www\./, ''); sref = /google|bing|duckduckgo|ecosia/.test(h) ? 'Suche (organisch)' : /instagram|tiktok|facebook|youtube|reddit/.test(h) ? h.split('.')[0] : h; } } catch (e) { sref = ''; }
      const sq = String(b.q || ''); if (/gclid|gad_source|utm_source=google/.test(sq)) sref = 'Google Ads'; else if (/utm_source=([^&]+)/.test(sq)) sref = decodeURIComponent(/utm_source=([^&]+)/.exec(sq)[1]).slice(0, 30); if (!sref && !b.ref) sref = 'Direkt';
      stock.touchSession({ vid, path, ...geo, ref: sref, ...deviceInfo(req.headers['user-agent']), heartbeat: !!b.hb, first: !!b.first }).catch(() => {});
    }
    if (vid) { const bl = await stock.getTimeoutFor(vid).catch(() => null); if (bl) { res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); return res.end(JSON.stringify({ timeout: { until: bl.until, minutes: bl.minutes } })); } }
    if (b.hb || /^\/(admin|api|checkout|cart)/.test(path) || !path) { res.statusCode = 204; return res.end(); }
    let ref = '';
    try { const r = String(b.ref || ''); if (r) { const h = new URL(r).hostname.replace(/^www\./, ''); ref = /google|bing|duckduckgo|ecosia/.test(h) ? 'Suche (organisch)' : /instagram|tiktok|facebook|youtube|reddit/.test(h) ? h.split('.')[0] : h; } } catch (e) { ref = ''; }
    const q = String(b.q || '');
    if (/gclid|gad_source|utm_source=google/.test(q)) ref = 'Google Ads';
    else if (/utm_source=([^&]+)/.test(q)) ref = decodeURIComponent(/utm_source=([^&]+)/.exec(q)[1]).slice(0, 30);
    if (!ref && !b.ref) ref = 'Direkt';
    const product = String(b.product || '').slice(0, 120);
    await stock.recordVisit({ path, country: String(req.headers['x-vercel-ip-country'] || '').slice(0, 2), city: decodeURIComponent(String(req.headers['x-vercel-ip-city'] || '')).slice(0, 40), ref, product: D.productByHandle(product) ? product : '', device: ((ua) => (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua) ? 'tablet' : /Mobi|iPhone|Android/i.test(ua) ? 'mobile' : ua ? 'desktop' : ''))(String(req.headers['user-agent'] || '')) });
  } catch (e) { /* analytics must never break anything */ }
  res.statusCode = 204; res.end();
}

// POST /api/back-in-stock {variant_id, email}
async function backInStock(req, res, body) {
  const b = body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const v = D.BY_VARIANT[Number(b.variant_id)];
  if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'Anna toimiva sähköpostiosoite.' });
  if (!v) return json(res, 404, { error: 'Tuotetta ei löytynyt.' });
  if (!stock.enabled()) return json(res, 503, { error: 'Ilmoitusta ei voitu tallentaa juuri nyt. Yritä hetken kuluttua uudelleen.' });
  await stock.addBackInStock(v.id, email);
  stock.logActivity('waitlist', `Back-in-stock request · ${v.product ? v.product.title : v.id}`, { who: email, href: v.product ? `/admin/products/${v.product.handle}` : '/admin/products' }).catch(() => {});
  return json(res, 200, { ok: true, message: 'Ilmoitamme sinulle sähköpostilla, kun tuotetta on taas varastossa.' });
}

// GET/POST /bestellung  – order status for customers (order number + e-mail)
async function orderStatus(req, res, url, cart, body, renderPage) {
  const num = String((body && body.number) || url.searchParams.get('nr') || '').trim().replace(/^#/, '');
  const email = String((body && body.email) || url.searchParams.get('email') || '').trim().toLowerCase();
  let order = null, error = '';
  if (num || email) {
    const o = /^\d{3,}$/.test(num) ? await stock.getOrderByNumber(num) : null;
    if (o && o.email && o.email.toLowerCase() === email && o.status !== 'pending') {
      const CARR = { Posti: (t) => `https://www.posti.fi/seuranta#/lahetys/${encodeURIComponent(t)}`, Matkahuolto: (t) => `https://www.matkahuolto.fi/seuranta/tilanne/?package_code=${encodeURIComponent(t)}`, PostNord: (t) => `https://tracking.postnord.com/fi/?id=${encodeURIComponent(t)}`, DHL: (t) => `https://www.dhl.com/fi-fi/home/tracking.html?tracking-id=${encodeURIComponent(t)}`, DPD: (t) => `https://www.dpd.com/tracking?parcelNumber=${encodeURIComponent(t)}`, GLS: (t) => `https://gls-group.com/FI/fi/seuraa-lahetysta?match=${encodeURIComponent(t)}`, UPS: (t) => `https://www.ups.com/track?loc=fi_FI&tracknum=${encodeURIComponent(t)}` };
      const ev = (await stock.listEvents(o.id)).filter((e) => ['paid', 'shipped', 'refund', 'cancelled'].includes(e.type)).map((e) => ({ at: e.at, text: { paid: 'Maksu vastaanotettu – tilaus vahvistettu', shipped: `Paketti luovutettu kuljetettavaksi${o.carrier ? ` (${o.carrier})` : ''}`, refund: 'Hyvitys tehty', cancelled: 'Tilaus peruttu' }[e.type] }));
      order = { ...o, events: ev, tracking_url: o.tracking && CARR[o.carrier] ? CARR[o.carrier](o.tracking) : '', step: { paid: 2, shipped: 3, refunded: 0, cancelled: 0 }[o.status] || 1, lines: o.lines.map((l) => { const pr = l.handle ? D.productByHandle(l.handle) : null; const pre = !!l.preorder && !(pr && pr.released); return { ...l, preorder: pre, release: pre ? l.release : '', line_total: l.price * l.quantity }; }) };
    } else error = 'Tällä tilausnumerolla ja sähköpostiosoitteella ei löytynyt tilausta. Tarkista molemmat tiedot – tilausnumero on tilausvahvistuksessa (esim. #1104).';
  }
  return renderPage(req, res, url, cart, { pageType: 'page', template: 'order-status', forms: {}, extra: { order_status: { order, error, number: num, email }, page_title: order ? `Tilaus #${order.number}` : 'Tilauksen seuranta', page_description: `Tarkista ${B.name}-tilauksesi tila.` } });
}

// /checkout?cart=<token> (link from the reminder mail): restore the saved cart when the current one is empty
async function restoreCart(cart, token) {
  if (!token || cart.lines.length) return false;
  const saved = await stock.getCart(String(token).slice(0, 80));
  if (!saved || !saved.lines) return false;
  for (const l of saved.lines) { try { C.add(cart, l.id, l.quantity, {}); } catch (e) { /* sold out meanwhile */ } }
  return cart.lines.length > 0;
}

module.exports = { visit, backInStock, orderStatus, restoreCart };
