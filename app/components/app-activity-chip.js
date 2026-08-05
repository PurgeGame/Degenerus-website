// /app/components/app-activity-chip.js — activity score in the nav (user ask).
//
// A pill beside the DAY / level chips showing the odds multiplier, with the
// score breakdown on hover and a background that reports PRIMARY DAILY QUEST
// status at a glance:
//
//   green   primary quest done for the day (or delivered by an afKing sub)
//   amber   not done yet; the day is still open
//   neutral unknown (no wallet, definitions unavailable) — deliberately NOT
//           amber, because "we don't know" must not read as "you missed it"
//
// PRIMARY ONLY, and that is not a simplification: slot 0 is unconditionally
// MINT_ETH (DegenerusQuests.sol:450), which is exactly what an afKing sub does
// every funded day, so a subscriber's primary rides along without filing a
// quest_progress row. The SECONDARY slot (coinflip, degenerette, decimator, …)
// is never handled for you — GameAfkingModule.recordAfkingSecondary exists to
// record it as the player's own effort, and its doc draws the line explicitly:
// "the primary rides the funded delivered days". So the chip going green never
// means "all your quests are done". The protocol's own sDGNRS account is one of
// these subscribers. That decision is made once, in
// app-quest-panel.js #publishPrimaryStatus, and published on `ui.primaryQuest`;
// this chip only paints what it is told. Two components deriving "is the
// primary done?" independently would eventually disagree, and the disagreement
// would be invisible.
//
// The hover panel reuses the activity panel's numbers rather than re-deriving
// them: same /player/:address scoreBreakdown, same points → score maths.
//
// Mount: <app-activity-chip> is NOT in index.html — like the day chip it is
// injected into the nav at runtime (shared/nav.js builds the nav after parse),
// so there is no markup to hang it off declaratively.

import { get, subscribe, getViewedAddress } from '../app/store.js';
import { fetchJSON } from '../app/api.js';
import { questStreakScorePoints } from '../app/activity-score.js';

const POLL_INTERVAL_MS = 30_000;

// Same component list + captions as the activity panel's breakdown rows.
// Curse is NOT here on purpose: it is a penalty most players never carry, and a
// permanent "Curse 0" row invites the question "am I cursed?" on every hover.
// It is appended below only when non-zero, which is what the full panel does
// (app-activity-panel.js: `if (curse !== 0)`), under the same label.
const COMPONENTS = [
  { key: 'questStreakPoints', label: 'Quest streak' },
  { key: 'mintLevelStreakPoints', label: 'Level streak' },
  { key: 'mintCountPoints', label: 'Mint count' },
  { key: 'affiliatePoints', label: 'Affiliate' },
];

function _setIntervalUnref(fn, ms) {
  const h = setInterval(fn, ms);
  if (h && typeof h.unref === 'function') {
    try { h.unref(); } catch (_) { /* defensive */ }
  }
  return h;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

class AppActivityChip extends HTMLElement {
  #unsubs = [];
  #initialized = false;
  #score = null;
  #pollHandle = null;
  #fetchSeq = 0;

  connectedCallback() {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#renderShell();

    this.#unsubs.push(subscribe('connected.address', () => this.#refresh()));
    this.#unsubs.push(subscribe('viewing.address', () => this.#refresh()));
    this.#unsubs.push(subscribe('ui.mode', () => this.#refresh()));
    // Repaint on quest status without refetching the score.
    this.#unsubs.push(subscribe('ui.primaryQuest', () => this.#paint()));

    this.#pollHandle = _setIntervalUnref(() => this.#refresh(), POLL_INTERVAL_MS);
    this.#refresh();
  }

  disconnectedCallback() {
    this.#unsubs.forEach((fn) => { try { fn(); } catch (_) { /* defensive */ } });
    this.#unsubs = [];
    if (this.#pollHandle) clearInterval(this.#pollHandle);
    this.#initialized = false;
  }

  #renderShell() {
    this.innerHTML = `
      <span class="unav-day unav-activity" data-bind="ac-chip" tabindex="0">
        <span class="unav-activity__value" data-bind="ac-value">—</span>
      </span>
      <div class="ac-pop" data-bind="ac-pop" hidden>
        <div class="ac-pop__head" data-bind="ac-pop-head"></div>
        <div class="ac-pop__rows" data-bind="ac-pop-rows"></div>
        <div class="ac-pop__quest" data-bind="ac-pop-quest"></div>
      </div>
    `;
  }

  async #refresh() {
    const addr = (typeof getViewedAddress === 'function' ? getViewedAddress() : null)
      || get('viewing.address') || get('connected.address') || null;
    const seq = ++this.#fetchSeq;
    if (!addr || get('ui.mode') === 'combined') { this.#score = null; this.#paint(); return; }
    try {
      const data = await fetchJSON(`/player/${addr}`);
      if (seq !== this.#fetchSeq) return;
      this.#score = data?.scoreBreakdown || null;
    } catch (_e) {
      this.#score = null;
    }
    this.#paint();
  }

  #paint() {
    const chip = this.querySelector('[data-bind="ac-chip"]');
    const valueEl = this.querySelector('[data-bind="ac-value"]');
    if (!chip || !valueEl) return;

    const points = this.#score ? num(this.#score.totalBps) : null;
    valueEl.textContent = points == null ? '—' : `${(points / 100).toFixed(2)}×`;

    // Background = primary quest status. `completed: null` is unknown, and stays
    // neutral rather than accusing the player of a miss.
    const pq = get('ui.primaryQuest');
    const state = !pq || pq.completed == null ? 'unknown' : (pq.completed ? 'done' : 'todo');
    if (chip.classList) {
      chip.classList.toggle('unav-activity--done', state === 'done');
      chip.classList.toggle('unav-activity--todo', state === 'todo');
      chip.classList.toggle('unav-activity--unknown', state === 'unknown');
    }
    chip.setAttribute('title', state === 'done'
      ? (pq && pq.afking ? 'Primary daily quest handled by your afKing subscription' : 'Primary daily quest complete')
      : state === 'todo' ? 'Primary daily quest NOT complete' : 'Daily quest status unknown');

    this.#paintPop(points, state, pq);
  }

  #paintPop(points, state, pq) {
    const head = this.querySelector('[data-bind="ac-pop-head"]');
    const rows = this.querySelector('[data-bind="ac-pop-rows"]');
    const quest = this.querySelector('[data-bind="ac-pop-quest"]');
    if (!head || !rows || !quest) return;

    head.textContent = points == null
      ? 'No activity score yet'
      : `${(points / 100).toFixed(2)}× odds multiplier · ${points} pts`;

    if (typeof rows.replaceChildren === 'function') rows.replaceChildren();
    else { rows.children = []; rows._innerHTML = ''; }

    if (this.#score) {
      // Bars are scaled against the largest component present, so the shape of
      // the score reads at a glance without needing per-component caps here
      // (the full panel owns those).
      const vals = COMPONENTS.map((c) => ({
        label: c.label,
        pts: c.key === 'questStreakPoints'
          ? questStreakScorePoints(this.#score)
          : num(this.#score[c.key]),
      }));
      if (this.#score.passBonus && num(this.#score.passBonus.points) !== 0) {
        vals.push({ label: 'Pass bonus', pts: num(this.#score.passBonus.points) });
      }
      // Only for the actually-cursed. Negative points, so it renders with the
      // negative modifier rather than pretending to be a contribution.
      const curse = num(this.#score.cursePoints);
      if (curse !== 0) vals.push({ label: 'Cashout curse', pts: curse, negative: true });
      const max = vals.reduce((m, v) => Math.max(m, Math.abs(v.pts)), 0) || 1;
      for (const v of vals) {
        const row = document.createElement('div');
        row.className = v.negative ? 'ac-pop__row ac-pop__row--neg' : 'ac-pop__row';
        const label = document.createElement('span');
        label.className = 'ac-pop__label';
        label.textContent = v.label;
        const bar = document.createElement('span');
        bar.className = 'ac-pop__bar';
        const fill = document.createElement('span');
        fill.className = 'ac-pop__fill';
        fill.style.width = `${Math.round((Math.abs(v.pts) / max) * 100)}%`;
        bar.appendChild(fill);
        const pts = document.createElement('span');
        pts.className = 'ac-pop__pts';
        pts.textContent = String(v.pts);
        row.appendChild(label);
        row.appendChild(bar);
        row.appendChild(pts);
        rows.appendChild(row);
      }
    }

    quest.className = `ac-pop__quest ac-pop__quest--${state}`;
    quest.textContent = state === 'done'
      ? (pq && pq.afking ? 'Primary daily quest: handled by afKing' : 'Primary daily quest: complete')
      : state === 'todo' ? 'Primary daily quest: not complete'
      : 'Primary daily quest: unknown';
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-activity-chip')) {
  customElements.define('app-activity-chip', AppActivityChip);
}

// Inject into the nav once it exists (shared/nav.js builds it at runtime).
// Placed after the level/phase chip so the nav reads day → level → activity.
function mountIntoNav() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
  if (document.querySelector('app-activity-chip')) return;
  const host = document.querySelector('.nav-right') || document.querySelector('.nav-left');
  if (!host) return;
  const el = document.createElement('app-activity-chip');
  const anchor = document.getElementById ? (document.getElementById('unav-state') || document.getElementById('unav-day')) : null;
  try {
    if (anchor && anchor.parentNode === host) host.insertBefore(el, anchor.nextSibling);
    else host.insertBefore(el, host.firstChild);
  } catch (_e) { host.appendChild(el); }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(mountIntoNav, 0));
  else setTimeout(mountIntoNav, 0);
  // The state chip appears on the first poll payload, after this module runs —
  // retry briefly so the chip lands to the right of it rather than ahead.
  let tries = 0;
  const t = setInterval(() => { mountIntoNav(); if (++tries > 20 || document.querySelector('app-activity-chip')) clearInterval(t); }, 500);
  if (t && typeof t.unref === 'function') { try { t.unref(); } catch (_) { /* defensive */ } }
}

export const _testing = { COMPONENTS, num };
