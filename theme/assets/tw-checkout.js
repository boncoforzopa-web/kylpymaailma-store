/* Checkout: Stripe Payment Element inside the shop's own page. */
(function () {
  'use strict';
  var root = document.querySelector('[data-checkout]');
  if (!root || !window.Stripe) return;
  var form = document.getElementById('tw-checkout-form');
  var pk = root.getAttribute('data-pk');
  var amount = parseInt(root.getAttribute('data-amount'), 10) || 0;
  var returnUrl = root.getAttribute('data-return');
  var errBox = form.querySelector('[data-co-error]');
  var payErr = form.querySelector('[data-pay-error]');
  var btn = form.querySelector('[data-co-submit]');
  var label = form.querySelector('[data-co-label]');
  var busyEl = form.querySelector('[data-co-busy]');
  var mount = document.getElementById('tw-payment-element');
  var skel = form.querySelector('[data-pay-skeleton]');
  var mobile = form.querySelector('[data-mobile-summary]');
  var aside = document.querySelector('[data-summary]');
  if (mobile && aside) mobile.appendChild(aside.cloneNode(true));

  function gtag() { if (typeof window.gtag === 'function') window.gtag.apply(null, arguments); }
  gtag('event', 'begin_checkout', { currency: 'EUR', value: amount / 100 });

  function showError(msg) { errBox.textContent = msg; errBox.hidden = !msg; if (msg) errBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  function busy(on) { btn.disabled = on; label.hidden = on; busyEl.hidden = !on; }

  if (!pk) { skel.hidden = true; payErr.textContent = 'Verkkomaksu ei ole juuri nyt käytettävissä. Yritä hetken kuluttua uudelleen.'; payErr.hidden = false; btn.disabled = true; return; }

  var dark = document.documentElement.getAttribute('data-mode') === 'dark';
  var css = getComputedStyle(document.documentElement);
  var v = function (name, fb) { var x = css.getPropertyValue(name).trim(); return x || fb; };
  var fontBase = location.origin;
  var stripe = Stripe(pk);
  var pmTypes = (root.getAttribute('data-pm') || 'card').split(',').filter(Boolean);
  var elements = stripe.elements({
    // must match the server PaymentIntent: /api/checkout/intent leaves capture_method unset,
    // which Stripe now defaults to 'automatic_async'
    mode: 'payment', amount: amount, currency: 'eur', captureMethod: 'automatic_async', paymentMethodTypes: pmTypes,
    paymentMethodCreation: 'manual',
    locale: 'fi',
    fonts: [{ family: 'TW Sans', src: 'url(' + fontBase + '/cdn/shop/t/18/assets/schibsted-grotesk-latin-wght-normal.woff2)', weight: '400 900' }],
    appearance: {
      theme: dark ? 'night' : 'stripe',
      variables: {
        colorPrimary: '#1E3A34', colorText: v('--text', '#17211F'), colorTextSecondary: v('--muted', '#55615E'),
        colorBackground: '#FFFFFF', colorDanger: '#B3261E', fontFamily: 'TW Sans, system-ui, sans-serif',
        fontSizeBase: '15px', borderRadius: '6px', spacingUnit: '5px', focusOutline: '0', focusBoxShadow: '0 0 0 3px rgba(30,58,52,.18)'
      },
      rules: {
        '.Input': { border: '1px solid #C9D0CA', padding: '14px 16px', boxShadow: 'none' },
        '.Input:focus': { border: '1px solid #1E3A34', boxShadow: '0 0 0 3px rgba(30,58,52,.16)' },
        '.Label': { fontWeight: '600', fontSize: '13px', color: v('--muted', '#55615E') },
        '.Tab': { border: '1px solid #DCE1DC', borderRadius: '6px' },
        '.Tab--selected': { border: '1px solid #1E3A34', boxShadow: '0 0 0 2px rgba(30,58,52,.18)', color: v('--text', '#17211F') },
        '.AccordionItem': { border: '1px solid #DCE1DC', borderRadius: '6px', boxShadow: 'none' },
        '.AccordionItem--selected': { border: '1px solid #1E3A34', boxShadow: '0 0 0 2px rgba(30,58,52,.16)', color: v('--text', '#17211F') }
      }
    }
  });
  var pe = elements.create('payment', {
    layout: { type: 'accordion', defaultCollapsed: false, radios: true, spacedAccordionItems: true },
    paymentMethodOrder: ['card', 'mobilepay', 'apple_pay', 'google_pay', 'klarna', 'paypal'],
    wallets: { applePay: 'auto', googlePay: 'auto', link: 'never' },
    fields: { billingDetails: { name: 'never', email: 'never', phone: 'never', address: 'never' } },
    terms: { card: 'never', klarna: 'never' }
  });
  pe.mount(mount);
  pe.on('ready', function () { skel.hidden = true; mount.hidden = false; });
  pe.on('loaderror', function (e) { skel.hidden = true; payErr.textContent = 'Maksukenttien lataus epäonnistui. Päivitä sivu.'; payErr.hidden = false; console.error(e && e.error); });
  pe.on('change', function (e) { if (e.complete) gtag('event', 'add_payment_info', { currency: 'EUR', value: amount / 100 }); });

  // abandoned-cart reminder: report e-mail + cart once (again only when it changed)
  var reported = '';
  function reportCart() {
    var c = customer();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email)) return;
    var payload = JSON.stringify({ email: c.email, name: (c.firstName + ' ' + c.lastName).trim(), vid: c.vid });
    if (payload === reported) return;
    reported = payload;
    fetch('/api/cart-reminder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
  }
  form.addEventListener('focusout', reportCart);

  var intent = null; // { clientSecret, amount, key }
  function customer() {
    var d = new FormData(form); var g = function (k) { return String(d.get(k) || '').trim(); };
    var vid = ''; try { vid = sessionStorage.getItem('tw-vid') || ''; } catch (e) {}
    return { email: g('email'), firstName: g('firstName'), lastName: g('lastName'), street: g('street'), street2: g('street2'), postalCode: g('postalCode'), city: g('city'), phone: g('phone'), newsletter: d.get('newsletter') === '1', vid: vid };
  }
  function validate(c) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email)) return 'Anna toimiva sähköpostiosoite.';
    if (!c.firstName || !c.lastName) return 'Anna etu- ja sukunimesi.';
    if (c.street.length < 3) return 'Anna katuosoite.';
    if (!/^\d{5}$/.test(c.postalCode)) return 'Anna viisinumeroinen postinumero.';
    if (c.city.length < 2) return 'Anna postitoimipaikka.';
    return '';
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    showError('');
    var c = customer();
    var bad = validate(c);
    if (bad) { showError(bad); var first = form.querySelector(':invalid, input[name="email"]'); if (first) first.focus(); return; }
    busy(true);
    elements.submit().then(function (r) {
      if (r.error) throw new Error(r.error.message || 'Tarkista maksutiedot.');
      var key = JSON.stringify(c) + amount;
      if (intent && intent.key === key) return intent.clientSecret;
      return fetch('/api/checkout/intent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) })
        .then(function (res) { return res.json().then(function (j) { if (!res.ok || !j.clientSecret) throw new Error(j.error || 'Maksua ei voitu aloittaa.'); return j; }); })
        .then(function (j) { intent = { clientSecret: j.clientSecret, key: key }; return j.clientSecret; });
    }).then(function (clientSecret) {
      // fields.billingDetails is 'never' on the Payment Element, so Stripe requires
      // EVERY billing field here (incl. state + line2) — empty strings, never undefined.
      // Shipping is NOT passed here: /api/checkout/intent already sets it server-side
      // with the secret key, and Stripe rejects changing it with the publishable key.
      var address = { line1: c.street, line2: c.street2 || '', postal_code: c.postalCode, city: c.city, state: '', country: 'FI' };
      return stripe.confirmPayment({
        elements: elements, clientSecret: clientSecret, redirect: 'if_required',
        confirmParams: {
          return_url: returnUrl,
          payment_method_data: { billing_details: { name: c.firstName + ' ' + c.lastName, email: c.email, phone: c.phone || '', address: address } }
        }
      });
    }).then(function (r) {
      if (!r) return;
      if (r.error) throw new Error(r.error.message || 'Maksua ei vahvistettu. Yritä uudelleen.');
      var pi = r.paymentIntent;
      if (pi && (pi.status === 'succeeded' || pi.status === 'processing' || pi.status === 'requires_capture')) {
        window.location.assign(returnUrl + (returnUrl.indexOf('?') > -1 ? '&' : '?') + 'payment_intent=' + encodeURIComponent(pi.id) + '&payment_intent_client_secret=' + encodeURIComponent(pi.client_secret) + '&redirect_status=' + pi.status);
        return;
      }
      throw new Error('Maksu jäi kesken. Yritä uudelleen.');
    }).catch(function (e) {
      showError(e && e.message ? e.message : 'Jokin meni vikaan. Yritä uudelleen.');
      busy(false);
    });
  });
})();
