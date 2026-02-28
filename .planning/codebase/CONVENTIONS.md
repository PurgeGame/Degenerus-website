# Coding Conventions

**Analysis Date:** 2026-02-28

## Naming Patterns

**Files:**
- Lowercase with hyphens: `nav.js`, `mint.js`, `export-jackpot-data.js`
- Single-word or descriptive names tied to functionality
- Python scripts use lowercase with hyphens: `event_indexer.py`, `build-gta-html.py`
- HTML files lowercase: `index.html`, `score-info.html`

**Functions:**
- camelCase: `connectWallet()`, `updateWalletBtn()`, `createAffiliate()`, `saveCache()`
- Prefix convention for state management: `update*`, `check*`, `set*`, `get*`, `create*`
- Python uses snake_case: `_log()`, `_json_default()`, `_load_json()`, `_normalize_log()`
- Constants in UPPER_CASE: `API`, `CONTRACTS`, `REFERRER_KEY`, `CHAIN_ID`

**Variables:**
- camelCase for JavaScript: `currentAddress`, `pollTimer`, `signer`, `provider`, `isPresale`, `isRngLocked`
- Underscore prefix for internal/private in Python: `_block_ts_cache`, `_ws_id`, `_json_default`
- Abbreviations acceptable: `btn`, `msg`, `res`, `addr`, `bps` (basis points)

**Types/Classes:**
- PascalCase for classes: `EventIndexer`
- Uppercase for singleton objects: `CONTRACTS`, `ABI`, `COIN_ABI`, `AFFILIATE_ABI`

## Code Style

**Formatting:**
- Vanilla JavaScript (no build step in `/shared/` and `/beta/` modules)
- 2-space indentation observed in all files
- Single quotes preferred in JavaScript: `'strict'`, `'utf-8'`
- Long comments use dashes for section separation: `// -----------...`

**Linting:**
- No configured linter detected
- Manual code organization (no .eslintrc or prettier config)

**Patterns - JavaScript:**
- IIFE pattern for module encapsulation: All JavaScript files wrap in `(function () { 'use strict'; ... })()`
- Immediate exposure to `window.*` for public API: `window.Mint`, `window.initNav`, `window.openScoreInfo()`
- All internal state is private to IIFE scope (no global pollution)

**Patterns - Python:**
- Type hints throughout: `def _log(msg: str) -> None`, `def _json_default(obj: Any) -> Any`
- Docstrings at module level with usage examples
- Class-based design for complex state (e.g., `EventIndexer` class manages indexing pipeline)

## Import Organization

**JavaScript:**
- No imports in vanilla modules (IIFE-scoped)
- Dependencies injected via global scope: `window.ethers`, `window.ethereum`
- ABI fragments defined as module constants at top

**Python:**
- Standard library imports first: `argparse`, `asyncio`, `json`, `os`, `sys`, `time`
- Third-party imports second: `web3`, `hexbytes`, `websockets`
- Organized alphabetically within groups
- Type hints imported from `typing` module: `Dict`, `Any`, `List`, `Optional`, `Tuple`

**No path aliases detected** - imports use absolute paths

## Error Handling

**JavaScript Patterns:**
- Try-catch with silent failures common: `try { return localStorage.getItem(...) } catch (e) { return null; }`
- Promise chain `.catch()` with logging to console: `.catch(function (err) { console.warn(...) })`
- Error messages passed to user via alert or UI status: `alert('...')`, `setTxStatus('error', '...')`
- Optional execution guard: `if (btn) btn.disabled = true` (defensive null checks)

**Python Patterns:**
- Explicit exception handling: `try: import websockets except Exception: websockets = None`
- Logging to stderr via custom `_log()` helper with timestamp
- Runtime errors raised with descriptive messages: `raise RuntimeError("...")`
- Database errors handled during sync operations with transaction rollback

## Logging

**Framework:** No framework detected

**JavaScript:**
- Console methods: `console.warn()`, `console.log()` for diagnostics
- Status UI text used for user-facing messages: `setAffStatus()`, `setTxStatus()`
- Silent error suppression in non-critical flows: `catch(function () {})`

**Python:**
- Centralized logging via `_log(msg: str)` helper
- All logs written to stderr with ISO timestamp
- Format: `[YYYY-MM-DD HH:MM:SS UTC] {message}`
- Example: `_log("Event processor started")`

## Comments

**When to Comment:**
- Section headers with dashes: `// --- Helpers ---`, `// --- Auth flows ---`
- Inline notes for non-obvious logic: `// All ETH prices divided by 1M on testnet`
- Contract addresses and configuration noted inline: `// Sepolia testnet`, `// 11155111`

**Documentation:**
- Module docstrings in Python with usage and notes
- Inline comments explain domain logic (e.g., level/day mapping in `export-jackpot-data.js`)
- No JSDoc/TSDoc found (vanilla JS, no type system)

**Avoid:**
- Commenting obvious code: `var x = 5; // set x to 5`
- Over-commenting trivial operations

## Function Design

**Size:** Functions observed range from 5 lines (helpers) to 80+ lines (complex async flows)

**Parameters:**
- Positional arguments common: `api(path, opts)`
- Optional second argument pattern: `opts || {}`
- Destructuring not used (vanilla JS)
- Python uses typed parameters: `def __init__(self, config: Dict[str, Any])`

**Return Values:**
- Promises in async flows: `promise.then().catch()`
- Null for "not found": `return null`
- Implicit undefined for void: `function saveCache(data) { ... }`
- Early returns for guard clauses: `if (!code) return`

## Module Design

**Exports:**
- JavaScript: Single public interface via `window.*`: `window.Mint`, `window.initNav`
- Python: Class-based with public methods (EventIndexer) and internal helpers (prefixed `_`)

**Barrel Files:** Not used

**Module Pattern Examples:**

`/home/zak/Dev/PurgeGame/website/shared/nav.js`:
- Public methods: `window.initNav()`, `window.openScoreInfo()`
- Internal state: `address`, `discord`, `player` (IIFE-scoped)
- Initialization: `initNav(config)` builds and inserts nav DOM

`/home/zak/Dev/PurgeGame/website/beta/mint.js`:
- Public interface: `window.Mint` object with methods
- Internal async state: `provider`, `signer`, `contract` (IIFE-scoped)
- Polling pattern: `pollTimer` for periodic state refresh

`/home/zak/Dev/PurgeGame/website/event-indexer/event_indexer.py`:
- Class `EventIndexer` with async methods
- Setup: `await indexer.init_db()`, `await indexer.start()`
- State reconstruction via event handlers

## Code Organization Principles

**Separation of Concerns:**
- DOM manipulation isolated in dedicated functions: `updateWalletBtn()`, `buildNav()`
- API calls centralized: `api(path, opts)` in nav.js
- Contract interactions grouped by functionality: purchase, claim, utilities

**Defensive Programming:**
- Element existence checks before DOM access: `if (!btn) return`
- Optional chaining on objects: `player && player.referral_code`
- Silent failures in non-critical operations: `catch(function () {})`

**Configuration as Code:**
- Constants at module top (not env files): `CONTRACTS`, `CHAIN_ID`, `ABI`
- Single source of truth for addresses and ABIs
- Testnet vs. mainnet handled via CHAIN_ID constant

---

*Convention analysis: 2026-02-28*
