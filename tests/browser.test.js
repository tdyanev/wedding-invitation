// Browser tests. The Apps Script endpoint is EMULATED: Code.gs runs in
// Node against in-memory Google services, behind the same redirect /
// CORS shape as a real Web App (POST /exec → 302 → googleusercontent
// echo URL served with Access-Control-Allow-Origin: *).
const { chromium } = require('playwright'); const assert = require('assert');
const { makeEnv } = require('./gas-mock');
const EXEC = 'https://script.google.com/macros/s/TEST_DEPLOYMENT/exec';
const SITE = 'http://localhost:8765/index.html';
let env = makeEnv(); let mode = 'normal'; let delayMs = 0; const requests = []; const echo = {}; let k = 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Local HTTPS stand-in for Google's two hosts (browser maps both names to it).
const https = require('https'), fs = require('fs');
https.createServer({ key: fs.readFileSync(__dirname + '/key.pem'), cert: fs.readFileSync(__dirname + '/cert.pem') }, (req, res) => {
  const host = (req.headers.host || '').split(':')[0]; let body = '';
  req.on('data', c => body += c); req.on('end', async () => {
    if (host === 'script.google.com' && req.url.startsWith('/macros/s/TEST_DEPLOYMENT/exec')) {
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'GET, HEAD, POST' }); return res.end(); }   // no preflight support, like Apps Script
      requests.push({ method: req.method, ct: req.headers['content-type'], origin: req.headers.origin, cookie: req.headers.cookie, body: JSON.parse(body) });
      if (delayMs) await sleep(delayMs);
      if (mode === 'network-down') return req.socket.destroy();
      const reply = env.ctx.doPost({ postData: { contents: body, type: req.headers['content-type'] } }).body;
      if (mode === 'drop-reply') return req.socket.destroy();       // stored, but the guest never hears back
      const key = 'K' + (++k); echo[key] = reply;
      res.writeHead(302, { location: 'https://script.googleusercontent.com/macros/echo?user_content_key=' + key, 'access-control-allow-origin': '*' }); return res.end();
    }
    if (host === 'script.googleusercontent.com' && req.method === 'GET' && req.url.startsWith('/macros/echo')) {
      const key = new URL(req.url, 'https://x').searchParams.get('user_content_key');
      const h = { 'content-type': 'application/json; charset=utf-8' };
      if (mode !== 'no-cors-header') h['access-control-allow-origin'] = '*';
      res.writeHead(200, h); return res.end(echo[key]);
    }
    res.writeHead(404); res.end();
  });
}).listen(8443);

async function newPage(browser, { touch = false } = {}) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, ...(touch ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 900 } }) });
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, body: '' }));
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (process.env.DBG) console.log('CONSOLE', m.type(), m.text()); }); page.on('requestfailed', r => process.env.DBG && console.log('REQFAIL', r.url(), r.failure()));
  await page.goto(SITE); await page.waitForTimeout(300);
  await page.evaluate(() => { window.__armStoryScroll(); });
  await page.keyboard.press('ArrowDown');                                       // the real opener → story transition
  await page.waitForFunction(() => document.documentElement.classList.contains('story-mode'));
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('rsvp-form-section').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(700);
  page.errors = errors; page.ctx = ctx; return page;
}
async function fill(page, { name = '', attend = null, message = '' }) {
  await page.fill('#rsvp-name', name); if (attend) await page.check(`input[name=rsvp-attend][value=${attend}]`);
  await page.fill('#rsvp-message', message);
}
async function swipeMouse(page) {
  await page.evaluate(() => document.getElementById('rsvp-send-track').scrollIntoView({ block: 'center' }));
  const t = await page.locator('#rsvp-send-thumb').boundingBox(); const tr = await page.locator('#rsvp-send-track').boundingBox();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(t.x + t.width / 2 + (tr.width) * i / 12, t.y + t.height / 2);
  await page.mouse.up();
}
async function swipeTouch(page) {
  await page.evaluate(() => document.getElementById('rsvp-send-track').scrollIntoView({ block: 'center' }));
  const t = await page.locator('#rsvp-send-thumb').boundingBox(); const tr = await page.locator('#rsvp-send-track').boundingBox();
  const cdp = await page.ctx.newCDPSession(page); const y = t.y + t.height / 2; let x = t.x + t.width / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + tr.width * i / 12, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const state = (page) => page.evaluate(() => ({
  confirmed: document.getElementById('rsvp-confirmation').classList.contains('shown'),
  formHidden: document.getElementById('rsvp-form-section').classList.contains('submitted'),
  status: document.getElementById('rsvp-submit-status').textContent,
  overlayOn: document.getElementById('send-ceremony').classList.contains('on'),
  trackDone: document.getElementById('rsvp-send-track').classList.contains('done'),
  nameErr: document.getElementById('rsvp-name-field').classList.contains('field-error'),
  attendErr: document.getElementById('rsvp-attend-field').classList.contains('field-error'),
  confirmMsg: document.getElementById('rsvp-confirm-message').textContent,
  confetti: document.getElementById('rsvp-confetti').children.length,
  name: document.getElementById('rsvp-name').value
}));
const rows = () => env.rows.slice(1);
let pass = 0; async function t(name, fn) { await fn(); pass++; console.log('PASS', name); }

(async () => {
  const browser = await chromium.launch({ args: ['--no-proxy-server', '--host-resolver-rules=MAP script.google.com 127.0.0.1:8443, MAP script.googleusercontent.com 127.0.0.1:8443'] });
  const shots = process.argv[2];

  await t('1+14 valid YES, desktop mouse drag; ceremony plays; success only after confirmation', async () => {
    env = makeEnv(); requests.length = 0; delayMs = 3500;
    const p = await newPage(browser); if (shots) await p.screenshot({ path: shots + '/1-form-desktop.png', clip: await p.locator('#rsvp-form-section').boundingBox() });
    await fill(p, { name: 'Ana Cruz', attend: 'yes', message: 'So happy for you!' });
    await swipeMouse(p); await p.waitForTimeout(3000);
    let s = await state(p); if (process.env.DBG) console.log(s, requests);  assert.ok(s.overlayOn, 'ceremony still on while unconfirmed'); assert.ok(!s.confirmed, 'no success before confirmation');
    const cls = await p.evaluate(() => document.getElementById('send-ceremony').className); assert.match(cls, /fly.*envelope-in.*envelope-sealed/);
    if (shots) await p.screenshot({ path: shots + '/2-ceremony-pending.png' });
    await p.waitForTimeout(1500); s = await state(p);
    assert.ok(s.confirmed && s.formHidden && !s.overlayOn); assert.strictEqual(s.confetti, 46); assert.match(s.confirmMsg, /saying .yes./);
    assert.strictEqual(requests.length, 1); assert.strictEqual(requests[0].ct, 'text/plain;charset=utf-8');
    assert.deepStrictEqual(rows().map(r => r.slice(2)), [['Ana Cruz', 'YES', 'So happy for you!']]);
    if (shots) { await p.waitForTimeout(800); await p.screenshot({ path: shots + '/3-confirmation.png' }); }
    assert.deepStrictEqual(p.errors, []); delayMs = 0; await p.ctx.close();
  });

  await t('2+3+13 valid NO, message omitted, mobile touch swipe', async () => {
    env = makeEnv(); requests.length = 0;
    const p = await newPage(browser, { touch: true }); await fill(p, { name: 'Ben Reyes', attend: 'no' });
    if (shots) await p.screenshot({ path: shots + '/4-form-mobile.png' });
    await swipeTouch(p); await p.waitForTimeout(3300); const s = await state(p);
    assert.ok(s.confirmed); assert.match(s.confirmMsg, /miss celebrating/);
    assert.deepStrictEqual(rows().map(r => r.slice(2)), [['Ben Reyes', 'NO', '']]); assert.deepStrictEqual(p.errors, []); await p.ctx.close();
  });

  await t('4 empty name → field error, no request; 5 no attendance → field error, no request', async () => {
    env = makeEnv(); requests.length = 0; const p = await newPage(browser);
    await fill(p, { name: '   ', attend: 'yes' }); await swipeMouse(p); await p.waitForTimeout(600);
    let s = await state(p); assert.ok(s.nameErr && !s.trackDone && !s.overlayOn);
    await p.evaluate(() => document.querySelectorAll('input[name=rsvp-attend]').forEach(r => r.checked = false)); await fill(p, { name: 'Cara' }); await swipeMouse(p); await p.waitForTimeout(600);
    s = await state(p); assert.ok(s.attendErr && !s.trackDone && !s.confirmed);
    assert.strictEqual(requests.length, 0); assert.strictEqual(rows().length, 0); await p.ctx.close();
  });

  await t('6 rapid repeated swipes / Enter presses while pending → one request, one row', async () => {
    env = makeEnv(); requests.length = 0; delayMs = 2500; const p = await newPage(browser);
    await fill(p, { name: 'Dan', attend: 'yes' });
    await swipeMouse(p); await swipeMouse(p);
    await p.evaluate(() => { const th = document.getElementById('rsvp-send-thumb'); for (let i = 0; i < 5; i++) th.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await p.waitForTimeout(3500); assert.strictEqual(requests.length, 1); assert.strictEqual(rows().length, 1); assert.ok((await state(p)).confirmed);
    delayMs = 0; await p.ctx.close();
  });

  await t('7 two separate submissions with the same name → two rows, different IDs', async () => {
    env = makeEnv(); requests.length = 0;
    for (const a of ['yes', 'no']) { const p = await newPage(browser); await fill(p, { name: 'Same Name', attend: a }); await swipeMouse(p); await p.waitForTimeout(3200); assert.ok((await state(p)).confirmed); await p.ctx.close(); }
    assert.strictEqual(rows().length, 2); assert.notStrictEqual(rows()[0][1], rows()[1][1]);
  });

  await t('8 reply lost after the row was stored → retry message, same ID on retry → "duplicate" → success, still one row', async () => {
    env = makeEnv(); requests.length = 0; mode = 'drop-reply'; const p = await newPage(browser);
    await fill(p, { name: 'Eve', attend: 'yes', message: 'hi' }); await swipeMouse(p); await p.waitForTimeout(3200);
    let s = await state(p); assert.ok(!s.confirmed && !s.formHidden && !s.trackDone); assert.match(s.status, /couldn.t confirm/); assert.strictEqual(s.name, 'Eve');
    assert.strictEqual(rows().length, 1); if (shots) await p.screenshot({ path: shots + '/5-retry-message.png', clip: await p.locator('#rsvp-form-section').boundingBox() });
    mode = 'normal'; await swipeMouse(p); await p.waitForTimeout(3200); s = await state(p);
    assert.ok(s.confirmed); assert.strictEqual(requests[0].body.submissionId, requests[1].body.submissionId);
    assert.strictEqual(rows().length, 1); await p.ctx.close();
  });

  await t('9 network failure → nothing stored, data kept; edited answers get a NEW id; retry succeeds', async () => {
    env = makeEnv(); requests.length = 0; mode = 'network-down'; const p = await newPage(browser);
    await fill(p, { name: 'Finn', attend: 'yes' }); await swipeMouse(p); await p.waitForTimeout(3200);
    let s = await state(p); assert.ok(!s.confirmed); assert.match(s.status, /couldn.t confirm/); assert.strictEqual(rows().length, 0);
    await swipeMouse(p); await p.waitForTimeout(3200);                                      // same answers → same id
    await fill(p, { name: 'Finn', attend: 'no' }); mode = 'normal'; await swipeMouse(p); await p.waitForTimeout(3200);
    s = await state(p); assert.ok(s.confirmed);
    assert.strictEqual(requests[0].body.submissionId, requests[1].body.submissionId); assert.notStrictEqual(requests[1].body.submissionId, requests[2].body.submissionId);
    assert.deepStrictEqual(rows().map(r => r.slice(2, 4)), [['Finn', 'NO']]); await p.ctx.close();
  });

  await t('M reply without CORS header (unreadable) → NOT shown as success', async () => {
    env = makeEnv(); requests.length = 0; mode = 'no-cors-header'; const p = await newPage(browser);
    await fill(p, { name: 'Gia', attend: 'yes' }); await swipeMouse(p); await p.waitForTimeout(3200);
    const s = await state(p); assert.ok(!s.confirmed); assert.match(s.status, /couldn.t confirm/); mode = 'normal'; await p.ctx.close();
  });

  await t('10 backend validation failure (name > 100 chars) → field error, no row, no success', async () => {
    env = makeEnv(); requests.length = 0; const p = await newPage(browser);
    await fill(p, { name: 'x'.repeat(120), attend: 'yes' }); await swipeMouse(p); await p.waitForTimeout(3200);
    const s = await state(p); assert.ok(!s.confirmed && s.nameErr); assert.match(s.status, /check your name/); assert.strictEqual(rows().length, 0); await p.ctx.close();
  });

  await t('11 concurrent submissions from 5 guests → 5 rows, all confirmed', async () => {
    env = makeEnv(); requests.length = 0; const pages = [];
    for (let i = 0; i < 5; i++) { const p = await newPage(browser); await fill(p, { name: 'Guest ' + i, attend: i % 2 ? 'no' : 'yes' }); pages.push(p); }
    await Promise.all(pages.map(swipeMouse)); await sleep(3500);
    for (const p of pages) { assert.ok((await state(p)).confirmed); await p.ctx.close(); }
    assert.strictEqual(rows().length, 5); assert.strictEqual(new Set(rows().map(r => r[1])).size, 5);
  });

  await t('12 formula injection through the form → stored as text', async () => {
    env = makeEnv(); requests.length = 0; const p = await newPage(browser);
    await fill(p, { name: '=HYPERLINK("http://evil.example","x")', attend: 'yes', message: '+SUM(1,2)' }); await swipeMouse(p); await p.waitForTimeout(3200);
    assert.ok((await state(p)).confirmed); assert.deepStrictEqual(rows()[0].slice(2), ["'=HYPERLINK(\"http://evil.example\",\"x\")", 'YES', "'+SUM(1,2)"]); await p.ctx.close();
  });

  await t('honeypot filled → rejected, guest-facing error, no row', async () => {
    env = makeEnv(); requests.length = 0; const p = await newPage(browser);
    await fill(p, { name: 'Bot', attend: 'yes' }); await p.evaluate(() => { document.getElementById('rsvp-website').value = 'spam'; });
    await swipeMouse(p); await p.waitForTimeout(3200); const s = await state(p); assert.ok(!s.confirmed); assert.match(s.status, /couldn.t be sent/); assert.strictEqual(rows().length, 0); await p.ctx.close();
  });

  await browser.close(); console.log(`\n${pass} browser tests passed`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
