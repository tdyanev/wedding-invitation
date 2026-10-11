# Marlyn & Tihomir — wedding invitation (GitHub Pages)

Upload the contents of this folder to the root of your repo (or a `/docs` folder) and enable Pages.

- `index.html` — the page (CSS still inline; all images, music and scripts are now separate files)
- `js/opener.js`, `js/story.js` — the page's scripts (music loads from `audio/`; the RSVP swipe now waits for a confirmed save before the thank-you)
- `js/rsvp-submit.js` — sends the RSVP to Google Apps Script and reads its confirmation (**set your /exec URL here**)
- `images/`, `audio/` — extracted assets
- `google-apps-script/` — `Code.gs` backend + **README.md with setup, deployment, verification and limitations**
- `tests/` — automated tests (Node + Playwright, emulated Google services); not used by the site
- `.nojekyll` — tells GitHub Pages to serve files as-is

Paths are relative and case-sensitive on GitHub Pages — keep the folder names as they are.
Opening `index.html` straight from disk (file://) will block the music fetch; use GitHub Pages or a local server (`python3 -m http.server`).
