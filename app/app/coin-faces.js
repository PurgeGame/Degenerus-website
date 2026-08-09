// /app/app/coin-faces.js — reliable two-sided artwork for every flipping coin.
//
// Browser 3D back-face culling is not reliable enough for a protocol result:
// Chromium can occasionally expose the reverse of the front texture, which
// looks exactly like a second, upside-down WWXRP face.  Keep the familiar CSS
// toss on one physical surface and switch its already-loaded artwork whenever
// that surface crosses edge-on.  With only one visible plane, a duplicate face
// is impossible even if the browser's compositor has a bad frame.

const FRONT = 'red';
const BACK = 'eth';
const EDGE_EPSILON = 0.0001;

const _trackedRotors = new Set();
let _frameHandle = null;

function _frameApi() {
  const scope = typeof window !== 'undefined' ? window : globalThis;
  const request = scope?.requestAnimationFrame;
  const cancel = scope?.cancelAnimationFrame;
  return {
    request: typeof request === 'function' ? request.bind(scope) : null,
    cancel: typeof cancel === 'function' ? cancel.bind(scope) : null,
  };
}

/**
 * Return which side of a transformed plane faces the viewer.
 *
 * CSS usually serializes rotateX animations as matrix3d(). Some Chromium
 * compositor paths flatten an exact/intermediate pose to matrix(), though.
 * m33 in 3D, or the 2D determinant after flattening, retains the transformed
 * surface orientation; translation, rotateZ, and positive scale do not change
 * its sign. Holding the previous side at the exact edge prevents sub-pixel
 * sign noise from flashing either image.
 */
export function coinSideFromTransform(transform, previous = FRONT) {
  const prior = previous === BACK ? BACK : FRONT;
  const text = String(transform || '').trim();
  if (!text || text === 'none') return FRONT;

  const match = text.match(/^matrix3d\((.*)\)$/i);
  if (match) {
    const values = match[1].split(',').map((value) => Number(value.trim()));
    const normalZ = values.length === 16 ? values[10] : Number.NaN;
    if (Number.isFinite(normalZ)) {
      if (normalZ < -EDGE_EPSILON) return BACK;
      if (normalZ > EDGE_EPSILON) return FRONT;
      return prior;
    }
  }

  const flatMatch = text.match(/^matrix\((.*)\)$/i);
  if (flatMatch) {
    const values = flatMatch[1].split(',').map((value) => Number(value.trim()));
    if (values.length === 6 && values.every(Number.isFinite)) {
      // A rotateZ around the flattened rotateX can move sign between a/b/c/d;
      // the determinant preserves the front/back orientation of the plane.
      const orientation = values[0] * values[3] - values[1] * values[2];
      if (orientation < -EDGE_EPSILON) return BACK;
      if (orientation > EDGE_EPSILON) return FRONT;
      return prior;
    }
  }

  // Useful for lightweight DOM/test shims that return the authored transform
  // rather than a computed matrix.
  const rotate = text.match(/rotateX\(\s*(-?[\d.]+)deg\s*\)/i);
  if (rotate) {
    const degrees = Number(rotate[1]);
    if (Number.isFinite(degrees)) {
      const normalZ = Math.cos((degrees * Math.PI) / 180);
      if (normalZ < -EDGE_EPSILON) return BACK;
      if (normalZ > EDGE_EPSILON) return FRONT;
    }
  }
  return prior;
}

function _setVisibleSide(rotor, side) {
  if (!rotor) return FRONT;
  const visible = side === BACK ? BACK : FRONT;
  if (rotor.dataset?.visibleCoinFace === visible) return visible;
  const front = rotor.querySelector?.('[data-coin-face="red"]');
  const back = rotor.querySelector?.('[data-coin-face="eth"]');
  if (front) front.hidden = visible !== FRONT;
  if (back) back.hidden = visible !== BACK;
  if (rotor.dataset) rotor.dataset.visibleCoinFace = visible;
  return visible;
}

function _updateRotor(rotor) {
  if (!rotor) return;
  let transform = 'none';
  try {
    const readStyle = typeof getComputedStyle === 'function'
      ? getComputedStyle
      : (typeof window !== 'undefined' ? window.getComputedStyle : null);
    if (typeof readStyle === 'function') transform = readStyle(rotor).transform;
  } catch (_e) { /* retain the safe front face */ }
  const prior = rotor.dataset?.visibleCoinFace || FRONT;
  _setVisibleSide(rotor, coinSideFromTransform(transform, prior));
}

function _tick() {
  _frameHandle = null;
  for (const entry of [..._trackedRotors]) {
    const { rotor } = entry;
    if (!rotor) {
      _trackedRotors.delete(entry);
      continue;
    }
    if (rotor.isConnected === true) entry.wasConnected = true;
    if (rotor.isConnected === false && entry.wasConnected) {
      _trackedRotors.delete(entry);
      continue;
    }
    _updateRotor(rotor);
  }
  const { request } = _frameApi();
  if (_trackedRotors.size > 0 && request) _frameHandle = request(_tick);
}

function _trackRotor(rotor) {
  const { request } = _frameApi();
  if (!request || typeof getComputedStyle !== 'function') return;
  _trackedRotors.add({ rotor, wasConnected: rotor?.isConnected === true });
  if (_frameHandle == null) _frameHandle = request(_tick);
}

function _face(side, src, alt) {
  const face = document.createElement('span');
  face.className = `df-coin3d__face df-coin3d__face--${side}`;
  face.setAttribute('data-coin-face', side);
  face.setAttribute('aria-hidden', 'true');
  const image = document.createElement('img');
  image.src = src;
  image.alt = alt || '';
  image.decoding = 'async';
  face.appendChild(image);
  return { face, image };
}

/**
 * Populate a moving rotor with one flat surface and two preloaded artworks.
 * Exactly one face group is displayable at any moment.  The back artwork is
 * pre-inverted in CSS so the parent plane's reverse projection restores it to
 * an upright ETH face.
 */
export function appendCoinFaces(rotor, {
  frontSrc = '/shared/coinflip-face-red.svg',
  backSrc = '/shared/coinflip-face-eth.svg',
  frontAlt = '',
  backAlt = '',
  initialSide = FRONT,
} = {}) {
  if (!rotor || typeof document === 'undefined') return null;
  const surface = document.createElement('span');
  surface.className = 'df-coin3d__surface';
  const front = _face(FRONT, frontSrc, frontAlt);
  const back = _face(BACK, backSrc, backAlt);
  surface.appendChild(front.face);
  surface.appendChild(back.face);
  rotor.appendChild(surface);
  _setVisibleSide(rotor, initialSide);
  _trackRotor(rotor);
  return {
    surface,
    frontFace: front.face,
    backFace: back.face,
    frontImage: front.image,
    backImage: back.image,
  };
}

/** Stop the shared frame loop in tests or hot-reload teardown. */
export function __resetCoinFaceTrackingForTest() {
  _trackedRotors.clear();
  const { cancel } = _frameApi();
  if (_frameHandle != null && cancel) cancel(_frameHandle);
  _frameHandle = null;
}
