/* Small helpers shared by the Customers and Billing tabs of the admin page. */
(() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (cents, cur) => {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format((cents || 0) / 100); } catch (e) { return '$' + ((cents || 0) / 100).toFixed(2); }
  };
  // "$1,234.50" or "1234.5" -> cents (null when empty or not a number)
  const toCents = (v) => {
    if (v == null) return null;
    const s = String(v).replace(/[^0-9.\-]/g, '');
    if (s === '' || s === '-' || s === '.') return null;
    const n = parseFloat(s);
    return isFinite(n) ? Math.round(n * 100) : null;
  };
  const dollars = (cents) => ((cents || 0) / 100).toFixed(2);
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const fmtDate = (s) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  const fmtTime = (ts) => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fmtDay = (ts) => fmtDate(new Date(ts).getFullYear() + '-' + pad(new Date(ts).getMonth() + 1) + '-' + pad(new Date(ts).getDate()));
  const ago = (ts) => { const s = Math.max(1, Math.round((Date.now() - ts) / 1000)); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
  const who = (r) => r.customer_org || r.org || r.customer_name || r.name || '';

  const STATE = {
    draft: ['Draft', 'neutral'], unpaid: ['Unpaid', 'warn'], partial: ['Part paid', 'warn'], overdue: ['Overdue', 'bad'], paid: ['Paid', 'good'], void: ['Void', 'neutral'],
    sent: ['Sent', 'warn'], accepted: ['Accepted', 'good'], declined: ['Declined', 'bad'], lead: ['Lead', 'warn'], active: ['Active', 'good'], past: ['Past', 'neutral'],
  };
  const badge = (state) => { const [label, cls] = STATE[state] || [state, 'neutral']; return `<span class="badge ${cls}">${esc(label)}</span>`; };

  let toastFn = (m) => alert(m);
  const toast = (m) => (window.esToast ? window.esToast(m) : toastFn(m));

  // A dialog. body is HTML; returns { el, close }. Closes on Escape, the backdrop or the × button.
  function modal(title, body, opts) {
    opts = opts || {};
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal${opts.wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h3>${esc(title)}</h3><button type="button" class="modal-x" aria-label="Close">×</button></div><div class="modal-body">${body}</div></div>`;
    document.body.appendChild(wrap);
    document.body.classList.add('modal-open');
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const close = () => { document.removeEventListener('keydown', onKey); wrap.remove(); if (!document.querySelector('.modal-wrap')) document.body.classList.remove('modal-open'); if (opts.onClose) opts.onClose(); };
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('.modal-x').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    const first = wrap.querySelector('input:not([type=hidden]), select, textarea'); if (first && !opts.noFocus) setTimeout(() => first.focus(), 30);
    return { el: wrap.querySelector('.modal-body'), close };
  }

  const ask = (title, message, okLabel, danger) => new Promise((resolve) => {
    let done = false;
    const m = modal(title, `<p class="modal-text">${esc(message)}</p><div class="modal-actions"><button type="button" class="small-btn" data-no>Cancel</button><button type="button" class="small-btn ${danger ? 'danger solid' : 'primary'}" data-yes>${esc(okLabel || 'OK')}</button></div>`, { noFocus: true, onClose: () => { if (!done) resolve(false); } });
    m.el.querySelector('[data-no]').addEventListener('click', () => { m.close(); });
    m.el.querySelector('[data-yes]').addEventListener('click', () => { done = true; m.close(); resolve(true); });
    m.el.querySelector('[data-yes]').focus();
  });

  const csvParse = (text) => {
    // Handles quotes, escaped quotes, a BOM, and commas, semicolons or tabs between columns.
    text = String(text).replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((c) => c !== '')) rows.push(row); row = []; }
      else cell += ch;
    }
    row.push(cell); if (row.some((c) => c !== '')) rows.push(row);
    return rows;
  };

  const download = (name, blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  window.ESUI = { esc, money, toCents, dollars, today, addDays, fmtDate, fmtTime, fmtDay, ago, who, badge, toast, modal, ask, csvParse, download, debounce, setToast: (f) => { toastFn = f; } };
})();
