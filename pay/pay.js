/* The customer's invoice page: shows the invoice or quote, lets them pay by card or bank right on the page (Stripe's secure card fields,
   or Stripe's own page as a fallback), accept a quote, or print. */
(() => {
  const API = (window.ES_CHAT_ENDPOINT || '').replace(/\/$/, '');
  const params = new URLSearchParams(location.search);
  const token = params.get('t') || '';
  const root = document.getElementById('root');
  const Doc = window.ESInvoiceDoc;
  const esc = Doc.esc;
  let data = null;
  let stripeJs = null, intent = null;   // Stripe.js loads only when there is something to pay

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
    const amount = Doc.money(d.balance, d.currency);
    const embedded = d.can_pay && d.balance > 0 && d.pay_mode === 'embedded';
    const pay = embedded
      ? `<section class="paycard no-print"><h3>Pay ${esc(amount)}</h3><div id="payment-element"><div class="paywait">Loading the secure payment form…</div></div><p class="paymsg" id="pay-msg" role="alert"></p><div class="payrow"><span class="secure">Secure payment by card or bank transfer, powered by Stripe. Your card details go straight to Stripe and never reach us.</span><button class="btn big" id="pay-now" type="button" disabled>Pay ${esc(amount)}</button></div></section>`
      : d.can_pay && d.balance > 0
        ? `<div class="paybox no-print"><span class="secure">Secure payment by card or bank transfer, powered by Stripe.</span><button class="btn big" id="pay" type="button">Pay ${esc(amount)}</button></div>` : '';
    const answer = canAnswer ? `<div class="paybox no-print"><span class="secure">By accepting you agree to this quote and our <a href="/terms.html" target="_blank" rel="noopener">Terms and Conditions</a>.</span><button class="btn ghost" id="decline" type="button">Decline</button><button class="btn big" id="accept" type="button">Accept this quote</button></div>` : '';
    const unpaid = !q && d.status === 'sent' && d.balance > 0 && !d.can_pay ? `<div class="banner info no-print" style="margin-top:16px">${d.online_pay_off ? 'To pay this invoice, please contact' : 'To pay this invoice, please contact'} ${esc(d.business.email || d.business.name)}.</div>` : '';
    root.innerHTML = (banner || '') + bar + Doc.render(d) + pay + answer + unpaid;
    document.getElementById('print').addEventListener('click', () => window.print());
    if (embedded) mountPayment();
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

  const loadStripe = () => new Promise((resolve, reject) => {
    if (window.Stripe) return resolve(window.Stripe);
    const s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3/'; s.async = true;
    s.onload = () => (window.Stripe ? resolve(window.Stripe) : reject(new Error('stripe')));
    s.onerror = () => reject(new Error('stripe'));
    document.head.appendChild(s);
  });

  // The card form is Stripe's own: it lives in a frame Stripe controls, so card numbers never pass through this page or our servers.
  async function mountPayment() {
    const box = document.getElementById('payment-element'), msg = document.getElementById('pay-msg'), btn = document.getElementById('pay-now');
    const stop = (text) => { box.innerHTML = ''; msg.innerHTML = `${esc(text)} <a href="#" id="pay-alt">Pay on Stripe's page instead</a>`; const a = document.getElementById('pay-alt'); if (a) a.addEventListener('click', (e) => { e.preventDefault(); data.pay_mode = 'redirect'; draw(); }); };
    try {
      const [Stripe, res] = await Promise.all([loadStripe(), intent ? Promise.resolve(null) : fetch(`${API}/i/intent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: token }) })]);
      if (res) { const j = await res.json().catch(() => ({})); if (!res.ok || !j.client_secret) throw new Error(j.error || 'failed'); intent = j; }
      stripeJs = stripeJs || Stripe(intent.pk);
      const elements = stripeJs.elements({ clientSecret: intent.client_secret, appearance: { theme: 'stripe', variables: { colorPrimary: '#1b8fcf', colorText: '#000624', fontFamily: 'Instrument Sans, system-ui, sans-serif', borderRadius: '8px' } } });
      const el = elements.create('payment', { layout: 'tabs' });
      box.innerHTML = '';
      el.mount(box);
      el.on('ready', () => { btn.disabled = false; });
      btn.addEventListener('click', async () => {
        btn.disabled = true; msg.textContent = ''; const label = btn.textContent; btn.textContent = 'Processing…';
        const { error, paymentIntent } = await stripeJs.confirmPayment({ elements, confirmParams: { return_url: `${location.origin}/pay/?t=${encodeURIComponent(token)}&paid=1` }, redirect: 'if_required' });
        if (error) { msg.textContent = error.message || 'The payment did not go through. Please check your details and try again.'; btn.disabled = false; btn.textContent = label; return; }
        await finishPayment(paymentIntent.id);
      });
    } catch (e) { stop(e.message === 'failed' || e.message === 'stripe' ? "The secure payment form could not load." : e.message); }
  }

  // Ask the server to check the payment with Stripe so the invoice shows Paid right away, then redraw.
  async function finishPayment(piId) {
    let status = '';
    try {
      const r = await fetch(`${API}/i/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: token, pi: piId }) });
      status = (await r.json().catch(() => ({}))).status || '';
    } catch (e) { /* the webhook will still record it */ }
    intent = null;
    const res = await fetch(`${API}/i?t=${encodeURIComponent(token)}`).catch(() => null);
    if (res && res.ok) data = await res.json();
    draw(data.state === 'paid'
      ? '<div class="banner ok no-print">Payment received. Thank you! A receipt is on its way to your email.</div>'
      : status === 'processing' || status === 'requires_action' || status === 'succeeded'
        ? '<div class="banner info no-print">Thank you! Your payment is being processed. This page will show it as paid soon, and you will get an email when it is confirmed.</div>'
        : '<div class="banner info no-print">We have not received the payment yet. If you were charged, it will show up here shortly.</div>');
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

  load().then(() => { if (data && params.get('paid') === '1') { const pi = params.get('payment_intent'); if (pi) { history.replaceState(null, '', location.pathname + '?t=' + encodeURIComponent(token)); finishPayment(pi); } else afterPayment(); } }).catch(() => fail('Something went wrong', 'Please refresh the page, or contact us if it keeps happening.'));
})();
