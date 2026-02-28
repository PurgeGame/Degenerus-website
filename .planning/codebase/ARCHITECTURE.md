# Architecture

**Analysis Date:** 2026-02-28

## Pattern Overview

**Overall:** Multi-page Static Web Application with Client-Side Web3 Integration

**Key Characteristics:**
- Vanilla JavaScript (no build step for core pages)
- Static HTML pages with embedded styling and vanilla JS
- Server API dependency at `https://api.degener.us` (Sepolia testnet)
- Modular pages sharing common UI patterns and navigation
- Ethers.js v6 for blockchain interactions
- SQLite databases for historical data (event indexer outputs)

## Layers

**Presentation Layer (UI):**
- Purpose: Render user interfaces for each product/tool
- Location: `index.html`, `beta/index.html`, `lootbox/index.html`, `degenerette/index.html`, `agents/index.html`, `whitepaper/index.html`
- Contains: HTML structure, embedded CSS, page-specific styling
- Depends on: Shared navigation module, shared CSS design tokens
- Used by: Users interacting with the protocol

**Navigation & Session Layer:**
- Purpose: Unified navigation, wallet connection, Discord auth, affiliate code management
- Location: `shared/nav.js`, `shared/nav.css`
- Contains: DOM building, authentication flows, localStorage for referrals
- Depends on: Window.ethereum (MetaMask), API backend, localStorage
- Used by: All pages that include nav.js

**Business Logic Layer (Game Logic):**
- Purpose: Contract interactions, game state management, minting, betting
- Location: `beta/mint.js`, `beta/index.html` (in-page logic)
- Contains: Contract ABIs, transaction signing, purchase flows, state polling
- Depends on: Ethers.js v6, contract addresses (Sepolia), provider/signer setup
- Used by: Beta page, indirectly by nav.js (Mint module initialization)

**Data Access Layer (API Client):**
- Purpose: Backend API communication for authentication and player data
- Location: `shared/nav.js` (api function)
- Contains: Fetch-based HTTP client with JSON parsing, error handling
- Depends on: `https://api.degener.us`, browser fetch API
- Used by: Navigation module, affiliates flow

**Asset & Utility Layers:**
- Purpose: UI components, simulations, data analysis
- Location: `assets/` (compiled JS bundles), `badges*/` (badge images), `lootbox/` (loot simulator), `event-indexer/` (historical data processing), `db/` (data export)
- Contains: Built assets, generated images, Python utilities for data
- Depends on: Build outputs, database inputs, existing compiled code
- Used by: Presentation and logic layers

## Data Flow

**Wallet Connection Flow:**

1. User clicks "Connect" button in nav
2. `nav.js:connectWallet()` requests accounts from window.ethereum
3. Frontend requests nonce from `/api/wallet/nonce`
4. User signs message with MetaMask (personal_sign)
5. Frontend sends signature to `/api/wallet/verify` with referral code
6. Backend returns player object with session cookie
7. Mint module initialized (if available)
8. UI updates to show connected state

**Purchase Flow (Beta Page):**

1. User selects purchase type (ETH/BURNIE), quantity, lootbox amount
2. `mint.js` reads mint price from contract `purchaseInfo()`
3. Frontend builds transaction via contract.purchase() or purchaseCoin()
4. Signs transaction via connected wallet
5. Tracks RNG lock state and polls for completion
6. Updates local cache with game state
7. Displays success/error to user

**Referral Management Flow:**

1. URL parameter (ref/referral/code) captured by `captureReferrer()`
2. Code stored in localStorage under `degenerette_referrer_code`
3. User connects wallet + Discord
4. Affiliate panel shown
5. User creates affiliate code via `/api/affiliate/config`
6. Code locked to player; can be copied/shared

**Affiliate Link Capture Flow:**

1. External link arrives with `?ref=CODE`
2. `captureReferrer()` parses and stores code
3. URL cleaned (parameters removed)
4. When user connects, referrer info sent to backend
5. Affiliate credit attributed

**State Management:**

- **Session State:** localStorage + in-memory variables in nav.js (`address`, `discord`, `player`)
- **Game State:** Contract-based (level, prices, phase), cached in browser with timestamp validation
- **UI State:** DOM manipulation via `classList.toggle()`, inline style changes
- **Referral State:** localStorage key `degenerette_referrer_code`

## Key Abstractions

**Mint Module (`window.Mint`):**
- Purpose: Encapsulate all contract interactions for the beta page
- Examples: `beta/mint.js`
- Pattern: Immediately-Invoked Function Expression (IIFE) exposing `window.Mint.init()` and other methods
- Responsibilities: Provider setup, contract binding, purchase transactions, state polling, cache management

**Navigation Builder:**
- Purpose: Dynamically construct unified nav DOM across all pages
- Examples: `shared/nav.js:buildNav()` called by `window.initNav()`
- Pattern: IIFE factory building nav elements, managing event listeners
- Responsibilities: DOM creation, page link management, auth button handling

**API Helper:**
- Purpose: Centralized HTTP client for backend communication
- Examples: `shared/nav.js:api()` function
- Pattern: Fetch wrapper with automatic JSON parsing and error extraction
- Responsibilities: Request/response handling, credential cookies, error messaging

**Cache Manager:**
- Purpose: Persist and restore game state locally
- Examples: `beta/mint.js:saveCache()` / `loadCache()`
- Pattern: localStorage serialization with timestamp validation
- Responsibilities: Game state persistence, staleness checking (1-hour TTL)

## Entry Points

**Root Index (`index.html`):**
- Location: `/home/zak/Dev/PurgeGame/website/index.html`
- Triggers: User visits `/`
- Responsibilities: HTTP redirect to `/whitepaper/`

**Whitepaper (`whitepaper/index.html`):**
- Location: `/home/zak/Dev/PurgeGame/website/whitepaper/index.html`
- Triggers: User visits `/whitepaper/`
- Responsibilities: Render protocol documentation, call `window.initNav()`

**Beta Application (`beta/index.html`):**
- Location: `/home/zak/Dev/PurgeGame/website/beta/index.html`
- Triggers: User visits `/beta/`
- Responsibilities: Render interactive game state dashboard, load mint module, call `window.initNav()`

**Degenerette Simulator (`degenerette/index.html`):**
- Location: `/home/zak/Dev/PurgeGame/website/degenerette/index.html`
- Triggers: User visits `/degenerette/`
- Responsibilities: Mount compiled React/Vite application (built from external source)

**Lootbox Simulator (`lootbox/index.html`):**
- Location: `/home/zak/Dev/PurgeGame/website/lootbox/index.html`
- Triggers: User visits `/lootbox/`
- Responsibilities: Render lootbox reward simulator

**Agents Documentation (`agents/index.html`):**
- Location: `/home/zak/Dev/PurgeGame/website/agents/index.html`
- Triggers: User visits `/agents/` or indexed by crawlers
- Responsibilities: Display technical memo for autonomous agents

## Error Handling

**Strategy:** User-visible notifications with graceful degradation

**Patterns:**

- **Network Errors:** `api()` extracts error message from response body, shows in UI via `setAffStatus()` or alert
- **Wallet Errors:** MetaMask errors caught in catch blocks, non-4001 (user cancel) errors alert user
- **Contract Errors:** Try-catch around ethers.js calls, tx status updated via `setTxStatus()`
- **Validation Errors:** Form inputs checked client-side (e.g., affiliate code regex `/^[A-Z0-9]{3,12}$/`)
- **Fallback:** If Web3 not available, alert shown directing to install MetaMask

## Cross-Cutting Concerns

**Logging:** Console.warn/error for development, no production logging framework

**Validation:**
- Affiliate code: 3-12 alphanumeric, uppercase
- Purchase quantities: numeric ranges enforced at contract level
- Chain ID: Hardcoded to Sepolia (11155111), checked before transactions

**Authentication:**
- Wallet: Nonce-based signature verification with backend
- Discord: OAuth via `/auth/discord` redirects
- Session: Backend returns session cookie, checked via `/api/player`

**Design System:**
- Colors: CSS custom properties in `:root` (--accent-primary, --bg-secondary, etc.)
- Fonts: Inter via Google Fonts CDN
- Spacing: Responsive clamp() for padding/margins
- Borders: Consistent 1px solid with --border-color

---

*Architecture analysis: 2026-02-28*
