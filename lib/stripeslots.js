// Stripe account profiles ("slots"): one shared engine used by the web admin (/admin/settings) and the Telegram panel.
// Storage: setting `stripe_slots` = JSON [{id,name,sk,pk,acct,lastTest}], `stripe_active` = id of the slot that takes payments.
'use strict';
const crypto = require('crypto');
const stock = require('./stock');
const checkout = require('./checkout');
const telegram = require('./telegram');

const API = '2024-06-20';
const stripeOf = (sk) => require('stripe')(sk, { apiVersion: API });
const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// both keys embed the account id: pk_live_51<ACCT>… ↔ acct_1<ACCT>…
const core = (id) => String(id || '').replace(/^acct_1/, '').replace(/^pk_(live|test)_51/, '').slice(0, 14);
const mask = (k) => (k ? `${k.slice(0, 8)}…${k.slice(-4)}` : '');
const tail = (x) => `PK …${(x.pk || '').slice(-6)} · SK …${(x.sk || '').slice(-6)}`;
const isTest = (x) => !!(x.sk && x.sk.startsWith('sk_test'));
const money = (c) => `€${(Number(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function list() { try { return JSON.parse((await stock.getSetting('stripe_slots')) || '[]'); } catch (e) { return []; } }
async function persist(slots) { await stock.setSetting('stripe_slots', JSON.stringify(slots)); await checkout.refreshKeys(true); }
async function activeId() { return (await stock.getSetting('stripe_active')) || ''; }
async function get(id) { const slots = await list(); const x = slots.find((y) => y.id === String(id || '')); return x ? { slots, x } : null; }
const label = (x) => x.name || x.id;

const balCache = new Map();
async function balance(sk) {
  if (!sk) return null;
  const c = balCache.get(sk); if (c && Date.now() - c.at < 60000) return c.v;
  try {
    const b = await Promise.race([stripeOf(sk).balance.retrieve(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    const eur = (l) => (l.find((x) => x.currency === 'eur') || l[0] || { amount: 0 }).amount;
    const v = { available: eur(b.available), pending: eur(b.pending) }; balCache.set(sk, { at: Date.now(), v }); return v;
  } catch (e) { balCache.set(sk, { at: Date.now(), v: null }); return null; }
}

// When does pending money become available? Pending balance transactions carry `available_on`; group them by day.
const relCache = new Map();
async function releases(sk) {
  if (!sk) return null;
  const c = relCache.get(sk); if (c && Date.now() - c.at < 5 * 60000) return c.v;
  try {
    const st = stripeOf(sk); const since = Math.floor(Date.now() / 1000) - 40 * 86400; const days = {}; let n = 0;
    const run = (async () => { for await (const t of st.balanceTransactions.list({ limit: 100, created: { gte: since } })) { if (++n > 500) break; if (t.status !== 'pending') continue; const d = new Date(t.available_on * 1000).toISOString().slice(0, 10); days[d] = (days[d] || 0) + t.net; } })();
    await Promise.race([run, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]);
    const v = Object.entries(days).filter(([, a]) => a !== 0).sort((a, b) => a[0].localeCompare(b[0])).map(([date, amount]) => ({ date, amount }));
    relCache.set(sk, { at: Date.now(), v }); return v;
  } catch (e) { return null; }
}
const relDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'Europe/Helsinki', weekday: 'short', day: '2-digit', month: 'short' });

// ---------------------------------------------------------------- account health (verification / restrictions)
// Reads the account's own status with its secret key: charges/payouts enabled, requirements due, deadline, capabilities.
const REQ = [
  [/^individual\.verification\.(document|additional_document)/, 'ID document of the owner'],
  [/^(representative|owners|directors|executives)\.?.*verification\.(document|additional_document)/, 'ID document of a representative/owner'],
  [/^company\.verification\.document/, 'Company registration document'],
  [/^individual\.id_number|\.id_number$/, 'Personal ID / tax number'],
  [/ssn_last_4/, 'SSN (last 4)'],
  [/^individual\.(dob|first_name|last_name|address|phone|email)|^representative\.(dob|first_name|last_name|address|phone|email)/, 'Owner personal details'],
  [/^company\.(tax_id|vat_id)/, 'Company tax / VAT ID'],
  [/^company\.(name|address|phone|registration_number|structure)/, 'Company details'],
  [/^(owners|directors|executives)_provided|^company\.(owners|directors|executives)_provided|\.(owner|director|executive|relationship)/, 'Owners / directors info'],
  [/^external_account/, 'Bank account for payouts'],
  [/^business_profile\.(url|product_description|mcc|support)/, 'Business website / description'],
  [/^tos_acceptance/, 'Accept Stripe terms'],
  [/^settings\.payments\.statement_descriptor|statement_descriptor/, 'Statement descriptor'],
  [/^business_type/, 'Business type'],
];
const reqLabel = (f) => { for (const [re, l] of REQ) if (re.test(f)) return l; return String(f).replace(/[._]/g, ' '); };
const uniq = (a) => [...new Set(a)];
const REASON = {
  'requirements.past_due': 'Verification overdue', 'requirements.pending_verification': 'Stripe is reviewing documents', 'rejected.fraud': 'Rejected – suspected fraud', 'rejected.terms_of_service': 'Rejected – terms of service',
  'rejected.listed': 'Rejected – listed', 'rejected.other': 'Rejected', 'under_review': 'Under review by Stripe', 'listed': 'Listed – under review', 'action_required.requested_capabilities': 'Capabilities need action', 'other': 'Restricted by Stripe',
};
const healthCache = new Map();
async function health(sk, force = false) {
  if (!sk) return null;
  const c = healthCache.get(sk); if (!force && c && Date.now() - c.at < 5 * 60000) return c.v;
  let v;
  try {
    const a = await Promise.race([stripeOf(sk).accounts.retrieve(), new Promise((_, rej) => setTimeout(() => rej(new Error('Stripe did not answer')), 6000))]);
    const r = a.requirements || {}, fr = a.future_requirements || {}, cap = a.capabilities || {};
    const due = uniq([...(r.past_due || []), ...(r.currently_due || [])].map(reqLabel));
    const later = uniq([...(r.eventually_due || []).filter((x) => !(r.currently_due || []).includes(x)), ...(fr.currently_due || []), ...(fr.eventually_due || [])].map(reqLabel)).filter((x) => !due.includes(x));
    const reviewing = uniq((r.pending_verification || []).map(reqLabel));
    const errors = (r.errors || []).map((e) => `${reqLabel(e.requirement)}: ${e.reason}`).slice(0, 4);
    const deadline = r.current_deadline || fr.current_deadline || null;
    const disabled = r.disabled_reason || null;
    let state = 'active';
    if (!a.charges_enabled || disabled || (r.past_due || []).length) state = 'restricted';
    else if (due.length || !a.payouts_enabled || errors.length) state = 'action';
    else if (reviewing.length) state = 'review';
    else if (later.length && deadline) state = 'soon';
    const LBL = { active: 'Active', soon: 'Info needed soon', review: 'Under review', action: 'Action required', restricted: 'Restricted' };
    const EMO = { active: '✅', soon: '🕒', review: '⏳', action: '⚠️', restricted: '⛔' };
    v = {
      ok: true, state, label: LBL[state], emoji: EMO[state], id: a.id, test: sk.startsWith('sk_test'),
      name: (a.settings && a.settings.dashboard && a.settings.dashboard.display_name) || (a.business_profile && a.business_profile.name) || a.id,
      country: a.country || '', charges: !!a.charges_enabled, payouts: !!a.payouts_enabled, details: !!a.details_submitted,
      card: cap.card_payments || 'inactive', klarna: cap.klarna_payments || 'inactive', amazon: cap.amazon_pay_payments || 'inactive',
      due, later, reviewing, errors, deadline: deadline ? new Date(deadline * 1000).toISOString() : null, reason: disabled ? (REASON[disabled] || disabled) : !a.details_submitted ? 'Account setup not finished in Stripe' : !a.charges_enabled ? 'Payments disabled by Stripe' : !a.payouts_enabled ? 'Payouts paused by Stripe' : '',
      link: `https://dashboard.stripe.com/${sk.startsWith('sk_test') ? 'test/' : ''}settings/account`, checked: new Date().toISOString(),
    };
  } catch (e) { v = { ok: false, state: 'unknown', label: 'Unknown', emoji: '❔', error: String(e.message || e).slice(0, 160), checked: new Date().toISOString() }; }
  healthCache.set(sk, { at: Date.now(), v });
  return v;
}
const dDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/Helsinki', day: '2-digit', month: 'short', year: 'numeric' }) : '');
function healthText(h, nm) { // Telegram (HTML) block
  if (!h) return '';
  if (!h.ok) return `❔ <b>${esc(nm)}</b>: status unknown – ${esc(h.error)}`;
  const capS = (s) => (s === 'active' ? '✅' : s === 'pending' ? '⏳' : '✖️');
  const lines = [`${h.emoji} <b>${esc(h.label)}</b>${h.reason ? ` · ${esc(h.reason)}` : ''}${h.deadline ? ` · ⏰ due <b>${esc(dDate(h.deadline))}</b>` : ''}`,
    `💳 Payments ${h.charges ? '✅' : '⛔'}   🏦 Payouts ${h.payouts ? '✅' : '⛔'}`,
    `Card ${capS(h.card)}  Klarna ${capS(h.klarna)}  Amazon Pay ${capS(h.amazon)}`];
  if (h.due.length) lines.push(`📝 <b>Stripe needs:</b>\n${h.due.slice(0, 6).map((x) => `   • ${esc(x)}`).join('\n')}`);
  if (h.errors.length) lines.push(`❗ ${h.errors.map(esc).join('\n❗ ')}`);
  if (h.reviewing.length) lines.push(`⏳ In review: ${esc(h.reviewing.slice(0, 4).join(', '))}`);
  if (h.later.length) lines.push(`🕒 Later: ${esc(h.later.slice(0, 4).join(', '))}`);
  return lines.join('\n');
}
// hourly cron: re-check every account, Telegram alert when a status changes
async function watchHealth() {
  const slots = await list(); const active = await activeId(); const out = [];
  for (const x of slots) {
    if (!x.sk) continue;
    const h = await health(x.sk, true); if (!h || !h.ok) continue;
    const sig = `${h.state}|${h.charges}|${h.payouts}|${h.due.join(',')}|${h.deadline || ''}`;
    const key = `stripe_health_${x.id}`; const prev = await stock.getSetting(key);
    if (prev !== sig) {
      await stock.setSetting(key, sig);
      if (prev !== null || h.state !== 'active') {
        const on = active === x.id;
        telegram.notify(`🩺 <b>Stripe status changed</b> – ${esc(label(x))}${on ? ' (ON, taking payments)' : ''}\n${esc(h.name)} · ${esc(h.id)}${h.test ? ' · test' : ''}\n\n${healthText(h, label(x))}${h.state !== 'active' ? `\n\n👉 ${esc(h.link)}` : ''}`).catch(() => {});
        stock.logActivity('settings', `Stripe ${label(x)}: ${h.label}${h.due.length ? ` – needs ${h.due.join(', ')}` : ''}`);
      }
    }
    out.push({ id: x.id, state: h.state });
  }
  return out;
}

// full picture for any UI: slots + active + balances + which keys the shop is really using right now
async function overview(withHealth = true) {
  const [slots, active] = await Promise.all([list(), activeId()]);
  const [bals, hs] = await Promise.all([Promise.all(slots.map((x) => balance(x.sk))), withHealth ? Promise.all(slots.map((x) => health(x.sk))) : slots.map(() => null)]);
  await checkout.refreshKeys().catch(() => {});
  return { slots: slots.map((x, i) => ({ ...x, on: active === x.id, has: !!(x.sk && x.pk), bal: bals[i], health: hs[i] })), active, live: checkout.KEYS };
}

async function add(name) {
  const slots = await list();
  const x = { id: crypto.randomBytes(4).toString('hex'), name: String(name || '').trim().slice(0, 40) || `Stripe ${slots.length + 1}`, sk: '', pk: '', acct: '' };
  slots.push(x); await persist(slots); stock.logActivity('settings', `Stripe slot “${x.name}” added`);
  return x;
}
async function rename(id, name) {
  const g = await get(id); if (!g) return { ok: false, error: 'Unknown Stripe slot.' };
  g.x.name = String(name || '').trim().slice(0, 40) || label(g.x); await persist(g.slots);
  stock.logActivity('settings', `Stripe slot renamed to ${g.x.name}`); return { ok: true, msg: `Renamed to “${g.x.name}”.`, slot: g.x };
}
async function remove(id) {
  const g = await get(id); if (!g) return { ok: false, error: 'Unknown Stripe slot.' };
  const L = label(g.x); const slots = g.slots.filter((y) => y !== g.x);
  if ((await activeId()) === g.x.id) await stock.setSetting('stripe_active', '');
  await persist(slots); stock.logActivity('settings', `Stripe “${L}” removed`); return { ok: true, msg: `${L} removed.` };
}
async function toggle(id, on, via = 'Admin') {
  const g = await get(id); if (!g) return { ok: false, error: 'Unknown Stripe slot.' };
  const x = g.x, L = label(x);
  if (on) { if (!x.sk || !x.pk) return { ok: false, error: `${L} has no keys yet.` }; await stock.setSetting('stripe_active', x.id); }
  else await stock.setSetting('stripe_active', '');
  await checkout.refreshKeys(true);
  stock.logActivity('settings', on ? `Stripe “${L}” switched ON (${via})` : `Stripe “${L}” switched off – Vercel env keys in use (${via})`);
  telegram.notify(on ? `✅ <b>Stripe gewechselt</b> (${esc(via)})\nJetzt aktiv: <b>${esc(L)}</b>${x.acct ? `\n${esc(x.acct)}` : ''}\n${esc(tail(x))}${isTest(x) ? '\n⚠️ Testmodus' : ''}` : `⏸ <b>Stripe „${esc(L)}“ ausgeschaltet</b> (${esc(via)})\nJetzt aktiv: Vercel-Umgebungsschlüssel`).catch(() => {});
  return { ok: true, msg: on ? `${L} is now taking payments.` : `${L} switched off – Vercel env keys in use.`, slot: x };
}

// validate + save keys; refuses live/test mismatch and keys from two different Stripe accounts
async function setKeys(id, skIn, pkIn) {
  const g = await get(id); if (!g) return { ok: false, error: 'Unknown Stripe slot.' };
  const x = g.x, sk = String(skIn || '').trim(), pk = String(pkIn || '').trim();
  if (!sk && !pk) return { ok: false, error: 'Paste at least one key.' };
  if (sk && !/^sk_(live|test)_[A-Za-z0-9]{20,}$/.test(sk)) return { ok: false, error: 'That is not a valid secret key (must start with sk_live_ or sk_test_).' };
  if (pk && !/^pk_(live|test)_[A-Za-z0-9]{20,}$/.test(pk)) return { ok: false, error: 'That is not a valid publishable key (must start with pk_live_ or pk_test_).' };
  const curSk = sk || x.sk, curPk = pk || x.pk;
  if (curSk && curPk && curSk.split('_')[1] !== curPk.split('_')[1]) return { ok: false, error: 'Mode mismatch: one key is live, the other is test. Use both from the same mode.' };
  let who = '';
  if (curSk) {
    let a;
    try { a = await stripeOf(curSk).accounts.retrieve(); } catch (e) { if (sk) return { ok: false, error: `Stripe rejected the secret key: ${e.message}` }; a = null; }
    if (a) {
      if (curPk && core(a.id) && core(curPk) !== core(a.id)) return { ok: false, error: `Keys belong to different Stripe accounts: the secret key is from ${a.id}, the publishable key is from acct_1${core(curPk)}…. Nothing saved – copy both keys from the same account.` };
      const nm = (a.settings && a.settings.dashboard && a.settings.dashboard.display_name) || (a.business_profile && a.business_profile.name) || '';
      x.acct = `${nm ? `${nm} · ` : ''}${a.id}`; who = x.acct; if (nm && (!x.name || /^Stripe \d+$/.test(x.name))) x.name = nm;
    }
  }
  if (sk) x.sk = sk; if (pk) x.pk = pk;
  await persist(g.slots);
  stock.logActivity('settings', `Stripe “${x.name}” keys updated${who ? ` · ${who}` : ''}`);
  const on = (await activeId()) === x.id;
  if (on) telegram.notify(`✅ <b>Stripe-Schlüssel aktualisiert</b>\nAktives Konto: <b>${esc(x.name)}</b>${who ? `\n${esc(who)}` : ''}\n${esc(tail(x))}`).catch(() => {});
  return { ok: true, slot: x, who, on, msg: `${x.name} saved and verified${who ? ` · ${who}` : ''}. ${on ? 'It is ON – live in ≤30 s.' : 'Switch it ON to use it.'}` };
}

// 1 € Klarna intent on this slot's keys → checks the redirect, cancels it. Nothing is charged.
async function test(id, origin, via = 'Admin') {
  const g = await get(id); if (!g) return { ok: false, error: 'Unknown Stripe slot.' };
  const x = g.x, on = (await activeId()) === x.id;
  const L = `${label(x)}${on ? ' (ON)' : ' (off)'}`;
  const remember = async (ok, msg) => { x.lastTest = { ok, msg: String(msg).slice(0, 200), at: new Date().toISOString() }; await stock.setSetting('stripe_slots', JSON.stringify(g.slots)); };
  const fail = async (why) => { await remember(false, why); telegram.notify(`❌ <b>Stripe-Test fehlgeschlagen</b> (${esc(via)}) – ${esc(L)}\n${esc(why)}\n${esc(tail(x))}`).catch(() => {}); stock.logActivity('settings', `Stripe test failed (${L}): ${why}`); return { ok: false, error: why, slot: x }; };
  if (!x.sk || !x.pk) return fail('this account has no secret/publishable key yet');
  const s = stripeOf(x.sk);
  let acct;
  try { acct = await s.accounts.retrieve(); } catch (e) { return fail(`secret key rejected: ${e.message}`); }
  if (core(acct.id) !== core(x.pk)) return fail(`publishable key is from another account (acct_1${core(x.pk)}…) than the secret key (${acct.id})`);
  if (x.sk.split('_')[1] !== x.pk.split('_')[1]) return fail('live/test mode mismatch between SK and PK');
  const cap = acct.capabilities || {};
  if (cap.card_payments !== 'active') return fail(`card payments not active on ${acct.id} (${cap.card_payments || 'missing'})`);
  if (cap.klarna_payments !== 'active') return fail(`Klarna not active on ${acct.id} (${cap.klarna_payments || 'missing'}) – enable it in Stripe → Settings → Payment methods`);
  let pi, host = '';
  try {
    pi = await s.paymentIntents.create({ amount: 100, currency: 'eur', payment_method_types: ['klarna'], confirm: true, return_url: `${origin}/checkout/danke?stripe_test=1`,
      payment_method_data: { type: 'klarna', billing_details: { email: `stripe-test@${require('./brand').domain}`, name: 'Stripe Test', address: { country: 'FI', line1: 'Testikatu 1', postal_code: '00100', city: 'Helsinki' } } },
      description: 'Kylpymaailma admin test – cancelled immediately', metadata: { source: 'admin-test' } });
    const nxt = pi.next_action && pi.next_action.redirect_to_url && pi.next_action.redirect_to_url.url;
    if (pi.status !== 'requires_action' || !nxt) throw new Error(`unexpected status ${pi.status}, no Klarna redirect`);
    host = new URL(nxt).host;
  } catch (e) { if (pi) s.paymentIntents.cancel(pi.id).catch(() => {}); return fail(`Klarna redirect failed: ${e.message}`); }
  s.paymentIntents.cancel(pi.id).catch(() => {});
  const nm = (acct.settings && acct.settings.dashboard && acct.settings.dashboard.display_name) || acct.id;
  const amazon = cap.amazon_pay_payments === 'active';
  telegram.notify(`✅ <b>Stripe funktioniert – Klarna-Redirect erfolgreich</b> (${esc(via)})\nKonto: <b>${esc(L)}</b> · ${esc(nm)} (${esc(acct.id)})${isTest(x) ? ' ⚠️ Testmodus' : ''}\nKarte ✅ · Klarna ✅ (Redirect → ${esc(host)}) · Amazon Pay ${amazon ? '✅' : '—'}\nTest-Intent ${esc(pi.id)} storniert, nichts berechnet.\n${esc(tail(x))}`).catch(() => {});
  await remember(true, `card ✓ · Klarna redirect ✓ (${host}) · ${nm} (${acct.id})`);
  stock.logActivity('settings', `Stripe test OK (${L}) – Klarna redirect via ${host}`);
  return { ok: true, slot: x, acct: acct.id, name: nm, host, amazon, msg: `${label(x)} works: ${nm} (${acct.id}) – card ✓, Klarna redirect ✓ (${host}). Test intent cancelled, nothing charged.` };
}

async function deploy(via = 'Admin') {
  const h = await stock.getSetting('deploy_hook');
  if (!h) return { ok: false, error: 'No deploy hook URL saved yet (Admin → Settings → Deploy).' };
  try {
    const r = await fetch(h, { method: 'POST' }); const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error && j.error.message ? j.error.message : `HTTP ${r.status}`);
    await stock.setSetting('last_deploy', new Date().toISOString());
    stock.logActivity('deploy', `Deployment triggered (${via})`);
    telegram.notify(`🚀 <b>Deployment gestartet</b> (${esc(via)}) – in ca. 30 s live.`).catch(() => {});
    return { ok: true, msg: 'Deployment started – the new version is live in about 20–30 seconds.' };
  } catch (e) { return { ok: false, error: `Deploy failed: ${e.message}` }; }
}

module.exports = { health, healthText, watchHealth, dDate, list, get, overview, add, rename, remove, toggle, setKeys, test, deploy, balance, releases, relDate, mask, tail, isTest, label, money, esc };
