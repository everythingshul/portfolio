/* Site analytics for everythingshul.com. First-party, no cookies, nothing stored on the visitor's device
 * except a random per-tab id in sessionStorage that disappears when the tab closes.
 * Respects Do Not Track and Global Privacy Control. Never sends names, emails or chat text.
 * Sends to the chat Worker (js/chat-config.js). Other scripts report their own events with window.esTrack(). */
(() => {
  'use strict';
  const EP = (window.ES_CHAT_ENDPOINT || '').replace(/\/$/, '');
  const nav = navigator;
  const noop = () => {};
  const get = (s, k) => { try { return s.getItem(k); } catch (e) { return null; } };
  const set = (s, k, v) => { try { s.setItem(k, v); } catch (e) { /* ignore */ } };

  let off = !EP;
  try { if (nav.doNotTrack === '1' || window.doNotTrack === '1' || nav.msDoNotTrack === '1' || nav.globalPrivacyControl) off = true; } catch (e) { /* ignore */ }
  if (get(localStorage, 'es-no-track')) off = true;                       // set from the admin page to skip your own visits
  if (nav.webdriver && !/[?&]es_track=1/.test(location.search)) off = true; // automated browsers
  if (/^\/admin(\/|$)/.test(location.pathname)) off = true;
  if (off) { window.esTrack = noop; return; }

  /* ---------------------------------------------------------------- session */
  const rnd = () => { const a = new Uint32Array(3); crypto.getRandomValues(a); return Array.from(a, (n) => n.toString(36)).join('').slice(0, 16); };
  const t0 = Date.now();
  let sid = get(sessionStorage, 'es-sid');
  const lastSeen = parseInt(get(sessionStorage, 'es-last') || '0', 10);
  const fresh = !sid || t0 - lastSeen > 30 * 60 * 1000;
  if (fresh) { sid = rnd(); set(sessionStorage, 'es-sid', sid); }
  set(sessionStorage, 'es-last', String(t0));

  const PATH = location.pathname.replace(/index\.html$/, '') || '/';
  const here = location.host.replace(/^www\./, '');
  let ref = '';
  try { const r = new URL(document.referrer); if (r.host.replace(/^www\./, '') !== here) ref = document.referrer; } catch (e) { /* none */ }
  let utm = null;
  if (fresh) {
    const p = new URLSearchParams(location.search);
    utm = { s: p.get('utm_source') || '', m: p.get('utm_medium') || '', c: p.get('utm_campaign') || '', t: p.get('utm_term') || '', n: p.get('utm_content') || '' };
    set(sessionStorage, 'es-utm', JSON.stringify(utm));
  } else { try { utm = JSON.parse(get(sessionStorage, 'es-utm') || 'null'); } catch (e) { utm = null; } }

  const context = () => ({ sid, path: PATH, ref: fresh ? ref : '', w: window.innerWidth, h: window.innerHeight, lang: nav.language || '', tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || '', tp: nav.maxTouchPoints || 0, utm: fresh ? utm : null });

  /* ---------------------------------------------------------------- sending */
  const queue = [];
  let sent = 0, timer = null;
  const MAX = 220;
  const flush = (final) => {
    if (!queue.length) return;
    const now = Date.now();
    const body = JSON.stringify({ s: context(), e: queue.splice(0, 30).map((e) => ({ t: e.t, n: e.n, v: e.v, j: e.j, p: e.p, x: e.x, d: now - e.at })) });
    set(sessionStorage, 'es-last', String(now));
    try {
      if (final && nav.sendBeacon) nav.sendBeacon(EP + '/t', new Blob([body], { type: 'text/plain' }));
      else fetch(EP + '/t', { method: 'POST', body, headers: { 'Content-Type': 'text/plain' }, keepalive: true, credentials: 'omit' }).catch(noop);
    } catch (e) { /* analytics must never break the site */ }
    if (queue.length) { if (final) flush(true); else schedule(); }
  };
  const schedule = () => { if (!timer) timer = setTimeout(() => { timer = null; flush(false); }, 4000); };

  const track = (t, n, o) => {
    if (sent >= MAX) return;
    sent++;
    o = o || {};
    queue.push({ t, n: n || '', v: o.v, j: o.j, p: o.p || PATH, x: o.x, at: Date.now() });
    schedule();
  };
  window.esTrack = track;

  track('pv', '', { x: { t: (document.title || '').slice(0, 60) } });

  /* ---------------------------------------------------------------- how long and how far */
  let activeMs = 0, lastAct = Date.now(), maxScroll = 0;
  ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'].forEach((ev) => addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true, capture: true }));
  const dwell = {}; // project id -> ms visible
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastAct < 30000) activeMs += 1000;
    Object.keys(visible).forEach((id) => { if (visible[id]) dwell[id] = (dwell[id] || 0) + 1000; });
  }, 1000);

  const marks = [25, 50, 75, 90, 100];
  const hit = {};
  let ticking = false;
  const onScroll = () => {
    ticking = false;
    const h = document.documentElement;
    const pct = Math.round(((window.scrollY + window.innerHeight) / Math.max(h.scrollHeight, 1)) * 100);
    if (pct > maxScroll) maxScroll = Math.min(100, pct);
    marks.forEach((m) => { if (maxScroll >= m && !hit[m]) { hit[m] = 1; track('sc', String(m)); } });
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  setTimeout(onScroll, 1500);

  /* ---------------------------------------------------------------- which project was looked at */
  const visible = {};
  const seen = {};
  if ('IntersectionObserver' in window) {
    const timers = {};
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const id = en.target.id;
        visible[id] = en.isIntersecting;
        if (en.isIntersecting && !seen[id] && !timers[id]) {
          timers[id] = setTimeout(() => { if (visible[id]) { seen[id] = 1; track('pj', 'view', { j: id }); } timers[id] = null; }, 1000);
        }
      });
    }, { threshold: 0.5 });
    document.querySelectorAll('.project[id]').forEach((el) => io.observe(el));
  }

  /* ---------------------------------------------------------------- clicks */
  const projectOf = (el) => { const p = el.closest('.project[id]'); return p ? p.id : undefined; };
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest && ev.target.closest('a, button');
    if (!el || el.closest('.chat-panel, .chat-fab, .video-lightbox') || el.matches('.share-btn, .play-full, .nav-toggle')) return;
    const label = ((el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 40);
    if (el.tagName !== 'A') return;
    let cat = 'link', host = '';
    try {
      const u = new URL(el.href, location.href);
      if (u.protocol === 'mailto:') cat = 'mailto';
      else if (u.protocol === 'tel:') cat = 'tel';
      else if (u.host.replace(/^www\./, '') !== here) { cat = 'outbound'; host = (u.host + u.pathname).replace(/\/$/, '').slice(0, 80); }
    } catch (e) { return; }
    if (cat === 'link') {
      if (el.closest('.navbar, .mobile-nav')) cat = el.matches('.btn') ? 'cta' : 'nav';
      else if (el.closest('.site-footer')) cat = 'footer';
      else if (el.closest('.index')) cat = 'index';
      else if (el.matches('.btn, .btn-line') || el.closest('.hero-actions, .cta')) cat = 'cta';
    }
    track('ck', cat, { j: projectOf(el), x: { l: label, h: host } });
  }, true);

  /* ---------------------------------------------------------------- contact form (page-level; success is reported by main.js) */
  const fm = document.getElementById('contact-form');
  if (fm) {
    track('fm', 'view');
    let started = false;
    fm.addEventListener('focusin', (e) => { if (!started && e.target.name) { started = true; track('fm', 'start', { x: { f: e.target.name } }); } });
    fm.addEventListener('submit', () => track('fm', 'submit'));
  }

  /* ---------------------------------------------------------------- errors */
  let errs = 0;
  const err = (msg, src) => { if (errs++ < 5) track('er', String(msg || 'error').slice(0, 100), { x: { s: src || '' } }); };
  addEventListener('error', (e) => err(e.message, ((e.filename || '').split('/').pop() || '') + ':' + (e.lineno || 0)));
  addEventListener('unhandledrejection', (e) => err('Promise: ' + ((e.reason && e.reason.message) || e.reason), ''));

  /* ---------------------------------------------------------------- speed (Core Web Vitals) */
  const vit = { lcp: null, cls: 0, inp: 0, fcp: null };
  try {
    new PerformanceObserver((l) => { const e = l.getEntries(); if (e.length) vit.lcp = e[e.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) vit.cls += e.value; })).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.name === 'first-contentful-paint') vit.fcp = e.startTime; })).observe({ type: 'paint', buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.interactionId && e.duration > vit.inp) vit.inp = e.duration; })).observe({ type: 'event', durationThreshold: 40, buffered: true });
  } catch (e) { /* older browsers */ }
  let vitalsSent = false;
  const sendVitals = () => {
    if (vitalsSent) return;
    vitalsSent = true;
    const nv = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || null;
    const put = (n, v) => { if (v != null && isFinite(v) && v >= 0) track('vt', n, { v: Math.round(v * 1000) / 1000 }); };
    put('lcp', vit.lcp); put('fcp', vit.fcp); put('cls', vit.cls); if (vit.inp) put('inp', vit.inp);
    if (nv) { put('ttfb', nv.responseStart); put('load', nv.loadEventEnd); }
  };

  /* ---------------------------------------------------------------- leaving the page */
  const leave = () => {
    sendVitals();
    track('pe', '', { v: Math.round(activeMs / 1000), x: { sc: maxScroll } });
    activeMs = 0;
    Object.keys(dwell).forEach((id) => { if (dwell[id] >= 1000) track('dw', 'dwell', { j: id, v: Math.round(dwell[id] / 1000) }); dwell[id] = 0; });
    flush(true);
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leave(); });
  addEventListener('pagehide', leave);
})();
