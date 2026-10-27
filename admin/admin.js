/* Admin inbox for the website chat: answer visitors, and teach Chesky. Talks to worker/chat with a Bearer password. */
(() => {
  const API = (window.ES_CHAT_ENDPOINT || '').replace(/\/$/, '');
  const KEY = 'es-admin-token';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let token = '';
  try { token = localStorage.getItem(KEY) || ''; } catch (e) { /* ignore */ }
  window.esToast = (m) => toast(m);
  let current = null;   // open conversation id
  let tab = 'chats';
  let timer = null;
  let lastUnread = null;

  const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3200); };
  const ago = (ts) => {
    const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'now';
    if (s < 3600) return Math.round(s / 60) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    return Math.round(s / 86400) + 'd';
  };

  async function api(path, opts = {}) {
    if (!API) throw new Error('The chat server address is not set yet (js/chat-config.js).');
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) { const e = new Error('Wrong password'); e.auth = true; throw e; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function showGate(msg) {
    $('app').hidden = true; $('gate').hidden = false;
    $('gate-err').textContent = msg || '';
    clearInterval(timer);
  }

  /* ------------------------------------------------------------------ tabs */
  function setTab(name) {
    tab = name;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $('layout').hidden = name !== 'chats';
    $('teach').hidden = name !== 'teach';
    $('analytics').hidden = name !== 'analytics';
    if (window.ESAnalytics && name !== 'analytics') window.ESAnalytics.hide();
    if (name === 'teach') { history.replaceState(null, '', '#teach'); loadTeach(); }
    else if (name === 'analytics') { history.replaceState(null, '', '#analytics'); window.ESAnalytics.show(api, API, () => token); }
    else if (location.hash === '#teach' || location.hash === '#analytics') history.replaceState(null, '', location.pathname);
  }
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  /* ------------------------------------------------------------------ chats */
  async function loadList() {
    try {
      const { conversations } = await api('/admin/list');
      $('app').hidden = false; $('gate').hidden = true;
      const unread = conversations.filter((c) => c.unread).length;
      $('tab-chats').textContent = unread ? String(unread) : '';
      setTitle();
      $('status').textContent = conversations.length ? `${conversations.length} conversation${conversations.length === 1 ? '' : 's'}, ${unread} unread` : 'No conversations yet';
      if (lastUnread !== null && unread > lastUnread && document.hidden) toast('New chat message');
      lastUnread = unread;
      const list = $('list');
      if (!conversations.length) { list.innerHTML = '<div class="empty">No chats yet. When a visitor asks for the team, it shows up here.</div>'; return; }
      list.innerHTML = conversations.map((c) =>
        `<button class="item${c.id === current ? ' active' : ''}" data-id="${esc(c.id)}">
           <div class="row1"><span>${c.unread ? '<i class="dot"></i>' : ''}${esc(c.name || c.email)}${c.status === 'closed' ? '<span class="tag">closed</span>' : ''}</span><time>${ago(c.updated)}</time></div>
           <div class="row2">${c.lastFrom === 'admin' ? 'You: ' : ''}${esc(c.last)}</div>
         </button>`).join('');
      list.querySelectorAll('.item').forEach((b) => b.addEventListener('click', () => openConv(b.dataset.id)));
    } catch (e) {
      if (e.auth) { try { localStorage.removeItem(KEY); } catch (x) { /* ignore */ } showGate('That password was not accepted.'); }
      else { $('status').textContent = e.message; }
    }
  }
  function setTitle() {
    const n = (parseInt($('tab-chats').textContent, 10) || 0) + (parseInt($('tab-teach').textContent, 10) || 0);
    document.title = (n ? `(${n}) ` : '') + 'Chat inbox — Everything Shul';
  }

  async function openConv(id, keepDraft) {
    current = id;
    history.replaceState(null, '', '#' + id);
    $('layout').classList.add('open');
    try {
      const c = await api('/admin/conv?id=' + encodeURIComponent(id));
      const keep = keepDraft && $('draft') ? { d: $('draft').value, t: $('teach-on') && $('teach-on').checked } : { d: '', t: false };
      const lastQ = [...c.messages].reverse().find((m) => m.from === 'customer' && !m.voice);
      $('conv').innerHTML =
        `<div class="conv-head"><div><button class="small-btn back" id="back">‹ Back</button> <strong>${esc(c.name || c.email)}</strong><br><a href="mailto:${esc(c.email)}">${esc(c.email)}</a>${c.status === 'closed' ? '<span class="tag">closed</span>' : ''}</div>
           <div class="actions"><button class="small-btn" id="toggle">${c.status === 'closed' ? 'Reopen' : 'Close'}</button><button class="small-btn danger" id="del">Delete</button></div></div>
         <div class="msgs" id="msgs">${c.messages.map((m) =>
           `<div class="m ${m.from}">${m.voice ? '<div class="vslot"></div>' : esc(m.text)}<small>${m.from === 'customer' ? 'Visitor' : m.from === 'admin' ? 'You' : 'Chesky'} · ${new Date(m.ts).toLocaleString()}</small></div>`).join('')}</div>
         <form class="reply" id="reply"><textarea id="draft" placeholder="Write your reply. It appears in their chat and is emailed to them." maxlength="4000"></textarea>
           <label class="check"><input type="checkbox" id="teach-on"> Also teach Chesky this answer, so he can answer similar questions himself</label>
           <div class="teach-box" id="teach-box" hidden>
             <label>The question it answers <input type="text" id="teach-q" maxlength="200"></label>
             <label>What Chesky should say (edit out names and anything personal)<textarea id="teach-a" maxlength="1500"></textarea></label>
             <label>Other ways people ask this (one per line, optional)<textarea id="teach-alts" rows="2" maxlength="800"></textarea></label>
           </div>
           <div class="bar"><span>Ctrl or Cmd + Enter to send</span><button class="btn" type="submit">Send reply</button></div></form>`;
      $('draft').value = keep.d;
      $('teach-q').value = lastQ ? lastQ.text.slice(0, 200) : '';
      let aEdited = false;
      $('teach-a').addEventListener('input', () => { aEdited = true; });
      $('draft').addEventListener('input', () => { if (!aEdited) $('teach-a').value = $('draft').value; });
      $('teach-on').checked = keep.t;
      const syncBox = () => { $('teach-box').hidden = !$('teach-on').checked; if ($('teach-on').checked && !aEdited && !$('teach-a').value) $('teach-a').value = $('draft').value; };
      $('teach-on').addEventListener('change', syncBox); syncBox();
      const vms = c.messages.filter((m) => m.voice);
      document.querySelectorAll('#msgs .vslot').forEach((slot, i) => { const v = vms[i].voice; slot.appendChild(window.ESVoice.player({ url: `${API}/voice?id=${encodeURIComponent(v.id)}`, dur: v.dur, peaks: v.peaks })); });
      const msgs = $('msgs'); msgs.scrollTop = msgs.scrollHeight;
      $('back').onclick = () => { $('layout').classList.remove('open'); current = null; history.replaceState(null, '', location.pathname); loadList(); };
      $('toggle').onclick = async () => { await api('/admin/status', { method: 'POST', body: { id, status: c.status === 'closed' ? 'open' : 'closed' } }); toast(c.status === 'closed' ? 'Reopened' : 'Closed'); openConv(id); loadList(); };
      $('del').onclick = async () => { if (!confirm('Delete this conversation for good?')) return; await api('/admin/delete', { method: 'POST', body: { id } }); toast('Deleted'); current = null; $('conv').innerHTML = '<div class="empty">Pick a conversation to read it.</div>'; $('layout').classList.remove('open'); loadList(); };
      const send = async () => {
        const text = $('draft').value.trim();
        if (!text) return;
        const body = { id, text };
        if ($('teach-on').checked) {
          const q = $('teach-q').value.trim(); const a = $('teach-a').value.trim();
          if (!q || !a) { toast('Add the question and the answer for Chesky, or untick the box.'); return; }
          body.teach = { q, a, alts: $('teach-alts').value.split('\n').map((x) => x.trim()).filter(Boolean) };
        }
        const btn = $('reply').querySelector('button[type=submit]'); btn.disabled = true;
        try {
          const r = await api('/admin/reply', { method: 'POST', body });
          toast((r.emailed ? 'Sent in chat and by email' : 'Sent in chat, but the email failed') + (r.taught && r.taught.id ? '. Chesky learned it.' : ''));
          openConv(id); loadList(); loadTeachCount();
        } catch (e) { toast(e.message); btn.disabled = false; }
      };
      $('reply').addEventListener('submit', (ev) => { ev.preventDefault(); send(); });
      $('draft').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); send(); } });
      loadList();
    } catch (e) { toast(e.message); }
  }

  /* ------------------------------------------------------------------ teaching */
  async function loadTeachCount() {
    try { const d = await api('/admin/learn'); $('tab-teach').textContent = d.unanswered.length ? String(d.unanswered.length) : ''; setTitle(); return d; } catch (e) { return null; }
  }

  async function loadTeach() {
    const d = await loadTeachCount();
    if (!d) { $('unans').innerHTML = '<div class="empty">Could not load. Try again in a moment.</div>'; return; }
    $('n-unans').textContent = d.unanswered.length || '';
    $('n-learned').textContent = '';
    $('unans').innerHTML = d.unanswered.length ? d.unanswered.map((u) =>
      `<div class="card" data-key="${esc(u.key)}">
         <div class="q">“${esc(u.q)}”</div>
         <div class="meta">${u.miss ? `Couldn't answer ×${u.miss}` : ''}${u.miss && u.down ? ' · ' : ''}${u.down ? `Thumbs-down ×${u.down}` : ''}${u.entries && u.entries.length ? ` on <code>${u.entries.map(esc).join('</code> <code>')}</code>` : ''} · ${ago(u.last)} ago</div>
         <textarea class="a" rows="3" placeholder="What should Chesky say to this?" maxlength="1500"></textarea>
         <textarea class="alts" rows="2" placeholder="Other ways people ask this, one per line (optional)" maxlength="800"></textarea>
         <div class="row"><button class="btn teach-btn">Teach Chesky</button><button class="small-btn dismiss-btn">Dismiss</button></div>
       </div>`).join('') : '<div class="empty">Nothing waiting. When Chesky can\'t answer something or gets a thumbs-down, it shows up here.</div>';
    $('unans').querySelectorAll('.card').forEach((card) => {
      const key = card.dataset.key; const u = d.unanswered.find((x) => x.key === key);
      card.querySelector('.teach-btn').addEventListener('click', async () => {
        const a = card.querySelector('.a').value.trim();
        if (!a) { toast('Write the answer first.'); return; }
        const alts = card.querySelector('.alts').value.split('\n').map((x) => x.trim()).filter(Boolean);
        try { await api('/admin/teach', { method: 'POST', body: { qs: [u.q, ...alts], r: a, drop: [u.q] } }); toast('Chesky learned it'); loadTeach(); } catch (e) { toast(e.message); }
      });
      card.querySelector('.dismiss-btn').addEventListener('click', async () => { await api('/admin/dismiss', { method: 'POST', body: { key } }); loadTeach(); });
    });

    $('n-learned').textContent = d.learned.length || '';
    $('learned').innerHTML = d.learned.length ? d.learned.map((l) => {
      const st = d.stats['L:' + l.id] || { up: 0, down: 0 };
      return `<div class="card" data-id="${esc(l.id)}">
         <div class="q">${l.qs.map((q) => '“' + esc(q) + '”').join('<br>')}</div>
         <div class="ans">${esc(l.r)}</div>
         <div class="meta">👍 ${st.up} · 👎 ${st.down}${st.down > st.up ? ' · <strong>visitors are not happy with this one</strong>' : ''}</div>
         <div class="row"><button class="small-btn edit-btn">Edit</button><button class="small-btn danger forget-btn">Forget</button></div>
       </div>`;
    }).join('') : '<div class="empty">Nothing yet. Teach him something above, or tick "Also teach Chesky" when you reply to a chat.</div>';
    $('learned').querySelectorAll('.card').forEach((card) => {
      const l = d.learned.find((x) => x.id === card.dataset.id);
      card.querySelector('.forget-btn').addEventListener('click', async () => { if (!confirm('Make Chesky forget this answer?')) return; await api('/admin/forget', { method: 'POST', body: { id: l.id } }); toast('Forgotten'); loadTeach(); });
      card.querySelector('.edit-btn').addEventListener('click', () => {
        card.innerHTML = `<label class="meta">Questions (one per line)</label><textarea class="qs" rows="3" maxlength="1200">${esc(l.qs.join('\n'))}</textarea>
          <label class="meta">Answer</label><textarea class="a" rows="4" maxlength="1500">${esc(l.r)}</textarea>
          <div class="row"><button class="btn save-btn">Save</button><button class="small-btn cancel-btn">Cancel</button></div>`;
        card.querySelector('.cancel-btn').addEventListener('click', loadTeach);
        card.querySelector('.save-btn').addEventListener('click', async () => {
          const qs = card.querySelector('.qs').value.split('\n').map((x) => x.trim()).filter(Boolean); const r = card.querySelector('.a').value.trim();
          try { await api('/admin/teach', { method: 'POST', body: { id: l.id, qs, r } }); toast('Saved'); loadTeach(); } catch (e) { toast(e.message); }
        });
      });
    });
  }

  /* ------------------------------------------------------------------ start */
  function start() {
    if (!token) return showGate('');
    loadList().then(() => {
      loadTeachCount();
      const h = location.hash.slice(1);
      if (h === 'teach') setTab('teach');
      else if (h === 'analytics') setTab('analytics');
      else if (h && !$('app').hidden) openConv(h);
    });
    clearInterval(timer);
    timer = setInterval(() => {
      if ($('app').hidden) return;
      loadList(); loadTeachCount();
      const d = $('draft');
      if (tab === 'chats' && current && !(d && d.value)) openConv(current, true);  // refresh the open chat unless a reply is being typed
    }, 10000);
  }

  $('gate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    token = $('token').value.trim();
    try { localStorage.setItem(KEY, token); } catch (x) { /* ignore */ }
    start();
  });
  $('logout').addEventListener('click', () => { try { localStorage.removeItem(KEY); } catch (x) { /* ignore */ } token = ''; current = null; showGate(''); });
  start();
})();
