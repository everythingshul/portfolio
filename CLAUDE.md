# Everything Shul — project context for Claude Code

This file exists so a fresh Claude Code session (no memory of the Cowork chat that built this
project) has enough context to keep working without re-asking the basics. Read this before
making changes.

## What this is

A static marketing/portfolio site for **Everything Shul**, a company that builds software for
shuls/nonprofits. It showcases six products the company built. No framework, no build step,
no dependencies — plain HTML/CSS/JS meant to be dropped straight into any static host (GitHub
Pages, Netlify, etc.) or a git repo.

Contact email used throughout the site: `everythingshul@gmail.com`.

## File structure

```
index.html          Home page: hero, about/value grid, showcase (6 products), process, CTA, footer
contact.html          Contact page: info card + a form that submits via a mailto: link (no backend)
css/style.css          All styling. CSS custom properties at the top define the theme.
js/main.js             Nav scroll state, mobile nav drawer, IntersectionObserver scroll-reveal,
                        auto-panning screenshot reels, preview-video play/pause on scroll,
                        full-tour video lightbox, contact form mailto handler.
assets/logo.png         "Everything Shul" wordmark, transparent background. See "Logo" below.
assets/video/           Product-tour videos + generated preview loops + poster frames.
README.md              Shorter, user-facing version of this same context.
```

## Theme

Colors as CSS custom properties in `css/style.css` `:root`: navy `#2f5596`, cyan `#25a9ea`,
dark backgrounds `#0a0f1a` → `#121d35`. Originally reverse-engineered from drm.everythingshul.com
via pixel sampling of the logo. Dark, modern aesthetic; IntersectionObserver-driven scroll
reveals (`.reveal` / `.reveal.in-view`, staggered via `.reveal-delay-1..4`).

Wording note: the site intentionally says "organization"/"organizations", never "community" —
this was an explicit client correction earlier in the project. Also intentionally has **no**
decorative pills, dashes before eyebrows, stat badges ("24/7 support", "5 shipped", "100% for
non-profits") — all were explicitly removed per client request. Don't reintroduce them.

## The six showcase products (in `index.html`, `#showcase` section)

1. **DRM** (`drm.everythingshul.com`) — donor relationship manager / CRM. Has a real product-tour
   video showcase.
2. **Kipas Hair BP** (`kipashairbp.org`, admin at `ecards.kipashairbp.org`) — gift-card assistance
   platform (shul registration, applicant approval, prepaid cards, store spend). Has a real
   video showcase.
3. **Kupes Hair Williamsburg** (`kupeshair.org`) — a *separate, distinct* white-labeled
   deployment of the same gift-card platform as #2, for a different client/org. Treated as its
   own 6th showcase card, not merged into Kipas Hair BP's card — the client was explicit about
   this. Has a real video showcase. Marked with a small "NEW" badge.
4. **JListings** (`jlistings.com`) — organization classifieds/editorial. **Placeholder only**
   (see "Known gaps" below).
5. **Mamudem** (`mamudem.com`) — event/dinner ticketing, QR check-in, attendee management.
   Has a real video showcase (preview loop cut from the ticket-purchase and promo-code screens,
   poster is the admin dashboard; the attendee table with personal details is only in the full tour).
6. **Fundraise Wall** (`fundraise.everythingshul.com`) — live fundraising wall + dashboard.
   **Placeholder only**.

## Video showcase pattern

For DRM / Kipas Hair BP / Kupes Hair Williamsburg, each showcase card uses `.video-frame`
(same browser-chrome look as `.browser-frame`, i.e. the dots + URL bar) wrapping a
`.video-stage` containing:
- a muted, looping `<video class="preview-video">` using `assets/video/{key}-preview.mp4`
  (silent, ~12s, 960px wide) with `poster="assets/video/{key}-poster.jpg"`
- a `.play-full` button (`data-video="assets/video/{key}-tour.mp4"` `data-title="..."`) that
  opens the **full, original, audio-on** tour video in a lightbox (`#video-lightbox` at the
  bottom of `index.html`, wired up in `main.js`)

`main.js` pauses/plays preview videos based on viewport visibility (IntersectionObserver) to
save bandwidth, and handles opening/closing the lightbox.

**Important judgment call, keep it this way unless the client says otherwise:** the preview
loops and poster frames were deliberately cropped to aggregate/dashboard moments of the videos
(totals, charts, stats) rather than screens that expose a real individual's personal contact
info. The DRM source video at one point opens a specific donor's profile card showing their
full name, phone number and email — that segment was avoided for the *always-visible autoplay
preview and poster*, but the full unedited tour video (used only on explicit click via "Watch
full tour") was left intact since it's the client's own footage and their call to include it.
If asked to change the preview/poster segments, keep this PII consideration in mind.

Video processing was done with ffmpeg: full tours re-encoded to 1280px/libx264/crf26/faststart
(no audio stripped from the *preview* loop only — the full tour keeps nothing special, it's
just re-encoded video, originals had no separate audio track of note), preview loops are a
~12s trimmed/scaled/muted clip, posters are single high-quality extracted frames.

## Logo

`assets/logo.png` is **not the original logo file** — the original was lost (see "Known gaps").
It was reconstructed by extracting a sharp frame from the DRM tour video's branded splash
screen (the video opens on an "Everything Shul / DRM / Donor Relationship Manager" splash),
cropping tightly around the white logo card, upscaling, and converting the white background to
transparency via a white-distance alpha mask. It's legible but a bit soft compared to a vector
original. **If the client ever provides the original logo file (e.g. a clean PNG/SVG with no
background), replace `assets/logo.png` with it** — it'll look noticeably crisper in the navbar
and footer.

## Known gaps / unfinished work

1. **JListings, Mamudem, and Fundraise Wall have no real screenshots.** An earlier version of
   this project had composited, auto-panning screenshot reels for all 5 original products
   (JListings, Mamudem, Kipas Hair BP, DRM, Fundraise Wall), built from real screenshots the
   client provided directly in chat. Those image files were lost in a sandbox reset and were
   never recovered. The three sites above currently render a `.placeholder-frame` (a styled
   monogram badge + "Preview coming soon") instead. **If the client provides screenshots for
   these three sites**, replace the placeholder markup with the real pattern used elsewhere:
   a `.scroll-window` containing a tall, stacked `<img>` (see `.scroll-window` / `main.js`'s
   auto-pan logic, which reads `img.naturalHeight` and animates a vertical pan via the
   `pan-y` keyframe and a `--travel` CSS variable). Crop screenshots to remove browser chrome
   first (the earlier version cropped a fixed pixel offset from the top of a full-page
   screenshot — remeasure for new screenshots rather than reusing an old pixel constant).

2. **DNS / domain pointing (separate, older thread, may not even be relevant anymore):** the
   client was trying to point a Wix-registered domain (`everythingshul.com`) at this site via
   GitHub Pages. This hit a real obstacle: Wix intentionally locks nameserver changes (a
   retention tactic, not a technical limitation) and its DNS panel silently caps the number of
   custom A records you can add, which blocked the standard 4-A-record GitHub Pages apex setup.
   Two unresolved paths were presented to the client and never decided: (a) contact Wix support
   and specifically ask for a "nameserver change" / escalate to their "Advanced Domain Team", or
   (b) transfer the domain away from Wix to a neutral registrar (e.g. Cloudflare) that allows
   full DNS control. If this comes up again, don't re-litigate the diagnosis — just help them
   execute whichever path they pick.

## Deploying

Static site, zero config. Drop the folder into GitHub Pages, Netlify, Vercel, S3, etc. No build
step, no `npm install`, nothing to compile.
