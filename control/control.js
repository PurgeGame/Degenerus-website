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

// --- Plan 55-03 module state (force-action + fund-players panels) ----------
//
// Force-action picker holds wallet metadata fetched once from /wallets.json
// (file-server-served by sim's startFileServer). T-11 + T-1 invariant: only
// `address` + `archetype` are ever lifted out of the JSON; `privateKey` is
// present in the file but is deliberately NEVER read into UI state.
let walletsList = [];               // [{ idx, address, archetype }]
let walletsBalances = new Map();    // idx → balance (wei decimal-string)
// fund-players in-flight tracking. Non-null while a fund run is in flight;
// fund-progress / fund-complete / fund-error events are ignored unless their
// data.request_id matches this value (D-04b correlation rule).
let fpInProgressRequestId = null;
const FUND_PROGRESS_LISTENER = (e) => onFundProgress(JSON.parse(e.data));
const FUND_COMPLETE_LISTENER = (e) => onFundComplete(JSON.parse(e.data));
const FUND_ERROR_LISTENER    = (e) => onFundError(JSON.parse(e.data));

// --- ACTION_FORMS table — D-02a LOCKED bespoke per-action form variants ----
//
// Each entry: actionType → array of field-specs.
// Field-spec: { name, kind, label, options?, placeholder?, hint? }
//   kind: 'count' | 'amount' | 'token' | 'currency' | 'side' | 'picks' | 'boonType'
//   options: enum values for select-kind fields
//   hint: short help text rendered below the input
//
// Note: claimAffiliate intentionally absent — Plan 55-01 throws on it
// (claimAffiliateDgnrs has no PlayerDecision boolean field; auto-fires in
// processClaims). The UI dropdown ships it as a DISABLED option with hover
// tooltip; the disabled state cannot be selected, so this table never reaches
// a claimAffiliate branch in normal UI flow.
const ACTION_FORMS = {
  purchase: [
    { name: 'token', kind: 'token', label: 'Token', options: ['ETH', 'BURNIE'] },
    { name: 'count', kind: 'count', label: 'Ticket count (multiple of 100 or 1)', placeholder: '5' },
  ],
  lootboxOpen: [
    { name: 'token',  kind: 'token',  label: 'Token', options: ['ETH', 'BURNIE'] },
    { name: 'count',  kind: 'count',  label: 'Lootbox count (when token=ETH)',          placeholder: '1', hint: 'Used when token=ETH; ignored for BURNIE.' },
    { name: 'amount', kind: 'amount', label: 'BURNIE amount in wei (when token=BURNIE)', placeholder: '1000000000000000000', hint: 'Used when token=BURNIE; ignored for ETH.' },
  ],
  coinflipDeposit: [
    { name: 'amount',   kind: 'amount',   label: 'Stake amount in wei', placeholder: '500000000000000000' },
    { name: 'currency', kind: 'currency', label: 'Currency', options: ['eth', 'burnie'] },
  ],
  degenerette: [
    { name: 'amount',   kind: 'amount',   label: 'Bet size in wei', placeholder: '100000000000000000' },
    { name: 'currency', kind: 'currency', label: 'Currency', options: ['eth', 'burnie', 'wwxrp'] },
    { name: 'picks',    kind: 'picks',    label: 'Picks (CSV of integers; advisory)', placeholder: '1,2,3' },
  ],
  claimWinnings:  [],
  claimDecimator: [],
  deityBoon: [
    { name: 'boonType', kind: 'boonType', label: 'Boon type (enum number)', placeholder: '0' },
  ],
  burnBoon: [
    { name: 'amount',   kind: 'amount',   label: 'DGNRS amount in wei', placeholder: '1000000000000000000' },
  ],
};

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
  // playersAlive is not currently surfaced by /game/state or /control/status
  // (db schema doesn't aggregate it, sim status block omits it). Render
  // 'n/a' rather than '—' so the operator can tell the field is intentionally
  // absent vs. waiting on a pending fetch.
  setText('status-players-alive', merged.playersAlive ?? 'n/a');

  // /game/state exposes `prizePools` (NOT `poolBalances`) with these keys:
  //   { currentPrizePool, nextPrizePool, futurePrizePool, claimableWinnings, frozen }
  // We display the four wei-string pools as ETH; `frozen` is a bool and is
  // surfaced separately via the existing 'Jackpot Phase' cell context.
  const pools = merged.prizePools || merged.poolBalances || {};
  const poolStr = [
    ['cur', pools.currentPrizePool],
    ['nxt', pools.nextPrizePool],
    ['fut', pools.futurePrizePool],
    ['clm', pools.claimableWinnings],
  ]
    .map(([k, v]) => `${k}: ${fmtEth(v)}`)
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

// --- Panel: force-action (CTL-04 + D-02a/b) --------------------------------
//
// Endpoints called:
//   GET  CONTROL_BASE+/control/wallets/balances → [{ idx, address, balanceWei }]
//                                           (sim ships wallets.json in its own
//                                           repo cwd, NOT in the website repo
//                                           that the file-server is rooted at,
//                                           so /wallets.json from port 8080
//                                           404s. The control-server already
//                                           knows every player wallet because
//                                           it loaded them at boot — we reuse
//                                           that endpoint and skip archetype.
//                                           T-1: privateKey is never returned
//                                           by /control/wallets/balances, so
//                                           it cannot leak into UI state.)
//   POST CONTROL_BASE+/control/force-action body { player, actionType, args }
//                                          → 200 { txHash:null, success, error_reason? }
//                                          → 400 { error, message } on T-9 validation
//                                          → 409 { error:'autoplayer-stopping', state }
//                                          → 500 { error, message }
//
// Tx-hash arrives via the existing SSE event:action stream (Phase 54 D-08
// LOCKED raw events) — operator correlates by player address + temporal
// proximity in the live action-log panel.

async function initForceAction() {
  // 1. Populate player dropdown from CONTROL_BASE /control/wallets/balances.
  //    Same source-of-truth as the fund-players panel — guarantees parity and
  //    avoids the file-server 404 (sim's wallets.json is in the sim repo cwd,
  //    not the website repo the file-server is rooted at).
  try {
    const { json } = await ctrl('/control/wallets/balances');
    if (!Array.isArray(json)) throw new Error('invalid balances response');
    // T-1: only `idx` + `address` lifted into UI state. The endpoint never
    // returns privateKey. Archetype is not exposed by this endpoint — show
    // truncAddr only (operator can cross-reference idx in the fund-players
    // panel if needed).
    walletsList = json.slice(0, 25).map((entry) => ({
      idx: entry.idx,
      address: entry.address,
    }));
    const sel = $('fa-player');
    walletsList.forEach(({ idx, address }) => {
      const opt = document.createElement('option');
      opt.value = address;
      opt.textContent = `${idx} · ${truncAddr(address)}`;
      sel.appendChild(opt);
    });
  } catch (e) {
    const sel = $('fa-player');
    // overwriting our own static placeholder option list with a single
    // failure option (T-11 safe — text built via textContent below)
    sel.textContent = '';
    const opt = document.createElement('option');
    opt.textContent = `(failed to load wallets: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)})`;
    opt.disabled = true;
    sel.appendChild(opt);
  }

  // 2. Player picker change → re-validate (does not rebuild fields)
  $('fa-player').addEventListener('change', validateForceActionForm);

  // 3. Action-type change → render conditional fields
  $('fa-action-type').addEventListener('change', renderForceActionFields);

  // 4. Execute button
  $('fa-execute').addEventListener('click', submitForceAction);

  // 5. Initial validation pass (Execute disabled until form is valid)
  validateForceActionForm();
}

function renderForceActionFields() {
  const actionType = $('fa-action-type').value;
  const argsContainer = $('fa-args');
  // T-11: textContent clears existing children safely (no raw-HTML write)
  argsContainer.textContent = '';
  const fields = ACTION_FORMS[actionType];
  if (!fields || fields.length === 0) {
    validateForceActionForm();
    return;
  }
  fields.forEach((spec) => argsContainer.appendChild(buildFaField(spec)));
  // Each field input also triggers re-validation
  argsContainer.querySelectorAll('input,select').forEach((el) => {
    el.addEventListener('input', validateForceActionForm);
    el.addEventListener('change', validateForceActionForm);
  });
  validateForceActionForm();
}

function buildFaField(spec) {
  const row = document.createElement('div');
  row.className = 'fa-form-row';
  const label = document.createElement('label');
  label.className = 'fa-label';
  label.textContent = spec.label;
  label.setAttribute('for', `fa-arg-${spec.name}`);
  row.appendChild(label);
  let input;
  if (spec.options) {
    input = document.createElement('select');
    input.className = 'fa-select';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '— select —';
    input.appendChild(blank);
    spec.options.forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      input.appendChild(o);
    });
  } else {
    input = document.createElement('input');
    input.type = (spec.kind === 'count' || spec.kind === 'boonType') ? 'number' : 'text';
    if (spec.placeholder) input.placeholder = spec.placeholder;
    if (spec.kind === 'count' || spec.kind === 'boonType') input.min = '0';
    input.className = 'fa-input';
  }
  input.id = `fa-arg-${spec.name}`;
  input.dataset.argName = spec.name;
  input.dataset.argKind = spec.kind;
  row.appendChild(input);
  if (spec.hint) {
    const hint = document.createElement('div');
    hint.className = 'fa-hint';
    hint.textContent = spec.hint;
    hint.style.gridColumn = '2';
    hint.style.fontSize = '10px';
    hint.style.color = 'var(--text-muted)';
    row.appendChild(hint);
  }
  return row;
}

function readForceActionArgs() {
  const args = {};
  $('fa-args').querySelectorAll('input,select').forEach((el) => {
    const name = el.dataset.argName;
    const kind = el.dataset.argKind;
    const raw = el.value;
    if (raw === '') return;                                   // empty: omit; let server validate
    if (kind === 'count' || kind === 'boonType') {
      const n = parseInt(raw, 10);
      if (Number.isInteger(n)) args[name] = n;
    } else if (kind === 'picks') {
      const parts = raw.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => parseInt(s, 10))
        .filter(Number.isInteger);
      if (parts.length > 0) args[name] = parts;
    } else {
      // amount / token / currency / side: pass-through string
      args[name] = raw;
    }
  });
  return args;
}

function validateForceActionForm() {
  // T-13: client-side disable when form is malformed; server is authoritative
  const player = $('fa-player').value;
  const actionType = $('fa-action-type').value;
  const fields = ACTION_FORMS[actionType] ?? null;
  let valid = !!player && !!actionType && fields !== null;
  if (valid && fields.length > 0) {
    const args = readForceActionArgs();
    if (actionType === 'lootboxOpen') {
      // Special case: needs token + (count when ETH) | (amount when BURNIE)
      if (!args.token) valid = false;
      else if (args.token === 'ETH' && !Number.isInteger(args.count)) valid = false;
      else if (args.token === 'BURNIE' && (typeof args.amount !== 'string' || !/^\d+$/.test(args.amount))) valid = false;
    } else {
      // Generic: every declared field must be set + well-typed
      for (const spec of fields) {
        const val = args[spec.name];
        if (val === undefined) { valid = false; break; }
        if ((spec.kind === 'count' || spec.kind === 'boonType') && !Number.isInteger(val)) { valid = false; break; }
        if (spec.kind === 'amount' && (typeof val !== 'string' || !/^\d+$/.test(val))) { valid = false; break; }
      }
    }
  }
  $('fa-execute').disabled = !valid;
}

async function submitForceAction() {
  const player = $('fa-player').value;
  const actionType = $('fa-action-type').value;
  const args = readForceActionArgs();
  const resultEl = $('fa-result');
  resultEl.className = 'fa-result fa-result-pending';
  // T-11: textContent only — no raw-HTML write of operator input
  resultEl.textContent = `Submitting ${actionType} for ${truncAddr(player)}...`;
  $('fa-execute').disabled = true;
  try {
    const res = await fetch(`${CONTROL_BASE}/control/force-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player, actionType, args }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      resultEl.className = 'fa-result fa-result-success';
      // Plan 55-01 returns txHash:null; the actual hash arrives via SSE event:action.
      const successText = json.success ? 'OK' : `success=${json.success}`;
      const reasonText = json.error_reason ? ` · ${json.error_reason}` : '';
      resultEl.textContent =
        `${successText}${reasonText}\n(tx-hash arrives via action-log SSE; check the live log panel for the tx link)`;
    } else if (res.status === 409) {
      resultEl.className = 'fa-result fa-result-error';
      resultEl.textContent = `409: ${json.error ?? 'autoplayer-stopping'} (state=${json.state ?? '?'})`;
    } else {
      resultEl.className = 'fa-result fa-result-error';
      resultEl.textContent = `${res.status}: ${json.error ?? 'unknown'}${json.message ? ' · ' + json.message : ''}`;
    }
  } catch (e) {
    resultEl.className = 'fa-result fa-result-error';
    resultEl.textContent = `network error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
  } finally {
    validateForceActionForm();                                // re-enable Execute if form still valid
  }
}

// --- Panel: fund-players (CTL-07 + D-04b) ----------------------------------
//
// Endpoints called:
//   GET  CONTROL_BASE+/control/wallets/balances → [{ idx, address, balance(wei) }]
//   POST CONTROL_BASE+/control/fund-players body { targetIndices? }
//                                              → 200 { request_id, targetIndices }
//                                              → 400 { error, message }
//
// SSE listeners attached to the module-level `es` handle (declared by Plan
// 55-02; assigned in initSse() before this function runs):
//   event:fund-progress data { request_id, idx, address, pre, post, action }
//   event:fund-complete data { request_id, totalRows }
//   event:fund-error    data { request_id, error }
//
// Filtering is by request_id correlation (D-04b LOCKED) — events from a
// stale/abandoned request are ignored. The action-log panel does NOT receive
// these events because it only attaches listeners for action + lifecycle.

async function initFundPlayers() {
  // 1. Build the 25-row table (skeleton; balances filled by refreshFpTable)
  await refreshFpTable();

  // 2. Wire buttons + check-all
  $('fp-refresh').addEventListener('click', refreshFpTable);
  $('fp-fund-selected').addEventListener('click', () => fundClick(getSelectedTargetIndices()));
  $('fp-fund-all').addEventListener('click',      () => fundClick(undefined));
  $('fp-check-all').addEventListener('change', toggleSelectAll);

  // 3. Subscribe SSE listeners for fund-* events on the module-level `es` handle.
  //    initSse() runs before this function (boot order in DOMContentLoaded), so
  //    `es` is non-null here. The action-log filter rule (action + lifecycle
  //    only) is NOT violated — these listeners route to the fund-players panel
  //    table, never to the action-log table.
  if (es) {
    es.addEventListener('fund-progress', FUND_PROGRESS_LISTENER);
    es.addEventListener('fund-complete', FUND_COMPLETE_LISTENER);
    es.addEventListener('fund-error',    FUND_ERROR_LISTENER);
  } else {
    console.warn('[control] EventSource not initialized; fund-* SSE listeners not attached');
  }
}

async function refreshFpTable() {
  $('fp-status').textContent = 'fetching balances...';
  const tbody = $('fp-tbody');
  tbody.textContent = '';
  try {
    const { json } = await ctrl('/control/wallets/balances');
    if (!Array.isArray(json)) throw new Error('invalid balances response');
    walletsBalances = new Map();
    json.forEach((entry) => {
      // Plan 55-01 returns { idx, address, balanceWei } per Issue 5 fix.
      // Tolerate either `balance` or `balanceWei` key for forward-compat.
      const balance = entry.balanceWei ?? entry.balance ?? '0';
      walletsBalances.set(entry.idx, balance);
      tbody.appendChild(buildFpRow(entry.idx, entry.address, balance));
    });
    $('fp-status').textContent = `${json.length} wallets · ${new Date().toLocaleTimeString()}`;
    updateFundSelectedDisable();
  } catch (e) {
    $('fp-status').textContent = `failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`;
  }
}

function buildFpRow(idx, address, balanceWei) {
  const tr = document.createElement('tr');
  tr.dataset.idx = String(idx);

  const tdCheck = document.createElement('td');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.dataset.idx = String(idx);
  cb.addEventListener('change', updateFundSelectedDisable);
  tdCheck.appendChild(cb);

  const tdIdx = document.createElement('td');
  tdIdx.textContent = String(idx);

  const tdAddr = document.createElement('td');
  tdAddr.textContent = truncAddr(address);                    // T-11: textContent

  const tdPre = document.createElement('td');
  tdPre.textContent = fmtEth(balanceWei);
  tdPre.dataset.col = 'pre';

  const tdPost = document.createElement('td');
  tdPost.textContent = '—';
  tdPost.dataset.col = 'post';

  const tdAction = document.createElement('td');
  tdAction.textContent = '—';
  tdAction.dataset.col = 'action';

  tr.appendChild(tdCheck);
  tr.appendChild(tdIdx);
  tr.appendChild(tdAddr);
  tr.appendChild(tdPre);
  tr.appendChild(tdPost);
  tr.appendChild(tdAction);
  return tr;
}

function getSelectedTargetIndices() {
  const out = [];
  $('fp-tbody').querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => {
    const i = parseInt(cb.dataset.idx, 10);
    if (Number.isInteger(i)) out.push(i);
  });
  return out;
}

function updateFundSelectedDisable() {
  const selected = getSelectedTargetIndices();
  $('fp-fund-selected').disabled = selected.length === 0 || fpInProgressRequestId !== null;
  $('fp-fund-all').disabled       = fpInProgressRequestId !== null;
}

function toggleSelectAll(e) {
  const checked = e.target.checked;
  $('fp-tbody').querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = checked; });
  updateFundSelectedDisable();
}

async function fundClick(targetIndices) {
  if (fpInProgressRequestId !== null) return;
  try {
    // Reset post + action columns for the targeted rows; show PENDING pill
    const targets = targetIndices ?? Array.from({ length: 25 }, (_, i) => i);
    targets.forEach((idx) => {
      const tr = $('fp-tbody').querySelector(`tr[data-idx="${idx}"]`);
      if (!tr) return;
      tr.classList.add('fp-row-pending');
      const tdAction = tr.querySelector('td[data-col="action"]');
      if (tdAction) {
        tdAction.textContent = '';
        const pill = document.createElement('span');
        pill.className = 'status-pill status-pill-pending';
        pill.textContent = 'PENDING';
        tdAction.appendChild(pill);
      }
    });
    const body = targetIndices ? { targetIndices } : {};
    const { json } = await ctrl('/control/fund-players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    fpInProgressRequestId = json?.request_id ?? null;
    $('fp-status').textContent =
      `fund in progress · request_id=${fpInProgressRequestId ? fpInProgressRequestId.slice(0, 8) : '?'}...`;
    updateFundSelectedDisable();
  } catch (e) {
    $('fp-status').textContent = `fund failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`;
  }
}

function onFundProgress(data) {
  // D-04b LOCKED — request_id correlation; ignore stale / cross-session events
  if (data.request_id !== fpInProgressRequestId) return;
  const tr = $('fp-tbody').querySelector(`tr[data-idx="${data.idx}"]`);
  if (!tr) return;
  tr.classList.remove('fp-row-pending');
  const tdPre    = tr.querySelector('td[data-col="pre"]');
  const tdPost   = tr.querySelector('td[data-col="post"]');
  const tdAction = tr.querySelector('td[data-col="action"]');
  if (tdPre)  tdPre.textContent  = fmtEth(data.pre);          // T-11: textContent only
  if (tdPost) tdPost.textContent = fmtEth(data.post);
  if (tdAction) {
    tdAction.textContent = '';
    const pill = document.createElement('span');
    const variant = String(data.action ?? 'pending').toLowerCase();
    pill.className = `status-pill status-pill-${variant}`;
    pill.textContent = String(data.action ?? '?');            // T-11: textContent
    tdAction.appendChild(pill);
  }
}

function onFundComplete(data) {
  if (data.request_id !== fpInProgressRequestId) return;
  $('fp-status').textContent =
    `fund complete · ${data.totalRows} rows · ${new Date().toLocaleTimeString()}`;
  fpInProgressRequestId = null;
  updateFundSelectedDisable();
}

function onFundError(data) {
  if (data.request_id !== fpInProgressRequestId) return;
  $('fp-status').textContent = `fund error: ${String(data.error ?? 'unknown').slice(0, 200)}`;
  fpInProgressRequestId = null;
  updateFundSelectedDisable();
}

// --- Boot ------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  // initSse() MUST run before initFundPlayers() — the fund-players panel
  // attaches fund-progress / fund-complete / fund-error listeners against
  // the module-level `es` handle assigned inside initSse(). If initFundPlayers
  // ran first, `es` would still be null and those listeners would silently
  // never attach, breaking row-level progress updates.
  initSse();
  initStateControls();
  initDayAdvance();
  initStatus();
  initActionLog();
  initForceAction();
  initFundPlayers();
  console.log('[control] initialized', {
    CONTROL_BASE, API_BASE, CHAIN_ID, LOG_BUFFER_SIZE,
  });
});
