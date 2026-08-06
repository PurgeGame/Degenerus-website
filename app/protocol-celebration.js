// Protocol-native win effects: expanding energy seals, light sweeps, and the
// Degenerus flame. Nothing falls across the screen, and every effect is scoped
// to the result that caused it.

const CELEBRATION_TONES = Object.freeze({
  win: Object.freeze({
    primary: '#f5a623', secondary: '#22c55e', glow: 'rgba(245, 166, 35, 0.3)',
    logo: '/whitepaper/flame-logo.svg', rings: 2, sigils: 3,
  }),
  jackpot: Object.freeze({
    primary: '#ffc04d', secondary: '#a78bfa', glow: 'rgba(255, 192, 77, 0.36)',
    logo: '/whitepaper/flame-logo.svg', rings: 3, sigils: 4,
  }),
  gold: Object.freeze({
    primary: '#fff4b0', secondary: '#d4af37', glow: 'rgba(255, 213, 111, 0.4)',
    logo: '/whitepaper/flame-center.svg', rings: 3, sigils: 4,
  }),
  coinflip: Object.freeze({
    primary: '#fde68a', secondary: '#22c55e', glow: 'rgba(34, 197, 94, 0.28)',
    logo: '/whitepaper/flame-logo-split.svg', rings: 2, sigils: 2,
  }),
});

export function protocolCelebrationSpec(tone = 'win', big = false) {
  const key = Object.prototype.hasOwnProperty.call(CELEBRATION_TONES, tone) ? tone : 'win';
  const base = CELEBRATION_TONES[key];
  return {
    ...base,
    tone: key,
    duration: big ? 1450 : 1050,
    size: big ? 330 : 220,
    rings: base.rings + (big ? 1 : 0),
  };
}

function reducedMotion() {
  try { return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches); }
  catch (_error) { return false; }
}

function setStyles(node, styles) {
  if (!node?.style) return;
  try { Object.assign(node.style, styles); } catch (_error) { /* decoration only */ }
}

function play(node, frames, options) {
  try { return node?.animate?.(frames, options) || null; }
  catch (_error) { return null; }
}

function viewportAnchor(target) {
  const view = globalThis.window || globalThis;
  const width = Number(view.innerWidth) || 1024;
  const height = Number(view.innerHeight) || 768;
  try {
    const rect = target?.getBoundingClientRect?.();
    if (rect && Number(rect.width) > 0 && Number(rect.height) > 0) {
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
  } catch (_error) { /* use viewport center */ }
  return { x: width / 2, y: height / 2 };
}

function addRing(root, spec, anchor, index) {
  const ring = document.createElement('span');
  const size = spec.size * (0.72 + index * 0.2);
  setStyles(ring, {
    position: 'absolute', left: `${anchor.x}px`, top: `${anchor.y}px`,
    width: `${size}px`, height: `${size}px`, border: `2px solid ${index % 2 ? spec.secondary : spec.primary}`,
    borderRadius: '50%', boxShadow: `0 0 22px ${spec.glow}, inset 0 0 18px ${spec.glow}`,
    opacity: '0', transform: 'translate(-50%, -50%) scale(.18)',
  });
  root.appendChild(ring);
  play(ring, [
    { opacity: 0, transform: 'translate(-50%, -50%) scale(.18)' },
    { opacity: 0.92, offset: 0.24 + index * 0.04 },
    { opacity: 0, transform: 'translate(-50%, -50%) scale(1.12)' },
  ], { duration: spec.duration, delay: index * 70, easing: 'cubic-bezier(.16,.72,.2,1)', fill: 'forwards' });
}

function addSeal(root, spec, anchor) {
  const seal = document.createElement('span');
  const size = spec.size * 0.84;
  setStyles(seal, {
    position: 'absolute', left: `${anchor.x}px`, top: `${anchor.y}px`, width: `${size}px`,
    height: `${size}px`, border: `1px solid ${spec.primary}`, borderRadius: '50%', opacity: '0',
    transform: 'translate(-50%, -50%) rotate(-22deg) scale(.48)',
    boxShadow: `inset 0 0 34px ${spec.glow}`,
  });
  root.appendChild(seal);
  const radius = size * 0.46;
  for (let index = 0; index < spec.sigils; index += 1) {
    const angle = ((Math.PI * 2) / spec.sigils) * index - Math.PI / 2;
    const mark = document.createElement('img');
    mark.src = spec.logo;
    mark.alt = '';
    setStyles(mark, {
      position: 'absolute', left: `${size / 2 + Math.cos(angle) * radius - 13}px`,
      top: `${size / 2 + Math.sin(angle) * radius - 13}px`, width: '26px', height: '26px',
      objectFit: 'contain', filter: `drop-shadow(0 0 8px ${spec.primary})`,
    });
    seal.appendChild(mark);
  }
  play(seal, [
    { opacity: 0, transform: 'translate(-50%, -50%) rotate(-22deg) scale(.48)' },
    { opacity: 0.9, offset: 0.28 },
    { opacity: 0.58, offset: 0.68 },
    { opacity: 0, transform: 'translate(-50%, -50%) rotate(26deg) scale(1.08)' },
  ], { duration: spec.duration, easing: 'cubic-bezier(.18,.72,.24,1)', fill: 'forwards' });
}

function addFlame(root, spec, anchor) {
  const flame = document.createElement('img');
  flame.src = spec.logo;
  flame.alt = '';
  const size = spec.tone === 'gold' ? 82 : 68;
  setStyles(flame, {
    position: 'absolute', left: `${anchor.x}px`, top: `${anchor.y}px`, width: `${size}px`,
    height: `${size}px`, objectFit: 'contain', opacity: '0',
    transform: 'translate(-50%, -50%) scale(.35)',
    filter: `drop-shadow(0 0 12px ${spec.primary}) drop-shadow(0 0 28px ${spec.secondary})`,
  });
  root.appendChild(flame);
  play(flame, [
    { opacity: 0, transform: 'translate(-50%, -50%) scale(.35)' },
    { opacity: 1, transform: 'translate(-50%, -50%) scale(1.16)', offset: 0.3 },
    { opacity: 0.86, transform: 'translate(-50%, -50%) scale(.94)', offset: 0.62 },
    { opacity: 0, transform: 'translate(-50%, -58%) scale(1.04)' },
  ], { duration: spec.duration, easing: 'cubic-bezier(.2,.78,.2,1)', fill: 'forwards' });
}

function addLightSweep(root, spec, anchor, vertical) {
  const beam = document.createElement('span');
  setStyles(beam, vertical ? {
    position: 'absolute', left: `${anchor.x - 1}px`, top: `${anchor.y - spec.size * 0.7}px`,
    width: '2px', height: `${spec.size * 1.4}px`,
    background: `linear-gradient(transparent, ${spec.secondary}, #fff, ${spec.primary}, transparent)`,
    boxShadow: `0 0 18px ${spec.glow}`, opacity: '0', transform: 'scaleY(.1)',
  } : {
    position: 'absolute', left: `${anchor.x - spec.size * 0.7}px`, top: `${anchor.y - 1}px`,
    width: `${spec.size * 1.4}px`, height: '2px',
    background: `linear-gradient(90deg, transparent, ${spec.primary}, #fff, ${spec.secondary}, transparent)`,
    boxShadow: `0 0 18px ${spec.glow}`, opacity: '0', transform: 'scaleX(.1)',
  });
  root.appendChild(beam);
  play(beam, [
    { opacity: 0, transform: vertical ? 'scaleY(.1)' : 'scaleX(.1)' },
    { opacity: 0.9, offset: 0.24 },
    { opacity: 0, transform: vertical ? 'scaleY(1)' : 'scaleX(1)' },
  ], { duration: Math.round(spec.duration * 0.72), easing: 'ease-out', fill: 'forwards' });
}

/**
 * Paint a short, pointer-transparent celebration centered on `target`.
 * Returns the temporary root, or null when motion is reduced/unavailable.
 */
export function celebrateProtocol({ target = null, tone = 'win', big = false } = {}) {
  if (reducedMotion() || typeof document === 'undefined') return null;
  const host = document.body || document.documentElement;
  if (!host?.appendChild || typeof document.createElement !== 'function') return null;
  const spec = protocolCelebrationSpec(tone, big);
  const anchor = viewportAnchor(target);
  const root = document.createElement('div');
  root.className = `protocol-celebration protocol-celebration--${spec.tone}`;
  root.setAttribute('data-protocol-celebration', spec.tone);
  root.setAttribute('aria-hidden', 'true');
  setStyles(root, {
    position: 'fixed', inset: '0', zIndex: '1400', overflow: 'hidden', pointerEvents: 'none',
    contain: 'strict', mixBlendMode: 'screen',
    background: `radial-gradient(circle ${Math.round(spec.size * 0.58)}px at ${anchor.x}px ${anchor.y}px, ${spec.glow}, transparent 72%)`,
  });
  host.appendChild(root);
  play(root, [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.72 }, { opacity: 0 }],
    { duration: spec.duration, easing: 'ease-out', fill: 'forwards' });
  for (let index = 0; index < spec.rings; index += 1) addRing(root, spec, anchor, index);
  addSeal(root, spec, anchor);
  addLightSweep(root, spec, anchor, false);
  if (big || spec.tone === 'gold') addLightSweep(root, spec, anchor, true);
  addFlame(root, spec, anchor);
  const timer = setTimeout(() => root.remove?.(), spec.duration + 180);
  timer?.unref?.();
  return root;
}
