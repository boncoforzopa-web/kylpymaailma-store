// Maps every Shopify storefront URL to the same page on the new site.
'use strict';
const D = require('./data');
const E = require('./engine');
const C = require('./cart');
const checkout = require('./checkout');
const MIN_ORDER = parseInt(process.env.MIN_ORDER_CENTS || '0', 10);
const B = require('./brand');
const SF = require('./storefront');
const forms = require('./forms');
const stock = require('./stock');

const REDIRECTS = Object.fromEntries(D.read('redirects.json').map((r) => [r.source, r.destination]));

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}
const json = (res, status, obj, headers = {}) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
const redirect = (res, to, status = 302, headers = {}) => send(res, status, '', { Location: to, ...headers });

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return parseBody(Buffer.concat(chunks).toString('utf8'), req.headers['content-type']);
}
function parseBody(raw, type = '') {
  if (!raw) return {};
  if (type.includes('application/json')) { try { return JSON.parse(raw); } catch (e) { return {}; } }
  if (type.includes('multipart/form-data')) {
    const m = /boundary=(.+)$/.exec(type);
    const out = {};
    if (m) for (const part of raw.split(`--${m[1]}`)) {
      const n = /name="([^"]+)"\r?\n\r?\n([\s\S]*?)\r?\n?$/.exec(part);
      if (n) setField(out, n[1], n[2].replace(/\r?\n$/, ''));
    }
    return out;
  }
  const out = {};
  for (const [k, v] of new URLSearchParams(raw)) setField(out, k, v);
  return out;
}
// supports Shopify field names like properties[Name], updates[123], items[0][id]
function setField(obj, key, val) {
  const parts = key.replace(/\]/g, '').split('[');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (o[p] === undefined) o[p] = /^\d+$/.test(parts[i + 1]) || parts[i + 1] === '' ? [] : {};
    o = o[p];
  }
  const last = parts[parts.length - 1];
  if (last === '' && Array.isArray(o)) o.push(val); else o[last] = val;
}

const TOKENS = { '[[FIRMA]]': B.legalName || B.name, '[[ADRESSE]]': B.address.join(', '), '[[EMAIL]]': B.email, '[[RUECKSENDEADRESSE]]': B.address.join(', '), '[[SHOP]]': B.name, '[[DOMAIN]]': B.domain, '[[FRIST]]': '14 päivää' };
function stripHtml(s) { return String(s || '').replace(/<[^>]+>/g, '').replace(/\[\[[A-Z_]+\]\]/g, (t) => TOKENS[t] || '').replace(/\s+/g, ' ').trim(); }
// Shopify's page_description: stripped text, cut at 320 characters
function truncate(s) { return s.slice(0, 320); }

const PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=600';

async function page(req, res, url, cart, opts, status = 200) {
  const sectionId = url.searchParams.get('section_id');
  const html = await E.renderPage({ url: url.href, cart: C.liquidCart(cart), sectionId, ...opts });
  if (opts.layout) { res.setHeader('Cache-Control', 'private, no-store'); }
  if (html === null) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  // pages stay dynamic per visitor (cart count lives in the HTML) -> no shared cache when cart has items
  const cacheable = cart.lines.length === 0 && !opts.forms;
  send(res, status, html, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cacheable ? PAGE_CACHE : 'private, no-store', Vary: 'Cookie' });
}

function productJs(p) {
  const v0 = p.variants;
  return {
    id: p.id, title: p.title, handle: p.handle, description: p.description, published_at: p.published_at, created_at: p.created_at, vendor: p.vendor, type: p.type, tags: p.tags,
    price: p.price, price_min: p.price_min, price_max: p.price_max, available: p.available, price_varies: p.price_varies, compare_at_price: p.compare_at_price,
    compare_at_price_min: p.compare_at_price_min, compare_at_price_max: p.compare_at_price_max, compare_at_price_varies: false,
    variants: v0.map((v) => ({ id: v.id, title: v.title, option1: v.option1, option2: v.option2, option3: v.option3, sku: v.sku, requires_shipping: true, taxable: true, featured_image: null, available: v.available, barcode: v.barcode, name: p.has_only_default_variant ? p.title : `${p.title} - ${v.title}`, public_title: p.has_only_default_variant ? null : v.title, options: v.options, price: v.price, weight: 0, compare_at_price: v.compare_at_price, inventory_management: v.inventory_management, requires_selling_plan: false, selling_plan_allocations: [] })),
    images: p.images.map((i) => i.src), featured_image: p.featured_image ? p.featured_image.src : null,
    options: (p.__r.options || []).map((o, i) => ({ name: o.name, position: i + 1, values: o.values })),
    url: p.url, media: p.images.map((i) => ({ alt: i.alt, id: i.id, position: i.position, preview_image: { aspect_ratio: i.aspect_ratio, height: i.height, width: i.width, src: i.src }, aspect_ratio: i.aspect_ratio, height: i.height, media_type: 'image', src: i.src, width: i.width })),
    requires_selling_plan: false, selling_plan_groups: [],
  };
}

function timeoutPage(res, bl) {
  const mins = Math.max(1, Math.ceil((bl.until - Date.now()) / 60000));
  res.statusCode = 429; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Retry-After', String(mins * 60));
  res.end(`<!doctype html><html lang="fi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Pieni tauko – ${B.name}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#F5F6F3;color:#17211F}
.c{width:min(92vw,440px);padding:40px 32px;border-radius:10px;background:#fff;border:1px solid #DCE1DC;text-align:center}
.lg{font-family:Georgia,serif;font-size:26px;color:#1E3A34;margin-bottom:22px}
h1{font-size:24px;font-weight:600;margin:0 0 8px}p{margin:0;color:#55615E;line-height:1.55;font-size:15px}
.t{margin:22px auto 6px;font-size:40px;font-weight:700;font-variant-numeric:tabular-nums}.s{font-size:13px;color:#6C7774}
.bar{height:6px;border-radius:99px;background:#E9EEE8;margin:18px 0 22px;overflow:hidden}.bar i{display:block;height:100%;background:#1E3A34;border-radius:99px;transition:width 1s linear}
a.b{display:inline-block;margin-top:4px;padding:13px 22px;border-radius:6px;background:#1E3A34;color:#fff;text-decoration:none;font-weight:600;font-size:14px}a.b[aria-disabled=true]{opacity:.35;pointer-events:none}
.f{margin-top:18px;font-size:13px;color:#6C7774}.f a{color:#6C7774}</style></head><body><div class="c">
<div class="lg">${B.name}</div>
<h1>Pieni tauko</h1><p>Pääsysi kauppaan on hetkeksi keskeytetty. Ostoskorisi säilyy, ja voit jatkaa pian.</p>
<div class="t" id="t">--:--</div><div class="s">aikaa jäljellä</div>
<div class="bar"><i id="b" style="width:100%"></i></div>
<a class="b" id="go" href="/" aria-disabled="true">Jatka ostoksia</a>
<div class="f">Kysyttävää? <a href="mailto:${B.email}">${B.email}</a></div></div>
<script>var u=${bl.until},s=${bl.minutes * 60000};function f(){var r=Math.max(0,u-Date.now());var m=Math.floor(r/60000),x=Math.floor(r%60000/1000);document.getElementById('t').textContent=(m<10?'0':'')+m+':'+(x<10?'0':'')+x;document.getElementById('b').style.width=Math.max(0,Math.min(100,r/s*100))+'%';if(r<=0){document.getElementById('go').removeAttribute('aria-disabled');setTimeout(function(){location.reload()},800);return}setTimeout(f,1000)}f()</script></body></html>`);
}

// Telegram message once per successful deployment (first request that reaches the new build)
let deployAnnounced = false;
async function announceDeploy() {
  if (deployAnnounced || !stock.enabled()) return;
  deployAnnounced = true;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || '';
  if (!sha || process.env.VERCEL_ENV !== 'production') return;
  const fresh = await stock.redis(['SET', `tw:deploy:${sha}`, '1', 'NX', 'EX', String(7 * 86400)]);
  if (fresh !== 'OK') return;
  const K = checkout.KEYS; const msg = (process.env.VERCEL_GIT_COMMIT_MESSAGE || '').split('\n')[0].slice(0, 80);
  await checkout.refreshKeys(true);
  require('./telegram').notify(`✅ <b>${B.name}: Deployment erfolgreich</b> · ${sha.slice(0, 7)}${msg ? `\n${msg.replace(/[<>&]/g, '')}` : ''}\nStripe aktiv: <b>${K.slot === 'env' ? 'Vercel-Umgebungsschlüssel' : (K.slotName || K.slot).replace(/[<>&]/g, '')}</b>${K.pk ? `\nPK …${K.pk.slice(-6)} · SK …${K.sk.slice(-6)}` : ''}${K.sk && K.sk.startsWith('sk_test') ? ' ⚠️ Testmodus' : ''}`).catch(() => {});
  stock.logActivity('deploy', `Deployed ${sha.slice(0, 7)}${msg ? ` · ${msg}` : ''}`).catch(() => {});
}

async function handle(req, res) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = new URL(req.url, `${proto}://${host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.length > 1 && pathname.endsWith('/')) return redirect(res, pathname.slice(0, -1) + url.search, 301);
  const method = req.method;

  if (REDIRECTS[pathname]) return redirect(res, REDIRECTS[pathname], 301);
  // locale prefix /fi/... and /en/... -> same page
  const loc = /^\/(fi|en)(\/.*)?$/.exec(pathname);
  if (loc) return redirect(res, (loc[2] || '/') + url.search, 301);

  // visitor time-out set from the admin live view
  if (method === 'GET' && !/^\/(admin|api|cdn|assets|cart\.js|cart\.json|robots|sitemap|products\.json|collections\/[^/]+\/products\.json)/.test(pathname) && !/\.(js|css|png|jpg|jpeg|webp|svg|ico|woff2?|txt|xml|json)$/.test(pathname)) {
    const tv = (C.parseCookies(req.headers.cookie) || {}).tw_vid;
    if (tv && /^[a-z0-9]{8,24}$/i.test(tv)) { const bl = await stock.getTimeoutFor(tv).catch(() => null); if (bl) return timeoutPage(res, bl); }
  }
  await stock.load();
  await checkout.refreshKeys();
  announceDeploy().catch(() => {});
  const cart = C.load(req);
  const setCookie = (headers = {}) => ({ 'Set-Cookie': C.cookieFor(cart), ...headers });

  // ---------------- cart AJAX API
  if (pathname === '/cart.js' || pathname === '/cart.json') return json(res, 200, C.cartJson(C.liquidCart(cart)));
  if (/^\/cart\/(add|change|update|clear)(\.js|\.json)?$/.test(pathname)) {
    if (method === 'GET' && pathname === '/cart/add') {
      // /cart/add?id=123&quantity=1 links
      const r = C.add(cart, url.searchParams.get('id'), url.searchParams.get('quantity') || 1);
      return redirect(res, '/cart', 302, setCookie());
    }
    const action = /^\/cart\/(add|change|update|clear)/.exec(pathname)[1];
    const isJs = /\.(js|json)$/.test(pathname);
    const body = method === 'POST' ? await readBody(req) : Object.fromEntries(url.searchParams);
    let result = {};
    if (action === 'add') {
      const items = body.items ? body.items : [{ id: body.id, quantity: body.quantity, properties: body.properties }];
      const added = [];
      for (const it of items) {
        const r = C.add(cart, it.id, it.quantity, it.properties);
        if (r.error) { result.error = r.error; break; }
        added.push(r.line);
      }
      if (result.error && isJs) return json(res, result.error.status, result.error, setCookie());
      if (!isJs) {
        if (body.checkout !== undefined || body['checkout'] !== undefined) return redirect(res, '/checkout', 303, setCookie());
        return redirect(res, '/cart', 303, setCookie());
      }
      const lc = C.liquidCart(cart);
      const lines = added.map((l) => lc.items.find((i) => i.key === C.lineKey(l)) || lc.items.find((i) => String(i.id) === String(l.id))).filter(Boolean).map(C.itemJson);
      const out = body.items ? { items: lines } : { ...(lines[0] || {}) };
      out.sections = await renderSections(body.sections, url, cart);
      return json(res, 200, out, setCookie());
    }
    if (action === 'change') {
      const r = C.change(cart, { line: body.line, id: body.id, quantity: body.quantity });
      if (r.error && isJs) return json(res, r.error.status, r.error, setCookie());
    }
    if (action === 'update') {
      if (body.updates) C.update(cart, body.updates);
      if (body.note !== undefined) cart.note = String(body.note).slice(0, 1000);
      if (body.attributes) cart.attributes = body.attributes;
      if (!isJs && (body.checkout !== undefined)) return redirect(res, '/checkout', 303, setCookie());
    }
    if (action === 'clear') cart.lines = [];
    if (!isJs) return redirect(res, '/cart', 303, setCookie());
    const out = C.cartJson(C.liquidCart(cart));
    out.sections = await renderSections(body.sections, url, cart);
    return json(res, 200, out, setCookie());
  }
  if (pathname === '/cart' && method === 'POST') {
    const body = await readBody(req);
    if (body.updates) C.update(cart, body.updates);
    if (body.note !== undefined) cart.note = String(body.note).slice(0, 1000);
    if (body.checkout !== undefined) return redirect(res, '/checkout', 303, setCookie());
    return redirect(res, '/cart', 303, setCookie());
  }
  // /cart/123:1,456:2 permalinks
  // also accepts Merchant Center offer IDs (shopify_ZZ_<product>_<variant>:qty) used by Google's checkout links
  const perma = /^\/cart\/((?:shopify_ZZ_\d+_)?\d+:\d+(,(?:shopify_ZZ_\d+_)?\d+:\d+)*)$/.exec(decodeURIComponent(pathname));
  if (perma) {
    cart.lines = [];
    for (const p of perma[1].split(',')) { const [id, q] = p.split(':'); try { C.add(cart, id.replace(/^shopify_ZZ_\d+_/, ''), q); } catch (e) { /* sold out */ } }
    return redirect(res, '/checkout', 302, setCookie());
  }

  // ---------------- checkout (Stripe)
  if (pathname === '/checkout' || pathname === '/checkouts') {
    if (url.searchParams.get('cart') && (await SF.restoreCart(cart, url.searchParams.get('cart')))) return redirect(res, '/checkout', 303, setCookie());
    { const lc = C.liquidCart(cart); if (lc.items.length && lc.total_price < MIN_ORDER) return redirect(res, '/cart?min=1', 303, setCookie()); }
    return checkout.page(req, res, url, cart, setCookie, page);
  }
  if (pathname === '/api/visit' && method === 'POST') return SF.visit(req, res, await readBody(req));
  if (pathname === '/api/back-in-stock' && method === 'POST') return SF.backInStock(req, res, await readBody(req));
  if (pathname === B.paths.orderStatus || pathname === '/pages/tilauksen-seuranta') return SF.orderStatus(req, res, url, cart, method === 'POST' ? await readBody(req) : null, page);
  if (pathname === '/tg/webhook' && method === 'POST') return require('./tgpanel').webhook(req, res, url, await readBody(req));
  if (pathname === '/api/cron/stripe-health') { const ok = !process.env.CRON_SECRET || req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`; if (!ok) return json(res, 401, { ok: false }); const r = await require('./stripeslots').watchHealth().catch((e) => ({ error: e.message })); return json(res, 200, { ok: true, r }); }
  if (pathname === '/api/cron') { await require('./admin').cron(url.origin); return json(res, 200, { ok: true }); }
  if (pathname === '/api/checkout/intent' && method === 'POST') return checkout.intent(req, res, url, cart, await readBody(req));
  if (pathname === '/api/cart-reminder' && method === 'POST') { await checkout.cartReminder(req, res, url, cart, await readBody(req)); return require('./admin').cron(url.origin).catch(() => {}); }
  if (pathname === B.paths.thanks || pathname === '/checkout/success') return checkout.thanks(req, res, url, cart, setCookie, page);
  if (pathname === '/api/stripe-webhook') return checkout.webhook(req, res);

  // ---------------- forms (contact, newsletter, withdrawal)
  if (pathname === '/contact' && method === 'POST') return forms.handle(req, res, url, await readBody(req));
  if (pathname === '/newsletter/confirm') return forms.newsletterConfirm(req, res, url);
  if (pathname === '/newsletter/unsubscribe') return forms.newsletterUnsubscribe(req, res, url); // GET + POST (one-click)

  // ---------------- order admin
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return require('./admin').handle(req, res, url, readBody);

  // ---------------- predictive search
  if (pathname === '/search/suggest.json' || pathname === '/search/suggest') {
    const q = url.searchParams.get('q') || '';
    const limit = Math.min(10, Number(url.searchParams.get('resources[limit]')) || 6);
    let prods = D.searchProducts(q);
    prods = [...prods.filter((p) => p.available), ...prods.filter((p) => !p.available)].slice(0, limit);
    const cols = D.searchCollections(q).slice(0, limit);
    return json(res, 200, { resources: { results: {
      products: prods.map((p) => ({ id: p.id, title: p.title, handle: p.handle, url: `${p.url}?_pos=1&_sid=tw&_ss=r`, available: p.available, price: (p.price / 100).toFixed(2), price_min: (p.price / 100).toFixed(2), price_max: (p.price_max / 100).toFixed(2), vendor: p.vendor, type: p.type, tags: p.tags, image: p.featured_image ? p.featured_image.src : null, featured_image: p.featured_image ? { url: p.featured_image.src, alt: p.featured_image.alt, width: p.featured_image.width, height: p.featured_image.height, aspect_ratio: p.featured_image.aspect_ratio } : null })),
      collections: cols.map((c) => ({ id: c.id, title: c.title, handle: c.handle, url: c.url, body: c.description })),
    } } }, { 'Cache-Control': 'public, s-maxage=60' });
  }

  // ---------------- recommendations
  if (pathname === '/recommendations/products' || pathname === '/recommendations/products.json') {
    const pid = Number(url.searchParams.get('product_id'));
    const limit = Number(url.searchParams.get('limit')) || 4;
    const p = D.ACTIVE.find((x) => x.id === pid);
    const recs = p ? recommend(p, limit) : [];
    if (pathname.endsWith('.json')) return json(res, 200, { products: recs.map(productJs) });
    const sid = url.searchParams.get('section_id');
    const u = new URL(url.href);
    return page(req, res, u, cart, { pageType: 'product', template: 'product', extra: { product: p, recommendations: { performed: true, 'performed?': true, products: recs, products_count: recs.length, intent: 'related' } } });
  }

  // ---------------- sitemap / robots / feeds
  if (pathname === '/robots.txt') return send(res, 200, `User-agent: *\nDisallow: /cart\nDisallow: /checkout\nDisallow: /checkouts\nDisallow: /account\nDisallow: /admin\nDisallow: /newsletter/\nDisallow: /tilaus\nDisallow: /search\nDisallow: /recommendations/\nDisallow: /*?section_id=\nDisallow: /collections/*sort_by*\nAllow: /\n\nSitemap: ${url.origin}/sitemap.xml\n`, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, s-maxage=3600' });
  if (pathname === '/sitemap.xml') return send(res, 200, sitemap(url.origin), { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, s-maxage=3600' });
  if (pathname === '/feeds/google.txt') return send(res, 200, require('./feed').googleTsv(url.origin), { 'Content-Type': 'text/tab-separated-values; charset=utf-8', 'Cache-Control': 'public, s-maxage=900' });
  if (pathname === '/feeds/google.xml') return send(res, 200, require('./feed').google(url.origin), { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, s-maxage=900' });
  if (pathname === '/products.json') {
    const lim = Math.min(250, Number(url.searchParams.get('limit')) || 30); const pg = Number(url.searchParams.get('page')) || 1;
    return json(res, 200, { products: D.ACTIVE.slice((pg - 1) * lim, pg * lim).map(productJs) });
  }

  // ---------------- storefront pages
  const posted = url.searchParams.get('contact_posted') === 'true' || url.searchParams.get('customer_posted') === 'true';
  const postedForms = posted ? { contact: { success: true }, customer: { success: true } } : undefined;
  if (pathname === '/') return page(req, res, url, cart, { pageType: 'index', template: 'index', forms: postedForms, extra: { page_title: B.name, page_description: '' } });

  let m;
  if ((m = /^\/(?:collections\/[^/]+\/)?products\/([^/.]+)(\.js|\.json|\.oembed)?$/.exec(pathname))) {
    const p = D.productByHandle(m[1]);
    if (!p) return notFound(req, res, url, cart);
    if (m[2] === '.js') return json(res, 200, productJs(p), { 'Cache-Control': 'public, s-maxage=60' });
    if (m[2] === '.json') return json(res, 200, { product: productJs(p) });
    const vid = url.searchParams.get('variant');
    const prod = vid ? p.withVariant(vid) : p;
    return page(req, res, url, cart, { pageType: 'product', template: 'product', suffix: p.template_suffix, extra: {
      product: prod, page_title: p.seo_title || p.title.slice(0, 70), page_description: p.seo_description || truncate(stripHtml(p.description)), page_image: p.featured_image,
      canonical_url: `${url.origin}${p.url}`,
    } });
  }
  if (pathname === '/collections') return page(req, res, url, cart, { pageType: 'list-collections', template: 'list-collections', extra: { page_title: 'Kategoriat' } });
  if ((m = /^\/collections\/([^/.]+)(?:\/([^/]+))?(\.json|\/products\.json)?$/.exec(pathname))) {
    const base = D.COLLECTIONS_BY_HANDLE[m[1]];
    if (!base || (m[1] !== 'all' && base.all_products.length === 0)) return notFound(req, res, url, cart);
    if (pathname.endsWith('/products.json')) {
      const lim = Math.min(250, Number(url.searchParams.get('limit')) || 30); const pg = Number(url.searchParams.get('page')) || 1;
      return json(res, 200, { products: base.all_products.slice((pg - 1) * lim, pg * lim).map(productJs) });
    }
    const tags = (m[2] ? m[2].split('+').map((t) => decodeURIComponent(t)) : []).map((t) => base.all_tags.find((x) => D.handleize(x) === D.handleize(t)) || t);
    const col = base.view({ sort: url.searchParams.get('sort_by'), params: url.searchParams, path: pathname, tags });
    return page(req, res, url, cart, { pageType: 'collection', template: 'collection', suffix: base.template_suffix, extra: {
      collection: col, page_title: base.title, page_description: truncate(stripHtml(base.description)), current_tags: tags.length ? tags : null,
      canonical_url: `${url.origin}${pathname}${url.searchParams.get('page') ? `?page=${url.searchParams.get('page')}` : ''}`,
    } });
  }
  if ((m = /^\/pages\/([^/.]+)$/.exec(pathname))) {
    const pg = D.pageByHandle(m[1]);
    if (!pg) return notFound(req, res, url, cart);
    const f = postedForms || (url.searchParams.get('form_error') ? { contact: { errors: { form: 'Tarkista antamasi tiedot.' } } } : undefined);
    return page(req, res, url, cart, { pageType: 'page', template: 'page', suffix: pg.template_suffix, forms: f, extra: { page: pg, page_title: pg.title, page_description: truncate(stripHtml(pg.content)) } });
  }
  if ((m = /^\/policies\/([^/.]+)$/.exec(pathname))) {
    const to = { 'refund-policy': B.paths.withdrawal, 'privacy-policy': B.paths.privacy, 'terms-of-service': B.paths.terms, 'shipping-policy': B.paths.shipping, 'legal-notice': B.paths.imprint, 'contact-information': B.paths.contact }[m[1]];
    return to ? redirect(res, to, 301) : notFound(req, res, url, cart);
  }
  if (pathname === '/search') {
    const q = (url.searchParams.get('q') || '').trim();
    const results = q ? D.searchProducts(q) : [];
    return page(req, res, url, cart, { pageType: 'search', template: 'search', extra: { search: { terms: q, performed: !!q, results, results_count: results.length, types: ['product'], filters: [], sort_by: 'relevance', sort_options: [] }, page_title: q ? `Haku: ${results.length} tulosta haulle "${q}"` : 'Haku' } });
  }
  if (pathname === '/cart') return page(req, res, url, cart, { pageType: 'cart', template: 'cart', extra: { page_title: 'Ostoskori' } });
  if ((m = /^\/blogs\/([^/]+)(?:\/([^/]+))?$/.exec(pathname))) {
    return notFound(req, res, url, cart);
  }
  if (pathname.startsWith('/account') || pathname.startsWith('/customer_authentication')) {
    // no customer accounts on the new site: order info comes by e-mail
    const pg = { id: 0, handle: 'tili', title: 'Tilaukseni', content: `<p>Kaupassamme ei tarvita asiakastiliä. Saat tilausvahvistuksen ja kaikki tilauksesi päivitykset sähköpostiisi, ja tilauksen tilan voit tarkistaa sivulla <a href="${B.paths.orderStatus}">Tilauksen seuranta</a>. Jos sinulla on kysyttävää tilauksesta, kirjoita osoitteeseen <a href="mailto:${B.email}">${B.email}</a> tai käytä <a href="${B.paths.contact}">yhteydenottolomaketta</a>.</p>`, url: '/account', template_suffix: null };
    return page(req, res, url, cart, { pageType: 'page', template: 'page', extra: { page: pg, page_title: 'Tilaukseni' } });
  }

  return notFound(req, res, url, cart);
}

function notFound(req, res, url, cart) {
  return page(req, res, url, cart, { pageType: '404', template: '404', extra: { page_title: 'Sivua ei löytynyt' } }, 404);
}

async function renderSections(sections, url, cart) {
  if (!sections) return undefined;
  const list = Array.isArray(sections) ? sections : String(sections).split(',');
  const out = {};
  for (const id of list.map((s) => s.trim()).filter(Boolean)) {
    out[id] = await E.renderPage({ url: url.href, cart: C.liquidCart(cart), sectionId: id, pageType: 'index', template: 'index' });
  }
  return out;
}

function recommend(p, limit) {
  const cols = new Set(p.__r.collections || []);
  const scored = D.ACTIVE.filter((x) => x.id !== p.id && x.available).map((x) => {
    const shared = (x.__r.collections || []).filter((c) => cols.has(c) && !c.includes('intern')).length;
    const tagShare = x.tags.filter((t) => p.tags.includes(t)).length;
    return [shared * 3 + tagShare + (x.vendor === p.vendor ? 2 : 0), x];
  }).filter((s) => s[0] > 0).sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map((s) => s[1]);
}

function sitemap(origin) {
  const urls = [`${origin}/`, `${origin}/collections`];
  for (const c of D.collectionsGlobal()) urls.push(`${origin}${c.url}`);
  for (const p of D.ACTIVE) urls.push(`${origin}${p.url}`);
  for (const pg of Object.values(D.PAGES_BY_HANDLE)) if (pg.published && !['suosikit'].includes(pg.handle)) urls.push(`${origin}${pg.url}`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`;
}

module.exports = { handle, readBody, send, json, redirect, page };
