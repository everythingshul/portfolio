/* Customers tab: the customer list, and one page per customer with their invoices, payments, notes, follow-ups and chats. */
(() => {
  const U = window.ESUI;
  const { esc, money, fmtDate, ago, badge, toast } = U;
  const $ = (id) => document.getElementById(id);
  let api = null;
  const state = { q: '', status: '', tag: '' };
  const root = () => $('customers');

  const who = (c) => c.org || c.name;
  const sub = (c) => (c.org && c.name && c.name !== c.org ? c.name : '');

  /* ------------------------------------------------------------------ list */
  async function list() {
    history.replaceState(null, '', '#customers');
    const el = root();
    if (!el.querySelector('#cust-table')) {
      el.innerHTML = `<div class="toolbar">
        <input type="search" id="c-q" placeholder="Search name, organization, email, phone…" value="${esc(state.q)}">
        <div class="chips" id="c-status">${[['', 'All'], ['lead', 'Leads'], ['active', 'Active'], ['past', 'Past']].map(([k, l]) => `<button class="chip${state.status === k ? ' on' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
        <select id="c-tag" aria-label="Filter by tag"><option value="">All tags</option></select>
        <span class="grow"></span>
        <button class="small-btn" id="c-export">Export CSV</button>
        <button class="small-btn" id="c-import">Import customers</button>
        <button class="small-btn primary" id="c-new">+ New customer</button></div>
        <div id="cust-table"><div class="aempty">Loading…</div></div>`;
      $('c-q').addEventListener('input', U.debounce((e) => { state.q = e.target.value.trim(); load(); }, 250));
      $('c-status').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (!b) return; state.status = b.dataset.s; $('c-status').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b)); load(); });
      $('c-tag').addEventListener('change', (e) => { state.tag = e.target.value; load(); });
      $('c-new').addEventListener('click', () => customerForm(null, (id) => open(id)));
      $('c-import').addEventListener('click', () => window.ESBilling.openImport('customers'));
      $('c-export').addEventListener('click', async () => {
        try { const res = await fetch(api.base + '/admin/b/export?kind=customers', { headers: { Authorization: 'Bearer ' + api.token() } }); U.download('customers.csv', await res.blob()); } catch (e) { toast('Export failed'); }
      });
    }
    load();
  }

  async function load() {
    const box = $('cust-table'); if (!box) return;
    try {
      const qs = new URLSearchParams({ q: state.q, status: state.status, tag: state.tag });
      const d = await api('/admin/b/customers?' + qs);
      const sel = $('c-tag'); const cur = state.tag;
      sel.innerHTML = '<option value="">All tags</option>' + d.tags.map((t) => `<option value="${esc(t)}"${t === cur ? ' selected' : ''}>${esc(t)}</option>`).join('');
      if (!d.customers.length) { box.innerHTML = `<div class="aempty">${state.q || state.status || state.tag ? 'No customers match.' : 'No customers yet. Add one, import your Wix contacts, or wait for the first website lead.'}</div>`; return; }
      box.innerHTML = `<div class="tscroll"><table class="atable clickable"><thead><tr><th>Customer</th><th>Contact</th><th>Status</th><th class="n">Owes</th><th class="n">Paid to date</th><th>Last activity</th></tr></thead><tbody>${d.customers.map((c) => `<tr data-id="${esc(c.id)}">
        <td><strong>${esc(who(c))}</strong>${sub(c) ? `<div class="subtle">${esc(sub(c))}</div>` : ''}${c.tags ? `<div class="tags">${c.tags.split(',').map((t) => `<span class="tag">${esc(t.trim())}</span>`).join('')}</div>` : ''}</td>
        <td>${esc(c.email)}${c.phone ? `<div class="subtle">${esc(c.phone)}</div>` : ''}</td><td>${badge(c.status)}</td>
        <td class="n">${c.balance ? `<strong>${esc(money(c.balance))}</strong>` : '—'}</td><td class="n">${c.paid_total ? esc(money(c.paid_total)) : '—'}</td><td class="subtle">${c.last_activity ? ago(c.last_activity) : '—'}</td></tr>`).join('')}</tbody></table></div>
        <p class="anote">${d.customers.length} customer${d.customers.length === 1 ? '' : 's'}</p>`;
      box.querySelectorAll('tr[data-id]').forEach((r) => r.addEventListener('click', () => open(r.dataset.id)));
    } catch (e) { box.innerHTML = `<div class="aempty">${esc(e.message)}${/not set up/i.test(e.message) ? '<br>The billing database still needs to be created. See worker/chat/README.md.' : ''}</div>`; }
  }

  /* ------------------------------------------------------------------ customer page */
  async function open(id) {
    history.replaceState(null, '', '#customer=' + id);
    window.ESAdmin && window.ESAdmin.setTab('customers', true);
    const el = root();
    el.innerHTML = '<div class="aempty">Loading…</div>';
    let d;
    try { d = await api('/admin/b/customer?id=' + encodeURIComponent(id)); } catch (e) { el.innerHTML = `<div class="aempty">${esc(e.message)}</div>`; return; }
    const c = d.customer, s = d.summary;
    const addr = [c.addr1, c.addr2, [c.city, c.state, c.zip].filter(Boolean).join(', '), c.country].filter(Boolean);
    const invs = d.invoices.filter((i) => i.kind === 'invoice'), quotes = d.invoices.filter((i) => i.kind === 'quote');
    const openTasks = d.tasks.filter((t) => !t.done), doneTasks = d.tasks.filter((t) => t.done);
    el.innerHTML = `
      <div class="pagehead"><button class="small-btn" id="back">← All customers</button>
        <div class="titleblock"><h2>${esc(who(c))}</h2>${sub(c) ? `<span class="subtle">${esc(sub(c))}</span>` : ''} ${badge(c.status)}</div>
        <span class="grow"></span>
        <button class="small-btn" id="edit">Edit</button>
        <button class="small-btn" id="newq">New quote</button>
        <button class="small-btn primary" id="newi">+ New invoice</button></div>
      <div class="kpis">
        <div class="kpi"><div class="kv">${esc(money(s.billed))}</div><div class="kl">Billed</div></div>
        <div class="kpi"><div class="kv">${esc(money(s.paid))}</div><div class="kl">Paid</div></div>
        <div class="kpi"><div class="kv">${esc(money(s.balance))}</div><div class="kl">Owes now</div></div>
        <div class="kpi ${s.overdue ? 'bad' : ''}"><div class="kv">${esc(money(s.overdue))}</div><div class="kl">Overdue</div></div></div>
      <div class="split">
        <div class="main">
          <section class="acard"><h3>Invoices</h3>${invs.length ? `<div class="tscroll"><table class="atable clickable"><thead><tr><th>Number</th><th>Date</th><th>Due</th><th class="n">Total</th><th class="n">Balance</th><th>Status</th></tr></thead><tbody>${invs.map((i) => `<tr data-inv="${esc(i.id)}"><td><strong>${esc(i.number)}</strong></td><td>${esc(fmtDate(i.issue_date))}</td><td>${esc(fmtDate(i.due_date))}</td><td class="n">${esc(money(i.total, i.currency))}</td><td class="n">${i.state === 'draft' || i.state === 'void' ? '—' : esc(money(i.balance, i.currency))}</td><td>${badge(i.state)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="aempty">No invoices yet.</div>'}</section>
          ${quotes.length ? `<section class="acard"><h3>Quotes</h3><div class="tscroll"><table class="atable clickable"><tbody>${quotes.map((i) => `<tr data-inv="${esc(i.id)}"><td><strong>${esc(i.number)}</strong></td><td>${esc(fmtDate(i.issue_date))}</td><td class="n">${esc(money(i.total, i.currency))}</td><td>${badge(i.state)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
          ${d.recurring.length ? `<section class="acard"><h3>Repeating invoices</h3>${d.recurring.map((r) => `<div class="line"><span>${esc(r.title || 'Repeating invoice')} · ${esc(r.frequency)}</span><span class="subtle">next ${esc(fmtDate(r.next_date))}${r.active ? '' : ' (paused)'}</span></div>`).join('')}</section>` : ''}
          <section class="acard"><h3>Activity</h3>
            <form id="note-form" class="noteform"><textarea id="note-text" rows="2" placeholder="Add a note: a call, a meeting, anything worth remembering…" maxlength="2000"></textarea><button class="small-btn primary" type="submit">Add note</button></form>
            ${d.activity.length ? `<ul class="timeline">${d.activity.map((a) => `<li class="t-${esc(a.type)}"><time>${esc(U.fmtTime(a.ts))}</time><span>${esc(a.text)}</span></li>`).join('')}</ul>` : '<div class="aempty">Nothing yet.</div>'}</section>
        </div>
        <aside class="side">
          <section class="acard"><h3>Details</h3>
            ${c.email ? `<div class="kvrow"><span>Email</span><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : ''}
            ${c.phone ? `<div class="kvrow"><span>Phone</span><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></div>` : ''}
            ${addr.length ? `<div class="kvrow"><span>Address</span><div>${addr.map(esc).join('<br>')}</div></div>` : ''}
            <div class="kvrow"><span>Source</span><div>${esc(c.source || '—')}</div></div>
            ${c.tags ? `<div class="kvrow"><span>Tags</span><div>${c.tags.split(',').map((t) => `<span class="tag">${esc(t.trim())}</span>`).join(' ')}</div></div>` : ''}
            ${c.tax_exempt ? '<div class="kvrow"><span>Tax</span><div>Tax exempt</div></div>' : ''}
            ${c.terms_days != null ? `<div class="kvrow"><span>Terms</span><div>Net ${c.terms_days} days</div></div>` : ''}
            ${c.notes ? `<div class="kvrow"><span>Notes</span><div class="pre">${esc(c.notes)}</div></div>` : ''}
            <div class="kvrow"><span>Added</span><div>${esc(U.fmtDay(c.created))}</div></div></section>
          <section class="acard"><h3>Follow-ups</h3>
            <form id="task-form" class="taskform"><input type="text" id="task-text" placeholder="e.g. Send proposal" maxlength="300" required><input type="date" id="task-due"><button class="small-btn" type="submit">Add</button></form>
            ${openTasks.map((t) => `<label class="task ${t.due && t.due < U.today() ? 'late' : ''}"><input type="checkbox" data-task="${esc(t.id)}"><span>${esc(t.text)}${t.due ? `<small>${esc(fmtDate(t.due))}</small>` : ''}</span><button type="button" class="x" data-deltask="${esc(t.id)}" aria-label="Delete follow-up">×</button></label>`).join('') || '<div class="subtle">None open.</div>'}
            ${doneTasks.length ? `<details class="donetasks"><summary>${doneTasks.length} done</summary>${doneTasks.map((t) => `<label class="task done"><input type="checkbox" checked data-task="${esc(t.id)}"><span>${esc(t.text)}</span></label>`).join('')}</details>` : ''}</section>
          ${d.chats.length ? `<section class="acard"><h3>Chats</h3>${d.chats.map((ch) => `<a class="line link" href="#${esc(ch.id)}" data-chat="${esc(ch.id)}"><span>${esc((ch.last || '').slice(0, 60) || 'Chat')}</span><span class="subtle">${esc(ch.status)}</span></a>`).join('')}</section>` : ''}
          <section class="acard"><h3>Manage</h3><div class="row"><button class="small-btn" id="newr">New repeating invoice</button><button class="small-btn danger" id="del">Delete customer</button></div></section>
        </aside></div>`;
    $('back').addEventListener('click', () => { history.replaceState(null, '', '#customers'); list(); });
    $('edit').addEventListener('click', () => customerForm(c, () => open(id)));
    $('newi').addEventListener('click', () => window.ESBilling.newInvoice({ customer_id: id, kind: 'invoice' }));
    $('newq').addEventListener('click', () => window.ESBilling.newInvoice({ customer_id: id, kind: 'quote' }));
    $('newr').addEventListener('click', () => window.ESBilling.newRecurring({ customer_id: id }));
    el.querySelectorAll('[data-inv]').forEach((r) => r.addEventListener('click', () => window.ESBilling.openInvoice(r.dataset.inv)));
    el.querySelectorAll('[data-chat]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); window.ESAdmin.openChat(a.dataset.chat); }));
    $('note-form').addEventListener('submit', async (e) => { e.preventDefault(); const text = $('note-text').value.trim(); if (!text) return; try { await api('/admin/b/note', { method: 'POST', body: { customer_id: id, text } }); open(id); } catch (x) { toast(x.message); } });
    $('task-form').addEventListener('submit', async (e) => { e.preventDefault(); try { await api('/admin/b/task/save', { method: 'POST', body: { customer_id: id, text: $('task-text').value, due: $('task-due').value } }); open(id); } catch (x) { toast(x.message); } });
    el.querySelectorAll('[data-task]').forEach((cb) => cb.addEventListener('change', async () => { await api('/admin/b/task/toggle', { method: 'POST', body: { id: cb.dataset.task, done: cb.checked } }); open(id); }));
    el.querySelectorAll('[data-deltask]').forEach((b) => b.addEventListener('click', async (e) => { e.preventDefault(); await api('/admin/b/task/delete', { method: 'POST', body: { id: b.dataset.deltask } }); open(id); }));
    $('del').addEventListener('click', async () => {
      if (!(await U.ask('Delete this customer?', 'This permanently removes the customer, their notes and follow-ups. Customers with invoices can not be deleted; mark them as past instead.', 'Delete', true))) return;
      try { await api('/admin/b/customer/delete', { method: 'POST', body: { id } }); toast('Customer deleted'); history.replaceState(null, '', '#customers'); list(); } catch (x) { toast(x.message); }
    });
  }

  /* ------------------------------------------------------------------ add / edit form */
  function customerForm(c, done) {
    c = c || { status: 'active' };
    const f = (name, label, type, extra) => `<label class="f ${extra || ''}"><span>${label}</span><input name="${name}" type="${type || 'text'}" value="${esc(c[name] == null ? '' : c[name])}" maxlength="200"></label>`;
    const m = U.modal(c.id ? 'Edit customer' : 'New customer', `<form id="cform" class="cform">
      <div class="grid2">${f('name', 'Contact name')}${f('org', 'Organization')}${f('email', 'Email', 'email')}${f('phone', 'Phone', 'tel')}</div>
      ${f('addr1', 'Address')}${f('addr2', 'Address line 2')}
      <div class="grid3">${f('city', 'City')}${f('state', 'State')}${f('zip', 'ZIP')}</div>
      ${f('country', 'Country')}
      <div class="grid2"><label class="f"><span>Status</span><select name="status">${['lead', 'active', 'past'].map((s) => `<option value="${s}"${c.status === s ? ' selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></label>${f('tags', 'Tags (comma separated)')}</div>
      <div class="grid2"><label class="f"><span>Payment terms (days)</span><input name="terms_days" type="number" min="0" max="365" placeholder="Use the default" value="${c.terms_days == null ? '' : c.terms_days}"></label>
        <label class="check pad"><input type="checkbox" name="tax_exempt" ${c.tax_exempt ? 'checked' : ''}> Tax exempt (nonprofit)</label></div>
      <label class="f"><span>Notes</span><textarea name="notes" rows="3" maxlength="4000">${esc(c.notes || '')}</textarea></label>
      <p class="form-err" role="alert"></p>
      <div class="modal-actions"><button type="button" class="small-btn" data-cancel>Cancel</button><button class="small-btn primary" type="submit">Save customer</button></div></form>`, { wide: true });
    m.el.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.el.querySelector('#cform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target); const body = Object.fromEntries(fd.entries()); body.tax_exempt = !!fd.get('tax_exempt'); if (c.id) { body.id = c.id; body.source = c.source; body.ext_id = c.ext_id; } else body.source = 'manual';
      try { const r = await api('/admin/b/customer/save', { method: 'POST', body }); m.close(); toast('Saved'); done && done(r.id); } catch (x) { m.el.querySelector('.form-err').textContent = x.message; }
    });
  }

  window.ESCRM = {
    show(apiFn) { api = apiFn; const m = /#customer=(\w+)/.exec(location.hash); if (m) open(m[1]); else { root().innerHTML = ''; list(); } },
    open, form: customerForm, setApi(a) { api = a; },
    refresh() { const m = /#customer=(\w+)/.exec(location.hash); if (m) open(m[1]); else load(); },
  };
})();
