# Codebase Concerns

**Analysis Date:** 2025-02-28

## Fragile Areas

**JavaScript Event Listeners and Error Handling:**
- Files: `shared/nav.js`, `beta/mint.js`
- Why fragile: Both files contain global state variables (`address`, `discord`, `player` in nav.js; `provider`, `signer`, `contract` in mint.js) managed by event listeners and promise chains. Chain breaks or timing issues can leave state inconsistent. Multiple `catch (e) {}` patterns silently swallow errors without logging, making debugging difficult.
- Safe modification: Add explicit error logging to catch blocks. Consider using a state machine pattern or store to centralize state management. Test wallet connection/disconnection flows thoroughly.
- Test coverage: Event listener chains lack unit tests; wallet state transitions are only manually tested.

**Database Synchronization State in event_indexer.py:**
- Files: `event-indexer/event_indexer.py`
- Why fragile: The `sync_state` table tracks `last_processed_block` to detect missed blocks. If the websocket disconnects during backfill (line 337-346), or a batch fails partway (lines 356-374), the state may record a block as processed before events are fully stored. Batching with dynamic size reduction (line 369) can leave gaps if not careful.
- Safe modification: Before updating sync state, verify all events in the batch are committed. Consider write-ahead logging or transaction isolation. Add integrity checks on startup.
- Test coverage: Backfill gap detection is untested; only happy-path integration tested.

**Contract Address Hardcoding:**
- Files: `beta/mint.js`, `shared/nav.js`
- Why fragile: Contract addresses are hardcoded for Sepolia testnet (lines 16-20 in mint.js, lines 21-23 in nav.js). Deployment to mainnet requires manual code edits across multiple files. Easy to deploy with wrong addresses.
- Safe modification: Move all contract addresses to a single configuration object (e.g., `shared/config.js`). Load via environment or data attribute. Support multiple networks.
- Test coverage: No tests verify correct contract addresses are used.

**Bare Exception Handlers:**
- Files: `event-indexer/event_indexer.py`
- Why fragile: Lines 511, 520, 653, 712 catch generic `Exception` without specifics. Lines 407, 520 also catch broad exceptions. This masks bugs and makes failures hard to diagnose. For example, line 511 catches exceptions when decoding logs but doesn't distinguish between malformed ABIs and actual decoding failures.
- Safe modification: Catch specific exception types. Log the full traceback. Consider raising unhandled exceptions after logging.
- Test coverage: Exception paths are not explicitly tested.

**Trait Ownership Backfill Logic:**
- Files: `db/export-jackpot-data.js`
- Why fragile: Lines 293-324 backfill trait ownership from jackpot wins. If the indexer missed trait_entries updates, this partially repairs the data, but discrepancies can silently exist. No verification that the final state is correct or complete.
- Safe modification: Add checksums or audits to detect and alert on data mismatches. Log all backfill operations for debugging.
- Test coverage: Backfill correctness is not tested against known good data.

## Tech Debt

**Unfinished Event Handler in event_indexer.py:**
- Issue: Line 12 states "State reconstruction is best-effort and intended to be extended by adding more event handlers." Only a few event types are reconstructed; many contract events lack handlers.
- Files: `event-indexer/event_indexer.py`
- Impact: State queries return incomplete snapshots; dependent systems (jackpot UI) may show stale or incorrect data.
- Fix approach: Add event handlers for all critical event types. Document which events are supported. Consider a plugin/registry pattern for extensibility.

**Websocket Reconnection with Manual Backfill:**
- Issue: Line 391-410 implements websocket reconnection with manual backfill on gaps. The polling is simple exponential backoff (line 410) without jitter, creating thundering herd issues if many indexers reconnect simultaneously.
- Files: `event-indexer/event_indexer.py`
- Impact: Noisy network degradation; missed events during storm conditions.
- Fix approach: Add jitter to backoff (e.g., `backoff * (1 + random(0, 0.1))`). Implement circuit breaker pattern if RPC is consistently failing.

**JavaScript Global Scope Pollution:**
- Issue: `shared/nav.js` and `beta/mint.js` expose large APIs via `window.Nav` and `window.Mint` namespaces. Each file declares module-level state that is not isolated; if multiple versions load or modules interact, state conflicts are likely.
- Files: `shared/nav.js`, `beta/mint.js`
- Impact: Hard to test in isolation; name collisions possible; refactoring risky.
- Fix approach: Use closures to strictly encapsulate state. Provide minimal public API. Add namespace uniqueness checks.

**Hard-coded API Endpoint:**
- Issue: Line 5 in `shared/nav.js` hard-codes `API = 'https://api.degener.us'`. No fallback or environment override.
- Files: `shared/nav.js`
- Impact: Staging/testing environments cannot override the API. Redirects would silently fail.
- Fix approach: Load API URL from `data` attribute or query param, fallback to hard-coded default.

**Python Event Indexer Missing Async Context Manager:**
- Issue: Line 142 opens sqlite3 connection with `check_same_thread=False`, allowing concurrent writes from async tasks. While the code uses `self.db_lock` (line 323), this is error-prone because the lock must be acquired everywhere the DB is touched.
- Files: `event-indexer/event_indexer.py`
- Impact: Race conditions on DB writes; data corruption possible if a task forgets the lock.
- Fix approach: Use `aiosqlite` for proper async SQLite access, or enforce the lock at initialization time. Document the locking requirement loudly.

**No Input Validation on Affiliate Code:**
- Issue: Lines 236-238 in `shared/nav.js` validate affiliate code regex. Lines 49-50 and 170-187 in `beta/mint.js` handle it. But encoding logic (line 184) silently falls back to `ZeroHash` on any encoding error; the contract may reject silently.
- Files: `shared/nav.js`, `beta/mint.js`
- Impact: User affiliate codes may not work; no feedback to user.
- Fix approach: Validate before sending. Display error if encoding fails. Log the failure.

**Untested Data Export Process:**
- Issue: `db/export-jackpot-data.js` is a CLI tool with complex SQL aggregation and joins (lines 103-113). A single schema change breaks it silently.
- Files: `db/export-jackpot-data.js`
- Impact: Stale jackpot UI data; beta page shows incorrect player histories.
- Fix approach: Add integration tests with known database snapshots. Validate exported data schema. Add dry-run mode.

## Security Considerations

**Signature Verification in nav.js Wallet Connect:**
- Risk: Lines 147-158 request user signature via MetaMask. The message comes from the backend (`/api/wallet/nonce`). If the API is compromised, attackers can craft arbitrary messages for users to sign.
- Files: `shared/nav.js`
- Current mitigation: HTTPS communication.
- Recommendations: Validate nonce format before displaying to user. Implement replay protection (nonce expiry). Log all signature requests server-side.

**LocalStorage for Sensitive Data:**
- Risk: Lines 55-58 in `shared/nav.js` store affiliate referrer code in localStorage. While not sensitive, adjacent code in `beta/mint.js` (line 513) stores similar data. If the page is vulnerable to XSS, localStorage is accessible.
- Files: `shared/nav.js`, `beta/mint.js`
- Current mitigation: None; HTML pages are static.
- Recommendations: Use `sessionStorage` for temporary data. Add CSP headers to prevent XSS. Sanitize all dynamic content.

**Contract ABI Parsing in event_indexer.py:**
- Risk: Lines 260-283 accept ABIs from config file or JSON files. If an ABI is malicious (e.g., triggers code execution during JSON parsing), it's a vulnerability.
- Files: `event-indexer/event_indexer.py`
- Current mitigation: None; ABIs are parsed with standard `json.load()`.
- Recommendations: Validate ABI schema before using. Use a schema validator (e.g., `jsonschema`). Log ABI sources for audit.

**No Rate Limiting on Mint Transaction:**
- Risk: Lines 700-800+ in `beta/mint.js` (purchase transaction) have no client-side rate limiting. A bot could spam mints if the user session is compromised.
- Files: `beta/mint.js`
- Current mitigation: Server-side rate limiting only.
- Recommendations: Add client-side debouncing/rate limit on button clicks. Show cooldown timers. Require transaction confirmations.

**Websocket Subscription Logic:**
- Risk: Lines 412-433 in `event-indexer.py` manage websocket subscription. If the subscription ID is forged or the server is compromised, the indexer could be fed malicious logs.
- Files: `event-indexer/event_indexer.py`
- Current mitigation: None; logs are decoded and stored as-is.
- Recommendations: Validate log signatures (RLP encoding / block hash verification). Detect anomalous event patterns. Add monitoring and alerts.

## Performance Bottlenecks

**Event Indexer Log Processing Without Batching:**
- Problem: Lines 399-404 in `event-indexer.py` process websocket messages one at a time. If the network is fast and many events arrive, processing falls behind, causing backlog and potential timeout.
- Files: `event-indexer/event_indexer.py`
- Cause: `async for message in ws` is serial; each message is processed in `_handle_ws_log()` which may do DB writes sequentially.
- Improvement path: Accumulate logs into a batch (e.g., 10-100 logs) before writing. Use `asyncio.gather()` for parallel log decoding. Profile to find the actual bottleneck.

**Trait Ownership Query in export-jackpot-data.js:**
- Problem: Lines 244-264 fetch all trait entries for all players and levels, then build bitmasks in Python. On large datasets (millions of rows), this is slow.
- Files: `db/export-jackpot-data.js`
- Cause: Full table scan; no pre-aggregation in the database.
- Improvement path: Pre-compute bitmasks in the database during indexing. Store in a summary table. Or use a bitmap column type and compute in SQL.

**Repeated Contract Calls in mint.js Polling:**
- Problem: Line 545-550 polls state every 15 seconds, calling `refreshState()` which calls 3 contract view functions each time (line 566-570). This is a lot of RPC calls.
- Files: `beta/mint.js`
- Cause: Client-side polling with no skipping or smart caching.
- Improvement path: Implement cache with TTL. Skip refresh if nothing has changed (use event logs to detect changes). Switch to server-sent events (SSE) or websocket for real-time updates.

**Trait Lookup in Jackpot Export:**
- Problem: Lines 313-318 in `export-jackpot-data.js` loop through all trait rows for all players and levels, building a sparse 3-level nested object. For 1M trait entries, this is slow in JavaScript.
- Files: `db/export-jackpot-data.js`
- Cause: Not indexed; full scan required.
- Improvement path: Compute the final JSON structure in SQL or a database view. Or pre-aggregate during indexing and export pre-computed data.

## Scaling Limits

**SQLite Database Size:**
- Current capacity: SQLite performs well up to 100-200GB. The event indexer stores all logs; if block rate is high, the database grows linearly.
- Limit: After ~10 million events (est. 5-10GB), query performance degrades without proper indexing.
- Scaling path: Implement time-based partitioning (separate DB per quarter). Or migrate to PostgreSQL. Pre-compute and archive old data.

**JSON Export File Size:**
- Current capacity: `beta/jackpot-data.json` grows with players, levels, and wins. At 10K players × 100 levels × 1K wins = 1B entries, the file could exceed 1GB.
- Limit: JSON parsing in browser becomes slow; network transfer times out.
- Scaling path: Split by level or player (lazy-load). Use binary format (e.g., MessagePack or Protocol Buffers). Implement server-side pagination API.

**Websocket Connection Pool:**
- Current capacity: A single websocket connection from the indexer. If block rate spikes, backpressure builds.
- Limit: At >100 events/second, backfill starts falling behind and never catches up.
- Scaling path: Parallel backfill with multiple RPC calls. Increase batch size dynamically. Use a message queue (e.g., Kafka) to decouple indexing from storage.

## Known Bugs

**Trait Ownership Deity Pass Virtual Entries:**
- Symptoms: Lines 273-291 in `export-jackpot-data.js` add virtual trait entries for deity pass holders. If a deity pass holder has no actual tickets, all 8 symbols are still added to all levels, which is incorrect.
- Files: `db/export-jackpot-data.js`
- Trigger: A new deity pass holder with zero tickets is created, then queried.
- Workaround: Manual inspection of traitCounts to detect spurious entries; remove them from the output.
- Fix approach: Only add virtual entries for levels the holder actually has tickets for (from the `tickets[p]` list).

**Event Indexer Batch Size Reduction on Large Queries:**
- Symptoms: When `get_logs` returns "query returned more than X results", batch size is halved (line 369). If queries are consistently too large, batch size shrinks to 1, and backfill takes forever without recovery.
- Files: `event-indexer/event_indexer.py`
- Trigger: High-frequency blocks with many events (e.g., mainnet after merge).
- Workaround: Manually restart with smaller `batch_size` in config.
- Fix approach: Add adaptive backoff. If batch size hits minimum, consider filtering by address or topic first, then merging results.

**Missing Error Message in Affiliate Code Encoding:**
- Symptoms: `beta/mint.js` line 184 catches encoding errors silently and returns ZeroHash. User sees no feedback that their code was invalid.
- Files: `beta/mint.js`
- Trigger: Enter affiliate code with special characters or > 31 chars.
- Workaround: None; code is silently discarded.
- Fix approach: Display error in UI. Log to console for debugging.

**Async/Await Race in mint.js Poll Loop:**
- Symptoms: Lines 545-550 start a poll loop with async tasks. If an error occurs in `refreshState()`, the task fails but the loop continues (line 546 has try/catch). If multiple mints happen in quick succession, state can become stale.
- Files: `beta/mint.js`
- Trigger: Network timeout during poll, followed by user clicking purchase button.
- Workaround: Manually refresh page to get fresh state.
- Fix approach: Pause polling on errors. Show error state to user. Add exponential backoff to retry.

## Test Coverage Gaps

**Wallet Connection Flow:**
- What's not tested: Entire auth chain from MetaMask request → nonce fetch → signature → verification.
- Files: `shared/nav.js`
- Risk: Breaking change in MetaMask API or backend nonce format goes undetected.
- Priority: High — user-facing critical path.

**SQL Aggregation Correctness:**
- What's not tested: The complex aggregations in `export-jackpot-data.js` (lines 103-235) producing correct jackpot win summaries.
- Files: `db/export-jackpot-data.js`
- Risk: Silent data corruption or duplicate counting in UI.
- Priority: High — affects player payouts display.

**Event Decoding with Multiple ABIs:**
- What's not tested: Decoding ambiguous events (same signature in two contracts). Fallback to linear search (lines 497-520).
- Files: `event-indexer/event_indexer.py`
- Risk: Events are decoded with wrong ABI, producing garbage args.
- Priority: Medium — data quality issue.

**Websocket Reconnection and Backfill Race:**
- What's not tested: Timing of websocket disconnect, backfill completion, and new logs arriving.
- Files: `event-indexer/event_indexer.py`
- Risk: Duplicate or missed events during reconnection.
- Priority: High — data integrity.

**Mint Price Calculation and BigInt Overflow:**
- What's not tested: Edge cases where `currentMintPrice * quantity` overflows in JavaScript BigInt (unlikely but theoretically possible).
- Files: `beta/mint.js`
- Risk: Transaction fails silently or sends wrong amount.
- Priority: Low — BigInt is designed for large numbers, but edge case testing is still useful.

---

*Concerns audit: 2025-02-28*
