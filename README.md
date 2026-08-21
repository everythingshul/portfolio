# Everything Shul

Marketing site for Everything Shul — showcasing DRM, Fundraise Wall, Mamudem, JListings, and Kipas Hair BP.

Plain HTML/CSS/JS, no build step, no framework, no dependencies. Just open `index.html` or serve
the folder with any static host.

## Structure

```
index.html              Home page (hero, about, showcase, process, CTA)
contact.html             Contact page (info + mailto form)
css/style.css             All styles (theme variables at the top)
js/main.js                Nav, scroll reveals, animated screenshot panning, contact form
assets/logo.png            Brand logo
assets/screenshots/         Showcase images (one composite per site, browser-frame + slow pan)
```

## Updating a showcase screenshot

Each `assets/screenshots/<site>-full.png` is a tall image (stacked screenshots of a few pages
from that site) shown inside a "browser frame" card that slowly pans up and down — see
`.scroll-window` / the `pan-y` keyframes in `css/style.css`, driven by `js/main.js`
(`setup()` inside the `.scroll-window` loop computes the pan distance from the image's height).

To swap one out: replace the PNG at that path with a new image of the same rough aspect ratio
(taller images pan more). No other changes needed — the animation duration scales automatically.

## Deploying

Static site — any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages, S3, etc.) works
with zero configuration.

## Theme colors

Pulled from the logo:

- Navy `#2f5596`
- Cyan `#25a9ea`

Both defined as CSS variables (`--navy`, `--cyan`) at the top of `css/style.css`.
