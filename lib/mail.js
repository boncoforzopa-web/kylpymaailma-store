// E-mail via Resend (RESEND_API_KEY). Without a key, mails are only logged.
'use strict';
const B = require('./brand');
const FROM = B.mailFrom;
const OWNER = B.email;

// readable plain-text version of an HTML mail (better spam score, works in every client)
function toText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<div style="display:none[^>]*>[\s\S]*?<\/div>/i, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, txt) => { const t = txt.replace(/<[^>]+>/g, '').trim(); return t && !/^https?:/.test(t) ? `${t} (${href})` : href; })
    .replace(/<(br|\/p|\/h[1-6]|\/tr|\/li|\/div)[^>]*>/gi, '\n').replace(/<\/td>/gi, '  ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#847;|&zwnj;/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{3,}/g, '  ').trim();
}

async function send({ to, subject, html, text, replyTo, tags, headers, attachments }) {
  if (!process.env.RESEND_API_KEY) { console.warn('[mail] RESEND_API_KEY missing – not sent:', subject, '->', to); return false; }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: Array.isArray(to) ? to : [to], subject, html, text: text || toText(html), reply_to: replyTo || OWNER, tags, headers, attachments }),
  });
  if (!r.ok) { console.error('[mail] failed', r.status, await r.text()); return false; }
  return true;
}
const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fs = require('fs');
const path = require('path');
// Optional PDF with the terms + withdrawal instructions, attached to the order confirmation.
// Put it at data/toimitusehdot.pdf; without the file nothing is attached (the mail links to the pages instead).
let legalPdf = null;
function legalAttachment() {
  if (!legalPdf) { try { legalPdf = fs.readFileSync(path.join(__dirname, '..', 'data', 'toimitusehdot.pdf')).toString('base64'); } catch (e) { return []; } }
  return [{ filename: 'Kylpymaailma-toimitusehdot.pdf', content: legalPdf }];
}

module.exports = { send, esc, OWNER, toText, legalAttachment };
