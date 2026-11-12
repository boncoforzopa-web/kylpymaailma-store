// One place for everything that is specific to this shop (name, domain, country, VAT, URLs).
// Company details shown on the legal pages live in theme/config/settings_data.json.
'use strict';
const fs = require('fs');
const path = require('path');

let settings = {};
try {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'theme', 'config', 'settings_data.json'), 'utf8').replace(/^﻿/, '').replace(/\/\*[\s\S]*?\*\//g, '');
  settings = JSON.parse(raw).current || {};
} catch (e) { settings = {}; }

const domain = process.env.SHOP_DOMAIN || 'kylpymaailma.com';
const email = process.env.MAIL_TO || settings.contact_email || `asiakaspalvelu@${domain}`;

module.exports = {
  name: 'Kylpymaailma',
  domain,
  site: `https://${domain}`,
  email,
  mailFrom: process.env.MAIL_FROM || `Kylpymaailma <${email}>`,
  legalName: settings.legal_name || '',
  address: String(settings.business_address || '').split('\n').map((s) => s.trim()).filter(Boolean),
  country: 'FI',
  countryName: 'Suomi',
  locale: 'fi-FI',
  tz: 'Europe/Helsinki',
  vatRate: 0.255, // Finnish general VAT rate
  vatLabel: '25,5 %',
  deliveryDays: [2, 5], // estimated delivery window in business days (domestic, shipped from Finland)
  statementSuffix: 'KYLPYMAAILMA',
  // storefront paths
  paths: {
    terms: '/pages/toimitusehdot', withdrawal: '/pages/peruutus-ja-palautus', withdrawalForm: '/pages/peruuttamislomake',
    privacy: '/pages/tietosuoja', imprint: '/pages/yritystiedot', shipping: '/pages/toimitus-ja-maksu',
    contact: '/pages/ota-yhteytta', faq: '/pages/ukk', about: '/pages/meista',
    orderStatus: '/tilaus', thanks: '/checkout/kiitos',
  },
};
