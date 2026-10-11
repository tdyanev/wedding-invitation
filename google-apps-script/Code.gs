/**
 * Marlyn & Tihomir — RSVP backend (Google Apps Script Web App)
 * =============================================================
 * Bound to the private RSVP spreadsheet (Extensions → Apps Script).
 * Deployed as a Web App: Execute as "Me", access "Anyone".
 *
 * Contract
 *   POST  body = JSON string (sent by the site as Content-Type text/plain
 *         so the browser makes a "simple" request with no CORS preflight):
 *         { submissionId, fullName, attending: "YES"|"NO", message?, website? }
 *   Reply (always HTTP 200; Apps Script can't set status codes):
 *         { ok: true,  status: "created" | "duplicate", submissionId }
 *         { ok: false, code, retryable, field?, submissionId? }
 *
 * Guarantees
 *   - Append-only: rows are only ever added, never updated or deleted.
 *   - Idempotent per submissionId: a retry of a stored ID returns
 *     "duplicate" and writes nothing. Names are never deduplicated.
 *   - Serialized under LockService, so concurrent requests can't race
 *     the duplicate check or the append.
 *   - Logs carry submission IDs and outcomes only — never names or messages.
 */

var CONFIG = {
  SHEET_NAME: 'RSVPs',
  HEADERS: ['Timestamp', 'Submission ID', 'Full Name', 'Attending', 'Message'],
  MAX_NAME: 100,
  MAX_MESSAGE: 1000,
  MAX_BODY: 10000,              // bytes of raw request body
  RATE_LIMIT_PER_MINUTE: 30,    // new rows accepted per minute, site-wide
  LOCK_WAIT_MS: 20000
};

var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/* ---------------------------------------------------------------- */

function doPost(e) {
  var id = null;
  try {
    var raw = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
    if (!raw || raw.length > CONFIG.MAX_BODY) return fail_('BAD_REQUEST', false);

    var body;
    try { body = JSON.parse(raw); } catch (err) { return fail_('BAD_REQUEST', false); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail_('BAD_REQUEST', false);

    // Submission ID first, so every later outcome can be logged against it.
    id = typeof body.submissionId === 'string' ? body.submissionId.trim().toLowerCase() : '';
    if (!UUID_RE.test(id)) return fail_('VALIDATION', false, 'submissionId');

    // Honeypot: a visually hidden field that real guests never fill in.
    if (body.website != null && String(body.website).trim() !== '') {
      log_('rejected_spam', id);
      return fail_('REJECTED', false, null, id);
    }

    var v = validate_(body);
    if (v.error) {
      log_('rejected_validation:' + v.error, id);
      return fail_('VALIDATION', false, v.error, id);
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) {
      log_('busy', id);
      return fail_('BUSY', true, null, id);
    }
    try {
      var sheet = getSheet_();
      if (!sheet) {
        log_('config_error:sheet_missing', id);
        return fail_('NOT_CONFIGURED', false, null, id);
      }

      // Idempotency: has this exact submission already been stored?
      if (idExists_(sheet, id)) {
        log_('duplicate', id);
        return ok_('duplicate', id);
      }

      // Site-wide throttle (Apps Script can't see client IPs). Checked
      // after the duplicate test so honest retries are never throttled.
      if (!takeRateToken_()) {
        log_('rate_limited', id);
        return fail_('RATE_LIMITED', true, null, id);
      }

      sheet.appendRow([
        new Date(),                 // server-side timestamp
        id,
        safeCell_(v.fullName),
        v.attending,
        safeCell_(v.message)
      ]);
      SpreadsheetApp.flush();

      // Read back before acknowledging, so "created" means "persisted".
      if (!idExists_(sheet, id)) {
        log_('write_not_confirmed', id);
        return fail_('SERVER_ERROR', true, null, id);
      }
      log_('created', id);
      return ok_('created', id);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    // Message only — no request body, so no guest data reaches the logs.
    console.error(JSON.stringify({ event: 'rsvp', outcome: 'server_error', id: id, error: String(err && err.message || err) }));
    return fail_('SERVER_ERROR', true, null, id);
  }
}

/** Health check: open the /exec URL in a browser. Exposes no data. */
function doGet() {
  return json_({ ok: true, service: 'wedding-rsvp' });
}

/**
 * Run once from the editor (select "setup" → Run) on the sheet you've
 * approved. Creates the RSVPs tab with headers if it doesn't exist;
 * never touches existing rows.
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME) || ss.insertSheet(CONFIG.SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(CONFIG.HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).setFontWeight('bold');
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }
  Logger.log('RSVP sheet ready: "%s" (%s rows incl. header)', CONFIG.SHEET_NAME, sheet.getLastRow());
}

/* ---------------------------------------------------------------- */

function validate_(b) {
  if (typeof b.fullName !== 'string') return { error: 'fullName' };
  var fullName = cleanText_(b.fullName, false).replace(/\s+/g, ' ').trim();
  if (!fullName || fullName.length > CONFIG.MAX_NAME) return { error: 'fullName' };

  if (b.attending !== 'YES' && b.attending !== 'NO') return { error: 'attending' };

  var message = '';
  if (b.message != null) {
    if (typeof b.message !== 'string') return { error: 'message' };
    message = cleanText_(b.message, true).trim();
    if (message.length > CONFIG.MAX_MESSAGE) return { error: 'message' };
  }
  return { fullName: fullName, attending: b.attending, message: message };
}

/** Normalize Unicode and strip control characters (keeps newlines in messages). */
function cleanText_(s, keepNewlines) {
  s = String(s).normalize ? String(s).normalize('NFC') : String(s);
  s = s.replace(/\r\n?/g, '\n');
  return keepNewlines
    ? s.replace(/[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200F\u2028-\u202E\uFEFF]/g, '')
    : s.replace(/[\u0000-\u001F\u007F\u200B-\u200F\u2028-\u202E\uFEFF]/g, ' ');
}

/** Formula-injection guard: force text when a value could start a formula. */
function safeCell_(s) {
  return /^[=+\-@\t\r\n]/.test(s) ? "'" + s : s;
}

function getSheet_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet || sheet.getLastRow() === 0) return null;
  return sheet;
}

function idExists_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return false;
  return !!sheet.getRange(2, 2, last - 1, 1)
    .createTextFinder(id).matchEntireCell(true).matchCase(false).findNext();
}

/** Called under the script lock, so read-increment-write is race-free. */
function takeRateToken_() {
  var cache = CacheService.getScriptCache();
  var key = 'rsvp-rate-' + Math.floor(Date.now() / 60000);
  var n = Number(cache.get(key) || 0);
  if (n >= CONFIG.RATE_LIMIT_PER_MINUTE) return false;
  cache.put(key, String(n + 1), 120);
  return true;
}

function ok_(status, id) {
  return json_({ ok: true, status: status, submissionId: id });
}

function fail_(code, retryable, field, id) {
  var out = { ok: false, code: code, retryable: !!retryable };
  if (field) out.field = field;
  if (id) out.submissionId = id;
  return json_(out);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function log_(outcome, id) {
  console.info(JSON.stringify({ event: 'rsvp', outcome: outcome, id: id }));
}
