// viewer/api.js -- Simplified fetchJSON for viewer page
// No polling, no store, no backoff -- viewer is read-only (D-19, D-20)
// Only imports API_BASE from constants -- nothing else from app/ (SHELL-01)

import { API_BASE } from '../app/constants.js';

export async function fetchJSON(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}
