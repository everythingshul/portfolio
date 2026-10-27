// Emails for invoices, quotes, reminders and receipts. Same look as the other Everything Shul emails.
import { C, esc, shell, heading, button, multiline } from './emails.js';
import { money } from './billing.js';

const fmtDate = (s) => (s ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
const first = (c) => String(c.name || c.org || '').trim().split(/\s+/)[0] || 'there';

const summary = (rows) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.panel2};border:1px solid ${C.border};border-radius:8px;border-collapse:separate;margin:0 0 22px;">` +
  rows.filter(Boolean).map((r) => `<tr><td style="padding:9px 14px;color:${C.muted};font-size:13px;width:38%;border-bottom:1px solid ${C.border};">${esc(r[0])}</td><td style="padding:9px 14px;color:${C.dark};border-bottom:1px solid ${C.border};${r[2] ? 'font-weight:700;font-size:17px;' : ''}">${r[1]}</td></tr>`).join('') + '</table>';

const lineTable = (d) => {
  const cur = d.invoice.currency;
  const rows = d.lines.map((l) => `<tr><td style="padding:8px 0;border-bottom:1px solid ${C.border};">${esc(l.description)}${l.qty !== 1 ? `<div style="font-size:12px;color:${C.muted};">${l.qty} × ${esc(money(l.unit_cents, cur))}</div>` : ''}</td><td style="padding:8px 0;border-bottom:1px solid ${C.border};text-align:right;white-space:nowrap;">${esc(money(Math.round(l.qty * l.unit_cents), cur))}</td></tr>`).join('');
  const i = d.invoice;
  const extra = [
    i.discount_cents ? `<tr><td style="padding:6px 0;color:${C.muted};">Discount</td><td style="padding:6px 0;text-align:right;">−${esc(money(i.discount_cents, cur))}</td></tr>` : '',
    i.tax_cents ? `<tr><td style="padding:6px 0;color:${C.muted};">Tax (${i.tax_rate}%)</td><td style="padding:6px 0;text-align:right;">${esc(money(i.tax_cents, cur))}</td></tr>` : '',
  ].join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;font-size:14px;">${rows}${extra}<tr><td style="padding:10px 0 0;font-weight:700;color:${C.dark};">Total</td><td style="padding:10px 0 0;text-align:right;font-weight:700;color:${C.dark};">${esc(money(i.total, cur))}</td></tr></table>`;
};

// To the customer: here is your invoice (or quote), or a reminder about one.
export function invoiceEmail(d, s, link, siteUrl, reminder) {
  const i = d.invoice, c = d.customer, cur = i.currency;
  const isQuote = i.kind === 'quote';
  const word = isQuote ? 'quote' : 'invoice';
  let title, intro;
  if (isQuote) { title = `Your quote ${i.number}`; intro = `Here is the quote you asked for from ${s.biz_name}. You can look it over and accept it online.`; }
  else if (reminder && reminder.kind === 'overdue') { title = `Invoice ${i.number} is past due`; intro = `This is a friendly reminder that invoice ${i.number} was due on ${fmtDate(i.due_date)} and still has a balance. If you have already paid, thank you, and please ignore this.`; }
  else if (reminder && reminder.kind === 'due') { title = `Invoice ${i.number} is due today`; intro = `A quick reminder that invoice ${i.number} is due today.`; }
  else if (reminder) { title = `Invoice ${i.number} is due soon`; intro = `A quick reminder that invoice ${i.number} is due on ${fmtDate(i.due_date)}.`; }
  else { title = `Invoice ${i.number} from ${s.biz_name}`; intro = `Thank you for your business. Here is your invoice from ${s.biz_name}.`; }
  const content = `${heading(title)}
<p style="margin:0 0 16px;">Hi ${esc(first(c))},</p>
<p style="margin:0 0 20px;">${esc(intro)}</p>
${summary([
    [isQuote ? 'Quote' : 'Invoice', esc(i.number)],
    ['Date', esc(fmtDate(i.issue_date))],
    i.due_date ? [isQuote ? 'Valid until' : 'Due', esc(fmtDate(i.due_date))] : null,
    isQuote ? ['Total', esc(money(i.total, cur)), true] : ['Amount due', esc(money(i.balance, cur)), true],
  ])}
${lineTable(d)}
${i.notes ? `<div style="background:${C.panel2};border-left:3px solid ${C.gold};padding:14px 16px;border-radius:4px;margin:0 0 22px;">${multiline(i.notes)}</div>` : ''}
<p style="margin:0 0 22px;">${button(link, isQuote ? 'View and accept the quote' : 'View and pay the invoice')}</p>
<p style="margin:0 0 24px;font-size:13px;color:${C.muted};">${isQuote ? 'You can accept or decline the quote on that page.' : 'You can pay by card or bank transfer on that page, and download a copy of the ' + word + '.'} Questions? Just reply to this email.</p>`;
  return shell({ siteUrl, preheader: `${i.number}: ${money(isQuote ? i.total : i.balance, cur)}`, title, content });
}

export const invoiceSubject = (d, s, reminder) => {
  const i = d.invoice, cur = i.currency;
  if (i.kind === 'quote') return `Quote ${i.number} from ${s.biz_name} (${money(i.total, cur)})`;
  if (reminder && reminder.kind === 'overdue') return `Past due: invoice ${i.number} (${money(i.balance, cur)})`;
  if (reminder && reminder.kind === 'due') return `Due today: invoice ${i.number} (${money(i.balance, cur)})`;
  if (reminder) return `Reminder: invoice ${i.number} is due ${fmtDate(i.due_date)}`;
  return `Invoice ${i.number} from ${s.biz_name} (${money(i.total, cur)})`;
};

// To the customer: thank you, payment received.
export function receiptEmail(d, s, paidCents, link, siteUrl) {
  const i = d.invoice, cur = i.currency;
  const left = i.balance;
  const content = `${heading('Payment received. Thank you!')}
<p style="margin:0 0 16px;">Hi ${esc(first(d.customer))},</p>
<p style="margin:0 0 20px;">We received your payment of <strong>${esc(money(paidCents, cur))}</strong> for invoice ${esc(i.number)}.${left > 0 ? ` The remaining balance is ${esc(money(left, cur))}.` : ' The invoice is now paid in full.'}</p>
${summary([['Invoice', esc(i.number)], ['Amount paid', esc(money(paidCents, cur)), true], left > 0 ? ['Balance', esc(money(left, cur))] : null])}
<p style="margin:0 0 22px;">${button(link, 'View the invoice')}</p>
<p style="margin:0 0 24px;font-size:13px;color:${C.muted};">Stripe also emails a card receipt. Keep this email for your records.</p>`;
  return shell({ siteUrl, preheader: `Payment of ${money(paidCents, cur)} received`, title: 'Payment received', content });
}

// To the team.
export function paymentNotice(d, paidCents, adminLink, siteUrl, becamePaid) {
  const i = d.invoice, cur = i.currency;
  const who = d.customer.org || d.customer.name;
  const content = `${heading(`${money(paidCents, cur)} received from ${who}`)}
<p style="margin:0 0 20px;">${esc(who)} paid ${esc(money(paidCents, cur))} online for invoice ${esc(i.number)}. ${becamePaid ? 'The invoice is now paid in full.' : `Balance remaining: ${esc(money(i.balance, cur))}.`}</p>
<p style="margin:0 0 24px;">${button(adminLink, 'Open the invoice')}</p>`;
  return shell({ siteUrl, preheader: `${who} paid ${money(paidCents, cur)}`, title: 'Payment received', content });
}

export function quoteResponseNotice(d, accepted, adminLink, siteUrl) {
  const i = d.invoice;
  const who = d.customer.org || d.customer.name;
  const content = `${heading(`${who} ${accepted ? 'accepted' : 'declined'} quote ${i.number}`)}
<p style="margin:0 0 20px;">${esc(who)} ${accepted ? 'accepted' : 'declined'} the quote for ${esc(money(i.total, i.currency))}.${accepted ? ' You can turn it into an invoice in one click.' : ''}</p>
<p style="margin:0 0 24px;">${button(adminLink, 'Open the quote')}</p>`;
  return shell({ siteUrl, preheader: `Quote ${i.number} ${accepted ? 'accepted' : 'declined'}`, title: 'Quote response', content });
}
