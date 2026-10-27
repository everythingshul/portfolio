/* Builds the invoice / quote document HTML from the data the Worker returns. Used by pay/ and by /admin/. */
(() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (cents, cur) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format((cents || 0) / 100); } catch (e) { return '$' + ((cents || 0) / 100).toFixed(2); } };
  const date = (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');
  const LABEL = { draft: 'Draft', unpaid: 'Unpaid', partial: 'Partly paid', overdue: 'Overdue', paid: 'Paid', void: 'Void', sent: 'Open', accepted: 'Accepted', declined: 'Declined' };
  const METHOD = { stripe: 'Online', stripe_refund: 'Refund', check: 'Check', cash: 'Cash', ach: 'Bank transfer', zelle: 'Zelle', imported: 'Payment', other: 'Payment' };

  function render(d) {
    const cur = d.currency, q = d.kind === 'quote', b = d.business || {}, c = d.customer || {};
    const addr = [c.addr1, c.addr2, [c.city, c.state, c.zip].filter(Boolean).join(', '), c.country].filter(Boolean);
    const rows = d.lines.map((l) => `<tr><td>${esc(l.description)}<small>${l.qty} × ${esc(money(l.unit_cents, cur))}</small></td><td class="n">${esc(String(l.qty))}</td><td class="n">${esc(money(l.unit_cents, cur))}</td><td class="n">${esc(money(Math.round(l.qty * l.unit_cents), cur))}</td></tr>`).join('');
    const show = !q && d.status !== 'draft';
    return `<article class="inv-doc">
  <header class="inv-head">
    <div class="inv-biz">${b.logo_url ? `<img src="${esc(b.logo_url)}" alt="${esc(b.name)}" onerror="this.style.display='none'">` : ''}<div class="inv-biz-name">${esc(b.name)}</div>
      ${b.address ? `<p>${esc(b.address)}</p>` : ''}${b.email || b.phone ? `<p>${esc([b.email, b.phone].filter(Boolean).join('  ·  '))}</p>` : ''}${b.taxid ? `<p>Tax ID: ${esc(b.taxid)}</p>` : ''}</div>
    <div class="inv-title"><h2>${q ? 'Quote' : 'Invoice'}</h2><div class="inv-num">#${esc(d.number)}</div><span class="inv-badge ${esc(d.state)}">${esc(LABEL[d.state] || d.state)}</span></div>
  </header>
  <section class="inv-meta">
    <div class="inv-to"><div class="inv-label">${q ? 'Prepared for' : 'Bill to'}</div><strong>${esc(c.org || c.name)}</strong>${c.org && c.name && c.name !== c.org ? `<p>${esc(c.name)}</p>` : ''}${addr.map((a) => `<p>${esc(a)}</p>`).join('')}${c.email ? `<p>${esc(c.email)}</p>` : ''}</div>
    <dl class="inv-facts"><dt>${q ? 'Quote date' : 'Invoice date'}</dt><dd>${esc(date(d.issue_date))}</dd>${d.due_date ? `<dt>${q ? 'Valid until' : 'Due date'}</dt><dd>${esc(date(d.due_date))}</dd>` : ''}
      ${q ? `<div class="due" style="display:contents"><dt>Total</dt><dd>${esc(money(d.total, cur))}</dd></div>` : `<div class="due" style="display:contents"><dt>${d.balance > 0 ? 'Amount due' : 'Total'}</dt><dd>${esc(money(d.balance > 0 ? d.balance : d.total, cur))}</dd></div>`}</dl>
  </section>
  <table class="inv-lines"><thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="inv-totals">
    <div><span>Subtotal</span><span>${esc(money(d.subtotal, cur))}</span></div>
    ${d.discount_cents ? `<div><span>Discount${d.discount_type === 'pct' ? ` (${d.discount_value}%)` : ''}</span><span>−${esc(money(d.discount_cents, cur))}</span></div>` : ''}
    ${d.tax_cents ? `<div><span>Tax (${d.tax_rate}%)</span><span>${esc(money(d.tax_cents, cur))}</span></div>` : ''}
    <div class="total"><span>Total</span><span>${esc(money(d.total, cur))}</span></div>
    ${show && d.paid ? `<div class="paidrow"><span>Paid</span><span>−${esc(money(d.paid, cur))}</span></div>` : ''}
    ${show ? `<div class="balance"><span>Balance due</span><span>${esc(money(d.balance, cur))}</span></div>` : ''}
  </div>
  <footer class="inv-foot">
    ${d.notes ? `<div><div class="inv-label">Notes</div><p>${esc(d.notes)}</p></div>` : ''}
    ${d.terms ? `<div><div class="inv-label">Terms</div><p>${esc(d.terms)}</p></div>` : ''}
    ${show && d.payments && d.payments.length ? `<div><div class="inv-label">Payments</div><div class="inv-pays">${d.payments.map((p) => `<div><span>${esc(new Date(p.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))} · ${esc(METHOD[p.method] || 'Payment')}</span><span>${esc(money(p.amount_cents, cur))}</span></div>`).join('')}</div></div>` : ''}
  </footer>
  <div class="inv-legal">Thank you for your business.</div>
</article>`;
  }
  window.ESInvoiceDoc = { render, money, esc };
})();
