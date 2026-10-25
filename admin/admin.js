/* Admin inbox for the website chat. Talks to worker/chat with a Bearer password. */
(() => {
  const API = (window.ES_CHAT_ENDPOINT || '').replace(/\/$/, '');
  const KEY = 'es-admin-token';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let token = '';
  try { token = localStorage.getItem(KEY) || ''; } catch (e) { /* ignore */ }
  let current = null;   // open conversation id
  let timer = null;
  let lastUnread = 0;

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

  async function loadList() {
    try {
      const { conversations } = await api('/admin/list');
      $('app').hidden = false; $('gate').hidden = true;
      const unread = conversations.filter((c) => c.unread).length;
      document.title = (unread ? `(${unread}) ` : '') + 'Chat inbox — Everything Shul';
      $('status').textContent = conversations.length ? `${conversations.length} conversation${conversations.length === 1 ? '' : 's'}, ${unread} unread` : 'No conversations yet';
      if (unread > lastUnread && lastUnread !== null && document.hidden) toast('New chat message');
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

  async function openConv(id, keepDraft) {
    current = id;
    location.hash = id;
    $('layout').classList.add('open');
    try {
      const c = await api('/admin/conv?id=' + encodeURIComponent(id));
      const draft = keepDraft && $('draft') ? $('draft').value : '';
      $('conv').innerHTML =
        `<div class="conv-head"><div><button class="small-btn back" id="back">‹ Back</button> <strong>${esc(c.name || c.email)}</strong><br><a href="mailto:${esc(c.email)}">${esc(c.email)}</a>${c.status === 'closed' ? '<span class="tag">closed</span>' : ''}</div>
           <div class="actions"><button class="small-btn" id="toggle">${c.status === 'closed' ? 'Reopen' : 'Close'}</button><button class="small-btn danger" id="del">Delete</button></div></div>
         <div class="msgs" id="msgs">${c.messages.map((m) =>
           `<div class="m ${m.from}">${esc(m.text)}<small>${m.from === 'customer' ? 'Visitor' : m.from === 'admin' ? 'You' : 'Chesky'} · ${new Date(m.ts).toLocaleString()}</small></div>`).join('')}</div>
         <form class="reply" id="reply"><textarea id="draft" placeholder="Write your reply. It appears in their chat and is emailed to them." maxlength="4000"></textarea>
           <div class="bar"><span>Ctrl or Cmd + Enter to send</span><button class="btn" type="submit">Send reply</button></div></form>`;
      $('draft').value = draft;
      const msgs = $('msgs'); msgs.scrollTop = msgs.scrollHeight;
      $('back').onclick = () => { $('layout').classList.remove('open'); current = null; history.replaceState(null, '', location.pathname); loadList(); };
      $('toggle').onclick = async () => { await api('/admin/status', { method: 'POST', body: { id, status: c.status === 'closed' ? 'open' : 'closed' } }); toast(c.status === 'closed' ? 'Reopened' : 'Closed'); openConv(id); loadList(); };
      $('del').onclick = async () => { if (!confirm('Delete this conversation for good?')) return; await api('/admin/delete', { method: 'POST', body: { id } }); toast('Deleted'); current = null; $('conv').innerHTML = '<div class="empty">Pick a conversation to read it.</div>'; $('layout').classList.remove('open'); loadList(); };
      const send = async () => {
        const text = $('draft').value.trim();
        if (!text) return;
        const btn = $('reply').querySelector('button[type=submit]'); btn.disabled = true;
        try {
          const r = await api('/admin/reply', { method: 'POST', body: { id, text } });
          toast(r.emailed ? 'Sent in chat and by email' : 'Sent in chat, but the email failed');
          openConv(id); loadList();
        } catch (e) { toast(e.message); btn.disabled = false; }
      };
      $('reply').addEventListener('submit', (ev) => { ev.preventDefault(); send(); });
      $('draft').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); send(); } });
      loadList();
    } catch (e) { toast(e.message); }
  }

  function start() {
    if (!token) return showGate('');
    loadList().then(() => {
      const h = location.hash.slice(1);
      if (h && !$('app').hidden) openConv(h);
    });
    clearInterval(timer);
    timer = setInterval(() => {
      if (!$('app').hidden) {
        loadList();
        const d = $('draft');
        if (current && !(d && d.value)) openConv(current, true);  // refresh the open chat unless a reply is being typed
      }
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
