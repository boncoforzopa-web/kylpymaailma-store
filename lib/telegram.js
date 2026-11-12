// Instant Telegram alerts (new order, withdrawal, failed payment). Bot token + chat id are set in /admin/settings.
'use strict';
const stock = require('./stock');

async function creds() {
  const token = (await stock.getSetting('telegram_token')) || process.env.TELEGRAM_BOT_TOKEN;
  const chat = (await stock.getSetting('telegram_chat')) || process.env.TELEGRAM_CHAT_ID;
  return token && chat ? { token, chat } : null;
}
async function notify(text) {
  const c = await creds().catch(() => null);
  if (!c) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${c.token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: c.chat, text, parse_mode: 'HTML', disable_web_page_preview: true }) });
    return r.ok;
  } catch (e) { return false; }
}
const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const euro = (c) => `${(Number(c || 0) / 100).toFixed(2).replace('.', ',')} €`;

async function newOrder(order, adminUrl) {
  const lines = order.lines.map((l) => `• ${l.quantity}× ${esc(l.title)}${l.preorder ? ' (Vorbestellung)' : ''}${l.gift ? ' 🎁 (gratis)' : ''}`).join('\n');
  return notify(`🟢 <b>Neue Bestellung ${esc(order.number)}</b> · ${euro(order.total)}\n${esc(order.name)} · ${esc(order.address && order.address.city)}\n${lines}\n${esc(order.paymentLabel)}\n<a href="${adminUrl}">Bestellung öffnen</a>`);
}

module.exports = { notify, newOrder, creds };
