/**
 * Lootbox box-spin outcome feed.
 *
 * Renders the full result of every lootbox open that resolved as Degenerette-style
 * spins (the contract's packed `BoxSpin` event, decoded by the indexer into
 * `box_spins`). Each spin shows the player's reel vs the rolled reel as trait
 * badges, the composite score S (0-9), and the payout (WWXRP / FLIP×3-survival / ETH).
 *
 * Source: GET /lootbox/box-spins → { items:[{ player, spinType, spinCount, survived,
 *   payout, ethShare, reels:[{ spinIndex, score, playerTraits[], resultTraits[] }] }],
 *   nextCursor }.  reels[].*Traits are pre-decoded {quadrant,color,symbol}.
 */

import { fetchJSON } from '../app/api.js';
import { badgeCircularPath, BADGE_QUADRANTS } from '../app/constants.js';
import { formatEth } from '../app/utils.js';

const SPIN_LABEL = { wwxrp: 'WWXRP', flip: 'FLIP ×3', eth: 'ETH' };
const PAGE = 25;

function traitBadge(t) {
  const cat = BADGE_QUADRANTS[t.quadrant] ?? BADGE_QUADRANTS[0];
  const src = badgeCircularPath(cat, t.symbol, t.color);
  return `<img class="lsp-badge" src="${src}" alt="${cat} ${t.symbol}/${t.color}" loading="lazy">`;
}

function reelRow(reel) {
  const win = reel.score >= 7;
  return `
    <div class="lsp-reel${win ? ' lsp-win' : ''}">
      <span class="lsp-side">YOU</span>
      <span class="lsp-traits">${reel.playerTraits.map(traitBadge).join('')}</span>
      <span class="lsp-vs">vs</span>
      <span class="lsp-traits">${reel.resultTraits.map(traitBadge).join('')}</span>
      <span class="lsp-score" title="Match score (0-9): hero symbol counts ×2; a color scores only when its own symbol matched">S${reel.score}</span>
    </div>`;
}

function spinCard(s) {
  const isEth = s.spinType === 'eth';
  const tokenLabel = isEth ? 'ETH' : (s.spinType === 'wwxrp' ? 'WWXRP' : 'FLIP');
  const won = s.payout !== '0';
  const payoutStr = won ? `+${formatEth(s.payout)} ${tokenLabel}` : 'no payout';
  const survivedTag = s.spinType === 'flip' && s.survived != null
    ? `<span class="lsp-flip ${s.survived ? 'lsp-survived' : 'lsp-busted'}">${s.survived ? 'SURVIVED ×2' : 'BUSTED'}</span>`
    : '';
  const ethShareTag = isEth && s.ethShare !== '0'
    ? `<span class="lsp-ethshare">${formatEth(s.ethShare)} ETH claimable</span>` : '';
  const addr = `${s.player.slice(0, 6)}…${s.player.slice(-4)}`;
  return `
    <div class="lsp-card">
      <div class="lsp-head">
        <span class="lsp-type lsp-type-${s.spinType}">${SPIN_LABEL[s.spinType] ?? s.spinType}</span>
        <span class="lsp-addr" title="${s.player}">${addr}</span>
        <span class="lsp-payout ${won ? 'lsp-won' : ''}">${payoutStr}</span>
        ${survivedTag}${ethShareTag}
      </div>
      <div class="lsp-reels">${s.reels.map(reelRow).join('')}</div>
    </div>`;
}

const STYLE = `
  .lootbox-spins-panel .lsp-list { display:flex; flex-direction:column; gap:10px; }
  .lsp-card { background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.08); border-radius:10px; padding:10px 12px; }
  .lsp-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px; font-size:.85rem; }
  .lsp-type { font-weight:700; letter-spacing:.04em; padding:2px 8px; border-radius:6px; }
  .lsp-type-eth { background:#1f4f8b; } .lsp-type-flip { background:#7a3a12; } .lsp-type-wwxrp { background:#155e4f; }
  .lsp-addr { color:#9aa3b2; font-family:monospace; }
  .lsp-payout { margin-left:auto; color:#9aa3b2; } .lsp-payout.lsp-won { color:#5fd38a; font-weight:700; }
  .lsp-flip { padding:1px 7px; border-radius:5px; font-size:.72rem; font-weight:700; }
  .lsp-survived { background:#1f6b3a; color:#bdf5cf; } .lsp-busted { background:#5c1f1f; color:#f5bdbd; }
  .lsp-ethshare { color:#8fb8e6; font-size:.75rem; }
  .lsp-reels { display:flex; flex-direction:column; gap:6px; }
  .lsp-reel { display:flex; align-items:center; gap:8px; padding:4px 6px; border-radius:7px; }
  .lsp-reel.lsp-win { background:rgba(95,211,138,.10); }
  .lsp-side { width:30px; color:#7d8595; font-size:.7rem; font-weight:700; }
  .lsp-vs { color:#6b7280; font-size:.72rem; }
  .lsp-traits { display:inline-flex; gap:3px; }
  .lsp-badge { width:26px; height:26px; border-radius:50%; }
  .lsp-score { margin-left:auto; font-weight:700; font-size:.8rem; color:#c9a227; }
  .lsp-reel.lsp-win .lsp-score { color:#5fd38a; }
  .lsp-more { margin-top:10px; }
  .lsp-empty, .lsp-err { color:#7d8595; padding:8px 0; font-size:.85rem; }
`;

class LootboxSpinsPanel extends HTMLElement {
  #cursor = null;
  #items = [];

  connectedCallback() {
    if (!document.getElementById('lsp-style')) {
      const st = document.createElement('style');
      st.id = 'lsp-style';
      st.textContent = STYLE;
      document.head.appendChild(st);
    }
    this.innerHTML = `
      <div class="panel lootbox-spins-panel">
        <div class="panel-header"><h2>LOOTBOX SPINS</h2></div>
        <div class="lsp-list" data-list></div>
        <div class="lsp-empty" data-empty hidden>No box spins indexed yet.</div>
        <button class="lsp-more" data-more hidden>Load more</button>
      </div>`;
    this.querySelector('[data-more]').addEventListener('click', () => this.#load());
    this.#load();
  }

  async #load() {
    try {
      const qs = `?limit=${PAGE}${this.#cursor != null ? `&before=${this.#cursor}` : ''}`;
      const res = await fetchJSON(`/lootbox/box-spins${qs}`);
      this.#items.push(...res.items);
      this.#cursor = res.nextCursor;
      this.#render();
    } catch (err) {
      const list = this.querySelector('[data-list]');
      if (list) list.innerHTML = `<div class="lsp-err">Failed to load box spins: ${err.message}</div>`;
    }
  }

  #render() {
    const list = this.querySelector('[data-list]');
    const empty = this.querySelector('[data-empty]');
    const more = this.querySelector('[data-more]');
    list.innerHTML = this.#items.map(spinCard).join('');
    empty.hidden = this.#items.length > 0;
    more.hidden = this.#cursor == null;
  }
}

customElements.define('lootbox-spins-panel', LootboxSpinsPanel);
