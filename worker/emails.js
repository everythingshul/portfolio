// Email templates. Layout and palette follow the kipashairbp.org emails:
// white card on cream, dark brown header, gold accents, Georgia headings.
const C = {
  bg: '#f3ede2',
  panel: '#ffffff',
  panel2: '#f7f2e8',
  dark: '#241a15',
  body: '#3a2e24',
  muted: '#8a7c63',
  border: '#e5dcc8',
  gold: '#c9a76a',
  goldDark: '#a9773f',
  goldLight: '#e3cf9e',
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

const row = (label, value) =>
  `<tr><td style="padding:9px 14px;width:140px;font-size:12.5px;text-transform:uppercase;letter-spacing:.05em;color:${C.muted};border-bottom:1px solid ${C.border};vertical-align:top;">${esc(label)}</td>
<td style="padding:9px 14px;color:${C.body};border-bottom:1px solid ${C.border};">${value}</td></tr>`;

export function notificationEmail({ name, email, org, interest, message }, siteUrl, voiceLength) {
  const rows = [
    row('Name', esc(name)),
    row('Email', `<a href="mailto:${esc(email)}" style="color:${C.goldDark};">${esc(email)}</a>`),
    org ? row('Organization', esc(org)) : '',
    interest ? row('Interested in', esc(interest)) : '',
  ].join('');
  const content = `${heading('New project inquiry')}
<p style="margin:0 0 18px;">${esc(name)} sent a message through the Everything Shul contact form.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.panel2};border:1px solid ${C.border};border-radius:8px;border-collapse:separate;margin-bottom:20px;">${rows}</table>
${message ? `<div style="background:${C.panel2};border-left:3px solid ${C.gold};padding:14px 16px;border-radius:4px;margin-bottom:24px;">${multiline(message)}</div>` : ''}
${voiceLength ? `<p style="margin:0 0 24px;padding:12px 16px;background:${C.panel2};border:1px solid ${C.border};border-radius:6px;">🎤 <strong>Voice note (${esc(voiceLength)})</strong> is attached to this email. Open the attachment to listen.</p>` : ''}
<a href="mailto:${esc(email)}?subject=${encodeURIComponent('Re: your inquiry')}" style="display:inline-block;background:${C.goldDark};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;font-size:14px;">Reply to ${esc(name)}</a>
<p style="margin:24px 0 0;"></p>`;
  return shell({ siteUrl, preheader: `${name}: ${message ? message.slice(0, 90) : 'sent a voice note'}`, title: 'New project inquiry', content });
}

export function confirmationEmail({ name, message }, siteUrl, hadVoice) {
  const first = name.trim().split(/\s+/)[0];
  const content = `${heading(`Thanks, ${first}. We got your message.`)}
<p style="margin:0 0 16px;">We've received your inquiry and will reply personally, usually within one business day.</p>
<p style="margin:0 0 8px;font-size:12.5px;text-transform:uppercase;letter-spacing:.05em;color:${C.muted};">Your message</p>
<div style="background:${C.panel2};border-left:3px solid ${C.gold};padding:14px 16px;border-radius:4px;margin-bottom:24px;">${message ? multiline(message) : ''}${hadVoice ? `${message ? '<br><br>' : ''}🎤 Voice note` : ''}</div>
<p style="margin:0 0 24px;">If you need to add anything, just reply to this email.</p>
<p style="margin:0 0 24px;">Talk soon,<br><span style="font-family:Georgia,'Times New Roman',serif;color:${C.dark};">The Everything Shul team</span></p>`;
  return shell({ siteUrl, preheader: 'We received your message and will be in touch shortly.', title: 'We received your message', content });
}
