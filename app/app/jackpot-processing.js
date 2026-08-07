// /app/app/jackpot-processing.js — determinate progress for the JACKPOT
// PROCESSING button (replay-panel.js `[data-bind="reveal-btn"]`).
//
// The button used to carry a single indefinite pulse: identical at 0% and 95%,
// so a player waiting out a slow indexer handoff had no way to tell a healthy
// wait from a stuck one. The exact-day handoff passes through three observable
// milestones on its way to a spinnable board, and `#hasExactDayRolls` in
// replay-panel.js gates on exactly these:
//
//   draw   — the day's RNG row carries finalWord + main/bonus packed traits
//   rolls  — roll-1 AND roll-2 winner rows are loaded for the selected day
//   sealed — `data-day-warming` cleared, i.e. PrizePoolDailySnapshot sealed the
//            day. Until then even a non-empty winner array can be incomplete,
//            because DailyWinningTraits is emitted before the remaining rows in
//            the same block.
//
// ROLL-1 AND ROLL-2 ARE ONE MILESTONE, NOT TWO. `#loadDayRolls` issues them as a
// single `Promise.allSettled` pair and its caller assigns `#dayRoll1` and
// `#dayRoll2` back to back in one synchronous block, so they are never observable
// independently. Splitting them would add a step the bar could never sit on.
// (A partial endpoint failure leaves one null, but that is a failed load which
// refetches both, not an ordering.)
//
// Progress is nevertheless a COUNT of completed milestones rather than an index,
// because `sealed` is NOT ordered against the other two: it is an attribute
// owned by last-day-jackpot.js, so a day that was never marked warming reads
// sealed from the first frame while the draw is still being fetched. An index
// would misreport that as "waiting on the seal".
//
// Nothing here is time-derived: the bar moves only when something real finished.

/** Milestones in the order a player would narrate them, for labelling only. */
export const JACKPOT_PROCESSING_MILESTONES = ['draw', 'rolls', 'sealed'];

/** What the panel is still waiting on, keyed by the first incomplete milestone. */
const STAGE_LABELS = {
  draw: 'Waiting for the draw',
  rolls: 'Reading the rolls',
  sealed: 'Sealing the day',
  ready: 'Ready',
};

/**
 * Determinate stage for the processing button.
 *
 * @param {{draw?: boolean, rolls?: boolean, sealed?: boolean}} milestones
 * @returns {{done: number, total: number, progress: number, key: string, label: string}}
 *   `progress` is 0..1 for the CSS fill; `key` is the milestone still pending
 *   ('ready' when all four are in); `label` is human-facing text for title/aria.
 */
export function jackpotProcessingStage(milestones = {}) {
  const flags = JACKPOT_PROCESSING_MILESTONES.map((name) => milestones?.[name] === true);
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
