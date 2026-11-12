/* Extras: visit beacon, recently viewed, back-in-stock alerts. No cookies, nothing personal. */
(function () {
  'use strict';
  var body = document.body;
  var product = body.classList.contains('template-product') ? (location.pathname.match(/\/products\/([^/?#]+)/) || [])[1] : '';

  // 1) anonymous visit beacon (counts page views per day/country/city/referrer in the admin)
  try {
    var vid = sessionStorage.getItem('tw-vid');
    if (!vid) { vid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); sessionStorage.setItem('tw-vid', vid); }
    var ref = sessionStorage.getItem('tw-ref');
    if (ref === null) { ref = document.referrer && document.referrer.indexOf(location.host) === -1 ? document.referrer : ''; sessionStorage.setItem('tw-ref', ref); }
    var q = sessionStorage.getItem('tw-q'); if (q === null) { q = location.search; sessionStorage.setItem('tw-q', q); }
    try { document.cookie = 'tw_vid=' + vid + ';path=/;SameSite=Lax' + (location.protocol === 'https:' ? ';Secure' : ''); } catch (e) {}
    var paused = false;
    var pause = function (t) {
      if (paused) return; paused = true;
      var total = (t.minutes || 5) * 60000, until = t.until;
      var o = document.createElement('div'); o.id = 'tw-timeout';
      o.innerHTML = '<div class="tw-to__card"><div class="tw-to__lg">Kylpymaailma</div><h2>Pieni tauko</h2><p>Pääsysi kauppaan on hetkeksi keskeytetty. Ostoskorisi säilyy, ja voit jatkaa pian.</p><div class="tw-to__t" data-t>--:--</div><div class="tw-to__s">aikaa jäljellä</div><div class="tw-to__bar"><i data-b style="width:100%"></i></div><a class="tw-to__btn" data-go aria-disabled="true" href="' + location.pathname + '">Jatka ostoksia</a></div>';
      document.body.appendChild(o); document.documentElement.classList.add('tw-paused');
      var tick = function () {
        var r = Math.max(0, until - Date.now()), m = Math.floor(r / 60000), x = Math.floor(r % 60000 / 1000);
        o.querySelector('[data-t]').textContent = (m < 10 ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x;
        o.querySelector('[data-b]').style.width = Math.max(0, Math.min(100, r / total * 100)) + '%';
        if (r <= 0) { o.querySelector('[data-go]').removeAttribute('aria-disabled'); setTimeout(function () { location.reload(); }, 800); return; }
        setTimeout(tick, 1000);
      };
      tick();
    };
    var send = function (extra) {
      var payload = JSON.stringify(Object.assign({ path: location.pathname, product: product, ref: ref, q: q, vid: vid }, extra || {}));
      fetch('/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true })
        .then(function (r) { if (r.status === 200) return r.json(); }).then(function (j) { if (j && j.timeout) pause(j.timeout); }).catch(function () {});
    };
    var firstHit = !sessionStorage.getItem('tw-seen'); try { sessionStorage.setItem('tw-seen', '1'); } catch (e) {}
    send(firstHit ? { first: 1 } : null);
    // heartbeat while the tab is visible (every 2 min, max 10 min per page) so the admin live view knows who is still here
    var beats = 0, hb = setInterval(function () { if (++beats > 5) return clearInterval(hb); if (!document.hidden) send({ hb: 1 }); }, 120000);
  } catch (e) {}

  // 2) recently viewed products (localStorage, max 8)
  var KEY = 'tw-recent';
  function list() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  var sec = document.querySelector('[data-recently-viewed]');
  if (sec) {
    var handles = list().filter(function (h) { return h !== sec.getAttribute('data-exclude'); }).slice(0, 4);
    if (handles.length) {
      var grid = sec.querySelector('[data-recently-viewed-grid]');
      Promise.all(handles.map(function (h) { return fetch('/products/' + encodeURIComponent(h) + '?section_id=tw-card-render').then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; }); }))
        .then(function (htmls) { var html = htmls.join(''); if (!html.trim()) return; grid.innerHTML = html; sec.hidden = false; if (window.TW && TW.reveal) TW.reveal(sec); });
    }
  }
  if (product) { try { var l = list().filter(function (h) { return h !== product; }); l.unshift(product); localStorage.setItem(KEY, JSON.stringify(l.slice(0, 8))); } catch (e) {} }

  // 3) back-in-stock form on sold-out products
  var bis = document.querySelector('[data-back-in-stock]');
  if (bis) {
    bis.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var msg = bis.querySelector('.tw-bis__msg'); var btn = bis.querySelector('button'); var email = bis.querySelector('input[name=email]');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) { msg.textContent = 'Anna toimiva sähköpostiosoite.'; msg.hidden = false; email.focus(); return; }
      btn.disabled = true;
      fetch('/api/back-in-stock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variant_id: bis.querySelector('input[name=variant_id]').value, email: email.value.trim() }) })
        .then(function (r) { return r.json(); })
        .then(function (j) { msg.textContent = j.message || j.error || 'Ilmoituksen tallennus epäonnistui.'; msg.hidden = false; if (j.ok) { bis.classList.add('is-done'); if (window.TW && TW.toast) TW.toast('Saatavuusilmoitus tilattu'); } btn.disabled = false; })
        .catch(function () { msg.textContent = 'Jokin meni vikaan. Yritä uudelleen.'; msg.hidden = false; btn.disabled = false; });
    });
  }
})();
