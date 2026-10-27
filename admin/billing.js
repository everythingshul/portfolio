/* Billing tab: overview, invoices, quotes, repeating invoices, payments, items, reports, importing from Wix, and settings. */
(() => {
  const U = window.ESUI;
  const Doc = window.ESInvoiceDoc;
  const { esc, money, toCents, dollars, fmtDate, ago, badge, toast } = U;
  const $ = (id) => document.getElementById(id);
  const root = () => $('billing');
  let api = null;
  let settings = null;
  const st = { view: 'overview', inv: { status: '', q: '', from: '', to: '' }, quo: { status: '', q: '' }, pay: { q: '', from: '', to: '', method: '' }, rep: { from: '', to: '' } };

  const VIEWS = [['overview', 'Overview'], ['invoices', 'Invoices'], ['quotes', 'Quotes'], ['recurring', 'Repeating'], ['payments', 'Payments'], ['items', 'Items'], ['reports', 'Reports'], ['import', 'Import'], ['settings', 'Settings']];
  const who = (r) => r.customer_org || r.customer_name || r.org || r.name || '';
  const loadSettings = async (force) => { if (!settings || force) settings = (await api('/admin/b/settings')).settings; return settings; };
  const METHODS = [['stripe', 'Online (Stripe)'], ['check', 'Check'], ['cash', 'Cash'], ['ach', 'Bank transfer'], ['zelle', 'Zelle'], ['other', 'Other'], ['imported', 'Imported'], ['stripe_refund', 'Stripe refund']];
  const methodName = (m) => (METHODS.find((x) => x[0] === m) || [0, m])[1];

  const table = (head, rows, clickable) => (rows.length
    ? `<div class="tscroll"><table class="atable${clickable ? ' clickable' : ''}"><thead><tr>${head.map((h, i) => `<th${/^[>]/.test(h) ? ' class="n"' : ''}>${esc(h.replace(/^>/, ''))}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
    : '<div class="aempty">Nothing here yet.</div>');
  const card = (title, body, cls, note) => `<section class="acard ${cls || ''}"><h3>${esc(title)}</h3>${note ? `<p class="anote">${esc(note)}</p>` : ''}${body}</section>`;
  const kpi = (label, value, sub, cls) => `<div class="kpi ${cls || ''}"><div class="kv">${value}</div><div class="kl">${esc(label)}</div>${sub ? `<div class="kd">${sub}</div>` : ''}</div>`;
  const bars = (rows, label, value, fmtv) => {
    if (!rows.length) return '<div class="aempty">Nothing yet.</div>';
    const max = Math.max(...rows.map(value), 1);
    return '<div class="bars">' + rows.map((r) => `<div class="bar"><div class="bl" title="${esc(label(r))}">${esc(label(r))}</div><div class="bt"><i style="width:${Math.max(2, (Math.max(0, value(r)) / max) * 100)}%"></i></div><div class="bv">${esc(fmtv(value(r)))}</div></div>`).join('') + '</div>';
  };
  const go = (id) => window.ESBilling.openInvoice(id);
  const goCust = (id) => window.ESCRM.open(id);

  /* ------------------------------------------------------------------ frame */
  function chrome() {
    const el = root();
    el.innerHTML = `<div class="asub" id="b-nav">${VIEWS.map(([k, l]) => `<button class="stab${st.view === k ? ' on' : ''}" data-v="${k}">${l}</button>`).join('')}</div><div id="b-body"></div>`;
    $('b-nav').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; st.view = b.dataset.v; history.replaceState(null, '', '#billing'); chrome(); draw(); });
  }
  async function draw() {
    const body = $('b-body'); if (!body) return;
    body.innerHTML = '<div class="aempty">Loading…</div>';
    try { await VIEW[st.view](body); } catch (e) { body.innerHTML = `<div class="aempty">${esc(e.message)}${/not set up/i.test(e.message) ? '<br>The billing database still needs to be created. See worker/chat/README.md.' : ''}</div>`; }
  }

  const VIEW = {};

  /* ------------------------------------------------------------------ overview */
  VIEW.overview = async (el) => {
    const d = await api('/admin/b/dashboard');
    await loadSettings();
    const months = [];
    for (let i = 11; i >= 0; i--) { const t = new Date(); t.setDate(1); t.setMonth(t.getMonth() - i); months.push(t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0')); }
    const mm = Object.fromEntries(d.monthly.map((m) => [m.m, m.s]));
    const rows = months.map((m) => ({ m, s: mm[m] || 0 }));
    const max = Math.max(...rows.map((r) => r.s), 1);
    const order = ['current', '1-30', '31-60', '61-90', '90+'];
    const aging = order.map((k) => ({ k, ...(d.aging.find((a) => a.bucket === k) || { s: 0, n: 0 }) }));
    const stripeNote = '';
    el.innerHTML = `<div class="pagehead"><h2 class="plain">Billing</h2><span class="grow"></span><button class="small-btn" id="o-newq">New quote</button><button class="small-btn primary" id="o-newi">+ New invoice</button></div>
      <div class="kpis">${kpi('Outstanding', esc(money(d.outstanding.s)), `${d.outstanding.n} unpaid invoice${d.outstanding.n === 1 ? '' : 's'}`)}${kpi('Overdue', esc(money(d.overdue.s)), `${d.overdue.n} invoice${d.overdue.n === 1 ? '' : 's'}`, d.overdue.n ? 'bad' : '')}${kpi('Paid, last 30 days', esc(money(d.paid30.s)), `${d.paid30.n} payment${d.paid30.n === 1 ? '' : 's'}`, 'good')}${kpi('Drafts', String(d.drafts.n), esc(money(d.drafts.s)) + ' not sent yet')}${kpi('Customers', String(d.counts.customers), `${d.counts.leads} lead${d.counts.leads === 1 ? '' : 's'}`)}</div>
      ${stripeNote}
      ${card('Money received, last 12 months', `<div class="monthbars">${rows.map((r) => `<div class="mb" title="${esc(r.m)}: ${esc(money(r.s))}"><div class="mbv">${r.s ? esc(money(r.s).replace(/\.00$/, '')) : ''}</div><div class="mbt"><i style="height:${Math.max(r.s ? 3 : 0, (Math.max(0, r.s) / max) * 100)}%"></i></div><div class="mbl">${new Date(r.m + '-15').toLocaleDateString('en-US', { month: 'short' })}</div></div>`).join('')}</div>`, 'wide')}
      <div class="grid2">${card('Overdue invoices', d.overdueInvoices.length ? table(['Invoice', 'Customer', 'Due', '>Balance', ''], d.overdueInvoices.map((i) => `<tr data-inv="${esc(i.id)}"><td><strong>${esc(i.number)}</strong></td><td>${esc(who(i))}</td><td>${esc(fmtDate(i.due_date))}</td><td class="n">${esc(money(i.balance, i.currency))}</td><td class="n"><button class="small-btn" data-remind="${esc(i.id)}">Remind</button></td></tr>`), true) : '<div class="aempty">Nothing is overdue. 🎉</div>')}
        ${card('Who owes what, by age', bars(aging, (r) => (r.k === 'current' ? 'Not due yet' : r.k + ' days late'), (r) => r.s, (v) => money(v)))}</div>
      <div class="grid2">${card('Recent payments', d.recentPayments.length ? table(['Date', 'Customer', 'Invoice', '>Amount'], d.recentPayments.map((p) => `<tr data-inv="${esc(p.invoice_id)}"><td>${esc(U.fmtDay(p.received_at))}</td><td>${esc(who(p))}</td><td>${esc(p.invoice_number || '')}</td><td class="n">${esc(money(p.amount_cents))}</td></tr>`), true) : '<div class="aempty">No payments yet.</div>')}
        ${card('Follow-ups', d.tasks.length ? '<ul class="plainlist">' + d.tasks.map((t) => `<li class="${t.due && t.due < d.today ? 'late' : ''}"><label><input type="checkbox" data-task="${esc(t.id)}"> ${esc(t.text)}</label><a href="#customer=${esc(t.customer_id)}" data-cust="${esc(t.customer_id)}">${esc(t.customer_org || t.customer_name || '')}</a>${t.due ? `<small>${esc(fmtDate(t.due))}</small>` : ''}</li>`).join('') + '</ul>' : '<div class="aempty">No follow-ups due.</div>')}</div>
      ${d.topCustomers.length ? card('Top customers, last 12 months', bars(d.topCustomers, (r) => r.org || r.name, (r) => r.s, (v) => money(v)), 'wide') : ''}`;
    $('o-newi').addEventListener('click', () => invoiceEditor({ kind: 'invoice' }));
    $('o-newq').addEventListener('click', () => invoiceEditor({ kind: 'quote' }));
    el.querySelectorAll('tr[data-inv]').forEach((r) => r.addEventListener('click', (e) => { if (e.target.closest('button')) return; go(r.dataset.inv); }));
    el.querySelectorAll('[data-remind]').forEach((b) => b.addEventListener('click', async () => { b.disabled = true; try { await api('/admin/b/invoice/remind', { method: 'POST', body: { id: b.dataset.remind } }); toast('Reminder sent'); } catch (e) { toast(e.message); } b.disabled = false; }));
    el.querySelectorAll('[data-task]').forEach((cb) => cb.addEventListener('change', async () => { await api('/admin/b/task/toggle', { method: 'POST', body: { id: cb.dataset.task, done: cb.checked } }); draw(); }));
    el.querySelectorAll('[data-cust]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); goCust(a.dataset.cust); }));
    api('/admin/b/stripe').then((s) => { if (!s.key) el.querySelector('.kpis').insertAdjacentHTML('afterend', `<div class="notice">Online payments are not connected yet, so customers can not pay by card from their invoice. <a href="#" id="to-set">Set up Stripe</a></div>`), $('to-set') && $('to-set').addEventListener('click', (e) => { e.preventDefault(); st.view = 'settings'; chrome(); draw(); }); }).catch(() => {});
  };

  /* ------------------------------------------------------------------ invoices and quotes list */
  const listView = (kind) => async (el) => {
    const q = kind === 'quote' ? st.quo : st.inv;
    const chips = kind === 'quote' ? [['', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['accepted', 'Accepted'], ['declined', 'Declined'], ['void', 'Void']]
      : [['', 'All'], ['draft', 'Draft'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void']];
    el.innerHTML = `<div class="toolbar"><input type="search" id="l-q" placeholder="Search number or customer…" value="${esc(q.q)}"><div class="chips" id="l-chips">${chips.map(([k, l]) => `<button class="chip${q.status === k ? ' on' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
      ${kind === 'invoice' ? `<input type="date" id="l-from" value="${esc(q.from)}" aria-label="From"><span class="subtle">to</span><input type="date" id="l-to" value="${esc(q.to)}" aria-label="To">` : ''}
      <span class="grow"></span>${kind === 'invoice' ? '<button class="small-btn" id="l-export">Export CSV</button>' : ''}<button class="small-btn primary" id="l-new">+ New ${kind}</button></div><div id="l-body"><div class="aempty">Loading…</div></div>`;
    $('l-new').addEventListener('click', () => invoiceEditor({ kind }));
    const reload = U.debounce(() => { q.q = $('l-q').value.trim(); if ($('l-from')) { q.from = $('l-from').value; q.to = $('l-to').value; } fetchList(); }, 250);
    $('l-q').addEventListener('input', reload);
    if ($('l-from')) { $('l-from').addEventListener('change', reload); $('l-to').addEventListener('change', reload); }
    $('l-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (!b) return; q.status = b.dataset.s; $('l-chips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b)); fetchList(); });
    if ($('l-export')) $('l-export').addEventListener('click', () => exportCsv('invoices', q.from, q.to));
    async function fetchList() {
      const body = $('l-body');
      const d = await api('/admin/b/invoices?' + new URLSearchParams({ kind, status: q.status, q: q.q, from: q.from || '', to: q.to || '' }));
      if (!d.invoices.length) { body.innerHTML = `<div class="aempty">${q.status || q.q ? 'Nothing matches.' : `No ${kind}s yet. Create your first one, or import them from Wix.`}</div>`; return; }
      body.innerHTML = table(['Number', 'Customer', 'Date', kind === 'quote' ? 'Valid until' : 'Due', '>Total', ...(kind === 'invoice' ? ['>Balance'] : []), 'Status'], d.invoices.map((i) => `<tr data-inv="${esc(i.id)}"><td><strong>${esc(i.number)}</strong></td><td>${esc(who(i))}</td><td>${esc(fmtDate(i.issue_date))}</td><td>${esc(fmtDate(i.due_date))}</td><td class="n">${esc(money(i.total, i.currency))}</td>${kind === 'invoice' ? `<td class="n">${['draft', 'void'].includes(i.state) ? '—' : esc(money(i.balance, i.currency))}</td>` : ''}<td>${badge(i.state)}</td></tr>`), true)
        + `<p class="anote">${d.summary.n} ${kind}${d.summary.n === 1 ? '' : 's'} · ${esc(money(d.summary.total))} total${kind === 'invoice' ? ` · ${esc(money(d.summary.balance))} still owed` : ''}</p>`;
      body.querySelectorAll('tr[data-inv]').forEach((r) => r.addEventListener('click', () => go(r.dataset.inv)));
    }
    await fetchList();
  };
  VIEW.invoices = listView('invoice');
  VIEW.quotes = listView('quote');

  async function exportCsv(kind, from, to) {
    try {
      const res = await fetch(api.base + `/admin/b/export?${new URLSearchParams({ kind, from: from || '', to: to || '' })}`, { headers: { Authorization: 'Bearer ' + api.token() } });
      if (!res.ok) throw new Error('Export failed');
      U.download(`${kind}.csv`, await res.blob());
    } catch (e) { toast(e.message); }
  }

  /* ------------------------------------------------------------------ one invoice */
  const docData = (d, s) => ({ ...d.invoice, lines: d.lines, customer: d.customer, payments: d.payments, terms: d.invoice.terms || s.terms,
    business: { name: s.biz_name, address: s.biz_address, email: s.biz_email, phone: s.biz_phone, taxid: s.biz_taxid, logo_url: s.logo_url } });
  const payUrl = (inv) => `${location.origin}/pay/?t=${inv.token}`;

  async function openInvoice(id) {
    history.replaceState(null, '', '#invoice=' + id);
    window.ESAdmin && window.ESAdmin.setTab('billing', true);
    const el = root();
    el.innerHTML = '<div class="aempty">Loading…</div>';
    let d, s;
    try { [d, s] = await Promise.all([api('/admin/b/invoice?id=' + encodeURIComponent(id)), loadSettings()]); } catch (e) { el.innerHTML = `<div class="aempty">${esc(e.message)}</div>`; return; }
    const i = d.invoice, q = i.kind === 'quote', c = d.customer;
    const a = [];
    const btn = (key, label, cls) => `<button class="small-btn ${cls || ''} block" data-a="${key}">${label}</button>`;
    if (!q) {
      if (i.status === 'draft') a.push(btn('send', 'Send invoice', 'primary'), btn('edit', 'Edit'));
      else if (i.status === 'void') a.push(btn('reopen', 'Reopen'));
      else { if (i.balance > 0) a.push(btn('pay', 'Record a payment', 'primary')); else a.push(btn('pay', 'Record payment or refund')); a.push(btn('edit', 'Edit')); if (i.balance > 0) a.push(btn('remind', 'Send reminder'), btn('send', 'Resend invoice')); }
    } else {
      if (i.status === 'draft') a.push(btn('send', 'Send quote', 'primary'), btn('edit', 'Edit'));
      if (i.status === 'sent') a.push(btn('convert', 'Turn into an invoice', 'primary'), btn('send', 'Resend quote'), btn('accept', 'Mark accepted'), btn('decline', 'Mark declined'), btn('edit', 'Edit'));
      if (i.status === 'accepted') a.push(btn('convert', 'Turn into an invoice', 'primary'));
      if (i.status === 'void') a.push(btn('reopen', 'Reopen'));
    }
    if (i.status !== 'draft' && i.status !== 'void') a.push(btn('copy', 'Copy customer link'), `<a class="small-btn block" href="${esc(payUrl(i))}" target="_blank" rel="noopener">Open customer view ↗</a>`);
    a.push(btn('print', 'Print or save as PDF'), btn('dup', 'Duplicate'));
    if (!['void'].includes(i.status) && !(i.paid > 0)) a.push(btn('void', 'Void', 'danger'));
    if (['draft', 'void'].includes(i.status)) a.push(btn('delete', 'Delete', 'danger'));
    el.innerHTML = `<div class="pagehead no-print"><button class="small-btn" id="back">← ${q ? 'Quotes' : 'Invoices'}</button><div class="titleblock"><h2>${q ? 'Quote' : 'Invoice'} ${esc(i.number)}</h2>${badge(i.state)}</div><span class="grow"></span><a href="#customer=${esc(c.id)}" class="small-btn" id="tocust">${esc(c.org || c.name)} →</a></div>
      <div class="split inv-split"><div class="main"><div class="docwrap">${Doc.render(docData(d, s))}</div></div>
      <aside class="side no-print"><section class="acard"><h3>Actions</h3><div class="actions-col">${a.join('')}</div></section>
        ${!q && i.status !== 'draft' && i.status !== 'void' ? `<section class="acard"><h3>Payments</h3>${d.payments.length ? d.payments.map((p) => `<div class="line"><span>${esc(U.fmtDay(p.received_at))} · ${esc(methodName(p.method))}${p.ref ? ` <small>${esc(p.ref)}</small>` : ''}</span><span class="pr"><strong>${esc(money(p.amount_cents, i.currency))}</strong>${p.method === 'stripe' || p.method === 'stripe_refund' ? '' : `<button class="x" data-delpay="${esc(p.id)}" aria-label="Remove payment" title="Remove this payment record">×</button>`}</span></div>`).join('') : '<div class="subtle">No payments yet.</div>'}
          <label class="check pad"><input type="checkbox" id="autorem" ${i.auto_remind ? 'checked' : ''}> Send automatic reminders</label></section>` : ''}
        <section class="acard"><h3>History</h3>${d.activity.length ? `<ul class="timeline">${d.activity.map((x) => `<li><time>${esc(U.fmtTime(x.ts))}</time><span>${esc(x.text)}</span></li>`).join('')}</ul>` : '<div class="subtle">Nothing yet.</div>'}</section></aside></div>`;
    $('back').addEventListener('click', () => { history.replaceState(null, '', '#billing'); st.view = q ? 'quotes' : 'invoices'; chrome(); draw(); });
    $('tocust').addEventListener('click', (e) => { e.preventDefault(); goCust(c.id); });
    const act = {
      edit: () => invoiceEditor({ id }),
      send: () => sendFlow(d, () => openInvoice(id)),
      remind: async () => { if (await U.ask('Send a reminder?', `Email ${c.email || 'the customer'} a reminder that ${i.number} has ${money(i.balance, i.currency)} due.`, 'Send reminder')) { try { await api('/admin/b/invoice/remind', { method: 'POST', body: { id } }); toast('Reminder sent'); openInvoice(id); } catch (e) { toast(e.message); } } },
      pay: () => paymentForm(d, () => openInvoice(id)),
      copy: async () => { try { await navigator.clipboard.writeText(payUrl(i)); toast('Link copied'); } catch (e) { prompt('Copy this link:', payUrl(i)); } },
      print: () => window.print(),
      dup: async () => { const r = await api('/admin/b/invoice/duplicate', { method: 'POST', body: { id } }); toast('Duplicated as a draft'); openInvoice(r.id); },
      convert: async () => { const r = await api('/admin/b/invoice/convert', { method: 'POST', body: { id } }); toast('Invoice created'); openInvoice(r.id); },
      void: async () => { if (await U.ask(`Void ${i.number}?`, 'It stays in your records but is no longer owed, and the customer can not pay it.', 'Void', true)) { try { await api('/admin/b/invoice/status', { method: 'POST', body: { id, action: 'void' } }); openInvoice(id); } catch (e) { toast(e.message); } } },
      reopen: async () => { await api('/admin/b/invoice/status', { method: 'POST', body: { id, action: 'reopen' } }); openInvoice(id); },
      delete: async () => { if (await U.ask(`Delete ${i.number}?`, 'This removes it for good.', 'Delete', true)) { try { await api('/admin/b/invoice/status', { method: 'POST', body: { id, action: 'delete' } }); toast('Deleted'); history.replaceState(null, '', '#billing'); st.view = q ? 'quotes' : 'invoices'; chrome(); draw(); } catch (e) { toast(e.message); } } },
      accept: async () => { await api('/admin/b/invoice/status', { method: 'POST', body: { id, action: 'accept' } }); openInvoice(id); },
      decline: async () => { await api('/admin/b/invoice/status', { method: 'POST', body: { id, action: 'decline' } }); openInvoice(id); },
    };
    el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => { try { await act[b.dataset.a](); } catch (e) { toast(e.message); } }));
    el.querySelectorAll('[data-delpay]').forEach((b) => b.addEventListener('click', async () => { if (await U.ask('Remove this payment record?', 'The invoice balance goes back up.', 'Remove', true)) { try { await api('/admin/b/payment/delete', { method: 'POST', body: { id: b.dataset.delpay } }); openInvoice(id); } catch (e) { toast(e.message); } } }));
    const ar = $('autorem'); if (ar) ar.addEventListener('change', () => api('/admin/b/invoice/auto-remind', { method: 'POST', body: { id, on: ar.checked } }).then(() => toast(ar.checked ? 'Automatic reminders on' : 'Automatic reminders off')));
  }

  async function sendFlow(d, done) {
    const i = d.invoice, c = d.customer;
    if (!c.email) { toast('This customer has no email address yet. Add one first.'); return window.ESCRM.form(c, () => openInvoice(i.id)); }
    const ok = await U.ask(`Send ${i.kind === 'quote' ? 'quote' : 'invoice'} ${i.number}?`, `It will be emailed to ${c.name} <${c.email}> for ${money(i.kind === 'quote' ? i.total : i.balance || i.total, i.currency)}, with a link to ${i.kind === 'quote' ? 'accept it' : 'view and pay it online'}. You get a copy.`, 'Send');
    if (!ok) return;
    const r = await api('/admin/b/invoice/send', { method: 'POST', body: { id: i.id } });
    toast(`Sent to ${r.to}`); done && done();
  }

  function paymentForm(d, done) {
    const i = d.invoice;
    const m = U.modal('Record a payment', `<form id="pform" class="cform"><div class="grid2">
      <label class="f"><span>Amount</span><input name="amount" inputmode="decimal" value="${esc(dollars(i.balance))}" required></label>
      <label class="f"><span>Date received</span><input name="date" type="date" value="${U.today()}"></label>
      <label class="f"><span>Method</span><select name="method">${METHODS.filter((x) => !['stripe', 'imported', 'stripe_refund'].includes(x[0])).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label class="f"><span>Reference (check number…)</span><input name="ref" maxlength="120"></label></div>
      <label class="f"><span>Note</span><input name="note" maxlength="400"></label>
      <p class="anote">Use a negative amount to record a refund. Card payments made through Stripe are recorded automatically.</p>
      <p class="form-err" role="alert"></p><div class="modal-actions"><button type="button" class="small-btn" data-cancel>Cancel</button><button class="small-btn primary" type="submit">Save payment</button></div></form>`);
    m.el.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.el.querySelector('#pform').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target).entries());
      const cents = toCents(f.amount); if (!cents) { m.el.querySelector('.form-err').textContent = 'Enter an amount.'; return; }
      try { const r = await api('/admin/b/payment/add', { method: 'POST', body: { invoice_id: i.id, amount_cents: cents, method: f.method, ref: f.ref, note: f.note, date: f.date } }); m.close(); toast(r.becamePaid ? 'Paid in full' : 'Payment recorded'); done && done(); } catch (x) { m.el.querySelector('.form-err').textContent = x.message; }
    });
  }

  /* ------------------------------------------------------------------ lines editor (invoices and repeating invoices) */
  function linesEditor(host, lines, opts) {
    opts = opts || {};
    const rows = lines.length ? lines.map((l) => ({ ...l })) : [{ description: '', qty: 1, unit_cents: 0, taxable: 0 }];
    const draw = () => {
      host.innerHTML = `<div class="tscroll"><table class="lines"><thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Price</th><th class="c">Tax</th><th class="n">Amount</th><th></th></tr></thead><tbody>${rows.map((l, k) => `<tr>
        <td><textarea data-k="${k}" data-f="description" rows="1" maxlength="600" placeholder="What is this for?">${esc(l.description)}</textarea></td>
        <td class="n"><input data-k="${k}" data-f="qty" inputmode="decimal" value="${esc(String(l.qty))}" class="qty"></td>
        <td class="n"><input data-k="${k}" data-f="unit" inputmode="decimal" value="${l.unit_cents ? esc(dollars(l.unit_cents)) : ''}" placeholder="0.00" class="price"></td>
        <td class="c"><input type="checkbox" data-k="${k}" data-f="taxable" ${l.taxable ? 'checked' : ''} aria-label="Taxable"></td>
        <td class="n amt">${esc(money(Math.round((Number(l.qty) || 0) * (l.unit_cents || 0))))}</td>
        <td><button type="button" class="x" data-del="${k}" aria-label="Remove line">×</button></td></tr>`).join('')}</tbody></table></div>
        <div class="row"><button type="button" class="small-btn" id="add-line">+ Add line</button>${opts.items && opts.items.length ? `<select id="add-item"><option value="">+ Add from your items…</option>${opts.items.filter((x) => x.active).map((x) => `<option value="${esc(x.id)}">${esc(x.name)} (${esc(money(x.unit_cents))})</option>`).join('')}</select>` : ''}</div>`;
      host.querySelectorAll('textarea').forEach((t) => { t.style.height = 'auto'; t.style.height = Math.max(34, t.scrollHeight) + 'px'; });
    };
    draw();
    host.addEventListener('input', (e) => {
      const t = e.target; const k = +t.dataset.k; if (isNaN(k)) return;
      const f = t.dataset.f; const l = rows[k];
      if (f === 'description') { l.description = t.value; t.style.height = 'auto'; t.style.height = Math.max(34, t.scrollHeight) + 'px'; }
      else if (f === 'qty') l.qty = t.value;
      else if (f === 'unit') l.unit_cents = toCents(t.value) || 0;
      else if (f === 'taxable') l.taxable = t.checked ? 1 : 0;
      const amt = t.closest('tr').querySelector('.amt'); if (amt) amt.textContent = money(Math.round((Number(l.qty) || 0) * (l.unit_cents || 0)));
      opts.onChange && opts.onChange();
    });
    host.addEventListener('click', (e) => {
      if (e.target.id === 'add-line') { rows.push({ description: '', qty: 1, unit_cents: 0, taxable: 0 }); draw(); opts.onChange && opts.onChange(); host.querySelectorAll('textarea')[rows.length - 1].focus(); }
      const del = e.target.closest('[data-del]'); if (del) { rows.splice(+del.dataset.del, 1); if (!rows.length) rows.push({ description: '', qty: 1, unit_cents: 0, taxable: 0 }); draw(); opts.onChange && opts.onChange(); }
    });
    host.addEventListener('change', (e) => {
      if (e.target.id === 'add-item' && e.target.value) {
        const it = opts.items.find((x) => x.id === e.target.value);
        const blank = rows.length === 1 && !rows[0].description && !rows[0].unit_cents;
        const row = { description: it.description ? `${it.name}\n${it.description}` : it.name, qty: 1, unit_cents: it.unit_cents, taxable: it.taxable };
        if (blank) rows[0] = row; else rows.push(row);
        draw(); opts.onChange && opts.onChange();
      }
    });
    return { get: () => rows.map((l) => ({ description: l.description.trim(), qty: Number(l.qty) || 0, unit_cents: l.unit_cents || 0, taxable: l.taxable ? 1 : 0 })).filter((l) => l.description || l.unit_cents) };
  }

  // The same arithmetic as the server (the server's numbers are the ones that count).
  const calc = (lines, o) => {
    const amount = (l) => Math.round((Number(l.qty) || 0) * (Number(l.unit_cents) || 0));
    const subtotal = lines.reduce((a, l) => a + amount(l), 0);
    const taxableSub = lines.filter((l) => l.taxable).reduce((a, l) => a + amount(l), 0);
    const v = Number(o.discount_value) || 0;
    let disc = o.discount_type === 'pct' ? Math.round(subtotal * Math.max(0, Math.min(100, v)) / 100) : Math.round(Math.max(0, v));
    disc = Math.max(0, Math.min(subtotal > 0 ? subtotal : 0, disc));
    const ratio = subtotal > 0 ? (subtotal - disc) / subtotal : 0;
    const tax = Math.round(taxableSub * ratio * Math.max(0, Math.min(100, Number(o.tax_rate) || 0)) / 100);
    return { subtotal, discount: disc, tax, total: Math.max(0, subtotal - disc + tax) };
  };

  /* ------------------------------------------------------------------ invoice / quote editor */
  async function invoiceEditor(init) {
    window.ESAdmin && window.ESAdmin.setTab('billing', true);
    const el = root();
    el.innerHTML = '<div class="aempty">Loading…</div>';
    const [{ customers }, { items }, s] = await Promise.all([api('/admin/b/customers'), api('/admin/b/items'), loadSettings()]);
    let cur = { kind: init.kind || 'invoice', customer_id: init.customer_id || '', lines: [], discount_type: 'pct', discount_value: 0, tax_rate: Number(s.tax_rate) || 0, notes: s.notes, terms: s.terms, issue_date: U.today(), due_date: '', currency: s.currency };
    let existing = null;
    if (init.id) {
      const d = await api('/admin/b/invoice?id=' + encodeURIComponent(init.id)); existing = d.invoice;
      cur = { ...d.invoice, lines: d.lines, discount_value: d.invoice.discount_type === 'pct' ? d.invoice.discount_value : d.invoice.discount_value / 100 };
    }
    const q = cur.kind === 'quote';
    const custOpt = (id) => `<option value="">Choose a customer…</option>${customers.map((c) => `<option value="${esc(c.id)}"${c.id === id ? ' selected' : ''}>${esc(c.org ? c.org + (c.name && c.name !== c.org ? ' — ' + c.name : '') : c.name)}</option>`).join('')}<option value="__new">+ New customer…</option>`;
    el.innerHTML = `<div class="pagehead"><button class="small-btn" id="cancel">← Cancel</button><div class="titleblock"><h2>${existing ? 'Edit' : 'New'} ${q ? 'quote' : 'invoice'}${existing ? ' ' + esc(existing.number) : ''}</h2></div></div>
      <form id="ie" class="editor">
        <section class="acard"><div class="grid3">
          <label class="f"><span>Customer</span><select name="customer_id" id="ie-cust">${custOpt(cur.customer_id)}</select></label>
          <label class="f"><span>${q ? 'Quote' : 'Invoice'} date</span><input type="date" name="issue_date" id="ie-issue" value="${esc(cur.issue_date)}"></label>
          <label class="f"><span>${q ? 'Valid until' : 'Due date'}</span><input type="date" name="due_date" id="ie-due" value="${esc(cur.due_date)}"></label></div>
          ${q ? '' : '<div class="chips quickdue"><span class="subtle">Due in</span>' + [0, 7, 15, 30, 45, 60].map((n) => `<button type="button" class="chip" data-net="${n}">${n === 0 ? 'On receipt' : n + ' days'}</button>`).join('') + '</div>'}</section>
        <section class="acard"><h3>Items</h3><div id="ie-lines"></div></section>
        <div class="grid2"><section class="acard"><div class="grid2">
            <label class="f"><span>Discount</span><div class="inline"><input name="discount_value" id="ie-dv" inputmode="decimal" value="${cur.discount_value ? esc(String(cur.discount_value)) : ''}" placeholder="0"><select name="discount_type" id="ie-dt"><option value="pct"${cur.discount_type === 'pct' ? ' selected' : ''}>%</option><option value="amt"${cur.discount_type === 'amt' ? ' selected' : ''}>$</option></select></div></label>
            <label class="f"><span>Tax rate (%) on taxable items</span><input name="tax_rate" id="ie-tax" inputmode="decimal" value="${esc(String(cur.tax_rate || 0))}"></label></div>
            <label class="f"><span>Message to the customer (shown on the ${q ? 'quote' : 'invoice'})</span><textarea name="notes" rows="3" maxlength="1500">${esc(cur.notes || '')}</textarea></label>
            <label class="f"><span>Terms</span><textarea name="terms" rows="2" maxlength="1500">${esc(cur.terms || '')}</textarea></label></section>
          <section class="acard totalsbox"><h3>Summary</h3><div id="ie-totals"></div></section></div>
        <p class="form-err" id="ie-err" role="alert"></p>
        <div class="row sticky"><button type="submit" class="small-btn" data-mode="save">Save${existing ? '' : ' as draft'}</button><button type="submit" class="small-btn primary" data-mode="send">${existing && existing.status !== 'draft' ? 'Save and resend' : 'Save and send'}</button></div></form>`;
    const lines = linesEditor($('ie-lines'), cur.lines, { items, onChange: totals });
    function totals() {
      const t = calc(lines.get(), { discount_type: $('ie-dt').value, discount_value: $('ie-dt').value === 'pct' ? Number($('ie-dv').value) : toCents($('ie-dv').value) || 0, tax_rate: $('ie-tax').value });
      $('ie-totals').innerHTML = `<div class="line"><span>Subtotal</span><span>${esc(money(t.subtotal))}</span></div>${t.discount ? `<div class="line"><span>Discount</span><span>−${esc(money(t.discount))}</span></div>` : ''}${t.tax ? `<div class="line"><span>Tax</span><span>${esc(money(t.tax))}</span></div>` : ''}<div class="line big"><span>Total</span><span>${esc(money(t.total))}</span></div>`;
    }
    ['ie-dv', 'ie-dt', 'ie-tax'].forEach((id) => $(id).addEventListener('input', totals));
    $('ie-dt').addEventListener('change', totals);
    totals();
    const setDue = (n) => { $('ie-due').value = U.addDays($('ie-issue').value || U.today(), n); };
    el.querySelectorAll('[data-net]').forEach((b) => b.addEventListener('click', () => setDue(+b.dataset.net)));
    const customerById = (id) => customers.find((c) => c.id === id);
    const applyCustomer = (id) => {
      const c = customerById(id); if (!c || existing) return;
      if (!$('ie-due').value || !$('ie-due').dataset.touched) setDue(c.terms_days != null ? c.terms_days : (q ? Number(s.quote_days) : Number(s.terms_days)));
      $('ie-tax').value = c.tax_exempt ? 0 : (Number(s.tax_rate) || 0); totals();
    };
    $('ie-due').addEventListener('input', () => { $('ie-due').dataset.touched = '1'; });
    $('ie-cust').addEventListener('change', (e) => {
      if (e.target.value === '__new') { e.target.value = ''; window.ESCRM.form(null, async (newId) => { const r = await api('/admin/b/customers'); customers.splice(0, customers.length, ...r.customers); $('ie-cust').innerHTML = custOpt(newId); applyCustomer(newId); }); return; }
      applyCustomer(e.target.value);
    });
    if (!existing) { if (cur.customer_id) applyCustomer(cur.customer_id); else setDue(q ? Number(s.quote_days) : Number(s.terms_days)); }
    $('cancel').addEventListener('click', () => { if (existing) openInvoice(existing.id); else if (init.customer_id) goCust(init.customer_id); else { chrome(); draw(); } });
    let mode = 'save';
    el.querySelectorAll('button[type=submit]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; }));
    $('ie').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target).entries());
      $('ie-err').textContent = '';
      if (!f.customer_id) { $('ie-err').textContent = 'Choose a customer.'; return; }
      const body = { id: existing && existing.id, kind: cur.kind, customer_id: f.customer_id, issue_date: f.issue_date, due_date: f.due_date, lines: lines.get(), discount_type: f.discount_type,
        discount_value: f.discount_type === 'pct' ? Number(f.discount_value) || 0 : toCents(f.discount_value) || 0, tax_rate: Number(f.tax_rate) || 0, notes: f.notes, terms: f.terms, currency: cur.currency, send: mode === 'send' };
      el.querySelectorAll('button[type=submit]').forEach((b) => { b.disabled = true; });
      try {
        const r = await api('/admin/b/invoice/save', { method: 'POST', body });
        if (r.sendError) toast('Saved, but it was not sent: ' + r.sendError); else toast(r.sent ? 'Saved and sent' : 'Saved');
        openInvoice(r.id);
      } catch (x) { $('ie-err').textContent = x.message; el.querySelectorAll('button[type=submit]').forEach((b) => { b.disabled = false; }); }
    });
  }

  /* ------------------------------------------------------------------ repeating invoices */
  VIEW.recurring = async (el) => {
    const { recurring } = await api('/admin/b/recurring');
    el.innerHTML = `<div class="toolbar"><span class="subtle">Invoices that are created on a schedule, for retainers, hosting and memberships.</span><span class="grow"></span><button class="small-btn primary" id="r-new">+ New repeating invoice</button></div>` +
      table(['Customer', 'What', 'Every', '>Amount', 'Next', ''], recurring.map((r) => `<tr><td><strong>${esc(who(r))}</strong></td><td>${esc(r.title || r.lines[0]?.description || '')}</td><td>${esc(r.frequency)}</td><td class="n">${esc(money(r.amount))}</td><td>${r.active ? esc(fmtDate(r.next_date)) : '<span class="subtle">paused</span>'}${r.end_date ? `<div class="subtle">ends ${esc(fmtDate(r.end_date))}</div>` : ''}</td>
        <td class="n"><button class="small-btn" data-edit="${esc(r.id)}">Edit</button> <button class="small-btn" data-run="${esc(r.id)}" title="Create the next invoice now">Run now</button></td></tr>`));
    $('r-new').addEventListener('click', () => recurringForm(null));
    el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => recurringForm(recurring.find((r) => r.id === b.dataset.edit))));
    el.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', async () => { if (await U.ask('Create an invoice now?', 'A draft invoice is created from this schedule, and the schedule moves on to its next date.', 'Create')) { try { const r = await api('/admin/b/recurring/run', { method: 'POST', body: { id: b.dataset.run } }); toast('Draft invoice created'); openInvoice(r.id); } catch (e) { toast(e.message); } } }));
  };

  async function recurringForm(r, pre) {
    const [{ customers }, { items }, s] = await Promise.all([api('/admin/b/customers'), api('/admin/b/items'), loadSettings()]);
    r = r || { customer_id: (pre && pre.customer_id) || '', frequency: 'monthly', next_date: U.today(), auto_send: 1, active: 1, lines: [], tax_rate: Number(s.tax_rate) || 0, discount_type: 'pct', discount_value: 0, terms_days: Number(s.terms_days) || 30, notes: s.notes, terms: s.terms };
    const m = U.modal(r.id ? 'Edit repeating invoice' : 'New repeating invoice', `<form id="rform" class="cform">
      <div class="grid2"><label class="f"><span>Customer</span><select name="customer_id"><option value="">Choose…</option>${customers.map((c) => `<option value="${esc(c.id)}"${c.id === r.customer_id ? ' selected' : ''}>${esc(c.org || c.name)}</option>`).join('')}</select></label>
        <label class="f"><span>Label (for you)</span><input name="title" value="${esc(r.title || '')}" maxlength="160" placeholder="e.g. Monthly hosting"></label>
        <label class="f"><span>Repeats</span><select name="frequency">${['weekly', 'monthly', 'quarterly', 'yearly'].map((x) => `<option value="${x}"${r.frequency === x ? ' selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select></label>
        <label class="f"><span>Next invoice on</span><input type="date" name="next_date" value="${esc(r.next_date)}" required></label>
        <label class="f"><span>Stop after (optional)</span><input type="date" name="end_date" value="${esc(r.end_date || '')}"></label>
        <label class="f"><span>Due after (days)</span><input name="terms_days" type="number" min="0" max="365" value="${esc(String(r.terms_days ?? 30))}"></label></div>
      <div id="r-lines"></div>
      <div class="grid2"><label class="f"><span>Discount %</span><input name="discount_value" inputmode="decimal" value="${r.discount_type === 'pct' && r.discount_value ? esc(String(r.discount_value)) : ''}"></label><label class="f"><span>Tax rate %</span><input name="tax_rate" inputmode="decimal" value="${esc(String(r.tax_rate || 0))}"></label></div>
      <label class="f"><span>Message on each invoice</span><textarea name="notes" rows="2" maxlength="1500">${esc(r.notes || '')}</textarea></label>
      <label class="check pad"><input type="checkbox" name="auto_send" ${r.auto_send ? 'checked' : ''}> Email each invoice to the customer automatically (otherwise it is created as a draft)</label>
      <label class="check pad"><input type="checkbox" name="active" ${r.active ? 'checked' : ''}> Active</label>
      <p class="form-err" role="alert"></p><div class="modal-actions">${r.id ? '<button type="button" class="small-btn danger" data-del>Delete</button>' : ''}<span class="grow"></span><button type="button" class="small-btn" data-cancel>Cancel</button><button class="small-btn primary" type="submit">Save</button></div></form>`, { wide: true });
    const le = linesEditor(m.el.querySelector('#r-lines'), r.lines || [], { items });
    m.el.querySelector('[data-cancel]').addEventListener('click', m.close);
    const del = m.el.querySelector('[data-del]'); if (del) del.addEventListener('click', async () => { if (await U.ask('Delete this schedule?', 'Invoices already created are kept.', 'Delete', true)) { await api('/admin/b/recurring/delete', { method: 'POST', body: { id: r.id } }); m.close(); chrome(); st.view = 'recurring'; chrome(); draw(); } });
    m.el.querySelector('#rform').addEventListener('submit', async (e) => {
      e.preventDefault(); const fd = new FormData(e.target); const f = Object.fromEntries(fd.entries());
      try {
        await api('/admin/b/recurring/save', { method: 'POST', body: { id: r.id, customer_id: f.customer_id, title: f.title, frequency: f.frequency, next_date: f.next_date, end_date: f.end_date, terms_days: f.terms_days, lines: le.get(), discount_type: 'pct', discount_value: Number(f.discount_value) || 0, tax_rate: Number(f.tax_rate) || 0, notes: f.notes, terms: r.terms, auto_send: !!fd.get('auto_send'), active: !!fd.get('active') } });
        m.close(); toast('Saved'); st.view = 'recurring'; window.ESAdmin && window.ESAdmin.setTab('billing', true); chrome(); draw();
      } catch (x) { m.el.querySelector('.form-err').textContent = x.message; }
    });
  }

  /* ------------------------------------------------------------------ payments */
  VIEW.payments = async (el) => {
    const q = st.pay;
    el.innerHTML = `<div class="toolbar"><input type="search" id="p-q" placeholder="Search customer or invoice…" value="${esc(q.q)}"><input type="date" id="p-from" value="${esc(q.from)}" aria-label="From"><span class="subtle">to</span><input type="date" id="p-to" value="${esc(q.to)}" aria-label="To">
      <select id="p-m"><option value="">All methods</option>${METHODS.map(([k, l]) => `<option value="${k}"${q.method === k ? ' selected' : ''}>${l}</option>`).join('')}</select><span class="grow"></span><button class="small-btn" id="p-export">Export CSV</button></div><div id="p-body"></div>`;
    const fetchIt = async () => {
      q.q = $('p-q').value.trim(); q.from = $('p-from').value; q.to = $('p-to').value; q.method = $('p-m').value;
      const d = await api('/admin/b/payments?' + new URLSearchParams(q));
      $('p-body').innerHTML = table(['Date', 'Customer', 'Invoice', 'Method', 'Reference', '>Amount'], d.payments.map((p) => `<tr data-inv="${esc(p.invoice_id)}"><td>${esc(U.fmtDay(p.received_at))}</td><td>${esc(who(p))}</td><td>${esc(p.invoice_number || '')}</td><td>${esc(methodName(p.method))}</td><td>${esc(p.ref || '')}</td><td class="n">${esc(money(p.amount_cents))}</td></tr>`), true) + `<p class="anote">${d.summary.n} payment${d.summary.n === 1 ? '' : 's'} · ${esc(money(d.summary.s))} net</p>`;
      $('p-body').querySelectorAll('tr[data-inv]').forEach((r) => r.addEventListener('click', () => go(r.dataset.inv)));
    };
    const d = U.debounce(fetchIt, 250);
    ['p-q', 'p-from', 'p-to', 'p-m'].forEach((id) => $(id).addEventListener(id === 'p-q' ? 'input' : 'change', d));
    $('p-export').addEventListener('click', () => exportCsv('payments', $('p-from').value, $('p-to').value));
    await fetchIt();
  };

  /* ------------------------------------------------------------------ items */
  VIEW.items = async (el) => {
    const { items } = await api('/admin/b/items');
    el.innerHTML = `<div class="toolbar"><span class="subtle">Things you sell often. Pick them when writing an invoice instead of typing them again.</span><span class="grow"></span><button class="small-btn primary" id="i-new">+ New item</button></div>` +
      table(['Item', 'Description', '>Price', 'Tax', ''], items.map((x) => `<tr class="${x.active ? '' : 'dim'}"><td><strong>${esc(x.name)}</strong></td><td class="subtle">${esc(x.description)}</td><td class="n">${esc(money(x.unit_cents))}</td><td>${x.taxable ? 'Taxable' : '—'}</td><td class="n"><button class="small-btn" data-edit="${esc(x.id)}">Edit</button></td></tr>`));
    const form = (x) => {
      x = x || { name: '', description: '', unit_cents: 0, taxable: 0, active: 1 };
      const m = U.modal(x.id ? 'Edit item' : 'New item', `<form class="cform"><label class="f"><span>Name</span><input name="name" value="${esc(x.name)}" maxlength="160" required></label><label class="f"><span>Description</span><textarea name="description" rows="2" maxlength="500">${esc(x.description)}</textarea></label>
        <div class="grid2"><label class="f"><span>Price</span><input name="price" inputmode="decimal" value="${esc(dollars(x.unit_cents))}"></label><label class="check pad"><input type="checkbox" name="taxable" ${x.taxable ? 'checked' : ''}> Taxable</label></div>
        <label class="check pad"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}> Show in the list when writing invoices</label><p class="form-err"></p>
        <div class="modal-actions">${x.id ? '<button type="button" class="small-btn danger" data-del>Delete</button>' : ''}<span class="grow"></span><button type="button" class="small-btn" data-cancel>Cancel</button><button class="small-btn primary" type="submit">Save</button></div></form>`);
      m.el.querySelector('[data-cancel]').addEventListener('click', m.close);
      const del = m.el.querySelector('[data-del]'); if (del) del.addEventListener('click', async () => { await api('/admin/b/item/delete', { method: 'POST', body: { id: x.id } }); m.close(); draw(); });
      m.el.querySelector('form').addEventListener('submit', async (e) => { e.preventDefault(); const fd = new FormData(e.target); try { await api('/admin/b/item/save', { method: 'POST', body: { id: x.id, name: fd.get('name'), description: fd.get('description'), unit_cents: toCents(fd.get('price')) || 0, taxable: !!fd.get('taxable'), active: !!fd.get('active') } }); m.close(); draw(); } catch (err) { m.el.querySelector('.form-err').textContent = err.message; } });
    };
    $('i-new').addEventListener('click', () => form());
    el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => form(items.find((x) => x.id === b.dataset.edit))));
  };

  /* ------------------------------------------------------------------ reports */
  VIEW.reports = async (el) => {
    const q = st.rep;
    const d = await api('/admin/b/reports?' + new URLSearchParams(q));
    el.innerHTML = `<div class="toolbar"><label class="subtle">From <input type="date" id="rp-from" value="${esc(d.from)}"></label><label class="subtle">To <input type="date" id="rp-to" value="${esc(d.to)}"></label><button class="small-btn" id="rp-go">Update</button><span class="grow"></span><button class="small-btn" id="rp-ex1">Invoices CSV</button><button class="small-btn" id="rp-ex2">Payments CSV</button><button class="small-btn" id="rp-ex3">Customers CSV</button></div>
      <div class="kpis">${kpi('Invoiced', esc(money(d.invoiced.s)), `${d.invoiced.n} invoice${d.invoiced.n === 1 ? '' : 's'}`)}${kpi('Received', esc(money(d.byMonth.reduce((a, m) => a + m.received, 0))), '', 'good')}${kpi('Refunded', esc(money(d.byMonth.reduce((a, m) => a + m.refunded, 0))))}${kpi('Net income', esc(money(d.byMonth.reduce((a, m) => a + m.net, 0))))}${kpi('Tax charged', esc(money(d.tax)), 'on invoices issued in this period')}</div>
      <div class="grid2">${card('By month', table(['Month', '>Received', '>Refunded', '>Net'], d.byMonth.map((m) => `<tr><td>${esc(new Date(m.m + '-15').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))}</td><td class="n">${esc(money(m.received))}</td><td class="n">${m.refunded ? esc(money(m.refunded)) : '—'}</td><td class="n"><strong>${esc(money(m.net))}</strong></td></tr>`)))}
        ${card('By payment method', bars(d.byMethod, (r) => methodName(r.method), (r) => r.s, (v) => money(v)))}</div>
      ${card('Top customers', table(['Customer', '>Invoices paid', '>Received'], d.byCustomer.map((c) => `<tr data-cust="${esc(c.id)}"><td><strong>${esc(c.org || c.name)}</strong></td><td class="n">${c.n}</td><td class="n">${esc(money(c.s))}</td></tr>`), true), 'wide')}`;
    $('rp-go').addEventListener('click', () => { q.from = $('rp-from').value; q.to = $('rp-to').value; draw(); });
    const r = () => [$('rp-from').value, $('rp-to').value];
    $('rp-ex1').addEventListener('click', () => exportCsv('invoices', ...r())); $('rp-ex2').addEventListener('click', () => exportCsv('payments', ...r())); $('rp-ex3').addEventListener('click', () => exportCsv('customers'));
    el.querySelectorAll('[data-cust]').forEach((t) => t.addEventListener('click', () => goCust(t.dataset.cust)));
  };

  /* ------------------------------------------------------------------ import (Wix or any CSV) */
  const FIELDS = {
    customers: [
      ['name', 'Full name', ['name', 'full name', 'contact name', 'customer', 'customer name', 'client']], ['first_name', 'First name', ['first name', 'firstname', 'first']], ['last_name', 'Last name', ['last name', 'lastname', 'last', 'surname']],
      ['org', 'Organization', ['company', 'organization', 'organisation', 'business', 'org']], ['email', 'Email', ['email', 'email 1', 'e-mail', 'email address']], ['phone', 'Phone', ['phone', 'phone 1', 'mobile', 'telephone', 'phone number']],
      ['addr1', 'Address', ['address', 'address 1', 'street', 'address 1 street', 'address line 1', 'address 1 - street']], ['addr2', 'Address line 2', ['address 2', 'address line 2', 'apt', 'suite']], ['city', 'City', ['city', 'address 1 city', 'address 1 - city']],
      ['state', 'State', ['state', 'region', 'province', 'address 1 state', 'address 1 - state']], ['zip', 'ZIP', ['zip', 'zip code', 'postal code', 'postcode', 'address 1 zip', 'address 1 - zip']], ['country', 'Country', ['country', 'address 1 country', 'address 1 - country']],
      ['tags', 'Tags', ['labels', 'tags', 'label', 'groups']], ['notes', 'Notes', ['notes', 'note', 'comments']], ['status', 'Status', ['status']], ['ext_id', 'ID in the old system', ['id', 'contact id', 'customer id']],
    ],
    invoices: [
      ['number', 'Invoice number', ['invoice number', 'invoice #', 'invoice no', 'number', 'invoice id', 'no', '#']], ['customer_name', 'Customer name', ['customer', 'customer name', 'contact', 'contact name', 'client', 'name', 'bill to', 'recipient']], ['customer_email', 'Customer email', ['email', 'customer email', 'contact email', 'email 1', 'recipient email']],
      ['issue_date', 'Invoice date', ['invoice date', 'issue date', 'date', 'created', 'date created', 'created date']], ['due_date', 'Due date', ['due date', 'due', 'payment due']], ['status', 'Status', ['status', 'payment status', 'invoice status']],
      ['total', 'Total', ['total', 'amount', 'invoice total', 'grand total', 'total amount']], ['paid', 'Amount paid', ['paid', 'amount paid', 'paid amount', 'payments']], ['paid_date', 'Date paid', ['paid date', 'date paid', 'payment date']],
      ['tax', 'Tax', ['tax', 'tax amount', 'taxes']], ['discount', 'Discount', ['discount', 'discount amount']], ['description', 'Item / description', ['description', 'item', 'item name', 'line item', 'product', 'service', 'details']],
      ['qty', 'Quantity', ['quantity', 'qty']], ['unit_price', 'Unit price', ['price', 'unit price', 'rate', 'item price', 'unit cost']], ['currency', 'Currency', ['currency']], ['notes', 'Notes', ['notes', 'note', 'memo', 'message']], ['payment_method', 'Payment method', ['payment method', 'method']], ['type', 'Type (invoice or quote)', ['type', 'document type']],
    ],
  };
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
  const guess = (kind, header) => {
    const h = header.map(norm); const used = new Set(); const map = {};
    // exact matches first, so "First Name" is not swallowed by a looser "name" rule
    FIELDS[kind].forEach(([k, , syn]) => { const idx = h.findIndex((x, i) => !used.has(i) && syn.includes(x)); if (idx >= 0) { map[k] = idx; used.add(idx); } });
    FIELDS[kind].forEach(([k, , syn]) => {
      if (map[k] != null) return;
      const idx = h.findIndex((x, i) => !used.has(i) && x && syn.some((sy) => sy.length > 4 && (x.includes(sy) || sy.includes(x))));
      if (idx >= 0) { map[k] = idx; used.add(idx); }
    });
    return map;
  };

  VIEW.import = async (el, kind) => {
    kind = kind || 'invoices';
    el.innerHTML = `<div class="acard"><h3>Import from Wix or any spreadsheet</h3>
      <p class="anote">Bring over your customers and past invoices. In Wix, export your contacts and your invoices to CSV files, then upload them here. Import customers first, then invoices. Nothing is sent to anyone, and re-importing is safe: customers and invoice numbers that already exist are skipped.</p>
      <div class="chips" id="im-kind"><button class="chip${kind === 'customers' ? ' on' : ''}" data-k="customers">1. Customers</button><button class="chip${kind === 'invoices' ? ' on' : ''}" data-k="invoices">2. Invoices</button></div>
      <div class="drop" id="im-drop"><input type="file" id="im-file" accept=".csv,.txt,text/csv"><p><strong>Choose a CSV file</strong> or drop it here</p></div><div id="im-work"></div></div>`;
    $('im-kind').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) VIEW.import(el, b.dataset.k); });
    const drop = $('im-drop');
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
    $('im-file').addEventListener('change', (e) => { if (e.target.files[0]) readFile(e.target.files[0]); });
    function readFile(file) {
      const fr = new FileReader();
      fr.onload = () => { const rows = U.csvParse(fr.result); if (rows.length < 2) { $('im-work').innerHTML = '<div class="notice bad">That file looks empty, or it is not a CSV.</div>'; return; } mapStep(file.name, rows); };
      fr.readAsText(file);
    }
    function mapStep(name, rows) {
      const header = rows[0].map((h) => h.trim()); const data = rows.slice(1);
      const map = guess(kind, header);
      const opt = (sel) => `<option value="">— not in my file —</option>${header.map((h, i) => `<option value="${i}"${sel === i ? ' selected' : ''}>${esc(h || '(column ' + (i + 1) + ')')}</option>`).join('')}`;
      $('im-work').innerHTML = `<h4>${esc(name)} · ${data.length} row${data.length === 1 ? '' : 's'}</h4>
        <p class="anote">We matched the columns automatically. Check each one and fix anything that is wrong.</p>
        <div class="mapgrid">${FIELDS[kind].map(([k, label]) => `<label class="f"><span>${esc(label)}</span><select data-f="${k}">${opt(map[k] == null ? -1 : map[k])}</select></label>`).join('')}</div>
        ${kind === 'invoices' ? '<p class="anote">If your file has one row per line item, rows with the same invoice number are combined into one invoice. If it only has one row per invoice with a total, we create a single line for it. Statuses containing "paid" are recorded as paid, "void" or "cancel" as void, and everything else as unpaid.</p>' : ''}
        <div id="im-prev"></div>
        <div class="row"><button class="small-btn" id="im-check">Check the file</button><button class="small-btn primary" id="im-go">Import</button></div><div id="im-result"></div>`;
      const build = () => {
        const m = {}; $('im-work').querySelectorAll('select[data-f]').forEach((s) => { if (s.value !== '') m[s.dataset.f] = +s.value; });
        return data.map((r) => { const o = {}; Object.keys(m).forEach((k) => { o[k] = (r[m[k]] || '').trim(); }); return o; }).filter((o) => Object.values(o).some(Boolean));
      };
      const preview = () => { const o = build().slice(0, 4); $('im-prev').innerHTML = o.length ? `<div class="tscroll"><table class="atable"><thead><tr>${Object.keys(o[0]).map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${o.map((r) => `<tr>${Object.values(r).map((v) => `<td>${esc(String(v).slice(0, 40))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''; };
      $('im-work').querySelectorAll('select[data-f]').forEach((s) => s.addEventListener('change', () => { preview(); })); preview();
      const run = async (dry) => {
        const rows2 = build(); const res = { created: 0, updated: 0, skipped: 0, customersCreated: 0, payments: 0, errors: [] };
        $('im-check').disabled = $('im-go').disabled = true;
        for (let i = 0; i < rows2.length; i += 100) {
          // keep rows of one invoice together when splitting into batches
          let end = Math.min(rows2.length, i + 100);
          if (kind === 'invoices') while (end < rows2.length && rows2[end].number && rows2[end].number === rows2[end - 1].number) end++;
          const chunk = rows2.slice(i, end); i = end - 100;
          $('im-result').innerHTML = `<div class="notice">${dry ? 'Checking' : 'Importing'}… ${Math.min(end, rows2.length)} of ${rows2.length}</div>`;
          const r = await api(`/admin/b/import/${kind}`, { method: 'POST', body: { rows: chunk, dry, mode: 'skip', source: 'Wix' } });
          ['created', 'updated', 'skipped', 'customersCreated', 'payments'].forEach((k) => { res[k] += r[k] || 0; });
          (r.errors || []).forEach((x) => res.errors.push({ row: x.row, error: x.error }));
          if (end >= rows2.length) break;
        }
        $('im-check').disabled = false;
        const txt = kind === 'customers' ? `${res.created} new customer${res.created === 1 ? '' : 's'}, ${res.skipped} already there` : `${res.created} invoice${res.created === 1 ? '' : 's'}${res.customersCreated ? `, ${res.customersCreated} new customer${res.customersCreated === 1 ? '' : 's'}` : ''}${res.payments ? `, ${res.payments} payment${res.payments === 1 ? '' : 's'}` : ''}, ${res.skipped} already there`;
        $('im-result').innerHTML = `<div class="notice ${res.errors.length && !res.created ? 'bad' : 'good'}">${dry ? 'This file would add' : 'Imported'}: ${esc(txt)}.${res.errors.length ? ` ${res.errors.length} row${res.errors.length === 1 ? '' : 's'} had problems.` : ''}</div>` +
          (res.errors.length ? `<details class="errs"><summary>See the problems</summary><ul class="plainlist">${res.errors.slice(0, 100).map((x) => `<li>Row ${x.row}: ${esc(x.error)}</li>`).join('')}</ul></details>` : '') + (dry ? '' : `<p><button class="small-btn primary" id="im-done">${kind === 'customers' ? 'View customers' : 'View invoices'}</button></p>`);
        $('im-go').disabled = false;
        if (!dry) { const dn = $('im-done'); if (dn) dn.addEventListener('click', () => { if (kind === 'customers') { window.ESAdmin.setTab('customers'); } else { st.view = 'invoices'; chrome(); draw(); } }); }
      };
      $('im-check').addEventListener('click', () => run(true).catch((e) => { $('im-check').disabled = false; $('im-result').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }));
      $('im-go').addEventListener('click', () => run(false).catch((e) => { $('im-check').disabled = false; $('im-result').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }));
    }
  };

  /* ------------------------------------------------------------------ settings */
  VIEW.settings = async (el) => {
    const s = await loadSettings(true);
    const f = (k, label, type, hint, attrs) => `<label class="f"><span>${label}</span><input name="${k}" type="${type || 'text'}" value="${esc(s[k])}" ${attrs || ''}>${hint ? `<small>${hint}</small>` : ''}</label>`;
    el.innerHTML = `<form id="sform"><div class="grid2">
      ${card('Your business (shown on every invoice)', `${f('biz_name', 'Business name', 'text', '', 'maxlength="120"')}<label class="f"><span>Address</span><textarea name="biz_address" rows="3" maxlength="400">${esc(s.biz_address)}</textarea></label><div class="grid2">${f('biz_email', 'Email', 'email', 'Replies to invoices go here')}${f('biz_phone', 'Phone')}</div>${f('biz_taxid', 'Tax ID / EIN (optional)')}<label class="f"><span>Logo address</span><input name="logo_url" type="url" value="${esc(/\/assets\/logo\.png$/.test(s.logo_url) ? '' : s.logo_url)}" placeholder="Empty = the website logo"><small>A web address starting with https://</small></label>`)}
      ${card('Numbering and defaults', `<div class="grid2">${f('invoice_prefix', 'Invoice number prefix')}${f('next_invoice', 'Next invoice number', 'number', '', 'min="1"')}${f('quote_prefix', 'Quote number prefix')}${f('next_quote', 'Next quote number', 'number', '', 'min="1"')}${f('terms_days', 'Payment due after (days)', 'number', '', 'min="0"')}${f('tax_rate', 'Default tax rate (%)', 'text')}</div>
        <label class="f"><span>Default message on invoices</span><textarea name="notes" rows="2" maxlength="1500">${esc(s.notes)}</textarea></label><label class="f"><span>Default terms</span><textarea name="terms" rows="2" maxlength="1500">${esc(s.terms)}</textarea></label>
        <label class="check pad"><input type="checkbox" name="reminders" ${s.reminders === '1' ? 'checked' : ''}> Send automatic payment reminders (3 days before the due date, on the day, then 7, 14 and 30 days late)</label>`)}</div>
      <div class="row"><button class="small-btn primary" type="submit">Save settings</button><span id="s-msg" class="subtle"></span></div></form>
      ${card('Online payments (Stripe)', '<div id="stripe-box"><div class="subtle">Checking…</div></div>', 'wide')}
      ${card('Start over', `<p class="anote">Deletes every customer, invoice, quote and payment. Use it if you imported the wrong file. This can not be undone.</p><button class="small-btn danger" id="wipe">Delete all customers and billing data</button>`, 'wide')}`;
    $('sform').addEventListener('submit', async (e) => {
      e.preventDefault(); const fd = new FormData(e.target); const body = Object.fromEntries(fd.entries()); body.reminders = !!fd.get('reminders');
      try { settings = (await api('/admin/b/settings', { method: 'POST', body })).settings; $('s-msg').textContent = 'Saved'; toast('Settings saved'); } catch (x) { $('s-msg').textContent = x.message; toast(x.message); }
    });
    $('wipe').addEventListener('click', () => {
      const m = U.modal('Delete everything?', `<p class="modal-text">This permanently deletes all customers, invoices, quotes, payments and notes. Type <strong>DELETE EVERYTHING</strong> to confirm.</p><input id="wipe-t" autocomplete="off"><div class="modal-actions"><button class="small-btn" data-no>Cancel</button><button class="small-btn danger solid" id="wipe-go">Delete everything</button></div>`);
      m.el.querySelector('[data-no]').addEventListener('click', m.close);
      m.el.querySelector('#wipe-go').addEventListener('click', async () => { try { await api('/admin/b/wipe', { method: 'POST', body: { confirm: m.el.querySelector('#wipe-t').value } }); m.close(); settings = null; toast('Everything was deleted'); draw(); } catch (x) { toast(x.message); } });
    });
    const hook = `${api.base}/stripe/webhook`;
    const box = $('stripe-box');
    const s2 = await api('/admin/b/stripe').catch(() => ({ key: false }));
    const step = (n, t) => `<li>${t}</li>`;
    box.innerHTML = `${s2.key ? `<div class="notice ${s2.error ? 'bad' : 'good'}">${s2.error ? 'Stripe says: ' + esc(s2.error) : `Connected to Stripe${s2.account ? ': <strong>' + esc(s2.account) + '</strong>' : ''} in <strong>${esc(s2.mode)} mode</strong>${s2.mode === 'test' ? ' (test cards only, no real money)' : ''}.${s2.charges_enabled === false ? ' This Stripe account can not take payments yet; finish setting it up in Stripe.' : ''}`}</div>` : '<div class="notice">Not connected yet. Customers can still see their invoices, but they can not pay online.</div>'}
      ${s2.key && !s2.webhook_secret ? '<div class="notice bad">The webhook secret is missing, so payments will not be recorded automatically. See step 3 below.</div>' : ''}
      <ol class="steps2">
        <li><strong>Create your Stripe account</strong> at stripe.com and finish the business details. Use the "Test mode" switch while you try it out.</li>
        <li><strong>Add the secret key.</strong> In Stripe, go to Developers → API keys and copy the <em>Secret key</em> (or make a Restricted key that can write Checkout Sessions and read the Account). Then in Cloudflare: Workers &amp; Pages → <em>everythingshul-chat</em> → Settings → Variables and Secrets → Add → type <em>Secret</em>, name <code>STRIPE_SECRET_KEY</code>.</li>
        <li><strong>Tell Stripe where to report payments.</strong> In Stripe go to Developers → Webhooks → Add endpoint. Endpoint URL: <code class="copy" id="hook">${esc(hook)}</code> <button type="button" class="small-btn" id="copy-hook">Copy</button><br>Select these events: <code>checkout.session.completed</code>, <code>checkout.session.async_payment_succeeded</code>, <code>checkout.session.async_payment_failed</code>, <code>charge.refunded</code>. Save, then reveal the <em>Signing secret</em> (starts with <code>whsec_</code>) and add it in Cloudflare the same way as <code>STRIPE_WEBHOOK_SECRET</code>.</li>
        <li><strong>Test it.</strong> Send yourself an invoice, open it, press Pay and use the test card 4242 4242 4242 4242 with any future date and any CVC. The invoice should flip to Paid within seconds.</li>
        <li>When you are ready for real money, switch Stripe to live mode, replace both secrets with the live ones, and add the webhook again in live mode.</li></ol>
      <p class="anote">Never paste these keys into a chat or an email. They go straight into Cloudflare. Card details are handled entirely by Stripe and never touch this site.</p>`;
    const ch = $('copy-hook'); if (ch) ch.addEventListener('click', async () => { try { await navigator.clipboard.writeText(hook); toast('Copied'); } catch (e) { toast('Select and copy the address'); } });
  };

  /* ------------------------------------------------------------------ public API */
  window.ESBilling = {
    show(apiFn, view) { api = apiFn; if (view) st.view = view; settings = null; chrome(); draw(); },
    newInvoice: (init) => invoiceEditor(init),
    newRecurring: (pre) => recurringForm(null, pre),
    openInvoice: (id) => openInvoice(id),
    openImport(kind) { st.view = 'import'; window.ESAdmin.setTab('billing', true); chrome(); VIEW.import($('b-body'), kind); },
    setApi(a) { api = a; },
  };
})();
