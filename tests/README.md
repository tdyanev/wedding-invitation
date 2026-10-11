# Tests (not part of the website)

The Google services are emulated here; these tests don't touch a real spreadsheet.

```bash
node tests/backend.test.js                       # Code.gs against in-memory SpreadsheetApp/LockService/CacheService
# Browser tests: Playwright + Chromium. The local HTTPS stand-in plays both Google hosts.
openssl req -x509 -newkey rsa:2048 -nodes -keyout tests/key.pem -out tests/cert.pem -days 2 \
  -subj "/CN=script.google.com" -addext "subjectAltName=DNS:script.google.com,DNS:script.googleusercontent.com"
# copy the site to ./test with APPS_SCRIPT_URL = https://script.google.com/macros/s/TEST_DEPLOYMENT/exec,
# serve it on :8765 (python3 -m http.server 8765), then:
node tests/browser.test.js
```
