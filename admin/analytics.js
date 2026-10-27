/* Analytics dashboard for the admin page. Reads from worker/chat (stats.js). */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (n == null || isNaN(n) ? '0' : Number(n).toLocaleString());
  const TZ = -new Date().getTimezoneOffset(); // minutes east of UTC, as the Worker expects
  const DAY = 86400000;

  const state = { range: '7d', from: 0, to: 0, view: 'overview', data: null, cmp: true, series: { visitors: true, sessions: false, pageviews: true }, timer: null, live: null };
  let api = null;
  const toast = (m) => (window.esToast ? window.esToast(m) : alert(m));

  /* ------------------------------------------------------------------ names */
  const PN = (id) => (window.ES_KB && window.ES_KB.projects[id] && window.ES_KB.projects[id].name) || id;
  const pathName = (p) => {
    if (!p) return '(unknown)';
    if (p === '/') return 'Home';
    if (p === '/contact.html') return 'Contact';
    const m = /^\/share\/([\w-]+)\/?$/.exec(p);
    if (m) return 'Shared link: ' + PN(m[1]);
    return p;
  };
  const topicName = (e) => {
    if (!e) return '(other)';
    if (e === 'random') return 'Random / off-topic question';
    if (e.startsWith('pj:')) return 'About a project: ' + e.slice(3);
    if (e.startsWith('L:')) return 'Taught answer';
    return e.replace(/_/g, ' ');
  };
  const countryName = (c) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(c) || c; } catch (e) { return c; } };
  const mins = (s) => (s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : Math.round(s) + 's');
  const ago = (ts) => { const s = Math.max(1, Math.round((Date.now() - ts) / 1000)); return s < 60 ? s + 's' : s < 3600 ? Math.round(s / 60) + 'm' : s < 86400 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd'; };

  /* ------------------------------------------------------------------ date ranges */
  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  function setRange(name, custom) {
    const now = Date.now();
    state.range = name;
    if (name === 'today') { state.from = dayStart(now); state.to = now + 1; }
    else if (name === 'yesterday') { state.from = dayStart(now) - DAY; state.to = dayStart(now); }
    else if (name === '7d') { state.from = dayStart(now) - 6 * DAY; state.to = now + 1; }
    else if (name === '30d') { state.from = dayStart(now) - 29 * DAY; state.to = now + 1; }
    else if (name === '90d') { state.from = dayStart(now) - 89 * DAY; state.to = now + 1; }
    else if (name === 'custom' && custom) { state.from = custom.from; state.to = custom.to; }
  }

  /* ------------------------------------------------------------------ small building blocks */
  const delta = (cur, prev, lowerBetter) => {
    if (!state.cmp || prev == null) return '';
    if (!prev) return cur ? '<span class="dl up">new</span>' : '';
    const ch = Math.round(((cur - prev) / prev) * 100);
    if (!ch) return '<span class="dl">no change</span>';
    const good = lowerBetter ? ch < 0 : ch > 0;
    return `<span class="dl ${good ? 'up' : 'down'}">${ch > 0 ? '▲' : '▼'} ${Math.abs(ch)}%</span>`;
  };
  const kpi = (label, value, d, hint) => `<div class="kpi" ${hint ? `title="${esc(hint)}"` : ''}><div class="kv">${value}</div><div class="kl">${esc(label)}</div><div class="kd">${d || ''}</div></div>`;
  const card = (title, body, cls, note) => `<section class="acard ${cls || ''}"><h3>${esc(title)}</h3>${note ? `<p class="anote">${esc(note)}</p>` : ''}${body}</section>`;
  const empty = '<div class="aempty">Nothing recorded for this period yet.</div>';

  function bars(rows, label, value, opts) {
    opts = opts || {};
    if (!rows || !rows.length) return empty;
    const max = Math.max(...rows.map((r) => value(r)), 1);
    const total = opts.total || rows.reduce((a, r) => a + value(r), 0) || 1;
    return '<div class="bars">' + rows.map((r) => {
      const v = value(r);
      return `<div class="bar"><div class="bl" title="${esc(label(r))}">${esc(label(r))}</div><div class="bt"><i style="width:${Math.max(2, (v / max) * 100)}%"></i></div><div class="bv">${fmt(v)}${opts.pct === false ? '' : ` <small>${Math.round((v / total) * 100)}%</small>`}</div></div>`;
    }).join('') + '</div>';
  }

  function table(head, rows) {
    if (!rows.length) return empty;
    return `<div class="tscroll"><table class="atable"><thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function funnel(steps) {
    const top = Math.max(steps[0].n, 1);
    return '<div class="funnel">' + steps.map((s, i) => {
      const prev = i ? steps[i - 1].n : null;
      const step = prev ? Math.round((s.n / prev) * 100) : 100;
      return `<div class="fstep"><div class="fh"><span>${esc(s.label)}</span><b>${fmt(s.n)}</b></div><div class="ft"><i style="width:${Math.max(1.5, (s.n / top) * 100)}%"></i></div><div class="fs">${i ? `${step}% of the previous step · ` : ''}${Math.round((s.n / top) * 100)}% of all</div></div>`;
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------------------ charts */
  const niceMax = (m) => { if (m <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(m))); const f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };

  function buckets(d) {
    const { from, to, hourly } = d.range; const tzMs = TZ * 60000; const out = [];
    const step = hourly ? 3600000 : DAY;
    const start = hourly ? Math.floor((from + tzMs) / step) * step - tzMs : Math.floor((from + tzMs) / DAY) * DAY - tzMs;
    for (let t = start; t < to; t += step) {
      const iso = new Date(t + tzMs).toISOString();
      out.push({ key: hourly ? iso.slice(0, 10) + ' ' + iso.slice(11, 13) + ':00' : iso.slice(0, 10), t });
    }
    return out;
  }

  function lineChart(d) {
    const bs = buckets(d); const map = Object.fromEntries(d.series.map((r) => [r.b, r]));
    const rows = bs.map((b) => ({ ...b, visitors: (map[b.key] || {}).visitors || 0, sessions: (map[b.key] || {}).sessions || 0, pageviews: (map[b.key] || {}).pageviews || 0 }));
    const keys = Object.keys(state.series).filter((k) => state.series[k]);
    const colors = { visitors: '#25a9ea', sessions: '#9be0a8', pageviews: '#c9a76a' };
    const W = 900, H = 270, P = { l: 46, r: 24, t: 14, b: 30 };
    const max = niceMax(Math.max(1, ...rows.flatMap((r) => keys.map((k) => r[k]))));
    const n = rows.length;
    const x = (i) => P.l + (W - P.l - P.r) * (n <= 1 ? 0.5 : i / (n - 1));
    const y = (v) => H - P.b - (H - P.t - P.b) * (v / max);
    const grid = [0, 1, 2, 3, 4].map((i) => { const v = (max / 4) * i; return `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end" class="gt">${fmt(Math.round(v))}</text>`; }).join('');
    const every = Math.ceil(n / 8);
    const lab = (r) => (d.range.hourly ? r.key.slice(11) : new Date(r.t + TZ * 60000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }));
    const xl = rows.map((r, i) => (i % every === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="gt">${esc(lab(r))}</text>` : '')).join('');
    const lines = keys.map((k, ki) => {
      const pts = rows.map((r, i) => `${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join(' ');
      const area = ki === 0 ? `<polygon points="${P.l},${y(0)} ${pts} ${x(n - 1)},${y(0)}" fill="${colors[k]}" opacity=".12"/>` : '';
      return area + `<polyline points="${pts}" fill="none" stroke="${colors[k]}" stroke-width="2.2" stroke-linejoin="round"/>` + (n <= 40 ? rows.map((r, i) => `<circle cx="${x(i)}" cy="${y(r[k])}" r="2.6" fill="${colors[k]}"/>`).join('') : '');
    }).join('');
    const id = 'ch' + Math.random().toString(36).slice(2, 7);
    setTimeout(() => {
      const svg = document.getElementById(id); if (!svg) return;
      const tip = svg.parentElement.querySelector('.tip'); const guide = svg.querySelector('.guide');
      svg.addEventListener('mousemove', (e) => {
        const r = svg.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W;
        const i = Math.max(0, Math.min(n - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (n - 1))));
        const row = rows[i]; guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i)); guide.style.display = '';
        tip.innerHTML = `<b>${esc(lab(row))}</b>` + keys.map((k) => `<div><i style="background:${colors[k]}"></i>${k === 'sessions' ? 'Visits' : k[0].toUpperCase() + k.slice(1)}: ${fmt(row[k])}</div>`).join('');
        tip.style.display = 'block'; tip.style.left = Math.min(r.width - 140, Math.max(0, (x(i) / W) * r.width + 12)) + 'px';
      });
      svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; guide.style.display = 'none'; });
    }, 0);
    const legend = Object.keys(state.series).map((k) => `<label class="lg"><input type="checkbox" data-s="${k}" ${state.series[k] ? 'checked' : ''}><i style="background:${colors[k]}"></i>${k === 'sessions' ? 'Visits' : k[0].toUpperCase() + k.slice(1)}</label>`).join('');
    return `<div class="legend">${legend}</div><div class="chartwrap"><svg id="${id}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Traffic over time">${grid}${xl}${lines}<line class="guide" y1="${P.t}" y2="${H - P.b}" style="display:none"/></svg><div class="tip"></div></div>`;
  }

  function heatmap(d) {
    const cells = {}; let max = 1;
    d.heat.forEach((r) => { cells[r.d + '-' + r.h] = r.n; if (r.n > max) max = r.n; });
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let h = '<div class="heat"><div class="hrow hhead"><span></span>' + Array.from({ length: 24 }, (_, i) => `<span>${i % 3 === 0 ? (i === 0 ? '12a' : i < 12 ? i + 'a' : i === 12 ? '12p' : i - 12 + 'p') : ''}</span>`).join('') + '</div>';
    days.forEach((dn, di) => {
      h += `<div class="hrow"><span class="hd">${dn}</span>` + Array.from({ length: 24 }, (_, hi) => { const n = cells[di + '-' + hi] || 0; return `<span class="hc" title="${dn} ${hi}:00, ${n} visit${n === 1 ? '' : 's'}" style="background:rgba(37,169,234,${n ? 0.12 + 0.88 * (n / max) : 0.04})"></span>`; }).join('') + '</div>';
    });
    return h + '</div>';
  }

  /* ------------------------------------------------------------------ views */
  const views = {
    overview(d) {
      const t = d.totals, p = d.previous || {};
      const top = (rows, f) => (rows && rows[0] ? f(rows[0]) : '—');
      const peak = (() => { if (!d.heat.length) return '—'; const m = d.heat.reduce((a, b) => (b.n > a.n ? b : a)); return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][m.d] + ' around ' + (m.h === 0 ? '12 AM' : m.h < 12 ? m.h + ' AM' : m.h === 12 ? '12 PM' : m.h - 12 + ' PM'); })();
      const mob = (d.tech.devices.find((x) => x.k === 'mobile') || { n: 0 }).n; const mobPct = t.sessions ? Math.round((mob / t.sessions) * 100) : 0;
      const f = d.funnel || {}; const form = d.form || {};
      const ins = [
        t.sessions ? `${esc(top(d.channels, (r) => r.channel))} sent the most visits.` : '',
        t.sessions ? `${mobPct}% of visits were on a phone.` : '',
        d.heat.length ? `Busiest time: ${esc(peak)}.` : '',
        d.projects[0] ? `${esc(PN(d.projects[0].proj))} got the most attention.` : '',
        form.oks ? `${fmt(form.oks)} contact form message${form.oks === 1 ? '' : 's'} sent.` : '',
        (d.chat.handoffs || 0) ? `${fmt(d.chat.handoffs)} chat${d.chat.handoffs === 1 ? '' : 's'} handed to the team.` : '',
      ].filter(Boolean);
      return `<div class="kpis">${kpi('Visitors', fmt(t.visitors), delta(t.visitors, p.visitors), 'People per day (anonymous daily count)')}${kpi('Visits', fmt(t.sessions), delta(t.sessions, p.sessions))}${kpi('Pageviews', fmt(t.pageviews), delta(t.pageviews, p.pageviews))}${kpi('Pages per visit', t.pagesPerSession, '')}${kpi('Time on site', mins(t.avgEngaged), delta(t.avgEngaged, p.avgEngaged), 'Average time the page was actually in view')}${kpi('Bounce rate', t.bounceRate + '%', delta(t.bounceRate, p.bounceRate, true), 'Left quickly without doing anything')}${kpi('Did something', t.engagedRate + '%', delta(t.engagedRate, p.engagedRate), 'Visits with a click, video, share, form or chat action')}</div>` +
        (ins.length ? `<div class="insights">${ins.map((i) => `<span>${i}</span>`).join('')}</div>` : '') +
        card('Traffic', lineChart(d), 'wide') +
        `<div class="grid2">${card('Where visitors came from', bars(d.channels, (r) => r.channel, (r) => r.sessions))}${card('Most viewed pages', bars(d.pages.slice(0, 8), (r) => pathName(r.path), (r) => r.views, { pct: false }))}</div>` +
        `<div class="grid2">${card('Projects people looked at', bars(d.projects.slice(0, 8), (r) => PN(r.proj), (r) => r.viewers, { pct: false }), '', 'Visitors who had the project on screen for a second or more')}${card('Top countries', bars(d.geo.countries.slice(0, 8), (r) => countryName(r.k), (r) => r.n))}</div>`;
    },

    audience(d) {
      return `<div class="grid2">${card('Countries', bars(d.geo.countries, (r) => countryName(r.k), (r) => r.n))}${card('Cities', bars(d.geo.cities, (r) => r.k, (r) => r.n), '', 'Approximate, from the network the visit came from')}</div>` +
        `<div class="grid3">${card('Devices', bars(d.tech.devices, (r) => r.k, (r) => r.n))}${card('Operating systems', bars(d.tech.os, (r) => r.k, (r) => r.n))}${card('Browsers', bars(d.tech.browsers, (r) => r.k, (r) => r.n))}</div>` +
        `<div class="grid3">${card('Screen widths', bars(d.tech.screens, (r) => r.k + ' px', (r) => r.n))}${card('Languages', bars(d.tech.langs, (r) => r.k, (r) => r.n))}${card('Time spent per visit', bars(['0-10s', '10-30s', '30-60s', '1-3 min', '3+ min'].map((k) => ({ k, n: (d.sessionLength.find((x) => x.k === k) || { n: 0 }).n })), (r) => r.k, (r) => r.n))}</div>` +
        card('When people visit', heatmap(d), 'wide', 'Visits by weekday and hour, in your time zone. Darker means busier.');
    },

    sources(d) {
      return card('Channels', table(['Channel', 'Visits', 'Visitors', 'Bounce rate', 'Time on site'], d.channels.map((r) => [esc(r.channel), fmt(r.sessions), fmt(r.visitors), r.bounceRate + '%', mins(r.engaged)])), 'wide', 'Direct includes messaging apps and typed addresses, which usually hide where a visit came from.') +
        `<div class="grid2">${card('Referring websites', bars(d.referrers, (r) => r.host, (r) => r.sessions))}${card('Campaigns (UTM links)', table(['Source', 'Medium', 'Campaign', 'Visits'], d.campaigns.map((r) => [esc(r.s || '—'), esc(r.m || '—'), esc(r.c || '—'), fmt(r.sessions)])), '', 'Add ?utm_source=…&utm_medium=…&utm_campaign=… to a link to see it here.')}</div>` +
        `<div class="grid2">${card('How the project links were shared', bars(d.shareMethods.map((r) => ({ k: r.k === 'native' ? 'Share menu' : r.k === 'copy' ? 'Copied link' : r.k || 'Other', n: r.n })), (r) => r.k, (r) => r.n))}${card('Visits through shared links', `<div class="kpis one">${kpi('Visits from shared links', fmt((d.channels.find((c) => c.channel === 'Shared link') || { sessions: 0 }).sessions), '')}</div>`, '', 'Each project has a /share/ link with its own preview image.')}</div>`;
    },

    content(d) {
      const home = d.funnel.home || 0;
      const scroll = [25, 50, 75, 90, 100].map((m) => ({ k: m + '% of the page', n: (d.scroll.find((x) => x.k === String(m)) || { n: 0 }).n }));
      const v = d.video || {};
      return card('Pages', table(['Page', 'Views', 'Visits', 'Avg time', 'Scrolled'], d.pages.map((r) => [esc(pathName(r.path)), fmt(r.views), fmt(r.uniques), r.secs == null ? '—' : mins(r.secs), r.scroll == null ? '—' : r.scroll + '%'])), 'wide') +
        `<div class="grid2">${card('Where visits start', table(['Page', 'Visits', 'Bounce'], d.entry.map((r) => [esc(pathName(r.path)), fmt(r.sessions), r.bounceRate + '%'])))}${card('Where visits end', bars(d.exit, (r) => pathName(r.path), (r) => r.sessions))}</div>` +
        card('Projects', table(['Project', 'Saw it', 'Avg time on it', 'Visited site', 'Tours opened', 'Watched to end', 'Avg watched', 'Shared'], d.projects.map((r) => [esc(PN(r.proj)), fmt(r.viewers), r.dwell == null ? '—' : mins(r.dwell), fmt(r.visits), fmt(r.tour_opens), r.tour_opens ? r.completion + '%' : '—', r.watch == null ? '—' : mins(r.watch), fmt(r.shares)])), 'wide', '"Saw it" counts visitors who kept the project on screen for a second or more.') +
        `<div class="grid2">${card('How far people scroll on the home page', bars(scroll, (r) => r.k, (r) => r.n, { total: home || 1 }), '', 'Share of home page visits that reached each point.')}${card('Tour videos', funnel([{ label: 'Opened a tour', n: v.opens || 0 }, { label: 'Pressed play', n: v.plays || 0 }, { label: 'Reached 25%', n: v.p25 || 0 }, { label: 'Reached 50%', n: v.p50 || 0 }, { label: 'Reached 75%', n: v.p75 || 0 }, { label: 'Watched to the end', n: v.p100 || 0 }]) + (v.watch ? `<p class="anote">Average watch time: ${mins(Math.round(v.watch))}</p>` : ''))}</div>` +
        card('What people click', table(['Type', 'Link or button', 'Clicks'], d.clicks.map((r) => [esc(({ outbound: 'Leaves the site', cta: 'Button', nav: 'Menu', footer: 'Footer', index: 'Project list', mailto: 'Email link', tel: 'Phone link', link: 'Link' })[r.cat] || r.cat), esc(r.label || '(no text)'), fmt(r.n)])), 'wide');
    },

    conversions(d) {
      const f = d.funnel || {}, form = d.form || {}, c = d.chat || {};
      const asked = c.sends || 0;
      const sat = (c.ups || 0) + (c.downs || 0) ? Math.round(((c.ups || 0) / ((c.ups || 0) + (c.downs || 0))) * 100) : null;
      const missRate = asked ? Math.round(((c.misses || 0) / asked) * 100) : 0;
      return card('From visit to message', funnel([
        { label: 'Visited the home page', n: f.home || 0 }, { label: 'Looked at a project', n: f.proj || 0 }, { label: 'Clicked a call-to-action', n: f.cta || 0 },
        { label: 'Opened the contact page', n: f.contact || 0 }, { label: 'Started the form', n: f.fstart || 0 }, { label: 'Sent a message', n: f.fok || 0 },
      ]), 'wide', 'Each step counts visits that did it, in any order, so a step can be higher than the one before it.') +
        `<div class="grid2">${card('Contact form', `<div class="kpis one">${kpi('Saw the form', fmt(form.views))}${kpi('Started it', fmt(form.starts))}${kpi('Tried to send', fmt(form.submits))}${kpi('Sent', fmt(form.oks))}${kpi('Errors', fmt(form.errors))}${kpi('Completion', form.starts ? Math.round(((form.oks || 0) / form.starts) * 100) + '%' : '—', '', 'Sent ÷ started')}</div>`)}` +
        `${card('Chesky', `<div class="kpis one">${kpi('Chats opened', fmt(c.opens))}${kpi('Questions asked', fmt(asked))}${kpi("Couldn't answer", fmt(c.misses) + (asked ? ` <small>${missRate}%</small>` : ''))}${kpi('Thumbs up / down', fmt(c.ups) + ' / ' + fmt(c.downs))}${kpi('Happy with answers', sat == null ? '—' : sat + '%')}${kpi('Handed to the team', fmt(c.handoffs), '', 'Offered: ' + fmt(c.offers))}${kpi('Used a tool (math, dates…)', fmt(c.tools))}</div>`)}</div>` +
        card('What people ask Chesky about', bars((c.topics || []).map((r) => ({ k: topicName(r.k), n: r.n })), (r) => r.k, (r) => r.n), '', 'Topics only. What visitors type is never recorded in analytics. Questions he missed are in the Teach Chesky tab.') +
        `<div class="grid2">${card('Engagement actions', bars([{ k: 'Watched a tour', n: f.vopen || 0 }, { k: 'Shared a project', n: f.shared || 0 }, { k: 'Opened the chat', n: f.copen || 0 }, { k: 'Asked Chesky something', n: f.cq || 0 }, { k: 'Asked for the team', n: f.hand || 0 }], (r) => r.k, (r) => r.n, { total: d.totals.sessions || 1 }), '', 'Share of all visits.')}</div>`;
    },

    speed(d) {
      const spec = { lcp: ['Largest paint', 'ms', 2500, 4000, 'How fast the main content appears'], fcp: ['First paint', 'ms', 1800, 3000, 'How fast anything appears'], cls: ['Layout shift', '', 0.1, 0.25, 'Things jumping around while loading'], inp: ['Responsiveness', 'ms', 200, 500, 'Delay after a tap or click'], ttfb: ['Server response', 'ms', 800, 1800, 'Time until the server answers'], load: ['Full load', 'ms', 3000, 6000, 'Everything finished loading'] };
      const cards = Object.keys(spec).map((k) => {
        const v = d.vitals[k]; const [name, unit, good, poor, hint] = spec[k];
        if (!v) return `<div class="vcard"><div class="vn">${name}</div><div class="vv">—</div><div class="vh">${hint}</div></div>`;
        const val = v.p75; const cls = val <= good ? 'good' : val <= poor ? 'ok' : 'poor';
        const show = (x) => (x == null ? '—' : unit === 'ms' ? (x >= 1000 ? (x / 1000).toFixed(1) + ' s' : Math.round(x) + ' ms') : x.toFixed(3));
        return `<div class="vcard ${cls}"><div class="vn">${name}</div><div class="vv">${show(val)}</div><div class="vh">${hint}. Typical: ${show(v.p50)} · Phones: ${show(v.mobile75)} · Computers: ${show(v.desktop75)} · ${fmt(v.n)} visits</div></div>`;
      }).join('');
      return card('How fast the site feels', `<div class="vgrid">${cards}</div>`, 'wide', 'The slowest 1 in 4 visits (75th percentile). Green is good, amber needs work, red is poor.') +
        card('Errors in visitors\' browsers', table(['Error', 'Where', 'Times', 'Last seen'], d.errors.map((r) => [esc(r.msg), esc((r.src || '') + ' on ' + pathName(r.path)), fmt(r.n), ago(r.last) + ' ago'])), 'wide', 'Problems the site hit while running. Empty is good.');
    },
  };

  /* ------------------------------------------------------------------ live view + visits */
  async function renderVisitors(el) {
    el.innerHTML = '<div class="aempty">Loading…</div>';
    const [live, sess] = await Promise.all([api('/admin/stats/live'), api(`/admin/stats/sessions?from=${state.from}&to=${state.to}`)]);
    const evName = (e) => {
      const x = (() => { try { return JSON.parse(e.extra || '{}'); } catch (err) { return {}; } })();
      switch (e.type) {
        case 'pageview': return 'viewed ' + pathName(e.path);
        case 'project': return 'looked at ' + PN(e.proj);
        case 'click': return `clicked "${x.l || e.name}"${x.h ? ' → ' + x.h : ''}`;
        case 'video': return `tour: ${e.name}${e.proj ? ' (' + PN(e.proj) + ')' : ''}`;
        case 'share': return 'shared ' + PN(e.proj) + (x.m ? ' (' + x.m + ')' : '');
        case 'form': return 'contact form: ' + e.name;
        case 'chat': return 'chat: ' + e.name + (x.e ? ' (' + topicName(x.e) + ')' : '');
        case 'error': return 'hit an error: ' + e.name;
        default: return e.type + ' ' + e.name;
      }
    };
    state.evName = evName;
    el.innerHTML =
      `<div class="kpis">${kpi('On the site right now', fmt(live.active.length), '', 'Active in the last 5 minutes')}${kpi('Visits, last 24 hours', fmt(live.last24h.sessions))}${kpi('Pageviews, last 24 hours', fmt(live.last24h.pageviews))}</div>` +
      `<div class="grid2">${card('Right now', live.active.length ? table(['Page', 'From', 'Device', 'Channel', 'Active'], live.active.map((r) => [esc(pathName(r.path)), esc((r.city ? r.city + ', ' : '') + (r.country || '')), esc(r.device + ' · ' + r.browser), esc(r.channel), ago(r.last_ts) + ' ago'])) : '<div class="aempty">Nobody in the last 5 minutes.</div>')}` +
      `${card('Live activity', live.recent.length ? '<ul class="feed">' + live.recent.map((e) => `<li><time>${ago(e.ts)}</time> ${esc(e.country || '')} ${esc(e.device)}: ${esc(evName(e))}</li>`).join('') + '</ul>' : '<div class="aempty">No activity yet.</div>')}</div>` +
      card('Recent visits', sess.sessions.length ? table(['When', 'From', 'Device', 'Channel', 'Pages', 'Time', 'Path', ''], sess.sessions.map((s) => [new Date(s.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), esc((s.city ? s.city + ', ' : '') + (s.country || '—')), esc(s.device + ' · ' + s.browser), esc(s.channel), fmt(s.pages), mins(Math.round(s.active_s)), esc(pathName(s.landing) + (s.exit_path && s.exit_path !== s.landing ? ' → ' + pathName(s.exit_path) : '')), `<button class="small-btn" data-sid="${esc(s.sid)}">Steps</button>`])) : empty, 'wide', 'Anonymous: there are no names, emails or IP addresses. Click Steps to see everything one visitor did.') +
      '<div id="timeline"></div>';
    el.querySelectorAll('[data-sid]').forEach((b) => b.addEventListener('click', async () => {
      const t = await api('/admin/stats/session?sid=' + encodeURIComponent(b.dataset.sid));
      const s = t.session;
      $('timeline').innerHTML = card(`One visit: ${new Date(s.ts).toLocaleString()}`, `<p class="anote">${esc(s.city ? s.city + ', ' : '')}${esc(s.country || '')} · ${esc(s.device)} · ${esc(s.os)} · ${esc(s.browser)} · ${esc(s.channel)}${s.ref_host ? ' · from ' + esc(s.ref_host) : ''}</p><ol class="steps">${t.events.filter((e) => !['scroll', 'dwell'].includes(e.type)).map((e) => `<li><time>+${Math.max(0, Math.round((e.ts - s.ts) / 1000))}s</time> ${esc(evName(e))}${e.type === 'pageend' ? ` <small>(${Math.round(e.value)}s on page)</small>` : ''}</li>`).join('')}</ol>`, 'wide');
      $('timeline').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  /* ------------------------------------------------------------------ settings */
  function renderSettings(el) {
    let off = false; try { off = !!localStorage.getItem('es-no-track'); } catch (e) { /* ignore */ }
    const rangeQ = `from=${state.from}&to=${state.to}`;
    el.innerHTML =
      card('Your own visits', `<label class="check"><input type="checkbox" id="no-track" ${off ? 'checked' : ''}> Don't count my visits in this browser</label><p class="anote">Tick this on every device you use to browse the public site, so your own clicks don't skew the numbers. (The admin pages are never counted.)</p>`) +
      card('Download your data', `<p class="anote">For the date range selected above.</p><div class="row"><button class="small-btn" data-x="sessions">Visits (Excel)</button> <button class="small-btn" data-x="events">Every event (Excel)</button></div>`) +
      card('How it works', `<ul class="plain"><li>No cookies. A random number lives only in the browser tab and disappears when it closes.</li><li>IP addresses are never stored. Unique visitors are counted with a one-way code that changes every day.</li><li>Do Not Track and Global Privacy Control are honored. Bots and automated browsers are ignored.</li><li>Names, emails and what people type in the chat are never recorded here.</li><li>Data is kept for 13 months, then deleted automatically. A summary email arrives every Monday morning (set <code>DIGEST</code> to "off" in the Worker to stop it).</li><li>Visitors can read all this at <a href="../privacy.html" target="_blank" rel="noopener">/privacy.html</a>.</li></ul>`) +
      card('Delete everything', `<p class="anote">Removes all visits and events permanently. This cannot be undone.</p><button class="small-btn danger" id="reset-stats">Delete all analytics data</button>`);
    $('no-track').addEventListener('change', (e) => { try { e.target.checked ? localStorage.setItem('es-no-track', '1') : localStorage.removeItem('es-no-track'); } catch (x) { /* ignore */ } toast(e.target.checked ? 'Your visits on this browser will not be counted' : 'Your visits will be counted again'); });
    el.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const res = await fetch(api.base + `/admin/stats/export?kind=${b.dataset.x}&${rangeQ}`, { headers: { Authorization: 'Bearer ' + api.token() } });
        if (!res.ok) throw new Error('Export failed');
        const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = `everythingshul-${b.dataset.x}.xlsx`; a.click();
      } catch (e) { toast(e.message); }
    }));
    $('reset-stats').addEventListener('click', async () => {
      if (!confirm('Delete ALL analytics data for good?')) return;
      await api('/admin/stats/reset', { method: 'POST', body: {} }); toast('All analytics data deleted'); load();
    });
  }

  /* ------------------------------------------------------------------ loading and drawing */
  const VIEWS = [['overview', 'Overview'], ['audience', 'Audience'], ['sources', 'Sources'], ['content', 'Content'], ['conversions', 'Conversions'], ['speed', 'Speed'], ['visitors', 'Visitors'], ['settings', 'Settings']];

  function chrome() {
    const R = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days']];
    const dstr = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    $('analytics').innerHTML =
      `<div class="abar"><div class="chips">${R.map(([k, l]) => `<button class="chip${state.range === k ? ' on' : ''}" data-r="${k}">${l}</button>`).join('')}</div>
        <div class="custom"><input type="date" id="a-from" value="${dstr(state.from)}"> <span>to</span> <input type="date" id="a-to" value="${dstr(state.to - 1)}"> <button class="small-btn" id="a-apply">Apply</button></div>
        <label class="check"><input type="checkbox" id="a-cmp" ${state.cmp ? 'checked' : ''}> Compare with the previous period</label><button class="small-btn" id="a-refresh" title="Refresh">↻ Refresh</button></div>
       <div class="asub">${VIEWS.map(([k, l]) => `<button class="stab${state.view === k ? ' on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
       <div id="a-body"></div>`;
    $('analytics').querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => { setRange(b.dataset.r); load(); }));
    $('a-apply').addEventListener('click', () => { const f = new Date($('a-from').value + 'T00:00:00').getTime(); const t = new Date($('a-to').value + 'T00:00:00').getTime() + DAY; if (f && t > f) { setRange('custom', { from: f, to: t }); load(); } });
    $('a-cmp').addEventListener('change', (e) => { state.cmp = e.target.checked; load(); });
    $('a-refresh').addEventListener('click', () => load());
    $('analytics').querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.v; history.replaceState(null, '', '#analytics'); chrome(); draw(); }));
  }

  async function draw() {
    const body = $('a-body'); if (!body) return;
    if (state.view === 'settings') return renderSettings(body);
    if (state.view === 'visitors') { try { await renderVisitors(body); } catch (e) { body.innerHTML = `<div class="aempty">${esc(e.message)}</div>`; } return; }
    if (!state.data) { body.innerHTML = '<div class="aempty">Loading…</div>'; return; }
    body.innerHTML = views[state.view](state.data);
    body.querySelectorAll('input[data-s]').forEach((c) => c.addEventListener('change', () => { state.series[c.dataset.s] = c.checked; if (!Object.values(state.series).some(Boolean)) state.series.visitors = true; draw(); }));
  }

  async function load() {
    chrome();
    const body = $('a-body');
    if (state.view === 'visitors' || state.view === 'settings') return draw();
    body.innerHTML = '<div class="aempty">Loading…</div>';
    try {
      state.data = await api(`/admin/stats?from=${state.from}&to=${state.to}&tz=${TZ}&cmp=${state.cmp ? 1 : 0}`);
      draw();
    } catch (e) {
      body.innerHTML = `<div class="aempty">${esc(e.message)}${/not set up/.test(e.message) ? '<br>The analytics database still needs to be created. See worker/chat/README.md.' : ''}</div>`;
    }
  }

  window.ESAnalytics = {
    show(apiFn, base, tokenFn) {
      api = apiFn; api.base = base; api.token = tokenFn;
      if (!state.from) setRange('7d');
      load();
      clearInterval(state.timer);
      state.timer = setInterval(() => { if (!$('analytics').hidden && document.visibilityState === 'visible') { if (state.view === 'visitors') draw(); else if (!['settings'].includes(state.view) && state.range !== 'custom') load(); } }, 30000);
    },
    hide() { clearInterval(state.timer); },
  };
})();
