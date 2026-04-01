// viewer/store-view.js -- Store panel: deity pass catalog with bought indicators

import { formatEth } from './utils.js';

/**
 * render(store, container) -- render or replace store panel in container.
 *
 * @param {object} store  - store object from /day/:day response
 *   { deityPassPurchases: [{ symbolId, price, level }], levelCatalog: [{ symbolId, price }] }
 * @param {HTMLElement} container - parent element to append/replace panel in
 */
export function render(store, container) {
  const panel = document.createElement('div');
  panel.className = 'panel store-panel';

  const header = document.createElement('h2');
  header.textContent = 'Store';
  panel.appendChild(header);

  // Build a Set of symbolIds the player purchased
  const boughtSymbols = new Set(store.deityPassPurchases.map(p => p.symbolId));

  if (store.levelCatalog.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-dim';
    empty.textContent = 'No store items at this level';
    panel.appendChild(empty);
  } else {
    for (const item of store.levelCatalog) {
      const bought = boughtSymbols.has(item.symbolId);
      const row = document.createElement('div');
      row.className = 'info-row' + (bought ? ' info-row--good' : '');

      const labelEl = document.createElement('span');
      labelEl.className = 'info-label';
      labelEl.textContent = `Symbol #${item.symbolId}`;

      const valueEl = document.createElement('span');
      valueEl.className = 'info-value';
      valueEl.textContent = `${formatEth(item.price)} ETH`;

      if (bought) {
        const badge = document.createElement('span');
        badge.className = 'badge-bought';
        badge.textContent = 'Bought';
        valueEl.appendChild(badge);
      }

      row.appendChild(labelEl);
      row.appendChild(valueEl);
      panel.appendChild(row);
    }
  }

  // --- Player's historical purchases section ---
  if (store.deityPassPurchases.length > 0) {
    const historyTitle = document.createElement('h3');
    historyTitle.className = 'section-title';
    historyTitle.textContent = 'Purchase History';
    panel.appendChild(historyTitle);

    for (const p of store.deityPassPurchases) {
      const row = document.createElement('div');
      row.className = 'info-row';

      const labelEl = document.createElement('span');
      labelEl.className = 'info-label';
      labelEl.textContent = `Symbol #${p.symbolId} (Day ${p.level})`;

      const valueEl = document.createElement('span');
      valueEl.className = 'info-value';
      valueEl.textContent = `${formatEth(p.price)} ETH`;

      row.appendChild(labelEl);
      row.appendChild(valueEl);
      panel.appendChild(row);
    }
  }

  // Panel placement: replace existing or append
  const existing = container.querySelector('.store-panel');
  if (existing) {
    existing.replaceWith(panel);
  } else {
    container.appendChild(panel);
  }
}
