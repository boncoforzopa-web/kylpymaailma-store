// Shopify-compatible Liquid renderer for the theme in /theme.
'use strict';
const fs = require('fs');
const path = require('path');
const { Liquid, Tag, Hash, Drop } = require('liquidjs');
const { AsyncLocalStorage } = require('async_hooks');
const REQ = new AsyncLocalStorage();
const D = require('./data');
const B = require('./brand');
const host = () => { const s = REQ.getStore(); return s ? s.host : B.domain; };

const THEME = path.join(D.ROOT, 'theme');
const BUILD = process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 10) : 'dev';
const PAYMENT_ICONS = D.read('payment-icons.json');
const LOCALE = (() => {
  const fi = D.readTheme('locales/fi.json');
  return { fi };
})();

// ---------------------------------------------------------------- engine
const engine = new Liquid({
  root: [THEME],
  partials: [path.join(THEME, 'snippets')],
  extname: '.liquid',
  cache: true,
  jsTruthy: false,
  strictFilters: !!process.env.TW_STRICT,
  strictVariables: false,
  ownPropertyOnly: false,
  dynamicPartials: true,
  relativeReference: false,
  outputEscape: undefined,
  timezoneOffset: 'Europe/Helsinki',
  preserveTimezones: false,
});

// Strip blocks that Shopify handles outside Liquid
const STRIP_RE = /\{%-?\s*(schema|stylesheet|javascript)\s*-?%\}[\s\S]*?\{%-?\s*end\1\s*-?%\}/g;
// Liquid keeps decimals when dividing by a float literal (e.g. divided_by: 100.0); JS can't tell 100.0 from 100
const prep = (src) => src.replace(STRIP_RE, '').replace(/divided_by:\s*(\d+\.\d+)/g, 'fdiv: $1');
const origReadFile = fs.readFileSync;
engine.options.fs = {
  readFileSync: (f) => prep(origReadFile(f, 'utf8')),
  readFile: async (f) => prep(origReadFile(f, 'utf8')),
  existsSync: (f) => fs.existsSync(f),
  exists: async (f) => fs.existsSync(f),
  contains: (root, file) => path.resolve(file).startsWith(path.resolve(root)),
  resolve: (root, file, ext) => path.resolve(root, file.endsWith(ext) ? file : file + ext),
  sep: path.sep,
  dirname: path.dirname,
};

// ---------------------------------------------------------------- helpers
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
function fmtMoney(cents, { currency = false, symbol = true, trimZeros = false } = {}) {
  if (cents === null || cents === undefined || cents === '') return '';
  const n = Number(cents) / 100;
  let s = n.toFixed(2);
  if (trimZeros && s.endsWith('.00')) s = s.slice(0, -3);
  const [i, d] = s.split('.');
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  const out = d !== undefined ? `${int},${d}` : int;
  if (currency) return `${out} € EUR`;
  return symbol ? `${out} €` : out;
}
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function toPlain(v, depth = 0) {
  if (v === null || v === undefined) return v;
  if (depth > 4) return null;
  if (Array.isArray(v)) return v.map((x) => toPlain(x, depth + 1));
  if (v instanceof D.MetafieldDrop) return v.value;
  if (typeof v === 'object') {
    if (v instanceof ImgUrl) return v.url;
    const o = {};
    let proto = v;
    const keys = new Set(Object.keys(v));
    while ((proto = Object.getPrototypeOf(proto)) && proto !== Object.prototype && proto !== Drop.prototype) {
      for (const k of Object.getOwnPropertyNames(proto)) {
        const d = Object.getOwnPropertyDescriptor(proto, k);
        if (d && d.get) keys.add(k);
      }
    }
    for (const k of keys) {
      if (k.startsWith('__') || k === 'product' || k === 'collections' || k === 'constructor') continue;
      try { const x = v[k]; if (typeof x !== 'function') o[k] = toPlain(x, depth + 1); } catch (e) { /* ignore */ }
    }
    return o;
  }
  return v;
}
// Shopify's json filter escapes forward slashes
const shopifyJson = (v) => (v instanceof FloatNum ? v.toString() : JSON.stringify(toPlain(v) === undefined ? null : toPlain(v)).replace(/\//g, '\\/').replace(/</g, '\\u003c').replace(/>/g, '\\u003e'));

// Liquid floats print with a decimal ("42.0"), JS numbers don't
class FloatNum {
  constructor(n) { this.n = n; }
  valueOf() { return this.n; }
  toString() { return Number.isInteger(this.n) ? `${this.n}.0` : String(this.n); }
  toJSON() { return this.n; }
}

// image_url returns this so image_tag can still see the image + requested width
class ImgUrl {
  constructor(img, width, height) {
    this.img = img; this.width = width; this.height = height;
    this.url = pickUrl(img, width);
  }
  toString() { return this.url; }
  valueOf() { return this.url; }
}
function asImage(v) {
  if (!v) return null;
  if (v instanceof ImgUrl) return v.img;
  if (v instanceof D.ImageDrop) return v;
  if (typeof v === 'string') {
    if (v.startsWith('shopify://shop_images/')) return D.shopImage(v);
    return new D.ImageDrop({ src: v, width: 800, height: 800 });
  }
  if (v.featured_image) return v.featured_image;
  if (v.preview_image) return v.preview_image;
  return null;
}
function pickUrl(img, width) {
  if (!img) return '';
  const meta = img.__img || {};
  if (!meta.base) return img.src && img.src.startsWith('/') && !img.src.startsWith('//') ? `//${host()}${img.src}` : img.src;
  const ws = meta.widths;
  const w = width ? (ws.find((x) => x >= width) || ws[ws.length - 1]) : ws[ws.length - 1];
  return `//${host()}/images/${meta.base}-${w}.webp`;
}
function lookup(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}
function translate(key, vars) {
  let s = lookup(LOCALE.fi, key);
  if (s === undefined) return `translation missing: fi.${key}`;
  if (typeof s === 'object') s = s.other || s.one || '';
  return String(s).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : ''));
}
function kwargs(args) {
  // liquidjs passes keyword args as [key, value] pairs
  const out = {};
  for (const a of args) if (Array.isArray(a) && a.length === 2 && typeof a[0] === 'string') out[a[0]] = a[1];
  return out;
}

// ---------------------------------------------------------------- filters
const F = {
  asset_url: (f) => `//${host()}/cdn/shop/t/18/assets/${f}?v=${BUILD}`,
  asset_img_url: (f) => `//${host()}/cdn/shop/t/18/assets/${f}?v=${BUILD}`,
  shopify_asset_url: (f) => `/cdn/shopifycloud/${f}`,
  file_url: (f) => `/${f}`,
  stylesheet_tag(url, ...args) {
    const o = kwargs(args);
    const tag = `<link href="${url}" rel="stylesheet" type="text/css" media="all" />`;
    return o.preload ? tag : tag;
  },
  script_tag: (url) => `<script src="${url}" type="text/javascript"></script>`,
  image_url(v, ...args) {
    const o = kwargs(args);
    const img = asImage(v);
    if (!img) return '';
    return new ImgUrl(img, o.width || null, o.height || null);
  },
  img_url(v, size) {
    const img = asImage(v);
    if (!img) return '';
    const m = /^(\d+)x/.exec(size || '');
    return pickUrl(img, m ? Number(m[1]) : null);
  },
  image_tag(v, ...args) {
    const o = kwargs(args);
    const iu = v instanceof ImgUrl ? v : new ImgUrl(asImage(v), null);
    const img = iu.img;
    if (!img) return '';
    // Shopify sizes the tag by the requested width (not capped by the original)
    const w = iu.width || img.width;
    const h = iu.height ? iu.height : Math.round(w / (img.aspect_ratio || 1));
    const attrs = [];
    attrs.push(`src="${iu.url}"`);
    const alt = o.alt !== undefined ? o.alt : img.alt;
    attrs.push(`alt="${escapeHtml(alt || '')}"`);
    let widths = o.widths ? String(o.widths).split(',').map((x) => Number(x.trim())).filter(Boolean) : null;
    if (!widths) widths = [352, 832, 1200, 1920].filter((x) => x <= w);
    // Each requested width maps to the nearest generated file (never upscaled), labelled with that file's real width.
    const have = (img.__img && img.__img.widths) || null;
    if (have) widths = [...new Set(widths.map((x) => have.find((y) => y >= x) || have[have.length - 1]))];
    else widths = widths.filter((x) => x <= (img.width || x));
    if (widths.length && o.srcset !== null) {
      attrs.push(`srcset="${widths.map((x) => `${pickUrl(img, x)} ${x}w`).join(', ')}"`);
    }
    attrs.push(`width="${o.width || w}"`);
    attrs.push(`height="${o.height || (o.width ? Math.round(o.width / (img.aspect_ratio || 1)) : h)}"`);
    for (const [k, val] of Object.entries(o)) {
      if (['alt', 'widths', 'width', 'height', 'srcset', 'preload'].includes(k)) continue;
      if (val === null || val === false) continue;
      attrs.push(`${k}="${escapeHtml(val)}"`);
    }
    return `<img ${attrs.join(' ')}>`;
  },
  placeholder_svg_tag: (name, cls) => `<svg class="${cls || ''}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 525.5 525.5"><rect width="525.5" height="525.5" fill="#eee"/></svg>`,
  media_tag(m, ...args) { return F.image_tag(new ImgUrl(asImage(m), 1200), ...args); },
  metafield_tag(m) {
    if (!m || m.value === undefined || m.value === null) return '';
    const t = m.type || 'single_line_text_field';
    if (t === 'multi_line_text_field') return `<span class="metafield-multi_line_text_field">${escapeHtml(m.value).replace(/\r?\n/g, '<br />\n')}</span>`;
    if (t === 'date') return `<time datetime="${m.value}" class="metafield-date">${m.value}</time>`;
    if (t === 'boolean') return `<span class="metafield-boolean">${m.value}</span>`;
    return `<span class="metafield-${t}">${escapeHtml(m.value)}</span>`;
  },
  metafield_text: (m) => (m && m.value !== undefined ? String(m.value) : ''),
  money: (c) => fmtMoney(c),
  money_with_currency: (c) => fmtMoney(c, { currency: true }),
  money_without_currency: (c) => fmtMoney(c, { symbol: false }),
  money_without_trailing_zeros: (c) => fmtMoney(c, { trimZeros: true }),
  json: (v) => shopifyJson(v),
  handle: (s) => D.handleize(s),
  handleize: (s) => D.handleize(s),
  t: (key, ...args) => translate(key, kwargs(args)),
  default_errors: () => '',
  format_address(a) {
    if (!a) return '';
    const lines = [a.company, [a.first_name, a.last_name].filter(Boolean).join(' '), a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' '), a.country].filter(Boolean);
    return `<p>${lines.map(escapeHtml).join('<br>')}</p>`;
  },
  payment_type_svg_tag(type, ...args) {
    const o = kwargs(args);
    const svg = PAYMENT_ICONS[type];
    return svg ? svg.replace('{{CLASS}}', o.class || 'icon icon--full-color') : '';
  },
  payment_type_img_url: (type) => '',
  url_encode: (s) => encodeURIComponent(String(s === undefined || s === null ? '' : s)).replace(/%20/g, '+'),
  url_escape: (s) => encodeURI(String(s || '')),
  url_param_escape: (s) => encodeURIComponent(String(s || '')),
  within: (url) => url,
  link_to: (text, url, title) => `<a href="${url}"${title ? ` title="${escapeHtml(title)}"` : ''}>${text}</a>`,
  divided_by(a, b) {
    const x = Number(a); const y = Number(b);
    if (Number.isInteger(x) && Number.isInteger(y)) return Math.floor(x / y);
    return x / y;
  },
  fdiv: (a, b) => new FloatNum(Number(a) / Number(b)),
  format_code: (s) => s,
  structured_data: () => '',
  font_face: () => '',
  font_url: () => '',
  highlight: (s) => s,
  weight_with_unit: (g) => `${(Number(g) / 1000).toFixed(2).replace('.', ',')} kg`,
  time_tag: (d, fmt) => `<time datetime="${new Date(d).toISOString()}">${d}</time>`,
  color_to_rgb: (c) => c,
  color_modify: (c) => c,
  color_extract: (c) => c,
  inline_asset_content: (f) => { try { return origReadFile(path.join(THEME, 'assets', f), 'utf8'); } catch (e) { return ''; } },
  camelize: (s) => String(s).replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')),
  pluralize: (n, one, many) => (Number(n) === 1 ? one : many),
};
for (const [k, fn] of Object.entries(F)) engine.registerFilter(k, fn);

// date: Shopify reads date-only values ("2026-11-13") as midnight in the shop's time zone
const builtinDate = engine.filters.date || engine.filters['date'];
function berlinOffset(y, m, d) {
  const probe = new Date(Date.UTC(y, m - 1, d, 12));
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Helsinki', timeZoneName: 'shortOffset' }).formatToParts(probe).find((x) => x.type === 'timeZoneName').value;
  const mm = /GMT([+-]\d+)/.exec(part);
  const h = mm ? Number(mm[1]) : 2;
  return `${h >= 0 ? '+' : '-'}${String(Math.abs(h)).padStart(2, '0')}:00`;
}
engine.registerFilter('date', function (v, ...args) {
  if (v instanceof D.MetafieldDrop) v = v.value;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    v = `${v}T00:00:00${berlinOffset(y, m, d)}`;
  }
  return builtinDate.call(this, v, ...args);
});

// ---------------------------------------------------------------- tags
// {% section 'name' %} — static section
engine.registerTag('section', class extends Tag {
  constructor(token, rest, liquid) { super(token, rest, liquid); this.name = token.args.trim().replace(/^['"]|['"]$/g, ''); }
  * render(ctx, emitter) {
    const scope = { ...ctx.globals, ...ctx.getAll() };
    const html = yield renderStaticSection(this.name, scope);
    emitter.write(html);
  }
});
// {% sections 'group' %}
engine.registerTag('sections', class extends Tag {
  constructor(token, rest, liquid) { super(token, rest, liquid); this.name = token.args.trim().replace(/^['"]|['"]$/g, ''); }
  * render(ctx, emitter) {
    const scope = { ...ctx.globals, ...ctx.getAll() };
    const html = yield renderGroup(this.name, scope);
    emitter.write(html);
  }
});
// {% form 'type', object, key: value %}…{% endform %}
engine.registerTag('form', class extends Tag {
  constructor(token, remain, liquid) {
    super(token, remain, liquid);
    const args = token.args;
    const m = /^\s*(['"])(\w+)\1\s*(.*)$/.exec(args);
    this.type = m ? m[2] : 'contact';
    const rest = m ? m[3].replace(/^\s*,\s*/, '') : '';
    // optional positional object before first key:
    const parts = rest.split(/,(?=(?:[^'"]|'[^']*'|"[^"]*")*$)/).map((s) => s.trim()).filter(Boolean);
    this.objExpr = parts.length && !/^[\w-]+\s*:/.test(parts[0]) ? parts.shift() : null;
    this.hash = new Hash(parts.map((p) => p.replace(/^([\w-]+)\s*:/, (_, k) => `${k.replace(/-/g, '__DASH__')}:`)).join(', '));
    this.tpls = [];
    let closed = false;
    while (remain.length) {
      const t = remain.shift();
      if (t.name === 'endform') { closed = true; break; }
      this.tpls.push(liquid.parser.parseToken(t, remain));
    }
    if (!closed) throw new Error('form not closed');
  }
  * render(ctx, emitter) {
    const attrs = yield this.hash.render(ctx);
    const obj = this.objExpr ? yield this.liquid.evalValue(this.objExpr, ctx) : null;
    const a = {};
    for (const [k, v] of Object.entries(attrs)) a[k.replace(/__DASH__/g, '-')] = v;
    const formState = ((ctx.globals || {}).__forms || {})[this.type] || {};
    const form = { errors: formState.errors || null, posted_successfully: !!formState.success, 'posted_successfully?': !!formState.success, email: formState.email || '', body: '', name: '', phone: '', password_needed: true };
    let action = '/contact';
    let extra = '';
    const id = a.id;
    switch (this.type) {
      case 'product':
        action = '/cart/add';
        break;
      case 'contact':
      case 'customer':
        action = `/contact${id ? `#${id}` : '#contact_form'}`;
        break;
      case 'customer_login': action = '/account/login'; break;
      case 'create_customer': action = '/account'; break;
      case 'recover_customer_password': action = '/account/recover'; break;
      case 'storefront_password': action = '/password'; break;
      default: action = `/${this.type}`;
    }
    let tag = `<form method="post" action="${action}"`;
    if (id) tag += ` id="${id}"`;
    tag += ' accept-charset="UTF-8"';
    tag += ` class="${a.class || (this.type === 'contact' ? 'contact-form' : '')}"`;
    if (this.type === 'product') tag += ' enctype="multipart/form-data"';
    for (const [k, v] of Object.entries(a)) {
      if (k === 'id' || k === 'class') continue;
      tag += ` ${k}="${escapeHtml(v)}"`;
    }
    tag += `><input type="hidden" name="form_type" value="${this.type}" /><input type="hidden" name="utf8" value="✓" />${extra}`;
    emitter.write(tag);
    ctx.push({ form });
    yield this.liquid.renderer.renderTemplates(this.tpls, ctx, emitter);
    ctx.pop();
    if (this.type === 'product' && obj) {
      const sec = ctx.getAll().section;
      emitter.write(`<input type="hidden" name="product-id" value="${obj.id}" /><input type="hidden" name="section-id" value="${sec ? sec.id : ''}" />`);
    }
    emitter.write('</form>');
  }
});
// {% paginate collection.products by 24 %}…{% endpaginate %}
engine.registerTag('paginate', class extends Tag {
  constructor(token, remain, liquid) {
    super(token, remain, liquid);
    const m = /^\s*([\w.\[\]'"]+)\s+by\s+(.+?)\s*$/.exec(token.args);
    this.expr = m[1]; this.byExpr = m[2];
    this.tpls = [];
    while (remain.length) {
      const t = remain.shift();
      if (t.name === 'endpaginate') break;
      this.tpls.push(liquid.parser.parseToken(t, remain));
    }
  }
  * render(ctx, emitter) {
    const by = Number(yield this.liquid.evalValue(this.byExpr, ctx)) || 50;
    const parts = this.expr.split('.');
    const prop = parts.pop();
    const baseExpr = parts.join('.');
    const base = baseExpr ? yield this.liquid.evalValue(baseExpr, ctx) : null;
    const all = (base ? base[prop] : yield this.liquid.evalValue(this.expr, ctx)) || [];
    const scope = { ...ctx.globals, ...ctx.getAll() };
    const page = Math.max(1, Number(scope.current_page) || 1);
    const pages = Math.max(1, Math.ceil(all.length / by));
    const slice = all.slice((page - 1) * by, page * by);
    const urlFor = (n) => {
      const u = new URL(scope.request.__url);
      u.searchParams.delete('section_id');
      u.searchParams.set('page', n);
      u.searchParams.sort();
      return u.pathname + (u.search || '');
    };
    const partsArr = [];
    for (let n = 1; n <= pages; n++) {
      if (n === 1 || n === pages || Math.abs(n - page) <= 2) partsArr.push({ title: n, url: urlFor(n), is_link: n !== page });
      else if (partsArr.length && partsArr[partsArr.length - 1].title !== '&hellip;') partsArr.push({ title: '&hellip;', is_link: false });
    }
    const paginate = {
      current_page: page, current_offset: (page - 1) * by, items: all.length, page_size: by, pages,
      parts: partsArr,
      previous: page > 1 ? { title: '&laquo; Edellinen', url: urlFor(page - 1), is_link: true } : null,
      next: page < pages ? { title: 'Seuraava &raquo;', url: urlFor(page + 1), is_link: true } : null,
    };
    const push = { paginate };
    if (base && baseExpr && !baseExpr.includes('.')) {
      const clone = Object.create(base);
      Object.defineProperty(clone, prop, { value: slice, enumerable: true });
      push[baseExpr] = clone;
    }
    ctx.push(push);
    yield this.liquid.renderer.renderTemplates(this.tpls, ctx, emitter);
    ctx.pop();
  }
});
// {% style %}…{% endstyle %}
engine.registerTag('style', class extends Tag {
  constructor(token, remain, liquid) {
    super(token, remain, liquid);
    this.tpls = [];
    while (remain.length) {
      const t = remain.shift();
      if (t.name === 'endstyle') break;
      this.tpls.push(liquid.parser.parseToken(t, remain));
    }
  }
  * render(ctx, emitter) {
    emitter.write('<style data-shopify>');
    yield this.liquid.renderer.renderTemplates(this.tpls, ctx, emitter);
    emitter.write('</style>');
  }
});
engine.registerTag('layout', class extends Tag { render() {} });

// ---------------------------------------------------------------- settings resolution
function resolveSetting(type, value) {
  if (value === undefined || value === null || value === '') {
    if (['collection', 'product', 'page', 'link_list', 'image_picker', 'blog', 'video', 'article'].includes(type)) return null;
    return value === undefined ? null : value;
  }
  switch (type) {
    case 'collection': return D.COLLECTIONS_BY_HANDLE[value] || null;
    case 'product': return D.productByHandle(value);
    case 'page': return D.pageByHandle(value);
    case 'link_list': return currentLinklists ? currentLinklists[value] || null : null;
    case 'image_picker': return D.shopImage(value);
    case 'url': return resolveShopifyUrl(value);
    case 'collection_list': return (value || []).map((h) => D.COLLECTIONS_BY_HANDLE[h]).filter(Boolean);
    case 'product_list': return (value || []).map((h) => D.productByHandle(h)).filter(Boolean);
    default: return value;
  }
}
let currentLinklists = null;
function resolveShopifyUrl(v) {
  if (typeof v !== 'string') return v;
  return v
    .replace(/^shopify:\/\/collections\/(.+)$/, '/collections/$1')
    .replace(/^shopify:\/\/products\/(.+)$/, '/products/$1')
    .replace(/^shopify:\/\/pages\/(.+)$/, '/pages/$1')
    .replace(/^shopify:\/\/blogs\/(.+)$/, '/blogs/$1')
    .replace(/^shopify:\/\/policies\/(.+)$/, '/policies/$1');
}

const SCHEMA_CACHE = {};
function sectionSchema(type) {
  if (SCHEMA_CACHE[type]) return SCHEMA_CACHE[type];
  const src = origReadFile(path.join(THEME, 'sections', `${type}.liquid`), 'utf8');
  const m = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/.exec(src);
  let schema = {};
  try { schema = m ? JSON.parse(m[1]) : {}; } catch (e) { schema = {}; }
  SCHEMA_CACHE[type] = schema;
  return schema;
}
function buildSettings(defs, given) {
  const out = {};
  for (const d of defs || []) {
    if (!d.id) continue;
    const v = given && Object.prototype.hasOwnProperty.call(given, d.id) ? given[d.id] : d.default;
    out[d.id] = resolveSetting(d.type, v);
  }
  // keep unknown keys raw
  for (const [k, v] of Object.entries(given || {})) if (!(k in out)) out[k] = resolveShopifyUrl(v);
  return out;
}
let GLOBAL_SETTINGS = null;
function globalSettings() {
  const defs = D.SETTINGS_SCHEMA.flatMap((g) => g.settings || []);
  return buildSettings(defs, D.SETTINGS_DATA);
}
function buildSection(id, type, cfg) {
  const schema = sectionSchema(type);
  const settings = buildSettings(schema.settings, cfg.settings || {});
  const blockDefs = {};
  for (const b of schema.blocks || []) blockDefs[b.type] = b;
  const order = cfg.block_order || Object.keys(cfg.blocks || {});
  const blocks = order.map((bid) => {
    const b = (cfg.blocks || {})[bid];
    if (!b || b.disabled) return null;
    const def = blockDefs[b.type] || blockDefs['@app'] || {};
    return { id: bid, type: b.type, settings: buildSettings(def.settings, b.settings || {}), shopify_attributes: '' };
  }).filter(Boolean);
  return { id, type, settings, blocks, index: null, location: null, __schema: schema };
}

// ---------------------------------------------------------------- section rendering
async function renderSectionFile(section, scope, wrapperClass) {
  const file = path.join(THEME, 'sections', `${section.type}.liquid`);
  const tpl = await engine.parseFile(file);
  const html = await engine.render(tpl, { section }, { globals: scope });
  const schema = section.__schema || {};
  const tag = schema.tag || 'div';
  const cls = ['shopify-section', wrapperClass, schema.class].filter(Boolean).join(' ');
  return `<${tag} id="shopify-section-${section.id}" class="${cls}">${html}</${tag}>`;
}
async function renderStaticSection(name, scope) {
  const cfg = (D.SETTINGS_DATA.sections || {})[name] || {};
  const s = buildSection(name, name, cfg);
  return renderSectionFile(s, scope);
}
const GROUP_IDS = { 'header-group': '33250787230021', 'footer-group': '33250787164485' };
async function renderGroup(name, scope) {
  const g = D.readTheme(`sections/${name}.json`);
  const order = g.order || Object.keys(g.sections);
  let out = '';
  for (const key of order) {
    const cfg = g.sections[key];
    if (!cfg || cfg.disabled) continue;
    const s = buildSection(`sections--${GROUP_IDS[name] || name}__${key}`, cfg.type, cfg);
    out += await renderSectionFile(s, scope, `shopify-section-group-${name}`);
  }
  return out;
}
const VIRTUAL_TEMPLATES = { checkout: { sections: { main: { type: 'tw-checkout', settings: {} } } }, 'checkout-danke': { sections: { main: { type: 'tw-checkout-danke', settings: {} } } }, 'order-status': { sections: { main: { type: 'tw-order-status', settings: {} } } } };
function templateSections(templateName, suffix) {
  if (VIRTUAL_TEMPLATES[templateName]) { const t = VIRTUAL_TEMPLATES[templateName]; return Object.keys(t.sections).map((key) => ({ key, cfg: t.sections[key] })); }
  const file = suffix ? `templates/${templateName}.${suffix}.json` : `templates/${templateName}.json`;
  const full = path.join(THEME, file);
  const t = fs.existsSync(full) ? D.readTheme(file) : D.readTheme(`templates/${templateName}.json`);
  const order = t.order || Object.keys(t.sections);
  return order.map((key) => ({ key, cfg: t.sections[key] })).filter((x) => x.cfg && !x.cfg.disabled);
}

// ---------------------------------------------------------------- globals
function baseScope({ url, pageType, template, suffix, cart, extra = {}, forms = {} }) {
  const u = new URL(url);
  currentLinklists = D.linklistsGlobal(u.pathname);
  if (!GLOBAL_SETTINGS) GLOBAL_SETTINGS = globalSettings();
  const settings = { ...GLOBAL_SETTINGS };
  // link_list settings must resolve per request (active state)
  const origin = `${u.protocol}//${u.host}`;
  const scope = {
    settings,
    shop: {
      name: B.name, domain: B.domain, permanent_domain: B.domain, url: origin, secure_url: origin, currency: 'EUR', money_format: '{{amount_with_comma_separator}} €',
      money_with_currency_format: '{{amount_with_comma_separator}} € EUR', email: B.email, customer_accounts_enabled: false, customer_accounts_optional: true,
      enabled_payment_types: ['visa', 'master', 'american_express', 'apple_pay', 'google_pay'],
      password_message: '', locale: 'fi', description: '', brand: null, policies: Object.values(D.POLICIES), types: [], vendors: [],
      privacy_policy: D.POLICIES['privacy-policy'], refund_policy: D.POLICIES['refund-policy'], shipping_policy: D.POLICIES['shipping-policy'], terms_of_service: D.POLICIES['terms-of-service'],
    },
    routes: {
      root_url: '/', account_url: '/account', account_login_url: '/account', account_logout_url: '/account/logout', account_register_url: '/account/register',
      account_addresses_url: '/account/addresses', collections_url: '/collections', all_products_collection_url: '/collections/all', search_url: '/search',
      predictive_search_url: '/search/suggest', cart_url: '/cart', cart_add_url: '/cart/add', cart_change_url: '/cart/change', cart_clear_url: '/cart/clear',
      cart_update_url: '/cart/update', product_recommendations_url: '/recommendations/products',
    },
    request: { page_type: pageType, path: u.pathname, host: u.host, origin, locale: { iso_code: 'fi', primary: true, endonym_name: 'Suomi', name: 'Suomi' }, design_mode: false, visual_preview_mode: false, __url: url },
    localization: { language: { iso_code: 'fi' }, country: { iso_code: 'FI', currency: { iso_code: 'EUR', symbol: '€' } }, available_languages: [], available_countries: [] },
    template: { name: template, suffix: suffix || null, directory: null },
    cart,
    min_order: parseInt(process.env.MIN_ORDER_CENTS || '0', 10),
    paths: B.paths,
    vat_label: B.vatLabel,
    customer: null,
    linklists: currentLinklists,
    collections: D.collectionsGlobal(),
    pages: D.PAGES_BY_HANDLE,
    all_products: new Proxy({}, { get: (_, h) => (typeof h === 'string' ? D.productByHandle(h) : undefined) }),
    canonical_url: `${origin}${u.pathname === '/' ? '/' : u.pathname}`,
    current_page: Number(u.searchParams.get('page')) || 1,
    current_tags: null,
    page_title: B.name,
    page_description: '',
    content_for_header: contentForHeader(),
    powered_by_link: '',
    __forms: forms,
    ...extra,
  };
  // re-resolve link_list settings with fresh linklists
  for (const d of D.SETTINGS_SCHEMA.flatMap((g) => g.settings || [])) if (d.type === 'link_list') settings[d.id] = currentLinklists[D.SETTINGS_DATA[d.id] || d.default] || null;
  return scope;
}

// head injection (replaces Shopify's content_for_header): Google tag + consent defaults
function contentForHeader() {
  const gtagIds = (process.env.GOOGLE_TAG_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!gtagIds.length) return '<script src="/tw-shim.js" defer></script>';
  return `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});try{var c=JSON.parse(localStorage.getItem('tw-consent-v1')||'null');if(c){gtag('consent','update',{ad_storage:c.marketing?'granted':'denied',ad_user_data:c.marketing?'granted':'denied',ad_personalization:c.marketing?'granted':'denied',analytics_storage:c.analytics?'granted':'denied'});}}catch(e){}gtag('js',new Date());${gtagIds.map((id) => `gtag('config','${id}');`).join('')}</script><script async src="https://www.googletagmanager.com/gtag/js?id=${gtagIds[0]}"></script><script src="/tw-shim.js" defer></script>`;
}

// ---------------------------------------------------------------- page rendering
async function renderPage(opts) {
  return REQ.run({ host: new URL(opts.url).host }, () => renderPageInner(opts));
}
async function renderPageInner({ url, pageType, template, suffix, cart, extra, forms, sectionId, layout: layoutName }) {
  const scope = baseScope({ url, pageType, template, suffix, cart, extra, forms });
  const list = templateSections(template, suffix);
  const tplId = `template--tw-${template}${suffix ? `-${suffix}` : ''}`;

  if (sectionId) {
    // Section Rendering API
    const hit = list.find((x) => `${tplId}__${x.key}` === sectionId || x.key === sectionId);
    if (hit) return renderSectionFile(buildSection(`${tplId}__${hit.key}`, hit.cfg.type, hit.cfg), scope);
    if (fs.existsSync(path.join(THEME, 'sections', `${sectionId}.liquid`))) return renderStaticSection(sectionId, scope);
    return null;
  }

  let content = '';
  if (pageType === 'policy') {
    const pol = extra.policy;
    content = `\n<div class="shopify-policy__container">\n  <div class="shopify-policy__title">\n    <h1>${pol.title}</h1>\n  </div>\n\n  <div class="shopify-policy__body">\n    <div class="rte">\n        ${pol.body}\n    </div>\n  </div>\n</div>\n`;
    scope.template = { name: 'policy', suffix: null, directory: null };
  } else for (const { key, cfg } of list) content += await renderSectionFile(buildSection(`${tplId}__${key}`, cfg.type, cfg), scope);
  const layout = await engine.parseFile(path.join(THEME, 'layout', `${layoutName || 'theme'}.liquid`));
  if (extra && extra.content_for_header_extra) scope.content_for_header += extra.content_for_header_extra;
  return engine.render(layout, { content_for_layout: content }, { globals: scope });
}

module.exports = { REQ, engine, renderPage, renderStaticSection, baseScope, fmtMoney, translate, pickUrl, BUILD };
