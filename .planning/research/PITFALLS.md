# Domain Pitfalls

**Domain:** Animated on-chain game frontend (vanilla JS, no build step)
**Project:** Degenerus Protocol game UI rebuild
**Researched:** 2026-03-18

---

## Critical Pitfalls

Mistakes that cause rewrites, broken UX for paying users, or lost transactions.

---

### Pitfall 1: Monolith Extraction Creates Implicit Dependency Spaghetti

**What goes wrong:** The existing 4600-line `beta/index.html` has deeply interleaved state. The jackpot widget (IIFE starting at line 2258) references `window.Mint` for wallet state, mutates ~20 module-level variables (`jpData`, `jpScratched`, `jpQuadOwned`, `jpAnimId`, `jpAnimTarget`, `jpAnimArgs`...), and the degenerette panel (separate IIFE at line 3635+) has its own parallel state (`degenPending`, `degenResults`, `degenSpinning`) that also touches `window.Mint`. Extracting these into ES modules without mapping every shared variable first produces modules that silently break because they assumed access to closure-scoped state from the other IIFE.

**Why it happens:** The monolith works because everything shares one scope. When you split into modules, `var jpAudioCtx = null` in the jackpot IIFE becomes invisible to any other module. Developers extract file-by-file without building the dependency graph first, so the second or third module extracted starts failing in ways the first didn't.

**Consequences:** Modules import fine, load without errors, but features break at runtime because a function in module A calls a function that was in the same closure scope and is now in module B. Worse: the scratch card animation calls `jpSfxTick()` which references `jpAudioCtx` from the same IIFE closure. If audio and animation land in different modules, the audio context isn't shared.

**Prevention:**
1. Before extracting anything, inventory all module-level `var` declarations in each IIFE and draw the reference graph. The jackpot IIFE alone has ~25+ mutable variables.
2. Define an explicit state object per domain (e.g., `JackpotState`, `DegenState`, `WalletState`) and refactor the monolith to use these objects while still in single-file mode. Verify everything still works.
3. Only then split into files, with each module importing the state objects it needs.
4. Extract bottom-up: pure utility functions first (e.g., `jpBadgePath`, `jpWeightedBucket`, `cfFmtBurnie`), then state containers, then UI controllers. Never top-down.

**Detection:** Any module that uses a bare variable name not defined in its own scope or imports. Search each extracted file for variables that aren't declared, imported, or on `window`.

**Phase:** This is Phase 1 work. The entire rebuild depends on getting this right.

---

### Pitfall 2: ES Modules Without Build Step Require a Dev Server

**What goes wrong:** Developers open `index.html` from `file://` to test and get CORS errors on every `import` statement. ES modules enforce CORS even for same-origin local files. The `file://` protocol has no origin, so every module import fails.

**Why it happens:** Regular `<script>` tags don't enforce CORS. The existing beta works from `file://` because it uses `<script src="mint.js">` (classic script) and inline `<script>` blocks, not `import`/`export`. The one existing module import (`import { ethers } from 'https://esm.sh/ethers@6'`) works because it's a remote URL with CORS headers. Local ES module imports will not.

**Consequences:** Development is blocked until everyone sets up a local server. Not a rewrite-level problem, but it wastes time and confuses anyone used to the current "just open the HTML" workflow.

**Prevention:**
1. Document the dev server requirement in the repo README on day one. `python3 -m http.server 8080` or `npx serve .` in project root.
2. Consider import maps for third-party dependencies (ethers.js) instead of bare CDN imports, since import maps also require `type="module"` and thus the same CORS constraints.
3. Keep `mint.js` pattern: if a module needs to be accessible to non-module `<script>` blocks, it must attach to `window`. Don't half-migrate. Either a file is a module (uses import/export) or it's a classic script (attaches to window). Never both.

**Detection:** "Access to script from origin 'null' has been blocked by CORS policy" in console.

**Phase:** Phase 1. Must be established before any module extraction begins.

---

### Pitfall 3: Transaction Pending States That Lie

**What goes wrong:** Player clicks "Buy Tickets," sees a pending spinner. The MetaMask popup appears, they confirm, the tx submits. Then they close the tab. Or: the tx is pending in the mempool for 5 minutes because gas is low. Or: the tx reverts after confirmation. The UI shows "Confirmed!" based on `tx.wait()` returning a receipt, but the receipt has `status: 0` (reverted). The current `mint.js` doesn't check receipt status. Lines 756-757: `var receipt = await tx.wait(); setTxStatus('confirmed', 'Confirmed!', receipt.hash);` treats any receipt as success.

**Why it happens:** `tx.wait()` resolves when the transaction is mined, not when it succeeds. A reverted transaction is still mined. Developers check `receipt.hash` exists and assume success.

**Consequences:** Player thinks they bought tickets. They didn't. Their ETH was spent on gas but the purchase reverted. They don't realize until they check their balance or try to play and have no tickets. In a gambling context, this is the kind of bug that destroys trust permanently.

**Prevention:**
1. Always check `receipt.status === 1` after `tx.wait()`. If `status === 0`, show an explicit "Transaction reverted" error with the tx hash link so the user can investigate.
2. After any write transaction, re-fetch the affected state from the contract or API (balance, ticket count, etc.) to confirm the expected state change actually happened.
3. Persist pending transaction hashes to `localStorage`. On page load, check any pending tx hashes via `provider.getTransactionReceipt()`. If the page was closed mid-transaction, show the outcome when the user returns.
4. Set a timeout on `tx.wait()`. If the tx hasn't mined in 5 minutes, show "Transaction may be stuck" with a link to speed it up or cancel via MetaMask.

**Detection:** Test with a contract call that you know will revert (e.g., buying tickets on the wrong chain, or purchasing with insufficient ETH). Verify the UI shows an error, not a false confirmation.

**Phase:** Must be fixed in whichever phase implements the wallet transaction layer (Phase 1 or 2).

---

### Pitfall 4: VRF Pending States Can Last Minutes, Not Seconds

**What goes wrong:** Player places a Degenerette bet. The contract emits `BetPlaced` with an `rngIndex`. The UI starts polling `lootboxRngWord(rngIndex)` every 10 seconds (current code, line 4298). On mainnet, Chainlink VRF callback typically takes 1-3 blocks (~12-36 seconds). On Sepolia testnet, it can take minutes. Under load or when LINK balance is low, it can time out entirely (24 hours according to Chainlink docs). The UI shows "pending" with no progress indicator and no timeout handling.

**Why it happens:** VRF is a two-transaction process: your contract requests randomness (tx 1), then Chainlink's oracle calls back with the result (tx 2). There's no on-chain status between "requested" and "fulfilled." The frontend can only poll and wait.

**Consequences:** Player stares at a spinner for 30+ seconds with no feedback. They think the app is broken. They refresh, losing the pending bet context (though the current code stores pending bets in the `degenPending` array, this is in memory only, not persisted). After refresh, they have no way to know they have a pending bet, and no way to resolve it.

**Prevention:**
1. Persist pending VRF requests (bet IDs, rng indices, timestamps) to `localStorage`. On page load, resume polling for any unresolved requests.
2. Show a multi-stage progress indicator: "Bet submitted" -> "Waiting for randomness (this can take 30-60 seconds)" -> "Randomness received, resolving..." with actual elapsed time shown.
3. After 2 minutes of waiting, show a non-alarming message: "Chainlink VRF is taking longer than usual. Your bet is safe on-chain. You can close this page and return later."
4. Implement a "My Pending Bets" panel that survives page reload and shows all bets awaiting VRF.
5. Use exponential backoff for polling: start at 3s, increase to 5s, 10s, then cap at 15s. Don't poll at a fixed 10s forever.

**Detection:** Test on Sepolia where VRF delays are common. Place a bet and close/reopen the tab before VRF resolves.

**Phase:** Phase 2 or 3 (whenever Degenerette integration is built). But the localStorage persistence pattern should be established in Phase 1.

---

### Pitfall 5: API-vs-Contract State Desynchronization

**What goes wrong:** The architecture reads game state from the PostgreSQL database API (indexed blockchain data) but writes via direct contract calls. After a player buys tickets, the contract state updates immediately, but the database indexer has latency (typically 1-15 seconds, could be minutes if the indexer is down or catching up). The UI fetches the updated state from the API and shows the old ticket count.

**Why it happens:** The database API is a derived data source. It's eventually consistent with the blockchain, not immediately consistent. The frontend treats it as a source of truth for reads, but the source of truth for writes is the contract. These two sources diverge for seconds to minutes after every write.

**Consequences:** Player buys tickets, the transaction confirms, but their ticket count doesn't update. They click "Buy" again (double-purchase). Or they see an old jackpot result because the indexer hasn't caught up. In the worst case, the indexer falls behind by many blocks and the entire UI shows stale data for all users.

**Prevention:**
1. After any write transaction, apply an **optimistic update** to local state: immediately update the UI to reflect the expected outcome (e.g., ticket count +N) without waiting for the API to catch up.
2. Set a "dirty" flag on optimistic data. After 5-15 seconds, fetch the authoritative state from the API. If it matches, clear the dirty flag. If it doesn't match, show a subtle "syncing..." indicator and keep polling.
3. For critical reads (claimable balance, current level, active bets), add a fallback to read directly from the contract if the API data is suspected stale. The current `Mint.getClaimable()` already does this by calling the contract directly.
4. Display the indexer's last synced block number somewhere (admin/debug view). If it's more than 10 blocks behind, show a global "Data may be delayed" banner.
5. Never disable action buttons based solely on API data. A player who "has no tickets" according to a stale API might actually have them on-chain.

**Detection:** Buy tickets, then immediately check the API response. If the ticket count hasn't updated, the desync window is visible. Test with the indexer stopped entirely to see worst-case behavior.

**Phase:** Phase 2 (API integration phase). The optimistic update pattern should be designed during Phase 1 module extraction so the state containers support it.

---

### Pitfall 6: Canvas Scratch Card Breaks on High-DPI Mobile

**What goes wrong:** The existing scratch card uses `devicePixelRatio` correctly for canvas sizing (lines 2738-2744), but touch coordinate transformation is fragile. The `jpGetCanvasPos` function (line 2950) uses `getBoundingClientRect()` and scales by the canvas's internal resolution vs. CSS size. On devices where the viewport meta tag has `initial-scale != 1.0`, or when the page is zoomed, or inside MetaMask's mobile in-app browser (which has its own viewport quirks), the touch coordinates don't line up with the canvas pixels. The scratch brush hits the wrong spot.

**Why it happens:** Canvas coordinate math has three coordinate systems: CSS pixels, canvas pixels, and client/viewport pixels. Each layer of scaling (devicePixelRatio, CSS transform, page zoom, mobile viewport) adds a translation step. Miss one and the brush is offset.

**Consequences:** On mobile, the scratch card feels broken. Players scratch but the reveal area is offset from their finger. They can't complete the scratch to the 75% threshold (line 2274), so quadrants never auto-reveal. The jackpot experience, which is supposed to be the hero feature, is unusable on mobile.

**Prevention:**
1. Use `canvas.getBoundingClientRect()` for position AND size, and compute coordinates as `(clientX - rect.left) / rect.width * canvas.width`. Never use `offsetX`/`offsetY` for touch events (they're unreliable on mobile).
2. Test on actual mobile devices, not just browser dev tools mobile emulation. MetaMask mobile in-app browser, Trust Wallet browser, and Safari iOS all behave differently.
3. Add a "Reveal All" button as a fallback. If the scratch interaction is buggy on a device, the player can still see their results.
4. Test at page zoom levels of 100%, 150%, and 200%. Test with pinch-zoom on mobile.
5. Avoid CSS transforms on the canvas element or its parents. They add another coordinate translation that `getBoundingClientRect` may or may not account for depending on the browser.

**Detection:** Open the scratch card on an iPhone via MetaMask mobile browser. Scratch with your finger. Is the scratch mark where your finger is?

**Phase:** Phase 2 or 3 (jackpot hero rebuild). Must be tested on real devices during that phase.

---

## Moderate Pitfalls

---

### Pitfall 7: Web Audio Autoplay Policy Silently Kills Game Sound

**What goes wrong:** The existing code creates `AudioContext` lazily on first use (`jpGetAudio()` at line 2297) and calls `resume()` if suspended. This is the correct pattern. But the sound effects are triggered during the jackpot spin animation, which starts automatically when the page loads or when game day advances. If the user hasn't interacted with the page yet (no click, no tap), the AudioContext is created in "suspended" state, and `resume()` is a no-op because there's no user gesture in the call stack.

**Why it happens:** Chrome and Safari require AudioContext creation or resumption to happen inside a user gesture (click, tap, keypress). `setTimeout` callbacks, animation frames, and programmatic triggers don't count. The spin animation starts from a `setTimeout` chain, not a direct click handler.

**Prevention:**
1. Create and resume the AudioContext on the first user click anywhere on the page (not just on a sound-related button). Add a one-time click handler to `document` that creates the context.
2. Don't assume `resume()` works. Check `audioCtx.state === 'running'` before playing sounds. If not running, queue sounds to play when it resumes.
3. On mobile Safari: the AudioContext must be created AND a buffer source must be started inside the same user gesture. Creating it early and resuming later doesn't always work.
4. Consider a visible "Enable Sound" toggle that users click, which is the user gesture that unlocks audio. This is standard in browser games.

**Detection:** Open the game in a fresh incognito window. Let the jackpot animation play without clicking anything first. Are sounds audible?

**Phase:** Phase 3 (audio/animation polish). Not blocking but significantly degrades the hero experience.

---

### Pitfall 8: `setInterval` Polling Dies in Background Tabs

**What goes wrong:** The degenerette panel polls for VRF results with `setInterval(degenPoll, 10000)` (line 4298). Chrome throttles `setInterval` in background tabs to once per minute. Firefox throttles to once per minute after 5 minutes. If the player switches to MetaMask to confirm a transaction (the most common workflow), the polling interval jumps from 10s to 60s. They come back and the result still shows "pending" even though VRF fulfilled 45 seconds ago.

**Why it happens:** Browsers throttle background tab timers to save battery and CPU. This is well-documented behavior since Chrome 57 (2017) but developers still use `setInterval` for time-critical polling.

**Consequences:** Sluggish UX after tab-switching. The player confirmed their transaction in MetaMask, switched back to the game tab, and nothing has updated. They wait, confused.

**Prevention:**
1. On `visibilitychange` event (tab becomes visible again), immediately trigger a poll. Don't wait for the next `setInterval` tick.
2. For countdown timers (death clock), compute display time as `target - Date.now()`, not by decrementing a counter each tick. The absolute time approach survives tab throttling because it recalculates from the real clock each render.
3. Use `requestAnimationFrame` for visual updates (animations, counters). It pauses when the tab is hidden (saving resources) and resumes immediately when the tab is visible.
4. For polling, `setInterval` is fine as a base, but always supplement with `visibilitychange` to catch up on return.

**Detection:** Start a jackpot animation, switch tabs for 30 seconds, switch back. Does the animation state catch up instantly or does it hang?

**Phase:** Phase 1 (state management). Establish the `visibilitychange` pattern in the polling infrastructure from the start.

---

### Pitfall 9: Death Timer Shows Wrong Time Due to Timezone or Drift

**What goes wrong:** The death clock counts down from a blockchain timestamp (block.timestamp, UTC). The frontend calculates remaining time as `deadlineTimestamp - Date.now() / 1000`. If the user's system clock is wrong (ahead or behind), the countdown is wrong. If they're 5 minutes ahead, the timer shows 5 fewer minutes than reality. Worse: if the frontend uses `new Date()` to format the deadline into a human-readable string, it displays in local time, and the user interprets "expires at 3:00 PM" as their local 3:00 PM, not UTC 3:00 PM.

**Why it happens:** JavaScript `Date.now()` uses the system clock, which is often slightly wrong on mobile devices and can be hours wrong if the user set their timezone incorrectly. Contract timestamps are UTC epoch seconds with no timezone.

**Consequences:** Player sees "Death in 2 hours" when it's actually 3 hours, or vice versa. In a game where the death clock creates genuine urgency and drives purchase decisions, showing the wrong time can cause players to make incorrect economic decisions. A player might panic-buy tickets they didn't need, or fail to buy tickets they did need.

**Prevention:**
1. Never display absolute times for deadlines. Always show relative times: "2 hours 14 minutes remaining," not "Expires at 15:00."
2. For relative time calculations, use `(deadlineTimestamp - currentBlockTimestamp) * 1000` where `currentBlockTimestamp` comes from the most recent block header, not from `Date.now()`. This makes both sides UTC-consistent.
3. If you must use `Date.now()` (because fetching block timestamps is expensive), acknowledge the potential drift and round to the nearest minute for displays over 1 hour. Only show seconds for the last 5 minutes.
4. On `visibilitychange`, re-sync the timer from the API or a recent block timestamp to correct any drift that accumulated while the tab was hidden.
5. Never use `setInterval` to decrement a counter by 1 each second. Timer drift means after 1 hour, you could be 3-10 seconds off. Always recompute from `Date.now()` each tick.

**Detection:** Set your system clock forward by 10 minutes. Does the death timer show 10 fewer minutes than it should?

**Phase:** Phase 2 or 3 (death timer implementation). Design the timer utility in Phase 1 state management.

---

### Pitfall 10: Wallet Provider Detection Race Condition

**What goes wrong:** The existing code has a revealing workaround at lines 2239-2253: it waits for `window.load`, then `setTimeout(300ms)`, then checks `window.ethereum`. This 300ms delay is there because MetaMask (and other wallet extensions) inject `window.ethereum` asynchronously after page load. Sometimes 300ms is enough. Sometimes it isn't. On slow machines, with multiple extensions (common for crypto users), or with extension frameworks like Rabby that override MetaMask's injection, the provider might not be ready at 300ms.

**Why it happens:** EIP-1193 doesn't specify when `window.ethereum` becomes available. Each wallet extension injects at its own pace. The EIP-6963 standard (multi-wallet discovery via events) exists to solve this, but adoption is still incomplete and the current code doesn't use it.

**Consequences:** On first page load, the wallet appears disconnected even though MetaMask is installed and the user previously authorized the site. They have to click "Connect" again. Minor annoyance, but it happens on every page load and makes the app feel broken.

**Prevention:**
1. Use `window.addEventListener('eip6963:announceProvider', handler)` for modern wallet discovery. This is event-based, not polling-based, and handles multiple wallets gracefully.
2. As a fallback for wallets that don't support EIP-6963, poll for `window.ethereum` with exponential backoff: check at 100ms, 300ms, 1s, 3s. Give up after 5s and show the "Install MetaMask" prompt.
3. Don't assume `window.ethereum` is MetaMask. It could be Rabby, Coinbase Wallet, Brave Wallet, or any EIP-1193 provider. Use `provider.isMetaMask` checks only for MetaMask-specific features.
4. Handle `window.ethereum` being an array (some multi-wallet setups) or a Proxy object.

**Detection:** Install both MetaMask and Rabby. Reload the page. Which wallet is `window.ethereum`? Is it the one the user expects?

**Phase:** Phase 1 (wallet connection module). This is foundational infrastructure.

---

### Pitfall 11: Animation setTimeout Chains Leak and Overlap

**What goes wrong:** Both the jackpot spin (line 3345, `jpAnimate`) and the degenerette reveal (line 4447, `degenAnimateReveal`) use recursive `setTimeout` chains for frame-by-frame animation. The jackpot uses an `animId` counter to cancel stale animations (line 3346: `var animId = ++jpAnimId`, with early return on mismatch). This pattern works for single animations, but if the user rapidly triggers re-spins (spam-clicking "Next Day" or "Spin"), multiple `setTimeout` chains can be in flight simultaneously before the cancellation propagates. Each chain is mutating the same DOM elements, causing visual glitches (flickering badges, wrong colors).

**Why it happens:** `setTimeout` is fire-and-forget. There's no way to cancel a pending `setTimeout` unless you stored its return value. The current code doesn't store individual `setTimeout` IDs; it relies on the `animId` check at the start of each `step()` call. But `step()` modifies DOM before checking, so there's a 1-frame glitch window.

**Consequences:** Visual artifacts during rapid interaction. Not data-corrupting, but it makes the hero jackpot experience feel janky.

**Prevention:**
1. Store the `setTimeout` return value and `clearTimeout()` it explicitly when starting a new animation.
2. Gate animation start with a `isAnimating` flag. If an animation is already running, either queue the new one or skip it. The degenerette already does this (`degenSpinning` flag at line 4337), but the jackpot doesn't.
3. For complex multi-step animations, consider a lightweight state machine: IDLE -> SPINNING -> LOCKING -> SCRATCHING -> COMPLETE. Each state has clear entry/exit conditions and can be interrupted cleanly.
4. Never modify DOM state before checking the cancellation token. Move the `if (animId !== jpAnimId) return` check to the very first line of `step()`, before any DOM writes.

**Detection:** Rapidly click "Next Day" 5 times while the spin animation is running. Watch for badge flickering or incorrect quadrant colors.

**Phase:** Phase 2 (jackpot hero rebuild). Establish the animation state machine pattern in Phase 1 so both jackpot and degenerette use the same infrastructure.

---

### Pitfall 12: Optimistic UI After Chain Reorg Shows Phantom Purchases

**What goes wrong:** Player buys tickets. `tx.wait(1)` (wait for 1 confirmation) resolves. UI applies optimistic update: "You now have 5 tickets!" Then a chain reorganization (reorg) occurs. The transaction that was in block N is no longer in the canonical chain. The player's purchase never happened. But the UI still shows 5 tickets because the optimistic update was applied and never rolled back.

**Why it happens:** `tx.wait()` returns after the specified number of confirmations, but on Ethereum post-merge, single-block reorgs are rare (estimated <0.1% of blocks) but not impossible. Longer reorgs are extremely rare on mainnet but more common on testnets. The real risk is on L2s or during network instability.

**Consequences:** The player thinks they have tickets and tries to play. The contract says they have 0 tickets. Confusion and distrust.

**Prevention:**
1. For purchases > 0.05 ETH, wait for 2 confirmations before showing "Confirmed." For smaller amounts, 1 is fine with a caveat.
2. After the optimistic update, schedule a verification read from the contract (not the API) after ~30 seconds. If the on-chain state doesn't match the expected state, show a "Transaction may have been reorganized, please check your balance" warning.
3. Don't remove ETH from the displayed balance until the transaction is confirmed. Show it as "pending" instead. This way, if the tx gets reorged out, the balance automatically corrects.
4. On Sepolia testnet where reorgs are more common, default to 2 confirmations during development.

**Detection:** Hard to test directly without controlling the chain. Can be simulated by sending a tx, applying the optimistic update, then manually reverting the update after 5 seconds.

**Phase:** Phase 2 (transaction flow). Not a high-frequency issue but important for user trust in a financial application.

---

### Pitfall 13: Choosing the Wrong Animation Technology Per Element

**What goes wrong:** The temptation is to pick one animation technology and use it everywhere. Canvas for the scratch card is correct (pixel-level erasure requires it). But using Canvas for the death timer, the coinflip slider, the BAF leaderboard transitions, or card flip effects is overkill and creates unnecessary complexity. Conversely, using CSS animations for the scratch-to-reveal mechanic is impossible, and using them for the degenerette spin (where 8 badges shuffle rapidly with badge images swapping each frame) leads to layout thrashing from repeated `img.src` changes during CSS transitions.

**Why it happens:** Developers learn Canvas for the scratch card, then reach for it for everything. Or they stick with CSS for everything and hit its limits when they need pixel manipulation or high-frequency image swaps.

**Consequences:** Using Canvas where CSS would suffice means more code, more manual hit-testing, no accessibility, and harder responsive design. Using CSS where Canvas is needed means hitting animation limits that require hacky workarounds. Using WebGL for any of this is massive overkill for a card game UI with at most 4 simultaneously animating elements.

**Prevention:**
Use CSS animations for:
- Death timer urgency effects (color transitions, pulsing glow). These are `transform` and `opacity` changes, which run on the compositor thread and are essentially free.
- Card entrance/exit transitions (slide, fade).
- Coinflip slider sweeps (CSS `transition` on `left` property, already working in current code).
- BAF leaderboard position changes.
- Button hover/active states, loading spinners.

Use Canvas for:
- Scratch-to-reveal mechanic (requires `getImageData` pixel manipulation, no CSS equivalent).
- Any effect that requires reading/writing individual pixels.

Use `requestAnimationFrame` + DOM manipulation for:
- The degenerette/jackpot badge shuffle (rapid `img.src` swaps). These need frame-by-frame control but don't need pixel manipulation, so Canvas is unnecessary.

Do NOT use WebGL for this project. The game has at most 4-8 animated elements on screen simultaneously. WebGL's overhead (shader compilation, context management, draw calls) is not justified. It adds a hard dependency on GPU acceleration that may not be available in wallet in-app browsers. Save it for if you ever need particle effects or 3D.

**Detection:** If you find yourself manually implementing hit-testing or text rendering in Canvas, you probably should have used DOM + CSS. If you find CSS transitions stuttering during rapid property changes, you should be using rAF + direct DOM manipulation.

**Phase:** Phase 1 (architecture decision). Document which technology each UI element uses in the module architecture plan.

---

### Pitfall 14: Premature WebSocket Adoption for Game State Polling

**What goes wrong:** The natural instinct for "real-time game state" is to reach for WebSockets. The database API (Fastify at localhost:3000) could support WebSocket or SSE. But adding WebSocket infrastructure for a game where state changes happen at most a few times per minute (level transitions, daily jackpots, death clock ticks) is over-engineering that introduces reconnection logic, heartbeat management, and a whole category of "connection dropped" edge cases that don't exist with simple REST polling.

**Why it happens:** WebSockets feel like the "proper" solution for real-time data. Developers conflate "real-time" with "low latency." In this game, a 5-second polling interval is perfectly adequate for all game state reads. The only time sub-second latency matters is during the degenerette spin (already handled by direct contract polling) and the jackpot draw animation (client-side, no server involved).

**Consequences:** WebSocket connections drop in wallet in-app browsers, on mobile with unreliable connectivity, and behind corporate firewalls. Each disconnection requires reconnection logic, state replay to catch missed events, and a fallback to REST. You end up maintaining two data paths (WebSocket + REST fallback) instead of one. For a game with a few hundred concurrent users at most (early stage), this is pure complexity cost with no user-facing benefit.

**Prevention:**
1. Start with REST polling. 5-second interval for the status bar (level, phase, pool sizes). 10-second interval for player-specific data (balance, tickets, activity score). Trigger immediate poll on `visibilitychange` and after any write transaction.
2. The only feature that benefits from push semantics is "another player just did something" notifications (e.g., "Level 5 filled! Jackpot starting!"). Defer this to a later milestone. SSE (Server-Sent Events) is simpler than WebSocket for server-to-client push and doesn't require reconnection handshaking.
3. If you later need push: use SSE, not WebSocket. SSE auto-reconnects, works over HTTP/2, and the EventSource API is 5 lines of code vs. WebSocket's reconnection boilerplate. The Fastify database API can add SSE with a plugin.
4. Reserve WebSocket for if/when you build a chat feature or real-time multiplayer element. Not for game state.

**Detection:** If you're writing reconnection logic, heartbeat pings, or "catch up on missed events" code, you've over-engineered the data layer.

**Phase:** Phase 2 (API integration). Make the deliberate decision to NOT add WebSockets. Document why.

---

## Minor Pitfalls

---

### Pitfall 15: Mobile Viewport and MetaMask In-App Browser

**What goes wrong:** MetaMask's mobile app has a built-in dApp browser with a narrower viewport than the phone's screen (the MetaMask UI chrome takes space). The current layout uses `grid-template-columns: repeat(6, 1fr)` for the status bar (line 74), which becomes microscopic on a 320px-wide MetaMask browser viewport. Complex layouts like the jackpot card (4 quadrants + center) and the degenerette diamond don't collapse properly below ~400px.

**Prevention:**
1. Test in MetaMask mobile browser (both Android and iOS), not just regular mobile Safari/Chrome.
2. Use `max-width` breakpoints that account for MetaMask's narrower viewport (~340px effective width on small phones).
3. For the status bar, collapse from 6 columns to 3x2 or 2x3 grid on mobile.
4. The jackpot card quadrants should stack 2x2 at all sizes, not attempt to go 1-column.

**Phase:** Phase 3 (responsive polish).

---

### Pitfall 16: `localStorage` Quota and Cross-Domain Issues

**What goes wrong:** The current code stores degenerette results (line 4221, capped at 50), cache data (line 126 in `mint.js`), and affiliate codes in `localStorage`. If the game is ever served from a different subdomain (e.g., moving from `beta.degenerus.com` to `app.degenerus.com`), all persisted data is lost. Also, MetaMask mobile in-app browser has tighter `localStorage` quotas.

**Prevention:**
1. Keep `localStorage` usage minimal and always handle quota exceeded errors (the existing code already does this at line 4225, good).
2. For critical data (pending bet IDs), consider storing in the URL hash as a backup, so a shared link can reconstruct the state.
3. Plan for domain migration: namespace all keys (e.g., `degenerus_v2_*`) so they don't collide and can be migrated.

**Phase:** Phase 1 (state management design).

---

### Pitfall 17: ethers.js v6 CDN Import Fragility

**What goes wrong:** The current code imports ethers from `https://esm.sh/ethers@6` (line 2236). If esm.sh goes down, has a CDN cache issue, or rate-limits, the entire app is non-functional. No ethers = no wallet = no game. This is a single point of failure for the entire frontend.

**Prevention:**
1. Vendor ethers.js locally. Download the ESM build and serve it from your own static files. The current "no build step" constraint doesn't prevent vendoring.
2. If CDN is preferred, add a fallback: try esm.sh first, then unpkg, then a local copy.
3. Pin the exact version (e.g., `ethers@6.13.1`), not just `@6`, to prevent unexpected breaking changes.

**Phase:** Phase 1 (module architecture).

---

### Pitfall 18: Sound Effect Synthesis Creates GC Pressure

**What goes wrong:** The current sound effects create new `OscillatorNode`, `GainNode`, and `BiquadFilterNode` objects for every single sound (e.g., `jpSfxTick` creates 1 oscillator + 1 gain per tick, called ~40 times during a spin). These are short-lived objects that immediately become garbage. During a fast spin animation with 8 locks and ~40 ticks, that's ~80-120 Web Audio nodes created and discarded in 3-4 seconds. On low-end mobile devices, this can cause GC pauses that stutter the animation.

**Prevention:**
1. Pre-create a pool of reusable oscillators and gain nodes. Reset their parameters instead of creating new ones.
2. Alternatively, pre-render the sound effects into AudioBuffers using `OfflineAudioContext` at initialization time, then play them with `AudioBufferSourceNode` (which is cheaper than oscillator synthesis).
3. For the scratch noise (`jpSfxScratchStart`, line 2399, which creates white noise via `createScriptProcessor`), note that `ScriptProcessorNode` is deprecated. Use `AudioWorklet` instead, or pre-generate a noise buffer.

**Phase:** Phase 3 (audio polish). Not blocking but noticeable on budget phones.

---

### Pitfall 19: Compliance Surface Area in Crypto Gambling UI

**What goes wrong:** Displaying real ETH values alongside gambling mechanics (odds, payouts, bet sizing) in a web-accessible frontend creates regulatory surface area. Depending on the jurisdiction, this may require: age gates, responsible gambling disclosures, KYC/AML infrastructure, or geofencing. Ignoring this entirely is not a technical pitfall but a deployment-blocking pitfall.

**Prevention:**
1. This is not a frontend engineering problem to solve. It's a product/legal decision. But the frontend should be designed to accommodate geo-restrictions and disclaimers without structural changes.
2. Build the UI so that a geofencing check can be inserted before any transaction (a middleware pattern in the wallet interaction layer).
3. Include a terms-of-service acceptance gate before first wallet connection.
4. Never hardcode jurisdiction-specific text. Use a config object that can be swapped per deployment.

**Phase:** Pre-launch, not tied to a specific build phase. But the architectural hooks (geofencing middleware, TOS gate component) should be in Phase 1.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Module extraction (Phase 1) | Implicit dependencies between IIFEs (#1), ES module CORS (#2) | Map dependency graph before extracting. Require dev server. |
| Wallet layer (Phase 1) | Provider detection race (#10), false confirmation (#3) | EIP-6963 discovery, check receipt.status, persist pending txs |
| State management (Phase 1) | Background tab throttling (#8), localStorage limits (#16) | visibilitychange handler, absolute time calculations |
| Animation architecture (Phase 1) | Wrong tech per element (#13), WebSocket over-engineering (#14) | Document CSS/Canvas/rAF decision per component. Start with REST polling. |
| API integration (Phase 2) | Contract-vs-API desync (#5), stale reads after writes | Optimistic updates with verification reads |
| VRF features (Phase 2-3) | Long pending states (#4), lost pending bets on refresh | localStorage persistence, multi-stage progress UI |
| Jackpot hero (Phase 2-3) | Canvas touch offset on mobile (#6), animation overlap (#11) | Correct coordinate math, animation state machine |
| Death timer (Phase 2-3) | Timezone/drift bugs (#9), false urgency | Relative-only display, block timestamp anchoring |
| Audio (Phase 3) | Autoplay policy (#7), GC pressure (#18) | User gesture unlock, pre-rendered audio buffers |
| Mobile polish (Phase 3) | MetaMask in-app viewport (#15), touch UX | Test on actual devices in actual wallet browsers |
| Compliance (Pre-launch) | Legal surface area (#19) | Geofencing hooks, TOS gate, config-driven text |

---

## Sources

- [MDN: JavaScript Modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) - ES module CORS, MIME type requirements
- [Chrome DevBlog: Web Audio Autoplay Policy](https://developer.chrome.com/blog/web-audio-autoplay) - AudioContext user gesture requirement
- [MDN: Autoplay Guide](https://developer.mozilla.org/en-US/docs/Web/Media/Autoplay_guide) - Cross-browser autoplay policy details
- [MDN: Animation Performance](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Animation_performance_and_frame_rate) - Compositor thread, transform/opacity
- [web.dev: High DPI Canvas](https://web.dev/articles/canvas-hidipi) - devicePixelRatio, canvas coordinate systems
- [Pontis Technology: setInterval Throttling](https://pontistechnology.com/learn-why-setinterval-javascript-breaks-when-throttled/) - Background tab timer behavior
- [Ably: WebSocket vs REST](https://ably.com/topic/websocket-vs-rest) - Polling trade-offs for real-time data
- [Tapflare: Web Graphics Comparison](https://tapflare.com/articles/web-graphics-comparison-canvas-svg-webgl) - Canvas vs CSS vs WebGL decision matrix
- [Motion Magazine: Web Animation Performance Tier List](https://motion.dev/blog/web-animation-performance-tier-list) - Animation technology benchmarks
- [Chainlink: VRF Documentation](https://docs.chain.link/vrf) - Pending request lifecycle, 24h timeout
- [ethers.js GitHub: WebSocket Memory Leaks](https://github.com/ethers-io/ethers.js/issues/1121) - Provider memory leak issues
- [ethers.js GitHub: v6 Error Event Removal](https://github.com/ethers-io/ethers.js/issues/3970) - Missing error event in v6
- [Moesif: Common MetaMask DApp Problems](https://www.moesif.com/blog/blockchain/ethereum/Common-Problems-Developing-Ethereum-DApps-With-Metamask/) - Wallet detection, chain switching
- [LogRocket: MetaMask Error Codes](https://blog.logrocket.com/understanding-resolving-metamask-error-codes/) - Transaction error handling
- [Medium: On-Chain Off-Chain Sync Attacks](https://medium.com/@eceorsel/understanding-onchain-offchain-out-of-sync-attacks-in-dapps-81914750a091) - API-contract desync risks
- [Block3 Finance: Legal Challenges Crypto Betting 2025](https://www.block3finance.com/the-legal-challenges-facing-crypto-betting-in-2025) - Regulatory landscape
- [Go Make Things: ES Module Side Effects](https://gomakethings.com/side-effects-in-es-modules-with-vanilla-js/) - Module extraction patterns
- [MetaMask Developer Docs: SDK](https://docs.metamask.io/sdk/) - Mobile integration, EIP-6963
- [Gate.io: Optimizing dApps for Crypto Wallets](https://web3.gate.com/crypto-wiki/article/optimizing-dapps-for-seamless-browsing-experience-in-crypto-wallets-20251224) - Wallet browser viewport constraints
