/* Ledger (every dollar in and out), taking a one-off payment, and Gmail-style labels. Plugs into the Billing tab (billing.js). */
(() => {
  const U = window.ESUI;
  const { esc, money, toCents, dollars, toast } = U;
  const B = () => window.ESBilling;
  const api = (p, o) => B().getApi()(p, o);
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const guard = async (fn, ok) => { try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message || 'Something went wrong'); return undefined; } };
  const post = (path, body) => api('/admin/b/' + path, { method: 'POST', body });

  /* ------------------------------------------------------------------ files and PDFs (the admin password is sent as a header, so a plain link can not open them) */
  async function openProtected(path, name) {
    const w = window.open('', '_blank');
    try {
      const res = await fetch(B().getApi().base + path, { headers: { Authorization: 'Bearer ' + B().getApi().token() } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not open the file');
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      if (w) w.location = url; else U.download(name || 'file', blob);
    } catch (e) { if (w) w.close(); toast(e.message); }
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-pdf],[data-lfile]'); if (!a) return;
    e.preventDefault(); e.stopPropagation();
    if (a.dataset.pdf) openProtected('/admin/b/invoice/pdf?id=' + encodeURIComponent(a.dataset.pdf), 'invoice.pdf'); else openProtected('/admin/b/ledger/file?id=' + encodeURIComponent(a.dataset.lfile), 'file');
  }, true);
  document.addEventListener('click', (e) => { const a = e.target.closest('[data-invlink]'); if (!a) return; e.preventDefault(); e.stopPropagation(); window.ESAdmin.setTab('billing', true); window.ESBilling.openInvoice(a.dataset.invlink); }, true);

  /* ------------------------------------------------------------------ labels */
  const LBL = { labels: [], by: {}, links: {}, palette: [], filter: '', loaded: false };
  async function loadLabels() { const d = await api('/admin/b/labels'); LBL.labels = d.labels; LBL.by = Object.fromEntries(d.labels.map((l) => [l.id, l])); LBL.links = d.links; LBL.palette = d.palette; LBL.loaded = true; }
  const fg = (hex) => { const n = parseInt(String(hex).slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1f2d36' : '#ffffff'; };
  const chip = (l) => `<span class="lbl" style="background:${esc(l.color)};color:${fg(l.color)}" title="${esc(l.path)}">${esc(l.path.replace(/\//g, ' / '))}</span>`;
  const idsOf = (type, id) => (LBL.links[type] && LBL.links[type][id]) || [];
  const chipsFor = (type, id) => idsOf(type, id).map((i) => LBL.by[i]).filter(Boolean).map(chip).join(' ');
  const descendants = (id) => { const ids = [id]; for (let i = 0; i < ids.length; i++) for (const l of LBL.labels) if (l.parent_id === ids[i] && !ids.includes(l.id)) ids.push(l.id); return ids; };
  const pal = (cur) => `<div class="pal">${LBL.palette.map((c) => `<button type="button" class="sw ${c === cur ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('')}</div>`;

  function place(pop, anchor) { const r = anchor.getBoundingClientRect(); pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left)) + 'px'; pop.style.top = Math.max(8, Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 6)) + 'px'; }
  function dismissOnOutside(pop, anchor) { setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!pop.contains(e.target) && !(anchor && anchor.contains(e.target))) { pop.remove(); document.removeEventListener('mousedown', off); } }), 0); }

  /** The picker: tick labels, or type a name (Parent/Child nests) and create one on the spot. */
  function openPicker(anchor, target, done) {
    document.querySelectorAll('.lblpick').forEach((x) => x.remove());
    const pop = document.createElement('div'); pop.className = 'lblpick';
    let sel = new Set(idsOf(target.type, target.id)), q = '', color = '';
    const save = () => guard(async () => {
      await post('label/assign', { type: target.type, id: target.id, label_ids: [...sel] });
      LBL.links[target.type] = LBL.links[target.type] || {};
      if (sel.size) LBL.links[target.type][target.id] = [...sel]; else delete LBL.links[target.type][target.id];
      done && done(); applyFilter(); decorateAll();
    });
    const draw = () => {
      const rows = LBL.labels.filter((l) => !q || l.path.toLowerCase().includes(q.toLowerCase()));
      const exact = LBL.labels.some((l) => l.path.toLowerCase() === q.trim().toLowerCase());
      pop.innerHTML = `<input type="search" id="lpq" placeholder="Find or create a label" value="${esc(q)}" autocomplete="off">
        <div class="lblist">${rows.map((l) => `<label class="lblrow" style="padding-left:${10 + (q ? 0 : l.depth * 16)}px"><input type="checkbox" data-l="${l.id}" ${sel.has(l.id) ? 'checked' : ''}><i class="dot" style="background:${l.color}"></i><span>${esc(q ? l.path.replace(/\//g, ' / ') : l.name)}</span></label>`).join('') || (q ? '' : '<div class="subtle" style="padding:10px">No labels yet. Type a name to make one.</div>')}</div>
        ${q.trim() && !exact ? `<div class="lblnew"><button type="button" class="small-btn primary" data-create>Create "${esc(q.trim())}"</button><div class="subtle" style="margin:6px 0 4px">Color</div>${pal(color)}<div class="subtle" style="margin-top:6px">Type <strong>Parent/Child</strong> to nest it.</div></div>` : ''}
        <div class="lblfoot"><a href="#" data-manage>Manage labels</a></div>`;
      const inp = pop.querySelector('#lpq'); inp.focus(); inp.setSelectionRange(q.length, q.length);
      inp.oninput = (e) => { q = e.target.value; draw(); };
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const c = pop.querySelector('[data-create]'); if (c) c.click(); } if (e.key === 'Escape') pop.remove(); };
      pop.querySelectorAll('[data-l]').forEach((c) => { c.onchange = () => { const id = +c.dataset.l; if (c.checked) sel.add(id); else sel.delete(id); save(); }; });
      pop.querySelectorAll('.sw').forEach((b) => { b.onclick = () => { color = b.dataset.c; draw(); }; });
      const cr = pop.querySelector('[data-create]');
      if (cr) cr.addEventListener('click', () => guard(async () => { const r = await post('label/save', { name: q.trim(), color: color || undefined }); await loadLabels(); sel.add(r.id); q = ''; color = ''; await save(); draw(); }, 'Label created'));
      pop.querySelector('[data-manage]').onclick = (e) => { e.preventDefault(); pop.remove(); document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); document.body.classList.remove('modal-open'); window.ESAdmin.setTab('billing', true); B().show(B().getApi(), 'labels'); };
    };
    document.body.append(pop); draw(); place(pop, anchor); dismissOnOutside(pop, anchor);
  }
  function openPalette(anchor, cur, pick) {
    document.querySelectorAll('.lblpick').forEach((x) => x.remove());
    const pop = document.createElement('div'); pop.className = 'lblpick'; pop.innerHTML = `<div class="subtle" style="margin-bottom:6px">Pick a color</div>${pal(cur)}`;
    document.body.append(pop); place(pop, anchor);
    pop.onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) { pop.remove(); pick(b.dataset.c); } };
    dismissOnOutside(pop, anchor);
  }

  /** A bar of this item's labels with a "+ Label" button. Put it on any detail page or window. */
  async function bar(host, type, id) {
    if (!host || !id) return;
    if (!LBL.loaded) { try { await loadLabels(); } catch (e) { return; } }
    const draw = () => { host.innerHTML = `${chipsFor(type, id) || '<span class="subtle">No labels</span>'} <button type="button" class="small-btn" data-addlbl>+ Label</button>`; };
    draw(); host.onclick = (e) => { const b = e.target.closest('[data-addlbl]'); if (b) openPicker(b, { type, id }, draw); };
  }

  function labelModal(label, parentId, after) {
    const L = label || { name: '', color: '', parent_id: parentId || null };
    const bad = new Set(label ? descendants(label.id) : []);
    let color = L.color || LBL.palette[LBL.labels.length % LBL.palette.length];
    const m = U.modal(label ? 'Edit label' : (parentId ? 'New sub-label' : 'New label'), `<div class="cform">
      <label class="f"><span>Name</span><input id="ln" value="${esc(L.name)}" maxlength="60" placeholder="e.g. Donors, or Clients/Synagogues"></label>
      <label class="f"><span>Nest under</span><select id="lp"><option value="">(top level)</option>${LBL.labels.filter((l) => !bad.has(l.id)).map((l) => `<option value="${l.id}" ${l.id === L.parent_id ? 'selected' : ''}>${'&nbsp;&nbsp;'.repeat(l.depth)}${esc(l.name)}</option>`).join('')}</select></label>
      <div class="f"><span>Color</span><div id="lpal">${pal(color)}</div><div style="margin-top:10px">Preview: <span id="lprev"></span></div></div>
      <p class="form-err" role="alert"></p>
      <div class="modal-actions">${label ? '<button type="button" class="small-btn danger" id="ldel">Delete</button>' : ''}<span class="grow"></span><button type="button" class="small-btn primary" id="lgo">${label ? 'Save' : 'Create label'}</button></div></div>`);
    const root = m.el;
    const prev = () => { const n = root.querySelector('#ln').value.trim() || 'Label'; root.querySelector('#lprev').innerHTML = chip({ color, path: n }); };
    root.querySelector('#lpal').onclick = (e) => { const b = e.target.closest('.sw'); if (!b) return; color = b.dataset.c; root.querySelector('#lpal').innerHTML = pal(color); prev(); };
    root.querySelector('#ln').oninput = prev; prev();
    root.querySelector('#lgo').onclick = async () => {
      try { const b = { name: root.querySelector('#ln').value, color, parent_id: root.querySelector('#lp').value || null }; if (label) b.id = label.id; await post('label/save', b); await loadLabels(); m.close(); toast(label ? 'Saved' : 'Label created'); after && after(); } catch (e) { root.querySelector('.form-err').textContent = e.message; }
    };
    const del = root.querySelector('#ldel');
    if (del) del.onclick = async () => {
      if (!(await U.ask('Delete this label?', `The label "${label.name}" is taken off ${label.count} item${label.count === 1 ? '' : 's'}. Sub-labels move up one level. Nothing else is deleted.`, 'Delete', true))) return;
      await guard(async () => { await post('label/delete', { id: label.id }); await loadLabels(); m.close(); after && after(); }, 'Label deleted');
    };
  }

  B().defineView('labels', async (el) => {
    await loadLabels();
    const draw = () => {
      el.innerHTML = `<div class="toolbar"><button class="small-btn primary" id="nl">+ New label</button><span class="subtle">Labels can go on customers, invoices, quotes, payments and ledger entries. Open an item and click <strong>+ Label</strong>. Type <strong>Parent/Child</strong> to nest.</span></div>
      <section class="acard">${LBL.labels.length ? LBL.labels.map((l) => `<div class="lblm" style="padding-left:${l.depth * 24}px"><button type="button" class="swatch" data-color="${l.id}" style="background:${l.color}" title="Change color" aria-label="Change color of ${esc(l.name)}"></button><strong>${esc(l.name)}</strong> <span class="subtle">${l.count} item${l.count === 1 ? '' : 's'}</span><span class="grow"></span><button type="button" class="small-btn" data-sub="${l.id}">+ Sub-label</button><button type="button" class="small-btn" data-edit="${l.id}">Edit</button></div>`).join('') : '<div class="aempty">No labels yet. Click New label, or make one from the + Label button on any item.</div>'}</section>`;
      $('nl').onclick = () => labelModal(null, null, draw);
      el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => labelModal(LBL.by[b.dataset.edit], null, draw); });
      el.querySelectorAll('[data-sub]').forEach((b) => { b.onclick = () => labelModal(null, +b.dataset.sub, draw); });
      el.querySelectorAll('[data-color]').forEach((b) => { b.onclick = () => { const l = LBL.by[b.dataset.color]; openPalette(b, l.color, (c) => guard(async () => { await post('label/save', { id: l.id, color: c }); await loadLabels(); draw(); }, 'Color changed')); }; });
    };
    draw();
  });

  /* labels on list pages: a Labels column and a filter, added to any table whose rows carry data-lbl="type:id" */
  function applyFilter() {
    const f = +LBL.filter || 0, ids = f ? new Set(descendants(f)) : null;
    $$('tr[data-lbl][data-lb]').forEach((tr) => { if (!ids) { tr.hidden = false; return; } tr.hidden = !(tr.dataset.lb || '').split(',').filter(Boolean).some((x) => ids.has(+x)); });
  }
  function decorateTable(tbl) {
    const rows = $$('tbody tr', tbl); if (!rows.length) return;
    if (!tbl.querySelector('thead th.lbl-col')) { const th = document.createElement('th'); th.className = 'lbl-col'; th.textContent = 'Labels'; tbl.querySelector('thead tr').append(th); }
    rows.forEach((tr) => {
      const key = tr.dataset.lbl || ''; const [type, id] = key.split(/:(.*)/s);
      let td = tr.querySelector('td.lbl-col');
      if (!td) { td = document.createElement('td'); td.className = 'lbl-col'; tr.append(td); }
      td.innerHTML = key ? chipsFor(type, id) : '';
      tr.dataset.lb = key ? idsOf(type, id).join(',') : '';
    });
    const view = tbl.closest('#b-body, #customers') || document;
    let tb = view.querySelector('.toolbar');
    if (tb && !tb.querySelector('.lblfilter') && LBL.labels.length) {
      const sel = document.createElement('select'); sel.className = 'lblfilter'; sel.setAttribute('aria-label', 'Filter by label');
      sel.innerHTML = `<option value="">All labels</option>${LBL.labels.map((l) => `<option value="${l.id}">${'&nbsp;&nbsp;'.repeat(l.depth)}${esc(l.name)}</option>`).join('')}`;
      sel.value = LBL.filter; sel.onchange = (e) => { LBL.filter = e.target.value; applyFilter(); };
      const grow = tb.querySelector('.grow'); if (grow) tb.insertBefore(sel, grow); else tb.append(sel);
    }
    applyFilter();
  }
  let pending = false;
  function decorateAll() {
    if (pending) return; pending = true;
    requestAnimationFrame(async () => {
      pending = false;
      const tables = $$('table.atable').filter((t) => t.querySelector('tr[data-lbl]'));
      if (!tables.length) return;
      if (!LBL.loaded) { try { await loadLabels(); } catch (e) { return; } }
      tables.forEach(decorateTable);
    });
  }
  const mo = new MutationObserver(() => { if (!pending) decorateAll(); });
  ['billing', 'customers'].forEach((id) => { const el = $(id); if (el) mo.observe(el, { childList: true, subtree: true }); });
  document.addEventListener('click', (e) => { if (e.target.closest('.tab,.stab')) LBL.filter = ''; }, true);

  /* ------------------------------------------------------------------ ledger */
  const PRESETS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year'], ['all', 'All time'], ['custom', 'Custom']];
  const todayIn = (tz) => { try { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; } catch (e) { return U.today(); } };
  function rangeOf(k, custom, t) {
    if (k === 'today') return [t, t];
    if (k === 'yesterday') return [U.addDays(t, -1), U.addDays(t, -1)];
    if (k === '7') return [U.addDays(t, -6), t];
    if (k === '30') return [U.addDays(t, -29), t];
    if (k === 'month') return [t.slice(0, 8) + '01', t];
    if (k === 'lastmonth') { const last = U.addDays(t.slice(0, 8) + '01', -1); return [last.slice(0, 8) + '01', last]; }
    if (k === 'year') return [t.slice(0, 5) + '01-01', t];
    if (k === 'all') return ['all', 'all'];
    return custom && custom[0] && custom[1] ? custom : [U.addDays(t, -29), t];
  }
  const sgn = (r) => `<span class="${r.direction === 'out' ? 'led-out' : 'led-in'}">${r.direction === 'out' ? '-' : '+'}${esc(money(r.amount_cents))}</span>`;
  const usDate = (d) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;

  function ledgerModal(entry, opts, after) {
    const e = entry || { direction: 'out', date: todayIn(opts.timezone), amount_cents: 0 };
    const auto = !!e.auto, isNew = !e.id;
    const dl = (id, list) => `<datalist id="${id}">${(list || []).map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`;
    const dis = auto ? 'disabled' : '';
    const m = U.modal(isNew ? (e.direction === 'in' ? 'Add money in' : 'Add money out') : `${e.direction === 'out' ? 'Money out' : 'Money in'}: ${money(e.amount_cents)}`, `
      <div id="lbar" class="lblbar" ${isNew ? 'hidden' : ''}></div>
      ${auto ? `<div class="notice good">This came from a payment on invoice <strong>${esc(e.invoice_ref)}</strong>, so the amount and date are fixed. The invoice is attached below. To reverse it, refund the payment.</div>` : ''}
      <div class="cform"><div class="grid2">
        <label class="f"><span>Type</span><select id="ld" ${dis}><option value="in" ${e.direction === 'in' ? 'selected' : ''}>Money in</option><option value="out" ${e.direction === 'out' ? 'selected' : ''}>Money out</option></select></label>
        <label class="f"><span>Date</span><input id="dt" type="date" value="${esc(e.date)}" ${dis}></label>
        <label class="f"><span>Amount ($)</span><input id="am" inputmode="decimal" value="${e.amount_cents ? dollars(e.amount_cents) : ''}" ${dis}></label>
        <label class="f"><span>Paid with</span><input id="pw" list="pwl" value="${esc(e.paid_with || '')}" placeholder="Credit card, check, cash..."></label></div>
        <div class="notice" id="mzbox" ${e.direction === 'out' ? 'hidden' : ''}><strong>Maaser: <span id="mzamt">${esc(money(e.id ? e.maaser_cents : 0))}</span></strong> (ten percent of the money in)<label class="check pad"><input type="checkbox" id="mzgiven" ${e.maaser_given ? 'checked' : ''}> Maaser already given. Record it as a charity expense.</label></div>
        <label class="f"><span>Vendor${e.direction === 'in' ? ' or customer' : ''}</span><input id="vn" value="${esc(e.vendor || '')}" placeholder="Who was paid or who paid you" ${dis}></label>
        <div class="grid2"><label class="f"><span>Invoice #</span><input id="iv" value="${esc(e.invoice_ref || '')}" ${dis} placeholder="Their invoice or receipt number"></label>
        <label class="f"><span>Account</span><input id="ac" list="acl" value="${esc(e.account || '')}" placeholder="Which account it went through"></label></div>
        <label class="f"><span>Description</span><input id="ds" value="${esc(e.description || '')}" placeholder="What it was for"></label>
        <label class="f"><span>Category</span><input id="ct" list="ctl" value="${esc(e.category || '')}" placeholder="Software, Sales..."></label>
        <label class="f"><span>Notes</span><textarea id="nt" rows="2">${esc(e.notes || '')}</textarea></label>
        ${dl('pwl', opts.paid_with)}${dl('acl', opts.accounts)}${dl('ctl', opts.categories)}
        <div class="fsec" style="margin-top:12px"><strong>Attachments</strong></div>
        <div id="ledfiles" class="subtle" style="margin:6px 0"></div>
        <label class="small-btn" style="cursor:pointer">${isNew ? 'Choose a receipt or invoice' : 'Upload or replace'}<input type="file" id="ledfile" accept="application/pdf,image/png,image/jpeg,image/webp" hidden></label> <span class="subtle" id="lfn"></span>
        <p class="anote">PDF or photo, up to 10 MB: vendor invoices, receipts, bank statements.</p>
        <p class="form-err" role="alert"></p>
        <div class="modal-actions">${!isNew && !auto ? '<button type="button" class="small-btn danger" id="del">Delete</button>' : ''}<span class="grow"></span><button type="button" class="small-btn primary" id="go">${isNew ? 'Add to ledger' : 'Save'}</button></div></div>`, { wide: false });
    const root = m.el; const q = (s) => root.querySelector(s);
    if (!isNew) bar(q('#lbar'), 'ledger', e.id);
    let picked = null; const wasGiven = !!e.maaser_given;
    const syncMz = () => { const inn = q('#ld').value === 'in'; q('#mzbox').hidden = !inn; const am = toCents(q('#am').value) || e.amount_cents || 0; q('#mzamt').textContent = money(Math.round(am * 0.1)); };
    q('#ld').onchange = syncMz; q('#am').oninput = syncMz; syncMz();
    const showFiles = (x) => {
      q('#ledfiles').innerHTML = [x && x.invoice_id ? `<div>Invoice ${esc(x.invoice_ref)}: <a href="#" data-pdf="${esc(x.invoice_id)}">open PDF</a> (attached automatically)</div>` : '', x && x.has_file ? `<div>${esc(x.file_name || 'File')}: <a href="#" data-lfile="${x.id}">open</a> <button type="button" class="linkbtn" id="rmf">remove</button></div>` : ''].join('') || 'Nothing attached yet.';
      const rm = q('#rmf'); if (rm) rm.onclick = () => guard(async () => { await post('ledger/file-remove', { id: x.id }); x.has_file = false; showFiles(x); after && after(); }, 'File removed');
    };
    showFiles(isNew ? null : e);
    q('#ledfile').onchange = (ev) => { picked = ev.target.files[0] || null; q('#lfn').textContent = picked ? picked.name : ''; if (picked && picked.size > 10 * 1024 * 1024) { toast('That file is over 10 MB.'); picked = null; q('#lfn').textContent = ''; } };
    q('#go').onclick = async () => {
      const err = q('.form-err'); err.textContent = '';
      try {
        const b = { vendor: q('#vn').value, invoice_ref: q('#iv').value, description: q('#ds').value, paid_with: q('#pw').value, account: q('#ac').value, category: q('#ct').value, notes: q('#nt').value };
        if (!auto) { b.direction = q('#ld').value; b.date = q('#dt').value; const am = toCents(q('#am').value); if (!am) { err.textContent = 'Enter the amount.'; return; } b.amount_cents = am; }
        const wantGiven = q('#ld').value === 'in' && q('#mzgiven').checked;
        if (isNew) b.maaser_given = wantGiven; else b.id = e.id;
        const saved = await post('ledger/save', b);
        if (!isNew && q('#ld').value === 'in' && wantGiven !== wasGiven) await post('ledger/maaser', { id: e.id, given: wantGiven });
        if (picked) {
          const res = await fetch(`${B().getApi().base}/admin/b/ledger/file?id=${saved.id}`, { method: 'POST', headers: { Authorization: 'Bearer ' + B().getApi().token(), 'Content-Type': picked.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(picked.name) }, body: picked });
          const j = await res.json().catch(() => ({})); if (!res.ok) throw new Error(`Saved, but the file did not upload: ${j.error || res.status}`);
        }
        m.close(); toast(isNew ? 'Added to the ledger' : 'Saved'); after && after();
      } catch (x) { err.textContent = x.message; }
    };
    const del = q('#del');
    if (del) del.onclick = async () => { if (!(await U.ask('Delete this entry?', 'This removes it from the ledger.', 'Delete', true))) return; await guard(async () => { await post('ledger/delete', { id: e.id }); m.close(); after && after(); }, 'Deleted'); };
  }

  B().defineView('ledger', async (el) => {
    let sel; try { sel = JSON.parse(sessionStorage.getItem('led_sel') || 'null'); } catch (e) { sel = null; }
    sel = sel || { k: 'month', custom: null, dir: '', account: '', category: '', q: '' };
    const save = () => { try { sessionStorage.setItem('led_sel', JSON.stringify(sel)); } catch (e) { /* ignore */ } };
    const opts0 = await api('/admin/b/ledger/options');
    const today = () => todayIn(opts0.timezone);
    const body = () => $('ledbody');
    const tbl = (head, rows) => `<div class="tscroll"><table class="atable"><thead><tr>${head.map((h) => `<th${/^>/.test(h) ? ' class="n"' : ''}>${esc(h.replace(/^>/, ''))}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    let data = null;
    const load = async () => {
      const [from, to] = rangeOf(sel.k, sel.custom, today());
      const qs = new URLSearchParams({ from, to }); if (sel.dir) qs.set('direction', sel.dir); if (sel.account) qs.set('account', sel.account); if (sel.category) qs.set('category', sel.category); if (sel.q) qs.set('q', sel.q);
      data = await api('/admin/b/ledger?' + qs);
      const t = data.totals;
      const cats = {}; for (const c of data.byCategory) { (cats[c.k] = cats[c.k] || { k: c.k, in: 0, out: 0 })[c.direction] = c.c; }
      const catRows = Object.values(cats).sort((a, b) => b.in + b.out - (a.in + a.out));
      const kpi = (l, v, s, cls) => `<div class="kpi ${cls || ''}"><div class="kv">${v}</div><div class="kl">${esc(l)}</div>${s ? `<div class="kd">${s}</div>` : ''}</div>`;
      const rowHtml = data.rows.map((r) => `<tr class="led-row" data-id="${r.id}" data-lbl="ledger:${r.id}">
        <td style="white-space:nowrap">${esc(usDate(r.date))}</td><td>${esc(r.vendor || '')}</td>
        <td>${r.invoice_id ? `<a href="#" data-invlink="${esc(r.invoice_id)}" style="white-space:nowrap">${esc(r.invoice_ref || 'Invoice')}</a>` : esc(r.invoice_ref || '')}</td>
        <td>${esc(r.description || '')}</td><td class="n">${sgn(r)}</td><td>${esc(r.paid_with || '')}</td><td>${esc(r.account || '')}</td><td class="subtle">${esc(r.notes || '')}</td>
        <td class="n">${r.direction === 'in' && r.maaser_cents ? `<label class="mz" title="Tick when the maaser has been given"><span>${esc(money(r.maaser_cents))}</span><input type="checkbox" data-maaser="${r.id}" ${r.maaser_given ? 'checked' : ''} aria-label="Maaser given"><small>${r.maaser_given ? 'given' : 'owed'}</small></label>` : ''}</td>
        <td>${[r.invoice_id ? `<a href="#" data-pdf="${esc(r.invoice_id)}">Invoice PDF</a>` : '', r.has_file ? `<a href="#" data-lfile="${r.id}">${esc(r.file_name || 'File')}</a>` : ''].filter(Boolean).join('<br>') || '<span class="subtle">none</span>'}</td></tr>`);
      body().innerHTML = `<div class="kpis">
        ${kpi('Money in', `<span class="led-in">${esc(money(t.money_in))}</span>`, `${data.rows.filter((r) => r.direction === 'in').length} entries`)}
        ${kpi('Money out', `<span class="led-out">${esc(money(t.money_out))}</span>`, `${data.rows.filter((r) => r.direction === 'out').length} entries`)}
        ${kpi('Net', `<span class="${t.net < 0 ? 'led-out' : ''}">${t.net < 0 ? '-' : ''}${esc(money(Math.abs(t.net)))}</span>`, `${t.entries} entr${t.entries === 1 ? 'y' : 'ies'} counted`)}
        ${kpi('Maaser still owed', esc(money(t.maaser_owed)), `10% of money in &middot; ${esc(money(t.maaser_given))} given`)}</div>
      ${data.rows.length ? tbl(['Date', 'Vendor', 'Invoice #', 'Description', '>Amount', 'Paid with', 'Account', 'Notes', '>Maaser 10%', 'Attached'], rowHtml) : '<div class="aempty">No entries in this period. Payments on invoices appear here by themselves.</div>'}
      <div class="grid2" style="margin-top:18px"><section class="acard"><h3>By category</h3>${catRows.length ? tbl(['Category', '>In', '>Out'], catRows.map((r) => `<tr><td>${esc(r.k)}</td><td class="n">${r.in ? `<span class="led-in">${esc(money(r.in))}</span>` : ''}</td><td class="n">${r.out ? `<span class="led-out">${esc(money(r.out))}</span>` : ''}</td></tr>`)) : '<div class="aempty">Nothing yet.</div>'}</section>
      <section class="acard"><h3>Balance by account <span class="subtle">all time</span></h3>${data.balances.length ? tbl(['Account', '>Entries', '>Net'], data.balances.map((r) => `<tr><td>${esc(r.k)}</td><td class="n">${r.n}</td><td class="n"><span class="${r.net < 0 ? 'led-out' : 'led-in'}">${r.net < 0 ? '-' : ''}${esc(money(Math.abs(r.net)))}</span></td></tr>`)) : '<div class="aempty">Nothing yet.</div>'}</section></div>`;
      $$('tr.led-row', body()).forEach((tr) => tr.addEventListener('click', (ev) => { if (ev.target.closest('a,button,input,label.mz')) return; ledgerModal(data.rows.find((x) => x.id === +tr.dataset.id), opts0, load); }));
      decorateAll();
    };
    const optList = (list, cur, blank) => `<option value="">${blank}</option>${list.map((x) => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('')}`;
    el.innerHTML = `<div class="toolbar"><div class="chips" id="lchips">${PRESETS.map(([k, l]) => `<button class="chip ${k === sel.k ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
      <span id="lcustom" class="custom" ${sel.k === 'custom' ? '' : 'hidden'}><input type="date" id="lfrom" value="${esc(sel.custom ? sel.custom[0] : today().slice(0, 8) + '01')}" aria-label="From"> <span class="subtle">to</span> <input type="date" id="lto" value="${esc(sel.custom ? sel.custom[1] : today())}" aria-label="To"> <button class="small-btn primary" id="lgo">Show</button></span></div>
      <div class="toolbar"><div class="chips" id="ldir">${[['', 'All'], ['in', 'Money in'], ['out', 'Money out']].map(([k, l]) => `<button class="chip ${k === sel.dir ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
        <select id="lacc" aria-label="Account">${optList(opts0.accounts, sel.account, 'All accounts')}</select><select id="lcat" aria-label="Category">${optList(opts0.categories, sel.category, 'All categories')}</select>
        <input type="search" id="lq" placeholder="Search vendor, invoice, notes…" value="${esc(sel.q)}"><span class="grow"></span>
        <button class="small-btn primary" id="lin">+ Money in</button><button class="small-btn primary" id="lout">+ Money out</button><button class="small-btn" id="lex">Export to Excel</button></div>
      <div id="ledbody"><div class="aempty">Loading…</div></div>`;
    const go = () => { save(); load().catch((x) => { body().innerHTML = `<div class="aempty">${esc(x.message)}</div>`; }); };
    $('lchips').onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; sel.k = b.dataset.k; $$('#lchips .chip').forEach((x) => x.classList.toggle('on', x === b)); $('lcustom').hidden = sel.k !== 'custom'; if (sel.k !== 'custom') go(); };
    $('lgo').onclick = () => { const a = $('lfrom').value, b = $('lto').value; if (!a || !b) return toast('Pick both dates'); sel.custom = a <= b ? [a, b] : [b, a]; go(); };
    $('ldir').onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; sel.dir = b.dataset.k; $$('#ldir .chip').forEach((x) => x.classList.toggle('on', x === b)); go(); };
    $('lacc').onchange = (e) => { sel.account = e.target.value; go(); }; $('lcat').onchange = (e) => { sel.category = e.target.value; go(); };
    $('lq').oninput = U.debounce((e) => { sel.q = e.target.value; go(); }, 280);
    $('lin').onclick = () => ledgerModal({ direction: 'in', date: today(), amount_cents: 0 }, opts0, load);
    $('lout').onclick = () => ledgerModal(null, opts0, load);
    $('lex').onclick = async () => {
      const [from, to] = rangeOf(sel.k, sel.custom, today());
      try { const res = await fetch(B().getApi().base + `/admin/b/export?${new URLSearchParams({ kind: 'ledger', from: from === 'all' ? '' : from, to: to === 'all' ? '' : to })}`, { headers: { Authorization: 'Bearer ' + B().getApi().token() } }); if (!res.ok) throw new Error('Export failed'); U.download('ledger.xlsx', await res.blob()); } catch (x) { toast(x.message); }
    };
    go();
  });
  // maaser tick in the table
  document.addEventListener('change', (e) => {
    const c = e.target.closest('[data-maaser]'); if (!c) return;
    guard(async () => { await post('ledger/maaser', { id: +c.dataset.maaser, given: c.checked }); B().refresh(); }, c.checked ? 'Maaser recorded as given' : 'Maaser marked as owed');
  });

  /* ------------------------------------------------------------------ take a payment that is not part of an invoice you wrote */
  async function takePayment(after) {
    const custs = (await api('/admin/b/customers').catch(() => ({ customers: [] }))).customers || [];
    const m = U.modal('Take a payment', `<div class="cform"><p class="anote">For anything that was not invoiced first: a deposit, a fee, a purchase. It becomes a one-line invoice, so the receipt, refunds, the pay page and the ledger all work.</p>
      <label class="f"><span>Customer</span><select id="qc"><option value="">(new customer, fill in below)</option>${custs.map((c) => `<option value="${esc(c.id)}">${esc(c.org || c.name)}${c.org && c.name ? ' — ' + esc(c.name) : ''}</option>`).join('')}</select></label>
      <div id="qnew"><div class="grid2"><label class="f"><span>Name</span><input id="qn" autocomplete="off"></label><label class="f"><span>Organization</span><input id="qo" autocomplete="off"></label></div>
        <div class="grid2"><label class="f"><span>Email</span><input id="qe" type="email"></label><label class="f"><span>Phone</span><input id="qph" type="tel"></label></div></div>
      <div class="grid2"><label class="f"><span>Amount ($)</span><input id="qa" inputmode="decimal"></label><label class="f"><span>What is it for?</span><input id="qd" placeholder="Deposit, fee, hosting..."></label></div>
      <div class="fsec"><strong>How is it being paid?</strong></div>
      <label class="check pad"><input type="radio" name="qm" value="link" checked> Send a card payment link</label>
      <label class="check pad"><input type="radio" name="qm" value="received"> Already received (cash, check, Zelle...)</label>
      <div id="qlink"><label class="check pad"><input type="checkbox" id="qse" checked> Email the link to the customer</label></div>
      <div id="qrec" hidden><div class="grid2"><label class="f"><span>Paid with</span><select id="qpm"><option value="cash">Cash</option><option value="check">Check</option><option value="zelle">Zelle</option><option value="ach">ACH / bank transfer</option><option value="wire">Wire</option><option value="other">Other</option></select></label><label class="f"><span>Reference</span><input id="qr" placeholder="Check number, confirmation..."></label></div>
        <label class="check pad"><input type="checkbox" id="qrc" checked> Email them a receipt</label></div>
      <p class="form-err" role="alert"></p><div id="qout"></div>
      <div class="modal-actions"><span class="grow"></span><button type="button" class="small-btn primary" id="go">Create link</button></div></div>`);
    const root = m.el; const q = (s) => root.querySelector(s);
    const mode = () => root.querySelector('input[name=qm]:checked').value;
    const sync = () => { q('#qnew').hidden = !!q('#qc').value; q('#qlink').hidden = mode() !== 'link'; q('#qrec').hidden = mode() !== 'received'; q('#go').textContent = mode() === 'link' ? 'Create link' : 'Record payment'; };
    root.addEventListener('change', sync); sync();
    q('#go').onclick = async () => {
      const err = q('.form-err'); err.textContent = '';
      try {
        const b = { customer_id: q('#qc').value || null, name: q('#qn').value, org: q('#qo').value, email: q('#qe').value, phone: q('#qph').value, amount_cents: toCents(q('#qa').value), description: q('#qd').value, mode: mode(), send_email: q('#qse').checked, method: q('#qpm').value, reference: q('#qr').value, send_receipt_email: q('#qrc').checked };
        const r = await post('payment/quick', b); after && after();
        if (r.paid) { m.close(); toast(`Payment recorded on ${r.number}`); return; }
        q('#qout').innerHTML = `<div class="notice good"><strong>${esc(r.number)} is ready.</strong>${r.emailed ? ' The link was emailed.' : ''}<div class="inline" style="margin-top:8px"><input readonly value="${esc(r.url)}" id="qurl"><button type="button" class="small-btn" id="qcopy">Copy</button></div><p style="margin:8px 0 0"><a href="${esc(r.url)}" target="_blank" rel="noopener">Open the payment page ↗</a></p></div>`;
        q('#go').hidden = true; const c = q('#qcopy'); if (c) c.onclick = async () => { try { await navigator.clipboard.writeText(r.url); toast('Copied'); } catch (e) { q('#qurl').select(); } };
      } catch (x) { err.textContent = x.message; }
    };
  }

  window.ESLedger = { takePayment, reload: B().refresh };
  window.ESLabels = { bar, decorate: decorateAll };
})();
