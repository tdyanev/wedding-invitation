# RSVP → Google Sheets: setup, deployment and verification

## How it works

```
Guest swipes heart ─► story.js validates name + Yes/No
                     ─► rsvp-submit.js  POST (JSON body, Content-Type: text/plain → no CORS preflight)
                          https://script.google.com/macros/s/<ID>/exec
                     ◄─ 302 → script.googleusercontent.com/... (served with Access-Control-Allow-Origin: *)
                     ◄─ {"ok":true,"status":"created"|"duplicate","submissionId":"…"}
Envelope ceremony plays meanwhile; the thank-you + confetti appear ONLY after ok:true.
```

- Every submission attempt carries a random `submissionId` (UUID v4). Retrying with the **same answers** reuses the ID, so the server answers `duplicate` instead of adding a second row. **Changing any answer** creates a new ID, which counts as a new submission.
- The sheet is append-only. Names are never deduplicated, and the same guest can submit any number of times.
- Every request is handled one at a time under `LockService`: duplicate check → rate-limit check → append → read back → reply.

## 1. Create the Google Sheet (private)

1. Create a new Google Sheet, e.g. **"Wedding RSVPs — TEST"**. Start with a test sheet and make the production one only once you're happy with it.
2. Leave sharing as **Restricted** (only you). Don't publish it to the web and don't share its link. The script writes as you, so guests never need access.

## 2. Add the script and tell it which spreadsheet to use

1. In the sheet: **Extensions → Apps Script**. Delete the sample code and paste the whole of `Code.gs`.
2. At the top of `Code.gs`, set **`SPREADSHEET_ID`** to the ID from the sheet's address bar:
   `https://docs.google.com/spreadsheets/d/`**`1AbC…xyz`**`/edit` → `SPREADSHEET_ID: '1AbC…xyz',`
   (If the script was opened from inside the sheet, you can leave it `''`, but setting it is clearer and also works for scripts created at script.google.com.)
3. **`SHEET_NAME` is a tab name, not the file name.** The default, `'RSVPs'`, is created automatically as a tab inside the spreadsheet on the first RSVP (or when you run `setup`). Don't put the spreadsheet's file name here.
4. Click **Save**, choose **`setup`** in the function dropdown and click **Run**. Authorize when asked; Google warns that the app is unverified, but it's your own script, so choose *Advanced → Go to …*. The log shows `RSVP sheet ready: "RSVPs" tab in "<your file>"`.

## 3. Deploy as a Web App

1. **Deploy → New deployment** → gear icon → **Web app**.
2. **Execute as: Me**. **Who has access: Anyone** (not "Anyone with Google account", which makes guests' browsers fail).
3. Click **Deploy**, then copy the **Web app URL**. It looks like `https://script.google.com/macros/s/AKfy…/exec`.
4. Open the URL in a browser. It should show `{"ok":true,"service":"wedding-rsvp"}`.

**Updating the script later:** use **Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy**. That keeps the same URL. Choosing "New deployment" instead creates a *new* URL.

## 4. Point the website at it

In `js/rsvp-submit.js` replace:

```js
var APPS_SCRIPT_URL = 'PASTE_YOUR_WEB_APP_URL_HERE';
```

with your `/exec` URL. This URL is public by design: it's not a secret and is safe to commit. Nothing else in the site needs configuring.

## 5. Verify with test RSVPs (on the TEST sheet)

Serve the site (GitHub Pages, or locally with `python3 -m http.server`), then:

| # | Do | Expect in the sheet | Expect on the page |
|---|----|----|----|
| 1 | Name "Test Yes", Yes, message "hello", swipe | 1 new row, `YES`, `hello` | envelope → thank-you ("saying yes") + confetti |
| 2 | Reload. "Test No", No, no message | 1 new row, `NO`, empty message | thank-you ("miss celebrating") |
| 3 | Reload. Swipe with an empty name | nothing | red "Please enter your name." |
| 4 | Reload. "Test Same", Yes; reload; "Test Same", No | 2 rows, different Submission IDs | both confirmed |
| 5 | Reload. Name `=1+1`, Yes | cell shows `=1+1` as text, not `2` | confirmed |
| 6 | Reload. DevTools → Network → **Offline**, swipe | nothing | "We couldn't confirm…", answers still filled |
| 7 | Go back **Online**, swipe again with the same answers | 1 new row | confirmed |

Then check **Apps Script → Executions**. Each run logs `{"event":"rsvp","outcome":"created","id":"…"}`, and logs never include names or messages. Delete the test rows (or the test sheet) when you're done.

**Going to production:** either rename and clear the test sheet, or repeat steps 1–4 on a fresh sheet. A fresh sheet gets a new script and a new `/exec` URL, so update `js/rsvp-submit.js` again.

## Responses the page can receive

| Reply | Page behaviour |
|---|---|
| `ok:true, status:created/duplicate` | thank-you + confetti |
| `VALIDATION` (`field`) | marks that field, no success |
| `BUSY`, `RATE_LIMITED`, `SERVER_ERROR`, network error, timeout (25 s), unreadable reply | "couldn't confirm…" (or "many RSVPs arriving…"), answers kept, swipe again → same ID |
| `REJECTED` (honeypot), `NOT_CONFIGURED` (no spreadsheet: set `SPREADSHEET_ID`), `BAD_REQUEST` | "couldn't be sent (reason)", no success; the reason is also in the browser console |

## Limits and known limitations

- **Field limits:** name 1–100 characters, message 0–1,000. Control characters are stripped and whitespace in names is collapsed.
- **Spam protection is light.** There's a hidden honeypot field plus a site-wide cap of 30 new rows per minute (`CONFIG.RATE_LIMIT_PER_MINUTE`). Apps Script can't see client IP addresses, so there's no per-person limiting. A determined attacker who posts directly to the URL can still add junk rows at up to that rate, and could make real guests see "many RSVPs arriving" while doing it. If that ever happens: redeploy to get a new URL, or lower the limit, and delete the junk rows by hand.
- **Formula safety:** values starting with `= + - @` are stored with a leading apostrophe, so Sheets shows them as text. If you later **export to CSV** and open it in Excel, check those cells again, because the apostrophe isn't part of the exported value.
- **Dependence on Google's redirect behaviour:** confirmation relies on Apps Script's documented redirect of ContentService output to `script.googleusercontent.com`, which is served with `Access-Control-Allow-Origin: *`. If Google ever changes that, the page will show "couldn't confirm" rather than a false success. RSVPs would still be stored, and the duplicate protection stops retries from double-counting.
- **Quotas:** a consumer Google account allows plenty for a wedding (tens of thousands of Web App calls a day). Each RSVP takes roughly 1–3 s, or longer on a cold start, which the envelope animation covers.
- **Retry identity** lasts for the current browser tab (sessionStorage). If a guest's first attempt was stored but unconfirmed, and they later resubmit identical answers from a *different* device, that creates a second row. That's acceptable under the "multiple submissions allowed" rule.
