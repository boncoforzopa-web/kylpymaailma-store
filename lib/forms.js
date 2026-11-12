// Contact form, newsletter (double opt-in) and online withdrawal ("Vertrag hier widerrufen").
'use strict';
const { send, OWNER } = require('./mail');
const B = require('./brand');
const T = require('./emails');
const stock = require('./stock');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function back(req, url, id, ok, extra = '') {
  let ref = B.paths.contact;
  try { const r = new URL(req.headers.referer || ''); if (r.host === url.host) ref = r.pathname; } catch (e) { /* default */ }
  const flag = id === 'tw-newsletter-form' ? 'customer_posted=true' : 'contact_posted=true';
  return `${ref}?${ok ? flag : 'form_error=1'}${extra}${id ? `#${id}` : ''}`;
}
function redirect(res, to) { res.statusCode = 303; res.setHeader('Location', to); res.setHeader('Cache-Control', 'no-store'); res.end(); }

async function handle(req, res, url, body) {
  const type = body.form_type;
  const c = body.contact || {};
  const email = String(c.email || '').trim().toLowerCase();
  const referer = req.headers.referer || '';
  const isWithdrawal = referer.includes('peruuttamislomake') || c.Asia !== undefined;
  const hashId = type === 'customer' ? 'tw-newsletter-form' : isWithdrawal ? 'tw-withdrawal-form' : 'tw-contact-form';
  if (c.website || !EMAIL_RE.test(email)) return redirect(res, back(req, url, hashId, false));
  const origin = url.origin;

  // ---- newsletter: double opt-in
  if (type === 'customer') {
    await sendNewsletterConfirm(email, origin);
    return redirect(res, back(req, url, hashId, true));
  }

  const now = new Date().toISOString();
  const fields = { Nimi: c.name, 'Sähköposti': email };
  for (const [k, v] of Object.entries(c)) if (!['name', 'email', 'body', 'website'].includes(k)) fields[k] = v;
  if (c.body) fields.Viesti = c.body;

  if (isWithdrawal) {
    await stock.saveMessage('withdrawals', { ...fields }).catch(() => {});
    stock.logActivity('withdrawal', `Withdrawal received${c.Tilausnumero ? ` for order ${c.Tilausnumero}` : ''}`, { who: email, href: '/admin/messages' }).catch(() => {});
    const o = T.ownerContact(fields, origin, 'Peruutusilmoitus');
    await send({ to: OWNER, replyTo: email, subject: `PERUUTUSILMOITUS ${c.Tilausnumero ? `tilaus ${c.Tilausnumero} ` : ''}– ${email}`, html: o.html });
    // legally required: confirm receipt to the customer without delay
    const r = T.withdrawalReceipt(fields, origin, now);
    await send({ to: email, subject: r.subject, html: r.html, tags: [{ name: 'type', value: 'withdrawal' }] });
  } else {
    await stock.saveMessage('messages', { ...fields }).catch(() => {});
    stock.logActivity('message', `Contact message${c.Aihe ? ` · ${c.Aihe}` : ''}`, { who: email, href: '/admin/messages' }).catch(() => {});
    const o = T.ownerContact(fields, origin, `Yhteydenotto${c.Aihe ? ` · ${c.Aihe}` : ''}`);
    await send({ to: OWNER, replyTo: email, subject: o.subject, html: o.html });
    const a = T.contactAutoReply({ name: c.name, body: c.body }, origin);
    await send({ to: email, subject: a.subject, html: a.html, tags: [{ name: 'type', value: 'contact_autoreply' }] });
  }
  return redirect(res, back(req, url, hashId, true));
}

async function sendNewsletterConfirm(email, origin) {
  const t = stock.sign(`nl:${email}`);
  const confirmUrl = `${origin}/newsletter/confirm?e=${encodeURIComponent(email)}&t=${t}`;
  const m = T.newsletterConfirm(confirmUrl, origin);
  await send({ to: email, subject: m.subject, html: m.html, tags: [{ name: 'type', value: 'newsletter_confirm' }] });
  await stock.saveMessage('newsletter_pending', { email }).catch(() => {});
}

async function newsletterConfirm(req, res, url) {
  const email = String(url.searchParams.get('e') || '').toLowerCase();
  if (!EMAIL_RE.test(email) || !stock.verify(`nl:${email}`, url.searchParams.get('t'))) return redirect(res, '/?newsletter=invalid');
  await stock.subscribe(email);
  stock.logActivity('newsletter', 'Newsletter subscription confirmed', { who: email, href: '/admin/newsletter' }).catch(() => {});
  const unsub = `${url.origin}/newsletter/unsubscribe?e=${encodeURIComponent(email)}&t=${stock.sign(`unsub:${email}`)}`;
  const w = T.newsletterWelcome(url.origin, unsub);
  await send({ to: email, subject: w.subject, html: w.html, tags: [{ name: 'type', value: 'newsletter_welcome' }] });
  await send({ to: OWNER, subject: `Uusi uutiskirjeen tilaaja: ${email}`, html: T.ownerContact({ 'Sähköposti': email, Tila: 'vahvistettu (double opt-in)' }, url.origin, 'Uutiskirje').html });
  return redirect(res, '/?customer_posted=true#tw-newsletter-form');
}
async function newsletterUnsubscribe(req, res, url) {
  // GET from the mail link, POST = one-click unsubscribe from the mail client
  const email = String(url.searchParams.get('e') || '').toLowerCase();
  if (stock.verify(`unsub:${email}`, url.searchParams.get('t'))) await stock.unsubscribe(email);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tilaus peruttu – Kylpymaailma</title><body style="font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;color:#17211F"><h1>Uutiskirjeen tilaus on peruttu.</h1><p>Emme lähetä sinulle enää uutiskirjeitä.</p><p><a href="/" style="color:#1E3A34">Takaisin kauppaan</a></p></body>`);
}

module.exports = { handle, newsletterConfirm, newsletterUnsubscribe, sendNewsletterConfirm };
