// /app/app/jackpot-processing.js — determinate progress for the JACKPOT
// PROCESSING button (replay-panel.js `[data-bind="reveal-btn"]`).
//
// The button used to carry a single indefinite pulse. The live handoff now
// narrates the same order as advanceGame: Chainlink word, Coinflip settlement,
// queued ticket materialization, jackpot settlement, then the three indexed
// records needed to build the player's spin board.
//
// ROLL-1 AND ROLL-2 ARE ONE MILESTONE, NOT TWO. `#loadDayRolls` issues them as a
// single `Promise.allSettled` pair and its caller assigns `#dayRoll1` and
// `#dayRoll2` back to back in one synchronous block, so they are never observable
// independently. Splitting them would add a step the bar could never sit on.
// (A partial endpoint failure leaves one null, but that is a failed load which
// refetches both, not an ordering.)
//
// The source milestones are real state, not a cosmetic percentage. Browsers can
// observe several atomic contract stages in one poll, though, so the presentation
// helper lets the control briefly walk through completed beats instead of jumping
// from Chainlink straight to Spin. It never advances ahead of confirmed state.

/** Milestones in the order a player would narrate them, for labelling only. */
export const JACKPOT_PROCESSING_MILESTONES = [
  'rng',
  'coinflip',
  'packs',
  'jackpot',
  'draw',
  'rolls',
  'sealed',
];

/** What the panel is still waiting on, keyed by the first incomplete milestone. */
const STAGE_LABELS = {
  rng: 'RNG INCOMING',
  'rng-arrived': 'RNG ARRIVED',
  coinflip: 'COINFLIP PROCESSING',
  packs: 'DELIVERING PACKS',
  jackpot: 'JACKPOT PROCESSING',
  draw: 'PREPARING SPIN',
  rolls: 'PREPARING SPIN',
  sealed: 'PREPARING SPIN',
  ready: 'SPIN READY',
};

function _positiveDay(value) {
  const day = Number(value);
  return Number.isInteger(day) && day > 0 ? day : null;
}

function _positiveWord(value) {
  try { return BigInt(value ?? 0) > 0n; }
  catch { return false; }
}

/**
 * Exact live contract/indexer signals for the player-facing pipeline.
 * `jackpotReady` implies every earlier contract phase even when a 15-second
 * `/game/state` sample skipped over one of them.
 */
export function dailyJackpotProcessingSignals({
  day = null,
  daySync = null,
  gameState = null,
  jackpotPayload = null,
} = {}) {
  const target = _positiveDay(day);
  const syncExact = target != null && _positiveDay(daySync?.day) === target;
  const gameExact = target != null
    && _positiveDay(gameState?.dailyRng?.day ?? gameState?.currentDay) === target;
  const payloadExact = target != null
    && _positiveDay(jackpotPayload?.day) === target
    && (jackpotPayload?.status === 'resolved'
      || jackpotPayload?.status === 'resolved-no-winners');
  // The resolved payload is itself the exact indexed jackpot lane. Accept it
  // directly as a fallback in case the day-sync reducer has not consumed the
  // same store update yet.
  const jackpotReady = Boolean(
    payloadExact || (syncExact && daySync?.jackpotReady === true),
  );
  const coinflipReady = Boolean(
    jackpotReady || (syncExact && daySync?.coinflipReady === true),
  );
  // The direct contract watcher sees the request lock rise and fall on its
  // 1.5-second processing cadence. Once that exact-day request has been seen,
  // an unlocked sample is authoritative evidence that the Chainlink word was
  // applied. Use it immediately instead of leaving the control on RNG INCOMING
  // until the slower /game/state or indexer sample catches up.
  const rngApplied = Boolean(
    syncExact
    && daySync?.rngRequested === true
    && daySync?.rngLocked === false
  );
  // The authoritative witness: day-rollover.js reads `isRngFulfilled()` off the
  // GAME contract in its existing pinned snapshot, so this is true in the same
  // block the VRF callback assigns the word. Every other witness here is an
  // inference from a lock edge or a lagging indexed/`/game/state` sample, which
  // is exactly the lag a player notices while staring at the machine.
  const rngFulfilled = Boolean(syncExact && daySync?.rngFulfilled === true);
  const rngReady = Boolean(
    coinflipReady
    || jackpotReady
    || rngFulfilled
    || rngApplied
    || (gameExact && _positiveWord(gameState?.dailyRng?.finalWord)),
  );
  const ticketsReady = Boolean(
    jackpotReady
    || (coinflipReady && (
      rngApplied
      || (gameExact && gameState?.ticketsFullyProcessed === true)
    )),
  );
  return {
    day: target,
    // The direct day boundary is also the balance-spoiler boundary. Keep the
    // jackpot board and its progress rail on that exact same clock instead of
    // leaving yesterday's result mounted until the later RNG-request poll.
    active: syncExact,
    requested: Boolean(syncExact && (
      daySync?.rngRequested === true
      || daySync?.rngLocked === true
      || coinflipReady
      || jackpotReady
    )),
    rngReady,
    // Exposed separately from `rngReady` because it is the only witness here
    // that is a direct contract read. The LCD key uses it to decide whether the
    // crank has a word waiting to be ground, which the inferred witnesses
    // cannot answer promptly enough to be worth acting on.
    rngFulfilled,
    coinflipReady,
    ticketsReady,
    jackpotReady,
  };
}

/**
 * Is the Chainlink word in for this day?
 *
 * THREE independent witnesses. `live.rngFulfilled` is the authoritative one: a
 * direct `isRngFulfilled()` read off the GAME contract, true in the same block
 * the VRF callback assigns `rngWordCurrent`. The other two are inferences from
 * feeds that lag it, and are kept because that contract read is positive-only
 * — the advance pipeline zeroes the word once it drains it, so a `false` from
 * the chain is not evidence of anything and a day whose word has already been
 * consumed still needs the durable indexed witness below.
 *
 * Two inferred witnesses, because the live one has a blind spot. Live
 * `rngReady` leans on `rngApplied`, which needs the watcher to have seen the
 * request lock rise and then fall, and `reconcileDaySync` only ever latches
 * `rngRequested` off that lock, an indexed jackpot, or a resolved coinflip. In
 * the window after the word is applied but before the coinflip resolves — the
 * exact window where the keeper crank lights up, because applying the word is
 * what gives it an advance to do — all three are false on a cold load, and the
 * instrument sat on RNG INCOMING with the randomness already in.
 *
 * The indexed DailyRng row is durable proof of the same fact and answers a
 * cold load correctly: a positive final word cannot un-happen. Either witness
 * is sufficient; neither one present means NOT ready, so a missing feed keeps
 * the instrument reporting progress instead of falsely closing the ring.
 *
 * @param {{live: object|null, hasIndexedFinalWord: boolean}} input
 * @returns {boolean}
 */
export function rngMilestoneSatisfied({ live = null, hasIndexedFinalWord = false } = {}) {
  // No live pipeline feed at all is a historical/non-app load, whose contract
  // work is complete by definition; those begin at the board-fetch phase.
  if (!live) return true;
  return live.rngFulfilled === true
    || live.rngReady === true
    || hasIndexedFinalWord === true;
}

/**
 * Determinate stage for the processing button.
 *
 * @param {Record<string, boolean>} milestones
 * @returns {{done: number, total: number, progress: number, key: string, label: string}}
 *   `progress` is 0..1 for the CSS fill; `key` is the milestone still pending
 *   ('ready' when all four are in); `label` is human-facing text for title/aria.
 */
export function jackpotProcessingStage(milestones = {}) {
  // Enforce the contract order even when independently-polled sources arrive
  // out of order. A sealed endpoint cannot visually complete a step before RNG.
  let priorComplete = true;
  const flags = JACKPOT_PROCESSING_MILESTONES.map((name) => {
    priorComplete = priorComplete && milestones?.[name] === true;
    return priorComplete;
  });
  const total = JACKPOT_PROCESSING_MILESTONES.length;
  const done = flags.filter(Boolean).length;
  const pendingIndex = flags.indexOf(false);
  const key = pendingIndex === -1 ? 'ready' : JACKPOT_PROCESSING_MILESTONES[pendingIndex];
  return {
    done,
    total,
    progress: done / total,
    key,
    label: STAGE_LABELS[key] ?? STAGE_LABELS.ready,
  };
}

function _stageAtDone(done) {
  const completed = Math.max(0, Math.min(
    JACKPOT_PROCESSING_MILESTONES.length,
    Math.trunc(Number(done) || 0),
  ));
  return jackpotProcessingStage(Object.fromEntries(
    JACKPOT_PROCESSING_MILESTONES.map((name, index) => [name, index < completed]),
  ));
}

/**
 * Keep the progress label and the button's actual clickability on one gate.
 * A source fetch can remain marked loading for a final microtask after all
 * seven visual milestones complete; never expose a disabled SPIN READY state.
 */
export function jackpotSpinControlState({
  sourceProcessing = false,
  presentationPending = false,
  presentationArmed = false,
  stage = null,
  dayReady = false,
} = {}) {
  const current = stage && typeof stage === 'object' ? stage : null;
  const ready = current?.key === 'ready' && dayReady === true;
  const pipelineBusy = Boolean(
    sourceProcessing
    || presentationPending
    || (presentationArmed && current?.key !== 'ready'),
  );
  return {
    ready,
    processing: pipelineBusy && !ready,
    // If raw milestones beat the final exact-day latch, keep describing the
    // remaining work truthfully instead of presenting a dead ready control.
    stage: !ready && current?.key === 'ready'
      ? _stageAtDone(JACKPOT_PROCESSING_MILESTONES.length - 1)
      : current,
  };
}

/**
 * Advance the visible phase by at most one confirmed beat.
 *
 * A single block commonly supplies the RNG and Coinflip result together. The
 * transient RNG ARRIVED beat and short chase keep that real order legible. The
 * returned stage never exceeds `target.done`, so this cannot fake progress.
 */
export function jackpotProcessingPresentationStep({
  target = jackpotProcessingStage(),
  state = null,
  day = null,
  now = Date.now(),
} = {}) {
  const targetDay = _positiveDay(day);
  const targetDone = Math.max(0, Math.min(
    JACKPOT_PROCESSING_MILESTONES.length,
    Math.trunc(Number(target?.done) || 0),
  ));
  let next = state && state.day === targetDay
    ? { ...state }
    : { day: targetDay, done: 0, rngArrivedShown: false, mode: null, holdUntil: 0 };
  next.done = Math.min(Math.max(0, Math.trunc(Number(next.done) || 0)), targetDone);
  const clock = Number.isFinite(Number(now)) ? Number(now) : Date.now();

  // Once all seven real inputs and the exact-day board are ready, cosmetic
  // narration must not hold a disabled LCD over a playable spin. Collapse any
  // remaining catch-up beats immediately; the animation is only useful while
  // genuine work or data is still outstanding.
  if (targetDone === JACKPOT_PROCESSING_MILESTONES.length && target?.key === 'ready') {
    next = {
      ...next,
      done: targetDone,
      rngArrivedShown: true,
      mode: null,
      holdUntil: 0,
    };
    return { stage: target, state: next, pending: false, delay: 0 };
  }

  if (Number(next.holdUntil) > clock) {
    const arrived = next.mode === 'rng-arrived';
    return {
      stage: arrived
        ? {
            ..._stageAtDone(0),
            key: 'rng-arrived',
            label: STAGE_LABELS['rng-arrived'],
            progress: 0.5 / JACKPOT_PROCESSING_MILESTONES.length,
          }
        : _stageAtDone(next.done),
      state: next,
      pending: arrived || next.done < targetDone,
      delay: Math.max(1, Math.ceil(Number(next.holdUntil) - clock)),
    };
  }

  if (next.mode === 'rng-arrived') next.mode = null;
  if (targetDone > 0 && next.done === 0 && next.rngArrivedShown !== true) {
    next = {
      ...next,
      rngArrivedShown: true,
      mode: 'rng-arrived',
      holdUntil: clock + 900,
    };
    return {
      stage: {
        ..._stageAtDone(0),
        key: 'rng-arrived',
        label: STAGE_LABELS['rng-arrived'],
        progress: 0.5 / JACKPOT_PROCESSING_MILESTONES.length,
      },
      state: next,
      pending: true,
      delay: 900,
    };
  }

  if (next.done < targetDone) {
    next.done += 1;
    const pending = next.done < targetDone;
    next.holdUntil = pending ? clock + 650 : 0;
    return {
      stage: _stageAtDone(next.done),
      state: next,
      pending,
      delay: pending ? 650 : 0,
    };
  }

  next.holdUntil = 0;
  return { stage: target, state: next, pending: false, delay: 0 };
}

/**
 * Monotonic wrapper. A refetch can momentarily drop a milestone that was
 * already satisfied (the rolls are re-requested on retry), and a bar that
 * slides backwards reads as breakage rather than progress. Latch the highest
 * count seen for a given day and reset the moment the day changes.
 *
 * @param {{day: number|null, milestones: object, latch: {day: number|null, done: number}}} input
 * @returns {{stage: object, latch: {day: number|null, done: number}}} the stage
 *   to render plus the latch to carry into the next call.
 */
export function latchedJackpotProcessingStage({ day = null, milestones = {}, latch = null } = {}) {
  const target = Number.isInteger(Number(day)) && Number(day) > 0 ? Number(day) : null;
  const sameDay = latch != null && latch.day === target && target != null;
  const raw = jackpotProcessingStage(milestones);
  const floor = sameDay ? Number(latch.done) || 0 : 0;
  if (raw.done >= floor) {
    return { stage: raw, latch: { day: target, done: raw.done } };
  }
  // Held above the live reading: keep the bar where it was, but report the
  // milestone the panel is genuinely re-fetching so the label stays truthful.
  const held = jackpotProcessingStage(
    Object.fromEntries(JACKPOT_PROCESSING_MILESTONES.map((name, i) => [name, i < floor])),
  );
  return { stage: { ...held, key: raw.key, label: raw.label }, latch: { day: target, done: floor } };
}
