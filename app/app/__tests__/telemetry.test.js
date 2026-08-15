// telemetry.js — the pure halves (event folding + payload building). The
// beacon/observer wiring is browser-only and deliberately try/catch-silent;
// what matters to pin is the dedupe, the caps, and that the payload never
// carries the query string (?as=/?ref= hold addresses/codes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldEvent, buildTelemetryPayload } from '../telemetry.js';

test('foldEvent dedupes identical errors into a count instead of appending', () => {
  const map = new Map();
  for (let i = 0; i < 5; i += 1) {
    foldEvent(map, { kind: 'error', t: 100 + i, data: { m: 'boom', src: '/app/x.js' } });
  }
  foldEvent(map, { kind: 'error', t: 200, data: { m: 'different', src: '/app/x.js' } });
  assert.equal(map.size, 2);
  const [first] = map.values();
  assert.equal(first.n, 5);
});

test('foldEvent ignores malformed queue entries', () => {
  const map = new Map();
  for (const junk of [null, 42, 'x', {}, { data: {} }]) foldEvent(map, junk);
  assert.equal(map.size, 0);
});

test('buildTelemetryPayload caps at 20 events and keeps the vitals slot', () => {
  const map = new Map();
  for (let i = 0; i < 30; i += 1) {
    foldEvent(map, { kind: 'error', t: i, data: { m: 'e' + i } });
  }
  const vitalsEvent = { kind: 'vitals', t: 999, data: { lcp: 640 } };
  const payload = buildTelemetryPayload(map, vitalsEvent, {
    pathname: '/app/', userAgent: 'ua', viewport: '390x844', sessionId: 's1',
  });
  assert.equal(payload.events.length, 20);
  assert.equal(payload.events.at(-1).kind, 'vitals');
});

test('repeat counts ride as data.n; singletons carry no n', () => {
  const map = new Map();
  foldEvent(map, { kind: 'csp', t: 1, data: { d: 'img-src', b: 'https://x' } });
  foldEvent(map, { kind: 'csp', t: 2, data: { d: 'img-src', b: 'https://x' } });
  foldEvent(map, { kind: 'rejection', t: 3, data: { m: 'once' } });
  const payload = buildTelemetryPayload(map, null, { pathname: '/app/', sessionId: 's' });
  assert.equal(payload.events[0].data.n, 2);
  assert.equal(payload.events[1].data.n, undefined);
});

test('payload page is a pathname, never a query string, and empty maps build nothing', () => {
  const payload = buildTelemetryPayload(new Map(), { kind: 'vitals', t: 1, data: {} }, {
    pathname: '/app/', sessionId: 's',
  });
  assert.equal(payload.page, '/app/');
  assert.ok(!payload.page.includes('?'));
  assert.equal(buildTelemetryPayload(new Map(), null, { pathname: '/app/' }), null);
});
