// Feedback API client. The browser sends a small game-state snapshot alongside
// the player's words so reports arrive with enough context to reproduce them.

import { API_BASE } from '../../beta/app/constants.js';
import { CHAIN } from './chain-config.js';
import { get, getViewedAddress } from './store.js';

function _trim(value, max) { return String(value ?? '').trim().slice(0, max); }

/** Build the exact POST /feedback body. Optional env injection keeps this pure in tests. */
export function buildFeedbackPayload(input = {}, env = {}) {
  const read = typeof env.getStore === 'function' ? env.getStore : get;
  const locationObj = env.locationObj ?? globalThis.location;
  const navigatorObj = env.navigatorObj ?? globalThis.navigator;
  const viewport = env.viewport ?? (
    typeof globalThis.innerWidth === 'number' && typeof globalThis.innerHeight === 'number'
      ? `${globalThis.innerWidth}x${globalThis.innerHeight}`
      : null
  );
  const game = read('app.gameState') || {};
  const lastDay = read('app.lastDay') || {};
  const kind = input.kind === 'suggestion' ? 'suggestion' : 'bug';
  const title = _trim(input.title, 120);
  const message = _trim(input.message, 4_000);
  if (title.length < 3) throw new Error('Add a short title.');
  if (message.length < 5) throw new Error('Tell us a little more.');

  let viewedAddress = null;
  try { viewedAddress = env.viewedAddress ?? getViewedAddress() ?? null; }
  catch (_e) { viewedAddress = null; }

  return {
    kind,
    title,
    message,
    contact: _trim(input.contact, 200),
    wallet: read('connected.address') || null,
    page: _trim(locationObj?.href || '/app/', 1_000),
    userAgent: _trim(navigatorObj?.userAgent || '', 500),
    context: {
      chainId: Number(CHAIN.id) || null,
      level: Number.isInteger(Number(game.level)) ? Number(game.level) : null,
      day: Number.isInteger(Number(lastDay.day)) ? Number(lastDay.day) : null,
      phase: game.phase ?? null,
      viewedAddress,
      viewport,
    },
    website: _trim(input.website, 200),
  };
}

export async function submitFeedback(input, { fetcher = globalThis.fetch, env = {} } = {}) {
  if (typeof fetcher !== 'function') throw new Error('Feedback service unavailable.');
  const payload = buildFeedbackPayload(input, env);
  const response = await fetcher(`${API_BASE}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response?.ok) throw new Error('Could not send that right now.');
  return response.json();
}

