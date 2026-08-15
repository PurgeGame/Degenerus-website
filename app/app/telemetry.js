// Frontend telemetry client (zero-importer; loaded from IDLE_MODULES one idle
// slot after paint). The tiny inline hook in index.html captures errors,
// unhandled rejections, dead-resource loads, and CSP violations from the very
// first parse into window.__telemetryQ; this module drains that queue, takes
// over its push, adds Web Vitals, and beacons batches to the database API's
// /telemetry/report inbox (lag-guard exempt server-side — it accepts exactly
// when the site is broken). Nothing here may ever throw into the app: every
// entry point is wrapped, and a telemetry failure is silent by design.
//
// Privacy: pathname only (never the query string — ?as=/?ref= carry
// addresses/codes), no wallet address, a random per-pageload session id.

import { API_BASE } from './constants.js';

const ENDPOINT = API_BASE + '/telemetry/report';
const MAX_EVENTS_PER_SESSION = 60; // hard per-pageload send budget
const MAX_EVENTS_PER_BEACON = 20;  // server-side schema cap
const FLUSH_DEBOUNCE_MS = 5_000;

/** Dedupe key -> { kind, t, data, n }. Repeats bump n instead of appending. */
export function foldEvent(map, raw) {
  if (!raw || typeof raw !== 'object' || !raw.kind) return;
  const data = raw.data && typeof raw.data === 'object' ? raw.data : {};
  const key = raw.kind + '|' + (data.m || '') + '|' + (data.u || '') + '|' + (data.b || '') + '|' + (data.src || '');
  const prior = map.get(key);
  if (prior) { prior.n += 1; return; }
  map.set(key, { kind: raw.kind, t: raw.t, data, n: 1 });
}

/** Pure payload builder so tests need no DOM. */
export function buildTelemetryPayload(folded, vitalsEvent, env = {}) {
  const events = [];
  for (const item of folded.values()) {
    if (events.length >= MAX_EVENTS_PER_BEACON - (vitalsEvent ? 1 : 0)) break;
    const data = item.n > 1 ? { ...item.data, n: item.n } : item.data;
    events.push({ kind: item.kind, t: item.t, data });
  }
  if (vitalsEvent) events.push(vitalsEvent);
  if (events.length === 0) return null;
  return {
    page: String(env.pathname ?? globalThis.location?.pathname ?? '').slice(0, 300),
    userAgent: String(env.userAgent ?? globalThis.navigator?.userAgent ?? '').slice(0, 400),
    viewport: String(env.viewport ?? (
      typeof globalThis.innerWidth === 'number' ? `${globalThis.innerWidth}x${globalThis.innerHeight}` : ''
    )).slice(0, 40),
    sessionId: String(env.sessionId ?? '').slice(0, 64),
    events,
  };
}

const sessionId = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
const pending = new Map();
const vitals = { lcp: 0, cls: 0, fcp: 0, ttfb: 0, inp: 0 };
let sentCount = 0;
let vitalsSent = false;
let flushTimer = 0;

function observe(type, opts, handler) {
  try { new PerformanceObserver((list) => { try { handler(list.getEntries()); } catch (_e) {} }).observe({ type, buffered: true, ...opts }); }
  catch (_e) { /* observer type unsupported — vitals field stays 0 */ }
}

observe('largest-contentful-paint', {}, (entries) => {
  const last = entries[entries.length - 1];
  if (last) vitals.lcp = Math.round(last.startTime);
});
observe('layout-shift', {}, (entries) => {
  for (const e of entries) if (!e.hadRecentInput) vitals.cls += e.value;
});
observe('paint', {}, (entries) => {
  for (const e of entries) if (e.name === 'first-contentful-paint') vitals.fcp = Math.round(e.startTime);
});
observe('event', { durationThreshold: 40 }, (entries) => {
  for (const e of entries) if (e.duration > vitals.inp) vitals.inp = Math.round(e.duration);
});
try {
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav) vitals.ttfb = Math.round(nav.responseStart);
} catch (_e) { /* fine */ }

function send(payload) {
  if (!payload) return;
  try {
    const body = JSON.stringify(payload);
    const blob = new Blob([body], { type: 'application/json' });
    if (!(navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob))) {
      fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
    sentCount += payload.events.length;
  } catch (_e) { /* telemetry never surfaces */ }
}

function flush(final) {
  if (sentCount >= MAX_EVENTS_PER_SESSION) return;
  let vitalsEvent = null;
  if (final && !vitalsSent && (vitals.lcp || vitals.fcp || vitals.ttfb)) {
    vitalsSent = true;
    vitalsEvent = { kind: 'vitals', t: Date.now(), data: {
      lcp: vitals.lcp, cls: Math.round(vitals.cls * 1000) / 1000,
      fcp: vitals.fcp, ttfb: vitals.ttfb, inp: vitals.inp,
    } };
  }
  const payload = buildTelemetryPayload(pending, vitalsEvent, { sessionId });
  pending.clear();
  send(payload);
}

function scheduleFlush() {
  if (flushTimer || sentCount >= MAX_EVENTS_PER_SESSION) return;
  flushTimer = setTimeout(() => { flushTimer = 0; flush(false); }, FLUSH_DEBOUNCE_MS);
}

function record(raw) {
  try { foldEvent(pending, raw); scheduleFlush(); } catch (_e) { /* never throws */ }
}

try {
  const q = globalThis.__telemetryQ;
  if (Array.isArray(q)) {
    for (const item of q.splice(0)) record(item);
    // The inline hook keeps calling q.push — route future items here.
    q.push = (item) => { record(item); return 0; };
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  addEventListener('pagehide', () => flush(true));
} catch (_e) { /* telemetry never surfaces */ }
