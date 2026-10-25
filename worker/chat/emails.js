// Email templates for the chat handoff. Same look as the contact-form emails
// (dark brown header, white card on cream, gold accents, Georgia headings).
const C = {
  bg: '#f3ede2', panel: '#ffffff', panel2: '#f7f2e8', dark: '#241a15', body: '#3a2e24',
  muted: '#8a7c63', border: '#e5dcc8', gold: '#c9a76a', goldDark: '#a9773f',
};

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const multiline = (s) => esc(s).replace(/\r?\n/g, '<br>');

function shell({ siteUrl, preheader, title, content }) {
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

const heading = (t) =>
  `<h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.25;color:${C.dark};font-weight:normal;">${esc(t)}</h1>`;
const quote = (t) =>
  `<div style="background:${C.panel2};border-left:3px solid ${C.gold};padding:14px 16px;border-radius:4px;margin:0 0 22px;">${multiline(t)}</div>`;
const button = (href, label) =>
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
