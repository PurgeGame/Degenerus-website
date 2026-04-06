// components/quest-panel.js -- Quest panel Custom Element
// Daily quest slots with progress bars, streak display, and shield count.
// All contract interaction delegated to quests.js (no ethers import here).

import { subscribe, get } from '../app/store.js';
import { getQuestProgress } from '../app/quests.js';
import { fetchPlayerData } from '../app/api.js';

class QuestPanel extends HTMLElement {
  #unsubs = [];

  connectedCallback() {
    this.innerHTML = `
      <div class="panel quest-panel" hidden>
        <h3>Daily Quests</h3>
        <div class="quest-streak">
          <span class="streak-count">0 day streak</span>
          <span class="streak-shields">0 shields</span>
        </div>
        <div class="quest-slots">
          <div class="quest-slot quest-slot-primary">
            <div class="quest-label">
              <span class="quest-type">--</span>
              <span class="quest-difficulty"></span>
            </div>
            <div class="quest-progress-bar"><div class="quest-progress-fill" style="width:0%"></div></div>
            <span class="quest-target">--</span>
          </div>
          <div class="quest-slot quest-slot-secondary">
            <div class="quest-label">
              <span class="quest-type">--</span>
              <span class="quest-difficulty"></span>
            </div>
            <div class="quest-progress-bar"><div class="quest-progress-fill" style="width:0%"></div></div>
            <span class="quest-target">--</span>
          </div>
        </div>
        <p class="quest-slot0-note text-dim">Complete the primary quest first for streak credit</p>
      </div>
    `;

    // -- Store Subscriptions --

    // On wallet connect, fetch quest state
    this.#unsubs.push(
      subscribe('player.address', (address) => {
        if (address) {
          fetchPlayerData(address);
        }
      })
    );

    // Update quest slots and streak display on quest state changes
    this.#unsubs.push(
      subscribe('quest', (q) => {
        if (!q) return;
        this.#renderQuests(q);
      })
    );

    // Update shield count from player data
    this.#unsubs.push(
      subscribe('player.shields', (shields) => {
        const el = this.querySelector('.streak-shields');
        if (el) el.textContent = `${shields || 0} shields`;
      })
    );
  }

  disconnectedCallback() {
    this.#unsubs.forEach(fn => fn());
    this.#unsubs = [];
  }

  // -- Private methods --

  #renderQuests(q) {
    const panel = this.querySelector('.quest-panel');
    if (!panel) return;

    // Panel visibility: show when at least one slot is non-null
    const hasQuests = q.slots && (q.slots[0] !== null || q.slots[1] !== null);
    panel.hidden = !hasQuests;

    if (!hasQuests) return;

    // Streak display
    const streakEl = this.querySelector('.streak-count');
    if (streakEl) {
      streakEl.textContent = `${q.baseStreak} day streak`;
    }

    // Render each slot
    const slotEls = this.querySelectorAll('.quest-slot');
    for (let i = 0; i < 2; i++) {
      const slotEl = slotEls[i];
      if (!slotEl) continue;

      const info = getQuestProgress(i);
      const typeEl = slotEl.querySelector('.quest-type');
      const diffEl = slotEl.querySelector('.quest-difficulty');
      const fillEl = slotEl.querySelector('.quest-progress-fill');
      const targetEl = slotEl.querySelector('.quest-target');

      if (!info) {
        // No quest in this slot
        if (typeEl) typeEl.textContent = '--';
        if (diffEl) diffEl.textContent = '';
        if (fillEl) fillEl.style.width = '0%';
        if (targetEl) targetEl.textContent = '--';
        slotEl.classList.remove('completed');
        continue;
      }

      if (typeEl) typeEl.textContent = (i === 0 ? 'Primary: ' : '') + info.type;
      if (diffEl) diffEl.textContent = info.highDifficulty ? 'HARD' : '';
      if (fillEl) fillEl.style.width = `${Math.round(info.progress)}%`;
      if (targetEl) targetEl.textContent = info.completed ? 'Complete' : info.target;

      if (info.completed) {
        slotEl.classList.add('completed');
      } else {
        slotEl.classList.remove('completed');
      }
    }
  }
}

customElements.define('quest-panel', QuestPanel);
