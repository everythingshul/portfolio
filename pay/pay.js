/* The customer's invoice page: shows the invoice or quote, lets them pay by card or bank (Stripe Checkout), accept a quote, or print. */
(() => {
  const API = (window.ES_CHAT_ENDPOINT || '').replace(/\/$/, '');
  const params = new URLSearchParams(location.search);
  const token = params.get('t') || '';
  const root = document.getElementById('root');
  const Doc = window.ESInvoiceDoc;
  const esc = Doc.esc;
  let data = null;

  const fail = (title, text) => { root.innerHTML = `<div class="msg"><h1>${esc(title)}</h1><p>${esc(text)}</p></div>`; };

  async function load() {
    if (!token || !API) return fail('This link is not valid', 'Please use the link from your email, or contact us for a new one.');
    const res = await fetch(`${API}/i?t=${encodeURIComponent(token)}`);
    if (res.status === 404) return fail('This link is not valid', 'Please use the link from your email, or contact us for a new one.');
    if (!res.ok) throw new Error('failed');
    data = await res.json();
    draw();
  }

  function draw(banner) {
    const d = data, q = d.kind === 'quote';
    document.title = `${q ? 'Quote' : 'Invoice'} ${d.number} — ${d.business.name}`;
    const canAnswer = q && d.status === 'sent';
    const bar = `<div class="bar no-print"><div class="who">${esc(d.business.name)} · ${q ? 'Quote' : 'Invoice'} ${esc(d.number)}</div><div class="actions"><button class="btn ghost" id="print" type="button">Print or save as PDF</button></div></div>`;
    const pay = d.can_pay && d.balance > 0
      ? `<div class="paybox no-print"><span class="secure">Secure payment by card or bank transfer, powered by Stripe.</span><button class="btn big" id="pay" type="button">Pay ${esc(Doc.money(d.balance, d.currency))}</button></div>` : '';
    const answer = canAnswer ? `<div class="paybox no-print"><span class="secure">By accepting you agree to this quote and our <a href="/terms.html" target="_blank" rel="noopener">Terms and Conditions</a>.</span><button class="btn ghost" id="decline" type="button">Decline</button><button class="btn big" id="accept" type="button">Accept this quote</button></div>` : '';
    const unpaid = !q && d.status === 'sent' && d.balance > 0 && !d.can_pay ? `<div class="banner info no-print" style="margin-top:16px">To pay this invoice, please contact ${esc(d.business.email || d.business.name)}.</div>` : '';
    root.innerHTML = (banner || '') + bar + Doc.render(d) + pay + answer + unpaid;
    document.getElementById('print').addEventListener('click', () => window.print());
    const payBtn = document.getElementById('pay');
    if (payBtn) payBtn.addEventListener('click', async () => {
      payBtn.disabled = true; payBtn.textContent = 'Opening secure checkout…';
      try {
        const res = await fetch(`${API}/i/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: token }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.url) throw new Error(j.error || 'failed');
        location.href = j.url;
      } catch (e) {
        payBtn.disabled = false; payBtn.textContent = `Pay ${Doc.money(d.balance, d.currency)}`;
        draw(`<div class="banner err no-print">${esc(e.message === 'failed' ? 'Sorry, online payment is not available right now. Please contact us.' : e.message)}</div>`);
      }
    });
    ['accept', 'decline'].forEach((id) => { const b = document.getElementById(id); if (b) b.addEventListener('click', () => respond(id)); });
  }

  async function respond(action) {
    try {
      const res = await fetch(`${API}/i/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: token, action }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'failed');
      data.status = data.state = j.status;
      draw(`<div class="banner ok no-print">${action === 'accept' ? 'Thank you! The quote is accepted and we will be in touch shortly.' : 'The quote was declined. Thank you for letting us know.'}</div>`);
    } catch (e) { draw(`<div class="banner err no-print">${esc(e.message === 'failed' ? 'Sorry, that did not go through. Please try again.' : e.message)}</div>`); }
  }

  // Back from Stripe: the payment arrives by webhook a moment later, so check a few times.
  async function afterPayment() {
    for (let i = 0; i < 8; i++) {
      draw('<div class="banner info no-print">Thank you! We are confirming your payment…</div>');
      await new Promise((r) => setTimeout(r, 2500));
      const res = await fetch(`${API}/i?t=${encodeURIComponent(token)}`).catch(() => null);
      if (res && res.ok) { data = await res.json(); if (data.state === 'paid') break; }
    }
    draw(data.state === 'paid' ? '<div class="banner ok no-print">Payment received. Thank you! A receipt is on its way to your email.</div>' : '<div class="banner info no-print">Your payment is being processed. It can take a little while to show up here; you will get an email when it is confirmed.</div>');
    history.replaceState(null, '', location.pathname + '?t=' + encodeURIComponent(token));
  }

  load().then(() => { if (data && params.get('paid') === '1') afterPayment(); }).catch(() => fail('Something went wrong', 'Please refresh the page, or contact us if it keeps happening.'));
})();
