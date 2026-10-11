(function(){
  "use strict";

  /* ---------- Opener → Act II transition ---------- */
  var transitionEl = document.getElementById('act-transition');
  var piano = document.getElementById('bg-piano');
  var storyStarted = false;
  var canBeginStory = false;

  function spawnWashParticles(){
    for(var i = 0; i < 26; i++){
      var p = document.createElement('div');
      p.className = 'wash-particle';
      p.style.left = (Math.random() * 100) + '%';
      p.style.top = (60 + Math.random() * 30) + '%';
      p.style.animationDelay = (Math.random() * 1.2) + 's';
      transitionEl.appendChild(p);
    }
  }

  function beginStoryTransition(){
    if(storyStarted) return;
    storyStarted = true;

    /* From here on the browser owns scrolling — these listeners never
       called preventDefault and already no-op once storyStarted is
       true, but removing them outright leaves nothing that could ever
       compete with native document scroll. */
    window.removeEventListener('wheel', onOpenerWheel);
    window.removeEventListener('touchstart', onOpenerTouchStart);
    window.removeEventListener('touchmove', onOpenerTouchMove);
    window.removeEventListener('keydown', onOpenerKeydown);

    var scrollCueEl = document.getElementById('opener-scroll-cue');
    if(scrollCueEl) scrollCueEl.classList.remove('shown');

    // Gold particle bridge begins with the guest's own scroll.
    if(window.__spawnMayonDust) window.__spawnMayonDust();

    spawnWashParticles();
    transitionEl.classList.add('on');

    // The song is already playing (it began with the doors) — it simply
    // continues; from here its level follows the section on screen.
    if(window.__music){
      window.__music.heal();
      window.__music.enterStory();
    }

    setTimeout(function(){
      document.documentElement.classList.add('story-mode');
      window.scrollTo(0, 0);
      initContinuation();
    }, 900);

    setTimeout(function(){
      transitionEl.classList.remove('on');
    }, 2000);
  }

  /* ---------- Scroll-triggered continuation (replaces the old
     "Begin Our Journey" tap). The completed opener — Mayon scene,
     names, wedding date, "You're Invited" — stays fully visible
     and untouched until the guest's own scroll/wheel/swipe gesture
     initiates the transition; nothing here auto-advances on a
     timer. Armed only once the reveal sequence finishes (matching
     when the scroll cue itself fades in), so an impatient scroll
     during the confetti/typewriter sequence does nothing. These
     listeners are passive and never call preventDefault: the
     opener's overflow:hidden already means nothing would scroll
     anyway, so there is nothing to suppress. */
  window.__armStoryScroll = function(){
    canBeginStory = true;
  };

  function onOpenerWheel(e){
    if(!canBeginStory || storyStarted) return;
    if(e.deltaY > 3) beginStoryTransition();
  }
  var touchStartY = null;
  function onOpenerTouchStart(e){
    if(!canBeginStory || storyStarted) return;
    touchStartY = e.touches && e.touches.length ? e.touches[0].clientY : null;
  }
  function onOpenerTouchMove(e){
    if(!canBeginStory || storyStarted || touchStartY === null) return;
    var y = e.touches && e.touches.length ? e.touches[0].clientY : null;
    if(y === null) return;
    if(touchStartY - y > 14) beginStoryTransition();
  }
  function onOpenerKeydown(e){
    if(!canBeginStory || storyStarted) return;
    if(e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' '){
      beginStoryTransition();
    }
  }
  window.addEventListener('wheel', onOpenerWheel, {passive:true});
  window.addEventListener('touchstart', onOpenerTouchStart, {passive:true});
  window.addEventListener('touchmove', onOpenerTouchMove, {passive:true});
  window.addEventListener('keydown', onOpenerKeydown);

  /* ---------- Everything below only runs once Act II opens ---------- */
  var continuationInited = false;

  function initContinuation(){
    if(continuationInited) return;
    continuationInited = true;

    // setupMayonParticleFade() runs first and on its own, deliberately
    // decoupled from the setup calls below: it only touches #viewport
    // and #mayon-particles (already present at page load, independent
    // of Acts II-VI markup), so it has nothing to gain by waiting its
    // turn — and everything to lose, since if any later setup* call
    // threw, the dust would silently never receive its scroll-fade
    // wiring at all. Calling it first guarantees the ambient particles
    // keep working even if something else in this list breaks.
    setupMayonParticleFade();
    setupRevealAnimations();
    setupOneLineVow();
    setupMomentsAlbum();
    setupMomentsRail();
    setupVenueZoom();
    setupFaqAccordion();
    setupGiftToggle();
    setupCountdown();
    setupCountdownParticles();
    setupFarewellParticles();
    setupRsvpFlow();
    setupFarewellReveal();
    setupReturnToStory();
  }

  /* ============================================================
     Request 1 — keep the Mayon ambient dust visible for as long as
     the Mayon scene actually fills the screen, instead of cutting it
     to opacity:0 the instant story-mode begins. #viewport (the fixed-
     ratio Mayon stage) is now a normal in-flow first section once
     story-mode is active, so a plain IntersectionObserver on it
     reports exactly how much of Mayon the guest can still see as they
     scroll — intersectionRatio 1 while Mayon fills the screen, easing
     down toward 0 as the floral transition and Our Story scroll into
     view. Many thresholds (not just one) keep that mapping smooth
     rather than a single on/off jump. This never spawns anything new
     — it only ever adjusts the opacity of particles spawnMayonDust()
     already created (or does nothing, harmlessly, if reduced-motion
     meant none were spawned). */
  function setupMayonParticleFade(){
    var stageWrap = document.getElementById('viewport');
    var particles = document.getElementById('mayon-particles');
    if(!stageWrap || !particles) return;
    // v70 — tied to how much of the Mayon scene is actually on screen:
    //   Mayon filling the screen        → fully visible, floating
    //   Mayon partially leaving         → fading gently
    //   less than ~30% of Mayon visible → completely hidden
    // The layer lives inside the Mayon stage (never fixed), so it also
    // scrolls away with Mayon and is clipped at its edge: nothing can
    // float over the floral transition, Our Story or any later section.
    var ticking = false;
    function update(){
      ticking = false;
      var vh = window.innerHeight || 1;
      var rect = stageWrap.getBoundingClientRect();
      var visible = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
      var ratio = visible / vh;                          // 1 = Mayon fills the screen
      var op = Math.max(0, Math.min(1, (ratio - 0.3) / 0.55));
      particles.style.opacity = op.toFixed(3);
      if(op <= 0.001) particles.classList.add('md-off');
      else particles.classList.remove('md-off');
    }
    function onScroll(){
      if(!ticking){ ticking = true; requestAnimationFrame(update); }
    }
    window.__updateMayonDust = onScroll;
    window.addEventListener('scroll', onScroll, {passive:true});
    window.addEventListener('resize', onScroll);
    update();
  }

  /* ============================================================
     Calm, restrained reveal-on-scroll. One shared IntersectionObserver
     drives every ".reveal" / ".reveal-scale" element; each animates
     once, on entering the viewport, never in a large simultaneous
     batch (Part 35).
     ============================================================ */
  function setupRevealAnimations(){
    var targets = document.querySelectorAll('#continuation .reveal, #continuation .reveal-scale');
    if(!targets.length) return;
    if(!('IntersectionObserver' in window)){
      targets.forEach(function(t){ t.classList.add('in'); });
      return;
    }
    var observer = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){
          entry.target.classList.add('in');
          observer.unobserve(entry.target);
        }
      });
    }, {threshold:0.16, rootMargin:'0px 0px -6% 0px'});
    targets.forEach(function(t){ observer.observe(t); });
  }

  /* ============================================================
     Part 13 — "Different Maps. Different Cultures. One Family." must
     always read as one unbroken handwritten line. Great Vibes is a
     wide script face whose metrics vary by platform, so rather than
     trust a vw-based guess, measure the text's true rendered width
     against an off-screen ruler and scale to fit exactly.
     ============================================================ */
  function setupOneLineVow(){
    var el = document.querySelector('#continuation .one-line-vow');
    if(!el) return;
    var MAX = 25, MIN = 8;

    var ruler = document.createElement('span');
    ruler.setAttribute('aria-hidden', 'true');
    ruler.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;top:0;letter-spacing:0;';
    ruler.textContent = el.textContent;

    function fit(){
      var parent = el.parentElement;
      if(!parent) return;
      var cs = getComputedStyle(parent);
      var avail = parent.clientWidth
        - parseFloat(cs.paddingLeft || 0)
        - parseFloat(cs.paddingRight || 0)
        - 8;
      if(avail <= 0) return;

      var elStyle = getComputedStyle(el);
      ruler.style.fontFamily = elStyle.fontFamily;
      ruler.style.fontWeight = elStyle.fontWeight;
      ruler.style.fontStyle = elStyle.fontStyle;
      if(!ruler.parentNode) document.body.appendChild(ruler);

      var REF = 100;
      ruler.style.fontSize = REF + 'px';
      var refWidth = ruler.getBoundingClientRect().width;
      if(!refWidth) return;

      var ideal = (avail / refWidth) * REF;
      var size = Math.max(MIN, Math.min(MAX, Math.floor(ideal * 10) / 10));
      el.style.fontSize = size + 'px';
    }

    fit();
    if(document.fonts && document.fonts.ready && document.fonts.ready.then){
      document.fonts.ready.then(fit).catch(function(){});
    }
    var t = null;
    window.addEventListener('resize', function(){
      clearTimeout(t);
      t = setTimeout(fit, 120);
    }, {passive:true});
  }

  /* ============================================================
     Parts 10-12 — The Moments Between as a luxury photo album.
     Two independent levels of native horizontal scroll-snap:
       - the outer rail moves between the three moments
       - an inner rail inside each moment moves one photo at a time
     touch-action:pan-x on both lets the browser decide natively
     whether a drag is horizontal (moves a rail) or vertical (falls
     through to page scroll) — no JS gesture arbitration. Running
     past the last inner photo naturally chains into the outer rail's
     next moment, which is the "turning pages" feel the brief wants.
     ============================================================ */
  /* ============================================================
     v63 — The Moments Between album viewer: ONE photograph at a time.
     Eight pages, eight dots, one previous and one next button. The
     current photograph is derived from the viewer's actual scroll
     position, so dots and caption follow swipes, trackpad gestures
     and drags as well as clicks. Mouse users can drag; releasing a
     drag always settles on exactly one photograph.
     ============================================================ */
  function setupMomentsRail(){
    var viewer = document.getElementById('moments-viewer');
    if(!viewer) return;
    var pages = Array.prototype.slice.call(viewer.querySelectorAll('.moments-photo-page'));
    var dots = Array.prototype.slice.call(document.querySelectorAll('#moments-dots button'));
    var prev = document.getElementById('moments-prev');
    var next = document.getElementById('moments-next');
    var caption = document.getElementById('moments-caption');
    var count = pages.length, current = 0, captionTimer = null;

    function pageW(){ return viewer.clientWidth || 1; }
    function goTo(i, instant){
      i = Math.max(0, Math.min(count - 1, i));
      var left = i * pageW();
      if(instant){ viewer.style.scrollBehavior = 'auto'; viewer.scrollLeft = left; viewer.style.scrollBehavior = ''; }
      else { try{ viewer.scrollTo({ left: left, behavior: 'smooth' }); }catch(e){ viewer.scrollLeft = left; } }
      setCurrent(i);
    }
    function setCurrent(i){
      if(i === current && dots[i] && dots[i].classList.contains('active')) return;
      current = i;
      dots.forEach(function(d, k){
        var on = k === i;
        d.classList.toggle('active', on);
        if(on) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current');
      });
      if(prev) prev.disabled = i <= 0;
      if(next) next.disabled = i >= count - 1;
      var text = pages[i] ? pages[i].getAttribute('data-caption') : '';
      if(caption && caption.textContent !== text){
        caption.classList.add('fading');
        if(captionTimer) clearTimeout(captionTimer);
        captionTimer = setTimeout(function(){ caption.textContent = text; caption.classList.remove('fading'); }, 260);
      }
    }
    var ticking = false;
    viewer.addEventListener('scroll', function(){
      if(ticking) return;
      ticking = true;
      requestAnimationFrame(function(){
        ticking = false;
        if(!dragging) setCurrent(Math.round(viewer.scrollLeft / pageW()));
      });
    }, {passive:true});
    window.addEventListener('resize', function(){ goTo(current, true); });

    if(prev) prev.addEventListener('click', function(){ goTo(current - 1); });
    if(next) next.addEventListener('click', function(){ goTo(current + 1); });
    dots.forEach(function(d, k){ d.addEventListener('click', function(){ goTo(k); }); });
    viewer.addEventListener('keydown', function(e){
      if(e.key === 'ArrowRight'){ e.preventDefault(); goTo(current + 1); }
      else if(e.key === 'ArrowLeft'){ e.preventDefault(); goTo(current - 1); }
    });

    // Trackpad sideways swipes and horizontal mouse wheels turn exactly
    // one photograph per gesture. Vertical wheel movement is left
    // untouched, so the invitation keeps scrolling normally.
    var wheelAcc = 0, wheelLock = 0, wheelReset = null;
    viewer.addEventListener('wheel', function(e){
      var dx = e.deltaX, dy = e.deltaY;
      if(e.shiftKey && !dx){ dx = dy; dy = 0; }
      if(Math.abs(dx) <= Math.abs(dy)) return;
      e.preventDefault();
      var now = Date.now();
      if(wheelReset) clearTimeout(wheelReset);
      wheelReset = setTimeout(function(){ wheelAcc = 0; }, 220);
      if(now < wheelLock) return;
      wheelAcc += dx;
      if(Math.abs(wheelAcc) >= 30){
        goTo(current + (wheelAcc > 0 ? 1 : -1));
        wheelAcc = 0;
        wheelLock = now + 650;
      }
    }, {passive:false});

    // Desktop mouse drag — releases onto exactly one photograph.
    var down = false, dragging = false, startX = 0, startLeft = 0, startIdx = 0, pid = null;
    viewer.addEventListener('pointerdown', function(e){
      if(e.pointerType !== 'mouse' || e.button !== 0) return;
      down = true; dragging = false; startX = e.clientX; startLeft = viewer.scrollLeft; startIdx = current; pid = e.pointerId;
    });
    viewer.addEventListener('pointermove', function(e){
      if(!down || e.pointerId !== pid) return;
      var dx = e.clientX - startX;
      if(!dragging && Math.abs(dx) > 4){
        dragging = true;
        viewer.classList.add('dragging');
        try{ viewer.setPointerCapture(pid); }catch(err){}
      }
      if(dragging){ viewer.scrollLeft = startLeft - dx; e.preventDefault(); }
    });
    function endDrag(e){
      if(!down) return;
      down = false;
      if(!dragging) return;
      dragging = false;
      viewer.classList.remove('dragging');
      try{ viewer.releasePointerCapture(pid); }catch(err){}
      var dx = (e && typeof e.clientX === 'number') ? e.clientX - startX : 0;
      var threshold = Math.min(90, pageW() * 0.12);
      var target = startIdx;
      if(dx <= -threshold) target = startIdx + 1;
      else if(dx >= threshold) target = startIdx - 1;
      goTo(target);
    }
    viewer.addEventListener('pointerup', endDrag);
    viewer.addEventListener('pointercancel', endDrag);
    viewer.addEventListener('lostpointercapture', endDrag);

    setCurrent(0);
    if(prev) prev.disabled = true;
  }

  function setupMomentsAlbum(){
    var outerRail = document.getElementById('chapters-rail');
    var outerDotsWrap = document.getElementById('chapter-dots');
    var prevBtn = document.getElementById('chapter-prev');
    var nextBtn = document.getElementById('chapter-next');
    if(!outerRail || !outerDotsWrap) return;
    var chapters = outerRail.querySelectorAll('.chapter');

    /* ------------------------------------------------------------
       Part 6 — desktop mouse click-and-drag for both rail levels.
       Touch and trackpad already scroll these natively via
       overflow-x + touch-action:pan-x, so this is gated to
       pointerType === 'mouse' only — it never touches touch/pen
       behaviour, and never intercepts vertical page scroll.

       IMPORTANT — the release/snap step deliberately does NOT set
       rail.scrollLeft (or call rail.scrollTo) directly. In testing,
       Chromium was found to silently reset scrollLeft back to 0
       immediately after a pointer-captured mouse drag ends on this
       element, no matter how that write was made (immediately,
       delayed via setTimeout at any duration, via
       requestIdleCallback, with or without pointer capture, with or
       without scroll-snap) — the write is only ever reliable once
       it's no longer associated with the drag's own event-handling
       chain at all. Synthesizing a .click() on the corresponding
       dot delegates the actual scrollTo to that dot's own,
       independent click handler — a completely fresh event dispatch
       unconnected to the drag — which was confirmed reliable. The
       dot navigation UI functionally doubles as this rail's only
       trustworthy "commit" mechanism.
       ------------------------------------------------------------ */
    function makeMouseDraggable(rail, itemCount, getDotsWrap){
      var dragging = false, startX = 0, startScroll = 0, moved = false;

      rail.addEventListener('pointerdown', function(e){
        if(e.pointerType !== 'mouse' || e.button !== 0) return;
        dragging = true; moved = false;
        startX = e.clientX;
        startScroll = rail.scrollLeft;
        rail.classList.add('dragging');
        rail.setPointerCapture && rail.setPointerCapture(e.pointerId);
        e.preventDefault(); // stop native image/text drag ghosting
        // Critical: the inner photo-rail sits INSIDE the outer
        // chapters-rail, so this event would otherwise bubble up and
        // also fire the outer rail's own pointerdown handler for the
        // same physical click — both would then race for pointer
        // capture, and the outer rail (handling the event last, since
        // bubbling goes inner-to-outer) would win, silently hijacking
        // every inner-rail drag. Stopping propagation here means only
        // the rail actually under the pointer ever starts a drag.
        e.stopPropagation();
      });
      rail.addEventListener('pointermove', function(e){
        if(!dragging) return;
        var delta = e.clientX - startX;
        if(Math.abs(delta) > 3) moved = true;
        rail.scrollLeft = startScroll - delta;
        e.stopPropagation();
      });
      function endDrag(e){
        if(!dragging) return;
        dragging = false;
        rail.classList.remove('dragging');
        var itemWidth = rail.clientWidth;
        var nearest = Math.max(0, Math.min(itemCount() - 1, Math.round(rail.scrollLeft / itemWidth)));
        var dotsWrap = getDotsWrap ? getDotsWrap() : null;
        if(dotsWrap && dotsWrap.children[nearest]){
          dotsWrap.children[nearest].click();
        }
        if(e && e.stopPropagation) e.stopPropagation();
      }
      rail.addEventListener('pointerup', endDrag);
      rail.addEventListener('pointercancel', endDrag);
      rail.addEventListener('pointerleave', function(e){ if(dragging) endDrag(e); });
      // A drag that actually moved shouldn't also fire a click on
      // whatever's underneath (e.g. a dot); a plain click still will.
      rail.addEventListener('click', function(e){
        if(moved){ e.preventDefault(); e.stopPropagation(); moved = false; }
      }, true);
    }

    // Outer dots (between the three moments)
    chapters.forEach(function(_, i){
      var dot = document.createElement('span');
      if(i === 0) dot.className = 'active';
      dot.addEventListener('click', function(){
        outerRail.scrollTo({left: i * outerRail.clientWidth, behavior:'smooth'});
      });
      outerDotsWrap.appendChild(dot);
    });
    var outerDots = outerDotsWrap.querySelectorAll('span');

    function outerIndex(){ return Math.round(outerRail.scrollLeft / outerRail.clientWidth); }
    function outerGoTo(i){
      i = Math.max(0, Math.min(chapters.length - 1, i));
      outerRail.scrollTo({left: i * outerRail.clientWidth, behavior:'smooth'});
    }
    if(prevBtn) prevBtn.addEventListener('click', function(){ outerGoTo(outerIndex() - 1); });
    if(nextBtn) nextBtn.addEventListener('click', function(){ outerGoTo(outerIndex() + 1); });

    var outerTicking = false;
    outerRail.addEventListener('scroll', function(){
      if(outerTicking) return;
      outerTicking = true;
      requestAnimationFrame(function(){
        var idx = outerIndex();
        outerDots.forEach(function(d, i){ d.classList.toggle('active', i === idx); });
        outerTicking = false;
      });
    }, {passive:true});

    makeMouseDraggable(outerRail, function(){ return chapters.length; }, function(){ return outerDotsWrap; });

    // Inner dots — one photo at a time, per moment
    var innerRails = document.querySelectorAll('.photo-rail');
    innerRails.forEach(function(rail){
      var dotsWrap = document.querySelector('[data-photo-dots="' + rail.getAttribute('data-photo-rail') + '"]');
      var pages = rail.querySelectorAll('.photo-page');

      makeMouseDraggable(rail, function(){ return pages.length; }, function(){ return dotsWrap; });

      if(!dotsWrap || pages.length < 2) return; // no dots needed for a single photo
      pages.forEach(function(_, i){
        var dot = document.createElement('span');
        if(i === 0) dot.className = 'active';
        dot.addEventListener('click', function(){
          rail.scrollTo({left: i * rail.clientWidth, behavior:'smooth'});
        });
        dotsWrap.appendChild(dot);
      });
      var dots = dotsWrap.querySelectorAll('span');
      var ticking = false;
      rail.addEventListener('scroll', function(){
        if(ticking) return;
        ticking = true;
        requestAnimationFrame(function(){
          var idx = Math.round(rail.scrollLeft / rail.clientWidth);
          dots.forEach(function(d, i){ d.classList.toggle('active', i === idx); });
          ticking = false;
        });
      }, {passive:true});
    });
  }

  /* ---------- Subtle zoom on church / reception photographs ---------- */
  function setupVenueZoom(){
    var frames = document.querySelectorAll('#continuation .cinematic-frame');
    if(!frames.length || !('IntersectionObserver' in window)) return;
    var observer = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        entry.target.classList.toggle('in-view', entry.isIntersecting);
      });
    }, {threshold:0.3});
    frames.forEach(function(f){ observer.observe(f); });
  }

  /* ---------- FAQ accordion (one open at a time) ---------- */
  function setupFaqAccordion(){
    var items = document.querySelectorAll('#faq-list .faq-item');
    items.forEach(function(item){
      var q = item.querySelector('.faq-q');
      q.addEventListener('click', function(){
        var isOpen = item.classList.contains('open');
        items.forEach(function(i){ i.classList.remove('open'); });
        if(!isOpen) item.classList.add('open');
      });
    });
  }

  /* ---------- Part 20 — collapsible gift details, actual QR image ---------- */
  function setupGiftToggle(){
    var toggle = document.getElementById('gift-toggle');
    var details = document.getElementById('gift-details');
    if(!toggle || !details) return;
    toggle.addEventListener('click', function(){
      var open = details.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? 'Hide Gift Details' : 'View Gift Details';
    });

    var qrToggle = document.getElementById('qr-toggle');
    var qrBox = document.getElementById('qr-box');
    if(qrToggle && qrBox){
      qrToggle.addEventListener('click', function(){
        var shown = qrBox.classList.toggle('shown');
        qrToggle.textContent = shown ? 'Hide QR Code' : 'Show QR Code';
      });
    }
  }

  /* ---------- Live countdown to Jan 27 2027, 3:00 PM (Asia/Manila, UTC+8) ---------- */
  function setupCountdown(){
    var target = new Date('2027-01-27T15:00:00+08:00').getTime();
    var elDays = document.getElementById('cd-days');
    var elHours = document.getElementById('cd-hours');
    var elMins = document.getElementById('cd-mins');
    var elSecs = document.getElementById('cd-secs');
    if(!elDays) return;

    function pad(n){ return (n < 10 ? '0' : '') + n; }
    function tick(){
      var now = Date.now();
      var diff = Math.max(0, target - now);
      elDays.textContent = Math.floor(diff / 86400000);
      elHours.textContent = pad(Math.floor((diff % 86400000) / 3600000));
      elMins.textContent = pad(Math.floor((diff % 3600000) / 60000));
      elSecs.textContent = pad(Math.floor((diff % 60000) / 1000));
    }
    tick();
    setInterval(tick, 1000);
  }

  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Change 3 (v40) — back up to a fuller but still restrained ~24
     particles now that they're confined to the card itself, each
     varied in size, colour (from the invitation's own gold palette),
     peak opacity, drift, and timing so they read as floating dust
     rather than a repeating pattern. A handful get a soft glow. */
  function setupCountdownParticles(){
    var wrap = document.getElementById('countdown-particles');
    if(!wrap || prefersReducedMotion) return;
    var palette = ['#D9C28F', '#E8D5A8', '#F6E8C8'];
    var count = 28;
    for(var i = 0; i < count; i++){
      var s = document.createElement('span');
      var size = 2 + Math.random() * 3;
      s.style.left = (Math.random() * 100) + '%';
      s.style.bottom = (Math.random() * 55) + '%';
      s.style.width = size + 'px';
      s.style.height = size + 'px';
      s.style.background = palette[Math.floor(Math.random() * palette.length)];
      s.style.setProperty('--peak', (0.35 + Math.random() * 0.35).toFixed(2));
      s.style.setProperty('--drift', (Math.round((Math.random() - 0.5) * 24)) + 'px');
      s.style.animationDelay = (Math.random() * 8) + 's';
      s.style.animationDuration = (6 + Math.random() * 6) + 's';
      if(Math.random() < 0.3){
        s.style.boxShadow = '0 0 ' + (3 + Math.random() * 3).toFixed(1) + 'px rgba(217,194,143,0.6)';
      }
      wrap.appendChild(s);
    }
  }

  /* Item 8 — a sparse, slow drift of champagne-gold motes across the
     farewell scene: fewer and slower than the countdown's particles
     so it reads as soft floating dust rather than an effect, and it
     never competes with the monogram or text sitting above it
     (z-index keeps it behind .farewell-content). Disabled entirely
     under prefers-reduced-motion, and capped low on narrow/mobile
     viewports to stay cheap. */
  function setupFarewellParticles(){
    var wrap = document.getElementById('farewell-particles');
    if(!wrap || prefersReducedMotion) return;
    var count = window.innerWidth < 640 ? 22 : 32;
    for(var i = 0; i < count; i++){
      var s = document.createElement('span');
      var roll = Math.random();
      // Mostly small/medium motes, with an occasional glowing one for
      // a touch of "celestial dust" sparkle rather than uniform dots.
      var sizeClass = roll < 0.5 ? 'p-sm' : (roll < 0.85 ? 'p-md' : (roll < 0.95 ? 'p-lg' : 'p-glow'));
      s.className = sizeClass;
      s.style.left = (Math.random() * 100) + '%';
      s.style.bottom = (Math.random() * 90) + '%';
      s.style.setProperty('--drift-x', (Math.random() * 40 - 20) + 'px');
      s.style.setProperty('--drift-y', (-90 - Math.random() * 90) + 'px');
      s.style.animationDelay = (Math.random() * 11) + 's';
      s.style.animationDuration = (8 + Math.random() * 8) + 's';
      wrap.appendChild(s);
    }
  }

  /* ============================================================
     ACT V — RSVP (Parts 23-30). Normal vertical document flow.
     There is no panel-swapping stage and no Continue buttons —
     Scenes 1 and 2 are just content the guest scrolls past. The
     confirmation genuinely can't exist before the form is submitted
     (it depends on the attendance answer), so it's the one thing
     revealed dynamically — a plain show/hide, not a state machine.
     ============================================================ */
  function setupRsvpFlow(){
    var confirmation = document.getElementById('rsvp-confirmation');
    var formSection = document.getElementById('rsvp-form-section');
    if(!confirmation || !formSection) return;

    var nameField = document.getElementById('rsvp-name');
    var nameFieldWrap = document.getElementById('rsvp-name-field');
    var attendFieldWrap = document.getElementById('rsvp-attend-field');

    /* ---- The ONE real drag-to-confirm slider in the whole RSVP
       flow. Tracks actual pointer displacement, follows the finger
       1:1, only fires onComplete past ~90% travel, and springs back
       if released early. A bare tap does nothing on its own. ---- */
    function makeSwipeTrack(trackId, thumbId, fillId, onComplete){
      var track = document.getElementById(trackId);
      var thumb = document.getElementById(thumbId);
      var fill = fillId ? document.getElementById(fillId) : null;
      if(!track || !thumb) return;

      var maxX = 0, originX = 3, dragging = false;
      var pointerStartClientX = 0, thumbStartLeft = originX, completed = false;

      function bounds(){ maxX = Math.max(0, track.clientWidth - thumb.offsetWidth - 6); }
      bounds();
      window.addEventListener('resize', bounds);

      function paint(x){
        thumb.style.left = (originX + x) + 'px';
        if(fill) fill.style.width = (originX + x + thumb.offsetWidth / 2) + 'px';
      }

      function releaseTextFocus(){
        var ae = document.activeElement;
        if(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && typeof ae.blur === 'function') ae.blur();
      }
      function onPointerDown(e){
        if(completed) return;
        // Close the keyboard as the guest starts the swipe, so the
        // page is back at its normal state before the send ceremony.
        releaseTextFocus();
        bounds(); // re-measure fresh at drag start — the track may
                  // have been laid out differently when the page
                  // first initialised.
        dragging = true;
        pointerStartClientX = e.clientX;
        thumbStartLeft = (parseFloat(thumb.style.left) || originX) - originX;
        thumb.setPointerCapture && thumb.setPointerCapture(e.pointerId);
        thumb.style.transition = 'none';
      }
      function onPointerMove(e){
        if(!dragging) return;
        var delta = e.clientX - pointerStartClientX;
        var x = Math.max(0, Math.min(maxX, thumbStartLeft + delta));
        paint(x);
      }
      function onPointerUp(){
        if(!dragging) return;
        dragging = false;
        thumb.style.transition = 'left 0.3s cubic-bezier(.2,.8,.2,1)';
        if(fill) fill.style.transition = 'width 0.3s cubic-bezier(.2,.8,.2,1)';
        var currentX = (parseFloat(thumb.style.left) || originX) - originX;
        if(maxX > 0 && currentX >= maxX * 0.9){
          completed = true;
          paint(maxX);
          track.classList.add('done');
          setTimeout(function(){ onComplete(); }, 200);
        } else {
          paint(0);
        }
      }

      thumb.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      thumb.addEventListener('pointercancel', onPointerUp);

      thumb.setAttribute('tabindex', '0');
      thumb.addEventListener('keydown', function(e){
        if(completed) return;
        if(e.key === 'Enter' || e.key === ' '){
          e.preventDefault();
          completed = true;
          bounds();
          paint(maxX);
          track.classList.add('done');
          setTimeout(function(){ onComplete(); }, 200);
        }
      });

      return {
        reset: function(){
          completed = false;
          track.classList.remove('done');
          bounds();
          thumb.style.transition = 'none';
          paint(0);
        }
      };
    }

    var statusEl = document.getElementById('rsvp-submit-status');
    var submitting = false;
    function setStatus(text){ if(statusEl) statusEl.textContent = text || ''; }

    var sendSlider = makeSwipeTrack('rsvp-send-track', 'rsvp-send-thumb', 'rsvp-send-fill', function(){
      if(submitting) return;                      // a request is already pending
      var attending = document.querySelector('input[name="rsvp-attend"]:checked');
      var nameOk = nameField && nameField.value.trim();
      var attendOk = !!attending;

      nameFieldWrap.classList.toggle('field-error', !nameOk);
      attendFieldWrap.classList.toggle('field-error', !attendOk);

      if(!nameOk || !attendOk){
        if(sendSlider) sendSlider.reset();
        if(!nameOk){ nameField.focus(); }
        return;
      }
      // Never enter the send ceremony with a text field still focused.
      if(document.activeElement && typeof document.activeElement.blur === 'function'){
        document.activeElement.blur();
      }
      submitting = true;
      setStatus('');
      var msgField = document.getElementById('rsvp-message');
      var hpField = document.getElementById('rsvp-website');
      var request = window.WeddingRsvp ? window.WeddingRsvp.submit({
        fullName: nameField.value,
        attending: attending.value === 'yes' ? 'YES' : 'NO',
        message: msgField ? msgField.value : '',
        website: hpField ? hpField.value : ''
      }) : Promise.resolve({ state: 'error', reason: 'not-configured' });
      playSendCeremony(request);
    });

    /* ---- Shown only when a send was not confirmed. The guest's
       answers stay in the form; swiping again retries safely. ---- */
    function showSendProblem(result){
      var text;
      if(result.state === 'invalid'){
        if(result.field === 'fullName'){ nameFieldWrap.classList.add('field-error'); text = 'Please check your name and try again.'; }
        else if(result.field === 'attending'){ attendFieldWrap.classList.add('field-error'); text = 'Please let us know if you’ll be joining us.'; }
        else if(result.field === 'message'){ text = 'Your message is a little too long — please shorten it to 1,000 characters.'; }
        else { text = 'Something went wrong sending your RSVP. Please try again.'; }
      } else if(result.state === 'retry'){
        text = result.reason === 'rate_limited' || result.reason === 'busy' ?
          'Many RSVPs are arriving right now — please wait a moment and swipe again.' :
          'We couldn’t confirm your RSVP was received. Your answers are still here — please check your connection and swipe again.';
      } else {
        text = 'We’re sorry — your RSVP couldn’t be sent. Please try again later or message us directly.';
      }
      setStatus(text);
      if(sendSlider) sendSlider.reset();
    }

    if(nameField){
      nameField.addEventListener('input', function(){
        if(nameField.value.trim()) nameFieldWrap.classList.remove('field-error');
      });
    }
    document.querySelectorAll('input[name="rsvp-attend"]').forEach(function(r){
      r.addEventListener('change', function(){ attendFieldWrap.classList.remove('field-error'); });
    });

    /* ---- Ceremonial send: heart flies, envelope seals, brief
       pause, then the confirmation is revealed in place. ---- */
    function playSendCeremony(request){
      var overlay = document.getElementById('send-ceremony');
      // The ceremony plays while the request is in flight. The
      // confirmation is revealed only once the server has confirmed
      // the row was stored; until then the sealed envelope and
      // "Sending your RSVP…" caption simply stay on screen.
      var minShow = new Promise(function(r){ setTimeout(r, 2650); });
      var settle = Promise.all([request, minShow]).then(function(v){ return v[0]; },
                                                       function(){ return { state: 'retry', reason: 'network' }; });
      if(overlay){
        overlay.classList.add('on');
        requestAnimationFrame(function(){ overlay.classList.add('fly'); });
        setTimeout(function(){ overlay.classList.add('envelope-in'); }, 900);
        setTimeout(function(){ overlay.classList.add('envelope-sealed'); }, 1500);
      }
      settle.then(function(result){
        if(overlay) overlay.classList.remove('on', 'fly', 'envelope-in', 'envelope-sealed');
        submitting = false;
        if(result && result.state === 'saved') finishRsvp();
        else showSendProblem(result || { state: 'retry', reason: 'network' });
      });
    }

    function finishRsvp(){
      var attending = document.querySelector('input[name="rsvp-attend"]:checked');
      var attendingYes = !attending || attending.value === 'yes';
      var msg = document.getElementById('rsvp-confirm-message');
      if(msg){
        msg.textContent = attendingYes ?
          'Thank you for saying \u201cyes\u201d to celebrating with us. We can\u2019t wait to welcome you on Wednesday, January 27, 2027, at 3:00 PM, as we begin this new chapter surrounded by the people we love most.' :
          'Although we\u2019ll miss celebrating with you in person, we\u2019re deeply grateful for your love, support, and warm wishes as we begin this new chapter together.';
      }
      if(document.activeElement && typeof document.activeElement.blur === 'function'){
        document.activeElement.blur();
      }
      confirmation.classList.add('shown');
      if(formSection) formSection.classList.add('submitted');
      // Viewport-safe positioning: wait for the new layout (two frames),
      // then scroll the page to the confirmation's own document position.
      // No scrollIntoView, so no browser focus/zoom heuristics are involved.
      requestAnimationFrame(function(){
        requestAnimationFrame(function(){
          var top = confirmation.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop || 0);
          try{ window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); }
          catch(e){ window.scrollTo(0, Math.max(0, top)); }
        });
      });
      spawnRsvpConfetti();
      /* Change 5 — the confirmation no longer carries a background to
         fade away (no Mayon, no gradient behind it), so this reveals
         cleanly right after the sending ceremony with nothing further
         to trigger. */
    }

    function spawnRsvpConfetti(){
      var wrap = document.getElementById('rsvp-confetti');
      if(!wrap) return;
      wrap.innerHTML = '';
      var colors = ['#8FA9B8', '#D9C28F', '#F5F0E6', '#B8ADA0'];
      for(var i = 0; i < 46; i++){
        var c = document.createElement('span');
        c.style.position = 'absolute';
        c.style.top = '-5%';
        c.style.left = (Math.random() * 100) + '%';
        c.style.width = (4 + Math.random() * 4) + 'px';
        c.style.height = (4 + Math.random() * 4) + 'px';
        c.style.background = colors[i % colors.length];
        c.style.opacity = '0.85';
        c.style.borderRadius = (Math.random() > 0.5 ? '50%' : '1px');
        var dur = (2.6 + Math.random() * 2.4) + 's';
        var delay = (Math.random() * 1.1) + 's';
        c.style.animation = 'goldFloat ' + dur + ' linear ' + delay + ' 1 forwards';
        c.style.animationDirection = 'reverse';
        wrap.appendChild(c);
      }
    }
  }

  /* ---------- Act VI farewell: monogram fades in as the scene
     enters view. No whiteout, no scroll lock — normal scrolling
     continues to work in both directions afterward (Part 34). ---------- */
  function setupFarewellReveal(){
    var targets = document.querySelectorAll('.countdown-act, .farewell-act');
    if(!targets.length || !('IntersectionObserver' in window)) return;
    var observer = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        entry.target.classList.toggle('in-view', entry.isIntersecting);
      });
    }, {threshold:0.35});
    targets.forEach(function(t){ observer.observe(t); });
  }

  /* ---------- "Return to Our Story": smooth-scrolls back to the
     beginning of Act II, never reloads the page, never touches
     Act I. ---------- */
  function setupReturnToStory(){
    var btn = document.getElementById('return-to-story');
    if(!btn) return;
    btn.addEventListener('click', function(){
      var target = document.getElementById('act-ii');
      if(target) target.scrollIntoView({behavior:'smooth', block:'start'});
    });
  }

})();
