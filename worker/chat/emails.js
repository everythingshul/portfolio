// Email templates for the chat handoff. Same look as the contact-form emails
// (dark brown header, white card on cream, gold accents, Georgia headings).
export const C = {
  bg: '#f3ede2', panel: '#ffffff', panel2: '#f7f2e8', dark: '#241a15', body: '#3a2e24',
  muted: '#8a7c63', border: '#e5dcc8', gold: '#c9a76a', goldDark: '#a9773f',
};

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const multiline = (s) => esc(s).replace(/\r?\n/g, '<br>');

export function shell({ siteUrl, preheader, title, content }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${C.panel};border:1px solid ${C.border};border-radius:10px;overflow:hidden;">
<tr><td style="background:${C.dark};padding:22px 28px;border-bottom:3px solid ${C.gold};">
<a href="${esc(siteUrl)}" style="text-decoration:none;"><img src="${esc(siteUrl)}/assets/logo-light.png" alt="Everything Shul" height="44" style="display:block;height:44px;width:auto;border:0;"></a>
</td></tr>
<tr><td style="padding:30px 28px 8px;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;color:${C.body};font-size:15px;line-height:1.6;">
${content}
</td></tr>
<tr><td style="padding:18px 28px 26px;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;font-size:12.5px;color:${C.muted};border-top:1px solid ${C.border};background:${C.panel2};">
Everything Shul &middot; <a href="${esc(siteUrl)}" style="color:${C.goldDark};">everythingshul.com</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

export const heading = (t) =>
  `<h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.25;color:${C.dark};font-weight:normal;">${esc(t)}</h1>`;
export const quote = (t) =>
  `<div style="background:${C.panel2};border-left:3px solid ${C.gold};padding:14px 16px;border-radius:4px;margin:0 0 22px;">${multiline(t)}</div>`;
export const button = (href, label) =>
  `<a href="${esc(href)}" style="display:inline-block;background:${C.goldDark};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">${esc(label)}</a>`;

// To the team: a visitor asked for a person, or sent another message.
export function adminNotification(conv, text, link, siteUrl, isNew) {
  const who = conv.name ? `${conv.name} (${conv.email})` : conv.email;
  const context = isNew && conv.messages.length > 1
    ? `<p style="margin:0 0 8px;font-size:12.5px;text-transform:uppercase;letter-spacing:.05em;color:${C.muted};">Chat before the handoff</p>` +
      quote(conv.messages.slice(0, -1).slice(-8).map((m) => `${m.from === 'customer' ? 'Visitor' : 'Chesky'}: ${m.text}`).join('\n'))
    : '';
  const content = `${heading(isNew ? 'New chat request' : 'New message in a chat')}
<p style="margin:0 0 18px;"><strong>${esc(who)}</strong> wrote on the website chat:</p>
${quote(text)}
${context}
<p style="margin:0 0 22px;">${button(link, 'Reply in the admin page')}</p>
<p style="margin:0 0 24px;font-size:13px;color:${C.muted};">Replying in the admin page shows your answer in their chat and emails it to them. Replying to this email goes to their inbox only.</p>`;
  return shell({ siteUrl, preheader: `${conv.name || conv.email}: ${text.slice(0, 90)}`, title: 'Chat message', content });
}

// To the visitor: we have your message.
export function customerConfirmation(conv, link, siteUrl) {
  const first = (conv.name || '').trim().split(/\s+/)[0];
  const content = `${heading(first ? `Thanks, ${first}. The team has your message.` : 'The team has your message.')}
<p style="margin:0 0 16px;">A real person from Everything Shul will reply, usually within 1 to 2 business days. You'll get the reply here by email, and it will also appear in the chat on our website.</p>
<p style="margin:0 0 8px;font-size:12.5px;text-transform:uppercase;letter-spacing:.05em;color:${C.muted};">Your message</p>
${quote(conv.messages.filter((m) => m.from === 'customer').slice(-1)[0].text)}
<p style="margin:0 0 24px;">${button(link, 'Open the chat')}</p>
<p style="margin:0 0 24px;">Talk soon,<br><span style="font-family:Georgia,'Times New Roman',serif;color:${C.dark};">The Everything Shul team</span></p>`;
  return shell({ siteUrl, preheader: 'We received your message and will reply soon.', title: 'We received your message', content });
}

// To the visitor: the team replied.
export function customerReply(conv, text, link, siteUrl) {
  const first = (conv.name || '').trim().split(/\s+/)[0];
  const content = `${heading(first ? `${first}, the team replied` : 'The team replied')}
${quote(text)}
<p style="margin:0 0 20px;">${button(link, 'Continue the chat')}</p>
<p style="margin:0 0 24px;font-size:13px;color:${C.muted};">You can also just reply to this email.</p>`;
  return shell({ siteUrl, preheader: text.slice(0, 100), title: 'Reply from Everything Shul', content });
}

// Weekly summary for the team.
export function digestEmail(d, siteUrl, link, label) {
  const t = d.totals, pr = d.previous || {};
  const delta = (a, b, lowerIsBetter) => {
    if (b == null || !isFinite(b)) return '';
    if (!b) return a ? ' <span style="color:#4c7a4f;">new</span>' : '';
    const ch = Math.round(((a - b) / b) * 100);
    if (!ch) return ' <span style="color:' + C.muted + ';">no change</span>';
    const good = lowerIsBetter ? ch < 0 : ch > 0;
    return ' <span style="color:' + (good ? '#4c7a4f' : '#a6432f') + ';">' + (ch > 0 ? '+' : '') + ch + '%</span>';
  };
  const mins = (s) => (s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : s + 's');
  const kpi = (name, val, extra) =>
    `<td style="padding:12px 10px;text-align:center;border:1px solid ${C.border};background:${C.panel2};"><div style="font-family:Georgia,serif;font-size:26px;color:${C.dark};">${val}</div><div style="font-size:12px;color:${C.muted};text-transform:uppercase;letter-spacing:.05em;">${esc(name)}</div><div style="font-size:12px;">${extra || ''}</div></td>`;
  const list = (rows, a, b) => rows.length
    ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">' + rows.map((r) => `<tr><td style="padding:7px 0;border-bottom:1px solid ${C.border};">${esc(a(r))}</td><td style="padding:7px 0;border-bottom:1px solid ${C.border};text-align:right;color:${C.dark};">${esc(b(r))}</td></tr>`).join('') + '</table>'
    : `<p style="margin:0 0 22px;color:${C.muted};">Nothing yet.</p>`;
  const sub = (x) => `<p style="margin:0 0 6px;font-size:12.5px;text-transform:uppercase;letter-spacing:.05em;color:${C.muted};">${esc(x)}</p>`;
  const f = d.funnel || {}, chat = d.chat || {}, form = d.form || {};
  const content = `${heading('Your week on the website')}
<p style="margin:0 0 18px;">${esc(label)}. Compared with the week before.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:0 0 24px;"><tr>
${kpi('Visitors', t.visitors, delta(t.visitors, pr.visitors))}${kpi('Visits', t.sessions, delta(t.sessions, pr.sessions))}${kpi('Pageviews', t.pageviews, delta(t.pageviews, pr.pageviews))}
</tr><tr>
${kpi('Time on site', mins(t.avgEngaged), delta(t.avgEngaged, pr.avgEngaged))}${kpi('Bounce rate', t.bounceRate + '%', delta(t.bounceRate, pr.bounceRate, true))}${kpi('Pages / visit', t.pagesPerSession, '')}
</tr></table>
${sub('Where visitors came from')}${list(d.channels.slice(0, 6), (r) => r.channel, (r) => r.sessions + ' visits')}
${sub('Most viewed pages')}${list(d.pages.slice(0, 6), (r) => r.path, (r) => r.views + ' views')}
${sub('Projects people looked at')}${list(d.projects.slice(0, 6), (r) => r.proj, (r) => `${r.viewers} saw it, ${r.tour_opens || 0} watched, ${r.visits || 0} visited`)}
${sub('What visitors did')}${list([
    ['Contact form messages sent', form.oks || 0], ['Chats opened', chat.opens || 0], ['Chats handed to the team', chat.handoffs || 0],
    ['Tours watched', (d.video || {}).opens || 0], ['Project links shared', f.shared || 0],
  ], (r) => r[0], (r) => r[1])}
<p style="margin:0 0 24px;">${button(link, 'Open the full analytics')}</p>
<p style="margin:0 0 24px;font-size:12.5px;color:${C.muted};">These numbers count visits without cookies and never store IP addresses. Turn this email off by setting DIGEST to "off" in the chat Worker's settings.</p>`;
  return shell({ siteUrl, preheader: `${t.visitors} visitors, ${t.pageviews} pageviews`, title: 'Weekly website summary', content });
}
