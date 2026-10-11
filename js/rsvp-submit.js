/* ============================================================
   RSVP transport → Google Apps Script → Google Sheets
   ------------------------------------------------------------
   Exposes window.WeddingRsvp.submit(fields) → Promise<result>,
   called by story.js after the heart swipe passes validation.

   Transport: a CORS "simple" POST (body is JSON, Content-Type is
   text/plain, no custom headers → no preflight). Apps Script answers
   via a redirect to script.googleusercontent.com, which is served
   with Access-Control-Allow-Origin: *, so the JSON reply is readable
   and success is only reported when the server says it stored the row.

   Results:
     { state: 'saved' }                       row created, or already stored
     { state: 'invalid', field }              server rejected a field
     { state: 'retry',   reason }             failed or uncertain — safe to retry
     { state: 'error',   reason }             won't succeed by retrying as-is

   CONFIG: paste the Web App URL (ends in /exec). It is public by
   design — it is not a secret.
   ============================================================ */
(function(){
  "use strict";

  var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwDTMPxQbncviBltoqsxz66gamjNZqiQgNthwW3F_LtR3MrWpa2XPEk6GrcjLrJgH7sqg/exec';
  var TIMEOUT_MS = 25000;                        // Apps Script cold starts can take a few seconds
  var PENDING_KEY = 'wedding-rsvp-pending';      // sessionStorage: survives a reload of this tab

  var inFlight = null;                           // the Promise of the request in progress

  function uuid4(){
    if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function(x){ return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0,8) + '-' + h.slice(8,12) + '-' + h.slice(12,16) + '-' + h.slice(16,20) + '-' + h.slice(20);
  }

  function loadPending(){
    try{ return JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); }catch(e){ return null; }
  }
  function savePending(p){
    try{ p ? sessionStorage.setItem(PENDING_KEY, JSON.stringify(p)) : sessionStorage.removeItem(PENDING_KEY); }catch(e){}
  }

  /* Same answers as an unconfirmed attempt → same submissionId (a retry).
     Any change → a new submissionId (a genuinely new submission). */
  function idFor(fields){
    var fp = JSON.stringify([fields.fullName, fields.attending, fields.message]);
    var p = loadPending();
    if(p && p.fp === fp && p.id) return p.id;
    var id = uuid4();
    savePending({ fp: fp, id: id });
    return id;
  }

  function post(payload){
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function(){ if(ctrl) ctrl.abort(); }, TIMEOUT_MS);
    return fetch(String(APPS_SCRIPT_URL).trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      credentials: 'omit',            // anonymous: avoids multi-Google-account redirect issues
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function(res){
      if(!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).finally(function(){ clearTimeout(timer); });
  }

  function submit(fields){
    if(inFlight) return inFlight;                 // never two requests at once

    var url = String(APPS_SCRIPT_URL).trim();
    if(!/^https:\/\/script\.google\.com\/.+\/exec(\?.*)?$/.test(url)){
      console.error('[RSVP] APPS_SCRIPT_URL in js/rsvp-submit.js must be the Web app URL ending in /exec. Current value:', url);
      return Promise.resolve({ state: 'error', reason: 'not-configured' });
    }

    var clean = {
      fullName: String(fields.fullName || '').trim(),
      attending: fields.attending,
      message: String(fields.message || '').trim()
    };
    var payload = {
      submissionId: idFor(clean),
      fullName: clean.fullName,
      attending: clean.attending,
      message: clean.message,
      website: String(fields.website || '')      // honeypot
    };

    inFlight = post(payload).then(function(r){
      if(r && r.ok === true && (r.status === 'created' || r.status === 'duplicate') && r.submissionId === payload.submissionId){
        savePending(null);                        // confirmed — this submission is done
        return { state: 'saved', status: r.status };
      }
      if(r && r.ok === false){
        if(r.code === 'VALIDATION') return { state: 'invalid', field: r.field || null };
        if(r.retryable) return { state: 'retry', reason: String(r.code || 'server').toLowerCase() };
        return { state: 'error', reason: String(r.code || 'server').toLowerCase() };
      }
      return { state: 'retry', reason: 'unexpected-response' };
    }, function(err){
      // Network failure, timeout, blocked or unreadable reply: the row may
      // or may not exist. The same submissionId is kept for the retry.
      console.warn('[RSVP] submission status uncertain:', err && err.name === 'AbortError' ? 'timeout' : (err && err.message));
      return { state: 'retry', reason: 'network' };
    }).then(function(result){
      if(result.state !== 'saved') console.warn('[RSVP] not saved:', result.state, result.reason || result.field || '');
      inFlight = null;
      return result;
    });
    return inFlight;
  }

  window.WeddingRsvp = { submit: submit };
})();
