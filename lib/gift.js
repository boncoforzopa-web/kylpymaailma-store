// Free gift with purchase: from a cart value of €110 the customer gets the
// Ultra PRO Scorching Summit 9-Pocket PRO-Binder for free (€0). The binder is not
// a product of the shop – it can't be bought, isn't in the Google feed and has no stock.
'use strict';

const THRESHOLD = Number(process.env.GIFT_THRESHOLD_CENTS) || 0; // 0 = no free gift (default)
const ENABLED = THRESHOLD > 0;
const ID = 'gift';
const TITLE = process.env.GIFT_TITLE || 'Lahja';
const IMAGE = process.env.GIFT_IMAGE || '';
const IMAGE_LARGE = IMAGE;

const isGift = (l) => !!l && (l.gift === true || String(l.id) === ID);

// What the theme needs: unlocked or not, and how much is still missing.
function state(totalCents) {
  const total = Number(totalCents) || 0;
  const unlocked = ENABLED && total >= THRESHOLD;
  return {
    enabled: ENABLED, unlocked, threshold: THRESHOLD, remaining: unlocked ? 0 : THRESHOLD - total,
    progress: ENABLED ? Math.min(100, Math.floor((total / THRESHOLD) * 100)) : 0,
    title: TITLE, image: IMAGE, image_large: IMAGE_LARGE, price: 0,
  };
}

// Order / cart-reminder line (same shape as checkout.cartLines()).
function line() {
  return { id: ID, gift: true, quantity: 1, title: TITLE, price: 0, handle: '', image: IMAGE, preorder: false, release: '', diffTax: false };
}

// Append the gift line when the (paid) lines reach the threshold. Idempotent.
function withGift(lines, totalCents) {
  const paid = (lines || []).filter((l) => !isGift(l));
  return state(totalCents).unlocked && paid.length ? [...paid, line()] : paid;
}

module.exports = { THRESHOLD, ID, TITLE, IMAGE, IMAGE_LARGE, isGift, state, line, withGift };
