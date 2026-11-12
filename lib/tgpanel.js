// Telegram control panel: the Stripe-accounts card of /admin/settings as a bot with inline buttons.
// Webhook: POST /tg/webhook (secret header checked). Settings: tg_panel_token, tg_panel_admins, tg_panel_secret.
'use strict';
const crypto = require('crypto');
const stock = require('./stock');
const S = require('./stripeslots');

const esc = S.esc;
const TZ = 'Europe/Helsinki';
const dt = (d) => (d ? new Date(d).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
const STATE_TTL = 10 * 60 * 1000;

async function cfg() {
  const s = await stock.allSettings();
  const token = (s.tg_panel_token || '').trim();
  const admins = String(s.tg_panel_admins || '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  if (s.telegram_chat && /^\d+$/.test(String(s.telegram_chat).trim())) admins.push(String(s.telegram_chat).trim()); // the notifications chat is the owner
  return { token, admins: [...new Set(admins)], secret: s.tg_panel_secret || '', username: s.tg_panel_user || '' };
}
async function api(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.description || `Telegram ${method} failed (${r.status})`);
  return j.result;
}

// ---------------------------------------------------------------- connect / disconnect (called from the admin settings page)
async function connect(origin) {
  const c = await cfg();
  if (!c.token) return { ok: false, error: 'Paste the bot token first.' };
  let me;
  try { me = await api(c.token, 'getMe'); } catch (e) { return { ok: false, error: `Telegram rejected the token: ${e.message}` }; }
  const secret = c.secret || crypto.randomBytes(16).toString('hex');
  await stock.setSetting('tg_panel_secret', secret);
  await stock.setSetting('tg_panel_user', me.username || '');
  try {
    await api(c.token, 'setWebhook', { url: `${origin}/tg/webhook`, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
    await api(c.token, 'setMyCommands', { commands: [{ command: 'panel', description: 'Open the Stripe panel' }, { command: 'stats', description: 'Today’s orders & visitors' }, { command: 'health', description: 'Stripe account health (verification, restrictions)' }, { command: 'deploy', description: 'Redeploy the shop' }, { command: 'id', description: 'Show my Telegram ID' }, { command: 'cancel', description: 'Cancel the current input' }] }).catch(() => {});
  } catch (e) { return { ok: false, error: `Could not set the webhook: ${e.message}` }; }
  stock.logActivity('settings', `Telegram panel connected (@${me.username})`);
  return { ok: true, username: me.username, msg: `Connected: @${me.username}. Open the bot in Telegram and send /panel.` };
}
async function disconnect() {
  const c = await cfg();
  if (c.token) await api(c.token, 'deleteWebhook', { drop_pending_updates: true }).catch(() => {});
  await stock.setSetting('tg_panel_user', '');
  return { ok: true, msg: 'Telegram panel disconnected (webhook removed).' };
}
async function status() {
  const c = await cfg();
  if (!c.token) return { connected: false, text: 'No bot token yet.' };
  try {
    const w = await api(c.token, 'getWebhookInfo');
    const ok = !!(w.url && w.url.endsWith('/tg/webhook'));
    return { connected: ok, username: c.username, text: ok ? `Connected · @${c.username}${w.pending_update_count ? ` · ${w.pending_update_count} pending` : ''}${w.last_error_message ? ` · last error: ${w.last_error_message}` : ''}` : 'Token saved, webhook not set – click “Connect”.' };
  } catch (e) { return { connected: false, text: `Token error: ${e.message}` }; }
}

// ---------------------------------------------------------------- per-user input state (keys / rename / add)
const stateKey = (uid) => `tg_state_${uid}`;
async function getState(uid) { try { const s = JSON.parse((await stock.getSetting(stateKey(uid))) || 'null'); return s && s.until > Date.now() ? s : null; } catch (e) { return null; } }
async function setState(uid, st) { await stock.setSetting(stateKey(uid), st ? JSON.stringify({ ...st, until: Date.now() + STATE_TTL }) : ''); }

// ---------------------------------------------------------------- views
const btn = (text, data) => ({ text, callback_data: data });
const money = S.money;

const eur = (c) => `${(Number(c || 0) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const SP = ' '; // em space – keeps button rows aligned
// Buttons-only panel: one-line header, every profile = 2 rows (name · available · pending · on/off · test).
async function mainView() {
  const o = await S.overview();
  const live = o.live || {};
  const text = live.slot === 'env' || !live.slot ? '🏦 <b>KYLPYMAAILMA · STRIPE</b>\n⚙️ Vercel env keys' : `🏦 <b>KYLPYMAAILMA · STRIPE</b>\n⚡ <b>${esc(live.slotName || live.slot)}</b>  ·  🔑 …${esc((live.pk || '').slice(-4))} / …${esc((live.sk || '').slice(-4))}`;
  const kb = [];
  for (const x of o.slots) {
    const flag = x.on ? '🟢' : x.has ? '🔴' : '⚫';
    const tested = x.lastTest ? (x.lastTest.ok ? '  🛡✅' : '  🛡❌') : '';
    const hz = x.health ? (x.health.ok ? `  ${x.health.emoji} ${x.health.state === 'active' ? '' : x.health.label}`.replace(/\s+$/, '') : '  ❔') : '';
    kb.push([btn(`${flag}  ${(x.name || x.id).toUpperCase()}${S.isTest(x) ? '  🧪TEST' : ''}${hz}${tested}`, `s:${x.id}`)]);
    kb.push([
      btn(x.bal ? `💶 ${eur(x.bal.available)}` : '💶 —', `b:${x.id}`),
      btn(x.bal ? `🕒 ${eur(x.bal.pending)}` : '🕒 —', `b:${x.id}`),
      x.on ? btn('⏻ OFF', `off:${x.id}`) : btn('⚡ ON', `on:${x.id}`),
      btn('🛡', `t:${x.id}`),
    ]);
  }
  if (!o.slots.length) kb.push([btn('⚫ No Stripe accounts yet', 'noop')]);
  kb.push([btn('➕ Add', 'add'), btn('🚀 Deploy', 'dep'), btn('📈 Stats', 'stats')]);
  kb.push([btn('🩺 Health of all accounts', 'hall'), btn('♻️', 'm')]);
  return { text, reply_markup: { inline_keyboard: kb } };
}
async function slotView(id, note) {
  const g = await S.get(id); if (!g) return mainView();
  const x = g.x, on = (await stock.getSetting('stripe_active')) === x.id, has = !!(x.sk && x.pk);
  const [bal, h] = has ? await Promise.all([S.balance(x.sk), S.health(x.sk, !!(note && /re-checked/.test(note)))]) : [null, null];
  const text = `${on ? '🟢' : has ? '🔴' : '⚫'} <b>${esc((x.name || x.id).toUpperCase())}</b>${on ? '  ⚡ LIVE' : ''}${S.isTest(x) ? '  🧪 TEST MODE' : ''}${x.acct ? `\n🏦 <code>${esc(x.acct)}</code>` : ''}${has ? `\n🔑 <code>${esc(S.mask(x.pk))}</code>\n🔐 <code>${esc(S.mask(x.sk))}</code>` : '\n🔑 no keys yet'}${x.lastTest ? `\n🛡 ${x.lastTest.ok ? '✅' : '❌'} ${esc(x.lastTest.msg)} · ${dt(x.lastTest.at)}` : ''}${h ? `\n\n🩺 <b>ACCOUNT HEALTH</b>\n${S.healthText(h, x.name || x.id)}${h.ok && h.state !== 'active' ? `\n👉 <a href="${esc(h.link)}">Fix in Stripe</a>` : ''}\n<i>checked ${esc(dt(h.checked))}</i>` : ''}${note ? `\n\n${note}` : ''}`;
  const kb = [
    [btn(bal ? `💶 ${eur(bal.available)}` : '💶 —', `b:${x.id}`), btn(bal ? `🕒 ${eur(bal.pending)}` : '🕒 —', `b:${x.id}`)],
    [on ? btn('⏻ Switch OFF', `off:${x.id}`) : btn('⚡ Switch ON', `on:${x.id}`), btn('🛡 Test Klarna', `t:${x.id}`)],
    [btn('🩺 Re-check health', `h:${x.id}`)],
    [btn('🔑 Keys', `k:${x.id}`), btn('🏷 Rename', `r:${x.id}`), btn('🗑 Remove', `d:${x.id}`)],
    [btn('◀️ Back', 'm')],
  ];
  return { text, reply_markup: { inline_keyboard: kb } };
}
async function healthAllView() {
  const o = await S.overview();
  const blocks = o.slots.filter((x) => x.has).map((x) => `${x.on ? '🟢' : '🔴'} <b>${esc((x.name || x.id).toUpperCase())}</b>${x.health && x.health.ok ? ` · ${esc(x.health.name)}` : ''}\n${S.healthText(x.health, x.name || x.id)}`);
  const bad = o.slots.filter((x) => x.health && x.health.ok && x.health.state !== 'active').length;
  const text = `🩺 <b>STRIPE ACCOUNT HEALTH</b>\n${bad ? `⚠️ ${bad} account${bad === 1 ? ' needs' : 's need'} attention` : '✅ All accounts in good standing'}\n\n${blocks.join('\n\n━━━━━━━━━━━━\n\n') || 'No accounts with keys yet.'}`;
  return { text: text.slice(0, 4000), reply_markup: { inline_keyboard: [[btn('♻️ Refresh', 'hall'), btn('◀️ Back', 'm')]] } };
}
async function statsView() {
  const [orders, visits, live] = await Promise.all([stock.listOrders(600), stock.visitStats(30), stock.liveStats(5).catch(() => [])]);
  const good = (o) => o.status !== 'pending' && o.status !== 'cancelled' && o.status !== 'refunded';
  const today = stock.day(new Date());
  const dayOf = (o) => stock.day(new Date(o.paidAt || o.created));
  const tOrders = orders.filter((o) => good(o) && dayOf(o) === today);
  const since = Date.now() - 30 * 864e5; const o30 = orders.filter((o) => good(o) && new Date(o.paidAt || o.created).getTime() > since);
  const rev = (l) => l.reduce((a, o) => a + (o.total || 0) - (o.refundedCents || 0), 0);
  const v = (l) => l.reduce((a, d) => a + (d.views || 0), 0);
  const liveNow = (live || []).slice(-3).reduce((a, m) => a + (m.views || 0), 0);
  const pend = orders.filter((o) => o.status === 'paid').length;
  const text = `📈 <b>TODAY · ${dt(new Date()).slice(0, 6)}</b>\n🛍 ${tOrders.length} orders  ·  💶 <b>${money(rev(tOrders))}</b>\n👁 ${v(visits.slice(-1))} views  ·  🟢 ${liveNow} live now\n\n📅 <b>LAST 30 DAYS</b>\n🛍 ${o30.length} orders  ·  💶 <b>${money(rev(o30))}</b>\n👁 ${v(visits)} views  ·  🎯 ${v(visits) ? ((o30.length / v(visits)) * 100).toFixed(2) : '0.00'}% conv.\n📦 ${pend} to ship`;
  return { text, reply_markup: { inline_keyboard: [[btn('♻️ Refresh', 'stats'), btn('◀️ Back', 'm')]] } };
}

// ---------------------------------------------------------------- update handling
async function handleUpdate(u, c, origin) {
  const msg = u.message, cq = u.callback_query;
  const from = (cq && cq.from) || (msg && msg.from); if (!from) return;
  const chatId = (cq && cq.message && cq.message.chat.id) || (msg && msg.chat.id);
  const uid = String(from.id);
  const send = (v) => api(c.token, 'sendMessage', { chat_id: chatId, parse_mode: 'HTML', disable_web_page_preview: true, ...v });
  const edit = async (v) => { if (!cq) return send(v); try { return await api(c.token, 'editMessageText', { chat_id: chatId, message_id: cq.message.message_id, parse_mode: 'HTML', disable_web_page_preview: true, ...v }); } catch (e) { if (!/not modified/i.test(e.message)) return send(v); } };
  const ack = (text, alert) => (cq ? api(c.token, 'answerCallbackQuery', { callback_query_id: cq.id, text, show_alert: !!alert }).catch(() => {}) : Promise.resolve());

  if (!c.admins.includes(uid)) {
    await ack();
    return send({ text: `🔒 This panel is private.\nYour Telegram ID is <code>${esc(uid)}</code> – add it in the shop admin → Settings → Telegram panel → “Allowed user IDs”.` });
  }
  const via = `Telegram · ${from.first_name || ''}${from.username ? ` @${from.username}` : ''}`.trim();

  if (msg && typeof msg.text === 'string') {
    const t = msg.text.trim();
    if (/^\/(start|panel|stripe)\b/.test(t)) { await setState(uid, null); return send(await mainView()); }
    if (/^\/stats\b/.test(t)) return send(await statsView());
    if (/^\/health\b/.test(t)) return send(await healthAllView());
    if (/^\/id\b/.test(t)) return send({ text: `Your Telegram ID: <code>${esc(uid)}</code>` });
    if (/^\/cancel\b/.test(t)) { await setState(uid, null); return send({ text: 'Cancelled.', reply_markup: { inline_keyboard: [[btn('🏦 Open panel', 'm')]] } }); }
    if (/^\/deploy\b/.test(t)) { const r = await S.deploy(via); return send({ text: r.ok ? `🚀 ${esc(r.msg)}` : `❌ ${esc(r.error)}`, reply_markup: { inline_keyboard: [[btn('🏦 Open panel', 'm')]] } }); }
    const st = await getState(uid);
    if (!st) return send({ text: 'Send /panel to open the Stripe panel.', reply_markup: { inline_keyboard: [[btn('🏦 Open panel', 'm')]] } });
    if (st.mode === 'keys') {
      const sk = (t.match(/sk_(?:live|test)_[A-Za-z0-9]+/) || [])[0], pk = (t.match(/pk_(?:live|test)_[A-Za-z0-9]+/) || [])[0];
      api(c.token, 'deleteMessage', { chat_id: chatId, message_id: msg.message_id }).catch(() => {}); // keep the secret out of the chat history
      if (!sk && !pk) return send({ text: '❌ I could not find a key in that message. Send the keys like:\n<code>sk_live_… pk_live_…</code>\n(or /cancel)' });
      const r = await S.setKeys(st.slot, sk, pk);
      if (!r.ok) return send({ text: `❌ ${esc(r.error)}\n\nSend both keys again, or /cancel.` });
      await setState(uid, null);
      return send(await slotView(st.slot, `✅ ${esc(r.msg)} <i>(your key message was deleted)</i>`));
    }
    if (st.mode === 'rename') { await setState(uid, null); const r = await S.rename(st.slot, t); return send(await slotView(st.slot, r.ok ? `✅ ${esc(r.msg)}` : `❌ ${esc(r.error)}`)); }
    if (st.mode === 'add') { await setState(uid, null); const x = await S.add(t); await setState(uid, { mode: 'keys', slot: x.id }); return send({ text: `✅ “${esc(x.name)}” created.\n\nNow send its keys in one message:\n<code>sk_live_… pk_live_…</code>\n\nBoth must be from the same Stripe account – I verify that before saving. (/cancel to skip)` }); }
    await setState(uid, null);
    return send(await mainView());
  }

  if (cq) {
    const [act, id] = String(cq.data || '').split(':');
    switch (act) {
      case 'm': await ack(); return edit(await mainView());
      case 's': await ack(); return edit(await slotView(id));
      case 'stats': await ack(); return edit(await statsView());
      case 'hall': await ack('Checking all Stripe accounts…'); return edit(await healthAllView());
      case 'noop': return ack();
      case 'h': { await ack('Checking Stripe account…'); return edit(await slotView(id, '🩺 Health re-checked just now.')); }
      case 'b': { const g = await S.get(id); const [bal, rel] = g && g.x.sk ? await Promise.all([S.balance(g.x.sk), S.releases(g.x.sk)]) : [null, null]; const rl = (rel || []).filter((r) => r.amount > 0).slice(0, 3); return ack(bal ? `🏦 ${g.x.name}\n💶 Available: ${eur(bal.available)}\n🕒 Pending: ${eur(bal.pending)}${rl.length ? `\n${rl.map((r) => `🗓 ${eur(r.amount)} → ${S.relDate(r.date)}`).join('\n')}` : ''}\n━━━━━━━━━━━━\n💰 Total: ${eur(bal.available + bal.pending)}` : 'Balance unavailable (no keys or Stripe did not answer).', true); }
      case 'on': case 'off': { const r = await S.toggle(id, act === 'on', via); await ack(r.ok ? r.msg : r.error, !r.ok); return edit(await slotView(id, r.ok ? `✅ ${esc(r.msg)}` : `❌ ${esc(r.error)}`)); }
      case 't': { await ack('Testing Klarna redirect… (≈5 s)'); const r = await S.test(id, origin, via); return edit(await slotView(id, r.ok ? `✅ ${esc(r.msg)}` : `❌ Test failed: ${esc(r.error)}`)); }
      case 'k': { await ack(); await setState(uid, { mode: 'keys', slot: id }); const g = await S.get(id); return send({ text: `🔑 Send the keys for <b>${esc(g ? g.x.name : id)}</b> in one message:\n<code>sk_live_… pk_live_…</code>\n\nYou may send only one of them to replace just that key. Both must belong to the same Stripe account – I check that before saving, and I delete your message afterwards. (/cancel)` }); }
      case 'r': { await ack(); await setState(uid, { mode: 'rename', slot: id }); return send({ text: '✏️ Send the new name (max 40 characters). (/cancel)' }); }
      case 'add': { await ack(); await setState(uid, { mode: 'add' }); return send({ text: '➕ Send a name for the new Stripe account (e.g. <i>Main</i>, <i>Backup</i>). (/cancel)' }); }
      case 'd': { await ack(); const g = await S.get(id); return edit({ text: `🗑 Remove <b>${esc(g ? g.x.name : id)}</b> from the panel?${g && (await stock.getSetting('stripe_active')) === id ? '\n\n⚠️ It is currently ON – the shop will fall back to the Vercel environment keys.' : ''}`, reply_markup: { inline_keyboard: [[btn('🗑 Yes, remove', `dd:${id}`), btn('◀️ Cancel', `s:${id}`)]] } }); }
      case 'dd': { const r = await S.remove(id); await ack(r.ok ? r.msg : r.error, !r.ok); const v = await mainView(); return edit({ ...v, text: `${r.ok ? '✅' : '❌'} ${esc(r.ok ? r.msg : r.error)}\n\n${v.text}` }); }
      case 'dep': { await ack('Deploying…'); const r = await S.deploy(via); const v = await mainView(); return edit({ ...v, text: `${r.ok ? '🚀' : '❌'} ${esc(r.ok ? r.msg : r.error)}\n\n${v.text}` }); }
      default: await ack(); return edit(await mainView());
    }
  }
}

// POST /tg/webhook
async function webhook(req, res, url, body) {
  const done = (code, o) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o || { ok: true })); };
  const c = await cfg();
  if (!c.token || !c.secret) return done(404, { ok: false });
  if (String(req.headers['x-telegram-bot-api-secret-token'] || '') !== c.secret) return done(403, { ok: false });
  try { await stock.load(); await handleUpdate(body || {}, c, url.origin); } catch (e) { console.error('tgpanel', e); }
  return done(200);
}

module.exports = { webhook, connect, disconnect, status, cfg };
