# Codebase Structure

**Analysis Date:** 2026-02-28

## Directory Layout

```
/home/zak/Dev/PurgeGame/website/
├── index.html                    # Root redirect to whitepaper
├── README.md                     # Project documentation
├── _headers                      # Netlify/CDN header config
├── CNAME                         # DNS configuration
├── .gitignore                    # Git ignore rules
├── .cfignore                     # Cloudflare ignore rules
├── .claude/                      # Claude AI settings
├── .planning/                    # Planning documents (generated)
├── .git/                         # Git repository
│
├── agents/                       # Agent documentation page
│   └── index.html               # Agent info page with meta-notes
│
├── beta/                         # Beta UI and data exports
│   ├── index.html               # Main beta game interface (149KB)
│   ├── badge-size-mockup.html   # Badge sizing visualization
│   ├── mint.js                  # Minting utility functions (43KB)
│   └── jackpot-data.json        # Jackpot history and player data (74KB)
│
├── db/                          # Data export and analysis
│   ├── export-jackpot-data.js   # Node script to export UI data from SQLite
│   ├── analysis.db              # SQLite DB with tickets and game state (17MB)
│   ├── events.db                # SQLite DB with indexed blockchain events (81MB)
│   └── deployment.json          # Smart contract deployment addresses
│
├── event-indexer/               # Python event indexing tool
│   ├── event_indexer.py         # Main indexer script (43KB)
│   ├── config.example.json      # Configuration template
│   └── requirements.txt          # Python dependencies
│
├── shared/                      # Shared components across pages
│   ├── nav.js                   # Unified navigation (wallet, Discord, referrer)
│   ├── nav.css                  # Navigation styling
│   └── score-info.html          # Reusable score display component
│
├── whitepaper/                  # Whitepaper and protocol docs
│   ├── index.html               # Main whitepaper (61KB)
│   ├── burnie/                  # BURNIE jackpot explanation
│   │   └── index.html           # BURNIE subsection
│   ├── glossary/                # Protocol terminology
│   │   └── index.html           # Glossary subsection
│   ├── flame-logo.svg           # Logo SVG
│   ├── flame-center.svg         # Flame graphic
│   └── badge-t*.svg             # Badge corner decorations
│
├── lootbox/                     # Lootbox simulator page
│   └── index.html               # Interactive lootbox explorer
│
├── degenerette/                 # Degenerette game simulator
│   ├── index.html               # Simulator entry point (9KB)
│   └── assets/                  # Built simulator assets
│
├── assets/                      # Global compiled/bundled assets
│   ├── index-*.js               # Bundled JavaScript chunks
│   └── index-*.css              # Bundled CSS
│
├── badges/                      # Card badge SVG sprites
│   ├── cards_00_horseshoe_*.svg # Horseshoe card variants (8 colors)
│   ├── cards_01_king_*.svg      # King card variants (8 colors)
│   ├── cards_02_cashsack_*.svg  # Cash sack variants (8 colors)
│   ├── cards_03_club_*.svg      # Club variants (8 colors)
│   ├── cards_04_diamond_*.svg   # Diamond variants (8 colors)
│   └── cards_05_heart_*.svg     # Heart variants (8 colors)
│
├── badges-circular/             # Circular badge variants
│   └── [Same card variants as badges/]
│
├── badges-q0/, badges-q1/,      # Quarter-specific badge variants
│ badges-q2/, badges-q3/         # (Quarterly themed versions)
│   └── [Same card variants per quarter]
│
├── symbols/                     # Slot machine symbol sprites
│   ├── cards_00_horseshoe_*.svg # Symbol variants
│   ├── cards_01_king_*.svg
│   ├── cards_02_cashsack_*.svg
│   ├── cards_03_club_*.svg
│   ├── cards_04_diamond_*.svg
│   └── cards_05_heart_*.svg
│
├── specials/                    # Special effect graphics
│   └── [Special animation/effect assets]
│
├── sounds/                      # Audio assets (empty directory)
│
├── GAME_THEORY_ANALYSIS.md      # Game theory math documentation
├── GAME_THEORY_ANALYSIS.html    # Rendered game theory analysis
└── build-gta-html.py            # Python script to build HTML from markdown
```

## Directory Purposes

**Root (`/`):**
- Entry point for the site. Root `index.html` redirects to whitepaper.
- Static site configuration (CNAME, headers, gitignore).

**`agents/`:**
- Standalone page documenting agent info with expected launch dates and meta-notes.
- Single HTML file, no dependencies.

**`beta/`:**
- Live game UI and supporting data for the Degenerus beta.
- `index.html` is the main interactive interface, ~150KB including inline styles and scripts.
- `mint.js` contains wallet interaction and minting utilities.
- `jackpot-data.json` is pre-computed and regenerated via `db/export-jackpot-data.js`.

**`db/`:**
- Data pipeline and SQLite databases.
- `export-jackpot-data.js` is the main script: queries SQLite, exports JSON to `beta/jackpot-data.json`.
- `analysis.db` contains player tickets and game state (17MB).
- `events.db` contains indexed blockchain events (81MB).
- `deployment.json` maps contract addresses to networks.

**`event-indexer/`:**
- Standalone Python tool to index blockchain events into SQLite.
- Runs independently, separate from the web frontend.
- Read README at the top of `event_indexer.py` for CLI usage.

**`shared/`:**
- Reusable components and styling included across multiple pages.
- `nav.js` handles wallet connection, Discord auth, referrer code persistence.
- `nav.css` provides shared styling for navigation and page structure.
- `score-info.html` is a reusable score display component.

**`whitepaper/`:**
- Main protocol documentation and explanation.
- `index.html` is the full whitepaper (~61KB).
- Subsections: `burnie/` (jackpot system), `glossary/` (terminology).
- All SVGs are decorative badges and flame graphics.

**`lootbox/`:**
- Interactive visualization of lootbox mechanics.
- Single standalone HTML page.

**`degenerette/`:**
- The game simulator, copied from `/home/zak/Dev/PurgeGame/degenerette-simulator` build output.
- `index.html` is minimal entry point; assets are bundled JavaScript/CSS.
- Update this directory by rebuilding the simulator repo and copying `dist/` contents here.

**`assets/`:**
- Bundled and minified assets from build tools (Vite or similar).
- Filenames are content-hashed (e.g., `index-CiSsfdL-.js`).
- Never edit directly; regenerate from source.

**`badges/`, `badges-circular/`, `badges-q0/`, `badges-q1/`, `badges-q2/`, `badges-q3/`:**
- SVG card badge sprites in 8 color variants (blue, gold, green, orange, pink, purple, red, silver).
- `badges/` is the default set.
- Quarterly variants (`badges-q0/`, etc.) for seasonal theming.
- `badges-circular/` for circular layout.
- Naming: `cards_XX_[cardname]_[color].svg`

**`symbols/`:**
- Slot machine symbol sprites used in game logic.
- Same card types and color variants as badges.

**`specials/`:**
- Special effect graphics and animations.

**`sounds/`:**
- Currently empty; reserved for audio assets.

## Key File Locations

**Entry Points:**
- `index.html`: Root redirect to `/whitepaper/`
- `/whitepaper/index.html`: Main protocol documentation
- `/beta/index.html`: Beta game UI
- `/degenerette/index.html`: Game simulator
- `/lootbox/index.html`: Lootbox explorer
- `/agents/index.html`: Agent information page

**Configuration:**
- `db/deployment.json`: Smart contract addresses by network
- `event-indexer/config.example.json`: Event indexer configuration template
- `_headers`: Netlify/CDN response headers (caching, security)
- `CNAME`: Domain pointing to GitHub Pages or CDN

**Data Export Scripts:**
- `db/export-jackpot-data.js`: Node.js script to query SQLite and export `beta/jackpot-data.json`
- `build-gta-html.py`: Python script to convert `GAME_THEORY_ANALYSIS.md` to HTML

**Core Logic:**
- `shared/nav.js`: Wallet connection, Discord OAuth, referrer code management
- `beta/mint.js`: Minting and wallet interaction utilities
- `event-indexer/event_indexer.py`: Blockchain event indexing into SQLite

**Testing:**
- No dedicated test files in this codebase (static site).

## Naming Conventions

**Files:**
- HTML pages: `index.html` per directory (no routing, pure static)
- SVG assets: `cards_XX_[cardtype]_[color].svg`
  - XX: two-digit card ID (00-05)
  - cardtype: horseshoe, king, cashsack, club, diamond, heart
  - color: blue, gold, green, orange, pink, purple, red, silver
- JavaScript: descriptive names (e.g., `mint.js`, `nav.js`, `event_indexer.py`)
- JSON data: snake_case with semantic names (e.g., `jackpot-data.json`, `deployment.json`)

**Directories:**
- Feature areas: lowercase with hyphens (e.g., `event-indexer`, `badge-size-mockup`)
- Badge variants: `badges-[qualifier]` pattern (e.g., `badges-q0`, `badges-circular`)
- No camelCase or UPPERCASE in directory names

## Where to Add New Code

**New Feature (Game UI Change):**
- Primary code: `beta/index.html` (embed scripts and styles as needed)
- Data: Add properties to `beta/jackpot-data.json`, update export via `db/export-jackpot-data.js`
- Shared styling/nav: Update `shared/nav.css` and `shared/nav.js`

**New Documentation Page:**
- Create a new directory (e.g., `/faq/`)
- Add `index.html` with shared nav include: `<link rel="stylesheet" href="/shared/nav.css">` and `<script src="/shared/nav.js"></script>`
- Link from `shared/nav.js` if it should appear in main navigation

**New Card/Symbol:**
- Add SVG files to `badges/` and `symbols/` directories following naming: `cards_XX_[cardname]_[color].svg`
- Add corresponding variants to quarterly directories (`badges-q0/`, etc.) if used in seasonal mode

**New Asset/Badge Variant:**
- Add to appropriate `badges-*` directory and `symbols/`
- Update references in `beta/index.html` and any other pages that display badges

**Utilities/Helpers:**
- Wallet/auth logic: extend `shared/nav.js`
- Minting/contract interaction: extend `beta/mint.js`
- One-off scripts: create at root level (e.g., `build-gta-html.py`)

**Data Processing:**
- Add queries to `db/export-jackpot-data.js` if new data needs to be extracted from SQLite
- Ensure output lands in `beta/jackpot-data.json` or new JSON file as needed

## Special Directories

**`.planning/`:**
- Purpose: GSD codebase analysis documents (generated)
- Generated: Yes
- Committed: Yes (docs are committed)

**`.claude/`:**
- Purpose: Claude AI project settings and memory
- Generated: Yes (auto-managed)
- Committed: No

**`.git/`:**
- Purpose: Git version control metadata
- Generated: Yes
- Committed: No

**`assets/`:**
- Purpose: Compiled output from bundler (Vite or similar)
- Generated: Yes (via build step)
- Committed: No (or yes if pre-built for deployment)

**`db/`:**
- Purpose: SQLite databases and export scripts
- Generated: Partial (`.db` files are generated by event indexer; `.js` scripts are handwritten)
- Committed: Scripts yes, databases no (add to `.gitignore`)

## Deployment Notes

This is a static site. All HTML, CSS, SVG, JSON, and JavaScript are pre-built and committed. No server-side rendering or build step is required at deploy time.

**Deployment targets:** Cloudflare Pages, Vercel, Netlify, GitHub Pages, S3 + CloudFront.

**CDN caching:** Use `_headers` to set aggressive cache headers on content-hashed assets (e.g., `/assets/*.js`). Set short/no-cache on HTML entry points to ensure users see fresh pages.

---

*Structure analysis: 2026-02-28*
