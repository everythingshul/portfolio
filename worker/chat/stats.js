// First-party, cookie-less analytics for everythingshul.com.
//   POST /t                      collect a batch of events from the site (js/metrics.js)
//   GET  /admin/stats?...        the dashboard numbers (password protected, used by /admin/)
//   GET  /admin/stats/live       who is on the site right now
//   GET  /admin/stats/session    one visit, step by step
//   GET  /admin/stats/export     raw sessions/events as CSV
//   POST /admin/stats/reset      delete everything
//   scheduled(): daily cleanup of old data, weekly summary email
// Stored in the STATS D1 database (see schema.sql). No IPs, names or cookies are ever stored.

const MAX_BODY = 16 * 1024;
const MAX_EVENTS = 30;
const DAY = 86400000;

/* ------------------------------------------------------------------ small helpers */
const str = (v, n) => (v == null ? '' : String(v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n));
const num = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0; };
const sidOk = (s) => /^[A-Za-z0-9]{8,24}$/.test(s || '');

const TYPES = { pv: 'pageview', pe: 'pageend', sc: 'scroll', pj: 'project', dw: 'dwell', ck: 'click', vd: 'video', sh: 'share', fm: 'form', ch: 'chat', er: 'error', vt: 'vital' };
const NO_INTERACT = new Set(['pageview', 'pageend', 'scroll', 'project', 'dwell', 'error', 'vital']);

const BOTS = /bot\b|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|preview|fetch|curl|wget|python|java\/|go-http|okhttp|httpclient|axios|node-fetch|facebookexternalhit|whatsapp|telegram|slackbot|twitterbot|discordbot|linkedinbot|skype|embedly|bingpreview|google-read|gtmetrix|semrush|ahrefs|mj12|yandex|baidu|petalbot|bytespider|applebot|duckduckbot|phantomjs|puppeteer|playwright/i;

export function parseUA(ua, width, touch) {
  let browser = 'Other';
  if (/FBAN|FBAV|FB_IAB/.test(ua)) browser = 'Facebook app';
  else if (/Instagram/.test(ua)) browser = 'Instagram app';
  else if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS/.test(ua)) browser = 'Firefox';
  else if (/CriOS|Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  let os = 'Other';
  if (/iPhone|iPod/.test(ua)) os = 'iOS';
  else if (/iPad/.test(ua)) os = 'iPadOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/.test(ua)) os = touch > 1 ? 'iPadOS' : 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  let device = 'desktop';
  if (/iPad|Tablet/.test(ua) || os === 'iPadOS' || (/Android/.test(ua) && !/Mobile/.test(ua))) device = 'tablet';
  else if (/Mobi|iPhone|iPod|Android/.test(ua)) device = 'mobile';
  else if (width && width < 600) device = 'mobile';
  return { browser, os, device };
}

const screenBucket = (w) => (!w ? '' : w < 480 ? '<480' : w < 768 ? '480-767' : w < 1024 ? '768-1023' : w < 1440 ? '1024-1439' : '1440+');

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|baidu|yandex|brave|startpage|qwant|ask)\.[a-z.]+$/;
const SOCIAL = /(^|\.)(facebook|fb|instagram|twitter|x|t|linkedin|lnkd|whatsapp|wa|telegram|youtube|youtu|reddit|pinterest|tiktok|threads|snapchat)\.(com|co|me|be|in)$/;
const MAILH = /(^|\.)(mail\.google|outlook\.live|outlook\.office|mail\.yahoo|mail\.aol|proton)\./;

export function channelOf({ refHost, medium, source, landing }, siteHost) {
  const m = (medium || '').toLowerCase();
  if (/^(cpc|ppc|paid|paidsearch|display|banner)/.test(m)) return 'Paid';
  if (/^(email|e-mail|newsletter)/.test(m)) return 'Email';
  if (/^(social|sm|social-network)/.test(m)) return 'Social';
  if ((landing || '').startsWith('/share/')) return 'Shared link';
  if (source || m) return 'Campaign';
  if (!refHost || refHost === siteHost) return 'Direct';
  if (MAILH.test(refHost)) return 'Email';
  if (SEARCH.test(refHost)) return 'Search';
  if (SOCIAL.test(refHost)) return 'Social';
  if (refHost.endsWith('everythingshul.com')) return 'Our other sites';
  return 'Referral';
}

async function dailyId(env, ip, ua, day) {
  const data = new TextEncoder().encode(`${env.STATS_SALT || env.ADMIN_TOKEN || 'es'}|${day}|${ip}|${ua}`);
  const h = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(h)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ collecting */
export async function ingest(request, env, h) {
  const done = (status = 204) => new Response(null, { status, headers: h });
  if (!env.STATS) return done();
  const ua = request.headers.get('User-Agent') || '';
  if (!ua || BOTS.test(ua)) return done();

  let raw;
  try { raw = await request.text(); } catch { return done(400); }
  if (raw.length > MAX_BODY) return done(413);
  let b;
  try { b = JSON.parse(raw); } catch { return done(400); }
  const s = b && b.s;
  if (!s || !sidOk(s.sid) || !Array.isArray(b.e) || !b.e.length) return done(400);

  const now = Date.now();
  const cf = request.cf || {};
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const day = new Date(now).toISOString().slice(0, 10);
  const uid = await dailyId(env, ip, ua, day);
  const dev = parseUA(ua, num(s.w, 0, 10000), num(s.tp, 0, 50));
  const siteHost = new URL(env.SITE_URL || 'https://everythingshul.com').host;

  let refHost = '', refUrl = '';
  try { if (s.ref) { const u = new URL(String(s.ref)); refHost = u.host.replace(/^www\./, ''); refUrl = (u.host + u.pathname).slice(0, 200); } } catch { /* ignore */ }
  const u = s.utm || {};
  const path0 = str(s.path, 200) || '/';
  const channel = channelOf({ refHost, medium: str(u.m, 60), source: str(u.s, 60), landing: path0 }, siteHost);

  const events = [];
  let pages = 0, interact = 0, active = 0, lastPath = path0;
  for (const e of b.e.slice(0, MAX_EVENTS)) {
    const type = TYPES[e && e.t];
    if (!type) continue;
    const name = str(e.n, 60);
    const value = e.v == null ? null : num(e.v, -1e7, 1e9);
    const path = str(e.p, 200) || lastPath;
    const proj = str(e.j, 40) || null;
    let extra = null;
    if (e.x && typeof e.x === 'object') {
      const clean = {};
      Object.keys(e.x).slice(0, 8).forEach((k) => { const v = e.x[k]; clean[str(k, 16)] = typeof v === 'number' ? v : str(v, 120); });
      extra = JSON.stringify(clean);
    }
    const ts = now - num(e.d, 0, 6 * 3600 * 1000);
    if (type === 'pageview') { pages++; lastPath = path; }
    if (type === 'pageend') { active += num(e.v, 0, 36000); lastPath = path; }
    if (!NO_INTERACT.has(type)) interact++;
    events.push({ ts, type, name, value, path, proj, extra });
  }
  if (!events.length) return done();

  try {
    const stmts = [
      env.STATS.prepare(
        `INSERT INTO sessions (sid, ts, last_ts, uid, landing, exit_path, ref_host, ref_url, utm_source, utm_medium, utm_campaign, utm_term, utm_content, channel,
           country, region, city, tz, device, os, browser, lang, screen, pages, events, interact, active_s)
         VALUES (?1,?2,?2,?3,?4,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)
         ON CONFLICT(sid) DO UPDATE SET last_ts = MAX(last_ts, excluded.last_ts), exit_path = ?26,
           pages = pages + excluded.pages, events = events + excluded.events, interact = interact + excluded.interact, active_s = active_s + excluded.active_s`,
      ).bind(s.sid, now, uid, path0, refHost, refUrl, str(u.s, 60), str(u.m, 60), str(u.c, 80), str(u.t, 60), str(u.n, 60), channel,
        str(cf.country, 3), str(cf.region, 60), str(cf.city, 60), str(cf.timezone || s.tz, 60), dev.device, dev.os, dev.browser,
        str(s.lang, 12), screenBucket(num(s.w, 0, 10000)), pages, events.length, interact, active, lastPath),
    ];
    const ins = env.STATS.prepare('INSERT INTO events (sid, ts, type, name, value, path, proj, extra) VALUES (?,?,?,?,?,?,?,?)');
    events.forEach((e) => stmts.push(ins.bind(s.sid, e.ts, e.type, e.name, e.value, e.path, e.proj, e.extra)));
    await env.STATS.batch(stmts);
  } catch (err) {
    console.error('stats ingest', err && err.message);
  }
  return done();
}

/* ------------------------------------------------------------------ reporting */
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const quantile = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

async function q(db, stmts) { return (await db.batch(stmts)).map((r) => r.results || []); }

export async function totals(db, from, to) {
  const [[t]] = await q(db, [db.prepare(
    `SELECT COUNT(*) sessions, COUNT(DISTINCT uid) visitors, COALESCE(SUM(pages),0) pageviews, COALESCE(SUM(events),0) events,
            COALESCE(SUM(CASE WHEN pages<=1 AND interact=0 AND active_s<10 THEN 1 ELSE 0 END),0) bounces,
            COALESCE(SUM(active_s),0) active, COALESCE(SUM(interact>0),0) engaged
     FROM sessions WHERE ts>=? AND ts<?`).bind(from, to)]);
  return {
    sessions: t.sessions, visitors: t.visitors, pageviews: t.pageviews, events: t.events,
    bounceRate: pct(t.bounces, t.sessions), pagesPerSession: t.sessions ? Math.round((t.pageviews / t.sessions) * 100) / 100 : 0,
    avgEngaged: t.sessions ? Math.round(t.active / t.sessions) : 0, engagedRate: pct(t.engaged, t.sessions),
  };
}

export async function computeStats(db, { from, to, tz = 0, compare = true }) {
  const off = Math.round(tz) * 60; // seconds
  const hourly = to - from <= 2 * DAY + 1;
  const bucket = hourly ? `strftime('%Y-%m-%d %H:00', ts/1000 + ${off}, 'unixepoch')` : `strftime('%Y-%m-%d', ts/1000 + ${off}, 'unixepoch')`;
  const R = [from, to];
  const S = (sql, ...args) => db.prepare(sql).bind(...args);

  const res = await q(db, [
    /* 0 series */ S(`SELECT ${bucket} b, COUNT(*) sessions, COUNT(DISTINCT uid) visitors, SUM(pages) pageviews FROM sessions WHERE ts>=? AND ts<? GROUP BY b ORDER BY b`, ...R),
    /* 1 heat */ S(`SELECT CAST(strftime('%w', ts/1000 + ${off}, 'unixepoch') AS INTEGER) d, CAST(strftime('%H', ts/1000 + ${off}, 'unixepoch') AS INTEGER) h, COUNT(*) n FROM sessions WHERE ts>=? AND ts<? GROUP BY d, h`, ...R),
    /* 2 pages */ S(`SELECT path, COUNT(*) views, COUNT(DISTINCT sid) uniques FROM events WHERE type='pageview' AND ts>=? AND ts<? GROUP BY path ORDER BY views DESC LIMIT 25`, ...R),
    /* 3 page time */ S(`SELECT path, AVG(value) secs, AVG(json_extract(extra,'$.sc')) scroll FROM events WHERE type='pageend' AND ts>=? AND ts<? GROUP BY path`, ...R),
    /* 4 entry */ S(`SELECT landing path, COUNT(*) sessions, SUM(CASE WHEN pages<=1 AND interact=0 AND active_s<10 THEN 1 ELSE 0 END) bounces FROM sessions WHERE ts>=? AND ts<? GROUP BY landing ORDER BY sessions DESC LIMIT 15`, ...R),
    /* 5 exit */ S(`SELECT exit_path path, COUNT(*) sessions FROM sessions WHERE ts>=? AND ts<? GROUP BY exit_path ORDER BY sessions DESC LIMIT 15`, ...R),
    /* 6 channels */ S(`SELECT channel, COUNT(*) sessions, COUNT(DISTINCT uid) visitors, SUM(CASE WHEN pages<=1 AND interact=0 AND active_s<10 THEN 1 ELSE 0 END) bounces, AVG(active_s) engaged FROM sessions WHERE ts>=? AND ts<? GROUP BY channel ORDER BY sessions DESC`, ...R),
    /* 7 referrers */ S(`SELECT ref_host host, COUNT(*) sessions FROM sessions WHERE ts>=? AND ts<? AND ref_host<>'' GROUP BY ref_host ORDER BY sessions DESC LIMIT 20`, ...R),
    /* 8 campaigns */ S(`SELECT utm_source s, utm_medium m, utm_campaign c, COUNT(*) sessions FROM sessions WHERE ts>=? AND ts<? AND (utm_source<>'' OR utm_medium<>'' OR utm_campaign<>'') GROUP BY s, m, c ORDER BY sessions DESC LIMIT 20`, ...R),
    /* 9 countries */ S(`SELECT country k, COUNT(*) n FROM sessions WHERE ts>=? AND ts<? AND country<>'' GROUP BY k ORDER BY n DESC LIMIT 20`, ...R),
    /* 10 regions */ S(`SELECT country||' '||region k, COUNT(*) n FROM sessions WHERE ts>=? AND ts<? AND region<>'' GROUP BY k ORDER BY n DESC LIMIT 15`, ...R),
    /* 11 cities */ S(`SELECT city||', '||country k, COUNT(*) n FROM sessions WHERE ts>=? AND ts<? AND city<>'' GROUP BY k ORDER BY n DESC LIMIT 15`, ...R),
    /* 12 devices */ S(`SELECT device k, COUNT(*) n FROM sessions WHERE ts>=? AND ts<? GROUP BY k ORDER BY n DESC`, ...R),
    /* 13 os */ S(`SELECT os k, COUNT(*) n FROM sessions WHERE ts>=? AND ts<? GROUP BY k ORDER BY n DESC`, ...R),
    /* 14 browsers */ S(`SELECT browser k, COUNT(*) n FROM sessions WHERE ts>=? AND ts<? GROUP BY k ORDER BY n DESC`, ...R),
    /* 15 screens */ S(`SELECT screen k, COUNT(*) n FROM sessions WHERE ts>=? AND ts<? AND screen<>'' GROUP BY k ORDER BY n DESC`, ...R),
    /* 16 langs */ S(`SELECT lang k, COUNT(*) n FROM sessions WHERE ts>=? AND ts<? AND lang<>'' GROUP BY k ORDER BY n DESC LIMIT 12`, ...R),
    /* 17 projects */ S(
      `SELECT proj,
         COUNT(DISTINCT CASE WHEN type='project' AND name='view' THEN sid END) viewers,
         SUM(type='project' AND name='view') views,
         AVG(CASE WHEN type='dwell' THEN value END) dwell,
         SUM(type='click' AND name='outbound') visits,
         SUM(type='video' AND name='open') tour_opens,
         SUM(type='video' AND name='play') plays,
         SUM(type='video' AND name='p25') p25, SUM(type='video' AND name='p50') p50, SUM(type='video' AND name='p75') p75, SUM(type='video' AND name='p100') p100,
         AVG(CASE WHEN type='video' AND name='close' THEN value END) watch,
         SUM(type='share') shares
       FROM events WHERE proj IS NOT NULL AND ts>=? AND ts<? GROUP BY proj ORDER BY viewers DESC`, ...R),
    /* 18 clicks */ S(`SELECT name cat, json_extract(extra,'$.l') label, COUNT(*) n FROM events WHERE type='click' AND ts>=? AND ts<? GROUP BY cat, label ORDER BY n DESC LIMIT 30`, ...R),
    /* 19 scroll */ S(`SELECT name k, COUNT(DISTINCT sid) n FROM events WHERE type='scroll' AND path IN ('/','/index.html') AND ts>=? AND ts<? GROUP BY name`, ...R),
    /* 20 funnel */ S(
      `SELECT COUNT(*) total, SUM(home) home, SUM(proj) proj, SUM(cta) cta, SUM(contact) contact, SUM(fstart) fstart, SUM(fok) fok,
              SUM(vopen) vopen, SUM(copen) copen, SUM(cq) cq, SUM(offer) offer, SUM(hand) hand, SUM(shared) shared
       FROM (SELECT sid,
               MAX(type='pageview' AND path='/') home, MAX(type='project') proj, MAX(type='click' AND name='cta') cta,
               MAX(type='pageview' AND path='/contact.html') contact, MAX(type='form' AND name='start') fstart, MAX(type='form' AND name='ok') fok,
               MAX(type='video' AND name='open') vopen, MAX(type='chat' AND name='open') copen, MAX(type='chat' AND name='send') cq,
               MAX(type='chat' AND name='offer') offer, MAX(type='chat' AND name='handoff') hand, MAX(type='share') shared
             FROM events WHERE ts>=? AND ts<? GROUP BY sid)`, ...R),
    /* 21 chat topics */ S(`SELECT json_extract(extra,'$.e') k, COUNT(*) n FROM events WHERE type='chat' AND name='match' AND ts>=? AND ts<? GROUP BY k ORDER BY n DESC LIMIT 15`, ...R),
    /* 22 chat totals */ S(`SELECT SUM(name='open') opens, SUM(name='send') sends, SUM(name='match') matches, SUM(name='miss') misses, SUM(name='up') ups, SUM(name='down') downs, SUM(name='offer') offers, SUM(name='handoff') handoffs, SUM(name='tool') tools FROM events WHERE type='chat' AND ts>=? AND ts<?`, ...R),
    /* 23 form */ S(`SELECT SUM(name='view') views, SUM(name='start') starts, SUM(name='submit') submits, SUM(name='ok') oks, SUM(name='error') errors FROM events WHERE type='form' AND ts>=? AND ts<?`, ...R),
    /* 24 vitals */ S(`SELECT e.name, e.value, s.device FROM events e JOIN sessions s ON s.sid=e.sid WHERE e.type='vital' AND e.ts>=? AND e.ts<? LIMIT 20000`, ...R),
    /* 25 errors */ S(`SELECT name msg, COUNT(*) n, MAX(ts) last, MAX(path) path, MAX(json_extract(extra,'$.s')) src FROM events WHERE type='error' AND ts>=? AND ts<? GROUP BY name ORDER BY n DESC LIMIT 20`, ...R),
    /* 26 video totals */ S(`SELECT SUM(name='open') opens, SUM(name='play') plays, SUM(name='p25') p25, SUM(name='p50') p50, SUM(name='p75') p75, SUM(name='p100') p100, AVG(CASE WHEN name='close' THEN value END) watch FROM events WHERE type='video' AND ts>=? AND ts<?`, ...R),
    /* 27 share methods */ S(`SELECT json_extract(extra,'$.m') k, COUNT(*) n FROM events WHERE type='share' AND ts>=? AND ts<? GROUP BY k`, ...R),
    /* 28 session length buckets */ S(`SELECT CASE WHEN active_s<10 THEN '0-10s' WHEN active_s<30 THEN '10-30s' WHEN active_s<60 THEN '30-60s' WHEN active_s<180 THEN '1-3 min' ELSE '3+ min' END k, COUNT(*) n FROM sessions WHERE ts>=? AND ts<? GROUP BY k`, ...R),
  ]);

  const timeBy = Object.fromEntries(res[3].map((r) => [r.path, r]));
  const pages = res[2].map((r) => ({ ...r, secs: timeBy[r.path] ? Math.round(timeBy[r.path].secs || 0) : null, scroll: timeBy[r.path] && timeBy[r.path].scroll != null ? Math.round(timeBy[r.path].scroll) : null }));

  const vit = {};
  res[24].forEach((r) => { (vit[r.name] = vit[r.name] || { all: [], mobile: [], desktop: [] }); vit[r.name].all.push(r.value); (vit[r.name][r.device === 'desktop' ? 'desktop' : 'mobile'] || vit[r.name].mobile).push(r.value); });
  const vitals = {};
  Object.keys(vit).forEach((k) => {
    vitals[k] = { n: vit[k].all.length, p50: quantile(vit[k].all, 0.5), p75: quantile(vit[k].all, 0.75), mobile75: quantile(vit[k].mobile, 0.75), desktop75: quantile(vit[k].desktop, 0.75) };
  });

  const out = {
    range: { from, to, tz, hourly },
    totals: await totals(db, from, to),
    series: res[0], heat: res[1],
    pages, entry: res[4].map((r) => ({ ...r, bounceRate: pct(r.bounces, r.sessions) })), exit: res[5],
    channels: res[6].map((r) => ({ ...r, bounceRate: pct(r.bounces, r.sessions), engaged: Math.round(r.engaged || 0) })),
    referrers: res[7], campaigns: res[8],
    geo: { countries: res[9], regions: res[10], cities: res[11] },
    tech: { devices: res[12], os: res[13], browsers: res[14], screens: res[15], langs: res[16] },
    projects: res[17].map((r) => ({ ...r, dwell: r.dwell == null ? null : Math.round(r.dwell), watch: r.watch == null ? null : Math.round(r.watch), completion: pct(r.p100, r.tour_opens) })),
    clicks: res[18], scroll: res[19], funnel: res[20][0] || {},
    chat: { ...(res[22][0] || {}), topics: res[21] }, form: res[23][0] || {}, vitals, errors: res[25],
    video: res[26][0] || {}, shareMethods: res[27], sessionLength: res[28],
  };
  if (compare) {
    const span = to - from;
    out.previous = await totals(db, from - span, from);
  }
  return out;
}

export async function liveStats(db) {
  const now = Date.now();
  const [active, recent] = await q(db, [
    db.prepare(`SELECT sid, exit_path path, country, city, device, browser, channel, last_ts FROM sessions WHERE last_ts>=? ORDER BY last_ts DESC LIMIT 50`).bind(now - 5 * 60000),
    db.prepare(`SELECT e.ts, e.type, e.name, e.path, e.proj, e.extra, s.country, s.device, e.sid FROM events e JOIN sessions s ON s.sid=e.sid WHERE e.type NOT IN ('scroll','pageend','dwell','vital') ORDER BY e.id DESC LIMIT 40`),
  ]);
  const [[today]] = await q(db, [db.prepare(`SELECT COUNT(*) sessions, COALESCE(SUM(pages),0) pageviews FROM sessions WHERE ts>=?`).bind(now - 24 * 3600000)]);
  return { now, active, recent, last24h: today };
}

export async function recentSessions(db, from, to, limit = 60) {
  const [rows] = await q(db, [db.prepare(
    `SELECT sid, ts, last_ts, landing, exit_path, channel, ref_host, country, region, city, device, os, browser, pages, events, interact, active_s
     FROM sessions WHERE ts>=? AND ts<? ORDER BY ts DESC LIMIT ?`).bind(from, to, limit)]);
  return rows;
}

export async function sessionTimeline(db, sid) {
  if (!sidOk(sid)) return null;
  const [[s], ev] = await q(db, [
    db.prepare('SELECT * FROM sessions WHERE sid=?').bind(sid),
    db.prepare('SELECT ts, type, name, value, path, proj, extra FROM events WHERE sid=? ORDER BY ts, id LIMIT 500').bind(sid),
  ]).then(([a, b]) => [a, b]);
  return s ? { session: s, events: ev } : null;
}

export async function exportData(db, kind, from, to) {
  const events = kind === 'events';
  const cols = events
    ? ['id', 'sid', 'ts', 'type', 'name', 'value', 'path', 'proj', 'extra']
    : ['sid', 'ts', 'last_ts', 'uid', 'landing', 'exit_path', 'ref_host', 'ref_url', 'utm_source', 'utm_medium', 'utm_campaign', 'channel', 'country', 'region', 'city', 'device', 'os', 'browser', 'lang', 'screen', 'pages', 'events', 'interact', 'active_s'];
  const [rows] = await q(db, [db.prepare(`SELECT ${cols.join(',')} FROM ${events ? 'events' : 'sessions'} WHERE ts>=? AND ts<? ORDER BY ts LIMIT 100000`).bind(from, to)]);
  const kinds = { ts: 'datetime', last_ts: 'datetime', pages: 'int', events: 'int', interact: 'int', active_s: 'num', id: 'int', value: 'num' };
  return { name: events ? 'Events' : 'Visits', cols: cols.map((c) => ({ h: c, ...(kinds[c] ? { t: kinds[c] } : {}) })), rows: rows.map((r) => cols.map((c) => r[c])) };
}

export async function resetStats(db) {
  await db.batch([db.prepare('DELETE FROM events'), db.prepare('DELETE FROM sessions')]);
}

export async function purgeOld(db, env) {
  const days = Math.max(30, parseInt(env.RETENTION_DAYS || '395', 10) || 395);
  const cutoff = Date.now() - days * DAY;
  await db.batch([db.prepare('DELETE FROM events WHERE ts<?').bind(cutoff), db.prepare('DELETE FROM sessions WHERE last_ts<?').bind(cutoff)]);
  return days;
}
