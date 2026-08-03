// /app/app/degenerette-preferences.js — browser-local Degenerette settings.
//
// These are presentation/form preferences, never protocol state. One compact
// versioned record is intentionally shared across wallets in this browser:
// animation speed plus an independent last-used bet size for ETH, FLIP, and
// WWXRP. Pending bets remain wallet/chain scoped in app-degenerette-panel.js.

export const DEGENERETTE_PREFERENCES_KEY = 'degenerus:degenerette-preferences:v1';
export const DEFAULT_DEGENERETTE_SPEED = 1;

const SUPPORTED_CURRENCIES = new Set(['0', '1', '3']);

function _storage() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch (_e) { return null; }
}

function _emptyPreferences() {
  return { version: 1, speed: DEFAULT_DEGENERETTE_SPEED, bets: {} };
}

function _normalizedSpeed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_DEGENERETTE_SPEED;
  return Math.max(0.5, Math.min(3, Math.round(numeric * 2) / 2));
}

function _normalizedBet(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 40 || !/^\d+(?:\.\d+)?$/.test(text)) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric > 0 ? text : null;
}

export function readDegenerettePreferences() {
  const storage = _storage();
  if (!storage) return _emptyPreferences();
  try {
    const parsed = JSON.parse(storage.getItem(DEGENERETTE_PREFERENCES_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return _emptyPreferences();
    const bets = {};
    for (const currency of SUPPORTED_CURRENCIES) {
      const value = _normalizedBet(parsed?.bets?.[currency]);
      if (value != null) bets[currency] = value;
    }
    return { version: 1, speed: _normalizedSpeed(parsed.speed), bets };
  } catch (_e) {
    return _emptyPreferences();
  }
}

function _writePreferences(preferences) {
  const storage = _storage();
  if (!storage) return false;
  try {
    storage.setItem(DEGENERETTE_PREFERENCES_KEY, JSON.stringify(preferences));
    return true;
  } catch (_e) {
    return false;
  }
}

export function readDegeneretteSpeed() {
  return readDegenerettePreferences().speed;
}

export function writeDegeneretteSpeed(value) {
  const preferences = readDegenerettePreferences();
  preferences.speed = _normalizedSpeed(value);
  return _writePreferences(preferences);
}

export function readDegeneretteBetSize(currency) {
  const key = String(Number(currency));
  if (!SUPPORTED_CURRENCIES.has(key)) return null;
  return readDegenerettePreferences().bets[key] ?? null;
}

export function writeDegeneretteBetSize(currency, value) {
  const key = String(Number(currency));
  const bet = _normalizedBet(value);
  if (!SUPPORTED_CURRENCIES.has(key) || bet == null) return false;
  const preferences = readDegenerettePreferences();
  preferences.bets[key] = bet;
  return _writePreferences(preferences);
}
