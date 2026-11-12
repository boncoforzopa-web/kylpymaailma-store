/* Replaces the Shopify-only browser APIs the theme used:
   - Shopify.customerPrivacy (cookie banner) -> Google consent mode
   - Google Ads / GA4 e-commerce events the Shopify Google app used to send */
(function () {
  var KEY = 'tw-consent-v1';
  // Events go to every Google tag configured in GOOGLE_TAG_IDS (none configured = nothing is sent).
  // The only conversion is Purchase, sent from the thank-you page.
  function g() { if (typeof window.gtag === 'function') window.gtag.apply(null, arguments); }
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }

  window.Shopify = window.Shopify || {};
  window.Shopify.customerPrivacy = {
    shouldShowBanner: function () { return !read(); },
    currentVisitorConsent: function () {
      var c = read() || {};
      return { analytics: c.analytics ? 'yes' : 'no', marketing: c.marketing ? 'yes' : 'no', preferences: c.preferences ? 'yes' : 'no', sale_of_data: c.marketing ? 'yes' : 'no' };
    },
    setTrackingConsent: function (c, cb) {
      g('consent', 'update', {
        ad_storage: c.marketing ? 'granted' : 'denied', ad_user_data: c.marketing ? 'granted' : 'denied',
        ad_personalization: c.marketing ? 'granted' : 'denied', analytics_storage: c.analytics ? 'granted' : 'denied'
      });
      if (cb) cb();
    }
  };

  // page_view conversion
  g('event', 'page_view');

  // view_item on product pages
  var pid = document.querySelector('[data-variant-input]');
  if (pid && document.body.classList.contains('template-product')) {
    var price = document.querySelector('meta[property="og:price:amount"]');
    var title = document.querySelector('meta[property="og:title"]');
    var item = { item_id: pid.value, item_name: title ? title.content : document.title, price: price ? parseFloat(String(price.content).replace('.', '').replace(',', '.')) : undefined, quantity: 1 };
    g('event', 'view_item', { currency: 'EUR', value: item.price, items: [item] });
  }

  // search
  if (document.body.classList.contains('template-search')) {
    var q = new URLSearchParams(location.search).get('q');
    if (q) g('event', 'search', { search_term: q });
  }

  // add_to_cart: watch the theme's AJAX calls
  if (window.fetch) {
    var of = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var p = of.apply(this, arguments);
      if (/\/cart\/add(\.js)?/.test(url)) {
        p.then(function (r) { return r.clone().json(); }).then(function (d) {
          var items = (d.items || [d]).filter(function (i) { return i && i.id; });
          if (!items.length) return;
          var value = items.reduce(function (a, i) { return a + (i.final_line_price || 0) / 100; }, 0);
          g('event', 'add_to_cart', { currency: 'EUR', value: value, items: items.map(function (i) { return { item_id: 'shopify_ZZ_' + i.product_id + '_' + i.variant_id, item_name: i.product_title, price: i.final_price / 100, quantity: i.quantity }; }) });
        }).catch(function () {});
      }
      return p;
    };
  }

  // begin_checkout: any checkout button / link
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[name="checkout"], a[href="/checkout"], a[href^="/checkout?"], [data-checkout]');
    if (b) g('event', 'begin_checkout', { currency: 'EUR' });
  }, true);
})();
