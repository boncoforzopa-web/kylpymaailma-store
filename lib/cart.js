// Cookie-based cart that mirrors Shopify's cart object + AJAX JSON format.
'use strict';
const crypto = require('crypto');
const D = require('./data');
const G = require('./gift');

const COOKIE = 'tw_cart';
const SECRET = require('./secret');

function sign(s) { return crypto.createHmac('sha256', SECRET).update(s).digest('base64url').slice(0, 16); }
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function load(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (!raw) return { lines: [], note: '', attributes: {}, token: crypto.randomBytes(12).toString('hex') };
  const [data, sig] = raw.split('.');
  if (!data || sig !== sign(data)) return { lines: [], note: '', attributes: {}, token: crypto.randomBytes(12).toString('hex') };
  try {
    const c = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    c.lines = (c.lines || []).filter((l) => D.variantById(l.id));
    return c;
  } catch (e) { return { lines: [], note: '', attributes: {}, token: crypto.randomBytes(12).toString('hex') }; }
}
function cookieFor(cart) {
  const data = Buffer.from(JSON.stringify({ lines: cart.lines, note: cart.note || '', attributes: cart.attributes || {}, token: cart.token })).toString('base64url');
  return `${COOKIE}=${data}.${sign(data)}; Path=/; Max-Age=1209600; SameSite=Lax; HttpOnly; Secure`;
}

function lineKey(l) { return `${l.id}:${crypto.createHash('md5').update(JSON.stringify(l.properties || {})).digest('hex')}`; }

// stock rule: tracked + deny => cap at inventory
function maxQty(v) {
  if (!v.inventory_management || v.inventory_policy === 'continue') return Infinity;
  return Math.max(0, v.inventory_quantity);
}

function add(cart, id, qty, properties) {
  const v = D.variantById(id);
  if (!v) return { error: { status: 404, message: 'Cart Error', description: 'Tuotetta ei löytynyt' } };
  qty = Math.max(1, parseInt(qty, 10) || 1);
  const props = properties && Object.keys(properties).length ? properties : {};
  let line = cart.lines.find((l) => String(l.id) === String(v.id) && JSON.stringify(l.properties || {}) === JSON.stringify(props));
  const inCart = cart.lines.filter((l) => String(l.id) === String(v.id)).reduce((a, l) => a + l.quantity, 0);
  const cap = maxQty(v);
  if (!v.available || inCart >= cap) {
    return { error: { status: 422, message: 'Cart Error', description: cap > 0 && cap !== Infinity ? `Tuotetta ${v.product.title} (${v.title}) on varastossa ${cap} kpl, ja ne ovat jo ostoskorissasi.` : `${v.product.title} (${v.title}) on loppunut varastosta.` } };
  }
  const allowed = Math.min(qty, cap - inCart);
  if (line) line.quantity += allowed; else { line = { id: v.id, quantity: allowed, properties: props }; cart.lines.push(line); }
  return { line };
}
function change(cart, { line, id, quantity }) {
  let idx = -1;
  if (line) idx = Number(line) - 1;
  else if (id !== undefined) idx = cart.lines.findIndex((l) => lineKey(l) === String(id) || String(l.id) === String(id));
  if (idx < 0 || idx >= cart.lines.length) return { error: { status: 400, message: 'Cart Error', description: 'Riviä ei löytynyt' } };
  const q = Math.max(0, parseInt(quantity, 10) || 0);
  if (q === 0) cart.lines.splice(idx, 1);
  else {
    const v = D.variantById(cart.lines[idx].id);
    cart.lines[idx].quantity = Math.min(q, maxQty(v));
  }
  return {};
}
function update(cart, updates) {
  // updates: {variantId|key: qty} or array by line index
  if (Array.isArray(updates)) updates.forEach((q, i) => { if (cart.lines[i]) cart.lines[i].quantity = Math.max(0, parseInt(q, 10) || 0); });
  else for (const [k, q] of Object.entries(updates || {})) {
    const l = cart.lines.find((x) => lineKey(x) === k || String(x.id) === k);
    if (l) l.quantity = Math.max(0, parseInt(q, 10) || 0);
    else if (Number(q) > 0) add(cart, k, q);
  }
  cart.lines = cart.lines.filter((l) => l.quantity > 0).map((l) => ({ ...l, quantity: Math.min(l.quantity, maxQty(D.variantById(l.id))) }));
}

// ---- Liquid cart object
function liquidCart(cart) {
  const items = cart.lines.map((l, i) => {
    const v = D.variantById(l.id);
    const p = v.product;
    const price = v.price;
    return {
      id: v.id, key: lineKey(l), index: i, quantity: l.quantity, variant: v, variant_id: v.id, product: p, product_id: p.id,
      title: p.has_only_default_variant ? p.title : `${p.title} - ${v.title}`, product_title: p.title, variant_title: p.has_only_default_variant ? null : v.title,
      price, original_price: price, final_price: price, line_price: price * l.quantity, original_line_price: price * l.quantity, final_line_price: price * l.quantity,
      total_discount: 0, discounts: [], line_level_discount_allocations: [], line_level_total_discount: 0,
      image: p.featured_image, url: `/products/${p.handle}?variant=${v.id}`, sku: v.sku, vendor: p.vendor, properties: l.properties || {},
      options_with_values: p.has_only_default_variant ? [] : (p.__r.options || []).map((o, k) => ({ name: o.name, value: v.options[k] })),
      selling_plan_allocation: null, unit_price_measurement: null, requires_shipping: true, taxable: true, gift_card: false, message: '', fulfillment_service: 'manual',
    };
  });
  const total = items.reduce((a, it) => a + it.final_line_price, 0);
  return {
    items, item_count: items.reduce((a, it) => a + it.quantity, 0), total_price: total, original_total_price: total, items_subtotal_price: total, total_discount: 0, total_weight: 0,
    currency: { iso_code: 'EUR', symbol: '€', name: 'Euro' }, taxes_included: true, duties_included: false, requires_shipping: items.length > 0, note: cart.note || '', attributes: cart.attributes || {},
    cart_level_discount_applications: [], discount_applications: [], empty: items.length === 0, token: cart.token, checkout_charge_amount: total,
    gift: G.state(total),
  };
}

// ---- Shopify AJAX JSON
function itemJson(it) {
  const img = it.image;
  return {
    id: it.id, properties: it.properties, quantity: it.quantity, variant_id: it.variant_id, key: it.key, title: it.title, price: it.price, original_price: it.price,
    presentment_price: it.price / 100, discounted_price: it.price, line_price: it.line_price, original_line_price: it.original_line_price, total_discount: 0, discounts: [],
    sku: it.sku, grams: 0, vendor: it.vendor, taxable: true, product_id: it.product_id, product_has_only_default_variant: it.product.has_only_default_variant, gift_card: false,
    final_price: it.final_price, final_line_price: it.final_line_price, url: it.url,
    featured_image: img ? { aspect_ratio: img.aspect_ratio, alt: img.alt, height: img.height, url: img.src, width: img.width } : null,
    image: img ? img.src : null, handle: it.product.handle, requires_shipping: true, product_type: it.product.type, product_title: it.product_title,
    product_description: '', variant_title: it.variant_title, variant_options: it.variant.options, options_with_values: it.options_with_values,
    line_level_discount_allocations: [], line_level_total_discount: 0, has_components: false,
  };
}
function cartJson(lc) {
  return {
    token: lc.token, note: lc.note, attributes: lc.attributes, original_total_price: lc.original_total_price, total_price: lc.total_price, total_discount: 0, total_weight: 0,
    item_count: lc.item_count, items: lc.items.map(itemJson), requires_shipping: lc.requires_shipping, currency: 'EUR', items_subtotal_price: lc.items_subtotal_price,
    cart_level_discount_applications: [], gift: lc.gift,
  };
}

module.exports = { load, cookieFor, add, change, update, liquidCart, cartJson, itemJson, parseCookies, lineKey };
