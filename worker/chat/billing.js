// Customers (CRM), invoices, quotes, payments, recurring billing and reports. Data lives in D1 (binding BILL).
// Everything here is admin-only except what billing-pay.js exposes for the customer's invoice link.
// Money is integer cents. Dates are 'YYYY-MM-DD' strings (UTC).

/* ------------------------------------------------------------------ helpers */
export const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
export const line1 = (v, max) => clean(v, max).replace(/[\r\n]+/g, ' ');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const uid = () => { const b = crypto.getRandomValues(new Uint8Array(12)); return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); };
export const secretToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const todayStr = () => new Date().toISOString().slice(0, 10);
// Minutes behind UTC of the admin's browser (Date.getTimezoneOffset), so "today" and day boundaries follow their clock, not UTC.
export const tzOf = (p) => { const n = Math.round(Number(p && p.tz)); return Number.isFinite(n) && Math.abs(n) <= 840 ? n : 0; };
export const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
export const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const addMonths = (s, n) => {
  const d = new Date(s + 'T00:00:00Z'); const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};
export const money = (cents, cur) => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format((cents || 0) / 100); } catch { return '$' + ((cents || 0) / 100).toFixed(2); }
};
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };

const all = async (env, sql, ...a) => (await env.BILL.prepare(sql).bind(...a).all()).results || [];
const one = async (env, sql, ...a) => env.BILL.prepare(sql).bind(...a).first();
const run = async (env, sql, ...a) => env.BILL.prepare(sql).bind(...a).run();
const st = (env, sql, ...a) => env.BILL.prepare(sql).bind(...a);
const batch = (env, list) => (list.length ? env.BILL.batch(list) : Promise.resolve([]));
const like = (s) => '%' + String(s).replace(/[%_\\]/g, (c) => '\\' + c) + '%';

export const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/* ------------------------------------------------------------------ settings */
export const DEFAULTS = {
  biz_name: 'Everything Shul', biz_address: '', biz_email: '', biz_phone: '', biz_taxid: '', logo_url: '',
  invoice_prefix: 'INV-', quote_prefix: 'Q-', next_invoice: '1001', next_quote: '1001',
  stripe_pk: '', invoice_pad: '0', terms_days: '30', quote_days: '30', tax_rate: '0', notes: '', terms: '', currency: 'usd', reminders: '1',
};
const TEXT_LIMITS = { biz_name: 120, biz_address: 400, biz_email: 200, biz_phone: 60, biz_taxid: 60, logo_url: 500, invoice_prefix: 12, quote_prefix: 12, notes: 1500, terms: 1500, currency: 3 };

export async function getSettings(env) {
  const rows = await all(env, 'SELECT k, v FROM settings');
  const s = { ...DEFAULTS };
  rows.forEach((r) => { if (r.k in DEFAULTS) s[r.k] = r.v; });
  if (!s.biz_email) s.biz_email = env.ADMIN_EMAIL || '';
  if (!s.logo_url) s.logo_url = `${env.SITE_URL}/assets/logo.png`;
  return s;
}

export async function saveSettings(env, b) {
  const list = [];
  for (const k of Object.keys(DEFAULTS)) {
    if (!(k in b)) continue;
    let v = b[k];
    if (['next_invoice', 'next_quote'].includes(k)) v = String(int(v, 1, 99999999));
    else if (['terms_days', 'quote_days'].includes(k)) v = String(int(v, 0, 365));
    else if (k === 'invoice_pad') v = String(int(v, 0, 12));
    else if (k === 'stripe_pk') { v = clean(v, 200); if (v && !/^pk_(live|test)_[A-Za-z0-9]+$/.test(v)) throw fail('That does not look like a Stripe publishable key. It starts with pk_live_ or pk_test_.'); }
    else if (k === 'tax_rate') v = String(Math.max(0, Math.min(100, Number(v) || 0)));
    else if (k === 'reminders') v = v === true || v === '1' || v === 1 ? '1' : '0';
    else if (k === 'currency') { v = clean(v, 3).toLowerCase(); if (!/^[a-z]{3}$/.test(v)) v = 'usd'; }
    else if (k === 'logo_url') { v = clean(v, 500); if (v && !/^https:\/\//.test(v)) throw fail('The logo address must start with https://'); }
    else v = clean(v, TEXT_LIMITS[k] || 200);
    list.push(st(env, 'INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, String(v)));
  }
  await batch(env, list);
  return getSettings(env);
}

// Next invoice or quote number. One atomic statement, so two at once never get the same number.
async function nextNumber(env, kind) {
  const key = kind === 'quote' ? 'next_quote' : 'next_invoice';
  const row = await one(env, `INSERT INTO settings (k, v) VALUES (?, '1002') ON CONFLICT(k) DO UPDATE SET v = CAST(v AS INTEGER) + 1 RETURNING CAST(v AS INTEGER) - 1 AS n`, key);
  const s = await getSettings(env);
  return (kind === 'quote' ? s.quote_prefix : s.invoice_prefix) + String(row.n).padStart(int(s.invoice_pad, 0, 12), '0');
}

/* ------------------------------------------------------------------ totals */
export function calc(lines, opts) {
  opts = opts || {};
  const amount = (l) => Math.round((Number(l.qty) || 0) * (Number(l.unit_cents) || 0));
  const subtotal = lines.reduce((a, l) => a + amount(l), 0);
  const taxableSub = lines.filter((l) => l.taxable).reduce((a, l) => a + amount(l), 0);
  const v = Number(opts.discount_value) || 0;
  let discount = opts.discount_type === 'pct' ? Math.round(subtotal * Math.max(0, Math.min(100, v)) / 100) : Math.round(Math.max(0, v));
  discount = Math.max(0, Math.min(subtotal > 0 ? subtotal : 0, discount));
  const ratio = subtotal > 0 ? (subtotal - discount) / subtotal : 0;
  const rate = Math.max(0, Math.min(100, Number(opts.tax_rate) || 0));
  const tax = Math.round(taxableSub * ratio * rate / 100);
  return { subtotal, discount_cents: discount, tax_cents: tax, total: Math.max(0, subtotal - discount + tax) };
}

export const displayState = (inv) => {
  if (inv.kind === 'quote') return inv.status;
  if (inv.status === 'void' || inv.status === 'draft') return inv.status;
  if (inv.paid >= inv.total) return 'paid';
  if (inv.due_date && inv.due_date < todayStr()) return 'overdue';
  return inv.paid > 0 ? 'partial' : 'unpaid';
};
const decorate = (inv) => ({ ...inv, balance: Math.max(0, inv.total - inv.paid), state: displayState(inv) });

/* ------------------------------------------------------------------ activity */
export const logAct = (env, a) => st(env, 'INSERT INTO activity (customer_id, invoice_id, type, text, ts) VALUES (?, ?, ?, ?, ?)',
  a.customer_id || '', a.invoice_id || '', a.type, clean(a.text, 600), a.ts || Date.now());

/* ------------------------------------------------------------------ customers */
const CUST_FIELDS = ['name', 'org', 'email', 'phone', 'addr1', 'addr2', 'city', 'state', 'zip', 'country', 'source', 'tags', 'notes', 'ext_id'];
const CUST_MAX = { name: 160, org: 160, email: 200, phone: 60, addr1: 160, addr2: 160, city: 100, state: 60, zip: 30, country: 60, source: 60, tags: 200, notes: 4000, ext_id: 80 };

export async function listCustomers(env, p) {
  const where = []; const args = [];
  if (p.status && ['lead', 'active', 'past'].includes(p.status)) { where.push('c.status = ?'); args.push(p.status); }
  if (p.q) { where.push(`(c.name LIKE ? ESCAPE '\\' OR c.org LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.tags LIKE ? ESCAPE '\\')`); const l = like(p.q); args.push(l, l, l, l, l); }
  if (p.tag) { where.push(`(',' || REPLACE(c.tags, ', ', ',') || ',') LIKE ?`); args.push(`%,${String(p.tag).replace(/[%_]/g, '')},%`); }
  const rows = await all(env, `SELECT c.*,
      (SELECT COALESCE(SUM(i.total - i.paid), 0) FROM invoices i WHERE i.customer_id = c.id AND i.kind = 'invoice' AND i.status = 'sent' AND i.paid < i.total) AS balance,
      (SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p WHERE p.customer_id = c.id) AS paid_total,
      (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.kind = 'invoice' AND i.status != 'void') AS invoice_count,
      (SELECT MAX(a.ts) FROM activity a WHERE a.customer_id = c.id) AS last_activity
    FROM customers c ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY LOWER(CASE WHEN c.org != '' THEN c.org ELSE c.name END) LIMIT 1000`, ...args);
  const tags = new Set();
  (await all(env, `SELECT DISTINCT tags FROM customers WHERE tags != ''`)).forEach((r) => r.tags.split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => tags.add(t)));
  return { customers: rows, tags: [...tags].sort() };
}

export async function saveCustomer(env, b) {
  const v = {};
  CUST_FIELDS.forEach((f) => { v[f] = f === 'notes' ? clean(b[f], CUST_MAX[f]) : line1(b[f], CUST_MAX[f]); });
  if (!v.name && !v.org) throw fail('A name or organization is needed.');
  if (!v.name) v.name = v.org;
  if (v.email && !EMAIL_RE.test(v.email)) throw fail('That email address does not look right.');
  v.tags = v.tags.split(',').map((t) => t.trim()).filter(Boolean).join(', ');
  const status = ['lead', 'active', 'past'].includes(b.status) ? b.status : 'active';
  const exempt = b.tax_exempt ? 1 : 0;
  const terms = b.terms_days === '' || b.terms_days == null ? null : int(b.terms_days, 0, 365);
  const now = Date.now();
  if (b.id) {
    const cur = await one(env, 'SELECT id FROM customers WHERE id = ?', b.id);
    if (!cur) throw fail('Customer not found', 404);
    await run(env, `UPDATE customers SET name=?, org=?, email=?, phone=?, addr1=?, addr2=?, city=?, state=?, zip=?, country=?, source=?, tags=?, notes=?, ext_id=?, status=?, tax_exempt=?, terms_days=?, updated=? WHERE id=?`,
      v.name, v.org, v.email, v.phone, v.addr1, v.addr2, v.city, v.state, v.zip, v.country, v.source, v.tags, v.notes, v.ext_id, status, exempt, terms, now, b.id);
    return b.id;
  }
  const id = uid();
  await batch(env, [
    st(env, `INSERT INTO customers (id, name, org, email, phone, addr1, addr2, city, state, zip, country, status, source, tags, notes, tax_exempt, terms_days, ext_id, created, updated)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, v.name, v.org, v.email, v.phone, v.addr1, v.addr2, v.city, v.state, v.zip, v.country, status, v.source || 'manual', v.tags, v.notes, exempt, terms, v.ext_id, now, now),
    logAct(env, { customer_id: id, type: 'system', text: 'Customer added' + (v.source ? ` (${v.source})` : '') }),
  ]);
  return id;
}

// From the chat and the contact form: find the person by email or add them as a lead.
export async function upsertLead(env, { name, email, org, source, text, notes }) {
  if (!env.BILL) return null;
  email = line1(email, 200);
  let c = email ? await one(env, 'SELECT id FROM customers WHERE LOWER(email) = LOWER(?) LIMIT 1', email) : null;
  const now = Date.now();
  let id;
  const list = [];
  if (c) { id = c.id; list.push(st(env, 'UPDATE customers SET updated = ? WHERE id = ?', now, id)); }
  else {
    id = uid();
    list.push(st(env, `INSERT INTO customers (id, name, org, email, status, source, notes, created, updated) VALUES (?,?,?,?, 'lead', ?, ?, ?, ?)`,
      id, line1(name, 160) || email || 'Website visitor', line1(org, 160), email, line1(source, 60), clean(notes, 1000), now, now));
    list.push(logAct(env, { customer_id: id, type: 'lead', text: `New lead from ${source || 'the website'}` }));
  }
  if (text) list.push(logAct(env, { customer_id: id, type: source === 'chat' ? 'chat' : 'lead', text }));
  await batch(env, list);
  return id;
}

export async function getCustomer(env, id, extra) {
  const c = await one(env, 'SELECT * FROM customers WHERE id = ?', id);
  if (!c) throw fail('Customer not found', 404);
  const invoices = (await all(env, `SELECT * FROM invoices WHERE customer_id = ? ORDER BY issue_date DESC, number DESC`, id)).map(decorate);
  const payments = await all(env, 'SELECT p.*, i.number AS invoice_number FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.customer_id = ? ORDER BY p.received_at DESC LIMIT 200', id);
  const activity = await all(env, 'SELECT * FROM activity WHERE customer_id = ? ORDER BY ts DESC, id DESC LIMIT 150', id);
  const tasks = await all(env, `SELECT * FROM tasks WHERE customer_id = ? ORDER BY done, CASE WHEN due = '' THEN '9999' ELSE due END`, id);
  const recurring = await all(env, 'SELECT * FROM recurring WHERE customer_id = ? ORDER BY next_date', id);
  const inv = invoices.filter((i) => i.kind === 'invoice' && i.status !== 'void' && i.status !== 'draft');
  const summary = {
    billed: inv.reduce((a, i) => a + i.total, 0),
    paid: payments.reduce((a, p) => a + p.amount_cents, 0),
    balance: inv.filter((i) => i.status === 'sent').reduce((a, i) => a + i.balance, 0),
    overdue: inv.filter((i) => i.state === 'overdue').reduce((a, i) => a + i.balance, 0),
  };
  return { customer: c, invoices, payments, activity, tasks, recurring: recurring.map((r) => ({ ...r, lines: safeJson(r.lines, []) })), summary, ...(extra || {}) };
}

export async function deleteCustomer(env, id) {
  const n = await one(env, 'SELECT COUNT(*) AS n FROM invoices WHERE customer_id = ?', id);
  if (n.n) throw fail('This customer has invoices or quotes, so it can only be marked as "past". Delete or void those first if you really want to remove them.');
  await batch(env, [
    st(env, 'DELETE FROM activity WHERE customer_id = ?', id), st(env, 'DELETE FROM tasks WHERE customer_id = ?', id),
    st(env, 'DELETE FROM recurring WHERE customer_id = ?', id), st(env, 'DELETE FROM customers WHERE id = ?', id),
  ]);
}

export const safeJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

/* ------------------------------------------------------------------ tasks and notes */
export async function addNote(env, { customer_id, invoice_id, text }) {
  text = clean(text, 2000);
  if (!text) throw fail('Write something first.');
  if (customer_id && !(await one(env, 'SELECT id FROM customers WHERE id = ?', customer_id))) throw fail('Customer not found', 404);
  await logAct(env, { customer_id, invoice_id, type: 'note', text }).run();
}

export async function saveTask(env, b) {
  const text = line1(b.text, 300);
  if (!text) throw fail('Describe the follow-up.');
  const due = validDate(b.due) ? b.due : '';
  if (b.id) { await run(env, 'UPDATE tasks SET text = ?, due = ? WHERE id = ?', text, due, b.id); return b.id; }
  const id = uid();
  await run(env, 'INSERT INTO tasks (id, customer_id, text, due, created) VALUES (?, ?, ?, ?, ?)', id, clean(b.customer_id, 40), text, due, Date.now());
  return id;
}
export const toggleTask = (env, id, done) => run(env, 'UPDATE tasks SET done = ?, done_at = ? WHERE id = ?', done ? 1 : 0, done ? Date.now() : null, id);
export const deleteTask = (env, id) => run(env, 'DELETE FROM tasks WHERE id = ?', id);

/* ------------------------------------------------------------------ catalog */
export const listItems = (env) => all(env, 'SELECT * FROM items ORDER BY active DESC, LOWER(name)');
export async function saveItem(env, b) {
  const name = line1(b.name, 160);
  if (!name) throw fail('Give the item a name.');
  const desc = clean(b.description, 500), cents = int(b.unit_cents, -1e9, 1e9), taxable = b.taxable ? 1 : 0, active = b.active === false || b.active === 0 ? 0 : 1;
  if (b.id) { await run(env, 'UPDATE items SET name=?, description=?, unit_cents=?, taxable=?, active=? WHERE id=?', name, desc, cents, taxable, active, b.id); return b.id; }
  const id = uid();
  await run(env, 'INSERT INTO items (id, name, description, unit_cents, taxable, active, created) VALUES (?,?,?,?,?,?,?)', id, name, desc, cents, taxable, active, Date.now());
  return id;
}
export const deleteItem = (env, id) => run(env, 'DELETE FROM items WHERE id = ?', id);

/* ------------------------------------------------------------------ invoices and quotes */
const cleanLines = (raw) => {
  const lines = (Array.isArray(raw) ? raw : []).slice(0, 100).map((l) => ({
    description: clean(l.description, 600),
    qty: Math.max(0, Math.min(1e6, Number(l.qty) || 0)),
    unit_cents: int(l.unit_cents, -1e10, 1e10),
    taxable: l.taxable ? 1 : 0,
  })).filter((l) => l.description || l.unit_cents);
  if (!lines.length) throw fail('Add at least one line.');
  lines.forEach((l) => { if (!l.description) throw fail('Every line needs a description.'); if (!(l.qty > 0)) throw fail('Every line needs a quantity above zero.'); });
  return lines;
};

export async function saveInvoice(env, b) {
  const kind = b.kind === 'quote' ? 'quote' : 'invoice';
  const customer = await one(env, 'SELECT * FROM customers WHERE id = ?', b.customer_id);
  if (!customer) throw fail('Pick a customer first.');
  const lines = cleanLines(b.lines);
  const settings = await getSettings(env);
  const issue = validDate(b.issue_date) ? b.issue_date : todayStr();
  const due = b.due_date === '' || b.due_date == null ? addDays(issue, kind === 'quote' ? int(settings.quote_days, 0, 365) : int(customer.terms_days ?? settings.terms_days, 0, 365)) : b.due_date;
  if (!validDate(due)) throw fail('The due date is not a valid date.');
  const dtype = b.discount_type === 'pct' ? 'pct' : 'amt';
  const dval = dtype === 'pct' ? Math.max(0, Math.min(100, Number(b.discount_value) || 0)) : int(b.discount_value, 0, 1e10);
  const taxRate = customer.tax_exempt && b.tax_rate == null ? 0 : Math.max(0, Math.min(100, Number(b.tax_rate) || 0));
  const t = calc(lines, { discount_type: dtype, discount_value: dval, tax_rate: taxRate });
  if (t.total > 1e10) throw fail('That total is too large.');
  const currency = /^[a-z]{3}$/i.test(b.currency || '') ? b.currency.toLowerCase() : settings.currency;
  const notes = clean(b.notes, 1500), terms = clean(b.terms, 1500), title = line1(b.title, 160);
  const onlinePay = b.online_pay === false || b.online_pay === 0 ? 0 : 1;
  const now = Date.now();
  let id = b.id;
  const stmts = [];
  if (id) {
    const cur = await one(env, 'SELECT * FROM invoices WHERE id = ?', id);
    if (!cur) throw fail('Not found', 404);
    if (cur.status === 'void') throw fail('A voided invoice can not be changed.');
    if (cur.kind === 'quote' && cur.status === 'accepted') throw fail('An accepted quote can not be changed.');
    stmts.push(st(env, `UPDATE invoices SET customer_id=?, issue_date=?, due_date=?, currency=?, subtotal=?, discount_type=?, discount_value=?, discount_cents=?, tax_rate=?, tax_cents=?, total=?, notes=?, terms=?, title=?, online_pay=CASE WHEN ? IS NULL THEN online_pay ELSE ? END, updated=? WHERE id=?`,
      customer.id, issue, due, currency, t.subtotal, dtype, dval, t.discount_cents, taxRate, t.tax_cents, t.total, notes, terms, title, b.online_pay == null ? null : onlinePay, onlinePay, now, id));
    stmts.push(st(env, 'DELETE FROM invoice_lines WHERE invoice_id = ?', id));
    stmts.push(logAct(env, { customer_id: customer.id, invoice_id: id, type: kind, text: `${kind === 'quote' ? 'Quote' : 'Invoice'} ${cur.number} edited` }));
  } else {
    id = uid();
    const number = b.number ? line1(b.number, 30) : await nextNumber(env, kind);
    stmts.push(st(env, `INSERT INTO invoices (id, kind, number, customer_id, status, issue_date, due_date, currency, subtotal, discount_type, discount_value, discount_cents, tax_rate, tax_cents, total, paid, notes, terms, title, online_pay, token, source, created, updated)
                        VALUES (?,?,?,?, 'draft', ?,?,?,?,?,?,?,?,?,?, 0, ?,?,?,?,?, ?,?,?)`,
      id, kind, number, customer.id, issue, due, currency, t.subtotal, dtype, dval, t.discount_cents, taxRate, t.tax_cents, t.total, notes, terms, title, onlinePay, secretToken(), clean(b.source, 40), now, now));
    stmts.push(logAct(env, { customer_id: customer.id, invoice_id: id, type: kind, text: `${kind === 'quote' ? 'Quote' : 'Invoice'} ${number} created as a draft` }));
  }
  lines.forEach((l, i) => stmts.push(st(env, 'INSERT INTO invoice_lines (invoice_id, pos, description, qty, unit_cents, taxable) VALUES (?,?,?,?,?,?)', id, i, l.description, l.qty, l.unit_cents, l.taxable)));
  try { await batch(env, stmts); } catch (e) { if (/UNIQUE/i.test(e.message)) throw fail('That number is already used.'); throw e; }
  if (b.id) await refreshPaid(env, id);
  return id;
}

export async function getInvoice(env, id) {
  const inv = await one(env, 'SELECT * FROM invoices WHERE id = ?', id);
  if (!inv) throw fail('Not found', 404);
  const lines = await all(env, 'SELECT description, qty, unit_cents, taxable FROM invoice_lines WHERE invoice_id = ? ORDER BY pos', id);
  const payments = await all(env, 'SELECT * FROM payments WHERE invoice_id = ? ORDER BY received_at', id);
  const customer = await one(env, 'SELECT * FROM customers WHERE id = ?', inv.customer_id);
  const activity = await all(env, 'SELECT * FROM activity WHERE invoice_id = ? ORDER BY ts DESC, id DESC LIMIT 60', id);
  return { invoice: decorate(inv), lines, payments, customer, activity };
}

const INV_FILTERS = {
  draft: `i.status = 'draft'`,
  void: `i.status = 'void'`,
  paid: `i.status NOT IN ('draft','void') AND i.paid >= i.total`,
  unpaid: `i.status = 'sent' AND i.paid < i.total`,
  overdue: `i.status = 'sent' AND i.paid < i.total AND i.due_date != '' AND i.due_date < ?`,
  accepted: `i.status = 'accepted'`, declined: `i.status = 'declined'`, sent: `i.status = 'sent'`,
};

export async function listInvoices(env, p) {
  const where = [`i.kind = ?`]; const args = [p.kind === 'quote' ? 'quote' : 'invoice'];
  if (p.status && INV_FILTERS[p.status]) { where.push(INV_FILTERS[p.status]); if (p.status === 'overdue') args.push(todayStr()); }
  if (p.customer) { where.push('i.customer_id = ?'); args.push(p.customer); }
  if (validDate(p.from)) { where.push('i.issue_date >= ?'); args.push(p.from); }
  if (validDate(p.to)) { where.push('i.issue_date <= ?'); args.push(p.to); }
  if (p.q) { where.push(`(i.number LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.org LIKE ? ESCAPE '\\')`); const l = like(p.q); args.push(l, l, l); }
  const limit = int(p.limit || 200, 1, 500), offset = int(p.offset || 0, 0, 1e6);
  const rows = await all(env, `SELECT i.*, c.name AS customer_name, c.org AS customer_org, c.email AS customer_email FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
    WHERE ${where.join(' AND ')} ORDER BY i.issue_date DESC, i.created DESC LIMIT ${limit} OFFSET ${offset}`, ...args);
  const sums = await one(env, `SELECT COUNT(*) AS n, COALESCE(SUM(i.total),0) AS total, COALESCE(SUM(CASE WHEN i.status NOT IN ('draft','void') THEN i.total - i.paid ELSE 0 END),0) AS balance
    FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE ${where.join(' AND ')}`, ...args);
  return { invoices: rows.map(decorate), summary: sums };
}

export async function refreshPaid(env, id) {
  const inv = await one(env, 'SELECT * FROM invoices WHERE id = ?', id);
  if (!inv) return null;
  const sum = (await one(env, 'SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE invoice_id = ?', id)).s;
  let status = inv.status, paidAt = inv.paid_at;
  if (inv.kind === 'invoice' && (status === 'sent' || status === 'paid')) {
    if (sum >= inv.total) { status = 'paid'; paidAt = paidAt || Date.now(); } else { status = 'sent'; paidAt = null; }
  }
  await run(env, 'UPDATE invoices SET paid = ?, status = ?, paid_at = ?, updated = ? WHERE id = ?', sum, status, paidAt, Date.now(), id);
  return { ...inv, paid: sum, status, paid_at: paidAt };
}

// Records money received (or refunded, if negative). Returns null when the same Stripe event was already recorded.
export async function addPayment(env, p) {
  const inv = await one(env, 'SELECT * FROM invoices WHERE id = ?', p.invoice_id);
  if (!inv || inv.kind !== 'invoice') throw fail('Invoice not found', 404);
  const cents = int(p.amount_cents, -1e10, 1e10);
  if (!cents) throw fail('Enter an amount.');
  const id = uid();
  const method = clean(p.method, 24) || 'other';
  const when = p.received_at || Date.now();
  const ins = await run(env, 'INSERT OR IGNORE INTO payments (id, invoice_id, customer_id, amount_cents, method, ref, stripe_ref, received_at, note, created) VALUES (?,?,?,?,?,?,?,?,?,?)',
    id, inv.id, inv.customer_id, cents, method, line1(p.ref, 120), p.stripe_ref || null, when, clean(p.note, 400), Date.now());
  if (ins.meta && ins.meta.changes === 0) return null;
  const was = inv.status;
  const after = await refreshPaid(env, inv.id);
  const label = { stripe: 'online (Stripe)', stripe_refund: 'Stripe refund', check: 'check', cash: 'cash', ach: 'bank transfer', zelle: 'Zelle', other: 'other', imported: 'imported' }[method] || method;
  await logAct(env, { customer_id: inv.customer_id, invoice_id: inv.id, type: 'payment',
    text: `${cents < 0 ? 'Refund of' : 'Payment of'} ${money(Math.abs(cents), inv.currency)} ${cents < 0 ? 'recorded' : 'received'} (${label})${after.status === 'paid' && was !== 'paid' ? '. Invoice paid in full.' : ''}`, ts: when }).run();
  if (after.status === 'paid' && was !== 'paid') await run(env, `UPDATE customers SET status = 'active', updated = ? WHERE id = ? AND status = 'lead'`, Date.now(), inv.customer_id);
  return { id, invoice: after, becamePaid: after.status === 'paid' && was !== 'paid' };
}

export async function deletePayment(env, id) {
  const p = await one(env, 'SELECT * FROM payments WHERE id = ?', id);
  if (!p) throw fail('Not found', 404);
  if (p.stripe_ref && p.method === 'stripe') throw fail('Online payments are recorded by Stripe. To give the money back, refund it in Stripe and it is recorded here automatically.');
  await run(env, 'DELETE FROM payments WHERE id = ?', id);
  await refreshPaid(env, p.invoice_id);
  await logAct(env, { customer_id: p.customer_id, invoice_id: p.invoice_id, type: 'payment', text: `A ${money(Math.abs(p.amount_cents))} payment record was removed` }).run();
}

export async function setStatus(env, id, action) {
  const inv = await one(env, 'SELECT * FROM invoices WHERE id = ?', id);
  if (!inv) throw fail('Not found', 404);
  const word = inv.kind === 'quote' ? 'Quote' : 'Invoice';
  if (action === 'void') {
    if (inv.status === 'void') return;
    if (inv.paid > 0) throw fail('This invoice has payments. Remove or refund them before voiding it.');
    await run(env, `UPDATE invoices SET status = 'void', updated = ? WHERE id = ?`, Date.now(), id);
    await logAct(env, { customer_id: inv.customer_id, invoice_id: id, type: inv.kind, text: `${word} ${inv.number} voided` }).run();
  } else if (action === 'reopen') {
    if (inv.status !== 'void') return;
    await run(env, `UPDATE invoices SET status = ?, updated = ? WHERE id = ?`, inv.sent_at ? 'sent' : 'draft', Date.now(), id);
    await logAct(env, { customer_id: inv.customer_id, invoice_id: id, type: inv.kind, text: `${word} ${inv.number} reopened` }).run();
    await refreshPaid(env, id);
  } else if (action === 'delete') {
    if (inv.status !== 'draft' && inv.status !== 'void') throw fail('Only drafts and voided documents can be deleted. Void it instead.');
    if (inv.paid > 0) throw fail('This has payments and can not be deleted.');
    await batch(env, [st(env, 'DELETE FROM invoice_lines WHERE invoice_id = ?', id), st(env, 'DELETE FROM payments WHERE invoice_id = ?', id), st(env, 'DELETE FROM invoices WHERE id = ?', id),
      logAct(env, { customer_id: inv.customer_id, type: inv.kind, text: `${word} ${inv.number} deleted` })]);
  } else if (action === 'accept' || action === 'decline') {
    if (inv.kind !== 'quote') throw fail('Only quotes can be accepted.');
    await run(env, `UPDATE invoices SET status = ?, updated = ? WHERE id = ?`, action === 'accept' ? 'accepted' : 'declined', Date.now(), id);
    await logAct(env, { customer_id: inv.customer_id, invoice_id: id, type: 'quote', text: `Quote ${inv.number} ${action === 'accept' ? 'accepted' : 'declined'}` }).run();
  } else throw fail('Unknown action');
}

export async function duplicateInvoice(env, id) {
  const { invoice, lines } = await getInvoice(env, id);
  const newId = await saveInvoice(env, { ...invoice, id: undefined, number: undefined, due_date: '', issue_date: todayStr(), lines, source: 'duplicate' });
  return newId;
}

export async function convertQuote(env, id) {
  const { invoice, lines } = await getInvoice(env, id);
  if (invoice.kind !== 'quote') throw fail('That is not a quote.');
  const newId = await saveInvoice(env, { ...invoice, id: undefined, number: undefined, kind: 'invoice', due_date: '', issue_date: todayStr(), lines, source: 'quote' });
  await batch(env, [
    st(env, `UPDATE invoices SET converted_from = ? WHERE id = ?`, id, newId),
    st(env, `UPDATE invoices SET status = 'accepted', updated = ? WHERE id = ? AND status IN ('draft','sent')`, Date.now(), id),
    logAct(env, { customer_id: invoice.customer_id, invoice_id: newId, type: 'invoice', text: `Created from quote ${invoice.number}` }),
  ]);
  return newId;
}

/* ------------------------------------------------------------------ recurring invoices */
const stepDate = (d, freq) => (freq === 'weekly' ? addDays(d, 7) : freq === 'quarterly' ? addMonths(d, 3) : freq === 'yearly' ? addMonths(d, 12) : addMonths(d, 1));

export async function saveRecurring(env, b) {
  const customer = await one(env, 'SELECT id FROM customers WHERE id = ?', b.customer_id);
  if (!customer) throw fail('Pick a customer first.');
  const lines = cleanLines(b.lines);
  const freq = ['weekly', 'monthly', 'quarterly', 'yearly'].includes(b.frequency) ? b.frequency : 'monthly';
  if (!validDate(b.next_date)) throw fail('Pick the date of the next invoice.');
  const end = b.end_date && validDate(b.end_date) ? b.end_date : '';
  const dtype = b.discount_type === 'pct' ? 'pct' : 'amt';
  const dval = dtype === 'pct' ? Math.max(0, Math.min(100, Number(b.discount_value) || 0)) : int(b.discount_value, 0, 1e10);
  const f = [customer.id, line1(b.title, 160), freq, b.next_date, end, b.active === false || b.active === 0 ? 0 : 1, b.auto_send ? 1 : 0, JSON.stringify(lines), dtype, dval,
    Math.max(0, Math.min(100, Number(b.tax_rate) || 0)), clean(b.notes, 1500), clean(b.terms, 1500), int(b.terms_days ?? 30, 0, 365)];
  if (b.id) {
    await run(env, `UPDATE recurring SET customer_id=?, title=?, frequency=?, next_date=?, end_date=?, active=?, auto_send=?, lines=?, discount_type=?, discount_value=?, tax_rate=?, notes=?, terms=?, terms_days=? WHERE id=?`, ...f, b.id);
    return b.id;
  }
  const id = uid();
  await run(env, `INSERT INTO recurring (customer_id, title, frequency, next_date, end_date, active, auto_send, lines, discount_type, discount_value, tax_rate, notes, terms, terms_days, id, created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ...f, id, Date.now());
  return id;
}

export async function listRecurring(env) {
  const rows = await all(env, `SELECT r.*, c.name AS customer_name, c.org AS customer_org FROM recurring r LEFT JOIN customers c ON c.id = r.customer_id ORDER BY r.active DESC, r.next_date`);
  return rows.map((r) => {
    const lines = safeJson(r.lines, []);
    return { ...r, lines, amount: calc(lines, r).total };
  });
}
export const deleteRecurring = (env, id) => run(env, 'DELETE FROM recurring WHERE id = ?', id);

// Creates the invoice that is due from one schedule, then moves the schedule forward. Returns the new invoice id.
export async function runRecurring(env, r, sendFn) {
  const lines = typeof r.lines === 'string' ? safeJson(r.lines, []) : r.lines;
  const date = r.next_date;
  const id = await saveInvoice(env, {
    customer_id: r.customer_id, kind: 'invoice', issue_date: date, due_date: addDays(date, r.terms_days ?? 30), lines,
    discount_type: r.discount_type, discount_value: r.discount_value, tax_rate: r.tax_rate, notes: r.notes, terms: r.terms, source: 'recurring',
  });
  await batch(env, [
    st(env, 'UPDATE invoices SET recurring_id = ? WHERE id = ?', r.id, id),
    st(env, 'UPDATE recurring SET last_run = ?, runs = runs + 1, next_date = ? WHERE id = ?', date, stepDate(date, r.frequency), r.id),
  ]);
  if (r.auto_send && sendFn) { try { await sendFn(env, id); } catch (e) { console.error('recurring send', e.message); } }
  return id;
}

/* ------------------------------------------------------------------ dashboard and reports */
// The overview. Money received, invoiced, top customers and recent payments follow the chosen date range;
// what is owed, overdue, drafts and follow-ups are always "right now".
export async function dashboard(env, p) {
  p = p || {};
  const today = todayStr();
  const open = `kind = 'invoice' AND status = 'sent' AND paid < total`;
  let to = validDate(p.to) ? p.to : today;
  let from;
  if (p.range === 'all') {
    const first = await one(env, 'SELECT MIN(received_at) AS t FROM payments');
    const first2 = await one(env, `SELECT MIN(issue_date) AS d FROM invoices WHERE kind = 'invoice' AND status IN ('sent','paid')`);
    from = [first && first.t ? new Date(first.t).toISOString().slice(0, 10) : '', first2 && first2.d].filter(Boolean).sort()[0] || addDays(today, -29);
  } else from = validDate(p.from) ? p.from : addDays(today, -29);
  if (from > to) [from, to] = [to, from];
  const tz = tzOf(p);
  const f = Date.parse(from + 'T00:00:00Z') + tz * 60000, t = Date.parse(to + 'T00:00:00Z') + 86400000 + tz * 60000;
  const days = Math.round((t - f) / 86400000);
  const gran = days <= 62 ? 'day' : 'month';
  const fmt = gran === 'day' ? '%Y-%m-%d' : '%Y-%m';
  const [out, over, drafts, received, invoiced, buckets, aging, recentPay, tasks, overdueList, top, counts] = await Promise.all([
    one(env, `SELECT COALESCE(SUM(total - paid),0) AS s, COUNT(*) AS n FROM invoices WHERE ${open}`),
    one(env, `SELECT COALESCE(SUM(total - paid),0) AS s, COUNT(*) AS n FROM invoices WHERE ${open} AND due_date != '' AND due_date < ?`, today),
    one(env, `SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS s FROM invoices WHERE kind = 'invoice' AND status = 'draft'`),
    one(env, 'SELECT COALESCE(SUM(amount_cents),0) AS s, COUNT(*) AS n FROM payments WHERE received_at >= ? AND received_at < ?', f, t),
    one(env, `SELECT COALESCE(SUM(total),0) AS s, COUNT(*) AS n FROM invoices WHERE kind = 'invoice' AND status IN ('sent','paid') AND issue_date >= ? AND issue_date <= ?`, from, to),
    all(env, `SELECT strftime('${fmt}', received_at / 1000 - ${tz * 60}, 'unixepoch') AS k, SUM(amount_cents) AS s FROM payments WHERE received_at >= ? AND received_at < ? GROUP BY k ORDER BY k`, f, t),
    all(env, `SELECT CASE WHEN due_date = '' OR due_date >= ? THEN 'current' WHEN julianday(?) - julianday(due_date) <= 30 THEN '1-30' WHEN julianday(?) - julianday(due_date) <= 60 THEN '31-60' WHEN julianday(?) - julianday(due_date) <= 90 THEN '61-90' ELSE '90+' END AS bucket, SUM(total - paid) AS s, COUNT(*) AS n FROM invoices WHERE ${open} GROUP BY bucket`, today, today, today, today),
    all(env, `SELECT p.*, i.number AS invoice_number, c.name AS customer_name, c.org AS customer_org FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN customers c ON c.id = p.customer_id WHERE p.received_at >= ? AND p.received_at < ? ORDER BY p.received_at DESC LIMIT 8`, f, t),
    all(env, `SELECT t.*, c.name AS customer_name, c.org AS customer_org FROM tasks t LEFT JOIN customers c ON c.id = t.customer_id WHERE t.done = 0 AND (t.due = '' OR t.due <= ?) ORDER BY CASE WHEN t.due = '' THEN '9999' ELSE t.due END LIMIT 12`, addDays(today, 7)),
    all(env, `SELECT i.*, c.name AS customer_name, c.org AS customer_org FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.${open.replace(/ AND /g, ' AND i.')} AND i.due_date != '' AND i.due_date < ? ORDER BY i.due_date LIMIT 8`, today),
    all(env, `SELECT c.id, c.name, c.org, SUM(p.amount_cents) AS s FROM payments p JOIN customers c ON c.id = p.customer_id WHERE p.received_at >= ? AND p.received_at < ? GROUP BY c.id ORDER BY s DESC LIMIT 5`, f, t),
    one(env, `SELECT (SELECT COUNT(*) FROM customers) AS customers, (SELECT COUNT(*) FROM customers WHERE status = 'lead') AS leads, (SELECT COUNT(*) FROM invoices WHERE kind = 'quote' AND status = 'sent') AS open_quotes, (SELECT COUNT(*) FROM recurring WHERE active = 1) AS recurring`),
  ]);
  return { range: { from, to, days, granularity: gran }, outstanding: out, overdue: over, drafts, received, invoiced, buckets, aging, recentPayments: recentPay, tasks, overdueInvoices: overdueList.map(decorate), topCustomers: top, counts, today };
}

export async function reports(env, from, to, p) {
  const tz = tzOf(p);
  if (!validDate(from)) from = addDays(todayStr(), -364);
  if (!validDate(to)) to = todayStr();
  const f = Date.parse(from + 'T00:00:00Z') + tz * 60000, t = Date.parse(to + 'T00:00:00Z') + 86400000 + tz * 60000;
  const [byMonth, byCustomer, byMethod, invoiced, tax, status] = await Promise.all([
    all(env, `SELECT strftime('%Y-%m', received_at / 1000 - ${tz * 60}, 'unixepoch') AS m, SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS received, SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END) AS refunded, SUM(amount_cents) AS net FROM payments WHERE received_at >= ? AND received_at < ? GROUP BY m ORDER BY m`, f, t),
    all(env, `SELECT c.id, c.name, c.org, SUM(p.amount_cents) AS s, COUNT(DISTINCT p.invoice_id) AS n FROM payments p JOIN customers c ON c.id = p.customer_id WHERE p.received_at >= ? AND p.received_at < ? GROUP BY c.id ORDER BY s DESC LIMIT 25`, f, t),
    all(env, `SELECT method, SUM(amount_cents) AS s, COUNT(*) AS n FROM payments WHERE received_at >= ? AND received_at < ? GROUP BY method ORDER BY s DESC`, f, t),
    one(env, `SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS s FROM invoices WHERE kind = 'invoice' AND status IN ('sent','paid') AND issue_date >= ? AND issue_date <= ?`, from, to),
    one(env, `SELECT COALESCE(SUM(tax_cents),0) AS s FROM invoices WHERE kind = 'invoice' AND status IN ('sent','paid') AND issue_date >= ? AND issue_date <= ?`, from, to),
    all(env, `SELECT status, COUNT(*) AS n, SUM(total) AS s FROM invoices WHERE kind = 'invoice' AND issue_date >= ? AND issue_date <= ? GROUP BY status`, from, to),
  ]);
  return { from, to, byMonth, byCustomer, byMethod, invoiced, tax: tax.s, status };
}

const dollarsOf = (n) => Math.round(n || 0) / 100;

// Rows for the Excel export (see xlsx.js). Money is exported as real numbers, dates as real dates.
export async function exportData(env, kind, from, to) {
  if (kind === 'customers') {
    const rows = await all(env, 'SELECT * FROM customers ORDER BY LOWER(name)');
    return { name: 'Customers', cols: [{ h: 'Name' }, { h: 'Organization' }, { h: 'Email' }, { h: 'Phone' }, { h: 'Address 1' }, { h: 'Address 2' }, { h: 'City' }, { h: 'State' }, { h: 'ZIP' }, { h: 'Country' }, { h: 'Status' }, { h: 'Source' }, { h: 'Tags' }, { h: 'Notes', w: 50 }, { h: 'Added', t: 'datetime' }],
      rows: rows.map((c) => [c.name, c.org, c.email, c.phone, c.addr1, c.addr2, c.city, c.state, c.zip, c.country, c.status, c.source, c.tags, c.notes, c.created]) };
  }
  const f = validDate(from) ? from : '0000-01-01', t = validDate(to) ? to : '9999-12-31';
  if (kind === 'payments') {
    const rows = await all(env, `SELECT p.*, i.number, c.name, c.org FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN customers c ON c.id = p.customer_id WHERE date(p.received_at / 1000, 'unixepoch') >= ? AND date(p.received_at / 1000, 'unixepoch') <= ? ORDER BY p.received_at`, f, t);
    return { name: 'Payments', cols: [{ h: 'Date', t: 'date' }, { h: 'Invoice' }, { h: 'Customer' }, { h: 'Amount', t: 'money' }, { h: 'Method' }, { h: 'Reference' }, { h: 'Note', w: 40 }],
      rows: rows.map((p) => [new Date(p.received_at).toISOString().slice(0, 10), p.number, p.org || p.name, dollarsOf(p.amount_cents), p.method, p.ref, p.note]) };
  }
  const rows = await all(env, `SELECT i.*, c.name, c.org, c.email FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.issue_date >= ? AND i.issue_date <= ? ORDER BY i.issue_date, i.number`, f, t);
  return { name: 'Invoices', cols: [{ h: 'Type' }, { h: 'Number' }, { h: 'Customer' }, { h: 'Email' }, { h: 'Status' }, { h: 'Issue date', t: 'date' }, { h: 'Due date', t: 'date' }, { h: 'Subtotal', t: 'money' }, { h: 'Discount', t: 'money' }, { h: 'Tax', t: 'money' }, { h: 'Total', t: 'money' }, { h: 'Paid', t: 'money' }, { h: 'Balance', t: 'money' }, { h: 'Currency' }],
    rows: rows.map((i) => { const d = decorate(i); return [i.kind, i.number, i.org || i.name, i.email, d.state, i.issue_date, i.due_date, dollarsOf(i.subtotal), dollarsOf(i.discount_cents), dollarsOf(i.tax_cents), dollarsOf(i.total), dollarsOf(i.paid), dollarsOf(d.balance), (i.currency || '').toUpperCase()]; }) };
}

/* ------------------------------------------------------------------ import (Wix and other CSVs; the page maps the columns) */
export function parseMoney(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100);
  let s = String(v).trim();
  if (!s) return null;
  let neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s);
  s = s.replace(/[^0-9.,]/g, '');
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > ld && s.length - lc - 1 <= 2) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');   // 1.234,56 (decimal comma) or 1,234.56
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return Math.round(n * 100) * (neg ? -1 : 1);
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function parseDate(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(s))) {
    let a = +m[1], b = +m[2]; y = +m[3]; if (y < 100) y += 2000;
    if (a > 12) { d = a; mo = b; } else { mo = a; d = b; }
  } else if ((m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/.exec(s))) { mo = MONTHS[m[1].toLowerCase()]; d = +m[2]; y = +m[3]; }
  else if ((m = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -,]+(\d{4})/.exec(s))) { d = +m[1]; mo = MONTHS[m[2].toLowerCase()]; y = +m[3]; }
  else { const t = Date.parse(s); if (isNaN(t)) return ''; return new Date(t).toISOString().slice(0, 10); }
  if (!mo) return '';
  const out = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return validDate(out) ? out : '';
}

// Spreadsheets (including Wix's CSV export) often write text as ="Dov Brieger" so Excel keeps leading zeros. Undo that.
// Excel's other text marker is a leading apostrophe before a number or +, as in '+1 347-228-3034.
export const unwrapCell = (v) => (typeof v === 'string' ? v.replace(/^\s*=\s*"([\s\S]*)"\s*$/, (_, x) => x.replace(/""/g, '"')).replace(/^'(?=[+\d])/, '').trim() : v);
const unwrapRow = (r) => Object.fromEntries(Object.entries(r || {}).map(([k, v]) => [k, unwrapCell(v)]));

export async function importCustomers(env, rows, mode, dry) {
  rows = rows.map(unwrapRow);
  const out = { created: 0, updated: 0, skipped: 0, errors: [] };
  const seen = new Set();
  for (let i = 0; i < rows.length && i < 500; i++) {
    const r = rows[i] || {};
    try {
      const name = line1(r.name || [r.first_name, r.last_name].filter(Boolean).join(' ') || r.org, 160);
      const email = line1(r.email, 200).toLowerCase();
      if (!name && !email) { out.skipped++; continue; }
      if (email && !EMAIL_RE.test(email)) throw fail('Email address does not look right');
      const key = email || `n:${name.toLowerCase()}`;
      if (seen.has(key)) { out.skipped++; continue; }
      seen.add(key);
      const existing = email ? await one(env, 'SELECT id FROM customers WHERE LOWER(email) = ?', email) : await one(env, 'SELECT id FROM customers WHERE LOWER(name) = LOWER(?) AND email = ""', name);
      if (existing && mode !== 'update') { out.skipped++; continue; }
      if (dry) { existing ? out.updated++ : out.created++; continue; }
      const body = { ...r, name: name || email, email, status: ['lead', 'active', 'past'].includes(String(r.status || '').toLowerCase()) ? String(r.status).toLowerCase() : 'active', source: r.source || 'import' };
      if (existing) {
        const cur = await one(env, 'SELECT * FROM customers WHERE id = ?', existing.id);
        const merged = { ...cur }; Object.keys(body).forEach((k) => { if (body[k] !== undefined && body[k] !== '') merged[k] = body[k]; });
        await saveCustomer(env, { ...merged, id: existing.id }); out.updated++;
      } else { await saveCustomer(env, body); out.created++; }
    } catch (e) { out.errors.push({ row: i + 1, error: e.message }); }
  }
  return out;
}

// Rows can be one per invoice, or one per invoice line (rows with the same number are grouped).
export async function importInvoices(env, rows, opts, dry) {
  opts = opts || {};
  rows = rows.map(unwrapRow);
  const out = { created: 0, skipped: 0, customersCreated: 0, errors: [], payments: 0 };
  const groups = new Map();
  rows.slice(0, 600).forEach((r, i) => {
    const num = line1(r.number, 40);
    const key = num || `row${i}`;
    if (!groups.has(key)) groups.set(key, { number: num, rows: [], first: i + 1 });
    groups.get(key).rows.push(r);
  });
  const settings = await getSettings(env);
  const custCache = new Map();
  let maxNum = 0;
  for (const g of groups.values()) {
    try {
      const r = g.rows[0];
      const kind = /quote|estimate/i.test(r.type || '') ? 'quote' : 'invoice';
      const number = g.number || (await nextNumber(env, kind));
      if (await one(env, 'SELECT id FROM invoices WHERE kind = ? AND number = ?', kind, number)) { out.skipped++; continue; }
      // customer
      const email = line1(r.customer_email, 200).toLowerCase(); const cname = line1(r.customer_name || r.customer_org, 160);
      if (!email && !cname) throw fail('No customer on this invoice');
      const ckey = email || 'n:' + cname.toLowerCase();
      let cid = custCache.get(ckey);
      if (!cid) {
        const c = email ? await one(env, 'SELECT id FROM customers WHERE LOWER(email) = ?', email) : await one(env, 'SELECT id FROM customers WHERE LOWER(name) = LOWER(?) OR LOWER(org) = LOWER(?)', cname, cname);
        if (c) cid = c.id;
        else if (!dry) { cid = await saveCustomer(env, { name: cname || email, email: EMAIL_RE.test(email) ? email : '', org: '', status: 'active', source: 'import' }); out.customersCreated++; }
        else { cid = 'dry'; out.customersCreated++; }
        custCache.set(ckey, cid);
      }
      // lines and totals
      let lines = g.rows.filter((x) => x.description || x.unit_price != null && x.unit_price !== '').map((x) => ({
        description: clean(x.description, 600) || `Invoice ${number}`, qty: Number(String(x.qty ?? '1').replace(/[^0-9.\-]/g, '')) || 1,
        unit_cents: parseMoney(x.unit_price) ?? parseMoney(x.line_total) ?? 0, taxable: 0,
      }));
      const totalGiven = parseMoney(r.total);
      const taxGiven = parseMoney(r.tax) ?? 0;
      const discGiven = Math.abs(parseMoney(r.discount) ?? 0);
      let subtotal = lines.reduce((a, l) => a + Math.round(l.qty * l.unit_cents), 0);
      if (!lines.length || (!subtotal && totalGiven)) {
        const base = (totalGiven ?? 0) - taxGiven + discGiven;
        lines = [{ description: clean(r.description, 600) || `Invoice ${number}`, qty: 1, unit_cents: base, taxable: 0 }];
        subtotal = base;
      }
      const total = totalGiven != null ? totalGiven : Math.max(0, subtotal - discGiven + taxGiven);
      const issue = parseDate(r.issue_date) || parseDate(r.due_date) || todayStr();
      const due = parseDate(r.due_date) || issue;
      const statusWord = String(r.status || '').toLowerCase();
      let status = /void|cancel/.test(statusWord) ? 'void' : /draft/.test(statusWord) ? 'draft' : /accept/.test(statusWord) ? 'accepted' : /declin|reject/.test(statusWord) ? 'declined' : 'sent';
      let paidCents = 0;
      if (/paid/.test(statusWord) && !/unpaid|partial|part/.test(statusWord)) paidCents = total;
      else if (/partial|part/.test(statusWord)) paidCents = Math.max(0, Math.min(total, parseMoney(r.paid) ?? 0));
      else if (r.paid != null && r.paid !== '') paidCents = Math.max(0, Math.min(total, parseMoney(r.paid) ?? 0));
      if (kind === 'quote' && !['draft', 'accepted', 'declined', 'void'].includes(status)) status = 'sent';
      if (kind === 'quote') paidCents = 0;
      if (dry) { out.created++; if (paidCents) out.payments++; continue; }
      const id = uid(); const now = Date.now();
      const rate = subtotal - discGiven > 0 && taxGiven ? Math.round((taxGiven / (subtotal - discGiven)) * 100000) / 1000 : 0;
      const stmts = [
        st(env, `INSERT INTO invoices (id, kind, number, customer_id, status, issue_date, due_date, currency, subtotal, discount_type, discount_value, discount_cents, tax_rate, tax_cents, total, paid, notes, terms, title, token, sent_at, source, created, updated)
                 VALUES (?,?,?,?,?,?,?,?,?, 'amt', ?, ?, ?, ?, ?, 0, ?, '', ?, ?, ?, 'import', ?, ?)`,
          id, kind, number, cid, status, issue, due, (r.currency && /^[a-z]{3}$/i.test(r.currency) ? r.currency : settings.currency).toLowerCase(), subtotal, discGiven, discGiven, rate, taxGiven, total, clean(r.notes, 1500), line1(r.title, 160), secretToken(), status === 'draft' ? null : Date.parse(issue + 'T12:00:00Z'), now, now),
        logAct(env, { customer_id: cid, invoice_id: id, type: kind, text: `${kind === 'quote' ? 'Quote' : 'Invoice'} ${number} imported (${statusWord || 'sent'})`, ts: now }),
      ];
      lines.forEach((l, i) => stmts.push(st(env, 'INSERT INTO invoice_lines (invoice_id, pos, description, qty, unit_cents, taxable) VALUES (?,?,?,?,?,?)', id, i, l.description, l.qty, l.unit_cents, 0)));
      if (paidCents > 0) {
        const when = Date.parse((parseDate(r.paid_date) || due) + 'T12:00:00Z');
        stmts.push(st(env, 'INSERT INTO payments (id, invoice_id, customer_id, amount_cents, method, ref, received_at, note, created) VALUES (?,?,?,?,?,?,?,?,?)',
          uid(), id, cid, paidCents, 'imported', line1(r.payment_method, 60), when, 'Imported from ' + (opts.source || 'a file'), now));
        stmts.push(st(env, 'UPDATE invoices SET paid = ?, status = ?, paid_at = ? WHERE id = ?', paidCents, paidCents >= total ? 'paid' : 'sent', paidCents >= total ? when : null, id));
        out.payments++;
      }
      await batch(env, stmts);
      out.created++;
      const n = parseInt(String(number).replace(/\D/g, ''), 10);
      if (kind === 'invoice' && n > maxNum && String(number).startsWith(settings.invoice_prefix)) maxNum = n;
    } catch (e) { out.errors.push({ row: g.first, error: e.message }); }
  }
  if (!dry && maxNum) await run(env, `INSERT INTO settings (k, v) VALUES ('next_invoice', ?) ON CONFLICT(k) DO UPDATE SET v = ? WHERE CAST(v AS INTEGER) <= ?`, String(maxNum + 1), String(maxNum + 1), maxNum);
  return out;
}

/* ------------------------------------------------------------------ payments list, search, wipe */
export async function listPayments(env, p) {
  const tzs = tzOf(p) * 60;
  const where = ['1=1']; const args = [];
  if (validDate(p.from)) { where.push(`date(p.received_at / 1000 - ${tzs}, 'unixepoch') >= ?`); args.push(p.from); }
  if (validDate(p.to)) { where.push(`date(p.received_at / 1000 - ${tzs}, 'unixepoch') <= ?`); args.push(p.to); }
  if (p.method) { where.push('p.method = ?'); args.push(p.method); }
  if (p.q) { where.push(`(i.number LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.org LIKE ? ESCAPE '\\')`); const l = like(p.q); args.push(l, l, l); }
  const rows = await all(env, `SELECT p.*, i.number AS invoice_number, c.name AS customer_name, c.org AS customer_org FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN customers c ON c.id = p.customer_id
    WHERE ${where.join(' AND ')} ORDER BY p.received_at DESC LIMIT 500`, ...args);
  const sum = await one(env, `SELECT COALESCE(SUM(p.amount_cents),0) AS s, COUNT(*) AS n FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN customers c ON c.id = p.customer_id WHERE ${where.join(' AND ')}`, ...args);
  return { payments: rows, summary: sum };
}

export async function search(env, q) {
  q = clean(q, 80);
  if (q.length < 2) return { customers: [], invoices: [] };
  const l = like(q);
  const customers = await all(env, `SELECT id, name, org, email, status FROM customers WHERE name LIKE ? ESCAPE '\\' OR org LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' ORDER BY LOWER(name) LIMIT 8`, l, l, l);
  const invoices = await all(env, `SELECT i.id, i.kind, i.number, i.total, i.status, i.paid, i.due_date, c.name AS customer_name, c.org AS customer_org FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.number LIKE ? ESCAPE '\\' ORDER BY i.issue_date DESC LIMIT 8`, l);
  return { customers, invoices: invoices.map((i) => ({ ...i, state: displayState({ ...i, kind: i.kind }) })) };
}

export async function wipeAll(env) {
  const tables = ['activity', 'tasks', 'payments', 'invoice_lines', 'invoices', 'recurring', 'items', 'customers', 'settings'];
  await batch(env, tables.map((t) => st(env, `DELETE FROM ${t}`)));
}

/* ------------------------------------------------------------------ one-time cleanup of imported text */
// Imports from spreadsheets sometimes left ="Dov Brieger" in names and ="0003113" in invoice numbers. This fixes what is stored,
// fills a missing email when a name is really an email address, and merges customers that are now obvious duplicates
// (same email, or same name with no email). Nothing is deleted except the duplicate customer records; their invoices move to the one kept.
const UW = (c) => `CASE WHEN ${c} LIKE '="%"' AND LENGTH(${c}) >= 4 THEN REPLACE(SUBSTR(${c}, 3, LENGTH(${c}) - 3), '""', '"') ELSE ${c} END`;

export async function cleanImported(env) {
  const out = { customers: 0, invoices: 0, merged: 0 };
  const wrapped = await all(env, `SELECT id, number FROM invoices WHERE number LIKE '="%"'`);
  for (const w of wrapped) await run(env, 'UPDATE activity SET text = REPLACE(text, ?, ?) WHERE invoice_id = ?', w.number, unwrapCell(w.number), w.id);   // while the old number is still there
  const cf = ['name', 'org', 'email', 'phone', 'addr1', 'addr2', 'city', 'state', 'zip', 'country', 'tags', 'notes', 'ext_id'];
  const c = await run(env, `UPDATE customers SET ${cf.map((f) => `${f} = ${UW(f)}`).join(', ')}, updated = ? WHERE ${cf.map((f) => `${f} LIKE '="%"'`).join(' OR ')}`, Date.now());
  out.customers = (c.meta && c.meta.changes) || 0;
  await run(env, `UPDATE customers SET email = LOWER(name) WHERE email = '' AND name LIKE '%_@_%.__%' AND name NOT LIKE '% %'`);
  await run(env, `UPDATE customers SET phone = SUBSTR(phone, 2) WHERE phone LIKE '''+%' OR phone LIKE '''0%' OR phone LIKE '''1%' OR phone LIKE '''2%' OR phone LIKE '''3%' OR phone LIKE '''4%' OR phone LIKE '''5%' OR phone LIKE '''6%' OR phone LIKE '''7%' OR phone LIKE '''8%' OR phone LIKE '''9%'`);
  const i = await run(env, `UPDATE OR IGNORE invoices SET number = ${UW('number')}, notes = ${UW('notes')}, terms = ${UW('terms')}, updated = ? WHERE number LIKE '="%"' OR notes LIKE '="%"' OR terms LIKE '="%"'`, Date.now());
  out.invoices = (i.meta && i.meta.changes) || 0;
  await run(env, `UPDATE invoice_lines SET description = ${UW('description')} WHERE description LIKE '="%"'`);
  await run(env, `UPDATE payments SET ref = ${UW('ref')}, note = ${UW('note')} WHERE ref LIKE '="%"' OR note LIKE '="%"'`);

  const groups = [
    ...(await all(env, `SELECT GROUP_CONCAT(id) AS ids FROM customers WHERE email != '' GROUP BY LOWER(email) HAVING COUNT(*) > 1`)),
    ...(await all(env, `SELECT GROUP_CONCAT(id) AS ids FROM customers WHERE email = '' GROUP BY LOWER(name) HAVING COUNT(*) > 1`)),
  ];
  for (const g of groups) {
    const ids = g.ids.split(',');
    const rows = await all(env, `SELECT c.*, (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id) AS n FROM customers c WHERE c.id IN (${ids.map(() => '?').join(',')}) ORDER BY n DESC, c.created`, ...ids);
    const keep = rows[0];
    for (const d of rows.slice(1)) {
      const stmts = ['invoices', 'payments', 'activity', 'tasks', 'recurring'].map((t) => st(env, `UPDATE ${t} SET customer_id = ? WHERE customer_id = ?`, keep.id, d.id));
      const fill = ['org', 'email', 'phone', 'addr1', 'addr2', 'city', 'state', 'zip', 'country', 'tags', 'notes'].filter((f) => !keep[f] && d[f]);
      if (fill.length) stmts.push(st(env, `UPDATE customers SET ${fill.map((f) => `${f} = ?`).join(', ')}, updated = ? WHERE id = ?`, ...fill.map((f) => d[f]), Date.now(), keep.id));
      stmts.push(logAct(env, { customer_id: keep.id, type: 'system', text: `Merged a duplicate record (${d.name}) into this customer` }));
      stmts.push(st(env, 'DELETE FROM customers WHERE id = ?', d.id));
      await batch(env, stmts);
      out.merged++;
    }
  }
  return out;
}
