// Cloudflare Worker for the website chat's human handoff.
//
//   Visitor side (called from the site's chat widget):
//     POST /handoff   start a conversation (email + question), emails the team and the visitor
//     POST /send      add a visitor message to an open conversation
//     GET  /poll      fetch messages the visitor hasn't seen yet
//   Admin side (Bearer ADMIN_TOKEN; used by /admin/ on the site):
//     GET  /admin/list, GET /admin/conv, POST /admin/reply, POST /admin/status, POST /admin/delete
//
// Conversations live in the CHAT KV namespace. Email goes out through Brevo.
import { adminNotification, customerConfirmation, customerReply } from './emails.js';

const MAX_TEXT = 1500;
const MAX_MESSAGES = 300;
const TTL = 60 * 60 * 24 * 180; // forget conversations after 180 days
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  await env.CHAT.delete(`conv:${id}`);
  const idx = (await env.CHAT.get('idx', 'json')) || [];
  await env.CHAT.put('idx', JSON.stringify(idx.filter((x) => x.id !== id)));
}

/* ------------------------------------------------------------------ email */
async function brevo(env, payload) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: env.SENDER_NAME, email: env.SENDER_EMAIL }, ...payload }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
}

const adminLink = (env, id) => `${env.SITE_URL}/admin/#${id}`;
const chatLink = (env, id) => `${env.SITE_URL}/#chat=${id}`;

async function mailAdmin(env, conv, text, isNew) {
  const label = conv.name || conv.email;
  await brevo(env, {
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

/* ------------------------------------------------------------------ handlers */
async function handoff(request, env, h) {
  if (await limited(env, request, 'handoff', 6)) return json({ error: 'Too many requests. Please email us directly.' }, 429, h);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Invalid request' }, 400, h); }
  const email = oneLine(b.email, 200);
  const message = clean(b.message, MAX_TEXT);
  if (!EMAIL_RE.test(email) || !message) return json({ error: 'Please give a valid email and a message.' }, 400, h);

  const now = Date.now();
  const earlier = (Array.isArray(b.transcript) ? b.transcript : []).slice(-14)
    .map((m) => ({ from: m && m.role === 'customer' ? 'customer' : 'bot', text: clean(m && m.text, 600), ts: now }))
    .filter((m) => m.text);
  const conv = {
    id: newId(), name: oneLine(b.name, 120), email, status: 'open', unread: true, created: now, updated: now, notifiedAt: now,
    page: oneLine(b.page, 100),
    messages: [...earlier, { from: 'customer', text: message, ts: now }],
  };
  await putConv(env, conv);

  const out = { ok: true };
  try { await mailAdmin(env, conv, message, true); } catch (e) { console.error('admin mail', e.message); out.adminMail = false; }
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
  const text = clean(b.text, MAX_TEXT);
  if (!conv) return json({ error: 'Not found' }, 404, h);
  if (!text) return json({ error: 'Empty message' }, 400, h);
  if (conv.status === 'closed') return json({ error: 'Closed' }, 409, h);
  if (conv.messages.length >= MAX_MESSAGES) return json({ error: 'Too long' }, 409, h);

  conv.messages.push({ from: 'customer', text, ts: Date.now() });
  conv.unread = true;
  // Don't email the team for every line of a quick back-and-forth.
  const notify = !conv.notifiedAt || Date.now() - conv.notifiedAt > 30000;
  if (notify) conv.notifiedAt = Date.now();
  await putConv(env, conv);
  if (notify) { try { await mailAdmin(env, conv, text, false); } catch (e) { console.error('admin mail', e.message); } }
  return json({ ok: true, count: conv.messages.length }, 200, h);
}

async function poll(url, env, h) {
  const conv = await getConv(env, url.searchParams.get('id'));
  if (!conv) return json({ error: 'Not found' }, 404, h);
  const after = Math.max(0, parseInt(url.searchParams.get('after') || '0', 10) || 0);
  return json({
    messages: conv.messages.slice(after).map((m) => ({ from: m.from, text: m.text, ts: m.ts })),
    total: conv.messages.length,
    status: conv.status,
  }, 200, h);
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

  let b = {};
  try { b = await request.json(); } catch { return json({ error: 'Invalid request' }, 400, h); }
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
        subject: 'Reply from Everything Shul',
        htmlContent: customerReply(conv, text, chatLink(env, conv.id), env.SITE_URL),
      });
    } catch (e) { console.error('customer mail', e.message); emailed = false; }
    return json({ ok: true, emailed, conv }, 200, h);
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const h = corsHeaders(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (!origins(env).includes(origin)) return json({ error: 'Forbidden' }, 403, h);

    try {
      if (url.pathname.startsWith('/admin/')) return await admin(request, url, env, h);
      if (url.pathname === '/handoff' && request.method === 'POST') return await handoff(request, env, h);
      if (url.pathname === '/send' && request.method === 'POST') return await send(request, env, h);
      if (url.pathname === '/poll' && request.method === 'GET') return await poll(url, env, h);
      return json({ error: 'Not found' }, 404, h);
    } catch (err) {
      console.error('chat worker error', err && err.message);
      return json({ error: 'Something went wrong.' }, 500, h);
    }
  },
};
