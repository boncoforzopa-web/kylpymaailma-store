// Checkout on our own page: Stripe PaymentIntent + Payment Element. Flow:
//   GET  /checkout              -> branded page (theme layout/checkout.liquid + sections/tw-checkout.liquid)
//   POST /api/checkout/intent   -> validates cart + customer, creates PaymentIntent, stores pending order
//   GET  /checkout/danke        -> thank-you page; fulfils the order if paid (idempotent)
//   POST /api/stripe-webhook    -> payment_intent.succeeded / payment_failed / charge.refunded
'use strict';
const crypto = require('crypto');
const D = require('./data');
const C = require('./cart');
const stock = require('./stock');
const { send, esc, OWNER, legalAttachment } = require('./mail');
const T = require('./emails');
const E = require('./engine');
const G = require('./gift');
const B = require('./brand');

// Stripe keys: set in /admin/settings (stored in Redis) – falls back to Vercel env vars. No redeploy needed.
let stripe = null, stripeKey = '';
const KEYS = { sk: process.env.STRIPE_SECRET_KEY || '', pk: process.env.STRIPE_PUBLISHABLE_KEY || '', at: 0 };
async function refreshKeys(force = false) {
  if (!force && Date.now() - KEYS.at < 30000) return KEYS;
  KEYS.at = Date.now();
  try {
    // any number of key sets in the admin (setting `stripe_slots`, JSON); `stripe_active` = id of the one switched on, else Vercel env keys
    const [active, raw] = await Promise.all([stock.getSetting('stripe_active'), stock.getSetting('stripe_slots')]);
    let slots = []; try { slots = JSON.parse(raw || '[]'); } catch (e) { slots = []; }
    const slot = slots.find((x) => x.id === active && x.sk && x.pk) || null;
    KEYS.slot = slot ? slot.id : 'env'; KEYS.slotName = slot ? slot.name : '';
    KEYS.sk = ((slot && slot.sk) || process.env.STRIPE_SECRET_KEY || '').trim();
    KEYS.pk = ((slot && slot.pk) || process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
  } catch (e) { /* keep previous */ }
  return KEYS;
}
function getStripe() {
  if (!KEYS.sk) return null;
  if (!stripe || stripeKey !== KEYS.sk) { stripe = require('stripe')(KEYS.sk, { apiVersion: '2024-06-20' }); stripeKey = KEYS.sk; pmCache = { at: 0, types: ['card'] }; }
  return stripe;
}
const isTestMode = () => KEYS.sk.startsWith('sk_test');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Payment methods we offer: card (incl. Apple Pay / Google Pay) always; Klarna and PayPal once activated in Stripe.
let pmCache = { at: 0, types: ['card'] };
async function paymentMethodTypes() {
  const s = getStripe();
  if (!s) return ['card'];
  if (Date.now() - pmCache.at < 10 * 60 * 1000) return pmCache.types;
  try {
    const acct = await s.accounts.retrieve();
    const cap = acct.capabilities || {};
    const types = ['card'];
    if (cap.klarna_payments === 'active') types.push('klarna');
    if (cap.paypal_payments === 'active') types.push('paypal');
    if (cap.mobilepay_payments === 'active') types.push('mobilepay');
    pmCache = { at: Date.now(), types };
  } catch (e) { console.error('[pm-types]', e.message); }
  return pmCache.types;
}
const PM_LABEL = { card: 'Korttimaksu', klarna: 'Klarna', paypal: 'PayPal', mobilepay: 'MobilePay', sepa_debit: 'SEPA-suoraveloitus', giropay: 'Giropay', eps: 'EPS', bancontact: 'Bancontact', ideal: 'iDEAL', link: 'Link', amazon_pay: 'Amazon Pay', revolut_pay: 'Revolut Pay' };
const BRAND = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express' };
function paymentLabel(pm) {
  if (!pm || typeof pm === 'string') return 'Maksettu';
  if (pm.type === 'card' && pm.card) {
    const wallet = pm.card.wallet && pm.card.wallet.type;
    const w = wallet === 'apple_pay' ? 'Apple Pay · ' : wallet === 'google_pay' ? 'Google Pay · ' : '';
    return `${w}${BRAND[pm.card.brand] || 'Kortti'} •••• ${pm.card.last4}`;
  }
  return PM_LABEL[pm.type] || pm.type;
}
const releaseOf = (p) => (p && p.__r.release_date ? p.__r.release_date.split('-').reverse().join('.') : '');
const money = (c) => `${(c / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
function addBiz(from, n) { const d = new Date(from); let k = 0; while (k < n) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) k++; } return d; }
const shortDate = (d) => d.toLocaleDateString(B.locale, { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: B.tz });
const deliveryWindow = (from, a, b) => `${shortDate(addBiz(from, a))} – ${shortDate(addBiz(from, b))}`;

function cartLines(lc) {
  return G.withGift(paidLines(lc), lc.total_price);
}
function paidLines(lc) {
  return lc.items.map((it) => {
    const p = it.product; const img = p.featured_image;
    return {
      id: it.variant_id, quantity: it.quantity, title: it.title, price: it.final_price, handle: p.handle,
      image: img && img.__img && img.__img.base ? `/images/${img.__img.base}-${img.__img.widths.find((w) => w >= 160) || img.__img.widths[0]}.webp` : null,
      preorder: p.tags.includes('Pre-order'), release: releaseOf(p), diffTax: /differenzbesteuert/i.test(p.title + p.tags.join()),
    };
  });
}
function stockProblem(lc) {
  for (const it of lc.items) {
    const v = it.variant;
    const cap = !v.inventory_management || v.inventory_policy === 'continue' ? Infinity : v.inventory_quantity;
    if (!v.available || it.quantity > cap) return `Tuotetta ”${it.title}” ei ole enää saatavilla haluamaasi määrää${cap > 0 && cap !== Infinity ? ` (jäljellä ${cap} kpl)` : ''}. Päivitä ostoskorisi.`;
  }
  return null;
}

// ---------------- GET /checkout
async function page(req, res, url, cart, setCookie, renderPage) {
  const lc = C.liquidCart(cart);
  if (!lc.items.length) { res.statusCode = 302; res.setHeader('Location', '/cart'); return res.end(); }
  const problem = stockProblem(lc);
  if (problem) { res.statusCode = 303; res.setHeader('Set-Cookie', C.cookieFor(cart)); res.setHeader('Location', `/cart?stock=${encodeURIComponent(problem)}`); return res.end(); }
  const lines = cartLines(lc);
  const taxable = lc.items.filter((it) => !/differenzbesteuert/i.test(it.product.title + it.product.tags.join())).reduce((a, it) => a + it.final_line_price, 0);
  const checkout = {
    publishable_key: KEYS.pk || '',
    payment_method_types: (await paymentMethodTypes()).join(','),
    return_url: `${url.origin}${B.paths.thanks}`,
    delivery_window: deliveryWindow(new Date(), B.deliveryDays[0], B.deliveryDays[1]),
    vat: Math.round(taxable - taxable / (1 + B.vatRate)),
    vat_label: B.vatLabel,
    has_diff_tax: lines.some((l) => l.diffTax),
  };
  return renderPage(req, res, url, cart, { pageType: 'checkout', template: 'checkout', layout: 'checkout', extra: { checkout, page_title: 'Kassa' } });
}

const MIN_ORDER = parseInt(process.env.MIN_ORDER_CENTS || '0', 10); // minimum order value in cents

// ---------------- POST /api/checkout/intent
async function intent(req, res, url, cart, body) {
  const json = (status, obj) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };
  const s = getStripe();
  if (!s) return json(503, { error: 'Verkkomaksu ei ole juuri nyt käytettävissä. Yritä hetken kuluttua uudelleen.' });
  const t = (k, n) => String((body || {})[k] || '').trim().slice(0, n);
  const c = { email: t('email', 200).toLowerCase(), firstName: t('firstName', 60), lastName: t('lastName', 60), street: t('street', 160), street2: t('street2', 120), postalCode: t('postalCode', 5), city: t('city', 80), phone: t('phone', 40), newsletter: body && (body.newsletter === true || body.newsletter === '1') };
  const vid = /^[a-z0-9]{8,24}$/i.test(t('vid', 24)) ? t('vid', 24) : '';
  if (!EMAIL_RE.test(c.email) || !c.firstName || !c.lastName || c.street.length < 3 || !/^\d{5}$/.test(c.postalCode) || c.city.length < 2) return json(400, { error: 'Tarkista sähköpostiosoite ja toimitusosoite.' });
  await stock.load(true);
  const lc = C.liquidCart(cart);
  if (!lc.items.length) return json(409, { error: 'Ostoskorisi on tyhjä.' });
  if (lc.total_price < MIN_ORDER) return json(409, { error: `Pienin tilaus on ${(MIN_ORDER / 100).toFixed(0)} €. Lisää ostoskoriin vielä jotakin.` });
  const problem = stockProblem(lc);
  if (problem) return json(409, { error: problem });
  const lines = cartLines(lc);
  const name = `${c.firstName} ${c.lastName}`;
  const address = { line1: c.street, line2: c.street2 || undefined, postal_code: c.postalCode, city: c.city, country: B.country };
  const cartMeta = lines.map((l) => `${l.id}:${l.quantity}`).join(',');
  const idem = crypto.createHash('sha256').update(`${cart.token}|${lc.total_price}|${cartMeta}|${c.email}|${c.street}|${c.postalCode}`).digest('hex').slice(0, 40);
  let pi;
  try {
    pi = await s.paymentIntents.create({
      amount: lc.total_price, currency: 'eur',
      payment_method_types: await paymentMethodTypes(),
      description: `${B.name} tilaus – ${lines.map((l) => `${l.quantity}× ${l.title}`).join(', ').slice(0, 800)}`,
      statement_descriptor_suffix: B.statementSuffix,
      shipping: { name, phone: c.phone || undefined, address },
      metadata: { source: B.domain, cart: cartMeta, email: c.email, name, phone: c.phone, line1: c.street, line2: c.street2, postal_code: c.postalCode, city: c.city, newsletter: c.newsletter ? '1' : '0', cart_token: cart.token, vid },
    }, { idempotencyKey: idem });
  } catch (e) {
    console.error('[intent]', e.message);
    return json(502, { error: 'Maksua ei voitu aloittaa. Yritä uudelleen.' });
  }
  // pending order (becomes a real order when Stripe confirms the payment)
  await stock.saveOrder({
    id: pi.id, number: null, status: 'pending', created: new Date().toISOString(), email: c.email, name, phone: c.phone, shipName: name,
    address: { line1: c.street, line2: c.street2, postal_code: c.postalCode, city: c.city, country: B.country }, subtotal: lc.total_price, discount: 0, total: lc.total_price,
    paymentLabel: '', newsletter: !!c.newsletter, lines,
  }, { list: false }).catch((e) => console.error('[order-pending]', e.message));
  if (vid) stock.identifySession(vid, { email: c.email, name, checkout: lc.total_price, checkoutAt: Date.now() }).catch(() => {});
  stock.logActivity('checkout', `Checkout started · ${lines.reduce((a, l) => a + l.quantity, 0)} item(s) · €${(lc.total_price / 100).toFixed(2)}`, { who: c.email, city: c.city, amount: lc.total_price }).catch(() => {});
  return json(200, { clientSecret: pi.client_secret, id: pi.id });
}

// ---------------- POST /api/cart-reminder (checkout page reports e-mail + cart once the address is typed)
async function cartReminder(req, res, url, cart, body) {
  res.setHeader('Cache-Control', 'no-store');
  const email = String((body || {}).email || '').trim().toLowerCase();
  const lc = C.liquidCart(cart);
  if (!EMAIL_RE.test(email) || !lc.items.length) { res.statusCode = 204; return res.end(); }
  const existing = await stock.getCart(cart.token);
  await stock.saveCart(cart.token, { token: cart.token, email, name: String((body || {}).name || '').slice(0, 120), at: existing ? existing.at : undefined, total: lc.total_price, lines: cartLines(lc), reminded: existing ? existing.reminded : null, unsub: stock.sign(`unsub:${email}`) });
  const vid = String((body || {}).vid || ''); if (/^[a-z0-9]{8,24}$/i.test(vid)) stock.identifySession(vid, { email, name: String((body || {}).name || '').slice(0, 120), cart: lc.total_price }).catch(() => {});
  res.statusCode = 204; res.end();
}

// ---------------- fulfilment (idempotent): called from thank-you page and webhook
async function fulfil(piId, origin) {
  const s = getStripe();
  const pi = await s.paymentIntents.retrieve(piId, { expand: ['payment_method', 'latest_charge'] });
  if (pi.status !== 'succeeded') return { pi, order: null };
  const existing = await stock.getOrder(pi.id);
  if (existing && existing.status !== 'pending') return { pi, order: existing };
  if (!(await stock.claimOrder(pi.id))) return { pi, order: existing };
  const m = pi.metadata || {};
  const lines = existing && existing.lines && existing.lines.length ? existing.lines : String(m.cart || '').split(',').filter(Boolean).map((p) => { const [id, q] = p.split(':'); if (id === G.ID) return G.line(); const v = D.BY_VARIANT[Number(id)]; const pr = v && v.product; const img = pr && pr.featured_image; return { id: Number(id), quantity: Number(q), title: pr ? pr.title : id, price: v ? v.price : 0, handle: pr ? pr.handle : '', image: img && img.__img && img.__img.base ? `/images/${img.__img.base}-${img.__img.widths[0]}.webp` : null, preorder: !!(pr && pr.tags.includes('Pre-order')), release: releaseOf(pr) }; });
  const ship = pi.shipping || {};
  const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const order = {
    ...(existing || {}),
    id: pi.id, number: (existing && existing.number) || (await stock.nextOrderNumber()) || `#${pi.id.slice(-6).toUpperCase()}`,
    status: 'paid', created: new Date(pi.created * 1000).toISOString(), paidAt: new Date().toISOString(),
    email: (existing && existing.email) || m.email || (charge && charge.billing_details && charge.billing_details.email) || '',
    name: ship.name || m.name || (existing && existing.name) || '', phone: (ship.phone || m.phone || ''), shipName: ship.name || m.name || '',
    address: ship.address || (existing && existing.address) || { line1: m.line1, line2: m.line2, postal_code: m.postal_code, city: m.city, country: B.country },
    subtotal: pi.amount, discount: 0, total: pi.amount_received || pi.amount,
    paymentLabel: paymentLabel(pi.payment_method), receiptUrl: charge ? charge.receipt_url : null, chargeId: charge ? charge.id : null,
    newsletter: existing ? !!existing.newsletter : m.newsletter === '1', lines, tracking: null, carrier: null, shippedAt: null,
  };
  await stock.saveOrder(order);
  await stock.recordSale(lines.map((l) => ({ id: l.id, quantity: l.quantity })));
  await stock.addEvent(order.id, 'paid', `Paid (${order.paymentLabel}) · ${money(order.total)}`);
  if (m.vid) stock.identifySession(m.vid, { order: order.number, orderId: order.id, email: order.email, name: order.name }).catch(() => {});
  stock.logActivity('order', `New order ${order.number} · €${(order.total / 100).toFixed(2)} · ${order.paymentLabel}`, { href: `/admin/orders/${encodeURIComponent(order.id)}`, who: order.name || order.email, amount: order.total }).catch(() => {});
  if (m.cart_token) stock.deleteCart(m.cart_token).catch(() => {});
  const site = origin || process.env.SITE_URL || B.site;
  require('./telegram').newOrder(order, `${site}/admin/orders/${encodeURIComponent(order.id)}`).catch(() => {});
  if (order.email) {
    const mail = T.orderConfirmation(order, site);
    const ok = await send({ to: order.email, subject: mail.subject, html: mail.html, attachments: legalAttachment(), tags: [{ name: 'type', value: 'order_confirmation' }] });
    await stock.addEvent(order.id, 'mail', ok ? `Order confirmation sent to ${order.email}` : `Order confirmation could NOT be sent (check RESEND_API_KEY)`);
  }
  const o = T.ownerNewOrder(order, site, `${site}/admin/orders/${encodeURIComponent(order.id)}`);
  await send({ to: OWNER, replyTo: order.email, subject: o.subject, html: o.html });
  if (order.newsletter && order.email) {
    const forms = require('./forms');
    forms.sendNewsletterConfirm(order.email, site).catch(() => {});
  }
  return { pi, order };
}

// ---------------- GET /checkout/danke
async function thanks(req, res, url, cart, setCookie, renderPage) {
  const s = getStripe();
  const id = url.searchParams.get('payment_intent');
  const cs = url.searchParams.get('payment_intent_client_secret');
  if (!s || !id) { res.statusCode = 302; res.setHeader('Location', '/'); return res.end(); }
  let result;
  try {
    const pi = await s.paymentIntents.retrieve(id, { expand: ['payment_method', 'latest_charge'] });
    if (cs && pi.client_secret !== cs) throw new Error('secret mismatch');
    result = pi.status === 'succeeded' ? await fulfil(id, url.origin) : { pi, order: await stock.getOrder(id) };
  } catch (e) {
    console.error('[thanks]', e.message);
    res.statusCode = 302; res.setHeader('Location', '/cart'); return res.end();
  }
  const { pi } = result;
  const pending = pi.status === 'processing' || pi.status === 'requires_action' || pi.status === 'requires_capture';
  if (!pending && pi.status !== 'succeeded') { res.statusCode = 302; res.setHeader('Location', '/checkout?error=payment'); return res.end(); }
  const o = result.order || { id: pi.id, number: '', email: (pi.metadata && pi.metadata.email) || '', name: pi.metadata && pi.metadata.name, shipName: pi.shipping && pi.shipping.name, address: (pi.shipping && pi.shipping.address) || {}, total: pi.amount, paymentLabel: paymentLabel(pi.payment_method), created: new Date(pi.created * 1000).toISOString(), lines: [] };
  cart.lines = [];
  const items = o.lines.filter((l) => !G.isGift(l)).map((l) => ({ item_id: `shopify_ZZ_${(D.BY_VARIANT[l.id] || { product: { id: '' } }).product.id}_${l.id}`, item_name: l.title, price: l.price / 100, quantity: l.quantity }));
  // a stored pre-order line stops being one once the product's release date has passed
  const lines = o.lines.map((l) => { const pr = l.handle ? D.productByHandle(l.handle) : null; const pre = !!l.preorder && !(pr && pr.released); return { ...l, preorder: pre, release: pre ? l.release : '', line_total: l.price * l.quantity }; });
  const order = {
    ...o, first_name: String(o.name || '').split(' ')[0], ship_name: o.shipName || o.name, payment_label: o.paymentLabel, receipt_url: o.receiptUrl,
    has_pre: lines.some((l) => l.preorder), all_pre: lines.length > 0 && lines.every((l) => l.preorder), delivery_window: deliveryWindow(o.created, B.deliveryDays[0], B.deliveryDays[1]),
    lines,
  };
  // Purchase conversion labels for every Google Ads account that should count the sale
  // (GOOGLE_ADS_PURCHASE_LABEL, comma-separated, e.g. AW-123/abc). Empty = no conversion tracking.
  const convList = (process.env.GOOGLE_ADS_PURCHASE_LABEL || '').split(',').map((x) => x.trim()).filter(Boolean);
  const tagIds = (process.env.GOOGLE_TAG_IDS || '').split(',').map((x) => x.trim()).filter((x) => /^MC-/.test(x));
  const newCustomer = !(await stock.listOrders().catch(() => [])).some((x) => x.id !== pi.id && x.email && o.email && x.email.toLowerCase() === o.email.toLowerCase() && x.status !== 'cancelled');
  const tracking = pi.status === 'succeeded' && (convList.length || tagIds.length) ? `<script>(function(){var k='tw-purchase-${esc(pi.id)}';try{if(localStorage.getItem(k))return;localStorage.setItem(k,'1');}catch(e){}function go(){if(typeof gtag!=='function')return setTimeout(go,300);gtag('event','purchase',{send_to:${JSON.stringify([...convList, ...tagIds])},transaction_id:${JSON.stringify(pi.id)},value:${pi.amount / 100},currency:'EUR',new_customer:${newCustomer},items:${JSON.stringify(items)}});${convList.map((c) => `gtag('event','conversion',{send_to:'${c}',value:${pi.amount / 100},currency:'EUR',transaction_id:${JSON.stringify(pi.id)},new_customer:${newCustomer}});`).join('')}}go();})();</script>` : '';
  res.setHeader('Set-Cookie', C.cookieFor(cart));
  return renderPage(req, res, url, cart, { pageType: 'checkout', template: 'checkout-danke', layout: 'checkout', forms: {}, extra: { order, pending, page_title: pending ? 'Maksua käsitellään' : `Kiitos tilauksestasi ${order.number}`, content_for_header_extra: tracking } });
}

// ---------------- POST /api/stripe-webhook
async function webhook(req, res) {
  const s = getStripe();
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let event;
  const secret = process.env.STRIPE_WEBHOOK_SECRET || (await stock.getSetting('stripe_webhook_secret'));
  try { event = s.webhooks.constructEvent(Buffer.concat(chunks), req.headers['stripe-signature'], secret); }
  catch (e) { res.statusCode = 400; return res.end(`Webhook error: ${e.message}`); }
  await stock.setSetting('stripe_webhook_last', new Date().toISOString()).catch(() => {});
  const obj = event.data.object;
  try {
    if (event.type === 'payment_intent.succeeded') await fulfil(obj.id);
    if (event.type === 'payment_intent.payment_failed') {
      const email = (obj.metadata && obj.metadata.email) || '';
      const reason = obj.last_payment_error && obj.last_payment_error.message;
      await send({ to: OWNER, subject: `Maksu epäonnistui${email ? ` – ${email}` : ''}`, html: `<p>Stripe ilmoitti epäonnistuneesta maksusta ${esc(obj.id)} (${money(obj.amount)})${reason ? `: ${esc(reason)}` : ''}. Älä lähetä tuotteita.</p>` });
      await stock.addEvent(obj.id, 'payment_failed', reason || 'Zahlung fehlgeschlagen');
    }
    if (event.type === 'charge.refunded') {
      const piId = typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent && obj.payment_intent.id;
      const o = piId ? await stock.getOrder(piId) : null;
      if (o) {
        // only records what happened in Stripe – nothing is refunded or restocked automatically
        o.refundedCents = obj.amount_refunded; o.refundedAt = new Date().toISOString();
        if (obj.refunded) o.status = 'refunded';
        await stock.saveOrder(o);
        await stock.addEvent(o.id, 'refund', `Stripe meldet Erstattung von ${money(obj.amount_refunded)}${obj.refunded ? ' (vollständig)' : ' (teilweise)'}`);
      }
    }
  } catch (e) { console.error('[webhook]', event.type, e.message); }
  res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end('{"received":true}');
}

// No webhook needed: pull succeeded payments of the last days from Stripe and fulfil any that are not recorded yet (idempotent).
async function syncFromStripe(origin) {
  const s = getStripe();
  if (!s || !stock.enabled()) return 0;
  const since = Math.floor(Date.now() / 1000) - 14 * 86400;
  let n = 0;
  for await (const pi of s.paymentIntents.list({ limit: 100, created: { gte: since } })) {
    if (pi.status !== 'succeeded' || !(pi.metadata && pi.metadata.cart)) continue;
    const o = await stock.getOrder(pi.id);
    if (o && o.status !== 'pending') continue;
    try { const r = await fulfil(pi.id, origin); if (r.order && r.order.status !== 'pending') n++; } catch (e) { console.error('sync fulfil failed', pi.id, e.message); }
  }
  await stock.setSetting('stripe_sync_last', new Date().toISOString());
  return n;
}

module.exports = { refreshKeys, KEYS, isTestMode, syncFromStripe, page, intent, thanks, webhook, fulfil, getStripe, cartReminder, paymentLabel, paymentMethodTypes, deliveryWindow, money };
