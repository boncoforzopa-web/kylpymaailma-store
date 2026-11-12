// Renders every e-mail template with sample data: node scripts/email-previews.js <outDir> [origin]
const fs = require('fs');
const path = require('path');
const T = require('../lib/emails');
const D = require('../lib/data');

const out = process.argv[2] || 'email-previews';
const origin = process.argv[3] || 'https://kylpymaailma.com';
fs.mkdirSync(out, { recursive: true });

const line = (p, q) => {
  const v = p.variants[0]; const img = p.featured_image;
  return { id: v.id, quantity: q, title: `${p.title} - ${v.title}`, price: v.price, handle: p.handle,
    image: img ? `/images/${img.__img.base}-${img.__img.widths.find((w) => w >= 160) || img.__img.widths[0]}.webp` : null, preorder: false, release: '' };
};
const lines = [line(D.ACTIVE[0], 2), line(D.ACTIVE[2], 1)];
const total = lines.reduce((a, l) => a + l.price * l.quantity, 0);
const order = {
  id: 'pi_example_a1B2c3D4', number: '#1001', created: new Date().toISOString(), email: 'aino.virtanen@example.fi', name: 'Aino Virtanen', phone: '',
  shipName: 'Aino Virtanen', address: { line1: 'Esimerkkikatu 12 A 4', line2: '', postal_code: '00100', city: 'Helsinki', country: 'FI' },
  subtotal: total, discount: 0, total, paymentLabel: 'Visa •••• 4242', lines,
};

const files = {
  '1-tilausvahvistus.html': T.orderConfirmation(order, origin),
  '2-lahetysvahvistus.html': T.shippingConfirmation(order, origin, { carrier: 'Posti', tracking: 'JJFI12345678901234567' }),
  '3-uusi-tilaus-omistajalle.html': T.ownerNewOrder(order, origin, `${origin}/admin/orders/${order.id}`),
  '4-yhteydenotto-automaattivastaus.html': T.contactAutoReply({ name: 'Aino Virtanen', body: 'Hei, onko abaya saatavilla pituudessa 148 cm?' }, origin),
  '5-peruutusilmoitus-vastaanotettu.html': T.withdrawalReceipt({ Nimi: 'Aino Virtanen', 'Sähköposti': 'aino.virtanen@example.fi', Tilausnumero: '#1001' }, origin, new Date().toISOString()),
  '6-uutiskirje-vahvista.html': T.newsletterConfirm(`${origin}/newsletter/confirm?e=aino%40example.fi&t=xyz`, origin),
  '7-uutiskirje-tervetuloa.html': T.newsletterWelcome(origin, `${origin}/newsletter/unsubscribe?e=aino%40example.fi&t=xyz`),
  '8-ostoskorimuistutus.html': T.cartReminder({ name: 'Aino Virtanen', email: 'aino.virtanen@example.fi', token: 'abc', lines, total, unsub: 'xyz' }, origin),
  '9-taas-saatavilla.html': T.backInStock(D.ACTIVE[0], origin),
};
for (const [f, m] of Object.entries(files)) fs.writeFileSync(path.join(out, f), m.html);
fs.writeFileSync(path.join(out, 'subjects.json'), JSON.stringify(Object.fromEntries(Object.entries(files).map(([f, m]) => [f, m.subject])), null, 2));
console.log(Object.keys(files).length, 'previews in', out);
