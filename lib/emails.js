// Branded transactional e-mails (Finnish). Table-based, inline styles: Gmail, Apple Mail, Outlook, mobile.
'use strict';
const B = require('./brand');

const C = { accent: '#1E3A34', soft: '#E9EEE8', ink: '#17211F', text: '#33403D', muted: '#6C7774', line: '#DCE1DC', bg: '#F2F4F1', card: '#FFFFFF', green: '#2F6B4F' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const HEAD = "Georgia,'Times New Roman',serif";

const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const euro = (c) => `${(Number(c || 0) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
const date = (d) => new Date(d).toLocaleDateString(B.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: B.tz });
const vatOf = (total) => Math.round(total - total / (1 + B.vatRate));

function button(href, label, { light = false } = {}) {
  const bg = light ? C.soft : C.accent; const fg = light ? C.ink : '#FFFFFF';
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0"><tr><td style="border-radius:6px;background:${bg}" bgcolor="${bg}">
<a href="${esc(href)}" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:${fg};text-decoration:none;border-radius:6px">${label}</a></td></tr></table>`;
}
function pill(text) {
  return `<span style="display:inline-block;padding:5px 11px;border-radius:999px;background:${C.soft};color:${C.accent};font-family:${FONT};font-size:12.5px;font-weight:600">${text}</span>`;
}
const h1 = (t) => `<h1 style="margin:0 0 12px;font-family:${HEAD};font-size:27px;line-height:1.2;font-weight:400;color:${C.ink}">${t}</h1>`;
const p = (t, style = '') => `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.text};${style}">${t}</p>`;
const small = (t) => `<p style="margin:0 0 8px;font-family:${FONT};font-size:12.5px;line-height:1.55;color:${C.muted}">${t}</p>`;
const label = (t) => `<p style="margin:0 0 6px;font-family:${FONT};font-size:12.5px;font-weight:600;color:${C.muted}">${t}</p>`;
const divider = () => `<tr><td class="px" style="padding:0 32px"><div style="height:1px;line-height:1px;background:${C.line}">&nbsp;</div></td></tr>`;
const section = (html, pad = '28px 32px') => `<tr><td class="px" style="padding:${pad}">${html}</td></tr>`;

function layout({ origin, preheader, body, footerNote = '' }) {
  const company = [B.legalName || B.name, ...B.address].map(esc).join(' · ');
  const host = origin.replace(/^https?:\/\//, '');
  return `<!doctype html><html lang="fi" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${esc(B.name)}</title>
<style>
@media (max-width:620px){.wrap{width:100%!important}.px{padding-left:20px!important;padding-right:20px!important}.stack{display:block!important;width:100%!important}.hide-sm{display:none!important}}
a{color:${C.accent}}
</style></head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${C.bg}" style="background:${C.bg}"><tr><td align="center" style="padding:28px 12px 40px">
<table role="presentation" class="wrap" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px">
  <tr><td align="center" bgcolor="${C.accent}" style="background:${C.accent};border-radius:10px 10px 0 0;padding:26px 24px">
    <a href="${origin}" style="text-decoration:none;font-family:${HEAD};font-size:26px;line-height:1;color:#FFFFFF;letter-spacing:.2px">${esc(B.name)}</a>
  </td></tr>
  <tr><td bgcolor="${C.card}" style="background:${C.card};border-radius:0 0 10px 10px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${body}</table>
  </td></tr>
  <tr><td align="center" style="padding:24px 24px 0">
    ${footerNote ? `<p style="margin:0 0 14px;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted}">${footerNote}</p>` : ''}
    <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.7;color:${C.muted}">${company}<br>
    <a href="mailto:${esc(B.email)}" style="color:${C.muted}">${esc(B.email)}</a> · <a href="${origin}" style="color:${C.muted}">${esc(host)}</a><br>
    <a href="${origin}${B.paths.terms}" style="color:${C.muted}">Toimitusehdot</a> · <a href="${origin}${B.paths.withdrawal}" style="color:${C.muted}">Peruutus ja palautus</a> · <a href="${origin}${B.paths.privacy}" style="color:${C.muted}">Tietosuoja</a> · <a href="${origin}${B.paths.imprint}" style="color:${C.muted}">Yritystiedot</a></p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

// ---------- shared blocks ----------
function itemsTable(order, origin) {
  const rows = order.lines.map((l) => `
<tr>
  <td width="76" valign="top" style="padding:14px 14px 14px 0;width:76px">${l.image ? `<img src="${esc(l.image.startsWith('http') ? l.image : origin + l.image)}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;object-fit:cover;border-radius:4px;background:${C.soft}">` : `<div style="width:64px;height:64px;border-radius:4px;background:${C.soft}"></div>`}</td>
  <td valign="top" style="padding:14px 10px 14px 0;font-family:${FONT}">
    <p style="margin:0 0 4px;font-size:14.5px;line-height:1.4;font-weight:600;color:${C.ink}">${l.handle ? `<a href="${origin}/products/${esc(l.handle)}" style="color:${C.ink};text-decoration:none">${esc(l.title)}</a>` : esc(l.title)}</p>
    <p style="margin:0;font-size:13px;color:${C.muted}">Määrä: ${l.quantity}${l.quantity > 1 ? ` · à ${euro(l.price)}` : ''}</p>
  </td>
  <td valign="top" align="right" style="padding:14px 0;font-family:${FONT};font-size:14.5px;font-weight:600;color:${C.ink};white-space:nowrap">${euro(l.price * l.quantity)}</td>
</tr>
<tr><td colspan="3"><div style="height:1px;line-height:1px;background:${C.line}">&nbsp;</div></td></tr>`).join('');
  const sum = (k, v, strong) => `<tr><td style="padding:5px 0;font-family:${FONT};font-size:${strong ? 16 : 14}px;color:${strong ? C.ink : C.text};font-weight:${strong ? 700 : 400}">${k}</td><td align="right" style="padding:5px 0;font-family:${FONT};font-size:${strong ? 18 : 14}px;color:${C.ink};font-weight:${strong ? 700 : 600};white-space:nowrap">${v}</td></tr>`;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${rows}</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:12px">
${sum('Välisumma', euro(order.subtotal || order.total))}
${order.discount ? sum('Alennus', `−${euro(order.discount)}`) : ''}
${sum('Toimitus', '<span style="color:' + C.green + '">Ilmainen</span>')}
<tr><td colspan="2" style="padding-top:6px"><div style="height:2px;line-height:2px;background:${C.ink}">&nbsp;</div></td></tr>
${sum('Yhteensä', euro(order.total), true)}
<tr><td colspan="2" style="padding:2px 0 0;font-family:${FONT};font-size:12px;color:${C.muted}">sis. alv ${B.vatLabel} (${euro(vatOf(order.total))})</td></tr>
</table>`;
}
function addressBlock(order) {
  const a = order.address || {};
  return [order.shipName || order.name, a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(' '), a.country === B.country ? B.countryName : a.country].filter(Boolean).map(esc).join('<br>');
}
function infoGrid(order) {
  const cell = (t, v) => `<td class="stack" width="50%" valign="top" style="padding:0 12px 18px 0">${label(t)}<p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.55;color:${C.ink}">${v}</p></td>`;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr>${cell('Toimitusosoite', addressBlock(order) || '–')}${cell('Tilaus', `Nro <b>${esc(order.number)}</b><br>${date(order.created)}<br>${esc(order.paymentLabel || 'Maksettu')}`)}</tr>
</table>`;
}
const statusUrl = (order, origin) => `${origin}${B.paths.orderStatus}?nr=${encodeURIComponent(String(order.number || '').replace('#', ''))}&email=${encodeURIComponent(order.email || '')}`;

// ---------- 1. Order confirmation (customer) ----------
function orderConfirmation(order, origin) {
  const first = (order.name || '').split(' ')[0];
  const steps = [['1', 'Tilattu', true], ['2', 'Pakataan', true], ['3', 'Lähetetty', false], ['4', 'Toimitettu', false]]
    .map(([n, t, on]) => `<td align="center" width="25%" style="font-family:${FONT}"><div style="width:30px;height:30px;line-height:30px;border-radius:50%;margin:0 auto 6px;background:${on ? C.accent : C.line};color:${on ? '#FFFFFF' : C.muted};font-size:13px;font-weight:700">${on ? '✓' : n}</div><span style="font-size:12px;font-weight:${on ? 600 : 400};color:${on ? C.ink : C.muted}">${t}</span></td>`).join('');
  const body = `
${section(`${pill(`Tilaus ${esc(order.number)}`)}<div style="height:14px"></div>${h1(`Kiitos${first ? `, ${esc(first)}` : ''}! Tilauksesi on vastaanotettu.`)}${p('Pakkaamme tilauksesi huolellisesti. Saat seurantakoodin sähköpostiisi heti, kun paketti lähtee matkaan.')}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0 6px;background:${C.bg};border-radius:8px"><tr><td style="padding:16px 10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${steps}</tr></table></td></tr></table>`, '30px 32px 18px')}
${section(`${label('Tuotteet')}${itemsTable(order, origin)}`, '8px 32px 22px')}
${divider()}
${section(infoGrid(order), '24px 32px 6px')}
${section(`${button(statusUrl(order, origin), 'Seuraa tilausta')}${order.receiptUrl || order.invoiceUrl ? `&nbsp;&nbsp;${button(order.receiptUrl || order.invoiceUrl, order.receiptUrl ? 'Maksukuitti' : 'Lasku (PDF)', { light: true })}` : ''}`, '0 32px 22px')}
${section(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${C.soft};border-radius:8px"><tr><td style="padding:18px 20px">
<p style="margin:0 0 4px;font-family:${FONT};font-size:14px;font-weight:700;color:${C.ink}">Kysyttävää tilauksesta?</p>
<p style="margin:0;font-family:${FONT};font-size:13.5px;line-height:1.55;color:${C.text}">Vastaa tähän viestiin, niin autamme.</p></td></tr></table>`, '6px 32px 26px')}
${section(small(`Sinulla on 14 päivän peruuttamisoikeus siitä päivästä, jona vastaanotat tuotteet. Ohjeet löydät sivulta <a href="${origin}${B.paths.withdrawal}" style="color:${C.muted}">Peruutus ja palautus</a>, ja peruutuksen voit tehdä myös <a href="${origin}${B.paths.withdrawalForm}" style="color:${C.muted}">peruuttamislomakkeella</a>. Tilaukseen sovelletaan <a href="${origin}${B.paths.terms}" style="color:${C.muted}">tilaus- ja toimitusehtojamme</a>.`), '0 32px 30px')}`;
  return { subject: `Tilausvahvistus ${order.number} – ${B.name}`, html: layout({ origin, preheader: `Kiitos tilauksestasi ${order.number}, yhteensä ${euro(order.total)}.`, body }) };
}

// ---------- 2. Shipping confirmation (customer) ----------
function shippingConfirmation(order, origin, { carrier = 'Posti', tracking = '', trackingUrl = '' } = {}) {
  const first = (order.name || '').split(' ')[0];
  const url = trackingUrl || (tracking ? `https://www.posti.fi/seuranta#/lahetys/${encodeURIComponent(tracking)}` : '');
  const body = `
${section(`${pill('Paketti on matkalla')}<div style="height:14px"></div>${h1(`${first ? `${esc(first)}, t` : 'T'}ilauksesi on lähetetty.`)}${p(`Tilaus <b>${esc(order.number)}</b> on lähtenyt varastoltamme.`)}
${tracking ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0 8px;border:1px solid ${C.line};border-radius:8px"><tr><td style="padding:18px 20px">${label(`Seurantakoodi · ${esc(carrier)}`)}<p style="margin:0 0 12px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:18px;font-weight:700;letter-spacing:1px;color:${C.ink}">${esc(tracking)}</p>${url ? button(url, 'Seuraa lähetystä') : ''}</td></tr></table>` : ''}`, '30px 32px 14px')}
${section(`${label('Paketissa')}${itemsTable(order, origin)}`, '10px 32px 22px')}
${divider()}
${section(infoGrid(order), '24px 32px 24px')}`;
  return { subject: `Tilauksesi ${order.number} on matkalla`, html: layout({ origin, preheader: tracking ? `Seurantakoodi: ${tracking}` : 'Pakettisi on matkalla.', body }) };
}

// ---------- 3. New order (shop owner) ----------
function ownerNewOrder(order, origin, adminUrl) {
  const body = `
${section(`${pill(`Uusi tilaus · ${euro(order.total)}`)}<div style="height:14px"></div>${h1(`${esc(order.number)} – ${esc(order.name || order.email)}`)}${p(`${esc(order.email)}${order.phone ? ` · ${esc(order.phone)}` : ''}<br>${esc(order.paymentLabel || '')} · ${date(order.created)}`)}
${adminUrl ? button(adminUrl, 'Avaa tilaus') : ''}`, '30px 32px 12px')}
${section(`${label('Tuotteet')}${itemsTable(order, origin)}`, '10px 32px 22px')}
${divider()}
${section(infoGrid(order), '24px 32px 10px')}
${section(small(`Stripe: ${esc(order.id)}`), '0 32px 28px')}`;
  return { subject: `Uusi tilaus ${order.number} – ${euro(order.total)}`, html: layout({ origin, preheader: `${order.lines.length} tuotetta · ${order.email}`, body }) };
}

// ---------- 4. Contact: auto-reply ----------
function contactAutoReply({ name, body }, origin) {
  const first = String(name || '').split(' ')[0];
  const html = `
${section(`${pill('Viesti vastaanotettu')}<div style="height:14px"></div>${h1(`Kiitos${first ? `, ${esc(first)}` : ''} – viestisi on perillä.`)}${p('Vastaamme sinulle mahdollisimman pian. Sinun ei tarvitse tehdä mitään muuta.')}
${body ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:14px 0;background:${C.bg};border-left:3px solid ${C.accent}"><tr><td style="padding:14px 18px">${label('Viestisi')}<p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.6;color:${C.text}">${esc(body).replace(/\n/g, '<br>')}</p></td></tr></table>` : ''}
${button(`${origin}/collections/all`, 'Jatka ostoksia')}`, '30px 32px 30px')}`;
  return { subject: `Viestisi on vastaanotettu – ${B.name}`, html: layout({ origin, preheader: 'Vastaamme sinulle pian.', body: html }) };
}
function ownerContact(fields, origin, kind = 'Yhteydenotto') {
  const rows = Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `<tr><td valign="top" style="padding:8px 14px 8px 0;font-family:${FONT};font-size:13px;color:${C.muted};white-space:nowrap">${esc(k)}</td><td style="padding:8px 0;font-family:${FONT};font-size:14px;line-height:1.55;color:${C.ink}">${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('');
  const html = section(`${pill(esc(kind))}<div style="height:12px"></div>${h1(esc(fields.Nimi || fields['Sähköposti'] || kind))}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${rows}</table>${small('Vastaa asiakkaalle vastaamalla tähän viestiin (Reply-To on asetettu).')}`, '30px 32px 28px');
  return { subject: `${kind}: ${fields.Nimi || fields['Sähköposti'] || ''}`, html: layout({ origin, preheader: kind, body: html }) };
}

// ---------- 5. Withdrawal: confirmation of receipt ----------
function withdrawalReceipt(fields, origin, receivedAt) {
  const rows = Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `<tr><td valign="top" style="padding:7px 14px 7px 0;font-family:${FONT};font-size:13px;color:${C.muted};white-space:nowrap">${esc(k)}</td><td style="padding:7px 0;font-family:${FONT};font-size:14px;color:${C.ink}">${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('');
  const when = new Date(receivedAt).toLocaleString(B.locale, { timeZone: B.tz, dateStyle: 'long', timeStyle: 'short' });
  const html = `
${section(`${pill('Peruutusilmoitus vastaanotettu')}<div style="height:14px"></div>${h1('Olemme vastaanottaneet peruutusilmoituksesi.')}${p(`Vahvistamme, että peruutusilmoituksesi saapui meille <b>${when}</b>.`)}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:10px 0 16px;border:1px solid ${C.line};border-radius:8px"><tr><td style="padding:16px 20px">${label('Antamasi tiedot')}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${rows}</table></td></tr></table>
${label('Näin asia etenee')}
${p('1. Palauta tuotteet meille 14 päivän kuluessa peruutusilmoituksesta. Lähetämme palautusosoitteen ja -ohjeet erillisessä viestissä.<br>2. Palautamme maksusi alkuperäiselle maksutavalle viimeistään 14 päivän kuluessa peruutusilmoituksen saapumisesta. Voimme pidättyä maksun palautuksesta, kunnes olemme saaneet tuotteet takaisin tai olet osoittanut lähettäneesi ne.')}
${small(`Lisätiedot: <a href="${origin}${B.paths.withdrawal}" style="color:${C.muted}">Peruutus ja palautus</a>. Säilytä tämä viesti todisteena.`)}`, '30px 32px 30px')}`;
  return { subject: `Peruutusilmoituksesi on vastaanotettu – ${B.name}`, html: layout({ origin, preheader: `Peruutusilmoitus saapui ${when}`, body: html }) };
}

// ---------- 6. Newsletter: double opt-in + welcome ----------
function newsletterConfirm(confirmUrl, origin) {
  const html = section(`${pill('Vielä yksi vaihe')}<div style="height:14px"></div>${h1('Vahvista uutiskirjeen tilaus')}${p(`Tilasit ${esc(B.name)}n uutiskirjeen. Kerromme siinä uusista tuotteista, väreistä ja täydennyksistä.`)}
${button(confirmUrl, 'Vahvista tilaus')}
${small('Etkö tilannut uutiskirjettä? Voit jättää tämän viestin huomiotta – emme lähetä sinulle mitään ilman vahvistusta.')}`, '30px 32px 30px');
  return { subject: `Vahvista uutiskirjeen tilaus – ${B.name}`, html: layout({ origin, preheader: 'Vahvista tilaus yhdellä painalluksella.', body: html }) };
}
function newsletterWelcome(origin, unsubscribeUrl) {
  const html = `
${section(`${pill('Tervetuloa')}<div style="height:14px"></div>${h1('Uutiskirjeen tilaus on vahvistettu.')}${p('Saat jatkossa tiedon uusista tuotteista, väreistä ja täydennyksistä ensimmäisten joukossa.')}
${button(`${origin}/collections/all`, 'Katso valikoima')}`, '30px 32px 26px')}`;
  return { subject: `Tervetuloa – ${B.name}`, html: layout({ origin, preheader: 'Uutiskirjeen tilaus on vahvistettu.', body: html, footerNote: unsubscribeUrl ? `Saat tämän viestin, koska tilasit uutiskirjeemme. <a href="${unsubscribeUrl}" style="color:${C.muted}">Peru tilaus</a>` : '' }) };
}

// ---------- 8. Abandoned cart ----------
function cartReminder(cart, origin) {
  const first = String(cart.name || '').split(' ')[0];
  const rows = cart.lines.map((l) => `<tr><td width="76" valign="top" style="padding:12px 14px 12px 0">${l.image ? `<img src="${esc(origin + l.image)}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;object-fit:cover;border-radius:4px;background:${C.soft}">` : ''}</td><td valign="top" style="padding:12px 0;font-family:${FONT}"><p style="margin:0 0 3px;font-size:14.5px;font-weight:600;color:${C.ink}">${esc(l.title)}</p><p style="margin:0;font-size:13px;color:${C.muted}">Määrä: ${l.quantity}</p></td><td valign="top" align="right" style="padding:12px 0;font-family:${FONT};font-size:14.5px;font-weight:600;color:${C.ink};white-space:nowrap">${euro(l.price * l.quantity)}</td></tr>`).join('');
  const body = `
${section(`${pill('Ostoskorisi odottaa')}<div style="height:14px"></div>${h1(`${first ? `${esc(first)}, o` : 'O'}stoskorisi on tallessa.`)}${p('Tilauksesi jäi kesken kassalla. Ostoskori on tallessa, ja voit jatkaa siitä, mihin jäit.')}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${rows}</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px"><tr><td style="padding:8px 0;font-family:${FONT};font-size:15px;color:${C.ink}"><b>Yhteensä</b> <span style="color:${C.muted};font-size:13px">· ilmainen toimitus</span></td><td align="right" style="font-family:${FONT};font-size:17px;font-weight:700;color:${C.ink}">${euro(cart.total)}</td></tr></table>
${button(`${origin}/checkout?cart=${encodeURIComponent(cart.token)}`, 'Viimeistele tilaus')}
${small('Kysyttävää ennen tilaamista? Vastaa tähän viestiin. Lähetämme tämän muistutuksen vain kerran.')}`, '30px 32px 26px')}`;
  return { subject: `Ostoskorisi odottaa – ${B.name}`, html: layout({ origin, preheader: `${cart.lines.length} tuotetta · ${euro(cart.total)} · ilmainen toimitus`, body, footerNote: cart.unsub ? `Etkö halua muistutuksia? <a href="${origin}/newsletter/unsubscribe?e=${encodeURIComponent(cart.email)}&t=${cart.unsub}" style="color:${C.muted}">Peru viestit</a>` : '' }) };
}

// ---------- 9. Back in stock ----------
function backInStock(product, origin) {
  const fi = product.featured_image;
  const img = fi && fi.__img && fi.__img.base ? `${origin}/images/${fi.__img.base}-${fi.__img.widths.find((w) => w >= 480) || fi.__img.widths[0]}.webp` : '';
  const body = section(`${pill('Taas saatavilla')}<div style="height:14px"></div>${h1(`${esc(product.title)} on taas saatavilla`)}${p('Pyysit ilmoitusta, kun tuotetta on taas varastossa. Nyt sitä on.')}
${img ? `<a href="${origin}${product.url}"><img src="${img}" width="280" alt="" style="display:block;width:280px;max-width:100%;height:auto;border-radius:6px;margin:6px auto 18px"></a>` : ''}
<p style="margin:0 0 14px;text-align:center;font-family:${FONT};font-size:22px;font-weight:700;color:${C.ink}">${euro(product.price)} <span style="font-size:13px;font-weight:400;color:${C.muted}">sis. alv, ilmainen toimitus</span></p>
<div style="text-align:center">${button(`${origin}${product.url}`, 'Katso tuote')}</div>
${small('Saat tämän ilmoituksen vain kerran, koska pyysit sitä tuotesivulla.')}`, '30px 32px 26px');
  return { subject: `Taas saatavilla: ${product.title}`, html: layout({ origin, preheader: `${product.title} on taas varastossa – ${euro(product.price)}`, body }) };
}

module.exports = { cartReminder, backInStock, orderConfirmation, shippingConfirmation, ownerNewOrder, contactAutoReply, ownerContact, withdrawalReceipt, newsletterConfirm, newsletterWelcome, euro };
