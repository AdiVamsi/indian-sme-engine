'use strict';

/* ══════════════════════════════════════════════════════════════════
   hero.js — Landing page interactions
   ─ Cursor-tracking spotlight
   ─ Subtle parallax on the floating card panel
   ─ Animated counter on the stat tile
   ─ Removes float animations from hero__right on touch devices
     (float looks wrong when the panel is a horizontal scroll strip)
══════════════════════════════════════════════════════════════════ */

(function () {
  /* ── 1. Cursor spotlight ───────────────────────────────────────────── */
  const spotlight = document.getElementById('js-spotlight');
  if (!spotlight) return;

  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight * 0.4; // default: upper-center
  let rafPending = false;

  function paintSpotlight() {
    spotlight.style.background =
      `radial-gradient(380px circle at ${mouseX}px ${mouseY}px, ` +
      `rgba(245,179,1,0.055) 0%, transparent 70%)`;
    rafPending = false;
  }

  /* Throttle to one paint per animation frame — smooth 60 fps */
  document.addEventListener('mousemove', function (e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(paintSpotlight);
    }
  }, { passive: true });

  /* Initial paint so the glow is visible before first mouse move */
  requestAnimationFrame(paintSpotlight);


  /* ── 2. Parallax on floating card panel ───────────────────────────── */
  /* Only on desktop (pointer: fine = mouse). On touch the panel is a
     horizontal scroll strip and shouldn't shift with cursor position. */
  const cardPanel = document.getElementById('js-hero-right');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isPointerFine = window.matchMedia('(pointer: fine)').matches;

  if (cardPanel && isPointerFine && !prefersReducedMotion) {
    const cx = window.innerWidth  / 2;
    const cy = window.innerHeight / 2;

    document.addEventListener('mousemove', function (e) {
      /* Normalise cursor to -1 … +1 relative to viewport center */
      const dx = (e.clientX - cx) / cx;
      const dy = (e.clientY - cy) / cy;

      /* Max shift: 7px horizontal, 5px vertical — subtle depth cue */
      cardPanel.style.transform =
        `translate(${(dx * 7).toFixed(2)}px, ${(dy * 5).toFixed(2)}px)`;
    }, { passive: true });
  }


  /* ── 3. Animated counter on the stat tile ─────────────────────────── */
  function animateCounter(el, target, duration) {
    /* Skip if reduced-motion is preferred */
    if (prefersReducedMotion) { el.textContent = target; return; }

    const startTime = performance.now();

    function tick(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      /* Ease-out cubic: fast start, gentle finish */
      const eased    = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(eased * target);
      if (progress < 1) requestAnimationFrame(tick);
    }

    el.textContent = '0';
    requestAnimationFrame(tick);
  }

  /* Wait until after the card's entrance animation (delay 0.85s + 0.7s) */
  const statEl = document.getElementById('js-lead-count');
  if (statEl) {
    const target = parseInt(statEl.textContent, 10) || 14;
    setTimeout(function () {
      animateCounter(statEl, target, 1100);
    }, 1800);
  }


  /* ── 4. Remove float keyframes on touch/tablet layout ─────────────── */
  /* When viewport ≤ 960px, the hero__right switches to a flex scroll
     strip (static layout). The CSS float animations are removed via
     media query on the fcard position, but we additionally clear the
     JS-set transform to avoid stale values on resize. */
  function onResize() {
    if (cardPanel && window.innerWidth <= 960) {
      cardPanel.style.transform = '';
    }
  }

  window.addEventListener('resize', onResize, { passive: true });

}());
