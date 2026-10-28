// Cloudflare Worker for the website chat's human handoff.
//
//   Visitor side (called from the site's chat widget):
//     POST /handoff   start a conversation (email + question), emails the team and the visitor
//     POST /send      add a visitor message to an open conversation
//     GET  /poll      fetch messages the visitor hasn't seen yet
//     GET  /voice     play a voice note (the id in the link is the secret)
//     GET  /learned  answers the team has taught Chesky (public, read-only)
//     POST /log      anonymous "I couldn't answer this" / thumbs up / thumbs down events
//     POST /t        site analytics events (see stats.js)
//     GET  /i?t=     the customer's invoice or quote page (billing-pay.js); POST /i/pay, POST /i/respond
//     POST /stripe/webhook   Stripe tells us a payment went through (signature checked)
//   Admin side (Bearer ADMIN_TOKEN; used by /admin/ on the site):
//     GET  /admin/list, GET /admin/conv, POST /admin/reply, POST /admin/status, POST /admin/delete
//     GET  /admin/learn, POST /admin/teach, POST /admin/forget, POST /admin/dismiss   (teaching Chesky)
//     /admin/b/*      customers (CRM), invoices, quotes, payments, reports (billing-admin.js)
//
// Conversations live in the CHAT KV namespace. Email goes out through Brevo.
import { adminNotification, customerConfirmation, customerReply, digestEmail } from './emails.js';
import { brevo } from './mail.js';
import { upsertLead } from './billing.js';
import { billingAdmin } from './billing-admin.js';
import { publicInvoice, respondToQuote, createCheckout, createIntent, confirmIntent, stripeWebhook, billingDaily } from './billing-pay.js';
import { buildXlsx, XLSX_TYPE } from './xlsx.js';
import { ingest, computeStats, liveStats, recentSessions, sessionTimeline, exportData, resetStats, purgeOld } from './stats.js';

const MAX_TEXT = 1500;
const MAX_MESSAGES = 300;
const TTL = 60 * 60 * 24 * 180; // forget conversations after 180 days
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_VOICE_B64 = 3_200_000;   // about 2.4 MB of audio
const MAX_VOICE_SECONDS = 65;
const VOICE_TYPES = { 'audio/wav': 'wav', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/webm': 'webm' };

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const oneLine = (v, max) => clean(v, max).replace(/[\r\n]+/g, ' ');

const origins = (env) => (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const corsHeaders = (origin, env) => ({
  'Access-Control-Allow-Origin': origins(env).includes(origin) ? origin : 'null',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  Vary: 'Origin',
});
const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

const newId = () => {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const ID_RE = /^[\w-]{16,40}$/;

const safeEqual = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

/* ------------------------------------------------------------------ storage */
const getConv = async (env, id) => (ID_RE.test(id || '') ? env.CHAT.get(`conv:${id}`, 'json') : null);

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;

// Validates a voice note sent as {data (base64), mime, dur, peaks}, stores the audio, and returns the chat message for it
// plus the attachment to put on the team's email (Brevo can't take .webm, so those are only playable in the inbox).
async function saveVoice(env, v) {
  if (!v || typeof v.data !== 'string' || !v.data || v.data.length > MAX_VOICE_B64) return null;
  const mime = String(v.mime || '').split(';')[0].toLowerCase();
  const ext = VOICE_TYPES[mime];
  if (!ext || !/^[A-Za-z0-9+/]+=*$/.test(v.data)) return null;
  let bytes;
  try { bytes = Uint8Array.from(atob(v.data), (c) => c.charCodeAt(0)); } catch { return null; }
  if (bytes.length < 200) return null;
  const dur = Math.max(0.5, Math.min(MAX_VOICE_SECONDS, Number(v.dur) || 0));
  const peaks = (Array.isArray(v.peaks) ? v.peaks : []).slice(0, 48).map((n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0))));
  const id = newId();
  await env.CHAT.put(`voice:${id}`, bytes, { expirationTtl: TTL, metadata: { mime } });
  return {
    message: { text: `Voice note (${fmtDur(dur)})`, voice: { id, dur, mime, peaks } },
    attachment: ext === 'webm' ? null : [{ name: `voice-note.${ext}`, content: v.data }],
  };
}

async function voiceFile(url, env) {
  const id = url.searchParams.get('id') || '';
  if (!ID_RE.test(id)) return new Response('Not found', { status: 404 });
  const { value, metadata } = await env.CHAT.getWithMetadata(`voice:${id}`, 'arrayBuffer');
  if (!value) return new Response('Not found', { status: 404 });
  return new Response(value, { status: 200, headers: { 'Content-Type': (metadata && metadata.mime) || 'audio/wav', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
}

const publicMsg = (m) => ({ from: m.from, text: m.text, ts: m.ts, ...(m.voice ? { voice: m.voice } : {}) });

const summary = (c) => ({
  id: c.id, name: c.name, email: c.email, status: c.status, unread: !!c.unread,
  created: c.created, updated: c.updated, count: c.messages.length,
  last: (c.messages[c.messages.length - 1] || {}).text?.slice(0, 120) || '',
  lastFrom: (c.messages[c.messages.length - 1] || {}).from || '',
});

async function putConv(env, c, touch = true) {
  if (touch) c.updated = Date.now();
  await env.CHAT.put(`conv:${c.id}`, JSON.stringify(c), { expirationTtl: TTL });
  const idx = (await env.CHAT.get('idx', 'json')) || [];
  const next = [summary(c), ...idx.filter((x) => x.id !== c.id)].slice(0, 500);
  await env.CHAT.put('idx', JSON.stringify(next));
}

async function dropConv(env, id) {
  const conv = await getConv(env, id);
  if (conv) await Promise.all(conv.messages.filter((m) => m.voice).map((m) => env.CHAT.delete(`voice:${m.voice.id}`)));
  await env.CHAT.delete(`conv:${id}`);
  const idx = (await env.CHAT.get('idx', 'json')) || [];
  await env.CHAT.put('idx', JSON.stringify(idx.filter((x) => x.id !== id)));
}

/* ------------------------------------------------------------------ email */

const adminLink = (env, id) => `${env.SITE_URL}/admin/#${id}`;
const chatLink = (env, id) => `${env.SITE_URL}/#chat=${id}`;

async function mailAdmin(env, conv, text, isNew, attachment) {
  const label = conv.name || conv.email;
  await brevo(env, {
    ...(attachment ? { attachment } : {}),
    to: [{ email: env.ADMIN_EMAIL }],
    replyTo: { email: conv.email, name: conv.name || conv.email },
    subject: `${isNew ? 'New chat request' : 'New chat message'} from ${oneLine(label, 80)}`,
    htmlContent: adminNotification(conv, text, adminLink(env, conv.id), env.SITE_URL, isNew),
  });
}

/* ------------------------------------------------------------------ rate limiting */
async function limited(env, request, bucket, max) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `rl:${bucket}:${ip}:${Math.floor(Date.now() / 3600000)}`;
  const n = parseInt((await env.CHAT.get(key)) || '0', 10);
  if (n >= max) return true;
  await env.CHAT.put(key, String(n + 1), { expirationTtl: 7200 });
  return false;
}

/* ------------------------------------------------------------------ learning */
// Chesky learns only what the team teaches him. Visitors can't add answers: they can only
// report (anonymously) what he couldn't answer or got wrong; the team reviews and teaches.
const MAX_LEARNED = 400;
const MAX_UNANSWERED = 300;
const ENTRY_RE = /^[\w:.\-]{1,40}$/;

const normQ = (q) => String(q).toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
// Questions are saved without names, emails or phone numbers.
const scrub = (q) => oneLine(q, 200)
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
  .replace(/\+?\d[\d\s().-]{6,}\d/g, '[number]');

const getLearned = async (env) => (await env.CHAT.get('learned', 'json')) || [];
const getUnans = async (env) => (await env.CHAT.get('unans', 'json')) || {};
const getStats = async (env) => (await env.CHAT.get('stats', 'json')) || {};

async function logEvent(request, env, h) {
  if (await limited(env, request, 'log', 120)) return json({ ok: true }, 200, h);
  let b;
  try { b = await request.json(); } catch { return json({ ok: true }, 200, h); }
  const type = ['miss', 'down', 'up'].includes(b.type) ? b.type : null;
  const q = scrub(b.q);
  const entry = ENTRY_RE.test(String(b.entry || '')) ? String(b.entry) : '';
  if (!type || !q) return json({ ok: true }, 200, h);

  if (entry && (type === 'up' || type === 'down')) {
    const stats = await getStats(env);
    const st = stats[entry] || { up: 0, down: 0 };
    st[type] += 1;
    st.last = Date.now();
    stats[entry] = st;
    const keys = Object.keys(stats);
    if (keys.length > 600) delete stats[keys.sort((a, c) => (stats[a].last || 0) - (stats[c].last || 0))[0]];
    await env.CHAT.put('stats', JSON.stringify(stats));
  }
  if (type === 'miss' || type === 'down') {
    const key = normQ(q);
    if (!key) return json({ ok: true }, 200, h);
    const un = await getUnans(env);
    const row = un[key] || { q, miss: 0, down: 0, entries: [], first: Date.now() };
    row[type] += 1;
    row.last = Date.now();
    if (entry && !row.entries.includes(entry) && row.entries.length < 3) row.entries.push(entry);
    un[key] = row;
    const keys = Object.keys(un);
    if (keys.length > MAX_UNANSWERED) {
      keys.sort((a, c) => (un[a].miss + un[a].down) - (un[c].miss + un[c].down) || (un[a].last || 0) - (un[c].last || 0));
      delete un[keys[0]];
    }
    await env.CHAT.put('unans', JSON.stringify(un));
  }
  return json({ ok: true }, 200, h);
}

async function learnedPublic(env, h) {
  const list = await getLearned(env);
  return json({ entries: list.map((e) => ({ id: e.id, qs: e.qs, r: e.r })) }, 200, h);
}

// Create or update a taught answer. `drop` removes the matching questions from the to-teach list.
async function teach(env, { id, qs, r, drop }) {
  const questions = (Array.isArray(qs) ? qs : [qs]).map((x) => clean(x, 200)).filter(Boolean).slice(0, 12);
  const reply = clean(r, 1500);
  if (!questions.length || !reply) return { error: 'A question and an answer are both needed.' };
  const list = await getLearned(env);
  let entry = id && list.find((e) => e.id === id);
  if (entry) { entry.qs = questions; entry.r = reply; entry.updated = Date.now(); }
  else {
    if (list.length >= MAX_LEARNED) return { error: 'Chesky\'s memory is full. Forget some answers first.' };
    entry = { id: 'L' + newId().slice(0, 8).replace(/[^A-Za-z0-9]/g, 'x'), qs: questions, r: reply, created: Date.now(), updated: Date.now() };
    list.unshift(entry);
  }
  await env.CHAT.put('learned', JSON.stringify(list));
  const toDrop = [...(Array.isArray(drop) ? drop : []), ...questions].map(normQ);
  if (toDrop.length) {
    const un = await getUnans(env);
    let changed = false;
    toDrop.forEach((k) => { if (un[k]) { delete un[k]; changed = true; } });
    if (changed) await env.CHAT.put('unans', JSON.stringify(un));
  }
  return { entry };
}

/* ------------------------------------------------------------------ handlers */
async function handoff(request, env, h) {
  if (await limited(env, request, 'handoff', 6)) return json({ error: 'Too many requests. Please email us directly.' }, 429, h);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Invalid request' }, 400, h); }
  const email = oneLine(b.email, 200);
  const message = clean(b.message, MAX_TEXT);
  const voice = b.voice ? await saveVoice(env, b.voice) : null;
  if (b.voice && !voice) return json({ error: 'That voice note could not be used. Please try recording it again.' }, 400, h);
  if (!EMAIL_RE.test(email) || (!message && !voice)) return json({ error: 'Please give a valid email and a message.' }, 400, h);

  const now = Date.now();
  const earlier = (Array.isArray(b.transcript) ? b.transcript : []).slice(-14)
    .map((m) => ({ from: m && m.role === 'customer' ? 'customer' : 'bot', text: clean(m && m.text, 600), ts: now }))
    .filter((m) => m.text);
  const conv = {
    id: newId(), name: oneLine(b.name, 120), email, status: 'open', unread: true, created: now, updated: now, notifiedAt: now,
    page: oneLine(b.page, 100),
    messages: [...earlier, ...(message ? [{ from: 'customer', text: message, ts: now }] : []), ...(voice ? [{ from: 'customer', ...voice.message, ts: now }] : [])],
  };
  await putConv(env, conv);
  try { await upsertLead(env, { name: conv.name, email: conv.email, source: 'chat', text: `Started a chat: "${(message || 'voice note').slice(0, 160)}"` }); } catch (e) { console.error('lead', e.message); }

  const out = { ok: true };
  const mailText = [message, voice && `🎤 ${voice.message.text}${voice.attachment ? ' is attached to this email' : ''}. You can also play it in the admin page.`].filter(Boolean).join('\n\n');
  try { await mailAdmin(env, conv, mailText, true, voice && voice.attachment); } catch (e) { console.error('admin mail', e.message); out.adminMail = false; }
  try {
    await brevo(env, {
      to: [{ email: conv.email, name: conv.name || conv.email }],
      replyTo: { email: env.ADMIN_EMAIL, name: env.SENDER_NAME },
      subject: 'We received your message',
      htmlContent: customerConfirmation(conv, chatLink(env, conv.id), env.SITE_URL),
    });
  } catch (e) { console.error('customer mail', e.message); }
  return json({ id: conv.id, count: conv.messages.length, ...out }, 200, h);
}

async function send(request, env, h) {
  if (await limited(env, request, 'send', 60)) return json({ error: 'Slow down a little.' }, 429, h);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Invalid request' }, 400, h); }
  const conv = await getConv(env, b.id);
  let text = clean(b.text, MAX_TEXT);
  if (!conv) return json({ error: 'Not found' }, 404, h);
  if (conv.status === 'closed') return json({ error: 'Closed' }, 409, h);
  if (conv.messages.length >= MAX_MESSAGES) return json({ error: 'Too long' }, 409, h);
  let voice = null;
  if (b.voice) {
    if (await limited(env, request, 'voice', 20)) return json({ error: 'Too many voice notes. Please type your message.' }, 429, h);
    voice = await saveVoice(env, b.voice);
    if (!voice) return json({ error: 'That voice note could not be used.' }, 400, h);
  }
  if (!text && !voice) return json({ error: 'Empty message' }, 400, h);

  if (text) conv.messages.push({ from: 'customer', text, ts: Date.now() });
  if (voice) { conv.messages.push({ from: 'customer', ...voice.message, ts: Date.now() }); text = [text, `🎤 ${voice.message.text}${voice.attachment ? ' is attached' : ''}`].filter(Boolean).join('\n\n'); }
  conv.unread = true;
  // Don't email the team for every line of a quick back-and-forth.
  const notify = !conv.notifiedAt || Date.now() - conv.notifiedAt > 30000;
  if (notify) conv.notifiedAt = Date.now();
  await putConv(env, conv);
  if (notify || voice) { try { await mailAdmin(env, conv, text, false, voice && voice.attachment); } catch (e) { console.error('admin mail', e.message); } }
  return json({ ok: true, count: conv.messages.length }, 200, h);
}

async function poll(url, env, h) {
  const conv = await getConv(env, url.searchParams.get('id'));
  if (!conv) return json({ error: 'Not found' }, 404, h);
  const after = Math.max(0, parseInt(url.searchParams.get('after') || '0', 10) || 0);
  return json({
    messages: conv.messages.slice(after).map(publicMsg),
    total: conv.messages.length,
    status: conv.status,
  }, 200, h);
}

/* ------------------------------------------------------------------ customer invoice pages */
async function invoicePage(request, url, env, h) {
  if (!env.BILL) return json({ error: 'Not found' }, 404, h);
  if (await limited(env, request, 'inv', 200)) return json({ error: 'Too many requests.' }, 429, h);
  const inv = await publicInvoice(env, url.searchParams.get('t') || '');
  return inv ? json(inv, 200, h) : json({ error: 'This link is not valid.' }, 404, h);
}
async function invoicePay(request, env, h) {
  if (!env.BILL) return json({ error: 'Not found' }, 404, h);
  if (await limited(env, request, 'pay', 30)) return json({ error: 'Too many attempts. Please try again later.' }, 429, h);
  let b; try { b = await request.json(); } catch { return json({ error: 'Invalid request' }, 400, h); }
  try { return json(await createCheckout(env, String(b.t || '')), 200, h); }
  catch (e) { return json({ error: e.status ? e.message : 'Online payment is not available right now. Please contact us.' }, e.status || 500, h); }
}
async function invoiceIntent(request, env, h) {
  if (!env.BILL) return json({ error: 'Not found' }, 404, h);
  if (await limited(env, request, 'pay', 40)) return json({ error: 'Too many attempts. Please try again later.' }, 429, h);
  let b; try { b = await request.json(); } catch { return json({ error: 'Invalid request' }, 400, h); }
  try { return json(await createIntent(env, String(b.t || '')), 200, h); }
  catch (e) { return json({ error: e.status ? e.message : 'Online payment is not available right now. Please contact us.' }, e.status || 500, h); }
}
async function invoiceConfirm(request, env, h) {
  if (!env.BILL) return json({ error: 'Not found' }, 404, h);
  if (await limited(env, request, 'payconfirm', 120)) return json({ error: 'Too many requests.' }, 429, h);
  let b; try { b = await request.json(); } catch { return json({ error: 'Invalid request' }, 400, h); }
  try { return json(await confirmIntent(env, String(b.t || ''), String(b.pi || '')), 200, h); }
  catch (e) { return json({ error: e.status ? e.message : 'Could not check the payment.' }, e.status || 500, h); }
}
async function invoiceRespond(request, env, h) {
  if (!env.BILL) return json({ error: 'Not found' }, 404, h);
  if (await limited(env, request, 'qresp', 20)) return json({ error: 'Too many attempts.' }, 429, h);
  let b; try { b = await request.json(); } catch { return json({ error: 'Invalid request' }, 400, h); }
  if (!['accept', 'decline'].includes(b.action)) return json({ error: 'Invalid request' }, 400, h);
  try { return json(await respondToQuote(env, String(b.t || ''), b.action), 200, h); }
  catch (e) { return json({ error: e.status ? e.message : 'Something went wrong.' }, e.status || 500, h); }
}

/* ------------------------------------------------------------------ admin */
async function admin(request, url, env, h) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!safeEqual(token, env.ADMIN_TOKEN)) return json({ error: 'Unauthorized' }, 401, h);
  const path = url.pathname;

  if (path === '/admin/list' && request.method === 'GET') {
    return json({ conversations: (await env.CHAT.get('idx', 'json')) || [] }, 200, h);
  }
  if (path === '/admin/conv' && request.method === 'GET') {
    const conv = await getConv(env, url.searchParams.get('id'));
    if (!conv) return json({ error: 'Not found' }, 404, h);
    if (conv.unread) { conv.unread = false; await putConv(env, conv, false); }
    return json(conv, 200, h);
  }

  if (path.startsWith('/admin/b/')) {
    const chatsFor = async (email) => {
      if (!email) return [];
      const idx = (await env.CHAT.get('idx', 'json')) || [];
      return idx.filter((c) => (c.email || '').toLowerCase() === email.toLowerCase()).slice(0, 10);
    };
    return billingAdmin(request, url, env, h, json, chatsFor);
  }

  if (path.startsWith('/admin/stats')) {
    if (!env.STATS) return json({ error: 'Analytics storage is not set up yet.' }, 503, h);
    const sp = url.searchParams;
    const now = Date.now();
    const from = Math.max(0, parseInt(sp.get('from') || '0', 10) || now - 7 * 86400000);
    const to = Math.max(from + 1, parseInt(sp.get('to') || '0', 10) || now + 1);
    if (path === '/admin/stats' && request.method === 'GET') {
      const tz = Math.max(-840, Math.min(840, parseInt(sp.get('tz') || '0', 10) || 0));
      return json(await computeStats(env.STATS, { from, to, tz, compare: sp.get('cmp') !== '0' }), 200, h);
    }
    if (path === '/admin/stats/live') return json(await liveStats(env.STATS), 200, h);
    if (path === '/admin/stats/sessions') return json({ sessions: await recentSessions(env.STATS, from, to) }, 200, h);
    if (path === '/admin/stats/session') {
      const t = await sessionTimeline(env.STATS, sp.get('sid'));
      return t ? json(t, 200, h) : json({ error: 'Not found' }, 404, h);
    }
    if (path === '/admin/stats/export') {
      const kind = sp.get('kind') === 'events' ? 'events' : 'sessions';
      const sheet = await exportData(env.STATS, kind, from, to);
      return new Response(buildXlsx([sheet]), { status: 200, headers: { ...h, 'Content-Type': XLSX_TYPE, 'Content-Disposition': `attachment; filename="${kind}.xlsx"`, 'Cache-Control': 'no-store' } });
    }
    if (path === '/admin/stats/reset' && request.method === 'POST') { await resetStats(env.STATS); return json({ ok: true }, 200, h); }
    return json({ error: 'Not found' }, 404, h);
  }

  if (path === '/admin/learn' && request.method === 'GET') {
    const un = await getUnans(env);
    const unanswered = Object.keys(un).map((k) => ({ key: k, ...un[k] }))
      .sort((a, c) => (c.miss + c.down) - (a.miss + a.down) || (c.last || 0) - (a.last || 0));
    return json({ unanswered, learned: await getLearned(env), stats: await getStats(env) }, 200, h);
  }

  let b = {};
  try { b = await request.json(); } catch { return json({ error: 'Invalid request' }, 400, h); }

  if (path === '/admin/teach') {
    const r = await teach(env, b);
    return r.error ? json({ error: r.error }, 400, h) : json({ ok: true, entry: r.entry }, 200, h);
  }
  if (path === '/admin/forget') {
    const list = await getLearned(env);
    await env.CHAT.put('learned', JSON.stringify(list.filter((e) => e.id !== b.id)));
    return json({ ok: true }, 200, h);
  }
  if (path === '/admin/dismiss') {
    const un = await getUnans(env);
    delete un[normQ(b.key || '')];
    await env.CHAT.put('unans', JSON.stringify(un));
    return json({ ok: true }, 200, h);
  }

  const conv = await getConv(env, b.id);
  if (!conv) return json({ error: 'Not found' }, 404, h);

  if (path === '/admin/reply') {
    const text = clean(b.text, 4000);
    if (!text) return json({ error: 'Empty reply' }, 400, h);
    conv.messages.push({ from: 'admin', text, ts: Date.now() });
    conv.status = 'open';
    conv.unread = false;
    await putConv(env, conv);
    let emailed = true;
    try {
      await brevo(env, {
        to: [{ email: conv.email, name: conv.name || conv.email }],
        replyTo: { email: env.ADMIN_EMAIL, name: env.SENDER_NAME },
        bcc: [{ email: env.ADMIN_EMAIL }], // keep a copy of every answer in the team inbox
        subject: 'Reply from Everything Shul',
        htmlContent: customerReply(conv, text, chatLink(env, conv.id), env.SITE_URL),
      });
    } catch (e) { console.error('customer mail', e.message); emailed = false; }
    // "Also teach Chesky": save this answer for the question it responded to.
    let taught = null;
    if (b.teach && b.teach.q && b.teach.a) {
      const alts = Array.isArray(b.teach.alts) ? b.teach.alts : [];
      const r = await teach(env, { qs: [b.teach.q, ...alts], r: b.teach.a });
      taught = r.error ? { error: r.error } : { id: r.entry.id };
    }
    return json({ ok: true, emailed, taught, conv }, 200, h);
  }
  if (path === '/admin/status') {
    conv.status = b.status === 'closed' ? 'closed' : 'open';
    await putConv(env, conv);
    return json({ ok: true, conv }, 200, h);
  }
  if (path === '/admin/delete') {
    await dropConv(env, conv.id);
    return json({ ok: true }, 200, h);
  }
  return json({ error: 'Not found' }, 404, h);
}

// Weekly summary email (Mondays) and daily cleanup of old analytics data.
async function sendDigest(env) {
  const to = Date.now();
  const from = to - 7 * 86400000;
  const d = await computeStats(env.STATS, { from, to, tz: 0, compare: true });
  const fmt = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  await brevo(env, {
    to: [{ email: env.ADMIN_EMAIL }],
    subject: `Your week on the website: ${d.totals.visitors} visitors, ${d.totals.pageviews} pageviews`,
    htmlContent: digestEmail(d, env.SITE_URL, `${env.SITE_URL}/admin/#analytics`, `${fmt(from)} to ${fmt(to)}`),
  });
}

export default {
  async scheduled(event, env) {
    try {
      if (event.cron === '0 13 * * 1') { if (env.STATS && (env.DIGEST || 'on') !== 'off') await sendDigest(env); }
      else {
        if (env.STATS) await purgeOld(env.STATS, env);
        if (env.BILL) console.log('billing daily', JSON.stringify(await billingDaily(env)));
      }
    } catch (e) { console.error('scheduled', event.cron, e && e.message); }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const h = corsHeaders(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    // <audio> tags send no Origin header; the unguessable id in the link is what protects a voice note.
    if (url.pathname === '/voice' && request.method === 'GET') return await voiceFile(url, env);
    // Stripe calls this itself (no Origin); the signature is what proves it is Stripe.
    if (url.pathname === '/stripe/webhook' && request.method === 'POST') return await stripeWebhook(request, env);
    if (!origins(env).includes(origin)) return json({ error: 'Forbidden' }, 403, h);

    try {
      if (url.pathname.startsWith('/admin/')) return await admin(request, url, env, h);
      if (url.pathname === '/handoff' && request.method === 'POST') return await handoff(request, env, h);
      if (url.pathname === '/send' && request.method === 'POST') return await send(request, env, h);
      if (url.pathname === '/poll' && request.method === 'GET') return await poll(url, env, h);
      if (url.pathname === '/learned' && request.method === 'GET') return await learnedPublic(env, h);
      if (url.pathname === '/log' && request.method === 'POST') return await logEvent(request, env, h);
      if (url.pathname === '/t' && request.method === 'POST') return await ingest(request, env, h);
      if (url.pathname === '/i' && request.method === 'GET') return await invoicePage(request, url, env, h);
      if (url.pathname === '/i/pay' && request.method === 'POST') return await invoicePay(request, env, h);
      if (url.pathname === '/i/intent' && request.method === 'POST') return await invoiceIntent(request, env, h);
      if (url.pathname === '/i/confirm' && request.method === 'POST') return await invoiceConfirm(request, env, h);
      if (url.pathname === '/i/respond' && request.method === 'POST') return await invoiceRespond(request, env, h);
      return json({ error: 'Not found' }, 404, h);
    } catch (err) {
      console.error('chat worker error', err && err.message);
      return json({ error: 'Something went wrong.' }, 500, h);
    }
  },
};
