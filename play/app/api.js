// play/app/api.js -- Wallet-free fetchJSON for the /play/ route
// No polling, no store writes, no backoff. Same shape as beta/viewer/api.js.
// SHELL-01: only imports API_BASE; never imports wallet/contracts/app-api.

import { API_BASE } from './constants.js';

export async function fetchJSON(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}
