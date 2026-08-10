// Player-facing UI preferences shared by the top-bar settings menu and the
// surfaces they control. Keep these separate from wallet/account state: the
// choices belong to this browser and should survive disconnects.

export const REVEAL_AUTO_OPEN_STORAGE_KEY = 'degenerus:reveal-tray:auto-open:v1';
export const ALL_IN_BUTTON_STORAGE_KEY = 'degenerus:all-in-button:v1';

const _listeners = new Set();

function _storage() {
  try { return globalThis.localStorage || null; }
  catch (_error) { return null; }
}

function _read(key) {
  try { return _storage()?.getItem(key) ?? null; }
  catch (_error) { return null; }
}

function _write(key, value) {
  try { _storage()?.setItem(key, value); }
  catch (_error) { /* private mode: keep the live in-memory choice */ }
}

function _emit(name, value) {
  const detail = Object.freeze({ name, value: Boolean(value) });
  for (const listener of _listeners) {
    try { listener(detail); } catch (_error) { /* one consumer cannot break another */ }
  }
}

export function readRevealAutoOpenPreference() {
  return _read(REVEAL_AUTO_OPEN_STORAGE_KEY) === '1';
}

export function writeRevealAutoOpenPreference(enabled) {
  const value = Boolean(enabled);
  _write(REVEAL_AUTO_OPEN_STORAGE_KEY, value ? '1' : '0');
  _emit('revealAutoOpen', value);
  return value;
}

// Preserve the historical ALL IN behavior unless the player explicitly hides
// it. Eligibility remains a separate live account check in the buy widget.
export function readAllInButtonPreference() {
  return _read(ALL_IN_BUTTON_STORAGE_KEY) !== '0';
}

export function writeAllInButtonPreference(enabled) {
  const value = Boolean(enabled);
  _write(ALL_IN_BUTTON_STORAGE_KEY, value ? '1' : '0');
  _emit('allInButton', value);
  return value;
}

export function subscribeUiPreferences(listener) {
  if (typeof listener !== 'function') return () => {};
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}
