// play/app/pack-animator.js -- GSAP timeline for pack-open reveal (D-07)
//
// Phase 1: shake (~80ms)
// Phase 2: flash (~50ms)
// Phase 3: snap-open + bounce (~120ms) on .pack-wrapper
// Phase 4: slide/scale traits in (~150ms staggered) on .pack-trait elements
// Total: ~400ms
//
// prefers-reduced-motion fallback: instant state swap (D-07 override).
// Sound plays even in reduced-motion mode (unless muted) per D-10 --
// the audio call is made by the caller (packs-panel.js), not here.
//
// Caller should store the returned timeline and call .kill() on
// disconnectedCallback to free GSAP's internal tween storage
// (Pitfall 3 memory-leak guard).
//
// GSAP is available via the play/index.html importmap entry.
// SHELL-01: imports only from 'gsap' (importmap-registered; no ethers).

import gsap from 'gsap';

export function animatePackOpen(packEl, onComplete) {
  const reducedMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reducedMotion) {
    // Instant state swap per D-07 fallback.
    packEl.classList.remove('pack-sealed');
    packEl.classList.add('pack-opened');
    if (typeof onComplete === 'function') onComplete();
    return null;
  }

  const traits = packEl.querySelectorAll('.pack-trait');
  const wrapper = packEl.querySelector('.pack-wrapper');

  const tl = gsap.timeline({
    onComplete: () => {
      packEl.classList.remove('pack-sealed');
      packEl.classList.add('pack-opened');
      if (typeof onComplete === 'function') onComplete();
    },
  });

  // Phase 1: shake ~80ms
  tl.to(packEl, { x: -2, duration: 0.020, yoyo: true, repeat: 3, ease: 'power1.inOut' });

  // Phase 2: flash ~50ms
  tl.to(packEl, { opacity: 0.6, duration: 0.025, yoyo: true, repeat: 1 }, '>');

  // Phase 3: snap-open + bounce ~120ms
  if (wrapper) {
    tl.to(wrapper, { scale: 1.05, opacity: 0, duration: 0.12, ease: 'back.in(1.5)' }, '>');
  }

  // Phase 4: slide/scale traits in ~150ms staggered
  if (traits && traits.length > 0) {
    tl.fromTo(
      traits,
      { scale: 0.3, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.15, stagger: 0.02, ease: 'back.out(1.3)' },
      '>'
    );
  }

  return tl;
}
