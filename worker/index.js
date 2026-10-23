// Cloudflare Worker: receives the contact form and sends two emails through Brevo
// (a notification to us and a confirmation to the visitor).
import { notificationEmail, confirmationEmail } from './emails.js';

const LIMITS = { name: 120, email: 200, org: 200, interest: 120, message: 5000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const cors = (origin, env) => {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
};

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

async function brevo(env, payload) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: env.SENDER_NAME, email: env.SENDER_EMAIL }, ...payload }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = cors(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);
    if (!(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).includes(origin)) {
      return json({ error: 'Forbidden' }, 403, headers);
    }

    let data;
    try { data = await request.json(); } catch { return json({ error: 'Invalid request' }, 400, headers); }

    // Honeypot: real visitors leave this empty. Pretend success to bots.
    if (data.website) return json({ ok: true }, 200, headers);

    const clean = {};
    for (const [k, max] of Object.entries(LIMITS)) clean[k] = String(data[k] ?? '').trim().slice(0, max);
    if (!clean.name || !EMAIL_RE.test(clean.email) || !clean.message) {
      return json({ error: 'Please fill in your name, a valid email and a message.' }, 400, headers);
    }

    const siteUrl = env.SITE_URL;
    try {
      await brevo(env, {
        to: [{ email: env.TO_EMAIL }],
        replyTo: { email: clean.email, name: clean.name },
        subject: `New inquiry from ${clean.name.replace(/[\r\n]/g, ' ')}`,
        htmlContent: notificationEmail(clean, siteUrl),
      });
      // Confirmation is best-effort: the inquiry already reached us.
      await brevo(env, {
        to: [{ email: clean.email, name: clean.name }],
        replyTo: { email: env.TO_EMAIL, name: env.SENDER_NAME },
        subject: 'We received your message',
        htmlContent: confirmationEmail(clean, siteUrl),
      }).catch((e) => console.error('confirmation failed', e.message));
    } catch (e) {
      console.error(e.message);
      return json({ error: 'Could not send your message right now.' }, 502, headers);
    }
    return json({ ok: true }, 200, headers);
  },
};
