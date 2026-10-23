# Everything Shul — marketing site

A static, dependency-free site (no build step) showcasing six platforms built by Everything Shul: DRM, Kipas Hair BP, Kupes Hair Williamsburg, JListings, Mamudem and Fundraise Wall.

## Structure

```
index.html          Home page (hero, about, showcase, process, CTA, footer)
contact.html         Contact page with a mailto-based form
css/style.css         All styling — dark theme, animations, responsive layout
js/main.js            Nav behavior, scroll reveal, video lightbox, contact form
assets/logo.png        "Everything Shul" wordmark (transparent background)
assets/screenshots/    Panning screenshots for JListings, Mamudem, Fundraise Wall
assets/video/          Product-tour videos, muted preview loops, poster frames
```

## Video showcases

Three of the six products (DRM, Kipas Hair BP, Kupes Hair Williamsburg) have real product-tour
videos. Each showcase card plays a short, silent, looping preview (`*-preview.mp4`) behind a
"Watch full tour" button; clicking it opens the full, original tour video (`*-tour.mp4`) with
sound in a lightbox. Preview clips were deliberately trimmed to dashboard/aggregate-stats
moments rather than screens showing an individual donor's personal contact details.

JListings, Mamudem and Fundraise Wall currently show a styled placeholder panel instead of a
screenshot — the previous screenshot set was lost. Swap in real images by replacing the
`.placeholder-frame` markup in `index.html` with a `.scroll-window` + `<img>`, the same pattern
used for the video cards' browser chrome (see `css/style.css` for `.scroll-window` /
`.browser-frame`).

## Theme

Colors are defined as CSS custom properties at the top of `style.css`:
navy `#2f5596`, cyan `#25a9ea`, dark backgrounds from `#0a0f1a` to `#121d35`.

## Deploying

This is a plain static site — drop the folder into any static host (GitHub Pages, Netlify,
Vercel, S3, etc.) with no build step required.
