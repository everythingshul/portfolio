// Sending invoices, the customer's invoice page, Stripe Checkout, the Stripe webhook, and the daily billing job
// (recurring invoices and payment reminders).
import { brevo } from './mail.js';
import { fail, getInvoice, getSettings, refreshPaid, addPayment, logAct, listRecurring, runRecurring, addDays, todayStr, money, line1, clean } from './billing.js';
import { invoiceEmail, invoiceSubject, receiptEmail, paymentNotice, quoteResponseNotice } from './billing-emails.js';

export const payLink = (env, inv) => `${env.SITE_URL}/pay/?t=${inv.token}`;
const adminLink = (env, inv) => `${env.SITE_URL}/admin/#invoice=${inv.id}`;
const db = (env) => env.BILL;

/* ------------------------------------------------------------------ sending */
export async function sendInvoice(env, id, opts) {
  opts = opts || {};
  const d = await getInvoice(env, id);
  const inv = d.invoice, c = d.customer;
  if (!c.email) throw fail('This customer has no email address. Add one first.');
  if (inv.status === 'void') throw fail('A voided document can not be sent.');
  if (inv.kind === 'invoice' && inv.status !== 'draft' && inv.balance <= 0) throw fail('This invoice is already paid.');
  const s = await getSettings(env);
  const reminder = opts.reminder || null;
  await brevo(env, {
    to: [{ email: c.email, name: c.name }],
    replyTo: { email: s.biz_email, name: s.biz_name },
    bcc: [{ email: env.ADMIN_EMAIL }],
    subject: invoiceSubject(d, s, reminder),
    htmlContent: invoiceEmail(d, s, payLink(env, inv), env.SITE_URL, reminder),
  });
  const now = Date.now();
  const first = inv.status === 'draft';
  await db(env).batch([
    db(env).prepare(`UPDATE invoices SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = COALESCE(sent_at, ?),
        last_reminder_at = CASE WHEN ? = 1 THEN ? ELSE last_reminder_at END, reminders = reminders + ?, updated = ? WHERE id = ?`).bind(now, reminder ? 1 : 0, now, reminder && opts.auto ? 1 : 0, now, id),
    logAct(env, { customer_id: inv.customer_id, invoice_id: id, type: 'email',
      text: `${reminder ? (opts.auto ? 'Automatic reminder' : 'Reminder') : first ? 'Sent' : 'Re-sent'} ${inv.kind === 'quote' ? 'quote' : 'invoice'} ${inv.number} to ${c.email}` }),
  ]);
  return { sent: true, to: c.email };
}

/* ------------------------------------------------------------------ customer's invoice page */
export async function publicInvoice(env, token) {
  if (!/^[\w-]{20,60}$/.test(token || '')) return null;
  const row = await db(env).prepare('SELECT id, viewed_at, status, customer_id FROM invoices WHERE token = ?').bind(token).first();
  if (!row || row.status === 'draft') return null;
  const d = await getInvoice(env, row.id);
  const s = await getSettings(env);
  if (!row.viewed_at) {
    await db(env).batch([
      db(env).prepare('UPDATE invoices SET viewed_at = ? WHERE id = ?').bind(Date.now(), row.id),
      logAct(env, { customer_id: row.customer_id, invoice_id: row.id, type: d.invoice.kind, text: `${d.customer.name} opened ${d.invoice.kind === 'quote' ? 'quote' : 'invoice'} ${d.invoice.number}` }),
    ]);
  }
  const i = d.invoice, c = d.customer;
  return {
    kind: i.kind, number: i.number, title: i.title || '', state: i.state, status: i.status, issue_date: i.issue_date, due_date: i.due_date, currency: i.currency,
    lines: d.lines, subtotal: i.subtotal, discount_cents: i.discount_cents, discount_type: i.discount_type, discount_value: i.discount_value,
    tax_rate: i.tax_rate, tax_cents: i.tax_cents, total: i.total, paid: i.paid, balance: i.balance, notes: i.notes, terms: i.terms || s.terms,
    customer: { name: c.name, org: c.org, email: c.email, phone: c.phone, addr1: c.addr1, addr2: c.addr2, city: c.city, state: c.state, zip: c.zip, country: c.country },
    business: { name: s.biz_name, address: s.biz_address, email: s.biz_email, phone: s.biz_phone, taxid: s.biz_taxid, logo_url: s.logo_url, website: String(env.SITE_URL || '').replace(/^https?:\/\//, '') },
    payments: d.payments.map((p) => ({ amount_cents: p.amount_cents, received_at: p.received_at, method: p.method, ref: p.method === 'stripe' ? '' : p.ref })),
    can_pay: !!env.STRIPE_SECRET_KEY && i.kind === 'invoice' && i.status === 'sent' && i.balance >= 50,
  };
}

export async function respondToQuote(env, token, action) {
  const row = await db(env).prepare('SELECT id, kind, status FROM invoices WHERE token = ?').bind(token).first();
  if (!row || row.kind !== 'quote') throw fail('Not found', 404);
  if (row.status !== 'sent') throw fail('This quote can no longer be changed.');
  const accepted = action === 'accept';
  await db(env).prepare('UPDATE invoices SET status = ?, updated = ? WHERE id = ?').bind(accepted ? 'accepted' : 'declined', Date.now(), row.id).run();
  const d = await getInvoice(env, row.id);
  await logAct(env, { customer_id: d.invoice.customer_id, invoice_id: row.id, type: 'quote', text: `${d.customer.name} ${accepted ? 'accepted' : 'declined'} quote ${d.invoice.number}` }).run();
  try {
    await brevo(env, { to: [{ email: env.ADMIN_EMAIL }], replyTo: d.customer.email ? { email: d.customer.email, name: d.customer.name } : undefined,
      subject: `Quote ${d.invoice.number} ${accepted ? 'accepted' : 'declined'} by ${d.customer.org || d.customer.name}`,
      htmlContent: quoteResponseNotice(d, accepted, adminLink(env, d.invoice), env.SITE_URL) });
  } catch (e) { console.error('quote notice', e.message); }
  return { ok: true, status: accepted ? 'accepted' : 'declined' };
}

/* ------------------------------------------------------------------ Stripe */
const flat = (obj, prefix, out) => {
  out = out || [];
  Object.entries(obj).forEach(([k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v == null) return;
    if (typeof v === 'object') flat(v, key, out); else out.push([key, String(v)]);
  });
  return out;
};

export async function stripe(env, path, params, method) {
  if (!env.STRIPE_SECRET_KEY) throw fail('Online payments are not set up yet.', 503);
  const res = await fetch('https://api.stripe.com/v1' + path, {
    method: method || (params ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: params ? new URLSearchParams(flat(params)).toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data.error && data.error.message) || `Stripe error ${res.status}`), { status: 502 });
  return data;
}

export async function createCheckout(env, token) {
  const row = await db(env).prepare('SELECT id FROM invoices WHERE token = ?').bind(token).first();
  if (!row) throw fail('Not found', 404);
  const d = await getInvoice(env, row.id);
  const i = d.invoice;
  if (i.kind !== 'invoice' || i.status !== 'sent') throw fail('This invoice can not be paid online.');
  if (i.balance < 50) throw fail('The balance is too small to pay online. Please contact us.');
  const s = await getSettings(env);
  const session = await stripe(env, '/checkout/sessions', {
    mode: 'payment',
    client_reference_id: i.id,
    customer_email: d.customer.email || undefined,
    line_items: { 0: { quantity: 1, price_data: { currency: i.currency, unit_amount: i.balance, product_data: { name: `Invoice ${i.number}`, description: `${s.biz_name}${d.customer.org ? ' – ' + d.customer.org : ''}` } } } },
    metadata: { invoice_id: i.id, invoice_number: i.number },
    payment_intent_data: { description: `Invoice ${i.number}`, metadata: { invoice_id: i.id, invoice_number: i.number } },
    success_url: `${payLink(env, i)}&paid=1`,
    cancel_url: payLink(env, i),
  });
  return { url: session.url };
}

export async function stripeStatus(env) {
  const out = { key: !!env.STRIPE_SECRET_KEY, webhook_secret: !!env.STRIPE_WEBHOOK_SECRET, mode: '', account: '', charges_enabled: null, error: '' };
  if (!out.key) return out;
  out.mode = /_live_/.test(env.STRIPE_SECRET_KEY) ? 'live' : 'test';
  try {
    const a = await stripe(env, '/account');
    out.account = (a.business_profile && a.business_profile.name) || (a.settings && a.settings.dashboard && a.settings.dashboard.display_name) || a.email || a.id;
    out.charges_enabled = !!a.charges_enabled;
  } catch (e) { out.error = e.message; }
  return out;
}

// Stripe signs each webhook: t=<time>,v1=<HMAC-SHA256 of "<time>.<body>">. Reject anything that does not match.
async function verifyStripe(raw, header, secret) {
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=')).filter((p) => p.length === 2));
  const t = parts.t; const sigs = String(header || '').split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${raw}`))), (b) => b.toString(16).padStart(2, '0')).join('');
  return sigs.some((sig) => sig.length === mac.length && [...sig].reduce((a, ch, idx) => a | (ch.charCodeAt(0) ^ mac.charCodeAt(idx)), 0) === 0);
}

async function afterPayment(env, invoiceId, paid, becamePaid) {
  const d = await getInvoice(env, invoiceId);
  const s = await getSettings(env);
  const link = payLink(env, d.invoice);
  const jobs = [];
  if (d.customer.email) jobs.push(brevo(env, { to: [{ email: d.customer.email, name: d.customer.name }], replyTo: { email: s.biz_email, name: s.biz_name },
    subject: `Payment received for invoice ${d.invoice.number}`, htmlContent: receiptEmail(d, s, paid, link, env.SITE_URL) }));
  jobs.push(brevo(env, { to: [{ email: env.ADMIN_EMAIL }], subject: `${money(paid, d.invoice.currency)} received from ${d.customer.org || d.customer.name}`,
    htmlContent: paymentNotice(d, paid, adminLink(env, d.invoice), env.SITE_URL, becamePaid) }));
  const r = await Promise.allSettled(jobs);
  r.forEach((x) => { if (x.status === 'rejected') console.error('payment email', x.reason && x.reason.message); });
}

export async function stripeWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.BILL) return new Response('Not configured', { status: 503 });
  const raw = await request.text();
  if (!(await verifyStripe(raw, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET))) return new Response('Bad signature', { status: 400 });
  let ev;
  try { ev = JSON.parse(raw); } catch { return new Response('Bad request', { status: 400 }); }
  const o = ev.data && ev.data.object;
  if (!o) return new Response('ok');
  try {
    if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
      const invoiceId = o.client_reference_id || (o.metadata && o.metadata.invoice_id);
      if (!invoiceId) return new Response('ok');
      if (o.payment_status === 'paid') {
        const res = await addPayment(env, { invoice_id: invoiceId, amount_cents: o.amount_total, method: 'stripe', ref: String(o.payment_intent || o.id), stripe_ref: 'pi:' + (o.payment_intent || o.id), received_at: (ev.created || Math.floor(Date.now() / 1000)) * 1000 });
        if (res) await afterPayment(env, invoiceId, o.amount_total, res.becamePaid);
      } else {
        const inv = await db(env).prepare('SELECT customer_id, number FROM invoices WHERE id = ?').bind(invoiceId).first();
        if (inv) await logAct(env, { customer_id: inv.customer_id, invoice_id: invoiceId, type: 'payment', text: `A bank payment for invoice ${inv.number} was started and is waiting to clear` }).run();
      }
    } else if (ev.type === 'checkout.session.async_payment_failed') {
      const invoiceId = o.client_reference_id || (o.metadata && o.metadata.invoice_id);
      const inv = invoiceId && await db(env).prepare('SELECT customer_id, number FROM invoices WHERE id = ?').bind(invoiceId).first();
      if (inv) {
        await logAct(env, { customer_id: inv.customer_id, invoice_id: invoiceId, type: 'payment', text: `The bank payment for invoice ${inv.number} failed` }).run();
        await brevo(env, { to: [{ email: env.ADMIN_EMAIL }], subject: `Bank payment failed for invoice ${inv.number}`, htmlContent: `<p>The bank payment for invoice ${inv.number} did not go through. The invoice is still unpaid.</p>` }).catch(() => {});
      }
    } else if (ev.type === 'charge.refunded') {
      const pi = o.payment_intent;
      const orig = pi && await db(env).prepare('SELECT invoice_id FROM payments WHERE stripe_ref = ?').bind('pi:' + pi).first();
      if (orig) {
        const done = (await db(env).prepare(`SELECT COALESCE(SUM(-amount_cents),0) AS s FROM payments WHERE invoice_id = ? AND method = 'stripe_refund' AND stripe_ref LIKE ?`).bind(orig.invoice_id, `refund:${pi}:%`).first()).s;
        const delta = (o.amount_refunded || 0) - done;
        if (delta > 0) await addPayment(env, { invoice_id: orig.invoice_id, amount_cents: -delta, method: 'stripe_refund', ref: String(pi), stripe_ref: `refund:${pi}:${o.amount_refunded}`, received_at: (ev.created || Math.floor(Date.now() / 1000)) * 1000 });
      }
    }
  } catch (e) {
    console.error('stripe webhook', ev.type, e.message);
    return new Response('error', { status: 500 }); // Stripe will try again
  }
  return new Response('ok');
}

/* ------------------------------------------------------------------ daily job */
const REMINDER_STEPS = [-3, 0, 7, 14, 30];   // days from the due date

export async function billingDaily(env) {
  if (!env.BILL) return { recurring: 0, reminders: 0 };
  const today = todayStr();
  let made = 0, reminded = 0;
  // 1. recurring invoices that are due (catches up at most 3 missed runs)
  for (const r of await listRecurring(env)) {
    if (!r.active) continue;
    let guard = 0;
    while (r.next_date <= today && (!r.end_date || r.next_date <= r.end_date) && guard++ < 3) {
      try { await runRecurring(env, r, sendInvoice); made++; } catch (e) { console.error('recurring', r.id, e.message); break; }
      const fresh = await db(env).prepare('SELECT next_date FROM recurring WHERE id = ?').bind(r.id).first();
      if (!fresh || fresh.next_date === r.next_date) break;
      r.next_date = fresh.next_date;
    }
    if (r.end_date && r.next_date > r.end_date) await db(env).prepare('UPDATE recurring SET active = 0 WHERE id = ?').bind(r.id).run();
  }
  // 2. payment reminders
  const s = await getSettings(env);
  if (s.reminders === '1') {
    const rows = (await db(env).prepare(`SELECT id, due_date, sent_at, reminders, last_reminder_at FROM invoices
      WHERE kind = 'invoice' AND status = 'sent' AND paid < total AND auto_remind = 1 AND sent_at IS NOT NULL AND due_date != '' LIMIT 300`).all()).results || [];
    for (const r of rows) {
      const sentDay = new Date(r.sent_at).toISOString().slice(0, 10);
      let k = r.reminders;
      while (k < REMINDER_STEPS.length && addDays(r.due_date, REMINDER_STEPS[k]) <= sentDay) k++;   // skip steps from before it was sent
      if (k >= REMINDER_STEPS.length) continue;
      if (today >= addDays(r.due_date, REMINDER_STEPS[k])) while (k + 1 < REMINDER_STEPS.length && addDays(r.due_date, REMINDER_STEPS[k + 1]) <= today) k++;   // send the most recent step, not a stale one
      if (today < addDays(r.due_date, REMINDER_STEPS[k])) { if (k !== r.reminders) await db(env).prepare('UPDATE invoices SET reminders = ? WHERE id = ?').bind(k, r.id).run(); continue; }
      if (r.last_reminder_at && Date.now() - r.last_reminder_at < 2 * 86400000) continue;
      const off = REMINDER_STEPS[k];
      try {
        await db(env).prepare('UPDATE invoices SET reminders = ? WHERE id = ?').bind(k, r.id).run();
        await sendInvoice(env, r.id, { reminder: { kind: off < 0 ? 'soon' : off === 0 ? 'due' : 'overdue' }, auto: true });
        reminded++;
      } catch (e) { console.error('reminder', r.id, e.message); }
    }
  }
  return { recurring: made, reminders: reminded };
}

export { line1, clean, refreshPaid };
