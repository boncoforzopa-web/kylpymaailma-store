/* Theme runtime (no dependencies) */
(() => {
  'use strict';

  const TW = (window.TW = window.TW || {});
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const routes = TW.routes || {};
  const S = TW.strings || {};
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const nf = new Intl.NumberFormat('fi-FI');

  /* ---------- Image fade-in (Shopify strips inline onload from image_tag) ---------- */
  const markLoaded = (img) => { const p = img.closest('.tw-skeleton'); if (p) p.classList.add('is-loaded'); };
  const scanImages = (root = document) => $$('.tw-skeleton img', root).forEach((img) => {
    if (img.complete && img.naturalWidth > 0) markLoaded(img);
    else img.addEventListener('load', () => markLoaded(img), { once: true });
  });
  document.addEventListener('load', (e) => { if (e.target && e.target.tagName === 'IMG') markLoaded(e.target); }, true);
  scanImages();
  document.addEventListener('DOMContentLoaded', () => scanImages());
  window.addEventListener('load', () => scanImages());
  document.addEventListener('shopify:section:load', (e) => scanImages(e.target));
  TW.scanImages = scanImages;

  /* ---------- Money ---------- */
  TW.formatMoney = (cents) => {
    const fmt = TW.moneyFormat || '{{amount_with_comma_separator}} €';
    const value = (Number(cents) || 0) / 100;
    const two = (sep, thou) => value.toFixed(2).replace('.', sep).replace(/\B(?=(\d{3})+(?!\d))/g, thou);
    return fmt.replace(/\{\{\s*(\w+)\s*\}\}/, (m, key) => {
      switch (key) {
        case 'amount_no_decimals': return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        case 'amount_with_comma_separator': return two(',', '.');
        case 'amount_no_decimals_with_comma_separator': return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        case 'amount_with_apostrophe_separator': return two('.', "'");
        default: return two('.', ',');
      }
    });
  };

  /* ---------- Toast ---------- */
  TW.MAXQ = 10;
  S.maxq = S.maxq || 'Enintään 10 kappaletta samaa tuotetta.';
  const toastEl = $('[data-toast]');
  let toastT;
  TW.toast = (msg) => {
    if (!toastEl) return;
    toastEl.innerHTML = '<svg class="tw-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg><span></span>';
    toastEl.querySelector('span').textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('is-visible'), 2600);
  };

  /* ---------- Mode toggle ---------- */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode-toggle]');
    if (!btn) return;
    const root = document.documentElement;
    const next = root.getAttribute('data-mode') === 'light' ? 'dark' : 'light';
    const apply = () => { root.setAttribute('data-mode', next); store.set('tw-mode', next); };
    if (document.startViewTransition && !reduced) document.startViewTransition(apply); else apply();
  });

  /* ---------- Header shrink ---------- */
  const header = $('[data-header]');
  if (header) {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { header.classList.toggle('is-scrolled', window.scrollY > 24); ticking = false; });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Mega menu ---------- */
  $$('[data-mega]').forEach((item) => {
    const link = item.querySelector('.tw-nav__link');
    let openT, closeT;
    const open = () => {
      clearTimeout(closeT);
      openT = setTimeout(() => {
        $$('[data-mega].is-open').forEach((o) => { if (o !== item) close(o, true); });
        item.classList.add('is-open');
        link.setAttribute('aria-expanded', 'true');
      }, 60);
    };
    const close = (el = item, now = false) => {
      clearTimeout(openT);
      const run = () => { el.classList.remove('is-open'); el.querySelector('.tw-nav__link').setAttribute('aria-expanded', 'false'); };
      if (now) run(); else closeT = setTimeout(run, 160);
    };
    item.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') open(); });
    item.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') close(); });
    item.addEventListener('focusin', open);
    item.addEventListener('focusout', (e) => { if (!item.contains(e.relatedTarget)) close(item, true); });
    link.addEventListener('click', (e) => {
      if (!item.classList.contains('is-open')) { e.preventDefault(); clearTimeout(openT); item.classList.add('is-open'); link.setAttribute('aria-expanded', 'true'); }
    });
    item.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(item, true); link.focus(); } });
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('[data-mega]')) $$('[data-mega].is-open').forEach((o) => { o.classList.remove('is-open'); o.querySelector('.tw-nav__link').setAttribute('aria-expanded', 'false'); }); });

  /* mega menu: hovering a category swaps the promo image/text to a product of that category */
  $$('[data-mega-panel]').forEach((panel) => {
    const img = panel.querySelector('img.tw-mega__product');
    const title = panel.querySelector('.tw-mega__promo-title');
    const kicker = panel.querySelector('.tw-mega__promo .tw-kicker');
    if (!img) return;
    const def = { src: img.currentSrc || img.src, srcset: img.getAttribute('srcset') || '', title: title ? title.textContent : '', kicker: kicker ? kicker.textContent : '' };
    let timer = null;
    const swap = (src, srcset, t, k) => {
      if (img.dataset.cur === src) return;
      img.dataset.cur = src;
      img.classList.add('is-swapping');
      clearTimeout(timer);
      timer = setTimeout(() => {
        img.removeAttribute('srcset'); if (srcset) img.setAttribute('srcset', srcset);
        img.src = src;
        if (title && t) title.textContent = t; if (kicker && k) kicker.textContent = k;
        const done = () => img.classList.remove('is-swapping');
        if (img.complete) done(); else img.addEventListener('load', done, { once: true });
      }, 120);
    };
    panel.querySelectorAll('a[data-hover-img]').forEach((a) => {
      a.addEventListener('mouseenter', () => swap(a.dataset.hoverImg, '', a.dataset.hoverSub || a.dataset.hoverTitle, a.dataset.hoverTitle));
      a.addEventListener('focus', () => swap(a.dataset.hoverImg, '', a.dataset.hoverSub || a.dataset.hoverTitle, a.dataset.hoverTitle));
      const pre = new Image(); pre.src = a.dataset.hoverImg;
    });
    const links = panel.querySelector('.tw-mega__links');
    if (links) links.addEventListener('mouseleave', () => swap(def.src, def.srcset, def.title, def.kicker));
  });

  /* ---------- Drawers (dialog) ---------- */
  const openDrawer = (id, opener) => {
    const d = document.getElementById(id);
    if (!d || typeof d.showModal !== 'function') return false;
    if (!d.open) {
      d._opener = opener || document.activeElement;
      d.classList.remove('is-closing');
      d.showModal();
      document.documentElement.classList.add('is-locked');
      requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('is-open')));
      $$('[aria-controls="' + id + '"]').forEach((b) => b.setAttribute('aria-expanded', 'true'));
      const first = d.querySelector('input[type="search"]');
      if (first) setTimeout(() => first.focus(), 120);
    }
    return true;
  };
  const closeDrawer = (d) => {
    if (!d || !d.open || d.classList.contains('is-closing')) return;
    d.classList.add('is-closing');
    d.classList.remove('is-open');
    const done = () => { d.close(); d.classList.remove('is-closing'); if (!$('dialog.tw-drawer[open]')) document.documentElement.classList.remove('is-locked'); if (d._opener && d._opener.focus) d._opener.focus({ preventScroll: true }); };
    if (reduced) done(); else setTimeout(done, 380);
    $$('[aria-controls="' + d.id + '"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  };
  TW.openDrawer = openDrawer;
  TW.closeDrawer = closeDrawer;
  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-open]');
    if (opener) {
      if (opener.getAttribute('data-open') === 'tw-cart' && document.body.classList.contains('template-cart')) return;
      if (openDrawer(opener.getAttribute('data-open'), opener)) e.preventDefault();
      return;
    }
    const closer = e.target.closest('[data-close]');
    if (closer) { const d = closer.closest('dialog'); if (d) { d.classList.contains('tw-drawer') ? closeDrawer(d) : d.close(); } return; }
    if (e.target.matches('dialog.tw-drawer')) closeDrawer(e.target);
    if (e.target.matches('dialog.tw-lightbox')) e.target.close();
  });
  document.addEventListener('cancel', (e) => { if (e.target.matches('dialog.tw-drawer')) { e.preventDefault(); closeDrawer(e.target); } }, true);

  /* ---------- Cart ---------- */
  const CART_SECTION = 'tw-cart-drawer';
  const setCount = (n) => {
    $$('[data-cart-count]').forEach((el) => {
      el.textContent = n;
      el.classList.toggle('is-empty', n === 0);
      el.classList.remove('is-bump'); void el.offsetWidth; if (n > 0) el.classList.add('is-bump');
    });
    $$('.tw-cartbtn').forEach((b) => b.setAttribute('aria-label', 'Avaa ostoskori, ' + n + ' tuotetta'));
  };
  const renderDrawer = (html) => {
    if (!html) return;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const fresh = doc.querySelector('[data-cart-inner]');
    const cur = $('[data-cart-inner]');
    if (fresh && cur) cur.innerHTML = fresh.innerHTML;
  };
  const cartJSON = () => fetch(routes.cart + '.js', { headers: { Accept: 'application/json' } }).then((r) => r.json());
  TW.refreshCart = () => fetch(routes.root + '?section_id=' + CART_SECTION).then((r) => r.text()).then((h) => { renderDrawer(h); return cartJSON(); }).then((c) => setCount(c.item_count)).catch(() => {});

  TW.addToCart = async (payload, { open = true, btn } = {}) => {
    const body = payload instanceof FormData ? payload : (() => { const f = new FormData(); Object.entries(payload).forEach(([k, v]) => f.append(k, v)); return f; })();
    // Mengenbegrenzung: max. 10 Stück pro Produkt und Kunde
    const vid = String(body.get('id') || '');
    let want = parseInt(body.get('quantity') || '1', 10) || 1;
    try {
      const c0 = await cartJSON();
      const item = c0.items.find((it) => String(it.variant_id) === vid || String(it.id) === vid);
      const pid = item && item.product_id;
      const have = c0.items.filter((it) => (pid ? it.product_id === pid : String(it.variant_id) === vid)).reduce((n, it) => n + it.quantity, 0);
      if (have + want > TW.MAXQ) {
        want = TW.MAXQ - have;
        if (want <= 0) throw new Error(S.maxq);
        body.set('quantity', String(want));
        TW.toast(S.maxq);
      }
    } catch (err) { if (err.message === S.maxq) throw err; }
    body.append('sections', CART_SECTION);
    body.append('sections_url', window.location.pathname);
    if (btn) btn.classList.add('is-loading');
    try {
      const res = await fetch(routes.cartAdd + '.js', { method: 'POST', body, headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
      const data = await res.json();
      if (!res.ok || data.status) throw new Error(data.description || data.message || S.error);
      if (data.sections) renderDrawer(data.sections[CART_SECTION]);
      const cart = await cartJSON();
      setCount(cart.item_count);
      if (open && !document.body.classList.contains('template-cart')) openDrawer('tw-cart'); else TW.toast(S.added);
      document.dispatchEvent(new CustomEvent('tw:cart:added', { detail: data }));
      return data;
    } finally {
      if (btn) btn.classList.remove('is-loading');
    }
  };

  const changeLine = async (line, quantity) => {
    if (quantity > TW.MAXQ) { quantity = TW.MAXQ; TW.toast(S.maxq); }
    const inner = $('[data-cart-inner]');
    if (inner) inner.classList.add('is-loading');
    try {
      const res = await fetch(routes.cartChange + '.js', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ line, quantity, sections: [CART_SECTION], sections_url: window.location.pathname }) });
      const data = await res.json();
      if (!res.ok || data.status) { TW.toast(data.description || data.message || S.error); await TW.refreshCart(); return; }
      renderDrawer(data.sections && data.sections[CART_SECTION]);
      setCount(data.item_count);
    } catch (e) { TW.toast(S.error); } finally { const i = $('[data-cart-inner]'); if (i) i.classList.remove('is-loading'); }
  };

  // quick add
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-quick-add]');
    if (!btn) return;
    e.preventDefault();
    try {
      await TW.addToCart({ id: btn.getAttribute('data-quick-add'), quantity: 1 }, { btn });
      btn.classList.add('is-done'); setTimeout(() => btn.classList.remove('is-done'), 1400);
    } catch (err) { TW.toast(err.message || S.error); }
  });

  // drawer line controls
  const lineQtyChange = debounce((li, q) => changeLine(Number(li.dataset.line), q), 350);
  document.addEventListener('click', (e) => {
    const li = e.target.closest('#tw-cart [data-line]');
    if (li && e.target.closest('[data-line-remove]')) { changeLine(Number(li.dataset.line), 0); return; }
    const qtyBtn = e.target.closest('[data-qty-minus], [data-qty-plus]');
    if (!qtyBtn) return;
    const wrap = qtyBtn.closest('[data-qty]');
    const input = wrap && wrap.querySelector('input');
    if (!input) return;
    const min = input.min !== '' ? Number(input.min) : 0;
    const max = input.max !== '' ? Number(input.max) : Infinity;
    let v = Number(input.value) || 0;
    v = qtyBtn.hasAttribute('data-qty-plus') ? Math.min(max, v + 1) : Math.max(min, v - 1);
    input.value = v;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (li) lineQtyChange(li, v);
  });
  document.addEventListener('change', (e) => {
    if (!e.target.matches('#tw-cart [data-line-qty]') || e.isTrusted === false) return;
    const li = e.target.closest('[data-line]');
    if (li) lineQtyChange(li, Math.max(0, Number(e.target.value) || 0));
  });

  /* ---------- Product form ---------- */
  $$('[data-product-form]').forEach((form) => {
    const err = form.querySelector('[data-form-error]');
    form.addEventListener('submit', async (e) => {
      if (e.submitter && e.submitter.hasAttribute('data-buy-now')) return; // native: add + redirect to checkout
      e.preventDefault();
      const btn = form.querySelector('[data-atc]');
      if (err) err.hidden = true;
      try {
        await TW.addToCart(new FormData(form), { btn });
        if (btn) { btn.classList.add('is-added'); const t = btn.querySelector('[data-atc-text]'); const old = t.textContent; t.textContent = S.added; setTimeout(() => { btn.classList.remove('is-added'); t.textContent = old; }, 1800); }
      } catch (ex) { if (err) { err.textContent = ex.message || S.error; err.hidden = false; } }
    });
  });

  /* ---------- Variant picker ---------- */
  $$('[data-product]').forEach((root) => {
    const json = root.querySelector('[data-variants]');
    if (!json) return;
    const variants = JSON.parse(json.textContent);
    const input = root.querySelector('[data-variant-input]');
    const atc = root.querySelector('[data-atc]');
    const buyNow = root.querySelector('[data-buy-now]');
    const priceWrap = root.querySelector('[data-pdp-price] [data-price]');
    const sticky = root.querySelector('[data-sticky-price]');
    const update = (init) => {
      const opts = $$('input[data-option-index]:checked', root).sort((a, b) => a.dataset.optionIndex - b.dataset.optionIndex).map((i) => i.value);
      opts.forEach((v, i) => { const l = root.querySelector('[data-opt-label="' + i + '"]'); if (l) l.textContent = v; });
      const v = variants.find((x) => x.options.every((o, i) => o === opts[i]));
      // grey out option values that are sold out together with the other selected options
      $$('input[data-option-index]', root).forEach((inp) => {
        const idx = Number(inp.dataset.optionIndex);
        const ok = variants.some((x) => x.available && x.options[idx] === inp.value && x.options.every((o, i) => i === idx || o === opts[i]));
        inp.closest('label').classList.toggle('is-out', !ok);
      });
      if (!v) { if (atc) { atc.disabled = true; atc.querySelector('[data-atc-text]').textContent = 'Ei saatavilla'; } return; }
      input.value = v.id;
      if (atc) { atc.disabled = !v.available; atc.querySelector('[data-atc-text]').textContent = v.available ? atc.dataset.label : S.soldOut; }
      if (buyNow) buyNow.disabled = !v.available;
      // stock line, SKU, quantity limit and back-in-stock form follow the selected variant
      const stock = root.querySelector('[data-pdp-stock]');
      if (stock) {
        const q = Number(v.inventory_quantity) || 0; const lowAt = Number(stock.dataset.low) || 3;
        const isLow = v.available && v.inventory_management && q > 0 && q <= lowAt;
        stock.classList.toggle('tw-stock--out', !v.available); stock.classList.toggle('tw-stock--low', !!isLow);
        const st = stock.querySelector('[data-pdp-stock-text]');
        if (st) st.textContent = !v.available ? 'Tämä vaihtoehto on loppunut varastosta' : isLow ? 'Varastossa enää ' + q + ' kpl' : 'Varastossa · toimitus ' + stock.dataset.delivery;
      }
      const sku = root.querySelector('[data-pdp-sku]'); if (sku && v.sku) sku.textContent = v.sku;
      const shade = root.querySelector('[data-shade]');
      if (shade && v.colour_hex) { shade.style.setProperty('--c', v.colour_hex); const sn = shade.querySelector('[data-shade-name]'); if (sn) sn.textContent = v.option1; }
      const qty = root.querySelector('input[name="quantity"]');
      if (qty) { const cap = v.inventory_management && v.inventory_policy !== 'continue' ? Math.max(1, Math.min(10, Number(v.inventory_quantity) || 1)) : 10; qty.max = cap; if (Number(qty.value) > cap) qty.value = cap; }
      const bis = root.querySelector('[data-bis-wrap]');
      if (bis) { bis.hidden = !!v.available; const bi = bis.querySelector('input[name="variant_id"]'); if (bi) bi.value = v.id; }
      const stickyBtn = root.querySelector('[data-sticky-trigger]');
      if (stickyBtn) { stickyBtn.disabled = !v.available; const sp = stickyBtn.querySelector('span'); if (sp) sp.textContent = v.available ? (atc ? atc.dataset.label : '') : S.soldOut; }
      if (priceWrap) {
        const now = priceWrap.querySelector('.tw-price__now');
        if (now) now.textContent = TW.formatMoney(v.price);
        let was = priceWrap.querySelector('.tw-price__was');
        if (v.compare_at_price > v.price) { if (!was) { was = document.createElement('s'); was.className = 'tw-price__was'; now.after(was); } was.textContent = TW.formatMoney(v.compare_at_price); } else if (was) was.remove();
      }
      if (sticky) sticky.textContent = TW.formatMoney(v.price);
      if (init !== true) { const url = new URL(window.location.href); url.searchParams.set('variant', v.id); history.replaceState(null, '', url); }
      if (v.featured_media) {
        const slide = root.querySelector('[data-media-id="' + v.featured_media.id + '"]');
        if (slide) slide.parentElement.scrollTo({ left: slide.offsetLeft, behavior: reduced ? 'auto' : 'smooth' });
      }
    };
    root.addEventListener('change', (e) => { if (e.target.matches('input[data-option-index]')) update(); });
    update(true);
  });

  /* ---------- Sticky ATC ---------- */
  $$('[data-sticky-atc]').forEach((bar) => {
    const main = $('[data-atc]');
    if (!main || !('IntersectionObserver' in window)) return;
    const trig = bar.querySelector('[data-sticky-trigger]');
    new IntersectionObserver(([entry]) => {
      const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      bar.classList.toggle('is-visible', show);
      bar.setAttribute('aria-hidden', show ? 'false' : 'true');
      if (trig) trig.tabIndex = show ? 0 : -1;
    }).observe(main);
    if (trig) trig.addEventListener('click', () => { main.click(); });
  });

  /* ---------- Gallery ---------- */
  $$('[data-gallery]').forEach((g) => {
    const track = g.querySelector('[data-gallery-track]');
    const thumbs = $$('[data-thumb]', g);
    const lightbox = $('[data-lightbox]');
    thumbs.forEach((t) => t.addEventListener('click', () => {
      const slide = track.children[Number(t.dataset.thumb)];
      if (slide) track.scrollTo({ left: slide.offsetLeft, behavior: reduced ? 'auto' : 'smooth' });
    }));
    if (track && thumbs.length) {
      track.addEventListener('scroll', debounce(() => {
        const i = Math.round(track.scrollLeft / track.clientWidth);
        thumbs.forEach((t, j) => { t.classList.toggle('is-active', i === j); if (i === j) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current'); });
      }, 60), { passive: true });
    }
    $$('[data-zoom]', g).forEach((z) => {
      if (finePointer) {
        z.addEventListener('pointerenter', () => z.classList.add('is-zoom'));
        z.addEventListener('pointerleave', () => z.classList.remove('is-zoom'));
        z.addEventListener('pointermove', (e) => {
          const r = z.getBoundingClientRect();
          z.style.setProperty('--zx', ((e.clientX - r.left) / r.width) * 100 + '%');
          z.style.setProperty('--zy', ((e.clientY - r.top) / r.height) * 100 + '%');
        });
      }
      z.addEventListener('click', () => {
        if (!lightbox || typeof lightbox.showModal !== 'function') return;
        lightbox.querySelector('[data-lightbox-img]').src = z.dataset.zoom;
        lightbox.showModal();
      });
    });
  });

  /* ---------- Tabs ---------- */
  $$('[data-tabs]').forEach((tabs) => {
    const list = tabs.querySelector('[role="tablist"]');
    const btns = $$('[role="tab"]', list);
    const ink = list.querySelector('.tw-tabs__ink');
    const moveInk = (b) => { if (!ink) return; ink.style.setProperty('--w', b.offsetWidth + 'px'); ink.style.setProperty('--x', b.offsetLeft + 'px'); };
    const select = (b, focus) => {
      btns.forEach((x) => { const on = x === b; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; const p = document.getElementById(x.getAttribute('aria-controls')); if (p) p.hidden = !on; });
      moveInk(b); if (focus) b.focus();
    };
    btns.forEach((b, i) => {
      b.addEventListener('click', () => select(b));
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); select(btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length], true); }
        if (e.key === 'Home') { e.preventDefault(); select(btns[0], true); }
        if (e.key === 'End') { e.preventDefault(); select(btns[btns.length - 1], true); }
      });
    });
    const cur = btns.find((b) => b.getAttribute('aria-selected') === 'true') || btns[0];
    requestAnimationFrame(() => moveInk(cur));
    window.addEventListener('resize', debounce(() => moveInk(btns.find((b) => b.getAttribute('aria-selected') === 'true')), 150));
  });

  /* ---------- Reveal + counters ---------- */
  const animateCount = (el) => {
    const target = Number(el.dataset.count) || 0;
    if (reduced || target === 0) { el.textContent = nf.format(target); return; }
    const dur = 1700; const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      el.textContent = nf.format(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(step);
    };
    el.textContent = '0';
    requestAnimationFrame(step);
  };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add('is-in');
      $$('[data-count]', en.target).forEach((c) => { if (!c._done) { c._done = true; animateCount(c); } });
      io.unobserve(en.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }) : null;
  TW.reveal = (root = document) => {
    $$('[data-reveal]', root).forEach((el) => { if (io && !el.classList.contains('is-in')) io.observe(el); else el.classList.add('is-in'); });
    if (!io) $$('[data-count]', root).forEach((c) => { c.textContent = nf.format(Number(c.dataset.count) || 0); });
  };
  TW.reveal();

  /* ---------- Countdown ---------- */
  /* Target comes from data-countdown-ts (epoch ms, rendered by Liquid from the product's
     release date, so no browser date parsing). Legacy data-countdown="YYYY-MM-DDTHH:MM"
     is parsed by hand as local time (Safari-safe). Missing/past date → countdown hidden. */
  const pad = (n) => String(n).padStart(2, '0');
  const cdTarget = (el) => {
    if (el._t !== undefined) return el._t;
    let t = NaN;
    if (el.dataset.countdownTs) t = Number(el.dataset.countdownTs);
    else if (el.dataset.countdown) {
      const m = el.dataset.countdown.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
      t = m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime() : NaN;
    }
    el._t = Number.isFinite(t) && t > 0 ? t : -1;
    return el._t;
  };
  const hideCountdown = (el) => {
    el.classList.add('is-done');
    const wrap = el.closest('[data-countdown-wrap]');
    (wrap || el).hidden = true;
  };
  const tickCountdowns = () => {
    const now = Date.now();
    $$('[data-countdown]').forEach((el) => {
      if (el.classList.contains('is-done')) return;
      const t = cdTarget(el);
      let diff = Math.floor((t - now) / 1000);
      if (t < 0 || diff <= 0) { hideCountdown(el); return; }
      const d = Math.floor(diff / 86400); diff -= d * 86400;
      const h = Math.floor(diff / 3600); diff -= h * 3600;
      const m = Math.floor(diff / 60); const s = diff - m * 60;
      [['[data-d]', d], ['[data-h]', h], ['[data-m]', m], ['[data-s]', s]].forEach(([sel, val]) => {
        const b = el.querySelector(sel); if (!b) return;
        const txt = sel === '[data-d]' ? String(val) : pad(val);
        if (b.textContent !== txt) { b.textContent = txt; if (!reduced && sel === '[data-s]') { b.classList.remove('is-tick'); void b.offsetWidth; b.classList.add('is-tick'); } }
      });
    });
  };
  tickCountdowns();
  setInterval(tickCountdowns, 1000);
  /* Mobile Safari/Chrome pause timers in background tabs and restore pages from bfcache */
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tickCountdowns(); });
  window.addEventListener('pageshow', tickCountdowns);

  /* ---------- Carousel ---------- */
  $$('[data-carousel]').forEach((c) => {
    const track = c.querySelector('[data-carousel-track]');
    const section = c.closest('section');
    const prev = section && section.querySelector('[data-carousel-prev]');
    const next = section && section.querySelector('[data-carousel-next]');
    const dotsWrap = c.querySelector('[data-carousel-dots]');
    const slides = Array.from(track.children);
    if (!slides.length) return;
    const step = () => (slides[0].getBoundingClientRect().width + 16);
    const go = (dir) => {
      const max = track.scrollWidth - track.clientWidth - 4;
      if (dir > 0 && track.scrollLeft >= max) track.scrollTo({ left: 0, behavior: reduced ? 'auto' : 'smooth' });
      else if (dir < 0 && track.scrollLeft <= 4) track.scrollTo({ left: track.scrollWidth, behavior: reduced ? 'auto' : 'smooth' });
      else track.scrollBy({ left: dir * step(), behavior: reduced ? 'auto' : 'smooth' });
    };
    if (prev) prev.addEventListener('click', () => go(-1));
    if (next) next.addEventListener('click', () => go(1));
    track.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } });
    if (dotsWrap) {
      slides.forEach((s, i) => { const b = document.createElement('button'); b.type = 'button'; b.tabIndex = -1; b.addEventListener('click', () => track.scrollTo({ left: s.offsetLeft - track.offsetLeft, behavior: 'smooth' })); dotsWrap.appendChild(b); });
      const sync = () => { const i = Math.round(track.scrollLeft / step()); $$('button', dotsWrap).forEach((b, j) => b.classList.toggle('is-active', j === Math.min(i, slides.length - 1))); };
      track.addEventListener('scroll', debounce(sync, 50), { passive: true }); sync();
    }
    if (c.dataset.autoplay === 'true' && !reduced && slides.length > 1) {
      let paused = false;
      ['pointerenter', 'focusin'].forEach((ev) => c.addEventListener(ev, () => { paused = true; }));
      ['pointerleave', 'focusout'].forEach((ev) => c.addEventListener(ev, () => { paused = false; }));
      setInterval(() => { if (!paused && !document.hidden && c.getBoundingClientRect().top < window.innerHeight) go(1); }, 5500);
    }
  });

  /* ---------- 3D tilt ---------- */
  if (finePointer && !reduced) {
    const MAX = 7;
    document.addEventListener('pointermove', (e) => {
      const el = e.target.closest && e.target.closest('[data-tilt]');
      if (!el) return;
      if (el._raf) return;
      el._raf = requestAnimationFrame(() => {
        el._raf = 0;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height;
        el.style.setProperty('--ry', ((x - 0.5) * 2 * MAX).toFixed(2) + 'deg');
        el.style.setProperty('--rx', ((0.5 - y) * 2 * MAX).toFixed(2) + 'deg');
        el.style.setProperty('--gx', (x * 100).toFixed(1) + '%');
        el.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
        el.classList.add('is-tilting');
      });
    }, { passive: true });
    document.addEventListener('pointerout', (e) => {
      const el = e.target.closest && e.target.closest('[data-tilt]');
      if (!el || el.contains(e.relatedTarget)) return;
      el.classList.remove('is-tilting');
      el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg');
    });
  }

  /* ---------- Hero parallax ---------- */
  const hero = $('[data-hero]');
  if (hero && !reduced) {
    const layers = $$('[data-parallax]', hero);
    let px = 0, py = 0, sy = 0, raf = 0;
    const paint = () => {
      raf = 0;
      layers.forEach((l) => {
        const d = Number(l.dataset.parallax) || 0;
        const isOrb = l.classList.contains('tw-hero__orb');
        const tx = isOrb ? 0 : px * d * 18; const ty = (isOrb ? sy * d : py * d * 18 - sy * d * 0.08);
        l.style.transform = 'translate3d(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px,0)';
      });
    };
    const req = () => { if (!raf) raf = requestAnimationFrame(paint); };
    if (finePointer) hero.addEventListener('pointermove', (e) => { const r = hero.getBoundingClientRect(); px = (e.clientX - r.left) / r.width - 0.5; py = (e.clientY - r.top) / r.height - 0.5; req(); }, { passive: true });
    window.addEventListener('scroll', () => { sy = Math.min(window.scrollY, 1200); req(); }, { passive: true });
  }

  /* ---------- Predictive search ---------- */
  $$('[data-predictive]').forEach((form) => {
    const input = form.querySelector('input[type="search"]');
    const box = form.querySelector('[data-predictive-results]');
    if (!input || !box || !routes.predictive) return;
    let ctrl, active = -1;
    const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const close = () => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
    const run = debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) { close(); return; }
      if (ctrl) ctrl.abort();
      ctrl = new AbortController();
      try {
        const url = routes.predictive + '.json?q=' + encodeURIComponent(q) + '&resources[type]=product,collection&resources[limit]=6&resources[options][unavailable_products]=last';
        const data = await fetch(url, { signal: ctrl.signal }).then((r) => r.json());
        const res = (data.resources && data.resources.results) || {};
        const prods = res.products || []; const cols = res.collections || [];
        let html = '';
        if (!prods.length && !cols.length) html = '<p class="tw-predictive__empty">' + esc(S.noResults) + '</p>';
        cols.slice(0, 2).forEach((c) => { html += '<a role="option" class="tw-predictive__item" href="' + esc(c.url) + '"><span class="tw-predictive__ph"></span><div><p>' + esc(c.title) + '</p><span>Kategoria</span></div></a>'; });
        prods.forEach((p) => {
          const img = p.featured_image && p.featured_image.url ? '<img src="' + esc(p.featured_image.url) + (p.featured_image.url.indexOf('?') > -1 ? '&' : '?') + 'width=120" alt="" loading="lazy" width="52" height="52">' : '<span class="tw-predictive__ph"></span>';
          const price = p.price ? new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' }).format(Number(p.price)) : '';
          html += '<a role="option" class="tw-predictive__item" href="' + esc(p.url) + '">' + img + '<div><p>' + esc(p.title) + '</p><span>' + (p.available === false ? 'Loppu varastosta' : price) + '</span></div></a>';
        });
        html += '<a class="tw-predictive__all" href="' + esc(routes.search) + '?q=' + encodeURIComponent(q) + '&type=product&options[prefix]=last">Kaikki tulokset haulle ”' + esc(q) + '”</a>';
        box.innerHTML = html; box.hidden = false; input.setAttribute('aria-expanded', 'true'); active = -1;
      } catch (e) { if (e.name !== 'AbortError') close(); }
    }, 220);
    input.addEventListener('input', run);
    input.addEventListener('focus', () => { if (box.innerHTML && input.value.trim().length > 1) { box.hidden = false; input.setAttribute('aria-expanded', 'true'); } });
    input.addEventListener('keydown', (e) => {
      const items = $$('[role="option"], .tw-predictive__all', box);
      if (e.key === 'Escape') { const wasOpen = !box.hidden; close(); if (!wasOpen) { const dlg = input.closest('dialog.tw-drawer'); if (dlg && dlg.open) { e.preventDefault(); closeDrawer(dlg); } } return; }
      if (box.hidden || !items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((it, i) => it.setAttribute('aria-selected', i === active));
        items[active].scrollIntoView({ block: 'nearest' });
      }
      if (e.key === 'Enter' && active > -1) { e.preventDefault(); items[active].click(); }
    });
    document.addEventListener('click', (e) => { if (!form.contains(e.target)) close(); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.target.closest('input, textarea, select, [contenteditable]')) return;
    const inp = $('.tw-header .tw-search input[type="search"]');
    if (inp && inp.offsetParent) { e.preventDefault(); inp.focus(); } else { e.preventDefault(); openDrawer('tw-search-overlay'); }
  });

  /* ---------- Wishlist ---------- */
  const WL = 'tw-wishlist';
  const getWL = () => store.get(WL, []);
  const syncWL = () => {
    const list = getWL();
    $$('[data-wishlist]').forEach((b) => b.setAttribute('aria-pressed', list.includes(b.dataset.wishlist) ? 'true' : 'false'));
    $$('[data-wishlist-count]').forEach((c) => { c.textContent = list.length; c.classList.toggle('is-empty', list.length === 0); });
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-wishlist]');
    if (!b) return;
    e.preventDefault();
    let list = getWL(); const h = b.dataset.wishlist; const has = list.includes(h);
    list = has ? list.filter((x) => x !== h) : [h, ...list].slice(0, 60);
    store.set(WL, list); syncWL();
    b.classList.remove('is-pop'); void b.offsetWidth; b.classList.add('is-pop');
    TW.toast(has ? S.wishlistRemove : S.wishlistAdd);
    const grid = $('[data-wishlist-grid]');
    if (grid && has) { const card = b.closest('.tw-card'); if (card) card.remove(); if (!getWL().length) { const em = $('[data-wishlist-empty]'); if (em) em.hidden = false; } }
  });
  syncWL();
  const wlGrid = $('[data-wishlist-grid]');
  if (wlGrid) {
    const list = getWL(); const empty = $('[data-wishlist-empty]');
    if (!list.length) { if (empty) empty.hidden = false; } else {
      Promise.all(list.map((h) => fetch(routes.root + 'products/' + encodeURIComponent(h) + '?section_id=tw-card-render').then((r) => (r.ok ? r.text() : '')).catch(() => ''))).then((htmls) => {
        const frag = document.createElement('div');
        htmls.forEach((h) => { if (!h) return; const d = new DOMParser().parseFromString(h, 'text/html'); const card = d.querySelector('.tw-card'); if (card) frag.appendChild(card); });
        wlGrid.innerHTML = frag.innerHTML;
        if (!wlGrid.children.length && empty) empty.hidden = false;
        syncWL(); TW.reveal(wlGrid);
      });
    }
  }

  /* ---------- Recommendations ---------- */
  $$('[data-recos]').forEach((sec) => {
    const url = sec.dataset.url; if (!url) return;
    const load = () => fetch(url).then((r) => r.text()).then((h) => {
      const d = new DOMParser().parseFromString(h, 'text/html');
      const fresh = d.querySelector('[data-recos]');
      if (fresh && fresh.innerHTML.trim()) { sec.innerHTML = fresh.innerHTML; syncWL(); TW.reveal(sec); if (!sec.querySelector('.tw-card')) sec.hidden = true; } else sec.hidden = true;
    }).catch(() => { sec.hidden = true; });
    if ('IntersectionObserver' in window) { const o = new IntersectionObserver(([en]) => { if (en.isIntersecting) { o.disconnect(); load(); } }, { rootMargin: '400px' }); o.observe(sec); } else load();
  });

  /* ---------- Collection filters ---------- */
  const coll = $('[data-collection]');
  if (coll) {
    const sectionId = coll.dataset.section;
    const render = async (url, push = true) => {
      coll.classList.add('is-loading');
      try {
        const u = new URL(url, window.location.origin); u.searchParams.set('section_id', sectionId);
        const html = await fetch(u).then((r) => r.text());
        const d = new DOMParser().parseFromString(html, 'text/html');
        const fresh = d.getElementById('tw-collection-results');
        const cur = document.getElementById('tw-collection-results');
        const wasOpen = $('[data-filters]', coll).classList.contains('is-open');
        if (fresh && cur) cur.innerHTML = fresh.innerHTML;
        if (wasOpen) { $('[data-filters]', coll).classList.add('is-open'); coll.classList.add('filters-open'); }
        const freshHero = d.querySelector('.tw-collection__hero'); const curHero = $('.tw-collection__hero', coll);
        if (freshHero && curHero) curHero.innerHTML = freshHero.innerHTML;
        if (push) { const clean = new URL(url, window.location.origin); clean.searchParams.delete('section_id'); history.pushState({ tw: 1 }, '', clean); }
        syncWL(); TW.reveal(coll); tickCountdowns();
      } catch (e) { window.location.href = url; } finally { coll.classList.remove('is-loading'); }
    };
    const fromForm = () => {
      const form = $('[data-filter-form]', coll);
      const params = new URLSearchParams();
      new FormData(form).forEach((v, k) => { if (v !== '') params.append(k, v); });
      const sort = $('[data-sort]', coll); if (sort && sort.value) params.set('sort_by', sort.value);
      return form.getAttribute('action') + (params.toString() ? '?' + params.toString() : '');
    };
    const go = debounce(() => render(fromForm()), 380);
    coll.addEventListener('change', (e) => { if (e.target.closest('[data-filter-form]') || e.target.matches('[data-sort]')) go(); });
    coll.addEventListener('input', (e) => { if (e.target.closest('.tw-price-range')) go(); });
    coll.addEventListener('submit', (e) => { if (e.target.matches('[data-filter-form]')) { e.preventDefault(); render(fromForm()); } });
    coll.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-filter-link], .tw-fset, .tw-active-filters a');
      if (a && a.href && a.origin === window.location.origin) { e.preventDefault(); render(a.href); return; }
      if (e.target.closest('[data-filters-open]')) { $('[data-filters]', coll).classList.add('is-open'); coll.classList.add('filters-open'); document.documentElement.classList.add('is-locked'); }
      if (e.target.closest('[data-filters-close]')) { $('[data-filters]', coll).classList.remove('is-open'); coll.classList.remove('filters-open'); document.documentElement.classList.remove('is-locked'); }
    });
    window.addEventListener('popstate', () => render(window.location.href, false));
  }

  /* ---------- Cookie consent (Shopify Customer Privacy API) ---------- */
  const banner = $('[data-cookie-banner]');
  if (banner) {
    const prefs = banner.querySelector('[data-cookie-prefs]');
    const btnSettings = banner.querySelector('[data-cookie-settings]');
    const btnSave = banner.querySelector('[data-cookie-save]');
    const KEY = 'tw-consent-v1';
    const api = () => window.Shopify && window.Shopify.customerPrivacy;
    const show = (withPrefs) => {
      banner.hidden = false; banner.classList.remove('is-hiding');
      if (withPrefs) { prefs.hidden = false; btnSave.hidden = false; btnSettings.setAttribute('aria-expanded', 'true'); }
      const cp = api();
      if (cp && cp.currentVisitorConsent) {
        const c = cp.currentVisitorConsent();
        $$('[data-consent]', banner).forEach((i) => { i.checked = c[i.dataset.consent] === 'yes'; });
      } else {
        const saved = store.get(KEY, null);
        if (saved) $$('[data-consent]', banner).forEach((i) => { i.checked = !!saved[i.dataset.consent]; });
      }
    };
    const hide = () => { banner.classList.add('is-hiding'); setTimeout(() => { banner.hidden = true; banner.classList.remove('is-hiding'); }, 380); };
    const decide = (c) => {
      store.set(KEY, Object.assign({ t: Date.now() }, c));
      const cp = api();
      if (cp && cp.setTrackingConsent) {
        cp.setTrackingConsent({ analytics: !!c.analytics, marketing: !!c.marketing, preferences: !!c.preferences, sale_of_data: !!c.marketing }, () => {});
      }
      hide();
    };
    banner.addEventListener('click', (e) => {
      if (e.target.closest('[data-cookie-all]')) decide({ analytics: true, marketing: true, preferences: true });
      else if (e.target.closest('[data-cookie-necessary]')) decide({ analytics: false, marketing: false, preferences: false });
      else if (e.target.closest('[data-cookie-save]')) { const c = {}; $$('[data-consent]', banner).forEach((i) => { c[i.dataset.consent] = i.checked; }); decide(c); }
      else if (e.target.closest('[data-cookie-settings]')) { const open = prefs.hidden; prefs.hidden = !open; btnSave.hidden = !open; btnSettings.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    });
    document.addEventListener('click', (e) => { if (e.target.closest('[data-cookie-open]')) { e.preventDefault(); show(true); } });
    const init = () => {
      if (document.getElementById('shopify-pc__banner') || document.querySelector('[id^="shopify-pc__"]')) return; // Shopify's own banner is active
      const cp = api();
      let needs;
      if (cp && typeof cp.shouldShowBanner === 'function') needs = cp.shouldShowBanner();
      else needs = !store.get(KEY, null);
      if (needs) show(false);
    };
    const boot = () => {
      if (window.Shopify && typeof window.Shopify.loadFeatures === 'function') {
        window.Shopify.loadFeatures([{ name: 'consent-tracking-api', version: '0.1' }], () => { setTimeout(init, 600); });
      } else init();
    };
    if (document.readyState === 'complete') boot(); else window.addEventListener('load', boot);
  }

  /* ---------- Misc ---------- */
  // Prevent zero-qty negative in generic qty inputs (cart page) is handled above.
  // Shopify theme editor: re-init visual bits on section reload
  document.addEventListener('shopify:section:load', (e) => { if (window.twDedupe) $$('[data-dd-grid]').forEach((g) => window.twDedupe(g)); TW.reveal(e.target); tickCountdowns(); syncWL(); });

  /* ---------- Delight animations (v6) ---------- */
  (() => {
    if (reduced) return;
    // Hero sparkles
    const hero = $('.tw-hero');
    if (hero && !$('.tw-sparkles', hero)) {
      const f = document.createElement('div'); f.className = 'tw-sparkles'; f.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 18; i++) {
        const s = document.createElement('i');
        s.style.cssText = `left:${Math.random() * 100}%;--s:${6 + Math.random() * 12}px;--d:${8 + Math.random() * 10}s;--delay:${-Math.random() * 14}s;--x:${(Math.random() * 120 - 60).toFixed(0)}px`;
        f.appendChild(s);
      }
      hero.prepend(f);
    }
    // Button ripple
    document.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.tw-btn'); if (!b) return;
      const r = b.getBoundingClientRect(); const d = Math.max(r.width, r.height);
      const span = document.createElement('span'); span.className = 'tw-ripple';
      span.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
      b.appendChild(span); setTimeout(() => span.remove(), 650);
    });
    // Add-to-cart burst + flying token
    let lastBtn = null;
    document.addEventListener('click', (e) => { const b = e.target.closest('[data-quick-add], [data-atc], .tw-pdp__atc'); if (b) lastBtn = b; }, true);
    const burst = (x, y) => {
      const w = document.createElement('div'); w.className = 'tw-burst'; w.style.left = x + 'px'; w.style.top = y + 'px';
      const cols = ['#FFD60A', '#E3262D', '#5A9BF0', '#FFE45C'];
      for (let i = 0; i < 14; i++) {
        const a = (Math.PI * 2 * i) / 14 + Math.random() * .4; const dist = 40 + Math.random() * 46;
        const s = document.createElement('i');
        s.style.cssText = `--tx:${Math.cos(a) * dist}px;--ty:${Math.sin(a) * dist}px;--c:${cols[i % 4]};width:${8 + Math.random() * 8}px;height:${8 + Math.random() * 8}px`;
        w.appendChild(s);
      }
      (document.querySelector('dialog[open]') || document.body).appendChild(w); setTimeout(() => w.remove(), 900);
    };
    document.addEventListener('tw:cart:added', () => {
      const btn = lastBtn && document.contains(lastBtn) ? lastBtn : null; lastBtn = null;
      const cart = $$('.tw-cartbtn, [data-open="tw-cart"]').find((el) => el.offsetParent !== null);
      if (btn) {
        const r = btn.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
        setTimeout(() => {
          burst(x, y);
          const dlg = document.querySelector('dialog[open]');
          if (dlg) { const h = dlg.querySelector('h2, .tw-drawer__title, header'); if (h) { const hr = h.getBoundingClientRect(); setTimeout(() => burst(hr.left + 70, hr.top + hr.height / 2), 260); } }
        }, 60);
        if (cart && !document.querySelector('dialog[open]')) {
          const c = cart.getBoundingClientRect(); const t = document.createElement('div'); t.className = 'tw-fly';
          t.style.left = x + 'px'; t.style.top = y + 'px'; document.body.appendChild(t);
          requestAnimationFrame(() => requestAnimationFrame(() => { t.style.transform = `translate(${c.left + c.width / 2 - x}px, ${c.top + c.height / 2 - y}px) scale(.4)`; t.style.opacity = '.2'; }));
          setTimeout(() => { t.remove(); cart.classList.remove('is-wiggle'); void cart.offsetWidth; cart.classList.add('is-wiggle'); }, 760);
        }
      } else if (cart) { cart.classList.remove('is-wiggle'); void cart.offsetWidth; cart.classList.add('is-wiggle'); }
    });
  })();
})();

/* Mengenbegrenzung Warenkorb-Seite */
document.addEventListener('submit', (e) => {
  const f = e.target;
  if (!f || !f.querySelector) return;
  let clamped = false;
  f.querySelectorAll('input[name="updates[]"], input[name="quantity"]').forEach((i) => { const mq = (window.TW && TW.MAXQ) || 10; if (Number(i.value) > mq) { i.value = mq; clamped = true; } });
  if (clamped && window.TW && TW.toast) TW.toast('Enintään 10 kappaletta samaa tuotetta.');
}, true);
