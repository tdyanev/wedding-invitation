# Wedding Invitation

A single-page, interactive HTML wedding invitation.

## Structure
```
.
├── assets
│   └── images
│       ├── embedded-01.jpg   (Mayon landscape — opener background)
│       ├── embedded-02.png   (medallion / "Tap to Open" mark)
│       ├── embedded-03.png   (floral transition divider)
│       ├── embedded-04.png   (ceremony venue icon)
│       ├── embedded-05.png   (reception venue icon)
│       ├── embedded-06.jpg   (RSVP QR code)
│       ├── embedded-07.png   (RSVP confirmation background)
│       └── embedded-08.png   (farewell section background)
├── css
│   └── styles.css
├── index.html
└── js
    ├── script-1.js   (opener: door interaction, scaling, story-mode trigger)
    └── script-2.js   (Act II onward: story sections, RSVP, everything after the opener)
```

## Viewing locally
Just open `index.html` in a browser — no build step, no server required
(all asset paths are relative).

## Publishing with GitHub Pages
1. Push this repo to GitHub.
2. In the repo, go to **Settings → Pages**.
3. Under "Build and deployment", set **Source** to `Deploy from a branch`.
4. Choose the `main` branch and `/ (root)` folder, then save.
5. GitHub will publish the site at `https://<username>.github.io/<repo-name>/`.
