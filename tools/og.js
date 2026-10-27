// Renders the 1200x630 share thumbnails into assets/share/. Needs Playwright.
// Run from the repo root:  node tools/og.js
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const url = (p) => 'file://' + path.join(root, p);

const projects = [
  { id: 'drm', name: 'DRM', kind: 'Donor management', shown: 'drm.everythingshul.com', img: 'assets/video/drm-poster.jpg', pos: 'center' },
  { id: 'kipashairbp', name: 'Kipas Hair BP', kind: 'Gift card assistance platform', shown: 'kipashairbp.org', img: 'assets/video/kipashairbp-poster.jpg', pos: 'center' },
  { id: 'kupeshair', name: 'Kupes Hair Williamsburg', kind: 'Gift card assistance platform', shown: 'kupeshair.org', img: 'assets/video/kupeshair-poster.jpg', pos: 'center' },
  { id: 'jlistings', name: 'JListings', kind: 'Organization classifieds', shown: 'jlistings.com', img: 'assets/screenshots/jlistings-full.png', pos: 'top' },
  { id: 'mamudem', name: 'Mamudem', kind: 'Event ticketing', shown: 'mamudem.com', img: 'assets/video/mamudem-poster.jpg', pos: 'center' },
  { id: 'fundraise', name: 'Fundraise Wall', kind: 'Live fundraising', shown: 'fundraise.everythingshul.com', img: 'assets/video/fundraise-poster.jpg', pos: 'center' },
];

const css = `
@font-face{font-family:N;src:url(${url('assets/fonts/newsreader.woff2')});font-weight:400 600}
@font-face{font-family:S;src:url(${url('assets/fonts/instrument-sans.woff2')});font-weight:400 600}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1200px;height:630px;background:#0a0f1a;color:#f4f7fc;font-family:S,sans-serif;position:relative;overflow:hidden}
.logo{position:absolute;left:64px;top:56px;height:62px}
.text{position:absolute;left:64px;right:690px;top:190px}
.kind{font-size:22px;letter-spacing:.06em;text-transform:uppercase;color:#7d8aab;margin-bottom:18px}
h1{font-family:N,serif;font-weight:400;font-size:86px;line-height:1.02;letter-spacing:-.02em}
.url{position:absolute;left:64px;bottom:52px;font-size:24px;color:#6fd0ff}
.frame{position:absolute;left:560px;top:150px;width:576px;height:324px;border:2px solid #3a4766;border-radius:6px;background-color:#0d1526;background-repeat:no-repeat;background-size:cover}
.rule{position:absolute;left:64px;right:64px;bottom:108px;height:1px;background:#1f2a45}
`;

const page = (inner) => `<!doctype html><meta charset="utf-8"><style>${css}</style><body>${inner}</body>`;
const logo = `<img class="logo" src="${url('assets/logo-light.png')}">`;

const projectCard = (p) => page(`${logo}
<div class="text"><div class="kind">${p.kind}</div><h1 style="${p.name.length > 14 ? 'font-size:68px' : ''}">${p.name}</h1></div>
<div class="frame" style="background-image:url(${url(p.img)});background-position:${p.pos}"></div>
<div class="rule"></div><div class="url">${p.shown}</div>`);

const homeCard = () => {
  const cells = projects.map((p, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    return `<div style="position:absolute;left:${560 + col * 196}px;top:${150 + row * 168}px;width:184px;height:104px;border:2px solid #3a4766;border-radius:5px;background:#0d1526 url(${url(p.img)}) ${p.pos}/cover no-repeat"></div>`;
  }).join('');
  return page(`${logo}
<div class="text" style="right:660px"><h1 style="font-size:78px">We build custom software for nonprofits.</h1></div>
${cells}<div class="rule"></div><div class="url">everythingshul.com</div>`);
};

(async () => {
  const browser = await chromium.launch();
  const pg = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  const jobs = projects.map((p) => [p.id, projectCard(p)]).concat([['home', homeCard()]]);
  for (const [id, html] of jobs) {
    const f = path.join(root, `tools/.og-${id}.html`);
    fs.writeFileSync(f, html);
    await pg.goto('file://' + f);
    await pg.evaluate(() => document.fonts.ready);
    await pg.waitForTimeout(400);
    await pg.screenshot({ path: path.join(root, `assets/share/${id}.jpg`), type: 'jpeg', quality: 88 });
    fs.unlinkSync(f);
    console.log('wrote', id);
  }
  await browser.close();
})();
