/* Phase 55 control page — operator admin shell.
 *
 * Single ES module per D-01 LOCKED — vanilla DOM, no Custom Elements, no framework.
 * Distinct admin theme per D-07 LOCKED (control.css ships separately; no shared
 * stylesheets imported here).
 *
 * Wires 4 ACTIVE panels in this plan:
 *   - state-controls (CTL-02 + D-05): Start/Pause/Resume/Stop buttons POST
 *     /control/{verb}; state badge updates instantly via SSE event:lifecycle;
 *     runtime stats refresh on the 5s /control/status poll.
 *   - day-advance (CTL-03): Advance 1 + Advance N controls; UI greys out when
 *     state is in {RUNNING, PAUSING, STOPPING} (exact match to Phase 54 D-04
 *     server-side gate per 54-CONTEXT.md line 88; STARTING is NOT in the active
 *     set — STARTING is transient and the server permits advance-day during it).
 *   - status-panel (CTL-05 + D-03): Promise.all([CONTROL_BASE+/control/status,
 *     API_BASE+/game/state]) every 5s with client-side spread merge { ...db, ...sim };
 *     7-cell grid (level/day/phase/players/pools/queue/rpc-errors/last-poll).
 *   - action-log (CTL-06 + D-06): EventSource subscribes to /control/events;
 *     filter rule renders 'action' + 'lifecycle' only; 50-event ring buffer
 *     (compile-time const); pause toggle preserves a pendingBuffer; clear empties
 *     both rings; auto-scrolling; truncAddr for player col; sepolia.etherscan.io
 *     /tx/{hash} for tx col.
 *
 * Two PLACEHOLDER panels live as panel-init stubs that Plan 55-03 will fill:
 *   - initForceAction (CTL-04 + D-02a/b)
 *   - initFundPlayers (CTL-07 + D-04b)
 *
 * Module-level EventSource handle (Issue 2 fix): the `es` binding is declared at
 * module scope so Plan 55-03 can attach fund-progress / fund-complete / fund-error
 * listeners against the SAME handle without re-declaring it and without retroactively
 * editing this initSse function. The 'catchup' SSE event is permanently suppressed
 * by absence-of-listener (Claude's-discretion filter rule from 55-CONTEXT.md).
 *
 * T-11 (XSS): every dynamic DOM render of an SSE-derived field uses .textContent
 * or anchor.href; raw HTML insertion is never used for SSE-derived data.
 */

// --- Constants -------------------------------------------------------------

const API_BASE     = 'http://localhost:3000';        // database /api (Phase 53)
const CONTROL_BASE = 'http://localhost:8081';        // sim /control/* (Phase 54 D-01 LOCKED)
const CHAIN_ID     = 11155111;                       // Sepolia (matches mint.js:27 in the public site)
const ETHERSCAN_TX = 'https://sepolia.etherscan.io/tx/';
const STATUS_POLL_MS = 5000;                         // CTL-05 + D-03 — 5s polling cadence
const LOG_BUFFER_SIZE = 50;                          // CTL-06 + D-06 LOCKED — compile-time const

// --- DOM helpers -----------------------------------------------------------

const $ = (id) => document.getElementById(id);
const truncAddr = (addr) => addr ? `${addr.slice(0, 8)}...${addr.slice(-4)}` : '—';
const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString() : '—';
const fmtEth = (wei) => {
  if (wei === undefined || wei === null) return '—';
  try {
    const big = typeof wei === 'bigint' ? wei : BigInt(wei);
    const eth = Number(big) / 1e18;
    return eth.toFixed(4);
  } catch (_) {
    return '—';
  }
};
const setText = (id, text) => {
  const el = $(id);
  if (el) el.textContent = String(text ?? '—');
};

// --- Fetch wrappers --------------------------------------------------------

async function ctrl(path, init) {
  const res = await fetch(`${CONTROL_BASE}${path}`, init);
  // 409 is a meaningful gate (e.g. autoplayer-active on advance-day); surface to caller.
  if (!res.ok && res.status !== 409) {
    throw new Error(`${(init && init.method) || 'GET'} ${path} → ${res.status}`);
  }
  let json = null;
  try { json = await res.json(); } catch (_) { /* allow empty body */ }
  return { status: res.status, json };
}

async function api(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

// --- State module (singleton-ish; vanilla, no class) -----------------------

let isLogPaused = false;
const displayedRing = [];           // FIFO; capped at LOG_BUFFER_SIZE
const pendingBuffer = [];           // accumulates while paused (also soft-capped)
let currentRunnerState = 'STOPPED'; // updated on every status poll OR lifecycle SSE
let advanceInProgress = false;
let es = null;                      // module-level EventSource handle (Issue 2 fix)
                                    // initSse() ASSIGNS via `es = new EventSource(...)`.
                                    // Plan 55-03 attaches fund-* listeners against this
                                    // SAME handle — never re-declares `es`, never edits
                                    // initSse. Each plan's commit stands alone for review.

// --- State badge + day-advance gate (used by both state-controls and SSE) --

function updateStateBadge(stateKind) {
  if (!stateKind) return;
  currentRunnerState = stateKind;
  const el = $('state-badge');
  if (el) {
    el.textContent = stateKind;
    el.className = `state-badge state-${String(stateKind).toLowerCase()}`;
  }
  applyDayAdvanceGate();
}

function applyDayAdvanceGate() {
  // Phase 54 54-CONTEXT.md line 88 (D-04 LOCKED): server-side advance-day gate is
  // "refuses (409) when RUNNING / PAUSING / STOPPING". The UI gate matches that
  // server gate exactly — STARTING is NOT in the active list (STARTING is a brief
  // transient between STOPPED→RUNNING and the server permits advance-day during it).
  // Cited so a future reader doesn't re-add STARTING.
  const active = ['RUNNING', 'PAUSING', 'STOPPING'].includes(currentRunnerState);
  const btn1 = $('btn-advance-1'); if (btn1) btn1.disabled = active;
  const btnN = $('btn-advance-n'); if (btnN) btnN.disabled = active;
}

// --- Panel: state-controls (CTL-02 + D-05) ---------------------------------
//
// Endpoints called (CONTROL_BASE prefix):
//   POST /control/start  — runner.start()
//   POST /control/pause  — runner.requestPause()
//   POST /control/resume — runner.resume()
//   POST /control/stop   — runner.requestStop() (drains in-flight txs)

function initStateControls() {
  $('btn-start' ).addEventListener('click', () => issueControl('start'));
  $('btn-pause' ).addEventListener('click', () => issueControl('pause'));
  $('btn-resume').addEventListener('click', () => issueControl('resume'));
  $('btn-stop'  ).addEventListener('click', () => issueControl('stop'));
}

async function issueControl(verb) {
  try {
    const { json } = await ctrl(`/control/${verb}`, { method: 'POST' });
    if (json && json.state) updateStateBadge(json.state);
  } catch (e) {
    console.error(`[control] ${verb} failed:`, e);
  }
}

// --- Panel: day-advance (CTL-03) -------------------------------------------

function initDayAdvance() {
  $('btn-advance-1').addEventListener('click', async () => { await advanceDays(1); });
  $('btn-advance-n').addEventListener('click', async () => {
    const N = parseInt($('input-advance-n').value, 10);
    if (Number.isInteger(N) && N >= 1) await advanceDays(N);
  });
}

async function advanceDays(N) {
  if (advanceInProgress) return;
  advanceInProgress = true;
  const statusEl = $('advance-status');
  try {
    for (let i = 1; i <= N; i++) {
      if (statusEl) statusEl.textContent = `Advancing day ${i} of ${N}...`;
      const { status, json } = await ctrl('/control/advance-day', { method: 'POST' });
      if (status === 409) {
        if (statusEl) {
          statusEl.textContent = `409: autoplayer-active (state=${(json && json.state) || '?'}); aborting`;
        }
        break;
      }
      if (json && json.currentDayView !== undefined) {
        if (statusEl) statusEl.textContent = `→ day ${json.currentDayView} (${i} of ${N})`;
      }
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = `error: ${String(e).slice(0, 120)}`;
    console.error('[control] advanceDays failed:', e);
  } finally {
    advanceInProgress = false;
  }
}

// --- Panel: status (CTL-05 + D-03 client-side merge) -----------------------

async function pollStatus() {
  try {
    const [sim, db] = await Promise.all([
      fetch(`${CONTROL_BASE}/control/status`).then(r => r.json()).catch(() => null),
      fetch(`${API_BASE}/game/state`).then(r => r.json()).catch(() => null),
    ]);
    const merged = { ...(db || {}), ...(sim || {}) };
    renderStatus(merged);
    // CTL-02 runtime stats: keep in sync with sim block
    if (sim) {
      setText('stat-txs-sent', sim.txsSent ?? 0);
      setText('stat-errors', sim.errors ?? 0);
      setText('stat-current-level', sim.currentLevel ?? '—');
      setText('stat-current-day', sim.currentDay ?? '—');
      setText('stat-last-action', fmtTime(sim.lastActionTimestamp));
      // Backstop the SSE-driven badge so the UI is correct on first paint
      // and resilient to a missed lifecycle event (D-05 hybrid).
      updateStateBadge(sim.state || currentRunnerState);
    }
    setText('status-last-poll', new Date().toLocaleTimeString());
  } catch (e) {
    console.error('[control] pollStatus failed:', e);
  }
}

function renderStatus(merged) {
  const dayPart = merged.dayOfLevel ?? merged.currentDay ?? '—';
  setText('status-level-day', `${merged.currentLevel ?? '—'} / ${dayPart}`);
  setText('status-phase', merged.jackpotPhase ?? merged.phase ?? '—');
  setText('status-players-alive', merged.playersAlive ?? '—');

  const pools = merged.poolBalances || {};
  const poolStr = ['jackpot', 'decimator', 'treasury', 'vault']
    .map(k => `${k.slice(0, 3)}: ${fmtEth(pools[k])}`)
    .join(' · ');
  setText('status-pools', poolStr || '—');

  setText('status-tx-queue', `${merged.txQueueDepth ?? 0} / ${merged.txsInflight ?? 0} inflight`);
  setText('status-rpc-errors', merged.recentRpcErrorRate ?? 0);
}

function initStatus() {
  pollStatus();
  setInterval(pollStatus, STATUS_POLL_MS);
}

// --- Panel: action-log (CTL-06 + D-06 ring buffer) -------------------------

function initActionLog() {
  $('btn-log-pause').addEventListener('click', toggleLogPause);
  $('btn-log-clear').addEventListener('click', clearLog);
  renderLogStatus();
}

function toggleLogPause() {
  isLogPaused = !isLogPaused;
  $('btn-log-pause').textContent = isLogPaused ? 'Resume' : 'Pause';
  if (!isLogPaused) {
    // Drain pending buffer into displayed ring (most recent N kept by FIFO eviction).
    while (pendingBuffer.length > 0) {
      const evt = pendingBuffer.shift();
      pushLogEvent(evt);
    }
  }
  renderLogStatus();
}

function clearLog() {
  displayedRing.length = 0;
  pendingBuffer.length = 0;
  const tbody = $('log-tbody');
  if (tbody) tbody.textContent = '';
  renderLogStatus();
}

function renderLogStatus() {
  const status = isLogPaused
    ? `paused · ${displayedRing.length} displayed · ${pendingBuffer.length} buffered`
    : `streaming · ${displayedRing.length} events`;
  setText('log-status', status);
}

function handleSseEvent(eventName, data) {
  // Filter rule: render 'action' + 'lifecycle'; suppress everything else.
  // 'catchup' / fund-* events are owned by other panels (catchup is one-shot info;
  // fund-* by Plan 55-03's initFundPlayers).
  if (eventName !== 'action' && eventName !== 'lifecycle') return;
  const evt = { eventName, data, ts: new Date().toISOString() };
  if (isLogPaused) {
    pendingBuffer.push(evt);
    // Soft cap on pending — prevent unbounded growth during long pauses.
    if (pendingBuffer.length > LOG_BUFFER_SIZE * 4) pendingBuffer.shift();
  } else {
    pushLogEvent(evt);
  }
  renderLogStatus();
}

function pushLogEvent(evt) {
  displayedRing.push(evt);
  if (displayedRing.length > LOG_BUFFER_SIZE) displayedRing.shift();
  appendLogRow(evt);
}

function appendLogRow(evt) {
  const tbody = $('log-tbody');
  if (!tbody) return;
  const tr = document.createElement('tr');

  const tdTime = document.createElement('td');
  tdTime.className = 'mono';
  tdTime.textContent = new Date(evt.ts).toLocaleTimeString();

  const tdType   = document.createElement('td');
  const tdPlayer = document.createElement('td');
  tdPlayer.className = 'mono';
  const tdTx     = document.createElement('td');
  tdTx.className = 'mono';
  const tdResult = document.createElement('td');

  if (evt.eventName === 'action') {
    tdType.textContent = evt.data.action_type || 'action';
    tdPlayer.textContent = truncAddr(evt.data.player);          // T-11: textContent (raw-HTML write avoided)
    if (evt.data.tx_hash) {
      const a = document.createElement('a');
      a.href = ETHERSCAN_TX + evt.data.tx_hash;                 // T-11: anchor.href; raw-HTML write avoided
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = truncAddr(evt.data.tx_hash);
      tdTx.appendChild(a);
    } else {
      tdTx.textContent = '—';
    }
    if (evt.data.success) {
      tdResult.className = 'log-success';
      tdResult.textContent = 'OK';
    } else {
      tdResult.className = 'log-fail';
      tdResult.textContent = String(evt.data.error_reason || 'fail').slice(0, 60);
    }
  } else {
    // lifecycle event
    tdType.textContent = 'lifecycle';
    tdPlayer.textContent = '—';
    tdTx.textContent = '—';
    tdResult.className = 'log-lifecycle';
    tdResult.textContent =
      evt.data.transition || `${evt.data.fromState || ''} → ${evt.data.toState || ''}`;
    // Also drive the state badge from lifecycle (D-05 hybrid event-driven)
    if (evt.data.toState) updateStateBadge(evt.data.toState);
  }

  tr.appendChild(tdTime);
  tr.appendChild(tdType);
  tr.appendChild(tdPlayer);
  tr.appendChild(tdTx);
  tr.appendChild(tdResult);
  tbody.appendChild(tr);

  // Auto-scroll to the bottom
  tbody.scrollTop = tbody.scrollHeight;

  // FIFO row eviction in the DOM, mirroring the displayedRing cap
  while (tbody.children.length > LOG_BUFFER_SIZE) {
    tbody.removeChild(tbody.firstChild);
  }
}

// --- SSE subscription (named handlers per event type) ----------------------

function initSse() {
  es = new EventSource(`${CONTROL_BASE}/control/events`);
  es.addEventListener('action',    (e) => handleSseEvent('action',    JSON.parse(e.data)));
  es.addEventListener('lifecycle', (e) => handleSseEvent('lifecycle', JSON.parse(e.data)));
  // Suppressed event types — Plan 55-02 does NOT add listeners. The browser's
  // EventSource silently ignores events without a registered listener for that
  // event-type, which matches D-06 + Claude's-discretion filter rule for the
  // action-log panel.
  //
  // Plan 55-03 attaches its own listeners for 'fund-progress' / 'fund-complete' /
  // 'fund-error' against the SAME module-level `es` handle declared above —
  // no retroactive edit to this initSse function. 'catchup' is permanently
  // suppressed by absence-of-listener in both plans.
  es.onerror = () => { console.warn('[control] SSE connection error; auto-retry'); };
  return es;
}

// --- Placeholder panels (Plan 55-03 fills these) ---------------------------

function initForceAction() {
  // Plan 55-03 — bespoke per-action forms (D-02a) wired here.
  // No bindings in Plan 55-02; the panel section ships as a placeholder shell
  // in index.html so the layout grid is stable when Plan 03 lands.
}

function initFundPlayers() {
  // Plan 55-03 — 25-wallet checkbox grid + fund-progress SSE wiring (D-04b).
  // Plan 03 will attach SSE listeners for the fund-progress / fund-complete /
  // fund-error event types against the module-level `es` handle declared above.
}

// --- Boot ------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  initStateControls();
  initDayAdvance();
  initStatus();
  initActionLog();
  initForceAction();    // Plan 55-03 placeholder
  initFundPlayers();    // Plan 55-03 placeholder
  initSse();
  console.log('[control] initialized', {
    CONTROL_BASE, API_BASE, CHAIN_ID, LOG_BUFFER_SIZE,
  });
});
