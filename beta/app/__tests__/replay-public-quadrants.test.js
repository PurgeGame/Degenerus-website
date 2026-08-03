import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync(
  new URL('../../components/replay-panel.js', import.meta.url),
  'utf8',
);
const css = readFileSync(
  new URL('../../styles/replay.css', import.meta.url),
  'utf8',
);
const appCss = readFileSync(
  new URL('../../../app/styles/app.css', import.meta.url),
  'utf8',
);

test('main-draw quadrants are always scratchable and only impossible wins use the red cover', () => {
  assert.match(panel, /const scratchable = true/);
  assert.match(panel, /const NO_WIN_COVER_FILL = 'rgb\(218, 104, 104\)'/);
  assert.match(panel, /publicResult && !ownsDisplayedTrait[\s\S]*?\? NO_WIN_COVER_FILL/);
  assert.match(panel, /q-owned-miss/);
  assert.match(panel, /q-win-impossible/);
});

test('the bonus roll waits for scratching unless the whole personal board is red', () => {
  assert.match(panel, /#mainScratchComplete = false/);
  assert.match(panel, /#mainAllRed = false/);
  assert.match(panel, /#mainReadyForBonus\(\)[\s\S]*?return this\.#mainScratchComplete \|\| this\.#mainAllRed/);
  assert.match(panel, /btn\.disabled = !this\.#mainReadyForBonus\(\)/);
  assert.match(panel, /if \(!this\.#hasBonus[\s\S]*?\|\| !this\.#mainReadyForBonus\(\)[\s\S]*?\|\| this\.#bonusPhase[\s\S]*?\|\| this\.#bonusScratchComplete\) return/);
  assert.match(panel, /if \(!this\.#bonusPhase\) \{[\s\S]*?this\.#mainScratchComplete = true/);
  assert.match(panel, /this\.#mainAllRed = this\.#quadOwned\.every\(\(owned\) => !owned\)[\s\S]*?this\.#centerWins\.length === 0/);
  assert.match(panel, /Scratch the main draw first/);
});

test('the center flame switches between fully revealed main and bonus boards', () => {
  assert.match(panel, /#bonusScratchComplete = false/);
  assert.match(panel, /void this\.#toggleRevealedDraw\(\)/,
    'the existing center click owns the post-reveal switch');
  assert.match(
    panel,
    /#toggleRevealedDraw\(\)[\s\S]*?const showBonus = !this\.#bonusPhase[\s\S]*?#distributePrizesFromRoll1\(\)[\s\S]*?#runSpin\(this\.#displayTraitsForRoll\(showBonus\), \{[\s\S]*?instant: true,[\s\S]*?announce: false/,
    'switching reconstructs either authoritative board instantly without replay events',
  );
  assert.match(panel, /#displayTraitsForRoll\(bonus\)/,
    'both views reuse the same packed-trait decoder as their original reveal');
  assert.match(panel, /replay-ticket-center--draw-toggle/);
  assert.equal(
    (panel.match(/canvas\.style\.transition = instant \? 'none' : 'opacity 0\.35s ease'/g) || []).length,
    2,
    'instant main/bonus switching disables both cover fades so the front cannot flash',
  );
  assert.match(css, /\.replay-ticket-center\.replay-ticket-center--draw-toggle::before/,
    'the flame gains a compact visual affordance only after both boards are ready');
});

test('wins and could-win misses share a blue front; only the revealed win is green', () => {
  assert.match(panel, /const POSSIBLE_WIN_COVER_FILL = '#b8d4e8'/);
  assert.match(panel, /hasPlayerWin[\s\S]*?\? POSSIBLE_WIN_COVER_FILL/);
  assert.match(panel, /const canonicalGold = !this\.#bonusPhase && isGoldTrait\(canonicalTraitId\)/);
  assert.match(panel, /canonicalGold \? GOLD_TRAIT_COVER_FILL : POSSIBLE_WIN_COVER_FILL/);
  assert.match(panel, /ctx\.fillStyle = fillColor \|\| POSSIBLE_WIN_COVER_FILL/,
    'wins and owned misses use the same non-spoiling blue scratch front');
  assert.match(panel, /q-player-win/);
  assert.match(css, /\.replay-tq\.q-player-win\s*\{[\s\S]*?rgba\(22, 163, 74/);
  assert.match(css, /\.replay-tq\.q-owned-miss\s*\{[\s\S]*?rgba\(239, 120, 120, 0\.5\)/,
    'scratching an owned miss reveals the pink losing surface');
});

test('a revealed player win restores its compact prize description without the winnings bar', () => {
  assert.match(panel, /#renderPlayerWinReveal\(qIdx, prize\)/);
  assert.match(panel, /replay-win-description/);
  assert.match(panel, /title\.textContent = 'YOU WON'/);
  for (const prize of ['ETH', 'FLIP', 'DGNRS', 'ticket', 'whale pass']) {
    assert.match(panel, new RegExp(prize, 'i'));
  }
  assert.match(css, /\.replay-win-description\s*\{/);
  assert.doesNotMatch(panel, /replay-prize-bar/);
});

test('ticket prizes convert four jackpot entries into one whole ticket', () => {
  assert.match(panel, /ticketEntries \+= Number\(win\.ticketTotal \|\| 0\)/);
  assert.match(panel, /const ticketCount = joScaledToTickets\(ticketEntries\)/,
    'the reveal uses the same entry-to-ticket conversion as Day Summary');
});

test('the result underneath stays grey until the reduced threshold or a real win badge is uncovered', () => {
  assert.match(panel, /const REVEAL_THRESHOLD = 0\.5/);
  assert.match(panel, /const KNOWN_LOSER_REVEAL_THRESHOLD = 0\.4/);
  assert.match(panel, /const knownLoser = canvas\.parentElement\?\.classList\?\.contains\('q-win-impossible'\)/);
  assert.match(panel, /const revealThreshold = knownLoser[\s\S]*?KNOWN_LOSER_REVEAL_THRESHOLD[\s\S]*?: REVEAL_THRESHOLD/);
  assert.match(panel, /if \(!\(publicResult && !ownsDisplayedTrait\)\)\s*\{\s*quads\[i\]\.classList\.add\('q-result-pending'\)/);
  assert.match(
    panel,
    /#greenRevealed\[qIdx\][\s\S]*?classList\.remove\('q-scratchable', 'q-result-pending'\)[\s\S]*?classList\.add\('q-result-revealed', 'q-has-tickets'\)/,
  );
  assert.match(panel, /gridCoverage\(this\.#scratchGrids\[qIdx\]\) >= revealThreshold/);
  assert.match(css, /\.replay-tq\.q-result-pending\s*\{[^}]*background:\s*#bfc2c5/s);
  assert.match(css, /\.replay-tq\.q-result-revealed\.q-has-tickets\s*\{[\s\S]*?rgba\(22, 163, 74/);
  assert.match(css, /\.replay-tq\.q-result-revealed\.q-no-tickets\s*\{[\s\S]*?rgba\(239, 120, 120/);
});

test('an unwinnable quadrant locks dark and scratches through to lighter loser paper', () => {
  assert.match(panel, /publicResult && !ownsDisplayedTrait[\s\S]*?q-win-impossible/);
  assert.match(css, /\.replay-tq\.q-win-impossible-lock\s*\{[^}]*background:\s*rgb\(218, 104, 104\)/s,
    'the lock and scratch cover use the darker pink');
  assert.match(css, /\.replay-tq\.q-win-impossible\s*\{[^}]*background:\s*rgba\(239, 120, 120, 0\.5\)/s,
    'scratching exposes the lighter pink loser paper');
  assert.match(css, /\.replay-tq\.q-win-impossible\s*\{[^}]*transition:\s*background-color 0\.22s ease/s,
    'the revealed paper still eases into its final color');
});

test('guaranteed losses assume their final face as each quadrant locks, then settle before scratch mounts', () => {
  assert.match(
    panel,
    /if \(lockedSymbols\[i\] && lockedColors\[i\]\)[\s\S]*?if \(!this\.#quadOwned\[i\]\)[\s\S]*?classList\.add\('q-win-impossible-lock'\)/,
    'each fully locked unowned quadrant commits its final red state in either roll',
  );
  assert.match(panel, /const FINAL_LOCK_SETTLE_MS = 260/);
  assert.match(panel, /finalLockSettling = true;[\s\S]*?setTimeout\(step, FINAL_LOCK_SETTLE_MS\)/,
    'the completed reel holds for a paint beat before mounting the scratch layer');
});

test('bonus lock colors use future holdings as well as authoritative wins', () => {
  assert.match(
    panel,
    /const hasPlayerWin = contractQ >= 0 && this\.#bonusQuadrants\.has\(contractQ\)[\s\S]*?this\.#futureTraitIds\.has\(displayTraits\[i\]\)/,
  );
});

test('idle and active pre-spin colors follow the displayed trait in the current ticket holdings', () => {
  const idle = panel.match(/#startIdleSpin\(\)\s*\{([\s\S]*?)\n  #stopIdleSpin\(\)/)?.[1] || '';
  assert.match(idle, /const shownTrait = contractQ \* 64 \+ col \* 8 \+ sym/);
  assert.match(idle, /const ownsShown = this\.#playerTraitIds\.has\(shownTrait\)/);
  assert.match(idle, /ownsShown \? 'q-has-trait' : 'q-no-tickets'/,
    'the quiet pre-spin uses blue for a held displayed trait and pink otherwise');
  assert.match(
    panel,
    /const spinOwned = this\.#bonusPhase \? this\.#futureTraitIds : this\.#playerTraitIds[\s\S]*?const shownTrait = contractQ \* 64 \+ col \* 8 \+ sym[\s\S]*?spinOwned\.has\(shownTrait\)/,
    'the reveal spin uses the level-appropriate holdings against every rolling frame',
  );
});

test('an owned displayed gold trait turns the quadrant and whole ticket gold', () => {
  assert.match(panel, /const GOLD_TRAIT_COVER_FILL = 'rgb\(212, 175, 55\)'/);
  assert.match(panel, /!this\.#bonusPhase && ownsShown && col === 7/);
  assert.match(panel, /const ownsDisplayedGold = !this\.#bonusPhase[\s\S]*?isGoldTrait\(displayTraits\[i\]\)/,
    'gold possible-win treatment is exclusive to the main jackpot');
  assert.match(panel, /replay-ticket--has-owned-gold/);
  assert.match(css, /\.replay-tq\.q-gold-trait\s*\{[\s\S]*?linear-gradient/);
  assert.match(css, /\.replay-ticket\.replay-ticket--has-owned-gold\s*\{[\s\S]*?border-color:\s*#d4af37/);
});

test('non-player wins reveal the public currency and ticket awards', () => {
  assert.match(panel, /#renderPublicBucketReveal\(i, publicResult\)/);
  assert.match(panel, /replay-bucket-badge/);
  assert.match(panel, /replay-bucket-row-count--currency/);
  assert.match(panel, /replay-bucket-row-count--tickets/);
  assert.match(panel, /replay-bucket-tickets/);
  assert.match(panel, /joScaledToTickets\(ticketEntriesPerWinner\)/);
  assert.match(panel, /const hasTicketAward = ticketCountPerWinner !== 0/);
  assert.match(panel, /if \(hasTicketAward\) \{[\s\S]*?host\.appendChild\(tickets\)/,
    'the ticket-award row is omitted when its ticket count is zero');
  assert.match(panel, /const ticketAwardLabel = hasTicketAward/,
    'a hidden zero-ticket award is also omitted from the accessible label');
  assert.match(panel, /replay-bucket-ticket-icon/);
  assert.match(panel, /replay-bucket-ticket-badge/);
  assert.match(panel, /\[1, 74, 147, 228\]/,
    'the miniature ticket retains four varied real badges');
  assert.match(panel, /replay-bucket-ticket-flame/);
  assert.match(panel, /\/whitepaper\/flame-center\.svg/,
    'ticket awards use a miniature branded Degenerus ticket');
  assert.match(panel, /currencyWinners\.textContent = `×\$\{Number\.isFinite\(currencyWinnerCount\)/);
  assert.match(panel, /ticketWinners\.textContent = `×\$\{Number\.isFinite\(ticketWinnerCount\)/);
  assert.doesNotMatch(panel, /combinedWinnerCount|winnersLine/,
    'currency and ticket winner pools are never merged into a misleading footer');
  assert.match(
    panel,
    /host\.appendChild\(amount\)[\s\S]*?host\.appendChild\(tickets\)/,
    'public results keep one bare winner multiplier on each award row',
  );
  assert.match(panel, /\/whitepaper\/flame-logo-split\.svg/,
    'bonus public FLIP payouts use the split FLIP currency mark');
  assert.match(
    panel,
    /if \(currency === 'FLIP'\) \{[\s\S]*?amount\.appendChild\(currencyIcon\)[\s\S]*?amount\.appendChild\(num\)/,
    'the FLIP mark sits to the left of the bonus payout number',
  );
  assert.doesNotMatch(panel, /textContent = 'PER WIN'/,
    'the two award rows no longer repeat PER WIN');
  assert.match(css, /\.replay-bucket-badge\s*\{[\s\S]*?width:\s*48%/,
    'winning symbols are slightly larger on public loser reveals');
  assert.match(css, /\.replay-bucket-tickets\s*\{/);
  assert.match(css, /\.replay-bucket-tickets\s*\{[^}]*color:\s*#1f4f7a/s,
    'ticket award text uses its own blue accent instead of the currency color');
  assert.match(css, /\.replay-bucket-row-count--tickets\s*\{[^}]*rgba\(31, 79, 122, 0\.82\)/s,
    'the ticket winner multiplier shares the ticket accent');
  assert.match(css, /\.replay-bucket-ticket-icon\s*\{[^}]*width:\s*1\.72em[^}]*height:\s*1\.72em/s);
  assert.match(css, /\.replay-bucket-ticket-flame\s*\{/);
  assert.match(css, /\.replay-bucket-ticket-badge--q3\s*\{/);
  assert.match(css, /\.replay-bucket-reveal--q0\s*\{[^}]*padding:[^}]*14%/s,
    'public payout copy clears the center diamond without visibly hugging the outer corner');
  assert.doesNotMatch(
    css.match(/\.replay-bucket-tickets\s*\{[^}]*\}/s)?.[0] || '',
    /border-radius|background|border:/,
    'ticket awards are not wrapped in an oval pill',
  );
  assert.match(css, /\.replay-bucket-row-count\s*\{/);
  assert.match(css, /\.replay-bucket-amount\s*\{[^}]*font-size:\s*clamp\(0\.72rem,[^;]*1\.08rem\)/s,
    'loser reveal payout text is slightly larger');
  assert.match(css, /\.replay-bucket-eth\s*\{[^}]*height:\s*1\.26em/s,
    'loser reveal currency icon scales with the larger payout');
});

test('the level-zero opening draw reconstructs its missing FLIP-only main board', () => {
  assert.match(panel, /#isOpeningFlipDraw\(day\)/);
  assert.match(panel, /Number\(row\?\.level\) === 1[\s\S]*?=== 'P'/);
  assert.match(panel, /splitOpeningFlipDraw\(/);
  assert.match(panel, /level: 0, purchaseLevel: 1, wins: mainWins/);
  assert.match(panel, /this\.#openingFlipDay \? 'FLIP' : 'ETH'/);
  assert.match(panel, /this\.#dayRoll1\?\.purchaseLevel \?\? \(this\.#selectedLevel \+ 1\)/,
    'ticket ownership is loaded from the draw purchase level, not a modal payout level');
});

test('the obsolete aggregate winnings bar is gone', () => {
  assert.doesNotMatch(panel, /replay-prize-bar/);
  assert.doesNotMatch(css, /\.replay-prize-bar/);
});

test('a refresh restores a cleared draw instantly while an uncleared draw idles quietly', () => {
  assert.match(panel, /setPersistedRevealState\(cleared, allRollsCleared = false\)/,
    'the app shell can pass its persisted day/player reveal gate into the board');
  assert.match(panel, /#triggerReveal\(\{ instant: true, persisted: true \}\)/,
    'a cleared draw rebuilds the authoritative final state without replaying the animation');
  assert.match(panel, /#revealQuadrant\(i, \{ instant: true, silent: true \}\)/);
  assert.match(panel, /#revealCenter\(\{ instant: true, silent: true \}\)/);
  assert.match(
    panel,
    /#restoreCompletedDrawViews\(\)[\s\S]*?#bonusPhase = false[\s\S]*?#mainScratchComplete = true[\s\S]*?#bonusScratchComplete = true[\s\S]*?btn\.hidden = true[\s\S]*?#syncDrawToggleAffordance\(\)/,
    'a fully completed two-roll day reloads on main with bonus available only through the flame',
  );
  const idle = panel.match(/#startIdleSpin\(\)\s*\{([\s\S]*?)\n  #stopIdleSpin\(\)/)?.[1] || '';
  assert.match(idle, /setTimeout\(tick, 620\)/, 'uncleared draw uses the slow attract spin');
  assert.doesNotMatch(idle, /#sfx/, 'quiet attract spin never plays jackpot audio');
  assert.ok(
    idle.indexOf('this.#idleSpinTimer != null') < idle.indexOf('this.#stopIdleSpin()'),
    'an already-running attract reel is retained before any reset can blank it',
  );
  assert.match(
    idle,
    /#bonusPhase = false[\s\S]*?#mainScratchComplete = false[\s\S]*?#bonusScratchComplete = false[\s\S]*?#resetMainWidget\(\)[\s\S]*?const tick/,
    'the slow reel clears every prior bonus/scratch layer before its first random frame',
  );
  assert.match(
    panel,
    /this\.#selectedDay = dayNum[\s\S]*?this\.#resetCards\(\)[\s\S]*?this\.#hostRevealCleared === false[\s\S]*?this\.#startIdleSpin\(\)/,
    'a new-day selection starts the slow refresh spin before its API fan-out finishes',
  );
  assert.match(
    panel,
    /setPersistedRevealState\(cleared, allRollsCleared = false\)[\s\S]*?if \(!nextCleared && !this\.#spinning\) \{\s*this\.#startIdleSpin\(\)/,
    'jackpot-ready paint starts immediately instead of waiting on day/player indexing',
  );
  const persisted = panel.match(
    /setPersistedRevealState\(cleared, allRollsCleared = false\)\s*\{([\s\S]*?)\n  #selectionKey\(\)/,
  )?.[1] || '';
  assert.ok(
    persisted.indexOf('this.#hostRevealRequestKey === requestKey') >= 0
      && persisted.indexOf('this.#hostRevealRequestKey === requestKey')
        < persisted.indexOf('this.#startIdleSpin()'),
    'an unchanged same-day host poll is discarded before it can reset the jackpot face',
  );
  assert.ok(
    persisted.indexOf('this.#selectionKey() === this.#interactiveRevealKey')
      < persisted.indexOf('this.#startIdleSpin()'),
    'an active main/bonus scratch is protected before the eager idle reel can paint',
  );
});

test('same-day selector refreshes cannot blank an already rendered jackpot', () => {
  const dayHandler = panel.match(
    /async #onDayChange\(e\)\s*\{([\s\S]*?)\n  #onPlayerChange\(e\)/,
  )?.[1] || '';
  assert.match(dayHandler, /Number\(this\.#selectedDay\) === dayNum\) return/,
    're-selecting the logical day is idempotent');
  assert.ok(
    dayHandler.indexOf('Number(this.#selectedDay) === dayNum')
      < dayHandler.indexOf('this.#resetCards()'),
    'the same-day guard runs before the destructive card reset',
  );
  assert.match(
    dayHandler,
    /!validDay && this\.#singleButton\(\) && this\.#selectedDay != null/,
    'a transient empty hidden day selector retains the current app board',
  );

  const playerHandler = panel.match(
    /#onPlayerChange\(e\)\s*\{([\s\S]*?)\n  async #loadPlayerDecimator\(\)/,
  )?.[1] || '';
  assert.match(
    playerHandler,
    /nextPlayer\.toLowerCase\(\) === currentPlayer\.toLowerCase\(\)\)\) return/,
    're-selecting the logical player is idempotent',
  );
  assert.ok(
    playerHandler.indexOf('nextPlayer.toLowerCase() === currentPlayer.toLowerCase()')
      < playerHandler.indexOf('this.#resetCards()'),
    'the same-player guard runs before the destructive card reset',
  );
  assert.match(
    playerHandler,
    /nextPlayer == null && this\.#singleButton\(\) && currentPlayer != null/,
    'a transient empty hidden player selector retains the current app board',
  );
});

test('replay option refreshes retain their logical day and player selections', () => {
  assert.match(panel, /const previous = String\(select\?\.value \|\| this\.#selectedDay \|\| ''\)/,
    'day refresh falls back to the still-rendered logical selection');
  assert.match(panel, /matching\.dataset\.retainedSelection = 'true'/,
    'a transiently missing resolved day is retained in the selector');
  assert.match(panel, /if \(select && !hasUsableDay\)/,
    'a failed refresh cannot replace an already populated day list');
  assert.match(panel, /const previous = String\(this\.#selectedPlayer \|\| select\?\.value \|\| ''\)/,
    'ticket refresh preserves the viewed player before rebuilding options');
  assert.match(panel, /matching\.dataset\.zeroEntry = 'true'/,
    'zero-entry wallets stay selected through ticket-list refreshes');
});

test('scratchoff celebration is gated on an actual personal win', () => {
  assert.match(
    panel,
    /const anyWon = this\.#quadWinArrays\.some\([\s\S]*?\|\| this\.#centerWins\.length > 0;[\s\S]*?if \(!silent\) \{\s*if \(anyWon\) this\.#celebrate\(\);\s*this\.#dispatchScratchComplete\(\)/,
    'a fully scratched loss still completes the board but cannot launch confetti',
  );
});

test('active jackpot audio has a continuous musical reel pulse and bright outcome cues', () => {
  assert.match(panel, /let frameWinnableCount = 0/);
  assert.match(panel, /if \(ownsShown\) frameWinnableCount \+= 1/,
    'each actual painted frame counts the blue traits currently shown');
  assert.match(panel, /#sfxSpinFrame\(frameWinnableCount, frameHasGoldWinnable, locksDone\)/);
  assert.match(panel, /const reelPitches = \[330, 392, 494, 587, 740\]/,
    'zero through four blue quadrants map to distinct musical pitches');
  assert.match(panel, /const reelGains = \[0\.105, 0\.135, 0\.17, 0\.215, 0\.265\]/,
    'every frame is audible and ramps strongly with its blue count');
  assert.match(panel, /const arpRatios = \[1, 1\.125, 1\.25, 1\.5\]/,
    'lock progress walks a four-step arp instead of repeating one click');
  assert.match(panel, /frequency: root,[\s\S]*?type: 'triangle'[\s\S]*?duration: 0\.072/,
    'the primary reel voice survives nearly the complete fastest frame');
  assert.match(panel, /frequency: root \* 2,[\s\S]*?type: 'sine'/,
    'an upper bell layer keeps the reel present on phone speakers');
  assert.match(panel, /createDynamicsCompressor/,
    'the digital cues share a dry limiter instead of clipping');
  assert.doesNotMatch(panel, /#playSlotSample|decodeAudioData|jackpot-win\.mp3/,
    'active jackpot audio no longer depends on the disliked sample bank');
  assert.match(
    panel,
    /if \(lockedQuadrant != null\) \{[\s\S]*?this\.#sfxLock\([\s\S]*?\} else \{\s*this\.#sfxSpinFrame/,
    'a locking frame replaces the reel tick instead of playing two cues together',
  );
  assert.match(panel, /gold: !this\.#bonusPhase[\s\S]*?targets\[lockedQuadrant\]\.col === 7/,
    'gold lock treatment is exclusive to an owned main-jackpot gold trait');
  const lock = panel.match(/#sfxLock\(\{ winnable = false, gold = false \} = \{\}\)\s*\{([\s\S]*?)\n  #sfxAllLocked/)?.[1] || '';
  assert.match(lock, /if \(gold\)/);
  assert.match(lock, /else if \(winnable\)/);
  assert.match(lock, /else \{/,
    'gold, blue/winnable, and red/unwinnable each own a different lock branch');
  assert.match(lock, /\[1047, 1319, 1568, 2093\]/,
    'main-jackpot gold locks carry a bright four-note major rise');
  assert.match(lock, /frequency: 659[\s\S]*?frequency: 988/,
    'blue locks use a distinct two-note ding');
  assert.match(panel, /#sfxAllLocked\(anyOwned\)[\s\S]*?delay: 0\.2/,
    'the final confirmation waits for the last quadrant cue to clear');
  const fanfare = panel.match(/#sfxFanfare\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(fanfare, /\[1047, 1319, 1568, 2093\]/,
    'the final win resolves in a high C-major arpeggio');
  assert.match(fanfare, /\[2093, 2637, 3136\]/,
    'a short upper sparkle makes the win celebratory rather than ominous');
  assert.doesNotMatch(panel, /playSound\('win'\)/,
    'the jackpot no longer layers an unrelated placeholder MP3 over its payout');
});

test('scratching across each winning badge plays its own bright confirmation ding', () => {
  assert.match(
    panel,
    /this\.#badgesRevealed\[qIdx\]\.push\(ci\);\s*this\.#sfxGreenReveal\(\)/,
    'every newly uncovered paid badge owns a cue, not only the first badge in a quadrant',
  );
  const cue = panel.match(/#sfxGreenReveal\(\)\s*\{([\s\S]*?)\n  #sfxPinkReveal/)?.[1] || '';
  assert.match(cue, /center: 5800[\s\S]*?type: 'highpass'[\s\S]*?duration: 0\.014/,
    'a tiny high-frequency attack cuts through the scratch bed');
  assert.match(cue, /frequency: 1568[\s\S]*?type: 'triangle'/);
  assert.match(cue, /frequency: 2349[\s\S]*?type: 'square'[\s\S]*?delay: 0\.018/);
  assert.match(cue, /frequency: 3136[\s\S]*?delay: 0\.04/,
    'the paid badge gets a crisp arcade sparkle, not the old rounded water-drop sample');
  assert.doesNotMatch(cue, /playSlotSample|endFrequency/,
    'scratch wins contain neither the reused lock sample nor a droplet glide');
});

test('a potentially winning cover gets a slight distinct cue when it resolves pink', () => {
  assert.match(
    panel,
    /const wasPotentialWin = quad\.classList\.contains\('q-result-pending'\);[\s\S]*?if \(isWin\) this\.#sfxReveal\(true\);[\s\S]*?else if \(wasPotentialWin\) this\.#sfxPinkReveal\(\);[\s\S]*?else this\.#sfxReveal\(false\)/,
    'only a previously ambiguous blue/gold cover receives the pink-miss cue',
  );
  const cue = panel.match(/#sfxPinkReveal\(\)\s*\{([\s\S]*?)\n  #sfxReveal/)?.[1] || '';
  assert.match(cue, /center: 1650[\s\S]*?gain: 0\.025[\s\S]*?duration: 0\.018/,
    'the cue begins with a very small paper puff');
  assert.match(cue, /frequency: 523[\s\S]*?endFrequency: 392[\s\S]*?gain: 0\.07/);
  assert.match(cue, /frequency: 330[\s\S]*?endFrequency: 294[\s\S]*?gain: 0\.035/,
    'the soft falling pair stays quieter than paid-badge and lock cues');
});

test('scratch canvases paint the same enlarged badge scale as the visible quadrants', () => {
  assert.match(panel, /Math\.min\(canvas\.width, canvas\.height\) \* 1\.18/,
    'scratch covers no longer shrink their badge art back to the old size');
  assert.match(css, /\.replay-tq \.badge-img\s*\{[\s\S]*?object-position:\s*50% 50%[\s\S]*?flex:\s*0 0 auto/,
    'visible badge art keeps a square non-shrinking box centered in every quadrant');
});

test('the embedded jackpot reserves one compact action row below the raised ticket', () => {
  assert.match(appCss, /replay-panel \.replay-controls\s*\{[\s\S]*?min-height:\s*2\.5rem[\s\S]*?flex:\s*0 0 2\.5rem/);
  assert.match(appCss, /replay-panel \.replay-ticket\s*\{[\s\S]*?margin-top:\s*-0\.18rem[\s\S]*?margin-bottom:\s*0\.35rem/);
  assert.match(appCss, /replay-controls > \.replay-reveal-btn,[\s\S]*?replay-controls > \.ldj-results-cta[\s\S]*?width:\s*100%/);
  assert.match(appCss, /replay-panel \.replay-hint\s*\{[\s\S]*?height:\s*1\.2em[\s\S]*?flex:\s*0 0 1\.2em/,
    'changing scratch instructions retain a fixed status line');
  assert.match(appCss, /replay-panel\[single-button\] \.replay-bonus-section\[hidden\]\s*\{[\s\S]*?display:\s*flex !important[\s\S]*?visibility:\s*hidden/,
    'the no-bonus status keeps its reserved footprint while absent');
});
