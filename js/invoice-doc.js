/* Builds the invoice / quote document HTML from the data the Worker returns. Used by pay/ and by /admin/.
   Look: the Everything Shul invoices from Wix (navy text, soft blue table header, light blue balance box).
   On a line, the first row of text is the item name; any following rows are its details (shown in grey). */
(() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (cents, cur) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format((cents || 0) / 100); } catch (e) { return '$' + ((cents || 0) / 100).toFixed(2); } };
  const date = (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const day = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const LABEL = { draft: 'Draft', unpaid: 'Unpaid', partial: 'Partly paid', overdue: 'Overdue', paid: 'Paid', void: 'Void', sent: 'Open', accepted: 'Accepted', declined: 'Declined' };
  const METHOD = { stripe: 'Online payment', stripe_refund: 'Refund', check: 'Check', cash: 'Cash', ach: 'Bank transfer', zelle: 'Zelle', imported: 'Payment', other: 'Payment' };

  function render(d) {
    const cur = d.currency, q = d.kind === 'quote', b = d.business || {}, c = d.customer || {};
    const addr = [c.addr1, c.addr2, [c.city, c.state, c.zip].filter(Boolean).join(', '), c.country].filter(Boolean);
    const rows = d.lines.map((l) => {
      const parts = String(l.description || '').split('\n'); const name = parts.shift(); const rest = parts.join('\n').trim();
      return `<tr><td>${esc(name)}${rest ? `<small>${esc(rest)}</small>` : ''}<small class="q">${esc(String(l.qty))} × ${esc(money(l.unit_cents, cur))}</small></td><td class="n">${esc(String(l.qty))}</td><td class="n">${esc(money(l.unit_cents, cur))}</td><td class="n">${esc(money(Math.round(l.qty * l.unit_cents), cur))}</td></tr>`;
    }).join('');
    const show = !q && d.status !== 'draft';
    const pays = (d.payments || []);
    return `<article class="inv-doc">
  <header class="inv-head">
    <div class="inv-logo">${b.logo_url ? `<img src="${esc(b.logo_url)}" alt="${esc(b.name)}" onerror="this.outerHTML='<div class=&quot;inv-biz-name&quot;>${esc(b.name)}</div>'">` : `<div class="inv-biz-name">${esc(b.name)}</div>`}</div>
    <div class="inv-title"><h2>${q ? 'Quote' : 'Invoice'} #${esc(d.number)}</h2>
      <div class="d">${q ? 'Quote' : 'Issue'} Date: ${esc(date(d.issue_date))}</div>${d.due_date ? `<div class="d">${q ? 'Valid until' : 'Due Date'}: ${esc(date(d.due_date))}</div>` : ''}
      <span class="inv-badge ${esc(d.state)}">${esc(LABEL[d.state] || d.state)}</span></div>
  </header>
  <section class="inv-biz"><strong>${esc(b.name)}</strong>${b.address ? `<p>${esc(b.address)}</p>` : ''}<div class="row"><p>${esc([b.email, b.phone].filter(Boolean).join('  ·  '))}</p>${b.website ? `<p>Website: ${esc(b.website)}</p>` : ''}</div>${b.taxid ? `<p>Tax ID: ${esc(b.taxid)}</p>` : ''}</section>
  <section class="inv-meta">
    <div class="inv-to"><div class="inv-label">${q ? 'Prepared for:' : 'Bill to:'}</div>${c.name ? `<strong>${esc(c.name)}</strong>` : ''}${c.org && c.org !== c.name ? `<strong>${esc(c.org)}</strong>` : ''}${addr.map((a) => `<p>${esc(a)}</p>`).join('')}</div>
    <div class="inv-to"><div class="inv-label">Additional Customer Info:</div>${c.email ? `<p>${esc(c.email)}</p>` : ''}${c.phone ? `<p>Phone: ${esc(c.phone)}</p>` : ''}</div>
  </section>
  ${d.title ? `<h3 class="inv-subject">${esc(d.title)}</h3>` : ''}
  <table class="inv-lines"><thead><tr><th>Product or Service</th><th class="n">Quantity</th><th class="n">Price</th><th class="n">Line Total</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="inv-totals">
    <div class="sub"><span>Subtotal</span><span>${esc(money(d.subtotal, cur))}</span></div>
    ${d.discount_cents ? `<div><span>Discount${d.discount_type === 'pct' ? ` (${d.discount_value}%)` : ''}</span><span>−${esc(money(d.discount_cents, cur))}</span></div>` : ''}
    <div><span>Taxes${d.tax_cents && d.tax_rate ? ` (${d.tax_rate}%)` : ''}</span><span>${esc(money(d.tax_cents, cur))}</span></div>
    <div class="total"><span>${q ? 'Quote Total' : 'Invoice Total'}</span><span>${esc(money(d.total, cur))}</span></div>
    ${show ? `<div class="${d.paid ? 'paidrow' : ''}"><span>Amount Paid</span><span>${esc(money(d.paid, cur))}</span></div><div class="balance"><span>Balance Due</span><span>${esc(money(d.balance, cur))}</span></div>` : ''}
  </div>
  <footer class="inv-foot">
    ${d.notes ? `<div><div class="inv-label">Notes</div><p>${esc(d.notes)}</p></div>` : ''}
    ${d.terms ? `<div><div class="inv-label">Terms</div><p>${esc(d.terms)}</p></div>` : ''}
    ${show && pays.length ? `<div class="inv-pays"><h4>Payments received (${pays.length})</h4>${pays.map((p) => `<div class="p"><div class="dt">${esc(day(p.received_at))}</div><div class="row"><span>${esc(METHOD[p.method] || 'Payment')}${p.ref && !['stripe', 'stripe_refund'].includes(p.method) ? ' - ' + esc(p.ref) : ''}</span><span>${esc(money(p.amount_cents, cur))}</span></div></div>`).join('')}</div>` : ''}
  </footer>
  <div class="inv-legal">All transactions and/or interactions with ${esc(b.name)} are subject to our <a href="/terms.html" target="_blank" rel="noopener">terms &amp; conditions</a>.</div>
</article>`;
  }
  window.ESInvoiceDoc = { render, money, esc };
})();
