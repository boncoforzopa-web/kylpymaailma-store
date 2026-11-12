// Google Merchant Center product feed (/feeds/google.xml). Keeps the same item IDs the
// Shopify Google app used (shopify_ZZ_<product>_<variant>) so Ads history carries over.
'use strict';
const D = require('./data');

const x = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', szlig: 'ß', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', eacute: 'é', copy: '©', reg: '®', trade: '™' };
const decode = (t) => String(t).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] !== undefined ? ENT[e] : m));
const strip = (h) => decode(String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const HIRES = new Set(require('../data/hires.json')); // 1600px versions generated for Merchant Center
const TOPSELLER = new Set(require('../data/topseller.json')); // custom_label_4 = topseller → PMax asset group "Top-Seller"
const label4 = (p, mf) => mf['mm-google-shopping.custom_label_4'] || (TOPSELLER.has(p.handle) ? 'topseller' : '');
const big = (img) => (img && img.__img && img.__img.base ? `/images/${img.__img.base}-${HIRES.has(img.__img.base) ? 1600 : img.__img.widths[img.__img.widths.length - 1]}.webp` : img ? img.src : '');

function google(origin) {
  const items = [];
  for (const p of D.ACTIVE) {
    const mf = p.__r.metafields || {};
    for (const v of p.variants) {
      const pre = p.tags.includes('Pre-order') && v.inventory_policy === 'continue';
      let availability = v.available ? 'in_stock' : 'out_of_stock';
      if (pre && p.__r.release_date) availability = 'preorder';
      const imgs = p.images.map(big).filter(Boolean);
      const parts = [
        `<g:id>shopify_ZZ_${p.id}_${v.id}</g:id>`,
        `<g:item_group_id>shopify_ZZ_${p.id}</g:item_group_id>`,
        `<g:title>${x((p.has_only_default_variant ? mf['global.title_tag'] || p.title : `${p.title} - ${v.title}`).slice(0, 150))}</g:title>`,
        `<g:description>${x((mf['global.description_tag'] || strip(p.description) || p.title).slice(0, 4900))}</g:description>`,
        `<g:link>${origin}${p.url}${p.has_only_default_variant ? '' : `?variant=${v.id}`}</g:link>`,
        imgs[0] ? `<g:image_link>${origin}${imgs[0]}</g:image_link>` : '',
        ...imgs.slice(1, 10).map((i) => `<g:additional_image_link>${origin}${i}</g:additional_image_link>`),
        `<g:availability>${availability}</g:availability>`,
        availability === 'preorder' ? `<g:availability_date>${p.__r.release_date}T00:00:00+01:00</g:availability_date>` : '',
        `<g:price>${(v.compare_at_price && v.compare_at_price > v.price ? v.compare_at_price : v.price) / 100} EUR</g:price>`,
        v.compare_at_price && v.compare_at_price > v.price ? `<g:sale_price>${v.price / 100} EUR</g:sale_price>` : '',
        `<g:condition>${x((mf['mm-google-shopping.condition'] || 'new').toLowerCase())}</g:condition>`,
        `<g:brand>${x(p.vendor)}</g:brand>`,
        v.barcode ? `<g:gtin>${x(v.barcode)}</g:gtin>` : '',
        v.sku ? `<g:mpn>${x(v.sku)}</g:mpn>` : '',
        v.barcode ? '' : `<g:identifier_exists>no</g:identifier_exists>`,
        `<g:google_product_category>${x(mf['mm-google-shopping.google_product_category'] || 'Apparel & Accessories > Clothing')}</g:google_product_category>`,
        p.type ? `<g:product_type>${x(p.type)}</g:product_type>` : '',
        ...[0, 1, 2, 3].map((n) => (mf[`mm-google-shopping.custom_label_${n}`] ? `<g:custom_label_${n}>${x(mf[`mm-google-shopping.custom_label_${n}`])}</g:custom_label_${n}>` : '')),
        label4(p, mf) ? `<g:custom_label_4>${x(label4(p, mf))}</g:custom_label_4>` : '',
        v.options[0] ? `<g:color>${x(v.options[0])}</g:color>` : '',
        `<g:size>${x(v.options[1] || 'Yksi koko')}</g:size>`,
        `<g:gender>female</g:gender><g:age_group>adult</g:age_group>`,
        mf['custom.material'] ? `<g:material>${x(mf['custom.material'])}</g:material>` : '',
        `<g:shipping><g:country>FI</g:country><g:service>Ilmainen toimitus</g:service><g:price>0 EUR</g:price></g:shipping>`,
      ].filter(Boolean);
      items.push(`<item>${parts.join('')}</item>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>Kylpymaailma</title><link>${origin}</link><description>Kylpymaailma – tuotesyöte</description>\n${items.join('\n')}\n</channel></rss>\n`;
}

// Same products as TSV (/feeds/google.txt) – Merchant Center's most robust format.
function googleTsv(origin) {
  const cols = ['id', 'item_group_id', 'title', 'description', 'link', 'image_link', 'additional_image_link', 'availability', 'availability_date', 'price', 'sale_price', 'condition', 'brand', 'gtin', 'mpn', 'identifier_exists', 'google_product_category', 'product_type', 'custom_label_0', 'custom_label_1', 'custom_label_2', 'custom_label_3', 'custom_label_4', 'color', 'size', 'gender', 'age_group', 'material', 'shipping(country:service:price)'];
  const clean = (v) => String(v === undefined || v === null ? '' : v).replace(/[\t\r\n]+/g, ' ').trim();
  const rows = [cols.join('\t')];
  for (const p of D.ACTIVE) {
    const mf = p.__r.metafields || {};
    for (const v of p.variants) {
      const pre = p.tags.includes('Pre-order') && v.inventory_policy === 'continue';
      let availability = v.available ? 'in_stock' : 'out_of_stock';
      if (pre && p.__r.release_date) availability = 'preorder';
      const imgs = p.images.map(big).filter(Boolean);
      const sale = v.compare_at_price && v.compare_at_price > v.price;
      const r = {
        id: `shopify_ZZ_${p.id}_${v.id}`, item_group_id: `shopify_ZZ_${p.id}`,
        title: (p.has_only_default_variant ? mf['global.title_tag'] || p.title : `${p.title} - ${v.title}`).slice(0, 150),
        description: (mf['global.description_tag'] || strip(p.description) || p.title).slice(0, 4900),
        link: `${origin}${p.url}${p.has_only_default_variant ? '' : `?variant=${v.id}`}`,
        image_link: imgs[0] ? `${origin}${imgs[0]}` : '', additional_image_link: imgs.slice(1, 10).map((i) => `${origin}${i}`).join(','),
        availability, availability_date: availability === 'preorder' ? `${p.__r.release_date}T00:00:00+01:00` : '',
        price: `${((sale ? v.compare_at_price : v.price) / 100).toFixed(2)} EUR`, sale_price: sale ? `${(v.price / 100).toFixed(2)} EUR` : '',
        condition: (mf['mm-google-shopping.condition'] || 'new').toLowerCase(), brand: p.vendor, gtin: v.barcode || '', mpn: v.sku || '', identifier_exists: v.barcode ? '' : 'no',
        google_product_category: mf['mm-google-shopping.google_product_category'] || 'Apparel & Accessories > Clothing', product_type: p.type || '',
        custom_label_0: mf['mm-google-shopping.custom_label_0'] || '', custom_label_1: mf['mm-google-shopping.custom_label_1'] || '', custom_label_2: mf['mm-google-shopping.custom_label_2'] || '', custom_label_3: mf['mm-google-shopping.custom_label_3'] || '', custom_label_4: label4(p, mf),
        color: v.options[0] || '', size: v.options[1] || 'Yksi koko', gender: 'female', age_group: 'adult', material: mf['custom.material'] || '',
        'shipping(country:service:price)': 'FI:Ilmainen toimitus:0.00 EUR',
      };
      rows.push(cols.map((c) => clean(r[c])).join('\t'));
    }
  }
  return `${rows.join('\r\n')}\r\n`;
}

module.exports = { google, googleTsv };
