// Minimal in-memory emulation of the Apps Script services Code.gs uses.
const fs = require('fs'), vm = require('vm');
function makeEnv(opts = {}) {
  const rows = [];                       // rows[0] = header
  const logs = []; const openedById = [];
  let lockHeld = false, inCritical = 0, maxCritical = 0;
  const cacheStore = {};
  const sheet = {
    getLastRow: () => rows.length,
    appendRow: (r) => { if (!lockHeld && rows.length) throw new Error('append outside lock'); if (opts.failAppend && rows.length) throw new Error('Service unavailable'); rows.push([...r]); },
    setFrozenRows() {}, getRange: (r, c, n, w) => {
      if (typeof r === 'string') return { setNumberFormat() {} };
      return {
        setFontWeight() {},
        createTextFinder: (t) => { const f = { mc: false, ci: true,
          matchEntireCell(v) { f.mc = v; return f; }, matchCase(v) { f.ci = !v; return f; },
          findNext() { for (let i = r - 1; i < r - 1 + n; i++) { const v = String(rows[i][c - 1]);
            if (f.mc ? (f.ci ? v.toLowerCase() === t.toLowerCase() : v === t) : v.includes(t)) return {}; } return null; } }; return f; }
      };
    }
  };
  let tabExists = !opts.noSheet;
  const ss = { getName: () => 'Wedding RSVP', getSheetByName: (n) => (tabExists && n === 'RSVPs' ? sheet : null), insertSheet: () => { tabExists = true; return sheet; } };
  const ctx = {
    console: { info: (s) => logs.push(s), error: (s) => logs.push(s), log: (s) => logs.push(s) },
    Logger: { log() {} },
    JSON, Date, Math, String, Number, Array, RegExp,
    SpreadsheetApp: { getActiveSpreadsheet: () => (opts.standalone ? null : ss), openById: (i) => { if (i !== 'SHEET123') throw new Error('not found'); openedById.push(i); return ss; }, flush() {} },
    LockService: { getScriptLock: () => ({
      tryLock: () => { if (opts.lockBusy || lockHeld) return false; lockHeld = true; inCritical++; maxCritical = Math.max(maxCritical, inCritical); return true; },
      releaseLock: () => { if (lockHeld) { lockHeld = false; inCritical--; } } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cacheStore[k] ?? null, put: (k, v) => { cacheStore[k] = v; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ body: t, setMimeType() { return this; } }) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/../google-apps-script/Code.gs', 'utf8'), ctx);
  if (opts.spreadsheetId != null) vm.runInContext('CONFIG.SPREADSHEET_ID = ' + JSON.stringify(opts.spreadsheetId), ctx);
  if (!opts.noSheet && !opts.standalone) ctx.setup();
  return {
    rows, logs, ctx, openedById, stats: () => ({ maxCritical, lockHeld }),
    post: (obj) => JSON.parse(ctx.doPost({ postData: { contents: typeof obj === 'string' ? obj : JSON.stringify(obj) } }).body)
  };
}
module.exports = { makeEnv };
