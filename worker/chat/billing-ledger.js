// The business ledger (all money in and out), invoice PDFs, taking a one-off payment, and Gmail-style labels.
// Rows with src = 'payment' mirror the payments table and are created by themselves; everything else is typed in.
// Maaser is a fixed ten percent of every dollar that comes in; marking it given records a charity expense.
import { all, one, run, st, batch, fail, getSettings, getInvoice, saveInvoice, saveCustomer, addPayment, logAct, validDate, todayStr, addDays, money, clean, line1 } from './billing.js';
import { payLink, sendInvoice, afterPayment } from './billing-pay.js';
import { Pdf } from './pdf.js';

export const MAASER_PCT = 10;
const maaserFor = (cents) => Math.round((cents * MAASER_PCT) / 100);
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const FILE_MAX = 10 * 1024 * 1024;

// YYYY-MM-DD of a moment on the business clock (not UTC, so an evening payment lands on today's date)
export const localDate = (ms, tz) => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); } catch { return new Date(ms).toISOString().slice(0, 10); }
};

// ---- businesses: one ledger can keep the books of several. The home business is made automatically and gets invoice payments.
const BIZ_COLORS = ['#4986e7', '#16a765', '#ff7537', '#b99aff', '#f691b2', '#fad165', '#2da2bb', '#fb4c2f'];
export async function ensureHome(env) {
  let home = await one(env, 'SELECT * FROM ledger_businesses WHERE is_home = 1 ORDER BY id LIMIT 1');
  if (!home) {
    const s = await getSettings(env); const now = Date.now();
    const id = (await run(env, `INSERT INTO ledger_businesses (name, color, is_home, created, updated) VALUES (?, ?, 1, ?, ?)`, line1(s.biz_name, 80) || 'My business', BIZ_COLORS[0], now, now)).meta.last_row_id;
    home = await one(env, 'SELECT * FROM ledger_businesses WHERE id = ?', id);
    await run(env, 'UPDATE ledger SET business_id = ? WHERE business_id IS NULL', id);   // entries made before there were businesses belong to the home business
  }
  return home;
}
export async function businessList(env) {
  await ensureHome(env);
  return all(env, `SELECT b.*, (SELECT COUNT(*) FROM ledger l WHERE l.business_id = b.id) AS entries FROM ledger_businesses b ORDER BY b.is_home DESC, LOWER(b.name), b.id`);
}
export async function saveBusiness(env, b) {
  await ensureHome(env);
  const name = line1(b.name, 80); if (!name) throw fail('Give the business a name.');
  const color = /^#[0-9a-fA-F]{6}$/.test(String(b.color || '')) ? b.color.toLowerCase() : null;
  const clash = await one(env, 'SELECT id FROM ledger_businesses WHERE LOWER(name) = LOWER(?)', name);
  const now = Date.now();
  if (b.id) {
    const cur = await one(env, 'SELECT * FROM ledger_businesses WHERE id = ?', Number(b.id)); if (!cur) throw fail('Business not found', 404);
    if (clash && clash.id !== cur.id) throw fail(`There is already a business called "${name}".`);
    await run(env, 'UPDATE ledger_businesses SET name = ?, color = ?, updated = ? WHERE id = ?', name, color || cur.color, now, cur.id);
    return one(env, 'SELECT * FROM ledger_businesses WHERE id = ?', cur.id);
  }
  if (clash) throw fail(`There is already a business called "${name}".`);
  const n = (await one(env, 'SELECT COUNT(*) n FROM ledger_businesses')).n;
  const id = (await run(env, 'INSERT INTO ledger_businesses (name, color, is_home, created, updated) VALUES (?, ?, 0, ?, ?)', name, color || BIZ_COLORS[n % BIZ_COLORS.length], now, now)).meta.last_row_id;
  return one(env, 'SELECT * FROM ledger_businesses WHERE id = ?', id);
}
export async function deleteBusiness(env, id) {
  const b = await one(env, 'SELECT * FROM ledger_businesses WHERE id = ?', id); if (!b) throw fail('Business not found', 404);
  if (b.is_home) throw fail('This is the business that receives invoice payments, so it can not be deleted. You can rename it.');
  const n = (await one(env, 'SELECT COUNT(*) n FROM ledger WHERE business_id = ?', id)).n;
  if (n) throw fail(`${b.name} still has ${n} ledger entr${n === 1 ? 'y' : 'ies'}. Delete or move them first (open an entry and change its business).`);
  await run(env, 'DELETE FROM ledger_businesses WHERE id = ?', id);
}

export async function ledgerOptions(env) {
  const s = await getSettings(env);
  return { accounts: list(s.ledger_accounts), paid_with: list(s.ledger_paid_with), categories: list(s.ledger_categories), maaser_pct: MAASER_PCT, timezone: s.biz_timezone, businesses: await businessList(env) };
}

const METHODS = { stripe: 'Credit card (Stripe)', stripe_refund: 'Refund to card (Stripe)', cash: 'Cash', check: 'Check', zelle: 'Zelle', ach: 'ACH / bank transfer', wire: 'Wire', imported: 'Imported', other: 'Other' };
const methodLabel = (m) => METHODS[m] || (m ? m[0].toUpperCase() + m.slice(1) : '');
// Card payments go through Stripe and cash is cash. Checks, Zelle and transfers land in the first account that is a bank account.
const accountFor = (m, accounts) => (m === 'stripe' || m === 'stripe_refund' ? 'Stripe' : m === 'cash' ? 'Cash' : accounts.find((a) => !/stripe|cash|credit card/i.test(a)) || '');

/** Mirror every payment and refund into the ledger (safe to call as often as you like). */
export async function syncLedger(env) {
  const s = await getSettings(env); const accounts = list(s.ledger_accounts); const home = await ensureHome(env);
  // payments that were deleted take their ledger rows (and any maaser expense made from them) with them
  const gone = await all(env, `SELECT id FROM ledger WHERE src = 'payment' AND src_id NOT IN (SELECT id FROM payments)`);
  if (gone.length) {
    const ids = gone.map((g) => g.id);
    await batch(env, ids.flatMap((id) => [st(env, 'DELETE FROM ledger WHERE maaser_of = ?', id), st(env, `DELETE FROM label_links WHERE entity_type = 'ledger' AND entity_id = ?`, String(id)), st(env, 'DELETE FROM ledger WHERE id = ?', id)]));
  }
  const rows = await all(env, `SELECT p.*, i.number AS inv_no, i.title AS inv_title, c.name AS cname, c.org AS corg FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN customers c ON c.id = p.customer_id
    WHERE NOT EXISTS (SELECT 1 FROM ledger l WHERE l.src = 'payment' AND l.src_id = p.id) ORDER BY p.received_at, p.created`);
  const now = Date.now();
  for (let i = 0; i < rows.length; i += 40) {
    await batch(env, rows.slice(i, i + 40).map((p) => {
      const out = p.amount_cents < 0, cents = Math.abs(p.amount_cents);
      return st(env, `INSERT OR IGNORE INTO ledger (date, direction, amount_cents, vendor, invoice_ref, description, paid_with, account, notes, category, maaser_cents, src, src_id, invoice_id, customer_id, business_id, created_by, created, updated)
        VALUES (?,?,?,?,?,?,?,?,?,?,?, 'payment', ?, ?, ?, ?, 'system', ?, ?)`,
      localDate(p.received_at, s.biz_timezone), out ? 'out' : 'in', cents, p.corg || p.cname || '', p.inv_no || '', out ? `Refund: ${p.inv_title || p.inv_no}` : p.inv_title || 'Payment',
      methodLabel(p.method), accountFor(p.method, accounts), [p.ref ? `Ref: ${p.ref}` : '', p.note || ''].filter(Boolean).join('. '), out ? 'Refunds' : 'Sales', out ? 0 : maaserFor(cents),
      p.id, p.invoice_id, p.customer_id || null, home.id, p.created || now, now);
    }));
  }
  return rows.length;
}

const shape = (r) => ({ ...r, signed_cents: r.direction === 'out' ? -r.amount_cents : r.amount_cents, auto: r.src === 'payment', has_file: !!r.has_file });
const get = async (env, id) => one(env, 'SELECT * FROM ledger WHERE id = ?', id);

/** from/to are YYYY-MM-DD or 'all'. */
export async function ledgerList(env, p) {
  await syncLedger(env);
  const w = [], a = [];
  if (validDate(p.from)) { w.push('date >= ?'); a.push(p.from); }
  if (validDate(p.to)) { w.push('date <= ?'); a.push(p.to); }
  if (p.direction === 'in' || p.direction === 'out') { w.push('direction = ?'); a.push(p.direction); }
  const biz = Number(p.business) || 0; if (biz) { w.push('business_id = ?'); a.push(biz); }
  if (p.account) { w.push('account = ?'); a.push(p.account); }
  if (p.category) { w.push('category = ?'); a.push(p.category); }
  if (p.q) { w.push(`(vendor LIKE ? ESCAPE '\\' OR invoice_ref LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR account LIKE ? ESCAPE '\\' OR paid_with LIKE ? ESCAPE '\\')`); const x = '%' + String(p.q).replace(/[%_\\]/g, (c) => '\\' + c) + '%'; a.push(x, x, x, x, x, x); }
  const where = w.length ? ' WHERE ' + w.join(' AND ') : '';
  const rows = (await all(env, `SELECT * FROM ledger${where} ORDER BY date DESC, id DESC LIMIT 5000`, ...a)).map(shape);
  const t = await one(env, `SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN direction='in' THEN amount_cents END),0) money_in, COALESCE(SUM(CASE WHEN direction='out' THEN amount_cents END),0) money_out,
    COALESCE(SUM(CASE WHEN direction='in' THEN maaser_cents END),0) maaser, COALESCE(SUM(CASE WHEN direction='in' AND maaser_given=0 THEN maaser_cents END),0) maaser_owed,
    COALESCE(SUM(CASE WHEN direction='in' AND maaser_given=1 THEN maaser_cents END),0) maaser_given FROM ledger${where}`, ...a);
  const byCategory = await all(env, `SELECT COALESCE(NULLIF(category,''),'(none)') k, direction, SUM(amount_cents) c, COUNT(*) n FROM ledger${where} GROUP BY k, direction ORDER BY c DESC`, ...a);
  const balances = await all(env, `SELECT COALESCE(NULLIF(account,''),'(no account)') k, SUM(CASE direction WHEN 'in' THEN amount_cents ELSE -amount_cents END) net, COUNT(*) n FROM ledger${biz ? ' WHERE business_id = ?' : ''} GROUP BY k ORDER BY net DESC`, ...(biz ? [biz] : []));
  const byBusiness = await all(env, `SELECT business_id id, COALESCE(SUM(CASE WHEN direction='in' THEN amount_cents END),0) money_in, COALESCE(SUM(CASE WHEN direction='out' THEN amount_cents END),0) money_out, COUNT(*) n FROM ledger${where} GROUP BY business_id`, ...a);
  return { rows, totals: { entries: t.n, money_in: t.money_in, money_out: t.money_out, net: t.money_in - t.money_out, maaser: t.maaser, maaser_owed: t.maaser_owed, maaser_given: t.maaser_given }, byCategory, balances, byBusiness, options: await ledgerOptions(env) };
}

const cleanEntry = (b, locked) => {
  const o = {};
  const str = (k, n) => { if (k in b) o[k] = line1(b[k], n); };
  ['vendor', 'invoice_ref', 'description', 'paid_with', 'account', 'category'].forEach((k) => str(k, 200));
  if ('notes' in b) o.notes = clean(b.notes, 2000);
  if (!locked) {
    if ('direction' in b) { if (!['in', 'out'].includes(b.direction)) throw fail('Choose money in or money out.'); o.direction = b.direction; }
    if ('amount_cents' in b) { const c = Math.round(Number(b.amount_cents)); if (!Number.isFinite(c) || c <= 0 || c > 10_000_000_000) throw fail('Enter an amount greater than zero.'); o.amount_cents = c; }
    if ('date' in b) { if (!validDate(b.date)) throw fail('Enter a date.'); o.date = b.date; }
    for (const k of ['customer_id', 'invoice_id']) if (k in b) o[k] = b[k] ? String(b[k]).slice(0, 40) : null;
    if ('business_id' in b) o.business_id = Number(b.business_id) || null;
  }
  return o;
};
const setCols = (o) => Object.keys(o).map((k) => `${k} = ?`).join(', ');

export async function ledgerCreate(env, b, actor) {
  const s = await getSettings(env);
  const o = cleanEntry({ ...b, date: b.date || localDate(Date.now(), s.biz_timezone) }, false);
  if (!o.direction || !o.amount_cents) throw fail('Enter an amount and choose money in or money out.');
  if (o.invoice_id) { const i = await one(env, 'SELECT number, customer_id FROM invoices WHERE id = ?', o.invoice_id); if (!i) throw fail('That invoice does not exist.'); o.invoice_ref = o.invoice_ref || i.number; o.customer_id = o.customer_id || i.customer_id; }
  o.business_id = o.business_id || (await ensureHome(env)).id;
  if (!(await one(env, 'SELECT 1 x FROM ledger_businesses WHERE id = ?', o.business_id))) throw fail('Choose a business.');
  o.maaser_cents = o.direction === 'in' ? maaserFor(o.amount_cents) : 0;
  const now = Date.now();
  const cols = { vendor: '', invoice_ref: '', description: '', paid_with: '', account: '', notes: '', category: '', invoice_id: null, customer_id: null, ...o, created_by: actor || 'admin', created: now, updated: now };
  const ks = Object.keys(cols);
  const r = await run(env, `INSERT INTO ledger (${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`, ...ks.map((k) => cols[k]));
  const id = r.meta.last_row_id;
  await run(env, 'INSERT INTO activity (customer_id, invoice_id, type, text, ts) VALUES (?, ?, ?, ?, ?)', o.customer_id || '', o.invoice_id || '', 'system', clean(`Ledger: ${o.direction === 'in' ? 'money in' : 'money out'} ${money(o.amount_cents)}${o.vendor ? ' (' + o.vendor + ')' : ''}`, 300), now);
  if (b.maaser_given && o.direction === 'in') await ledgerMaaser(env, id, true, actor);
  return shape(await get(env, id));
}

export async function ledgerUpdate(env, id, b, actor) {
  const r = await get(env, id); if (!r) throw fail('Not found', 404);
  const o = cleanEntry(b, r.src === 'payment');
  if ('business_id' in o) { if (!o.business_id || !(await one(env, 'SELECT 1 x FROM ledger_businesses WHERE id = ?', o.business_id))) throw fail('Choose a business.'); }
  const dir = o.direction || r.direction, amt = o.amount_cents || r.amount_cents;
  if (o.direction || o.amount_cents) o.maaser_cents = dir === 'in' ? maaserFor(amt) : 0;
  if (Object.keys(o).length) await run(env, `UPDATE ledger SET ${setCols(o)}, updated = ? WHERE id = ?`, ...Object.values(o), Date.now(), id);
  const linked = await one(env, 'SELECT id FROM ledger WHERE maaser_of = ?', id);
  if (linked && dir === 'out') { await run(env, 'DELETE FROM ledger WHERE maaser_of = ?', id); await run(env, 'UPDATE ledger SET maaser_given = 0, maaser_given_at = NULL WHERE id = ?', id); }
  else if (linked && o.maaser_cents != null) await run(env, 'UPDATE ledger SET amount_cents = ?, updated = ? WHERE id = ?', o.maaser_cents, Date.now(), linked.id);
  if (linked && o.business_id) await run(env, 'UPDATE ledger SET business_id = ? WHERE id = ?', o.business_id, linked.id);   // the charity expense stays with its income
  return shape(await get(env, id));
}

export async function ledgerDelete(env, id) {
  const r = await get(env, id); if (!r) throw fail('Not found', 404);
  if (r.src === 'payment') throw fail('This entry comes from a payment on an invoice. To reverse it, refund the payment.');
  const kids = await all(env, 'SELECT id FROM ledger WHERE maaser_of = ?', id);
  for (const k of kids) await env.CHAT.delete(`ledger:file:${k.id}`).catch(() => {});
  if (r.has_file) await env.CHAT.delete(`ledger:file:${id}`).catch(() => {});
  await batch(env, [
    st(env, 'DELETE FROM ledger WHERE maaser_of = ?', id),   // the charity expense made from this entry goes with it
    ...(r.maaser_of ? [st(env, 'UPDATE ledger SET maaser_given = 0, maaser_given_at = NULL WHERE id = ?', r.maaser_of)] : []),  // deleting the expense puts the maaser back to "not given"
    st(env, `DELETE FROM label_links WHERE entity_type = 'ledger' AND entity_id = ?`, String(id)),
    st(env, 'DELETE FROM ledger WHERE id = ?', id),
  ]);
}

/** Mark the maaser on a money-in entry as given (records the charity expense) or not given (removes that expense). */
export async function ledgerMaaser(env, id, given, actor) {
  const r = await get(env, id); if (!r) throw fail('Not found', 404);
  if (r.direction !== 'in') throw fail('Maaser is only set aside on money that comes in.');
  const existing = await one(env, 'SELECT id FROM ledger WHERE maaser_of = ?', id);
  const s = await getSettings(env); const now = Date.now();
  if (given && !existing) {
    await run(env, `INSERT INTO ledger (date, direction, amount_cents, vendor, description, category, notes, maaser_of, business_id, created_by, created, updated) VALUES (?, 'out', ?, 'Charity (maaser)', ?, 'Maaser', ?, ?, ?, ?, ?, ?)`,
      localDate(now, s.biz_timezone), r.maaser_cents, `Maaser on ${r.description || r.invoice_ref || 'income'}`, `Ten percent of ${money(r.amount_cents)} received ${r.date}`, id, r.business_id || (await ensureHome(env)).id, actor || 'admin', now, now);
  } else if (!given && existing) await run(env, 'DELETE FROM ledger WHERE id = ?', existing.id);
  await run(env, 'UPDATE ledger SET maaser_given = ?, maaser_given_at = ?, updated = ? WHERE id = ?', given ? 1 : 0, given ? now : null, now, id);
  return shape(await get(env, id));
}

// ---- attachments (receipts, vendor invoices, bank statements), kept in KV
const sniff = (u8) => {
  const s4 = String.fromCharCode(...u8.subarray(0, 4));
  if (s4 === '%PDF') return ['pdf', 'application/pdf'];
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return ['png', 'image/png'];
  if (u8[0] === 0xff && u8[1] === 0xd8) return ['jpg', 'image/jpeg'];
  if (String.fromCharCode(...u8.subarray(8, 12)) === 'WEBP') return ['webp', 'image/webp'];
  return null;
};
export async function ledgerAttach(env, id, buf, name) {
  const r = await get(env, id); if (!r) throw fail('Not found', 404);
  if (!buf || buf.byteLength < 16) throw fail('No file received.');
  if (buf.byteLength > FILE_MAX) throw fail('That file is over 10 MB.');
  const t = sniff(new Uint8Array(buf)); if (!t) throw fail('Attach a PDF or a photo (JPG, PNG or WEBP).');
  await env.CHAT.put(`ledger:file:${id}`, buf);
  await run(env, 'UPDATE ledger SET has_file = 1, file_name = ?, file_type = ?, updated = ? WHERE id = ?', line1(name || `attachment.${t[0]}`, 120).replace(/["\\/]/g, ''), t[1], Date.now(), id);
}
export async function ledgerFile(env, id) {
  const r = await one(env, 'SELECT has_file, file_name, file_type FROM ledger WHERE id = ?', id);
  if (!r || !r.has_file) return null;
  const buf = await env.CHAT.get(`ledger:file:${id}`, 'arrayBuffer');
  return buf ? { buf, name: r.file_name || 'file', type: r.file_type || 'application/octet-stream' } : null;
}
export async function ledgerRemoveFile(env, id) {
  const r = await get(env, id); if (!r) throw fail('Not found', 404);
  await env.CHAT.delete(`ledger:file:${id}`).catch(() => {});
  await run(env, 'UPDATE ledger SET has_file = 0, file_name = NULL, file_type = NULL, updated = ? WHERE id = ?', Date.now(), id);
}

export async function ledgerExport(env, from, to, business) {
  await syncLedger(env);
  const f = validDate(from) ? from : '0000-01-01', t = validDate(to) ? to : '9999-12-31';
  const biz = Number(business) || 0;
  const rows = await all(env, `SELECT * FROM ledger WHERE date >= ? AND date <= ?${biz ? ' AND business_id = ?' : ''} ORDER BY date, id`, f, t, ...(biz ? [biz] : []));
  const names = Object.fromEntries((await all(env, 'SELECT id, name FROM ledger_businesses')).map((x) => [x.id, x.name]));
  const labelsBy = await labelPathsFor(env, 'ledger');
  return { name: 'Ledger', cols: [{ h: 'Date', t: 'date' }, { h: 'Business' }, { h: 'Vendor' }, { h: 'Invoice #' }, { h: 'Description', w: 36 }, { h: 'Amount', t: 'money' }, { h: 'Paid with' }, { h: 'Account' }, { h: 'Notes', w: 36 }, { h: 'Maaser (10%)', t: 'money' }, { h: 'Maaser given' }, { h: 'Type' }, { h: 'Category' }, { h: 'Labels', w: 24 }, { h: 'Attachment' }],
    rows: rows.map((x) => [x.date, names[x.business_id] || '', x.vendor, x.invoice_ref, x.description, (x.direction === 'out' ? -x.amount_cents : x.amount_cents) / 100, x.paid_with, x.account, x.notes, (x.direction === 'in' ? x.maaser_cents : 0) / 100,
      x.direction === 'in' ? (x.maaser_given ? 'Yes' : 'No') : '', x.direction === 'out' ? 'Money out' : 'Money in', x.category, labelsBy[x.id] || '', x.file_name ? x.file_name : x.invoice_id ? `Invoice ${x.invoice_ref}` : '']) };
}

// ---- the invoice as a PDF (attached to every ledger row that came from an invoice payment)
const usd = (c, cur) => money(c, cur);
const fmtDay = (s) => (s ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
export async function invoicePdf(env, id) {
  const d = await getInvoice(env, id); const i = d.invoice, c = d.customer || {}; const s = await getSettings(env);
  const pdf = new Pdf(); const L = 54, R = 558; const grey = [0.35, 0.42, 0.48], ink = [0.06, 0.13, 0.18];
  const need = (h) => { if (pdf.y - h < 60) pdf.newPage(); };
  const t = (txt, o = {}) => pdf.text(txt, o);
  t(s.biz_name, { size: 20, bold: true }); pdf.y -= 18; t([s.biz_phone, s.biz_email].filter(Boolean).join('   '), { color: grey }); pdf.y -= 30;
  const label = i.kind === 'quote' ? 'Quote' : 'Invoice';
  t(`${label} ${i.number}`, { size: 14, bold: true }); t(String(i.state || i.status).toUpperCase(), { right: R, bold: true, color: i.state === 'paid' ? [0.2, 0.5, 0.1] : grey }); pdf.y -= 16;
  t(`Date: ${fmtDay(i.issue_date)}${i.due_date ? `     ${i.kind === 'quote' ? 'Valid until' : 'Due'}: ${fmtDay(i.due_date)}` : ''}`, { color: grey }); pdf.y -= 24;
  if (i.title) { t(i.title, { bold: true }); pdf.y -= 20; }
  t('Bill to', { bold: true }); pdf.y -= 14; t(`${c.name || ''}${c.org ? ', ' + c.org : ''}`); pdf.y -= 12; t(`${c.email || ''}  ${c.phone || ''}`, { color: grey }); pdf.y -= 28;
  pdf.line(L, pdf.y + 8, R, pdf.y + 8);
  t('Description', { bold: true }); t('Qty', { x: 380, bold: true }); t('Price', { x: 430, bold: true }); t('Amount', { right: R, bold: true }); pdf.y -= 18;
  for (const l of d.lines) {
    need(20); const name = String(l.description || '').split('\n')[0].slice(0, 62); const amt = Math.round((Number(l.qty) || 0) * (Number(l.unit_cents) || 0));
    t(name); t(String(l.qty ?? ''), { x: 380 }); t(usd(l.unit_cents), { x: 430 }); t(usd(amt), { right: R }); pdf.y -= 15;
  }
  pdf.y -= 6; pdf.line(L, pdf.y + 8, R, pdf.y + 8, { width: 0.5, color: grey });
  const row = (l, v, bold) => { need(18); t(l, { x: 380, bold }); t(v, { right: R, bold }); pdf.y -= 15; };
  row('Subtotal', usd(i.subtotal, i.currency)); if (i.discount_cents) row('Discount', '-' + usd(i.discount_cents, i.currency)); if (i.tax_cents) row(`Tax (${i.tax_rate}%)`, usd(i.tax_cents, i.currency));
  row('Total', usd(i.total, i.currency), true); row('Paid', usd(i.paid, i.currency)); row('Balance due', usd(i.balance, i.currency), true);
  if (d.payments.length) {
    pdf.y -= 14; need(40); t('Payments', { bold: true }); pdf.y -= 15;
    for (const p of d.payments) { need(16); t(`${fmtDay(localDate(p.received_at, s.biz_timezone))}  ${methodLabel(p.method)}${p.ref && p.method !== 'stripe' && p.method !== 'stripe_refund' ? '  ' + p.ref : ''}`, { color: grey }); t(usd(p.amount_cents, i.currency), { right: R }); pdf.y -= 14; }
  }
  if (i.notes) { pdf.y -= 14; need(40); t('Notes', { bold: true }); pdf.y -= 14; for (const ln of String(i.notes).split('\n').slice(0, 6)) { t(ln.slice(0, 110), { color: grey }); pdf.y -= 12; } }
  void ink;
  return pdf.bytes();
}

// ---- take a payment that is not part of an invoice you wrote: it becomes a one-line invoice, so the receipt, refunds, the pay page and the ledger all work
export async function quickPayment(env, b) {
  const cents = Math.round(Number(b.amount_cents));
  if (!Number.isFinite(cents) || cents < 100 || cents > 100_000_000) throw fail('Enter an amount of at least $1.00.');
  const desc = line1(b.description, 200) || 'Payment';
  const mode = ['link', 'received'].includes(b.mode) ? b.mode : 'link';
  let customerId = b.customer_id || null;
  if (!customerId) {
    const name = line1(b.name, 160);
    if (!name) throw fail('Pick a customer or type a name.');
    if (mode !== 'received' && !b.email) throw fail('Add an email address so the payment link can be sent.');
    customerId = await saveCustomer(env, { name, org: b.org || '', email: b.email || '', phone: b.phone || '', source: 'manual', status: 'active' });
  }
  const c = await one(env, 'SELECT * FROM customers WHERE id = ?', customerId); if (!c) throw fail('Customer not found.');
  const s = await getSettings(env); const today = localDate(Date.now(), s.biz_timezone);
  const id = await saveInvoice(env, { customer_id: customerId, title: desc, lines: [{ description: desc, qty: 1, unit_cents: cents }], issue_date: today, due_date: today, tax_rate: 0, source: 'quick', online_pay: 1 });
  const now = Date.now();
  const out = { invoice_id: id };
  if (mode === 'received') {
    await run(env, `UPDATE invoices SET status = 'sent', sent_at = ?, updated = ? WHERE id = ?`, now, now, id);
    const method = ['cash', 'check', 'zelle', 'ach', 'wire', 'other'].includes(b.method) ? b.method : 'other';
    const r = await addPayment(env, { invoice_id: id, amount_cents: cents, method, ref: line1(b.reference, 120), note: 'Payment taken in person', received_at: now });
    out.paid = true;
    if (b.send_receipt_email && c.email && r) { try { await afterPayment(env, id, cents, r.becamePaid); } catch (e) { out.receiptError = e.message; } }
  } else {
    const inv = await one(env, 'SELECT * FROM invoices WHERE id = ?', id);
    if (b.send_email && c.email) await sendInvoice(env, id);
    else await run(env, `UPDATE invoices SET status = 'sent', sent_at = ?, updated = ? WHERE id = ?`, now, now, id);
    out.url = payLink(env, inv); out.emailed = !!(b.send_email && c.email);
  }
  const fresh = await one(env, 'SELECT number FROM invoices WHERE id = ?', id); out.number = fresh.number;
  await batch(env, [logAct(env, { customer_id: customerId, invoice_id: id, type: 'payment', text: `One-off payment ${money(cents)} (${mode === 'received' ? 'received' : 'link'})` })]);
  void addDays; void todayStr;
  return out;
}

/* ------------------------------------------------------------------ labels: colored, nestable, on almost anything */
const TABLE = { customer: 'customers', invoice: 'invoices', quote: 'invoices', payment: 'payments', ledger: 'ledger', item: 'items', recurring: 'recurring' };
export const LABEL_TYPES = Object.keys(TABLE);
export const PALETTE = ['#e7e7e7', '#b6cff5', '#98d7e4', '#e3d7ff', '#fbd3e0', '#f2b2a8', '#c2c2c2', '#4986e7', '#2da2bb', '#b99aff', '#994a64', '#f691b2', '#ff7537', '#ffad46', '#662e37', '#ebdbde', '#cca6ac', '#42d692', '#16a765', '#fad165', '#fb4c2f', '#ffdeb5', '#fbe983', '#b3efd3', '#a2dcc1'];
const okColor = (c) => /^#[0-9a-fA-F]{6}$/.test(String(c || ''));
const lclean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);

/** All labels in tree order, each with its full path ("Parent/Child"), depth and number of items. */
export async function allLabels(env) {
  const rows = await all(env, 'SELECT * FROM labels ORDER BY sort, LOWER(name), id');
  const counts = Object.fromEntries((await all(env, 'SELECT label_id k, COUNT(*) n FROM label_links GROUP BY label_id')).map((r) => [r.k, r.n]));
  const kids = {}; for (const r of rows) (kids[r.parent_id || 0] ||= []).push(r);
  const out = []; const walk = (pid, path, depth) => { for (const r of kids[pid] || []) { const p = path ? `${path}/${r.name}` : r.name; out.push({ id: r.id, name: r.name, color: r.color, parent_id: r.parent_id, path: p, depth, count: counts[r.id] || 0 }); walk(r.id, p, depth + 1); } };
  walk(0, '', 0);
  const seen = new Set(out.map((x) => x.id)); for (const r of rows) if (!seen.has(r.id)) out.push({ id: r.id, name: r.name, color: r.color, parent_id: null, path: r.name, depth: 0, count: counts[r.id] || 0 });
  return out;
}
/** { type: { id: [labelId, ...] } } for every labeled item. */
export async function allLinks(env) {
  const out = {};
  for (const r of await all(env, 'SELECT label_id l, entity_type t, entity_id i FROM label_links')) ((out[r.t] ||= {})[r.i] ||= []).push(r.l);
  return out;
}
/** { ledgerId: "Parent/Child; Other" } for exports. */
async function labelPathsFor(env, type) {
  const labels = Object.fromEntries((await allLabels(env)).map((l) => [l.id, l.path]));
  const out = {};
  for (const r of await all(env, 'SELECT label_id l, entity_id i FROM label_links WHERE entity_type = ?', type)) (out[r.i] ||= []).push(labels[r.l]);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.filter(Boolean).join('; ')]));
}
const parentOf = async (env, id) => (await one(env, 'SELECT parent_id p FROM labels WHERE id = ?', id))?.p || null;
const descendants = async (env, id) => { const ids = [id]; for (let i = 0; i < ids.length; i++) for (const c of await all(env, 'SELECT id FROM labels WHERE parent_id = ?', ids[i])) if (!ids.includes(c.id)) ids.push(c.id); return ids; };
const depthOf = async (env, id) => { let d = 0, cur = id; while (cur && d < 20) { cur = await parentOf(env, cur); if (cur) d++; } return d; };
const sibling = (env, name, parent) => one(env, 'SELECT id FROM labels WHERE LOWER(name) = LOWER(?) AND parent_id IS ?', name, parent || null);

/** "Camps/Summer/Opening day" creates the whole path and returns the last label. */
export async function createLabel(env, { name, color, parent_id } = {}) {
  const parts = String(name || '').split('/').map(lclean).filter(Boolean);
  if (!parts.length) throw fail('Give the label a name.');
  let parent = Number(parent_id) || null; if (parent && !(await one(env, 'SELECT 1 x FROM labels WHERE id = ?', parent))) throw fail('That parent label does not exist.');
  if (parent && (await depthOf(env, parent)) + parts.length > 5) throw fail('Labels can be nested up to five levels.');
  let last = null; const now = Date.now();
  for (let i = 0; i < parts.length; i++) {
    const existing = await sibling(env, parts[i], parent);
    if (existing) { last = existing.id; parent = existing.id; continue; }
    const n = (await one(env, 'SELECT COUNT(*) n FROM labels')).n;
    const c = i === parts.length - 1 && okColor(color) ? color.toLowerCase() : PALETTE[n % PALETTE.length];
    last = (await run(env, 'INSERT INTO labels (name, color, parent_id, sort, created, updated) VALUES (?, ?, ?, 0, ?, ?)', parts[i], c, parent, now, now)).meta.last_row_id; parent = last;
  }
  return one(env, 'SELECT * FROM labels WHERE id = ?', last);
}
export async function updateLabel(env, id, b = {}) {
  const l = await one(env, 'SELECT * FROM labels WHERE id = ?', id); if (!l) throw fail('Label not found', 404);
  const o = {};
  if ('name' in b) { const n = lclean(b.name).replace(/\//g, ' '); if (!n) throw fail('Give the label a name.'); o.name = n; }
  if ('color' in b) { if (!okColor(b.color)) throw fail('Pick a color.'); o.color = b.color.toLowerCase(); }
  if ('parent_id' in b) {
    const p = Number(b.parent_id) || null;
    if (p) {
      if (!(await one(env, 'SELECT 1 x FROM labels WHERE id = ?', p))) throw fail('That parent label does not exist.');
      const desc = await descendants(env, id);
      if (desc.includes(p)) throw fail('A label cannot be nested under itself.');
      let deepest = 0; for (const d of desc) deepest = Math.max(deepest, (await depthOf(env, d)) - (await depthOf(env, id)));
      if ((await depthOf(env, p)) + 1 + deepest >= 5) throw fail('Labels can be nested up to five levels.');
    }
    o.parent_id = p;
  }
  const nm = o.name ?? l.name, par = 'parent_id' in o ? o.parent_id : l.parent_id;
  const clash = await sibling(env, nm, par); if (clash && clash.id !== id) throw fail(`There is already a label called "${nm}" there.`);
  if (Object.keys(o).length) await run(env, `UPDATE labels SET ${setCols(o)}, updated = ? WHERE id = ?`, ...Object.values(o), Date.now(), id);
  return one(env, 'SELECT * FROM labels WHERE id = ?', id);
}
export async function deleteLabel(env, id) {
  const l = await one(env, 'SELECT * FROM labels WHERE id = ?', id); if (!l) throw fail('Label not found', 404);
  await batch(env, [st(env, 'UPDATE labels SET parent_id = ? WHERE parent_id = ?', l.parent_id || null, id), st(env, 'DELETE FROM label_links WHERE label_id = ?', id), st(env, 'DELETE FROM labels WHERE id = ?', id)]);   // children move up one level
}
/** Replace the labels on one item. */
export async function setLabels(env, type, id, labelIds) {
  const t = TABLE[type]; if (!t) throw fail('You cannot label that.');
  if (!(await one(env, `SELECT 1 x FROM ${t} WHERE id = ?`, id))) throw fail('Item not found', 404);
  const want = [...new Set((Array.isArray(labelIds) ? labelIds : []).map(Number).filter(Boolean))].slice(0, 40);
  const ids = []; for (const x of want) if (await one(env, 'SELECT 1 x FROM labels WHERE id = ?', x)) ids.push(x);
  await batch(env, [st(env, 'DELETE FROM label_links WHERE entity_type = ? AND entity_id = ?', type, String(id)), ...ids.map((l) => st(env, 'INSERT OR IGNORE INTO label_links (label_id, entity_type, entity_id) VALUES (?, ?, ?)', l, type, String(id)))]);
  return ids;
}
