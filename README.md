# Everything Shul

Marketing site for Everything Shul. Plain HTML/CSS/JS, no framework, no build step to deploy:
serve the folder with any static host (it runs on GitHub Pages at everythingshul.com).

`index.html`, `contact.html` and `share/*/index.html` are generated from `tools/build.py`
(`python3 tools/build.py`); share thumbnails in `assets/share/` come from `node tools/og.js`.
See `CLAUDE.md` for the full project notes, and `worker/README.md` for the contact-form email setup.
