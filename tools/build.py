#!/usr/bin/env python3
"""Generates index.html, contact.html and the share/<id>/index.html pages from the PROJECTS list below.

Run from the repo root:  python3 tools/build.py
Then (for the share thumbnails):  node tools/og.js
The site itself has no build step; this only regenerates committed files.
"""
import html, os

SITE = 'https://everythingshul.com'

PROJECTS = [
    dict(id='drm', name='DRM', full='DRM — Donor Relationship Manager', kind='Donor management',
         url='https://drm.everythingshul.com', shown='drm.everythingshul.com',
         desc='An all-in-one donor CRM built for shuls — live totals, recurring charge batches, follow-ups, Hebrew kvitel generation and templated receipts, all in one dashboard.',
         features=['Live donor & donation dashboard', 'Recurring charge batch review', 'Hebrew/English kvitel generator', 'Drag-and-drop email & receipt designer'],
         video=dict(preview='assets/video/drm-preview.mp4', poster='assets/video/drm-poster.jpg', tour='assets/video/drm-tour.mp4')),
    dict(id='kipashairbp', name='Kipas Hair BP', full='Kipas Hair BP', kind='Gift card assistance platform',
         url='https://kipashairbp.org', shown='ecards.kipashairbp.org',
         desc='A full gift-card assistance platform — shul registration, applicant approval, prepaid card activation and live store spend tracking for an entire season.',
         features=['Shul & applicant registration flow', 'Approval & verification pipeline', 'Prepaid card loading & activation', 'Live store spend & balance tracking'],
         video=dict(preview='assets/video/kipashairbp-preview.mp4', poster='assets/video/kipashairbp-poster.jpg', tour='assets/video/kipashairbp-tour.mp4')),
    dict(id='kupeshair', name='Kupes Hair Williamsburg', full='Kupes Hair Williamsburg', kind='Gift card assistance platform', new=True,
         url='https://kupeshair.org', shown='kupeshair.org',
         desc='A dedicated, white-labeled deployment of our gift-card assistance platform for Kupes Hair Williamsburg — its own branding, admin, registration flow and season financials.',
         features=['Branded shul & applicant registration', 'Dedicated admin dashboard', 'Card loading & account activation', 'Season-by-season spend reporting'],
         video=dict(preview='assets/video/kupeshair-preview.mp4', poster='assets/video/kupeshair-poster.jpg', tour='assets/video/kupeshair-tour.mp4')),
    dict(id='jlistings', name='JListings', full='JListings', kind='Organization classifieds',
         url='https://jlistings.com', shown='jlistings.com',
         desc='A classifieds and editorial platform built for organizations — listings, categories and announcements in one searchable hub.',
         features=['Searchable classifieds & categories', 'Editorial & announcement posts', 'Organization-run moderation', 'Mobile-first browsing'],
         shot='assets/screenshots/jlistings-full.png', alt='JListings classifieds site'),
    dict(id='mamudem', name='Mamudem', full='Mamudem', kind='Event ticketing',
         url='https://mamudem.com', shown='mamudem.com',
         desc='An event and dinner-ticketing platform — pricing tiers, check-in scanning and a live attendee list, built for organization dinners and events.',
         features=['Flexible pricing & tiers', 'QR check-in scanner', 'Live attendee management', 'Online ticket purchasing'],
         video=dict(preview='assets/video/mamudem-tour.mp4', poster='assets/video/mamudem-poster.jpg', tour='assets/video/mamudem-tour.mp4')),
    dict(id='fundraise', name='Fundraise Wall', full='Fundraise Wall', kind='Live fundraising',
         url='https://fundraise.everythingshul.com', shown='fundraise.everythingshul.com',
         desc='A live fundraising wall and dashboard — real-time donations displayed for the room, with full admin controls behind the scenes.',
         features=['Real-time donation wall display', 'Campaign dashboard', 'Donor & pledge tracking', 'Built-in contact & follow-up tools'],
         shot='assets/screenshots/fundraise-full.png', alt='Fundraise Wall live donor display'),
]

e = html.escape
SHARE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>'
PLAY_SVG = '<svg viewBox="0 0 12 14" aria-hidden="true"><path d="M0 0 12 7 0 14Z"/></svg>'

def head(title, desc, extra=''):
    return f'''<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}" />
<link rel="icon" href="/favicon.ico?v=3" sizes="any" />
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png?v=3" />
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png?v=3" />
<script>document.documentElement.classList.add('js')</script>
{extra}'''

def og(title, desc, image, url):
    return f'''<meta property="og:type" content="website" />
<meta property="og:site_name" content="Everything Shul" />
<meta property="og:title" content="{e(title)}" />
<meta property="og:description" content="{e(desc)}" />
<meta property="og:url" content="{e(url)}" />
<meta property="og:image" content="{SITE}/assets/share/{image}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{e(title)}" />
<meta name="twitter:description" content="{e(desc)}" />
<meta name="twitter:image" content="{SITE}/assets/share/{image}" />
'''

NAV = '''<div class="progress" aria-hidden="true"></div>
<div class="glow" aria-hidden="true"><i></i><i></i><i></i></div>
<nav class="navbar">
  <a href="index.html" class="brand"><img src="assets/logo-light.png" alt="Everything Shul" /></a>
  <div class="nav-links">
    <a href="index.html#work">Work</a>
    <a href="index.html#process">Process</a>
    <a href="index.html#about">About</a>
    <a href="contact.html">Contact</a>
  </div>
  <div class="nav-cta">
    <a href="contact.html" class="btn">Start a project</a>
    <button class="nav-toggle" aria-label="Menu"><span></span><span></span><span></span></button>
  </div>
</nav>

<div class="nav-scrim"></div>
<div class="mobile-nav">
  <a href="index.html#work">Work</a>
  <a href="index.html#process">Process</a>
  <a href="index.html#about">About</a>
  <a href="contact.html">Contact</a>
  <a href="contact.html" class="btn">Start a project</a>
</div>
'''

def footer():
    links = '\n'.join(f'          <li><a href="{p["url"]}" target="_blank" rel="noopener">{e(p["name"])}</a></li>' for p in PROJECTS)
    return f'''<footer class="site-footer">
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">
        <a href="index.html" class="brand"><img src="assets/logo-light.png" alt="Everything Shul" /></a>
        <p>We build custom software for nonprofits.</p>
      </div>
      <div class="footer-col">
        <h4>Our work</h4>
        <ul>
{links}
        </ul>
      </div>
      <div class="footer-col">
        <h4>Company</h4>
        <ul>
          <li><a href="index.html#about">About</a></li>
          <li><a href="index.html#process">Process</a></li>
          <li><a href="contact.html">Contact</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2026 Everything Shul. All rights reserved.</span>
      <span>everythingshul@gmail.com</span>
    </div>
  </div>
</footer>
'''

def chat_scripts():
    return '<script src="js/chat-config.js" defer></script>\n<script src="js/chat-kb.js" defer></script>\n<script src="js/chat.js" defer></script>\n'

def project_html(i, p):
    flip = ' flip' if i % 2 else ''
    new = '<span class="new">New</span>' if p.get('new') else ''
    feats = '\n'.join(f'          <li>{e(f)}</li>' for f in p['features'])
    if 'video' in p:
        v = p['video']
        media = f'''<div class="frame video-stage">
            <video class="preview-video" src="{v['preview']}" poster="{v['poster']}" muted loop playsinline preload="none"></video>
            <button class="play-full" data-video="{v['tour']}" data-title="{e(p['name'])} — full product tour">
              <span class="play-icon">{PLAY_SVG}</span>
              Watch full tour
            </button>
          </div>'''
    else:
        media = f'''<div class="frame scroll-window">
            <img src="{p['shot']}" alt="{e(p['alt'])}" loading="lazy" />
          </div>'''
    share_title = f"{p['full']} — Everything Shul"
    return f'''
    <section class="project{flip}" id="{p['id']}">
      <div class="project-grid">
        <div class="project-text">
          <p class="kicker"><span class="n">{i+1:02d}</span>{e(p['kind'])}{new}</p>
          <h3>{e(p['name'])}</h3>
          <p>{e(p['desc'])}</p>
          <ul class="features">
{feats}
          </ul>
          <div class="actions">
            <a href="{p['url']}" target="_blank" rel="noopener" class="btn">Visit site <span class="arr">↗</span></a>
            <button type="button" class="btn-line share-btn" data-id="{p['id']}" data-title="{e(share_title)}" data-text="{e(p['full'])}, built by Everything Shul: {e(p['kind'].lower())}.">{SHARE_SVG}<span>Share</span></button>
          </div>
        </div>
        <figure class="project-media">
          {media}
          <figcaption>{e(p['shown'])}</figcaption>
        </figure>
      </div>
    </section>'''

def marquee():
    half = ''.join(f'<span>{e(p["name"])}</span><i></i>' for p in PROJECTS)
    return f'<div class="marquee" aria-hidden="true"><div class="marquee-track">{half}{half}</div></div>'

def index_html():
    idx = '\n'.join(
        f'''      <li><a href="#{p['id']}"><span class="n">{i+1:02d}</span><span class="name">{e(p['name'])}</span><span class="kind">{e(p['kind'])}</span><span class="go" aria-hidden="true">↓</span></a></li>'''
        for i, p in enumerate(PROJECTS))
    projects = '\n'.join(project_html(i, p) for i, p in enumerate(PROJECTS))
    title = 'Everything Shul — Custom software for nonprofits'
    desc = 'Everything Shul builds custom software for nonprofits.'
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
{head(title, desc, og(title, desc, 'home.jpg', SITE + '/') + '<link rel="stylesheet" href="css/style.css" />' + chr(10) + '<link rel="preload" href="assets/fonts/newsreader.woff2" as="font" type="font/woff2" crossorigin />')}
</head>
<body>

{NAV}
<header class="hero">
  <div class="container">
    <h1>We build the software behind <em>thriving</em> organizations.</h1>
    <p class="lede">We build custom software for nonprofits.</p>
    <div class="hero-actions">
      <a href="contact.html" class="btn">Start a project</a>
      <a href="#work" class="btn-line">See our work</a>
    </div>
    <ol class="index" aria-label="Projects">
{idx}
    </ol>
  </div>
</header>

{marquee()}
<section id="about" class="about">
  <div class="container about-grid">
    <h2>Software that fits the way your organization works.</h2>
    <div class="about-points">
      <p><strong>Built around how you run.</strong>Every platform is designed around how your organization actually operates, not bent out of shape from generic software.</p>
      <p><strong>Made with the people who use it.</strong>We work closely with the people running the organization, so the software fits the way it's run day to day.</p>
      <p><strong>Supported after launch.</strong>From the first mockup to day-to-day support, we stay with every platform we build.</p>
    </div>
  </div>
</section>

<section id="work">
  <div class="container">
    <div class="work-head">
      <h2>Platforms built from scratch.</h2>
      <p>The software currently running organizations and businesses day to day.</p>
    </div>
{projects}
  </div>
</section>

<section id="process" class="process">
  <div class="container process-grid">
    <h2>From first conversation to day-to-day support.</h2>
    <ol class="steps">
      <li><span class="n">01</span><h3>Discover</h3><p>We learn how your organization actually runs before writing a line of code.</p></li>
      <li><span class="n">02</span><h3>Design</h3><p>A clear interface designed around your people, not a generic template.</p></li>
      <li><span class="n">03</span><h3>Build</h3><p>We build and test the platform end to end, with you involved at every step.</p></li>
      <li><span class="n">04</span><h3>Support</h3><p>Launch day is day one. We stay on to support, refine and extend the platform.</p></li>
    </ol>
  </div>
</section>

<section class="cta">
  <div class="container">
    <h2>Have an organization that needs software built right?</h2>
    <p>Tell us what you're running today and what's slowing you down, and we'll take it from there.</p>
    <a href="contact.html" class="btn">Start a project</a>
  </div>
</section>

{footer()}
<div class="video-lightbox" id="video-lightbox">
  <div class="lightbox-inner">
    <div class="lightbox-head">
      <span id="lightbox-title"></span>
      <button class="lightbox-close" aria-label="Close">×</button>
    </div>
    <video id="lightbox-video" controls playsinline></video>
  </div>
</div>

{chat_scripts()}<script src="js/main.js"></script>
</body>
</html>
'''

def contact_html():
    links = '\n'.join(f'          <li><a href="{p["url"]}" target="_blank" rel="noopener">{e(p["name"])} ↗</a></li>' for p in PROJECTS)
    opts = '\n'.join(f'              <option value="{e(v)}">{e(v)}</option>' for v in [
        'Donor management (DRM)', 'Gift card / assistance platform', 'Organization classifieds',
        'Event ticketing', 'Fundraising wall', 'Something new'])
    title = 'Contact — Everything Shul'
    desc = 'Tell Everything Shul about your organization and what you need built.'
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
{head(title, desc, og(title, desc, 'home.jpg', SITE + '/contact.html') + '<link rel="stylesheet" href="css/style.css" />')}
</head>
<body>

{NAV}
<header class="page-hero">
  <div class="container">
    <h1>Let's build something for your organization.</h1>
    <p>Tell us a bit about what you're running and what you need, and we'll follow up within a day or two.</p>
  </div>
</header>

<section class="container">
  <div class="contact-wrap">

    <div class="contact-info">
      <div>
        <p class="label">Email</p>
        <a class="value" href="mailto:everythingshul@gmail.com">everythingshul@gmail.com</a>
      </div>
      <div>
        <p class="label">Response time</p>
        <p class="value">Within 1–2 business days</p>
      </div>
      <div>
        <p class="label">Availability</p>
        <p class="value">Taking on new organizations</p>
      </div>
      <div>
        <p class="label">Our work</p>
        <ul class="site-links">
{links}
        </ul>
      </div>
    </div>

    <div class="contact-form">
      <h2>Tell us about your project</h2>
      <form id="contact-form">
        <div class="field-row">
          <div class="field">
            <label for="name">Name</label>
            <input type="text" id="name" name="name" required />
          </div>
          <div class="field">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="org">Organization</label>
            <input type="text" id="org" name="org" />
          </div>
          <div class="field">
            <label for="interest">What are you interested in?</label>
            <select id="interest" name="interest">
              <option value="">Select one</option>
{opts}
            </select>
          </div>
        </div>
        <div class="field">
          <label for="message">Message</label>
          <textarea id="message" name="message" placeholder="What's slowing you down today?" required></textarea>
        </div>
        <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true" />
        <button type="submit" class="btn">Send message</button>
        <p class="form-success">Thanks — your message is on its way. Check your inbox for a confirmation.</p>
        <p class="form-error"></p>
      </form>
    </div>

  </div>
</section>

{footer()}
{chat_scripts()}<script src="js/main.js"></script>
</body>
</html>
'''

def share_page(p):
    url = f"{SITE}/share/{p['id']}/"
    title = f"{p['full']} — Everything Shul"
    desc = f"{p['desc']}"
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
{head(title, desc, og(title, desc, p['id'] + '.jpg', url) + f'<link rel="canonical" href="{url}" />' + chr(10) + f'<meta http-equiv="refresh" content="0;url=/#{p["id"]}" />')}
<style>body{{font:16px/1.5 system-ui,sans-serif;padding:40px;color:#f4f7fc;background:#0a0f1a}}</style>
</head>
<body>
<p>Taking you to <a href="/#{p['id']}">{e(p['full'])}</a>…</p>
<script>location.replace('/#{p['id']}');</script>
</body>
</html>
'''

if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    open(os.path.join(root, 'index.html'), 'w').write(index_html())
    open(os.path.join(root, 'contact.html'), 'w').write(contact_html())
    for p in PROJECTS:
        d = os.path.join(root, 'share', p['id'])
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, 'index.html'), 'w').write(share_page(p))
    import kb
    n_entries, n_variants, n_pj = kb.out()
    print('built index.html, contact.html,', len(PROJECTS), 'share pages and the chat knowledge base:', n_variants + n_pj, 'replies')
