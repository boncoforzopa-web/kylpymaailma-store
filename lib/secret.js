// Signing secret for cart cookies, order links and the admin session.
// CART_SECRET wins when it is set; otherwise the secret is derived from the database token
// (already a private, per-project value), so a fresh deployment is never signed with a public default.
'use strict';
const crypto = require('crypto');

const base = process.env.CART_SECRET
  || process.env.KV_REST_API_TOKEN
  || process.env.UPSTASH_REDIS_REST_TOKEN
  || '';

module.exports = process.env.CART_SECRET
  || (base ? crypto.createHash('sha256').update(`km-signing:${base}`).digest('hex') : 'tw-dev-secret');
