(function(){
  "use strict";

  /* ============================================================
     WEDDING AUDIO (v56, mix updated v58) — procedural, self-contained
     Web Audio for the scratch + confetti sounds. The background music
     ("Turning Page", embedded) shares this same AudioContext and the
     same MASTER gain — see the BACKGROUND MUSIC block further down.

     UNLOCK / RELIABILITY
     iOS/iPadOS Safari (and Chrome on iOS, which uses the same
     engine), desktop Safari and Chrome only allow a Web Audio
     context to run once it has been created or resumed inside a
     genuine user gesture. unlockAudio() is therefore called
     synchronously from real gestures only — the "Tap to Open"
     medallion tap (first chance) and every pointerdown / touchstart
     / touchend on the scratch card (so a failed first attempt is
     retried on the very next touch). It:
       • creates the context lazily,
       • calls resume() and tracks the async result,
       • plays a 1-sample silent buffer (the classic iOS unlock),
       • asks iOS 16.4+/17 to treat Web Audio like media playback
         (navigator.audioSession) so it is audible alongside the
         background music the way the <audio> element already is,
       • re-resumes after an iOS "interrupted" state (phone call,
         Siri, app switch) on the next gesture.
     Sounds scheduled while resume() is still settling are placed
     on the context timeline and play the instant it runs, so the
     very first scratch movement is never lost.

     SCRATCH (v57) — fingernail-on-paper "scritch" events driven only
     by real finger/mouse movement (distance travelled). Each one is
     freshly synthesised stick-slip paper friction (see
     makePaperScritch()), 30-80ms long, with a natural irregular
     rhythm and now and then a quick double "scritch-scritch". Fast
     strokes → a little denser and louder; slow strokes → sparse and
     soft; no movement → silence. Each event is two tiny nodes into
     one shared paper-tone chain, disconnected as soon as it ends.

     CONFETTI — "elegant champagne celebration": a soft airy whoosh,
     a delicate paper-confetti flutter, a faint champagne fizz and a
     gentle soft release (~1.3s). Scheduled in the same callback as
     triggerConfetti() so sound and confetti are one event.

     Every entry point fails silently if Web Audio is unavailable,
     so the scratch card and confetti always keep working.
     ============================================================ */
  var audioCtx = null;
  var AudioCtor = window.AudioContext || window.webkitAudioContext;
  var audioUnlockedOnce = false;
  var scratchBus = null;        // shared paper-tone chain for scratch events
  var fxBus = null;             // shared bus for the reveal/confetti sound
  var fibreBuf = null;          // pre-built noise buffers (created once)
  var airBuf = null;
  var scratchActive = false;
  var scratchLocked = false;
  var scratchLevel = 0;
  var scratchAcc = 0;
  var lastScratchEvt = 0;       // performance.now() of the last event
  var liveScratchEvents = 0;
  var revealSoundPlayed = false;
  // v58 mix: every sound now runs through one MASTER gain. Scratch and
  // confetti sit well under the background music (≈ -10 dB and -9 dB
  // from v57), so the hierarchy is music → scratch → confetti accent.
  var masterGain = null;
  var SCRATCH_LEVEL = 0.32;
  var CONFETTI_LEVEL = 0.35;

  function buildBuses(ctx){
    // Scratch: dry paper/card tone — no rumble, no hiss, gentle body.
    var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 420; hp.Q.value = 0.6;
    var body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 1900; body.Q.value = 0.8; body.gain.value = 3;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4600; lp.Q.value = 0.4;
    masterGain = ctx.createGain(); masterGain.gain.value = 1;
    masterGain.connect(ctx.destination);
    var sg = ctx.createGain(); sg.gain.value = SCRATCH_LEVEL;
    hp.connect(body); body.connect(lp); lp.connect(sg); sg.connect(masterGain);
    scratchBus = { input: hp, gain: sg };

    // Reveal: a gentle compressor keeps the layered celebration soft.
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 18; comp.ratio.value = 3;
    comp.attack.value = 0.004; comp.release.value = 0.2;
    var fg = ctx.createGain(); fg.gain.value = 1;
    var fxOut = ctx.createGain(); fxOut.gain.value = CONFETTI_LEVEL;
    fg.connect(comp); comp.connect(fxOut); fxOut.connect(masterGain);
    fxBus = fg;

    // Fibre noise: soft noise + sparse tiny crackles (paper fibres
    // catching), so each burst reads as dry card, not static.
    var len = Math.floor(ctx.sampleRate * 0.6);
    fibreBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = fibreBuf.getChannelData(0), last = 0;
    for(var i = 0; i < len; i++){
      var w = Math.random() * 2 - 1;
      last = 0.55 * last + 0.45 * w;
      var crackle = (Math.random() < 0.012) ? (Math.random() * 2 - 1) * 1.6 : 0;
      d[i] = last * 0.75 + crackle;
    }
    // Airy noise for the whoosh / flutter layers.
    var alen = Math.floor(ctx.sampleRate * 1.6);
    airBuf = ctx.createBuffer(1, alen, ctx.sampleRate);
    var a = airBuf.getChannelData(0), l2 = 0;
    for(var j = 0; j < alen; j++){
      var w2 = Math.random() * 2 - 1;
      l2 = 0.8 * l2 + 0.2 * w2;
      a[j] = (l2 * 1.6 + w2 * 0.35);
    }
  }

  function unlockAudio(){
    if(!AudioCtor) return null;
    try{
      if(!audioCtx){
        try{
          if(navigator.audioSession && navigator.audioSession.type !== 'playback'){
            navigator.audioSession.type = 'playback';
          }
        }catch(e){}
        audioCtx = new AudioCtor();
        buildBuses(audioCtx);
      }
      if(audioCtx.state !== 'running'){
        var p = audioCtx.resume();
        if(p && p.catch) p.catch(function(){});
      }
      if(!audioUnlockedOnce){
        audioUnlockedOnce = true;
        var b = audioCtx.createBuffer(1, 1, 22050);
        var s = audioCtx.createBufferSource();
        s.buffer = b; s.connect(audioCtx.destination);
        s.onended = function(){ try{ s.disconnect(); }catch(e){} };
        if(s.start) s.start(0); else s.noteOn(0);
      }
      return audioCtx;
    }catch(e){ return null; }
  }
  // Earliest genuine gesture on the page (the "Tap to Open" tap) also
  // unlocks the context silently, so it is already running by the
  // time the guest reaches the scratch card. Removed after it works.
  function earlyUnlock(){
    unlockAudio();
    // Kept attached: any later tap also quietly repairs the background
    // music if a browser paused/suspended it (see musicHeal()).
    if(typeof musicHeal === 'function') musicHeal();
  }
  ['pointerdown','touchend','click','keydown'].forEach(function(ev){
    document.addEventListener(ev, earlyUnlock, true);
  });

  // Run fn once the context is actually running (resolves immediately
  // if it already is; otherwise waits briefly for resume()).
  function whenRunning(fn, maxWaitMs){
    var ctx = audioCtx;
    if(!ctx) return;
    if(ctx.state === 'running'){ fn(ctx); return; }
    var done = false;
    try{
      var p = ctx.resume();
      if(p && p.then){
        p.then(function(){ if(!done && ctx.state === 'running'){ done = true; fn(ctx); } }).catch(function(){});
      }
    }catch(e){}
    setTimeout(function(){ done = true; }, maxWaitMs || 400);
  }

  /* One paper "scritch" (v57). Synthesised fresh for every event, so
     no two are ever the same sample: a fingernail on thick matte card
     is stick-slip friction — a quick, irregular train of tiny catches
     on the paper fibres, each one ringing briefly through the card's
     own "body". So each event is built from:
       • an irregular impulse train (the catches), its rate rising a
         little with scratching speed, with random spacing and strength,
       • two short, well-damped resonances (the paper body, ~1.3-2kHz
         and ~2.7-3.8kHz, re-tuned slightly every event),
       • a faint, band-limited friction bed underneath,
       • a soft attack, a slightly wavering level, a natural decay, and
         on some strokes a tiny initial "catch" transient.
     30-80ms each; about 1-4k samples of arithmetic per event, then
     just two short-lived nodes (buffer source + gain). */
  function makePaperScritch(ctx, level){
    var sr = ctx.sampleRate;
    var dur = 0.03 + Math.random() * 0.05;
    var n = Math.max(64, Math.floor(sr * dur));
    var buf = ctx.createBuffer(1, n, sr);
    var d = buf.getChannelData(0);
    function reso(f, bw){
      var r = Math.exp(-Math.PI * bw / sr);
      return { c: 2 * r * Math.cos(2 * Math.PI * f / sr), q: r * r, y1: 0, y2: 0 };
    }
    var A = reso(1300 + Math.random() * 700, 420 + Math.random() * 180);
    var B = reso(2700 + Math.random() * 1100, 700 + Math.random() * 300);
    var bright = 0.35 + level * 0.35 + Math.random() * 0.1;
    var rate = 150 + level * 220 + Math.random() * 70;           // catches per second
    var period = sr / rate;
    var nextImp = Math.floor(Math.random() * period * 0.5);
    var transient = Math.random() < 0.4;
    var attack = Math.floor(sr * (0.004 + Math.random() * 0.008));
    var decayFrom = 0.4 + Math.random() * 0.2;
    var bed = 0, wob = 0.85 + Math.random() * 0.3, wobT = wob, peak = 0;
    for(var i = 0; i < n; i++){
      var x = 0;
      if(i >= nextImp){
        x = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.7);
        nextImp = i + period * (0.5 + Math.random() * 1.0);
      }
      if(transient && i === 0) x = 1.3;
      bed = 0.6 * bed + 0.4 * (Math.random() * 2 - 1);
      x += bed * 0.11;
      var a = x + A.c * A.y1 - A.q * A.y2; A.y2 = A.y1; A.y1 = a;
      var b = x + B.c * B.y1 - B.q * B.y2; B.y2 = B.y1; B.y1 = b;
      if((i & 127) === 0) wobT = 0.7 + Math.random() * 0.55;   // slightly irregular pressure
      wob += (wobT - wob) * 0.01;
      var t = i / n;
      var env = (i < attack) ? (0.5 - 0.5 * Math.cos(Math.PI * i / attack)) : 1;
      if(t > decayFrom) env *= Math.pow(1 - (t - decayFrom) / (1 - decayFrom), 1.7);
      var v = (a + b * bright) * env * wob;
      d[i] = v;
      var av = v < 0 ? -v : v;
      if(av > peak) peak = av;
    }
    if(peak > 0){ var k = 1 / peak; for(var m = 0; m < n; m++) d[m] *= k; }
    return buf;
  }

  function scratchEvent(ctx, when, level, soft){
    if(liveScratchEvents > 8) return;
    var src = ctx.createBufferSource();
    src.buffer = makePaperScritch(ctx, level);
    var g = ctx.createGain();
    g.gain.value = (0.04 + level * 0.045) * (0.8 + Math.random() * 0.4) * (soft ? 0.6 : 1);
    src.connect(g); g.connect(scratchBus.input);
    liveScratchEvents++;
    src.onended = function(){ liveScratchEvents--; try{ src.disconnect(); g.disconnect(); }catch(e){} };
    src.start(when);
  }

  // Called from the genuine pointerdown that begins scratching.
  function startScratchSound(){
    if(scratchLocked) return;
    var ctx = unlockAudio();
    if(!ctx) return;
    scratchActive = true;
    scratchLevel = 0;
    scratchAcc = 0;
    try{
      var t = ctx.currentTime;
      scratchBus.gain.gain.cancelScheduledValues(t);
      scratchBus.gain.gain.setValueAtTime(SCRATCH_LEVEL, t);
    }catch(e){}
  }

  // Called on every pointermove with the distance travelled in real
  // screen px and the elapsed ms. Converts movement into discrete
  // micro-scratch events — denser and a touch louder when fast.
  function updateScratchSound(dist, dt){
    if(!scratchActive || scratchLocked || !audioCtx || !scratchBus || !(dist > 0)) return;
    try{
      var ctx = audioCtx;
      var speed = dist / Math.max(1, dt || 16);                 // px/ms
      var inst = Math.max(0, Math.min(1, speed / 1.6));
      scratchLevel = scratchLevel * 0.55 + inst * 0.45;
      scratchAcc += dist;
      var step = 18 - scratchLevel * 8;                          // px per scritch (18 slow → 10 fast)
      var now = performance.now();
      // natural, slightly irregular rhythm: longer gaps when slow,
      // closer together when fast — never a steady tick
      var minGap = 62 - scratchLevel * 30 + Math.random() * 14;   // ms
      if(scratchAcc >= step && now - lastScratchEvt >= minGap){
        scratchAcc -= step * (0.75 + Math.random() * 0.5);
        lastScratchEvt = now;
        if(Math.random() < 0.08){
          lastScratchEvt = now + 40 + Math.random() * 50;         // a tiny breath between scritches
        } else {
          var when = ctx.currentTime + 0.004 + Math.random() * 0.012;
          scratchEvent(ctx, when, scratchLevel, false);
          scratchDuckPing();
          if(Math.random() < 0.25){                              // "scritch-scritch"
            scratchEvent(ctx, when + 0.04 + Math.random() * 0.025, scratchLevel, true);
          }
        }
      }
      if(scratchAcc > step * 3) scratchAcc = step;             // never bank up a backlog
    }catch(e){}
  }

  // pointerup/cancel: events are self-ending, so just stop issuing
  // new ones. `immediate` (the reveal) also mutes anything still
  // sounding within ~30ms and locks scratching sound for good.
  function stopScratchSound(immediate){
    scratchActive = false;
    scratchLevel = 0;
    scratchAcc = 0;
    if(immediate) scratchLocked = true;
    if(!immediate || !audioCtx || !scratchBus) return;
    try{
      var t = audioCtx.currentTime, g = scratchBus.gain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + 0.03);
    }catch(e){}
  }

  /* ---- Reveal: "elegant champagne celebration" — plays exactly
     once, scheduled in the same callback as triggerConfetti(). ---- */
  function playRevealChime(){
    if(revealSoundPlayed) return;
    revealSoundPlayed = true;
    if(!audioCtx) unlockAudio();
    whenRunning(renderCelebration, 350);
  }

  function renderCelebration(ctx){
    try{
      var t = ctx.currentTime + 0.01;
      var nodes = [];
      var keep = function(n){ nodes.push(n); return n; };
      var panOK = !!ctx.createStereoPanner;

      // 1) Soft airy whoosh — breathy noise whose band rises with the
      //    burst then settles, like air moving as the confetti lifts.
      var w = keep(ctx.createBufferSource()); w.buffer = airBuf;
      var wf = keep(ctx.createBiquadFilter()); wf.type = 'bandpass'; wf.Q.value = 0.7;
      wf.frequency.setValueAtTime(520, t);
      wf.frequency.exponentialRampToValueAtTime(2300, t + 0.32);
      wf.frequency.exponentialRampToValueAtTime(900, t + 1.2);
      var wg = keep(ctx.createGain());
      wg.gain.setValueAtTime(0.0001, t);
      wg.gain.exponentialRampToValueAtTime(0.14, t + 0.09);
      wg.gain.exponentialRampToValueAtTime(0.05, t + 0.45);
      wg.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
      w.connect(wf); wf.connect(wg); wg.connect(fxBus);
      w.start(t); w.stop(t + 1.3);

      // 2) Delicate paper-confetti flutter — many tiny, bright paper
      //    ticks, dense at the burst and thinning out as it falls,
      //    spread gently across the stereo field.
      var flutHP = keep(ctx.createBiquadFilter()); flutHP.type = 'highpass'; flutHP.frequency.value = 2200;
      var flutLP = keep(ctx.createBiquadFilter()); flutLP.type = 'lowpass'; flutLP.frequency.value = 8500;
      flutHP.connect(flutLP); flutLP.connect(fxBus);
      var flutters = 46;
      for(var i = 0; i < flutters; i++){
        var u = Math.random();
        var at = t + 0.03 + Math.pow(u, 1.8) * 1.05;             // front-loaded
        var decay = 1 - (at - t) / 1.15;
        var s = keep(ctx.createBufferSource()); s.buffer = fibreBuf;
        s.playbackRate.value = 1.1 + Math.random() * 0.9;
        var g = keep(ctx.createGain());
        var pk = (0.03 + Math.random() * 0.05) * Math.max(0.25, decay);
        var d = 0.008 + Math.random() * 0.022;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(pk, at + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, at + d);
        s.connect(g);
        if(panOK){
          var p = keep(ctx.createStereoPanner()); p.pan.value = Math.random() * 1.4 - 0.7;
          g.connect(p); p.connect(flutHP);
        } else {
          g.connect(flutHP);
        }
        s.start(at, Math.random() * 0.5, d + 0.02);
      }

      // 3) Champagne shimmer — a faint high "fizz": a whisper of very
      //    high air plus tiny, ultra-short bubble glints (a few ms
      //    each, far too short to read as a bell or a chime).
      var fz = keep(ctx.createBufferSource()); fz.buffer = airBuf;
      var fzf = keep(ctx.createBiquadFilter()); fzf.type = 'highpass'; fzf.frequency.value = 6500;
      var fzg = keep(ctx.createGain());
      fzg.gain.setValueAtTime(0.0001, t + 0.08);
      fzg.gain.exponentialRampToValueAtTime(0.045, t + 0.3);
      fzg.gain.exponentialRampToValueAtTime(0.0001, t + 1.35);
      fz.connect(fzf); fzf.connect(fzg); fzg.connect(fxBus);
      fz.start(t + 0.08, 0.3); fz.stop(t + 1.4);
      var glints = 18;
      for(var k = 0; k < glints; k++){
        var gt = t + 0.12 + Math.random() * 1.0;
        var o = keep(ctx.createOscillator()); o.type = 'sine';
        o.frequency.setValueAtTime(3200 + Math.random() * 3600, gt);
        o.frequency.exponentialRampToValueAtTime(3000 + Math.random() * 4000, gt + 0.012);
        var og = keep(ctx.createGain());
        og.gain.setValueAtTime(0.0001, gt);
        og.gain.exponentialRampToValueAtTime(0.008 + Math.random() * 0.012, gt + 0.002);
        og.gain.exponentialRampToValueAtTime(0.0001, gt + 0.014 + Math.random() * 0.01);
        o.connect(og);
        if(panOK){
          var op = keep(ctx.createStereoPanner()); op.pan.value = Math.random() * 1.2 - 0.6;
          og.connect(op); op.connect(fxBus);
        } else {
          og.connect(fxBus);
        }
        o.start(gt); o.stop(gt + 0.03);
      }

      // 4) Gentle soft release — a warm, low puff of air under the
      //    burst that exhales away (body without any "pop" or thump).
      var r = keep(ctx.createBufferSource()); r.buffer = airBuf;
      var rf = keep(ctx.createBiquadFilter()); rf.type = 'lowpass'; rf.Q.value = 0.5;
      rf.frequency.setValueAtTime(700, t);
      rf.frequency.exponentialRampToValueAtTime(180, t + 0.9);
      var rg = keep(ctx.createGain());
      rg.gain.setValueAtTime(0.0001, t);
      rg.gain.exponentialRampToValueAtTime(0.1, t + 0.025);
      rg.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
      r.connect(rf); rf.connect(rg); rg.connect(fxBus);
      r.start(t, 0.6); r.stop(t + 1.0);

      // Release every node once the whole sound has finished.
      setTimeout(function(){
        for(var n = 0; n < nodes.length; n++){ try{ nodes[n].disconnect(); }catch(e){} }
        nodes.length = 0;
      }, 1800);
    }catch(e){}
  }

  /* ============================================================
     BACKGROUND MUSIC (v77) — "Turning Page", Clover the Violinist.
     Embedded once in this file (#wedding-music-audio). No external
     files, no libraries. The recording is played exactly as it is:
     no compression, no loudness boosting, no re-encoding, no pitch or
     time changes.

     START — the guest's tap on the M&T medallion (the gesture that
     unlocks audio on iPhone/iPad) starts the song from 0:00 as the
     ceremonial doors begin to open, easing in over 2s.

     ONE TIMELINE — the song then simply plays on beneath the whole
     invitation: Mayon, Our Story, the Bride and Groom, Moments
     Between, the wedding details, RSVP and the Farewell. Nothing
     restarts it; scrolling, sections, photos, FAQ and RSVP only ever
     change its level, gently. When it reaches its own natural ending
     it rests a moment in silence, then begins again from 0:00.

     MIX — one AudioContext, one MASTER gain:
         music (song → fade → trim → level → duck → tab-hide) ─┐
         scratch (paper scritches)  ───────────────────────────┼─→ MASTER → out
         confetti (celebration)     ───────────────────────────┘
     MUSIC_VOLUME (the trim) keeps the violin a refined background
     score under the invitation. Section levels differ by at most
     ~1 dB and move over ~3s, so the guest never notices the system.

     DUCKING — active scratching dips it very slightly and it returns
     softly; the date reveal takes a small breath under the confetti
     sound. Tab hidden → soft fade + pause (the song keeps its place);
     back → resume from the same moment and fade in.
     ============================================================ */
  // Overall music level (linear gain). A delicate violin recording,
  // kept soft enough that the visual design stays dominant.
  var MUSIC_VOLUME = 0.2;
  var MUSIC_LEVELS = {             // relative to MUSIC_VOLUME — deliberately subtle
    opening:     1.0,              // doors, Mayon, names — the score breathes
    scratch:     0.92,             // a whisper lower while the paper is scratched
    revealed:    1.0,              // the wedding date
    invited:     1.0,              // "You're Invited"
    story:       1.0,              // Our Story, the Bride and Groom
    moments:     1.0,              // the photographs
    proposal:    1.0,
    celebration: 0.9,              // ceremony, reception, party, dress code, gift
    faq:         0.9,
    rsvp:        0.9,
    countdown:   0.92,
    farewell:    1.0               // emotionally complete, then the end fade
  };
  var START_FADE = 2.0;            // gentle fade-in from the medallion tap
  var LOOP_GAP = 1.5;              // quiet breath before the song begins again
  var END_FADE = 7.0;              // resting at the very end of the Farewell

  var musicBytes = null;           // the MP3 (one copy, as bytes)
  var musicBuf = null;             // decoded song
  var musicDecoding = false;
  var musicWanted = false;
  var musicGraph = false;
  var musicLevelNode = null, musicDuckNode = null, musicHideNode = null, musicIn = null;
  var musicVoice = null;           // { src, g, startedAt, offset }
  var loopRestartTimer = null, hideTimer = null;
  var musicKey = null;
  var scratchDuckTimer = null, scratchDucked = false;
  var silentKeeper = null;

  // The MP3 now lives next to the page (audio/turning-page.mp3) instead
  // of being base64-embedded. It's fetched once, as early as possible;
  // when it arrives decodeMusic() is re-run automatically.
  var MUSIC_URL = 'audio/turning-page.mp3';
  var musicFetching = false;
  function loadMusicFile(){
    if(musicBytes || musicBuf || musicFetching || !window.fetch) return;
    musicFetching = true;
    fetch(MUSIC_URL).then(function(r){
      if(!r.ok) throw new Error('music ' + r.status);
      return r.arrayBuffer();
    }).then(function(ab){
      musicFetching = false;
      musicBytes = new Uint8Array(ab);
      decodeMusic();
    }).catch(function(){ musicFetching = false; });
  }
  loadMusicFile();

  function readMusicBytes(){
    if(musicBytes) return musicBytes;
    loadMusicFile();               // not here yet — decodeMusic() reruns on arrival
    return null;
  }

  function onMusicDecoded(buf){
    musicDecoding = false;
    if(!buf) return;
    musicBuf = buf;
    musicBytes = null;             // the decoded song is all we need now
    if(musicWanted && !musicVoice && audioCtx) startMusicVoice(0, START_FADE);
  }
  function decodeWith(ctx, bytes, done){
    var copy = bytes.buffer.slice(0);          // decodeAudioData detaches its input
    try{
      var p = ctx.decodeAudioData(copy, function(b){ done(b); }, function(){ done(null); });
      if(p && p.catch) p.catch(function(){});
    }catch(e){ done(null); }
  }
  // Decode ahead of time (no gesture needed) with an offline context at
  // the recording's own 44.1kHz rate, so the violin is heard at its full
  // original quality. Falls back to the live context.
  function decodeMusic(){
    if(musicBuf || musicDecoding) return;
    var bytes = readMusicBytes();
    if(!bytes) return;
    musicDecoding = true;
    var Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var off = null;
    try{ if(Off) off = new Off(2, 1, 44100); }catch(e){ off = null; }
    if(off){
      decodeWith(off, bytes, function(b){
        if(b){ onMusicDecoded(b); return; }
        if(audioCtx){ decodeWith(audioCtx, bytes, onMusicDecoded); }
        else { musicDecoding = false; }       // retried from the tap
      });
    } else if(audioCtx){
      decodeWith(audioCtx, bytes, onMusicDecoded);
    } else {
      musicDecoding = false;                   // retried from the tap
    }
  }
  window.addEventListener('load', function(){
    setTimeout(function(){ try{ decodeMusic(); }catch(e){} }, 700);
  });

  // Plain gain stages only — no compressor (a DynamicsCompressor would
  // squeeze the violin's natural dynamics and add make-up gain).
  function buildMusicGraph(ctx){
    if(musicGraph || !masterGain) return;
    try{
      var trim = ctx.createGain(); trim.gain.value = MUSIC_VOLUME;
      musicLevelNode = ctx.createGain(); musicLevelNode.gain.value = 0;
      musicDuckNode = ctx.createGain();  musicDuckNode.gain.value = 1;
      musicHideNode = ctx.createGain();  musicHideNode.gain.value = 1;
      trim.connect(musicLevelNode);
      musicLevelNode.connect(musicDuckNode);
      musicDuckNode.connect(musicHideNode);
      musicHideNode.connect(masterGain);
      musicIn = trim;
      musicGraph = true;
    }catch(e){ musicGraph = false; }
  }

  // The single playback timeline. `fade` = seconds of gentle fade-in.
  function startMusicVoice(offset, fade, atCtx){
    if(!musicBuf || !audioCtx || !musicGraph) return null;
    if(musicVoice) return musicVoice;          // one timeline only
    try{
      var src = audioCtx.createBufferSource();
      src.buffer = musicBuf;
      var g = audioCtx.createGain();
      var t = (typeof atCtx === 'number') ? Math.max(atCtx, audioCtx.currentTime + 0.02) : audioCtx.currentTime + 0.02;
      if(fade > 0){
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(1, t + fade);
      } else {
        g.gain.value = 1;
      }
      src.connect(g); g.connect(musicIn);
      src.start(t, offset);
      var v = { src: src, g: g, startedAt: t, offset: offset };
      src.onended = function(){
        try{ src.disconnect(); g.disconnect(); }catch(e){}
        if(musicVoice !== v) return;
        musicVoice = null;
        // The song reached its own natural ending (it fades out on the
        // recording): rest a moment, then begin again from 0:00.
        if(musicWanted){
          if(loopRestartTimer) clearTimeout(loopRestartTimer);
          loopRestartTimer = setTimeout(function(){
            loopRestartTimer = null;
            if(musicWanted && !musicVoice) startMusicVoice(0, START_FADE);
          }, LOOP_GAP * 1000);
        }
      };
      musicVoice = v;
      return v;
    }catch(e){ return null; }
  }

  function rampParam(param, target, secs){
    var t = audioCtx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(target, t + Math.max(0.02, secs));
  }
  function setMusicLevel(v, secs){
    if(musicGraph && audioCtx){ try{ rampParam(musicLevelNode.gain, v, secs); }catch(e){} }
  }
  function setMusicKey(key, secs){
    if(musicKey === key) return;
    musicKey = key;
    if(!musicWanted || !(key in MUSIC_LEVELS)) return;
    setMusicLevel(MUSIC_LEVELS[key], secs);
  }

  // Older iPhones (before iOS 16.4) mute Web Audio with the ring/silent
  // switch; a silent looping <audio> puts the page in "media playback"
  // mode, like any music player, so the song is heard either way.
  function keepMediaSession(){
    if(navigator.audioSession || silentKeeper) return;
    try{
      var sr = 8000, n = 800, buf = new ArrayBuffer(44 + n), dv = new DataView(buf);
      var w = function(o, s){ for(var i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, sr, true); dv.setUint32(28, sr, true); dv.setUint16(32, 1, true);
      dv.setUint16(34, 8, true); w(36, 'data'); dv.setUint32(40, n, true);
      for(var i = 0; i < n; i++) dv.setUint8(44 + i, 128);
      var el = document.createElement('audio');
      el.src = URL.createObjectURL(new Blob([buf], {type:'audio/wav'}));
      el.loop = true;
      el.setAttribute('playsinline', '');
      var p = el.play(); if(p && p.catch) p.catch(function(){});
      silentKeeper = el;
    }catch(e){}
  }

  // Called from the medallion tap (a genuine gesture — it unlocks audio
  // on iPhone/iPad). Starts "Turning Page" from 0:00 as the doors part,
  // easing in over START_FADE. Idempotent.
  function musicStart(){
    if(musicWanted){ musicHeal(); return; }
    var ctx = unlockAudio();
    if(!ctx) return;
    musicWanted = true;
    keepMediaSession();
    buildMusicGraph(ctx);
    musicKey = 'opening';
    try{
      var g = musicLevelNode.gain, t = ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(MUSIC_LEVELS.opening, t);
    }catch(e){}
    if(musicBuf) startMusicVoice(0, START_FADE);
    else decodeMusic();                         // starts itself (from 0:00) once ready
  }

  // Any later tap quietly repairs playback if a browser suspended it
  // (iOS interruptions, returning to the app, etc.) — it resumes from
  // the same moment; it never restarts the song.
  function musicHeal(){
    if(!musicWanted || document.hidden) return;
    try{
      if(audioCtx && audioCtx.state !== 'running'){
        var p = audioCtx.resume(); if(p && p.catch) p.catch(function(){});
      }
      if(silentKeeper && silentKeeper.paused){ var q = silentKeeper.play(); if(q && q.catch) q.catch(function(){}); }
      if(!musicBuf) decodeMusic();
    }catch(e){}
  }

  // Ducking (music only) — kept very small so it is felt, not noticed.
  function duckMusic(amount, attack){
    if(!musicGraph || !audioCtx) return;
    try{ rampParam(musicDuckNode.gain, 1 - amount, attack); }catch(e){}
  }
  function unduckMusic(release){
    if(!musicGraph || !audioCtx) return;
    try{ rampParam(musicDuckNode.gain, 1, release); }catch(e){}
  }
  function scratchDuckPing(){
    if(!scratchDucked){ scratchDucked = true; duckMusic(0.1, 0.25); }
    if(scratchDuckTimer) clearTimeout(scratchDuckTimer);
    scratchDuckTimer = setTimeout(scratchDuckRelease, 320);
  }
  function scratchDuckRelease(){
    if(scratchDuckTimer){ clearTimeout(scratchDuckTimer); scratchDuckTimer = null; }
    if(scratchDucked){ scratchDucked = false; unduckMusic(0.9); }
  }
  // Date reveal: a small breath under the confetti sound, then the
  // music returns softly for "You're Invited".
  function musicRevealMoment(){
    if(scratchDuckTimer){ clearTimeout(scratchDuckTimer); scratchDuckTimer = null; }
    scratchDucked = false;
    if(musicGraph && audioCtx){
      try{
        var g = musicDuckNode.gain, t = audioCtx.currentTime;
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(0.88, t + 0.2);
        g.setValueAtTime(0.88, t + 0.5);
        g.linearRampToValueAtTime(1, t + 1.6);
      }catch(e){}
    }
    setMusicKey('invited', 3.0);
  }

  // Tab/app hidden → soft fade, then pause (the song keeps its place);
  // back → resume from the same moment and fade in.
  document.addEventListener('visibilitychange', function(){
    if(!musicWanted || !audioCtx) return;
    if(document.hidden){
      try{ rampParam(musicHideNode.gain, 0, 0.35); }catch(e){}
      if(hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(function(){
        try{ var p = audioCtx.suspend(); if(p && p.catch) p.catch(function(){}); }catch(e){}
        try{ silentKeeper && silentKeeper.pause(); }catch(e){}
      }, 420);
    } else {
      if(hideTimer){ clearTimeout(hideTimer); hideTimer = null; }
      try{ var p = audioCtx.resume(); if(p && p.catch) p.catch(function(){}); }catch(e){}
      try{ if(silentKeeper){ var q = silentKeeper.play(); if(q && q.catch) q.catch(function(){}); } }catch(e){}
      try{
        var g = musicHideNode.gain, t = audioCtx.currentTime;
        g.cancelScheduledValues(t); g.setValueAtTime(0, t); g.linearRampToValueAtTime(1, t + 1.4);
      }catch(e){}
    }
  });

  /* Story mode: the level follows whichever section sits at the middle
     of the screen (very subtly — see MUSIC_LEVELS); resting at the very
     end of the Farewell fades the music out. Never restarts the song. */
  var storyTracking = false;
  function musicEnterStory(){
    if(storyTracking) return;
    storyTracking = true;
    var defs = [
      ['viewport', 'invited'], ['act-ii', 'story'], ['moments-between', 'moments'],
      ['act-ii-closing', 'story'], ['act-iii', 'celebration'], ['act-iv', 'faq'],
      ['act-v', 'rsvp'], ['countdown-act', 'countdown'], ['act-vi', 'farewell']
    ].map(function(d){ return { el: document.getElementById(d[0]), key: d[1] }; })
     .filter(function(d){ return !!d.el; });

    var endTimer = null, endFaded = false, ticking = false;
    function update(){
      ticking = false;
      if(!musicWanted) return;
      var vh = window.innerHeight || 1, mid = vh * 0.5, key = null;
      for(var i = 0; i < defs.length; i++){
        var r = defs[i].el.getBoundingClientRect();
        if(r.height && r.top <= mid && r.bottom > mid){ key = defs[i].key; break; }
      }

      var doc = document.documentElement;
      var fromBottom = doc.scrollHeight - (window.scrollY + vh);
      var farewell = defs[defs.length - 1];
      var farewellOnScreen = farewell && farewell.key === 'farewell' &&
                             farewell.el.getBoundingClientRect().top < vh * 0.9;
      if(fromBottom <= 30 && farewellOnScreen){
        // the Farewell is heard in full first, then — once the guest
        // rests at the very end — the music gently closes
        if(!endFaded && key) setMusicKey(key, 3.0);
        if(!endFaded && !endTimer){
          endTimer = setTimeout(function(){
            endTimer = null; endFaded = true;
            setMusicLevel(0, END_FADE);
          }, 2600);
        }
        return;
      }
      if(endTimer){ clearTimeout(endTimer); endTimer = null; }
      if(endFaded){
        if(fromBottom < vh * 0.3) return;        // small wobble at the end: stay faded
        endFaded = false;
        musicKey = null;                          // force a gentle return
        if(key){ musicKey = key; setMusicLevel(MUSIC_LEVELS[key], 3.0); }
        return;
      }
      if(key) setMusicKey(key, 3.0);
    }
    function onScroll(){
      if(!ticking){ ticking = true; requestAnimationFrame(update); }
    }
    window.addEventListener('scroll', onScroll, {passive:true});
    window.addEventListener('resize', onScroll);
    setTimeout(onScroll, 50);
  }

  window.__music = {
    start: musicStart,
    heal: musicHeal,
    setKey: setMusicKey,
    enterStory: musicEnterStory,
    // read-only snapshot, handy for checking the mix in a console
    state: function(){
      var v = musicVoice;
      return {
        key: musicKey, decoded: !!musicBuf, playing: !!v,
        time: (v && audioCtx) ? v.offset + (audioCtx.currentTime - v.startedAt) : 0,
        level: musicLevelNode ? musicLevelNode.gain.value : 0,
        duck: musicDuckNode ? musicDuckNode.gain.value : 1,
        volume: MUSIC_VOLUME,
        context: audioCtx ? audioCtx.state : 'none'
      };
    }
  };

  /* ---------- Responsive scaling of the fixed 1086x1448 stage ---------- */
  var stage = document.getElementById('stage');
  var STAGE_W = 1086, STAGE_H = 1448;
  var HALF_W = STAGE_W / 2; // 543

  /* Fallback only — used when the browser doesn't support length-division
     in calc() (see the @supports CSS rule above, which wins via
     !important whenever it applies). Mirrors the same COVER behavior as
     the CSS: max() on every screen size, so the stage always fills the
     viewport with no letterboxed bands, on phone, tablet, or desktop. */
  function fitStage(){
    var vv = window.visualViewport;
    var vw = (vv && vv.width) ? vv.width : window.innerWidth;
    var vh = (vv && vv.height) ? vv.height : window.innerHeight;
    var scale = Math.max(vw / STAGE_W, vh / STAGE_H);
    stage.style.transform = 'scale(' + scale + ')';
  }
  window.addEventListener('resize', fitStage);
  window.addEventListener('orientationchange', fitStage);
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', fitStage);
    window.visualViewport.addEventListener('scroll', fitStage);
  }
  fitStage();

  /* =====================================================================
     CEREMONIAL DOOR ARTWORK
     Each door half is a 543 x 1448 SVG illustration:
       - dimensional pink panel with radial "candlelit" glow toward the seam
       - outer stone-toned architrave frame
       - tall recessed arch panel containing two raised door panels
       - fanlight tracery radiating from the arch springline (seam side)
       - decorative pilaster + hairlines running along the seam edge
       - hairline flourishes echoing the reference video's corner curls
     The seam-side details sit near local x=543; the outer frame sits near
     local x=0. The right door reuses this exact markup mirrored via
     CSS scaleX(-1), so the seam ornament lands correctly against x=543
     on both halves.
  ===================================================================== */
  var NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs){
    var e = document.createElementNS(NS, tag);
    for(var k in attrs){ e.setAttribute(k, attrs[k]); }
    return e;
  }

  function buildDoorSVG(){
    var svg = el('svg', {viewBox:'0 0 543 1448', preserveAspectRatio:'none'});

    var defs = el('defs', {});
    svg.appendChild(defs);

    // Base dimensional gradient: warm light near the seam (where the medallion
    // sits), settling into a deeper dusty rose toward the outer edge.
    var gradBase = el('radialGradient', {
      id:'gradBase', cx:'92%', cy:'50%', r:'95%'
    });
    gradBase.appendChild(el('stop', {offset:'0%', 'stop-color':'#f6dfe2'}));
    gradBase.appendChild(el('stop', {offset:'30%', 'stop-color':'#eec7cd'}));
    gradBase.appendChild(el('stop', {offset:'62%', 'stop-color':'#dcaab3'}));
    gradBase.appendChild(el('stop', {offset:'100%', 'stop-color':'#c48d98'}));
    defs.appendChild(gradBase);

    // Recessed arch well
    var gradWell = el('linearGradient', {id:'gradWell', x1:'0%', y1:'0%', x2:'100%', y2:'0%'});
    gradWell.appendChild(el('stop', {offset:'0%', 'stop-color':'#c98d97'}));
    gradWell.appendChild(el('stop', {offset:'50%', 'stop-color':'#e2b7bd'}));
    gradWell.appendChild(el('stop', {offset:'100%', 'stop-color':'#f0d6da'}));
    defs.appendChild(gradWell);

    // Raised panel bevel gradient (light upper-left to shadow lower-right)
    var gradPanel = el('linearGradient', {id:'gradPanel', x1:'0%', y1:'0%', x2:'100%', y2:'100%'});
    gradPanel.appendChild(el('stop', {offset:'0%', 'stop-color':'#fbeef0'}));
    gradPanel.appendChild(el('stop', {offset:'45%', 'stop-color':'#eec7cd'}));
    gradPanel.appendChild(el('stop', {offset:'100%', 'stop-color':'#c98d97'}));
    defs.appendChild(gradPanel);

    var gradPanelShadow = el('linearGradient', {id:'gradPanelShadow', x1:'0%', y1:'0%', x2:'100%', y2:'100%'});
    gradPanelShadow.appendChild(el('stop', {offset:'0%', 'stop-color':'#b97883', 'stop-opacity':'0.9'}));
    gradPanelShadow.appendChild(el('stop', {offset:'100%', 'stop-color':'#f0d6da', 'stop-opacity':'0'}));
    defs.appendChild(gradPanelShadow);

    // soft blur for inset shadows
    var filter = el('filter', {id:'softBlur', x:'-30%', y:'-30%', width:'160%', height:'160%'});
    filter.appendChild(el('feGaussianBlur', {stdDeviation:'6'}));
    defs.appendChild(filter);

    /* ---- base slab ---- */
    svg.appendChild(el('rect', {x:0, y:0, width:543, height:1448, fill:'url(#gradBase)'}));

    /* ---- subtle vertical fluting across the whole slab for dimensionality ---- */
    var flute = el('g', {opacity:'0.35'});
    for(var fx = 34; fx < 520; fx += 34){
      flute.appendChild(el('line', {
        x1:fx, y1:24, x2:fx, y2:1424,
        stroke: (fx/34) % 2 === 0 ? '#ffffff' : '#8a4a54',
        'stroke-width':0.6,
        opacity: (fx/34) % 2 === 0 ? 0.18 : 0.10
      }));
    }
    svg.appendChild(flute);

    /* ---- outer architrave frame ---- */
    svg.appendChild(el('rect', {
      x:22, y:22, width:499, height:1404, rx:4,
      fill:'none', stroke:'#e6cd9c', 'stroke-width':2.4, opacity:0.85
    }));
    svg.appendChild(el('rect', {
      x:32, y:32, width:479, height:1384, rx:3,
      fill:'none', stroke:'#8a4a54', 'stroke-width':0.8, opacity:0.35
    }));

    /* ---- recessed arch well (tall arch shape housing the panels) ---- */
    var wellX = 62, wellW = 419;
    var wellTop = 150, wellBottom = 1330;
    var archPath =
      'M ' + wellX + ' ' + (wellTop+140) +
      ' L ' + wellX + ' ' + wellBottom +
      ' L ' + (wellX+wellW) + ' ' + wellBottom +
      ' L ' + (wellX+wellW) + ' ' + (wellTop+140) +
      ' C ' + (wellX+wellW) + ' ' + (wellTop+40) + ', ' + (wellX+wellW*0.72) + ' ' + wellTop + ', ' + (wellX+wellW/2) + ' ' + wellTop +
      ' C ' + (wellX+wellW*0.28) + ' ' + wellTop + ', ' + wellX + ' ' + (wellTop+40) + ', ' + wellX + ' ' + (wellTop+140) +
      ' Z';
    svg.appendChild(el('path', {d:archPath, fill:'url(#gradWell)'}));
    // inset shadow lip around the well
    var shadowLip = el('path', {d:archPath, fill:'none', stroke:'#8a4a54', 'stroke-width':10, opacity:'0.20', filter:'url(#softBlur)'});
    svg.appendChild(shadowLip);
    svg.appendChild(el('path', {d:archPath, fill:'none', stroke:'#e6cd9c', 'stroke-width':1.6, opacity:'0.8'}));

    /* ---- fanlight tracery at the arch crown, radiating from the springline ---- */
    var fan = el('g', {opacity:'0.55'});
    var cx = wellX + wellW/2, cy = wellTop + 118, rInner = 8, rOuter = 128;
    var rayCount = 11;
    for(var i=0;i<=rayCount;i++){
      var t = i/rayCount;
      var ang = Math.PI * (0.18 + t*0.64); // sweep across the arch crown
      var x1 = cx + Math.cos(ang)*rInner*-1 + rInner; // small inner offset
      var x1p = cx - Math.cos(ang)*rInner;
      var y1p = cy - Math.sin(ang)*rInner;
      var x2p = cx - Math.cos(ang)*rOuter;
      var y2p = cy - Math.sin(ang)*rOuter;
      fan.appendChild(el('line', {
        x1:x1p, y1:y1p, x2:x2p, y2:y2p,
        stroke:'#e6cd9c', 'stroke-width':0.7, opacity: 0.25 + 0.35*Math.sin(t*Math.PI)
      }));
    }
    svg.appendChild(fan);
    svg.appendChild(el('circle', {cx:cx, cy:cy, r:3, fill:'#e6cd9c', opacity:0.6}));

    /* ---- two raised door panels within the well ---- */
    function panel(px, py, pw, ph){
      var g = el('g', {});
      g.appendChild(el('rect', {x:px+6, y:py+8, width:pw, height:ph, rx:6, fill:'#8a4a54', opacity:0.18, filter:'url(#softBlur)'}));
      g.appendChild(el('rect', {x:px, y:py, width:pw, height:ph, rx:6, fill:'url(#gradPanel)'}));
      g.appendChild(el('rect', {x:px, y:py, width:pw, height:ph, rx:6, fill:'none', stroke:'#e6cd9c', 'stroke-width':1.1, opacity:0.7}));
      g.appendChild(el('rect', {x:px+14, y:py+14, width:pw-28, height:ph-28, rx:3, fill:'none', stroke:'#8a4a54', 'stroke-width':0.7, opacity:0.3}));
      return g;
    }
    var pW = wellW - 96, pX = wellX + 48;
    svg.appendChild(panel(pX, 330, pW, 380));
    svg.appendChild(panel(pX, 760, pW, 500));

    /* ---- seam-side pilaster (sits near local x = 543, the door meeting edge) ---- */
    var pilaster = el('g', {});
    pilaster.appendChild(el('rect', {x:517, y:26, width:16, height:1396, fill:'#dba9b0'}));
    pilaster.appendChild(el('rect', {x:517, y:26, width:16, height:1396, fill:'none', stroke:'#e6cd9c', 'stroke-width':1, opacity:0.7}));
    pilaster.appendChild(el('line', {x1:525, y1:26, x2:525, y2:1422, stroke:'#8a4a54', 'stroke-width':0.6, opacity:0.35}));
    // small diamond hardware accents
    [90, 724, 1358].forEach(function(dy){
      var d = el('rect', {x:520.5, y:dy-6, width:9, height:9, fill:'#e6cd9c', opacity:0.85, transform:'rotate(45 525 '+dy+')'});
      pilaster.appendChild(d);
    });
    svg.appendChild(pilaster);

    /* ---- hairline flourishes echoing the reference video's curling accents ---- */
    var flour = el('g', {opacity:'0.5', fill:'none', stroke:'#e6cd9c', 'stroke-width':1});
    flour.appendChild(el('path', {d:'M 60 1360 C 60 1392, 96 1408, 132 1410'}));
    flour.appendChild(el('path', {d:'M 500 96 C 468 96, 452 78, 452 50'}));
    svg.appendChild(flour);

    /* ---- gentle overall vignette to match the reference lighting ---- */
    var vGrad = el('radialGradient', {id:'vign', cx:'88%', cy:'50%', r:'85%'});
    vGrad.appendChild(el('stop', {offset:'55%', 'stop-color':'#000000', 'stop-opacity':'0'}));
    vGrad.appendChild(el('stop', {offset:'100%', 'stop-color':'#5b2c35', 'stop-opacity':'0.28'}));
    defs.appendChild(vGrad);
    svg.appendChild(el('rect', {x:0, y:0, width:543, height:1448, fill:'url(#vign)'}));

    return svg;
  }

  // v76: the same artwork is now written into the page itself (so the
  // closed doors cover everything from the very first frame, even while
  // a phone is still downloading the file). Draw it only if missing.
  if(!document.querySelector('#face-left svg')) document.getElementById('face-left').appendChild(buildDoorSVG());
  if(!document.querySelector('#face-right svg')) document.getElementById('face-right').appendChild(buildDoorSVG());

  /* ---------- Typography: build per-character spans ---------- */
  function buildChars(el, text){
    el.innerHTML = "";
    for(var i=0;i<text.length;i++){
      var ch = text[i];
      var span = document.createElement('span');
      if(ch === ' '){
        span.className = 'space';
        span.innerHTML = '&nbsp;';
      } else {
        span.className = 'char';
        span.textContent = ch;
      }
      el.appendChild(span);
    }
  }
  var lineNames = document.getElementById('line-names');
  var lineGetting = document.getElementById('line-getting');
  var lineMarried = document.getElementById('line-married');

  buildChars(lineNames, "Marlyn & Tihomir");
  buildChars(lineGetting, "WE ARE GETTING");
  buildChars(lineMarried, "MARRIED");

  function typeLine(elx, delayBetween, cb){
    var chars = elx.querySelectorAll('.char');
    var i = 0;
    function step(){
      if(i >= chars.length){ if(cb) cb(); return; }
      chars[i].classList.add('visible');
      i++;
      setTimeout(step, delayBetween);
    }
    step();
  }

  /* ---------- Champagne dust (v68 — replaces the fireworks) ----------
     No bursts, no explosions: a small, fixed number of tiny champagne
     motes that fade in slowly as the doors part and drift upward like
     dust in warm evening light. Low opacity and a soft size range keep
     it atmosphere-first; it never competes with the names or "WE ARE
     GETTING MARRIED". Uses the existing #fireworks canvas (so no new
     layer), stops itself once the guest moves into the story (where
     the existing gold particle bridge takes over) and while the tab is
     hidden, and never runs with prefers-reduced-motion. */
  var canvas = document.getElementById('fireworks');
  var ctx = canvas.getContext('2d');
  canvas.width = STAGE_W;
  canvas.height = STAGE_H;

  var dustTones = ['#E8D6A8', '#D9C28F', '#F3E9D2'];
  var dust = [];
  var dustStart = 0;
  var dustRunning = false;

  function makeMote(randomY){
    return {
      x: Math.random() * STAGE_W,
      y: randomY ? Math.random() * STAGE_H : STAGE_H + 10,
      r: 1.4 + Math.random() * 1.8,                 // stage px (≈1–2 screen px)
      vy: -(0.08 + Math.random() * 0.14),           // a slow upward float
      sway: 0.15 + Math.random() * 0.25,
      freq: 0.0003 + Math.random() * 0.0004,
      phase: Math.random() * Math.PI * 2,
      peak: 0.18 + Math.random() * 0.24,            // never above ~0.42
      tw: 0.0006 + Math.random() * 0.0008,          // slow shimmer
      color: dustTones[Math.floor(Math.random() * dustTones.length)]
    };
  }

  function animateDust(now){
    if(!dustRunning) return;
    if(document.documentElement.classList.contains('story-mode')){
      dustRunning = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    if(!dustStart) dustStart = now;
    var fadeIn = Math.min(1, (now - dustStart) / 3200);   // eases in over ~3s
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for(var i = 0; i < dust.length; i++){
      var p = dust[i];
      p.y += p.vy;
      p.x += Math.sin(p.phase + now * p.freq) * p.sway * 0.1;
      if(p.y < -10){ dust[i] = makeMote(false); continue; }
      var shimmer = 0.6 + 0.4 * Math.sin(p.phase + now * p.tw);
      ctx.globalAlpha = p.peak * shimmer * fadeIn;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(animateDust);
  }

  function startChampagneDust(){
    if(dustRunning) return;
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var count = (window.innerWidth || 390) < 640 ? 20 : 26;
    dust = [];
    for(var i = 0; i < count; i++) dust.push(makeMote(true));
    dustRunning = true;
    requestAnimationFrame(animateDust);
  }
  document.addEventListener('visibilitychange', function(){
    if(!dust.length || document.documentElement.classList.contains('story-mode')) return;
    if(document.hidden){ dustRunning = false; }
    else if(!dustRunning){ dustRunning = true; requestAnimationFrame(animateDust); }
  });

  /* =====================================================================
     NEW LAYER: SCRATCH-OFF WEDDING DATE CARD
     Appears only after the M A R R I E D typewriter line finishes (wired
     in near the bottom of startTypography()). Everything above this is
     untouched. The canvas coating is scratched away with real pointer
     input (mouse/touch/pen via Pointer Events); once ~62% of it has been
     cleared the remaining coating fades on its own and the date reveals.
  ===================================================================== */
  function setupScratchCard(){
    var wrap = document.getElementById('scratch-card-wrap');
    var revealEl = document.getElementById('scratch-reveal');
    var invitedEl = document.getElementById('invited-text');
    var canvas = document.getElementById('scratch-canvas');
    var ctx = canvas.getContext('2d');

    // Fixed internal supersample factor for crisp strokes. Independent of
    // devicePixelRatio: the canvas already scales visually together with
    // #stage via its CSS transform, and clientWidth/clientHeight (used
    // below) reflect pre-transform layout size, so this only needs to
    // run once — no resize listener required, and scratch progress is
    // never lost to a re-paint.
    var SS = 2;
    var cssW = 0, cssH = 0;
    var revealed = false;

    function paintCoating(){
      cssW = canvas.clientWidth;
      cssH = canvas.clientHeight;
      if(!cssW || !cssH) return;
      canvas.width = Math.round(cssW * SS);
      canvas.height = Math.round(cssH * SS);
      ctx.setTransform(SS, 0, 0, SS, 0, 0);

      // v67 — the coating IS the stationery: warm ivory paper (matching
      // the card beneath) with a hand-painted champagne watercolour
      // stroke across the middle, where the date waits underneath.
      var paper = ctx.createLinearGradient(0, 0, 0, cssH);
      paper.addColorStop(0, '#F8F3E9');
      paper.addColorStop(0.55, '#F6F0E4');
      paper.addColorStop(1, '#F2EBDD');
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.globalAlpha = 0.035;
      for(var i = 0; i < 700; i++){
        ctx.fillStyle = (i % 3 === 0) ? '#ffffff' : '#8a7148';
        ctx.fillRect(Math.random() * cssW, Math.random() * cssH, 0.8, 0.8);
      }
      ctx.globalAlpha = 1;

      var x0 = cssW * 0.13, x1 = cssW * 0.87;
      var yc = cssH * 0.535, hh = cssH * 0.235;
      var champ = ['#D8C39A', '#CDB27E', '#E4D2A9', '#C9AC75'];
      // soft underwash — an irregular, feathered pool of colour
      ctx.save();
      try{ ctx.filter = 'blur(2.2px)'; }catch(e){}
      ctx.fillStyle = 'rgba(214,190,140,0.55)';
      // v68 — a brush-stroke silhouette: tapered, slightly uneven tips
      // at each end and a softly wandering edge, so it reads as a
      // hand-laid wash of champagne paint rather than a rectangle.
      ctx.beginPath();
      var steps = 34, k, t, px, py, taper;
      var ph1 = Math.random() * 6, ph2 = Math.random() * 6;
      ctx.moveTo(x0 - 9, yc + (Math.random() - 0.3) * hh * 0.5);          // left tip
      for(k = 0; k <= steps; k++){
        t = k / steps;
        taper = Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.92)), 0.45);
        px = x0 + (x1 - x0) * t;
        py = yc - hh * taper * (0.8 + 0.12 * Math.sin(t * 8.3 + ph1) + 0.06 * Math.sin(t * 21 + ph2)) + (Math.random() - 0.5) * 2.2;
        ctx.lineTo(px, py);
      }
      ctx.lineTo(x1 + 11, yc + (Math.random() - 0.6) * hh * 0.5);        // right tip, a longer lift-off
      for(k = steps; k >= 0; k--){
        t = k / steps;
        taper = Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + t * 0.9)), 0.5);
        px = x0 + (x1 - x0) * t;
        py = yc + hh * taper * (0.82 + 0.1 * Math.cos(t * 6.7 + ph2) + 0.06 * Math.sin(t * 17 + ph1)) + (Math.random() - 0.5) * 2.2;
        ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      // two faint pools where pigment gathered as the brush slowed
      ctx.fillStyle = 'rgba(201,172,117,0.18)';
      ctx.beginPath(); ctx.ellipse(x0 + (x1 - x0) * 0.22, yc + hh * 0.35, cssW * 0.09, hh * 0.45, -0.08, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x0 + (x1 - x0) * 0.78, yc - hh * 0.3, cssW * 0.08, hh * 0.4, 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // bristle strokes — the hand-painted texture
      ctx.lineCap = 'round';
      for(k = 0; k < 54; k++){
        t = k / 53;
        var body = Math.sin(Math.PI * (0.06 + 0.88 * t));        // fuller in the middle
        var y = yc - hh + t * 2 * hh + (Math.random() - 0.5) * 2.4;
        var sx = x0 + (1 - body) * cssW * 0.05 + (Math.random() - 0.3) * cssW * 0.035;
        var ex = x1 - (1 - body) * cssW * 0.04 - (Math.random() - 0.3) * cssW * 0.04;
        ctx.globalAlpha = 0.18 + 0.4 * body * (0.55 + Math.random() * 0.45);
        ctx.strokeStyle = champ[k % champ.length];
        ctx.lineWidth = 1.6 + Math.random() * 3.6;
        ctx.beginPath();
        ctx.moveTo(sx, y);
        ctx.bezierCurveTo(sx + (ex - sx) * 0.33, y + (Math.random() - 0.5) * 3,
                          sx + (ex - sx) * 0.66, y + (Math.random() - 0.5) * 3,
                          ex, y + (Math.random() - 0.5) * 2);
        ctx.stroke();
      }
      // dry-brush flicks where the brush lifts off at each end
      for(k = 0; k < 16; k++){
        var left = k % 2 === 0;
        var fy = yc + (Math.random() - 0.5) * hh * 1.7;
        var fx = left ? x0 - Math.random() * 10 : x1 + Math.random() * 8;
        ctx.globalAlpha = 0.14 + Math.random() * 0.22;
        ctx.strokeStyle = champ[k % champ.length];
        ctx.lineWidth = 0.7 + Math.random() * 1.2;
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx + (left ? 1 : -1) * (14 + Math.random() * 22), fy + (Math.random() - 0.5) * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // a whisper of satin light across the paint only
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      var sh = ctx.createLinearGradient(x0, yc + hh, x1, yc - hh);
      sh.addColorStop(0, 'rgba(255,250,238,0)');
      sh.addColorStop(0.45, 'rgba(255,250,238,0.22)');
      sh.addColorStop(0.6, 'rgba(255,250,238,0.22)');
      sh.addColorStop(1, 'rgba(255,250,238,0)');
      ctx.fillStyle = sh;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.restore();

      // the invitation to scratch, hand-lettered on the paint
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#6F5128';
      ctx.font = "35px 'Great Vibes', cursive";
      ctx.fillText('Scratch to reveal', cssW / 2, yc - 7);
      // …and a quiet printed line beneath it
      function spacedText(txt, cx, cy, spacing){
        var widths = [], total = 0;
        for(var q = 0; q < txt.length; q++){ var w = ctx.measureText(txt[q]).width; widths.push(w); total += w; }
        total += spacing * (txt.length - 1);
        var x = cx - total / 2;
        ctx.textAlign = 'left';
        for(var r = 0; r < txt.length; r++){ ctx.fillText(txt[r], x, cy); x += widths[r] + spacing; }
        ctx.textAlign = 'center';
      }
      ctx.fillStyle = '#7A5C32';
      ctx.font = "500 12.5px 'Cormorant Garamond', serif";
      spacedText('OUR WEDDING DATE', cssW / 2, yc + 21, 3.4);

      // tiny divider:  ──  ♥  ──
      var dy = cssH * 0.885;
      ctx.strokeStyle = 'rgba(176,138,74,0.75)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(cssW / 2 - 34, dy); ctx.lineTo(cssW / 2 - 9, dy);
      ctx.moveTo(cssW / 2 + 9, dy); ctx.lineTo(cssW / 2 + 34, dy);
      ctx.stroke();
      ctx.fillStyle = '#B08A4A';
      ctx.beginPath();
      ctx.moveTo(cssW / 2, dy + 2.8);
      ctx.bezierCurveTo(cssW / 2 - 4.6, dy - 0.4, cssW / 2 - 3.4, dy - 4.2, cssW / 2, dy - 2);
      ctx.bezierCurveTo(cssW / 2 + 3.4, dy - 4.2, cssW / 2 + 4.6, dy - 0.4, cssW / 2, dy + 2.8);
      ctx.fill();

      // subsequent drawing erases the coating instead of adding to it
      ctx.globalCompositeOperation = 'destination-out';
    }

    function localPoint(clientX, clientY){
      var rect = canvas.getBoundingClientRect();
      var sx = (cssW || canvas.clientWidth) / rect.width;
      var sy = (cssH || canvas.clientHeight) / rect.height;
      return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
    }

    function scratchDot(x, y){
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fill();
    }

    function scratchLine(a, b){
      var dist = Math.hypot(b.x - a.x, b.y - a.y);
      var steps = Math.max(1, Math.floor(dist / 4));
      for(var i = 0; i <= steps; i++){
        var t = i / steps;
        scratchDot(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      }
    }

    var checkQueued = false;
    function queueProgressCheck(){
      if(checkQueued) return;
      checkQueued = true;
      requestAnimationFrame(checkProgress);
    }

    function checkProgress(){
      checkQueued = false;
      if(revealed) return;
      var w = canvas.width, h = canvas.height;
      if(!w || !h) return;
      var step = 6;
      var data;
      try{
        data = ctx.getImageData(0, 0, w, h).data;
      } catch(e){
        return;
      }
      // v67: only the painted band where the date is printed counts, so
      // scratching the paint is what reveals it (the plain paper margins
      // and printed ornaments don't need scratching).
      var total = 0, cleared = 0;
      var yA = Math.floor(h * 0.32), yB = Math.floor(h * 0.84);
      var xA = Math.floor(w * 0.14), xB = Math.floor(w * 0.86);
      for(var y = yA; y < yB; y += step){
        for(var x = xA; x < xB; x += step){
          total++;
          if(data[(y * w + x) * 4 + 3] < 60) cleared++;
        }
      }
      if(total > 0 && (cleared / total) >= 0.62){
        completeReveal();
      }
    }

    function completeReveal(){
      if(revealed) return;
      revealed = true;
      canvas.classList.add('cleared');
      // Stop the scratch texture at once (~30ms) and lock it so it can
      // never restart; the 180ms pause below guarantees it is fully
      // silent before the reveal pop plays.
      stopScratchSound(true);
      // The date becomes visible and the confetti pops in the SAME
      // callback, as in v67 — one continuous celebratory event.
      // v69: "You're Invited" then follows as the closing title once the
      // confetti is in the air — with the scroll cue (v76: together).
      setTimeout(function(){
        revealEl.classList.add('shown');
        // Champagne-celebration sound and confetti fire together as
        // one event — see the WEDDING AUDIO block. Plays once; fails
        // silently if audio is unavailable.
        musicRevealMoment();
        playRevealChime();
        triggerConfetti();
        // v76: "You're Invited" and the SCROLL TO / Begin Our Story cue
        // are one final beat — revealed together, from the same callback.
        setTimeout(function(){
          invitedEl.classList.add('shown');
          if(window.__showBeginJourney){ window.__showBeginJourney(); }
        }, 1100);
      }, 180);
    }

    /* Sparse, slow-drifting warm dust over the Mayon scene — see the
       .mayon-particles CSS block for the full rationale. Local
       prefers-reduced-motion check (rather than the shared variable
       declared later in the second <script> block) because this
       function runs from within the first, self-contained IIFE.

       ROOT CAUSE of the "particles exist but aren't visible" bug:
       .mayon-particles lives inside #stage, and #stage carries its own
       transform:scale(...) — the mechanism that fits the fixed
       1086x1448 design canvas to the real viewport (see the @supports
       rule near the top of this stylesheet). On a typical portrait
       phone that scale is roughly 0.55-0.65; on some it's lower still.
       A span authored as 1-3px is therefore rendered on screen at a
       sub-pixel size (well under 1px in many cases) — technically
       present, opacity animating, z-index correct, but genuinely too
       small to see. This is invisible in the CSS/JS source and only
       shows up by actually measuring rendered size, which is why it
       survived earlier passes. The fix: read #stage's live scale
       factor and size (and drift) each span in inline styles divided
       by it, so every particle's ON-SCREEN size and motion match the
       authored 1-3px / drift values regardless of device. */
    function getStageScale(){
      var stageEl = document.getElementById('stage');
      if(!stageEl) return 1;
      var tr = window.getComputedStyle(stageEl).transform;
      if(!tr || tr === 'none') return 1;
      var m = tr.match(/matrix\(\s*([-\d.eE]+)\s*,/);
      var a = m ? parseFloat(m[1]) : NaN;
      return (isFinite(a) && a > 0) ? a : 1;
    }
    /* v70 — MAYON-ONLY GOLD DUST. Comes alive at the guest's first
       scroll gesture and floats over the Mayon scene only: the layer
       is NOT moved out of #stage and is NOT a fixed overlay, so it
       scrolls away with Mayon and is clipped at the stage's edge — it
       can never appear over the floral transition, Our Story, the
       biographies or any later section. Each mote drifts continuously
       (slowly up and sideways, varied timing, size and opacity) via the
       existing mayonDust keyframes. Sizes and drift are authored in
       SCREEN px and divided by #stage's live scale (see
       getStageScale() above) so they look the same on every device.
       Visibility is driven by setupMayonParticleFade(). */
    var mayonDustSpawned = false;
    function spawnMayonDust(){
      if(mayonDustSpawned) return;
      mayonDustSpawned = true;
      var wrap = document.getElementById('mayon-particles');
      var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if(!wrap || reduceMotion) return;
      var k = 1 / getStageScale();           // screen px -> stage px
      var vw = window.innerWidth || 390;
      var count = vw < 640 ? 30 : (vw < 1024 ? 34 : 38);
      wrap.style.opacity = '0';
      var frag = document.createDocumentFragment();
      for(var i = 0; i < count; i++){
        var s = document.createElement('span');
        var r = Math.random();
        s.className = r < 0.62 ? 'md-champagne' : (r < 0.88 ? 'md-champagne-lt' : 'md-ivory');
        var kind = Math.random();
        var w, h;
        if(kind < 0.6){             // tiny points
          w = h = 2.2 + Math.random() * 1.2;
        } else if(kind < 0.88){     // soft specks
          w = h = 3.2 + Math.random() * 1.6;
          s.className += ' md-soft';
        } else {                    // a few softly glowing motes
          w = h = 4.2 + Math.random() * 1.6;
          s.className += ' md-glow';
        }
        s.style.width = (w * k).toFixed(2) + 'px';
        s.style.height = (h * k).toFixed(2) + 'px';
        s.style.left = (Math.random() * 100).toFixed(2) + '%';
        s.style.top = (4 + Math.random() * 88).toFixed(2) + '%';
        s.style.setProperty('--md-op', (0.55 + Math.random() * 0.35).toFixed(2));
        s.style.setProperty('--md-x', Math.round((Math.random() * 36 - 18) * k) + 'px');
        s.style.setProperty('--md-y', Math.round((-26 - Math.random() * 40) * k) + 'px');
        var duration = 7 + Math.random() * 7;
        s.style.animationDuration = duration.toFixed(2) + 's';
        // negative delay: every mote is already mid-drift when it appears
        s.style.animationDelay = '-' + (Math.random() * duration).toFixed(2) + 's';
        frag.appendChild(s);
      }
      wrap.appendChild(frag);
      wrap.style.transition = 'opacity 1.4s ease-out';
      requestAnimationFrame(function(){
        wrap.style.opacity = '1';
        // after the gentle fade-in, scroll-driven updates stay responsive
        setTimeout(function(){ wrap.style.transition = 'opacity 0.35s linear'; }, 1500);
      });
      if(window.__updateMayonDust) window.__updateMayonDust();
    }
    window.__spawnMayonDust = spawnMayonDust;

    var scratching = false;
    var lastPt = null;
    var lastMoveTime = 0;
    var lastClientX = 0, lastClientY = 0;

    // Extra safety net beyond touch-action:none + setPointerCapture: some
    // mobile browsers still need an explicit non-passive preventDefault to
    // fully suppress scroll/bounce/drag while a touch is actively scratching.
    function blockTouchWhileScratching(e){
      if(scratching) e.preventDefault();
    }
    document.addEventListener('touchmove', blockTouchWhileScratching, { passive:false });
    document.addEventListener('touchstart', blockTouchWhileScratching, { passive:false });

    function onDown(e){
      if(revealed) return;
      scratching = true;
      if(canvas.setPointerCapture){
        try{ canvas.setPointerCapture(e.pointerId); } catch(err){}
      }
      lastPt = localPoint(e.clientX, e.clientY);
      lastClientX = e.clientX; lastClientY = e.clientY;
      lastMoveTime = performance.now();
      // This pointerdown is a genuine user gesture, so it's the correct
      // (and only) place to lazily create/resume the AudioContext and
      // begin the soft scratch texture — see the WEDDING AUDIO block
      // near the top of this file.
      startScratchSound();
      scratchDot(lastPt.x, lastPt.y);
      queueProgressCheck();
      e.preventDefault();
    }
    function onMove(e){
      if(!scratching || revealed) return;
      var pt = localPoint(e.clientX, e.clientY);
      var now = performance.now();
      var dt = Math.max(1, now - lastMoveTime);
      // Sound follows real on-screen finger travel (screen px), so it
      // behaves the same on every device regardless of stage scale.
      var screenDist = Math.hypot(e.clientX - lastClientX, e.clientY - lastClientY);
      lastClientX = e.clientX; lastClientY = e.clientY;
      updateScratchSound(screenDist, dt);
      lastMoveTime = now;
      scratchLine(lastPt, pt);
      lastPt = pt;
      queueProgressCheck();
      e.preventDefault();
    }
    function onUp(){
      scratching = false;
      lastPt = null;
      stopScratchSound();
    }

    canvas.addEventListener('pointerdown', onDown);
    // Extra genuine-gesture unlock points for iOS/iPadOS: if the first
    // pointerdown could not start the audio context, the next touch will.
    canvas.addEventListener('touchstart', function(){ if(!revealed) unlockAudio(); }, { passive:true });
    canvas.addEventListener('touchend', function(){ if(!revealed) unlockAudio(); }, { passive:true });
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onUp);

    // Exposed trigger, called once from startTypography() after the
    // M A R R I E D line has fully finished typing.
    window.__revealScratchCard = function(){
      if(wrap.classList.contains('visible')) return;
      paintCoating();
      wrap.classList.add('visible');
      if(window.__music) window.__music.setKey('scratch', 2.5);
    };
  }
  setupScratchCard();

  /* ---------- Confetti (dusty-blue wedding palette) ----------
     Triggered ONLY on scratch-off completion — a large, abundant burst
     that explodes rapidly out of Mayon's crater like a celebratory
     wedding-confetti eruption, then expands outward and falls naturally,
     distinct from the door-opening fireworks (#fireworks /
     runFireworksSequence, both left completely untouched). Fires once
     per page load. */
  function triggerConfetti(){
    var canvas = document.getElementById('confetti-canvas');
    var ctx = canvas.getContext('2d');
    canvas.width = STAGE_W;
    canvas.height = STAGE_H;

    // Dusty blue dominant, with soft supporting wedding tones.
    var palette = [
      '#7f9cba', '#8fa8c2', '#a3b9d1', '#b7c9dc', // dusty / powder blue (weighted heavier below)
      '#c9d3dd', // soft blue-gray
      '#eef1e9', // light gray
      '#f0e6cf', // warm ivory
      '#e9ddc9', // champagne
      '#f0dbe0'  // subtle blush
    ];
    var blueWeighted = ['#7f9cba', '#8fa8c2', '#a3b9d1', '#b7c9dc', '#8fa8c2', '#a3b9d1'];

    function pickColor(){
      // ~60% chance of a dusty-blue shade, else a supporting tone.
      return (Math.random() < 0.6)
        ? blueWeighted[Math.floor(Math.random() * blueWeighted.length)]
        : palette[Math.floor(Math.random() * palette.length)];
    }

    function drawHeart(size, color){
      var s = size * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.6);
      ctx.bezierCurveTo(-s, -s * 0.4, -s * 0.4, -s * 1.1, 0, -s * 0.3);
      ctx.bezierCurveTo(s * 0.4, -s * 1.1, s, -s * 0.4, 0, s * 0.6);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // A rapid, concentrated EXPLOSION out of Mayon's crater — not a gentle
    // plume. A tiny "core" of particles fires from almost the exact
    // crater point with minimal jitter (so the very first visible pieces
    // clearly touch the crater), then the bulk of the burst fires at
    // strong, varied velocity across a wide upward cone that rapidly
    // expands outward before gravity takes hold. Distinct from the
    // door-opening fireworks: no radial star bursts, no glow — physical
    // paper pieces. Origin: the crater/opening at the summit of Mayon,
    // X 543, Y 603 in master 1086×1448 stage coordinates — the single
    // visual source of the explosion (not the sky above the peak, not
    // the scratch card, not the top of the screen).
    var ORIGIN_X = 543;
    var ORIGIN_Y = 603;
    var CORE_COUNT = 26; // fires almost exactly at the crater point, near-zero jitter

    var pieces = [];
    var count = 420;
    for(var i = 0; i < count; i++){
      var t = Math.random();
      var shape = t < 0.40 ? 'rect'
                : t < 0.58 ? 'streamer'
                : t < 0.80 ? 'circle'
                : t < 0.93 ? 'square'
                : 'heart';
      var isCore = i < CORE_COUNT;
      // Core pieces spawn almost exactly at the crater so the explosion
      // reads as coming from one physical point; the rest get a small
      // jitter so the burst still looks anchored to the crater opening
      // rather than a single pinpoint.
      var originX = ORIGIN_X + (Math.random() - 0.5) * (isCore ? 3 : 16);
      var originY = ORIGIN_Y + (Math.random() - 0.5) * (isCore ? 2 : 10);
      // Wide angular distribution, biased upward: ~55% fire within a
      // broad upper cone (including some near-sideways outliers for a
      // real "explosion" feel rather than a straight fountain), ~22.5%
      // kick sharply upper-left, ~22.5% kick sharply upper-right —
      // asymmetric and randomized so it reads as organic, not radial.
      var dirRoll = Math.random();
      var theta; // angle offset from straight-up, in radians
      if(dirRoll < 0.55){
        theta = (Math.random() - 0.5) * (100 * Math.PI / 180);      // ±50° of vertical
      } else if(dirRoll < 0.775){
        theta = -(50 + Math.random() * 40) * Math.PI / 180;          // -50° to -90° (upper-left to sideways-left)
      } else {
        theta = (50 + Math.random() * 40) * Math.PI / 180;           // 50° to 90° (upper-right to sideways-right)
      }
      var speed = 7 + Math.random() * 8;                             // strong 7-15 px/frame launch
      var vx = speed * Math.sin(theta);
      var vy = -speed * Math.cos(theta);
      pieces.push({
        x: originX,
        y: originY,
        vx: vx,
        vy: vy,                                    // fast outward launch straight from the crater
        gravity: 0.08 + Math.random() * 0.05,      // brings the explosion back down naturally
        drift: (Math.random() - 0.5) * 1.1,        // sideways sway amplitude
        driftFreq: 0.015 + Math.random() * 0.02,
        phase: Math.random() * Math.PI * 2,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * (shape === 'streamer' ? 0.32 : 0.2), // streamers tumble more visibly
        size: shape === 'streamer' ? (13 + Math.random() * 15) : (5 + Math.random() * 6),
        shape: shape,
        color: pickColor(),
        maxAlpha: 0.6 + Math.random() * 0.35,      // kept translucent so Mayon stays visible
        life: 1,
        fadeDelay: 0.6 + Math.random() * 0.3,      // fraction of life before fade begins
        decay: 0.0032 + Math.random() * 0.0032
      });
    }

    var start = null;
    var DURATION = 5000; // brief pop, then ~3-5s of natural falling and fading
    function frame(now){
      if(start === null) start = now;
      var elapsed = now - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var alive = false;
      for(var i = 0; i < pieces.length; i++){
        var p = pieces[i];
        if(p.life <= 0) continue;

        p.vy += p.gravity;
        p.x += p.vx + Math.sin(p.phase + now * p.driftFreq) * p.drift;
        p.y += p.vy;
        p.vx *= 0.985;
        p.rot += p.vr;

        if(p.life > (1 - p.fadeDelay)){
          // still fully in view — no fade yet
        } else {
          p.life -= p.decay;
        }

        if(p.y > STAGE_H + 40){ p.life = 0; continue; }
        if(p.life <= 0) continue;
        alive = true;

        var alpha = Math.max(Math.min(p.life, 1), 0) * p.maxAlpha;
        ctx.globalAlpha = alpha;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if(p.shape === 'rect'){
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size * 0.35, p.size, p.size * 0.7);
        } else if(p.shape === 'streamer'){
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -1.1, p.size, 2.2);
        } else if(p.shape === 'square'){
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size * 0.32, -p.size * 0.32, p.size * 0.64, p.size * 0.64);
        } else if(p.shape === 'circle'){
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.38, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
        } else {
          drawHeart(p.size * 1.05, p.color);
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      if(alive && elapsed < DURATION){
        requestAnimationFrame(frame);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    requestAnimationFrame(frame);
  }

  /* ---------- Main sequence ---------- */
  var medallionWrap = document.getElementById('medallion-wrap');
  var medallionHit = document.getElementById('medallion-hit');
  var doors = document.getElementById('doors');
  var revealGlow = document.getElementById('reveal-glow');

  /* Make sure the exact master webfonts are loaded before the typewriter
     animation starts, so mobile never briefly (or permanently) renders
     "Marlyn & Tihomir" in a fallback cursive font. Falls back gracefully
     (and never blocks forever) if the Font Loading API is unavailable
     or a font fails to load. */
  var fontsReadyPromise = (function(){
    if(!window.document.fonts || !document.fonts.load){
      return Promise.resolve();
    }
    return Promise.all([
      document.fonts.load("68.6px 'Great Vibes'"),
      document.fonts.load("500 35.6px 'Cormorant Garamond'"),
      document.fonts.load("700 54.6px 'Libre Baskerville'"),
      document.fonts.load("22.6px 'Tenor Sans'"),
      document.fonts.load("35.6px 'Beau Rivage'")
    ]).catch(function(){}).then(function(){
      return document.fonts.ready;
    }).catch(function(){});
  })();

  function startTypography(){
    typeLine(lineNames, 70, function(){
      setTimeout(function(){
        typeLine(lineGetting, 50, function(){
          setTimeout(function(){
            typeLine(lineMarried, 110, function(){
              // An unhurried pause, then the scratch card quietly fades in.
              setTimeout(function(){
                if(window.__revealScratchCard){ window.__revealScratchCard(); }
              }, 1100);
            });
          }, 500);
        });
      }, 700);
    });
  }

  /* Single-trigger guard: one tap produces exactly one opening sequence,
     no matter how many pointer/click/touch events fire for it. */
  var experienceStarted = false;

  function beginExperience(){
    if(experienceStarted) return;
    experienceStarted = true;

    // "Turning Page" begins from 0:00 with this tap, as the doors part.
    if(window.__music) window.__music.start();

    medallionWrap.classList.add('tapped');
    setTimeout(function(){
      medallionWrap.classList.add('hidden');
      medallionHit.classList.add('hidden');
    }, 820);

    // The medallion fades first, then the doors part.
    setTimeout(function(){ doors.classList.add('open'); }, 250);

    // Barely-there champagne dust drifts in as Mayon is revealed.
    setTimeout(startChampagneDust, 1400);

    // A soft warm bloom of evening light as the doors clear — slower
    // and gentler than before, never a flash.
    setTimeout(function(){
      revealGlow.style.transition = 'opacity 2.2s ease';
      revealGlow.style.opacity = '0.55';
      setTimeout(function(){ revealGlow.style.opacity = '0'; }, 2300);
    }, 1700);

    setTimeout(function(){
      var typographyStarted = false;
      function go(){
        if(typographyStarted) return;
        typographyStarted = true;
        startTypography();
      }
      // Wait for the master webfonts, but never hang the sequence —
      // a short safety cap guarantees typing still starts on time
      // even if font loading stalls.
      fontsReadyPromise.then(go).catch(go);
      setTimeout(go, 400);
    }, 3300);
  }

  /* Robust pointer handling: Pointer Events cover mouse, touch, and pen
     in one listener across iPhone, Android, iPad, and desktop. Older
     browsers without PointerEvent fall back to click/touchend. The
     experienceStarted guard above means neither path can double-fire. */
  function attachTapHandlers(el){
    if(window.PointerEvent){
      el.addEventListener('pointerup', function(e){
        if(e.pointerType === 'mouse' && e.button !== 0) return;
        beginExperience();
      });
    } else {
      el.addEventListener('click', beginExperience);
      el.addEventListener('touchend', function(e){
        e.preventDefault();
        beginExperience();
      }, {passive:false});
    }
  }

  attachTapHandlers(medallionWrap);
  attachTapHandlers(medallionHit);

  /* ---------- Reveal the subtle scroll cue (Part 2) ---------- */
  window.__showBeginJourney = function(){
    var cue = document.getElementById('opener-scroll-cue');
    if(cue) cue.classList.add('shown');
    if(window.__armStoryScroll) window.__armStoryScroll();
  };

})();
