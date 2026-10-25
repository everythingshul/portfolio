/* Site chat widget.
 * Works on its own with built-in answers about the projects. If ENDPOINT is set to the deployed
 * chat Worker (worker/chat), answers come from Claude instead, and fall back to the built-ins
 * whenever the Worker can't be reached. */
(() => {
  const ENDPOINT = ''; // e.g. 'https://everythingshul-chat.<account>.workers.dev'
  const EMAIL = 'everythingshul@gmail.com';
  const PROJECTS = window.ES_PROJECTS || [];
  const onHome = !!document.getElementById('work');
  const projectHref = (p) => (onHome ? `#${p.id}` : `index.html#${p.id}`);
  const STORE = 'es-chat-v1';

  /* ---------- built-in answers ---------- */
  const ALIASES = {
    drm: ['drm', 'donor relationship', 'donor management', 'crm', 'kvitel', 'receipt'],
    kipashairbp: ['kipas', 'kipa', 'hair bp', 'bp '],
    kupeshair: ['kupes', 'kupe', 'williamsburg'],
    jlistings: ['jlisting', 'classified', 'editorial'],
    mamudem: ['mamudem', 'ticket', 'dinner', 'qr', 'check-in', 'check in', 'scanner'],
    fundraise: ['fundrais', 'wall', 'pledge'],
  };
  const CHIPS = ['What do you build?', 'Show me your work', 'How does it work?', 'Talk to a person'];
  const contactLink = { label: 'Contact us', href: onHome ? 'contact.html' : 'contact.html' };
  const mailLink = { label: EMAIL, href: `mailto:${EMAIL}` };

  const has = (t, words) => words.some((w) => t.includes(w));

  const projectReply = (p) => ({
    text: `${p.name}: ${p.desc}`,
    links: [
      { label: `See ${p.name} on this page`, href: projectHref(p) },
      { label: 'Visit the site', href: p.url, external: true },
    ],
    chips: ['Show me your work', 'Talk to a person'],
  });

  const localReply = (raw) => {
    const t = ` ${raw.toLowerCase().replace(/[^\w\s\-+&']/g, ' ')} `;

    // A specific project beats everything else (longest alias wins).
    let best = null;
    PROJECTS.forEach((p) => {
      (ALIASES[p.id] || [p.name.toLowerCase()]).forEach((a) => {
        if (t.includes(a) && (!best || a.length > best.len)) best = { p, len: a.length };
      });
    });
    if (best) return projectReply(best.p);

    if (has(t, [' hi ', ' hello', ' hey', 'shalom', 'good morning', 'good evening']))
      return { text: "Hi! I'm the Everything Shul assistant. We build custom software for nonprofits. What would you like to know?", chips: CHIPS };
    if (has(t, ['thank', 'thanks', ' thx']))
      return { text: "You're welcome! Anything else I can help with?", chips: CHIPS };
    if (has(t, [' bye', 'goodbye', 'see you']))
      return { text: 'Take care! If you want to talk about a project, we are one message away.', links: [contactLink] };
    if (has(t, ['price', 'pricing', 'cost', 'quote', 'budget', 'how much', 'afford', 'rate']))
      return { text: "Pricing depends on the project, so we quote it personally after hearing what you need. Tell us about your organization and we'll come back to you.", links: [contactLink, mailLink] };
    if (has(t, ['contact', 'email', 'e-mail', 'reach', 'talk to', 'speak', 'person', 'human', 'someone', 'call', 'phone', 'message']))
      return { text: `The best way is the contact page or email. We usually reply within 1–2 business days.`, links: [contactLink, mailLink] };
    if (has(t, ['how long', 'timeline', 'when can', 'how soon', 'turnaround']))
      return { text: "Timelines depend on what's being built. We'll give you a realistic one once we understand the project.", links: [contactLink] };
    if (has(t, ['process', 'how does it work', 'how do you work', 'steps', 'get started', 'start a project', 'begin', 'how it works']))
      return { text: 'Four steps. Discover: we learn how your organization actually runs. Design: a clear interface built around your people. Build: we build and test it end to end with you involved. Support: we stay on after launch to refine and extend it.', links: [contactLink], chips: ['What do you build?', 'Talk to a person'] };
    if (has(t, ['support', 'maintain', 'maintenance', 'after launch', 'host', 'bug', 'help after']))
      return { text: 'Launch day is day one. We stay on to support, refine and extend every platform we build.', links: [contactLink] };
    if (has(t, ['work', 'portfolio', 'example', 'project', 'show', 'platform', 'built', 'clients', 'see']) && !has(t, ['how does']))
      return {
        text: 'Here is what we have built so far. Tap one to learn more:',
        chips: PROJECTS.map((p) => p.name),
        links: [{ label: 'See all our work', href: onHome ? '#work' : 'index.html#work' }],
      };
    if (has(t, ['build', 'do you do', 'what do you', 'services', 'offer', 'make', 'who are you', 'about', 'what is', 'what are you']))
      return { text: 'We build custom software for nonprofits: donor management, gift-card assistance, classifieds, event ticketing, live fundraising and more. Every platform is designed around how your organization actually runs, and we support it after launch.', chips: ['Show me your work', 'How does it work?', 'Talk to a person'] };
    if (has(t, ['custom', 'need', 'idea', 'looking for', 'our organization', 'my organization', 'our shul', 'my shul', 'can you', 'could you']))
      return { text: "That sounds like something we can help with. The quickest way is to tell us a bit about what you run and what's slowing you down, and we'll take it from there.", links: [contactLink, mailLink] };

    return { text: "I'm not sure about that one, but the team can answer it properly. Reach them here:", links: [contactLink, mailLink], chips: CHIPS };
  };

  /* ---------- state ---------- */
  let history = []; // {role: 'user'|'bot', text, links?, chips?}
  try { history = JSON.parse(sessionStorage.getItem(STORE) || '[]'); } catch (e) { history = []; }
  const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify(history.slice(-30))); } catch (e) { /* ignore */ } };

  /* ---------- DOM ---------- */
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const autolink = (s) => esc(s)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/([\w.+-]+@[\w-]+\.[\w.]+[\w])/g, '<a href="mailto:$1">$1</a>')
    .replace(/\n/g, '<br>');

  const fab = el('button', 'chat-fab',
    '<span class="chat-fab-ring"></span>' +
    '<svg class="chat-ico-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>' +
    '<svg class="chat-ico-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>');
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Open chat');
  fab.setAttribute('aria-expanded', 'false');

  const nudge = el('div', 'chat-nudge', 'Questions? Ask us anything.');
  const panel = el('section', 'chat-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat with Everything Shul');
  panel.innerHTML =
    '<header class="chat-head"><img src="assets/favicon-32.png" alt="" width="32" height="32"><div><strong>Everything Shul</strong><span><i></i>Ask us about our work</span></div>' +
    '<button type="button" class="chat-x" aria-label="Close chat">×</button></header>' +
    '<div class="chat-log" aria-live="polite"></div>' +
    '<div class="chat-chips"></div>' +
    '<form class="chat-form"><input type="text" maxlength="500" placeholder="Type your question…" aria-label="Your message" autocomplete="off"><button type="submit" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>';
  document.body.append(panel, nudge, fab);

  const log = panel.querySelector('.chat-log');
  const chipsBox = panel.querySelector('.chat-chips');
  const form = panel.querySelector('.chat-form');
  const input = form.querySelector('input');

  const scroll = () => { log.scrollTop = log.scrollHeight; };

  const addMessage = (m, animate = true) => {
    const row = el('div', `chat-msg ${m.role}${animate ? ' pop' : ''}`);
    const bubble = el('div', 'chat-bubble', m.role === 'bot' ? autolink(m.text) : esc(m.text));
    row.appendChild(bubble);
    if (m.links && m.links.length) {
      const wrap = el('div', 'chat-links');
      m.links.forEach((l) => {
        const a = el('a', 'chat-link', esc(l.label) + (l.external ? ' ↗' : ''));
        a.href = l.href;
        if (l.external) { a.target = '_blank'; a.rel = 'noopener'; }
        if (l.href.startsWith('#')) a.addEventListener('click', () => close());
        wrap.appendChild(a);
      });
      row.appendChild(wrap);
    }
    log.appendChild(row);
    scroll();
  };

  const setChips = (chips) => {
    chipsBox.innerHTML = '';
    (chips || []).forEach((c, i) => {
      const b = el('button', 'chat-chip', esc(c));
      b.type = 'button';
      b.style.setProperty('--i', i);
      b.addEventListener('click', () => ask(c));
      chipsBox.appendChild(b);
    });
    // The chip row changes the log's height; keep the latest message in view.
    requestAnimationFrame(scroll);
  };

  const typing = () => {
    const row = el('div', 'chat-msg bot pop typing', '<div class="chat-bubble"><span></span><span></span><span></span></div>');
    log.appendChild(row);
    scroll();
    return row;
  };

  /* ---------- asking ---------- */
  let busy = false;

  const aiReply = async () => {
    const msgs = history.slice(-10).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
    const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: msgs }) });
    if (!res.ok) throw new Error('chat unavailable');
    const data = await res.json();
    if (!data.reply) throw new Error('empty');
    return { text: data.reply, links: [], chips: ['Talk to a person'] };
  };

  const ask = async (text) => {
    text = text.trim();
    if (!text || busy) return;
    busy = true;
    input.value = '';
    setChips([]);
    const q = { role: 'user', text };
    history.push(q);
    addMessage(q);
    const t = typing();
    const started = Date.now();
    let reply;
    if (ENDPOINT) {
      try { reply = await aiReply(); } catch (e) { reply = null; }
    }
    if (!reply) reply = localReply(text);
    // Keep the typing dots up for a beat so it feels like a conversation.
    await new Promise((r) => setTimeout(r, Math.max(0, 650 - (Date.now() - started))));
    t.remove();
    const m = { role: 'bot', text: reply.text, links: reply.links || [], chips: reply.chips || [] };
    history.push(m);
    addMessage(m);
    setChips(m.chips);
    save();
    busy = false;
    input.focus();
  };

  form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });

  /* ---------- open / close ---------- */
  let isOpen = false;
  const open = () => {
    isOpen = true;
    panel.classList.add('open');
    fab.classList.add('open');
    fab.setAttribute('aria-expanded', 'true');
    fab.setAttribute('aria-label', 'Close chat');
    nudge.classList.remove('show');
    try { sessionStorage.setItem(STORE + '-nudged', '1'); } catch (e) { /* ignore */ }
    if (!history.length) {
      const hello = { role: 'bot', text: "Hi! I can tell you about the platforms we've built, how we work, or put you in touch with the team.", links: [], chips: CHIPS };
      history.push(hello);
      addMessage(hello);
      setChips(hello.chips);
      save();
    }
    setTimeout(() => input.focus({ preventScroll: true }), 250);
  };
  function close() {
    isOpen = false;
    panel.classList.remove('open');
    fab.classList.remove('open');
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('aria-label', 'Open chat');
  }

  fab.addEventListener('click', () => (isOpen ? close() : open()));
  panel.querySelector('.chat-x').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) { close(); fab.focus(); } });

  // Restore the conversation (without animation); show a one-time nudge.
  history.forEach((m) => addMessage(m, false));
  if (history.length) setChips((history[history.length - 1].chips) || []);
  let nudged = false;
  try { nudged = !!sessionStorage.getItem(STORE + '-nudged'); } catch (e) { /* ignore */ }
  if (!nudged) setTimeout(() => { if (!isOpen) nudge.classList.add('show'); }, 7000);
  nudge.addEventListener('click', open);
})();
