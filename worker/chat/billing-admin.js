// The /admin/b/* API used by the Customers and Billing tabs of /admin/. Only reached after the admin password is checked.
import * as B from './billing.js';
import { sendInvoice, stripeStatus } from './billing-pay.js';

const need = (v, what) => { if (!v) throw B.fail(`Missing ${what}`); return v; };

export async function billingAdmin(request, url, env, h, json, getChats) {
  if (!env.BILL) return json({ error: 'Billing storage is not set up yet.' }, 503, h);
  const path = url.pathname.slice('/admin/b/'.length);
  const sp = url.searchParams;
  try {
    if (request.method === 'GET') {
      const q = Object.fromEntries(sp.entries());
      switch (path) {
        case 'dashboard': return json(await B.dashboard(env), 200, h);
        case 'settings': return json({ settings: await B.getSettings(env) }, 200, h);
        case 'stripe': return json(await stripeStatus(env), 200, h);
        case 'customers': return json(await B.listCustomers(env, q), 200, h);
        case 'customer': {
          const c = await B.getCustomer(env, need(q.id, 'id'));
          return json({ ...c, chats: getChats ? await getChats(c.customer.email) : [] }, 200, h);
        }
        case 'items': return json({ items: await B.listItems(env) }, 200, h);
        case 'invoices': return json(await B.listInvoices(env, q), 200, h);
        case 'invoice': return json(await B.getInvoice(env, need(q.id, 'id')), 200, h);
        case 'payments': return json(await B.listPayments(env, q), 200, h);
        case 'recurring': return json({ recurring: await B.listRecurring(env) }, 200, h);
        case 'reports': return json(await B.reports(env, q.from, q.to), 200, h);
        case 'search': return json(await B.search(env, q.q), 200, h);
        case 'export': {
          const kind = ['customers', 'payments'].includes(q.kind) ? q.kind : 'invoices';
          return new Response(await B.exportCsv(env, kind, q.from, q.to), { status: 200, headers: { ...h, 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' } });
        }
        default: return json({ error: 'Not found' }, 404, h);
      }
    }
    if (request.method !== 'POST') return json({ error: 'Not found' }, 404, h);
    let b;
    try { b = await request.json(); } catch { return json({ error: 'Invalid request' }, 400, h); }
    switch (path) {
      case 'settings': return json({ settings: await B.saveSettings(env, b) }, 200, h);
      case 'customer/save': return json({ id: await B.saveCustomer(env, b) }, 200, h);
      case 'customer/delete': await B.deleteCustomer(env, need(b.id, 'id')); return json({ ok: true }, 200, h);
      case 'note': await B.addNote(env, b); return json({ ok: true }, 200, h);
      case 'task/save': return json({ id: await B.saveTask(env, b) }, 200, h);
      case 'task/toggle': await B.toggleTask(env, need(b.id, 'id'), !!b.done); return json({ ok: true }, 200, h);
      case 'task/delete': await B.deleteTask(env, need(b.id, 'id')); return json({ ok: true }, 200, h);
      case 'item/save': return json({ id: await B.saveItem(env, b) }, 200, h);
      case 'item/delete': await B.deleteItem(env, need(b.id, 'id')); return json({ ok: true }, 200, h);
      case 'invoice/save': {
        const id = await B.saveInvoice(env, b);
        let sent = null;
        if (b.send) { try { sent = await sendInvoice(env, id); } catch (e) { return json({ id, sent: false, sendError: e.message }, 200, h); } }
        return json({ id, sent: !!sent }, 200, h);
      }
      case 'invoice/send': return json(await sendInvoice(env, need(b.id, 'id')), 200, h);
      case 'invoice/remind': return json(await sendInvoice(env, need(b.id, 'id'), { reminder: { kind: 'overdue' } }), 200, h);
      case 'invoice/status': await B.setStatus(env, need(b.id, 'id'), b.action); return json({ ok: true }, 200, h);
      case 'invoice/duplicate': return json({ id: await B.duplicateInvoice(env, need(b.id, 'id')) }, 200, h);
      case 'invoice/convert': return json({ id: await B.convertQuote(env, need(b.id, 'id')) }, 200, h);
      case 'invoice/auto-remind': await env.BILL.prepare('UPDATE invoices SET auto_remind = ? WHERE id = ?').bind(b.on ? 1 : 0, need(b.id, 'id')).run(); return json({ ok: true }, 200, h);
      case 'payment/add': {
        const date = B.validDate(b.date) ? Date.parse(b.date + 'T12:00:00Z') : Date.now();
        const r = await B.addPayment(env, { invoice_id: need(b.invoice_id, 'invoice'), amount_cents: b.amount_cents, method: b.method, ref: b.ref, note: b.note, received_at: date });
        return json({ ok: true, becamePaid: !!(r && r.becamePaid) }, 200, h);
      }
      case 'payment/delete': await B.deletePayment(env, need(b.id, 'id')); return json({ ok: true }, 200, h);
      case 'recurring/save': return json({ id: await B.saveRecurring(env, b) }, 200, h);
      case 'recurring/delete': await B.deleteRecurring(env, need(b.id, 'id')); return json({ ok: true }, 200, h);
      case 'recurring/run': {
        const r = (await B.listRecurring(env)).find((x) => x.id === b.id);
        if (!r) throw B.fail('Not found', 404);
        return json({ id: await B.runRecurring(env, r, null) }, 200, h);
      }
      case 'import/customers': return json(await B.importCustomers(env, Array.isArray(b.rows) ? b.rows : [], b.mode, !!b.dry), 200, h);
      case 'import/invoices': return json(await B.importInvoices(env, Array.isArray(b.rows) ? b.rows : [], { source: b.source }, !!b.dry), 200, h);
      case 'wipe':
        if (b.confirm !== 'DELETE EVERYTHING') throw B.fail('Type DELETE EVERYTHING to confirm.');
        await B.wipeAll(env); return json({ ok: true }, 200, h);
      default: return json({ error: 'Not found' }, 404, h);
    }
  } catch (e) {
    if (e && e.status) return json({ error: e.message }, e.status, h);
    console.error('billing admin', path, e && e.message);
    return json({ error: 'Something went wrong: ' + (e && e.message ? e.message.slice(0, 160) : 'unknown') }, 500, h);
  }
}
