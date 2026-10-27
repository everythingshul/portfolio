"""Text of the Terms and Conditions page (terms.html). Edit here, then run python3 tools/build.py.

Choices a lawyer should confirm are collected at the top:"""

TERMS_UPDATED = 'October 27, 2026'
GOVERNING_STATE = 'New York'          # governing law and courts
QUOTE_VALID_DAYS = 30                 # how long a quote stays open unless it says otherwise
DEFAULT_PAYMENT_DAYS = 30             # invoice due date unless the invoice says otherwise
DISPUTE_DAYS = 30                     # time to raise a billing question
TERMINATION_NOTICE_DAYS = 30          # for ongoing services such as hosting and support
CURE_DAYS = 15                        # time to fix a material breach
EXPORT_DAYS = 30                      # how long data stays available for export after the services end
CONTACT_EMAIL = 'everythingshul@gmail.com'

# (anchor, heading, html)
SECTIONS = [
    ('about', 'About these terms', f'''
<p>These Terms and Conditions ("Terms") are the agreement between Everything Shul ("Everything Shul", "we", "us") and you, whether you are visiting our website, chatting with us, or are an organization that buys our software, hosting or support ("you", "Customer"). By using our website or by accepting a quote, paying an invoice or otherwise using our services, you agree to these Terms.</p>
<p>If you accept on behalf of an organization, you confirm that you have the authority to bind it, and "you" means that organization.</p>
<p>If you and we sign a separate written agreement, or you accept a quote with its own terms, that document controls wherever it differs from these Terms. Otherwise these Terms apply together with the quote or order.</p>'''),

    ('services', 'Our services', '''
<p>We build custom software for nonprofits and other organizations, host and maintain it, and provide related support, consulting and training (the "Services"). The platforms and examples shown on our website describe the kind of work we do. They are summaries, not promises that a particular feature, price or timetable is available to you. A project is defined by its quote or written order, not by the website.</p>
<p>We may improve, change or retire parts of our own platforms and website over time. If a change would materially reduce something you are paying for, we will tell you in advance.</p>'''),

    ('quotes', 'Quotes, proposals and changes', f'''
<p>A quote or proposal describes the work, the fees and the main assumptions. Unless it says otherwise, a quote is open for {QUOTE_VALID_DAYS} days. You accept a quote by approving it online, signing or replying to it in writing, or by paying an invoice for it. Once accepted, it forms an order under these Terms.</p>
<p>Dates and timelines are good-faith estimates, not guarantees. They depend on you giving us content, decisions, access and approvals on time. If you ask for work outside the agreed scope, we will describe the change and its cost, and we will start it only after you agree. Delays caused by you may move dates and may add cost.</p>'''),

    ('fees', 'Fees, invoices and payment', f'''
<p><strong>Invoices.</strong> We send invoices by email with a secure link to view and pay them. Unless an invoice or order says otherwise, payment is due within {DEFAULT_PAYMENT_DAYS} days of the invoice date. Ongoing services such as hosting and support are billed on the schedule in the order and renew until either of us ends them under the section on ending the Services.</p>
<p><strong>How you can pay.</strong> You can pay by card or bank transfer through Stripe, or by another method we accept, such as a check. Online payments are handled on Stripe's own secure page and are also subject to Stripe's terms. Card and bank details go to Stripe; we never see or store full card numbers. If a payment method carries a processing fee, we will say so before you pay.</p>
<p><strong>Taxes.</strong> Prices do not include sales, use or similar taxes unless stated. If your organization is tax exempt, give us a valid exemption certificate before the invoice is issued, and we will not charge tax. You are responsible for any taxes that apply and are not exempt.</p>
<p><strong>Late payment.</strong> If an invoice is unpaid after its due date, we may send reminders. We may charge a late fee only if the invoice or order states one, and never more than the law allows. If an invoice remains unpaid after we give you 10 days' written notice, we may pause the Services, including hosting, until it is paid. We will not delete your data only because an invoice is late.</p>
<p><strong>Questions about an invoice.</strong> Tell us within {DISPUTE_DAYS} days of the invoice date if you think it is wrong. Pay any part that is not in question while we sort out the rest.</p>
<p><strong>Refunds.</strong> Fees for work already performed, and for third-party costs we have already paid for you, are not refundable. If you prepaid for hosting or support that we have not yet provided and you end the Services as these Terms allow, we will refund the unused part. Where a payment is refunded, it goes back to the original payment method.</p>
<p><strong>Chargebacks.</strong> Please contact us before disputing a payment with your bank or card issuer, so that we can fix a problem quickly. If a payment is reversed after we have provided the Services, the amount becomes due again, and you are responsible for any dispute fees charged to us.</p>'''),

    ('responsibilities', 'Your responsibilities', '''
<p>You agree to:</p>
<ul>
<li>give us accurate information, content, decisions and approvals in good time, and tell us promptly when something changes;</li>
<li>keep your account passwords and access details safe, and tell us right away if you think they have been compromised;</li>
<li>use the Services only for lawful purposes and follow the laws that apply to your organization, including those on charitable solicitation, privacy, electronic marketing, payment cards, and gift and prepaid cards;</li>
<li>make sure you have the right to use, and to give us, all text, images, logos, lists and data you provide;</li>
<li>pay the separate fees of services you choose to use with ours, such as your domain name, payment processor, email sender or other third-party tools; and</li>
<li>not misuse the Services, for example by attacking, overloading or probing them, sending spam or unlawful content, or trying to get around limits or security.</li>
</ul>'''),

    ('your-data', 'Your content and data', '''
<p>You own your content and the data you or your users put into the Services ("Customer Content"), including your donor, member, applicant and event records. You give us permission to host, copy, process and display Customer Content only as needed to provide and support the Services and to meet our legal duties.</p>
<p>You are responsible for having a lawful basis and any needed consent to collect the information you store with us, and for how you use it. Please do not store payment card numbers, government identification numbers or similar highly sensitive information in the Services unless we have agreed in writing that the Service is built for it.</p>
<p>You can ask for an export of your Customer Content at any time. We will provide it in a common format within a reasonable time.</p>'''),

    ('ip', 'Intellectual property', '''
<p>We keep all rights in our platforms, source code, tools, templates, designs, documentation and know-how, including anything we created before or outside your project and anything we reuse across customers (together, "Our Materials"). Unless a written agreement signed by us says otherwise, you do not own Our Materials, including software we build for you. While you are a customer in good standing, we give you a non-exclusive, non-transferable right to use the Services and the software we deliver for your organization's own purposes.</p>
<p>You may not copy, resell, sublicense, reverse engineer or build a competing product from Our Materials, except where the law does not allow us to forbid it. Some parts of our work include third-party or open-source components, which stay under their own licenses.</p>
<p>If you give us feedback or ideas about the Services, we may use them without owing you anything.</p>
<p>Unless you tell us in writing not to, we may mention that you are a customer and show non-sensitive screens or descriptions of the work in our portfolio and marketing. We will never show personal or confidential information from your data.</p>'''),

    ('hosting', 'Hosting, availability and support', '''
<p>We work to keep hosted services available and secure, and we take reasonable steps to back up Customer Content. We do not promise uninterrupted or error-free service unless a written service level agreement says so. We may do planned maintenance, and we will try to give notice and schedule it at quiet times. Because our services run on third-party infrastructure such as Cloudflare, GitHub, Stripe and email providers, an outage at one of them can affect the Services and is outside our control.</p>
<p>Support is by email and on business days. Response times we mention are goals, not guarantees. Please keep your own copies of anything critical.</p>
<p>We may suspend access if needed to stop abuse, protect security or comply with the law, and we will tell you why as soon as we reasonably can.</p>'''),

    ('privacy', 'Privacy and data protection', '''
<p>How we handle personal information on our website, chat and forms is explained in our <a href="privacy.html">Privacy page</a>. For Customer Content, we process personal information only on your behalf and for the purposes in these Terms. We use reasonable technical and organizational measures to protect it, we limit access to people who need it, and we use service providers (for example for hosting, payments and email) under appropriate commitments.</p>
<p>If we become aware that a security incident has affected personal information in your Customer Content, we will tell you without undue delay and help you meet any notice duties you have.</p>'''),

    ('website', 'Using our website, chat and voice notes', '''
<p>Our website is for general information. The chat assistant, Chesky, is an automated assistant that gives pre-written answers and is not a person. His answers may be incomplete or out of date, are not professional advice, and do not create a contract, quote or promise. Ask the team to confirm anything that matters.</p>
<p>If you ask for a person, send a voice note, or use the contact form, we receive your message and contact details so that we can reply. Please do not send passwords, payment card numbers or other highly sensitive information that way.</p>
<p>Do not use the website to break the law, to harm or impersonate anyone, to collect data from it in bulk by automated means, or to interfere with how it works. We may block access that looks abusive.</p>'''),

    ('confidentiality', 'Confidentiality', '''
<p>Each of us may receive non-public information from the other that is marked confidential or would reasonably be understood to be. We will each use it only to carry out our relationship, keep it as safe as we keep our own, and share it only with people who need it and are bound to protect it. This does not cover information that is public, that we already had, that we received lawfully from someone else, or that we developed separately. We may disclose information if the law requires, and we will tell you first where we can. These duties continue after the Services end.</p>'''),

    ('warranties', 'Warranties and disclaimers', '''
<p>We will provide the Services with reasonable skill and care. Apart from that, to the fullest extent the law allows, the Services and our website are provided "as is" and "as available", and we disclaim all other warranties, including any implied warranties of merchantability, fitness for a particular purpose and non-infringement. We do not promise that the Services will meet every need, work without interruption or errors, or produce any particular result, including any amount of donations, registrations or sales.</p>
<p>Nothing we say or build is legal, tax, accounting or financial advice. Please talk to your own advisers about those matters.</p>'''),

    ('liability', 'Limits on our liability', '''
<p>To the fullest extent the law allows:</p>
<ul>
<li>neither of us is liable to the other for indirect, incidental, special, consequential or punitive damages, or for lost profits, lost donations, lost revenue, lost goodwill or loss of data, even if we were told they were possible; and</li>
<li>our total liability for all claims arising out of the Services or these Terms is limited to the fees you paid us for the Services that gave rise to the claim during the 12 months before the event that caused it.</li>
</ul>
<p>These limits do not apply to anything the law does not allow to be limited, such as liability for fraud, gross negligence or willful misconduct, and they do not reduce your duty to pay fees that are due. They reflect a fair sharing of risk, and our fees are set with them in mind.</p>'''),

    ('indemnity', 'Your promise to cover certain claims', '''
<p>You will defend us and pay the costs, damages and reasonable legal fees that result from a claim by a third party arising from Customer Content, from your use of the Services in breach of these Terms or the law, or from the way you collect or use personal information. We will tell you about the claim promptly, let you control the defense (but not settle it in a way that admits fault for us without our consent), and give you reasonable help at your cost.</p>'''),

    ('ending', 'Ending the Services', f'''
<p>A project order ends when the work is delivered and paid for. Ongoing services such as hosting and support continue until either of us ends them by giving the other {TERMINATION_NOTICE_DAYS} days' written notice (email is enough). Either of us may end an order immediately by written notice if the other materially breaks these Terms and does not fix it within {CURE_DAYS} days of being told. We may also end or pause the Services as described in the sections on payment and hosting.</p>
<p>When the Services end, you pay us for work done and services provided up to that date, your right to use the Services stops, and we will keep your Customer Content available for export for {EXPORT_DAYS} days. After that we may delete it, except for copies we must keep for legal, tax or accounting reasons or that sit in routine backups until they are overwritten. Sections that by their nature should continue, including payment, intellectual property, confidentiality, disclaimers, liability and the sections on law and disputes, continue after the Services end.</p>'''),

    ('third-parties', 'Third-party services and links', '''
<p>Our website links to products we have built and to other sites, and our services rely on third-party providers such as Stripe, Cloudflare, GitHub and email services. Those parties have their own terms and privacy practices, and we are not responsible for them or for their content or availability.</p>'''),

    ('notices', 'Electronic communications and notices', f'''
<p>You agree that we may communicate with you electronically, including by email, and that invoices, quotes and notices sent to the email address you gave us count as written notice. Approving a quote or invoice online, or replying to confirm it, counts as a signature. Please keep your contact details current. You can reach us at <a href="mailto:{CONTACT_EMAIL}">{CONTACT_EMAIL}</a>.</p>'''),

    ('force-majeure', 'Events outside our control', '''
<p>Neither of us is responsible for a delay or failure caused by something beyond our reasonable control, such as a natural disaster, war, terrorism, strike, government action, power or internet failure, or the failure of a major infrastructure provider. This does not excuse a duty to pay money that is due. The affected party will tell the other and try to resume as soon as possible.</p>'''),

    ('law', 'Governing law and disputes', f'''
<p>These Terms are governed by the laws of the State of {GOVERNING_STATE}, without regard to its rules on conflicts of law. If a dispute arises, please contact us first. We will both try in good faith to resolve it informally for at least 30 days. If we cannot, the state and federal courts located in {GOVERNING_STATE} are the place for it, and you and we agree to their jurisdiction. Either of us may ask a court for urgent relief to protect confidential information or intellectual property.</p>'''),

    ('general', 'General', '''
<p>These Terms, together with your quote or order and our Privacy page, are the whole agreement about the Services and replace earlier discussions. If part of these Terms cannot be enforced, the rest still applies. If we do not enforce a right right away, we have not given it up. You may not transfer your rights or duties under these Terms without our written consent; we may transfer ours as part of a merger, a sale of our business, or to an affiliate. We are independent contractors, not partners, employees or agents of each other, and no one other than you and us has rights under these Terms.</p>
<p>We may update these Terms from time to time. The date at the top shows when they were last changed. Changes apply to new orders and renewals from that date and to your continued use of the website. If a change materially affects an ongoing customer, we will give notice by email before it takes effect, and you may end the Services under the section on ending them if you do not agree.</p>'''),

    ('contact', 'Contact us', f'''
<p>Questions about these Terms? Write to <a href="mailto:{CONTACT_EMAIL}">{CONTACT_EMAIL}</a> or use the <a href="contact.html">contact page</a>.</p>'''),
]
