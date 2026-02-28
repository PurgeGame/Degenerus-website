# Technology Stack

**Analysis Date:** 2026-02-28

## Languages

**Primary:**
- JavaScript (ES6+) - Client-side UI, contract interactions, mint module (`/beta/mint.js`, `/shared/nav.js`)
- HTML5 - Page structure and templates (`/beta/index.html`, `/whitepaper/index.html`, `/lootbox/index.html`)
- CSS3 - Styling via imported stylesheets (`/shared/nav.css`)
- Python 3 - Event indexing and data processing (`/event-indexer/event_indexer.py`)

**Secondary:**
- JSON - Contract ABIs, deployment configs, fixture data (`/db/deployment.json`, `/beta/jackpot-data.json`)
- Markdown - Documentation (`GAME_THEORY_ANALYSIS.md`)

## Runtime

**Environment:**
- Node.js (implied by `node` CLI usage in db scripts)
- Python 3.x (for event indexer)
- Browser runtime (ES6+ compatible)

**Package Manager:**
- npm (inferred from `.js` module structure)
- pip (for Python dependencies)

## Frameworks

**Core:**
- ethers.js v6 - Web3 contract interaction and transaction signing
  - Loaded via ESM shim: `https://esm.sh/ethers@6` (`/beta/index.html`)
  - Used for: contract calls, wallet connection, transaction formatting, encoding/decoding
  - Location: `window.ethers` global

**Build/Dev:**
- None detected - Static HTML site with vanilla JavaScript
- No bundler (webpack, Vite, etc.) - scripts loaded directly in HTML

**Testing:**
- No test framework detected

**Backend Utilities:**
- web3.py - Ethereum RPC interaction for event indexing
- websockets - WebSocket support for RPC subscriptions (`/event-indexer/event_indexer.py`)

## Key Dependencies

**Critical (Web3):**
- ethers v6 (major) - Contract ABI handling, human-readable format parsing, transaction encoding
  - Why: Core dependency for mint module, affiliate system, wallet connection
  - Location: `window.ethers` via ESM shim, used throughout `/beta/mint.js`

**Infrastructure (Event Indexing):**
- web3 >= 6.0.0 - Web3.py provider and event decoding
  - Location: `/event-indexer/requirements.txt`
  - Used for: RPC HTTP/WS subscriptions, ABI parsing, event log decoding
- websockets >= 10.0 - Async WebSocket client for event subscription
  - Location: `/event-indexer/requirements.txt`
  - Used for: Long-running event stream from blockchain nodes
- hexbytes - Hex encoding/decoding for blockchain data
  - Imported in: `/event-indexer/event_indexer.py`

**Utilities:**
- sqlite3 - Database for event indexing output
  - Location: `/event-indexer/event_indexer.py` (standard library)
  - Used for: Schema creation, event storage, state reconstruction queries

**Documentation:**
- markdown - Markdown to HTML conversion
  - Location: `/build-gta-html.py`
  - Used for: Game theory analysis HTML generation with math protection

## Configuration

**Environment:**
- Python event indexer requires `config.json` with:
  - `rpc_ws` - WebSocket RPC endpoint for event subscription
  - `rpc_http` - HTTP RPC endpoint for batch/backfill operations
  - `db_path` - SQLite database file location
  - `abi_dir` - Directory containing ABI JSON files
  - `contracts` - Mapping of contract names to addresses (Sepolia testnet)
  - See: `/event-indexer/config.example.json`

**Build Configuration:**
- Python markdown build script: `/build-gta-html.py`
  - Converts `GAME_THEORY_ANALYSIS.md` to `GAME_THEORY_ANALYSIS.html`
  - Protects LaTeX math blocks from markdown processing

**Client Configuration:**
- Contract addresses hardcoded in JavaScript:
  - Mint module: `/beta/mint.js` (GAME, COIN, AFFILIATE, QUESTS, DEITY_PASS)
  - Affiliate nav: `/shared/nav.js` (LINK_TOKEN, ADMIN_CONTRACT)
  - Deployment reference: `/db/deployment.json` (all production contract addresses on Sepolia)
- RPC endpoints configured at wallet provider level (MetaMask/injected provider)

## Platform Requirements

**Development:**
- Node.js (for running build scripts like `/db/export-jackpot-data.js`)
- Python 3.x with pip (for event indexer)
- SQLite 3 (CLI and/or Python binding)
- ethers.js v6 compatible browser (Firefox, Chrome, Safari, Edge)
- MetaMask or EIP-1193 wallet provider for Web3 interactions

**Production:**
- Deployment target: Static file hosting (CDN recommended)
  - Tested/recommended hosts: Cloudflare Pages, Vercel, Netlify, S3 + CloudFront
  - Current: GitHub Pages (CNAME file present)
- Event indexer: Standalone Python service with network access to:
  - Sepolia testnet RPC endpoint (WebSocket and HTTP)
  - SQLite database (local or mounted filesystem)

## Database

**Events Database:**
- SQLite schema: `/event-indexer/event_indexer.py` creates tables:
  - `logs` - Raw blockchain logs
  - Event-specific tables (e.g., `jackpot_ticket_wins`, `lootbox_opens`, `trait_entries`, `deity_passes`)
  - State reconstruction tables (e.g., `coinflip_results`, `far_future_coin_jackpots`)
- Query execution: CLI via `sqlite3` command with `-json` flag (see `/db/export-jackpot-data.js`)

**Analysis Database:**
- Contains contract state and analysis results
- Location: `analysis.db` (referenced in `/db/export-jackpot-data.js`)
- Queried by jackpot data export script

**UI Data:**
- JSON snapshot: `/beta/jackpot-data.json` (exported from event/analysis DBs)
- Format: Player stats, ticket counts, jackpot wins, trait ownership, daily draws, coinflip results

## Blockchain Integration

**Network:**
- Sepolia testnet (chainId: 11155111)
- Deployment: See `/db/deployment.json` for all contract addresses

**Key Contract Interactions:**
- DegenerusGame - Main game contract (mint, level progression)
- DegenerusVault - Financial vault (ETH/BURNIE holdings)
- BurnieCoin (COIN) - ERC-20 governance/reward token
- DegenerusJackpots - Jackpot prize distribution
- DegenerusQuests - Quest/achievement tracking
- DegenerusDeityPass - NFT pass for special trait bonuses
- DegenerusAffiliate - Referral code and rake-back system

## External APIs

**API Server:**
- Base: `https://api.degener.us` (defined in `/shared/nav.js`)
- Endpoints:
  - `POST /api/wallet/nonce` - Get signing nonce for wallet auth
  - `POST /api/wallet/verify` - Verify signed nonce, return player data
  - `POST /api/wallet/logout` - Logout session
  - `GET /api/player` - Fetch authenticated player
  - `POST /api/affiliate/config` - Create/update affiliate code
  - `GET /auth/discord/me` - Discord OAuth me endpoint (used for player linking)

**Blockchain Explorers:**
- Etherscan integration for transaction linking: `https://sepolia.etherscan.io/tx/{hash}`

---

*Stack analysis: 2026-02-28*
