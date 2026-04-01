// viewer/activity.js -- Activity panel: lootbox, bets, coinflip, quests, affiliate

import { formatEth } from './utils.js';

/**
 * render(activity, container) -- render or replace activity panel in container.
 *
 * @param {object} activity  - activity object from /day/:day response
 * @param {HTMLElement} container - parent element to append/replace panel in
 */
export function render(activity, container) {
  const panel = document.createElement('div');
  panel.className = 'panel activity-panel';

  const header = document.createElement('h2');
  header.textContent = 'Activity';
  panel.appendChild(header);

  // Check if all activity is empty
  const allEmpty = !activity.lootboxPurchases.length && !activity.bets.length &&
    !activity.coinflip && !activity.quests.length && !activity.affiliateEarnings;

  if (allEmpty) {
    const empty = document.createElement('p');
    empty.className = 'text-dim';
    empty.style.fontSize = '0.8rem';
    empty.textContent = 'No activity at this level';
    panel.appendChild(empty);
  } else {
    // --- a) Lootbox Purchases section ---
    panel.appendChild(makeSectionTitle('Lootbox Purchases'));

    if (activity.lootboxPurchases.length === 0) {
      panel.appendChild(makeDimText('No lootbox activity at this level'));
    } else {
      // Build a Map from lootboxResults keyed by lootboxIndex for correlation
      const resultsByIndex = new Map();
      for (const result of activity.lootboxResults) {
        resultsByIndex.set(result.lootboxIndex, result);
      }

      for (const purchase of activity.lootboxPurchases) {
        const row = document.createElement('div');
        row.className = 'info-row';

        const labelEl = document.createElement('span');
        labelEl.className = 'info-label';
        labelEl.textContent = `Lootbox #${purchase.lootboxIndex ?? '?'}`;

        const valueEl = document.createElement('span');
        valueEl.className = 'info-value';
        let valueParts = [];
        if (purchase.ethSpent && purchase.ethSpent !== '0') {
          valueParts.push(`${formatEth(purchase.ethSpent)} ETH`);
        } else if (purchase.burnieSpent && purchase.burnieSpent !== '0') {
          valueParts.push(`${formatEth(purchase.burnieSpent)} BURNIE`);
        }
        if (purchase.ticketsReceived != null) {
          valueParts.push(`+${purchase.ticketsReceived} tickets`);
        }
        const matched = resultsByIndex.get(purchase.lootboxIndex);
        if (matched) {
          valueParts.push(matched.rewardType);
        }
        valueEl.textContent = valueParts.join(' | ');

        row.appendChild(labelEl);
        row.appendChild(valueEl);
        panel.appendChild(row);
      }
    }

    // --- b) Degenerette Bets section ---
    panel.appendChild(makeSectionTitle('Degenerette Bets'));

    if (activity.bets.length === 0) {
      panel.appendChild(makeDimText('No bet activity at this level'));
    } else {
      // Build a Map from betResults keyed by betId for correlation
      const resultsByBetId = new Map();
      for (const result of activity.betResults) {
        resultsByBetId.set(result.betId, result);
      }

      for (const bet of activity.bets) {
        const row = document.createElement('div');
        row.className = 'info-row';

        const labelEl = document.createElement('span');
        labelEl.className = 'info-label';
        labelEl.textContent = `Bet #${bet.betIndex}`;

        const valueEl = document.createElement('span');
        valueEl.className = 'info-value';
        const matched = resultsByBetId.get(bet.betId);
        if (matched) {
          let val = matched.resultType;
          if (matched.payout && matched.payout !== '0') {
            val += ` -- ${formatEth(matched.payout)} ETH`;
          }
          valueEl.textContent = val;
        } else {
          valueEl.textContent = 'Pending';
        }

        row.appendChild(labelEl);
        row.appendChild(valueEl);
        panel.appendChild(row);
      }
    }

    // --- c) Coinflip section ---
    panel.appendChild(makeSectionTitle('Coinflip'));

    if (!activity.coinflip) {
      panel.appendChild(makeDimText('No coinflip at this level'));
    } else {
      const cf = activity.coinflip;
      const row = document.createElement('div');
      row.className = 'info-row' + (cf.win === true ? ' info-row--good' : '');

      const labelEl = document.createElement('span');
      labelEl.className = 'info-label';
      labelEl.textContent = `Stake: ${formatEth(cf.stakeAmount)} ETH`;

      const valueEl = document.createElement('span');
      valueEl.className = 'info-value';
      let winText = cf.win === true ? 'Won' : cf.win === false ? 'Lost' : 'Pending';
      if (cf.win === true && cf.rewardPercent != null) {
        winText += ` (${cf.rewardPercent}%)`;
      }
      valueEl.textContent = winText;

      row.appendChild(labelEl);
      row.appendChild(valueEl);
      panel.appendChild(row);
    }

    // --- d) Quests section ---
    panel.appendChild(makeSectionTitle('Quests'));

    if (activity.quests.length === 0) {
      panel.appendChild(makeDimText('No quest activity at this level'));
    } else {
      for (const quest of activity.quests) {
        const row = document.createElement('div');
        row.className = 'info-row' + (quest.completed ? ' info-row--good' : '');

        const labelEl = document.createElement('span');
        labelEl.className = 'info-label';
        labelEl.textContent = `Quest (slot ${quest.slot})`;

        const valueEl = document.createElement('span');
        valueEl.className = 'info-value';
        const prog = parseInt(quest.progress);
        const tgt = parseInt(quest.target);
        let questText = `${prog}/${tgt}`;
        if (quest.completed) {
          questText += ' -- Complete';
        }
        valueEl.textContent = questText;

        row.appendChild(labelEl);
        row.appendChild(valueEl);
        panel.appendChild(row);
      }
    }

    // --- e) Affiliate Earnings section ---
    panel.appendChild(makeSectionTitle('Affiliate Earnings'));

    if (!activity.affiliateEarnings) {
      panel.appendChild(makeDimText('No affiliate earnings at this level'));
    } else {
      const row = document.createElement('div');
      row.className = 'info-row';

      const labelEl = document.createElement('span');
      labelEl.className = 'info-label';
      labelEl.textContent = 'Total Earned';

      const valueEl = document.createElement('span');
      valueEl.className = 'info-value';
      valueEl.textContent = `${formatEth(activity.affiliateEarnings.totalEarned)} ETH`;

      row.appendChild(labelEl);
      row.appendChild(valueEl);
      panel.appendChild(row);
    }
  }

  // Panel placement: replace existing or append
  const existing = container.querySelector('.activity-panel');
  if (existing) {
    existing.replaceWith(panel);
  } else {
    container.appendChild(panel);
  }
}

// --- Helpers ---

function makeSectionTitle(text) {
  const h3 = document.createElement('h3');
  h3.className = 'section-title';
  h3.textContent = text;
  return h3;
}

function makeDimText(text) {
  const p = document.createElement('p');
  p.className = 'text-dim';
  p.textContent = text;
  return p;
}
