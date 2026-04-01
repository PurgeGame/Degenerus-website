// viewer/dashboard.js -- Dashboard panel: token holdings and Chart.js ticket sparkline
// DASH-01, DASH-02: tickets, future stock, balances, sparkline
// No ethers dependency -- uses formatEth/formatBurnie from utils.js (SHELL-01)

import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler } from 'chart.js';
import { truncateAddress, formatEth, formatBurnie } from './utils.js';

// Register Chart.js components at module level (once)
Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler);

// Module-level chart instance -- prevents "Canvas is already in use" error
let sparklineChart = null;

/**
 * clearChart() -- destroy sparkline chart instance if it exists.
 * Call this before clearing contentEl.innerHTML on player change to prevent Chart.js orphan canvas.
 */
export function clearChart() {
  if (sparklineChart) {
    sparklineChart.destroy();
    sparklineChart = null;
  }
}

/**
 * render(data, container) -- render or replace dashboard panel in container.
 *
 * @param {object} data
 * @param {object} data.holdings  - holdings object from /day/:day response
 *                                  { tickets, totalMintedOnLevel, balances: [{ contract, balance }] }
 * @param {Array}  data.daysData  - array from getDaysData() in scrubber.js
 *                                  each entry: { day, level, ticketCount, ... }
 * @param {HTMLElement} container - parent element to append/replace panel in
 */
export function render(data, container) {
  const { holdings, daysData } = data;

  // --- Build panel ---
  const panel = document.createElement('div');
  panel.className = 'panel dashboard-panel';

  // Panel header
  const header = document.createElement('h2');
  header.textContent = 'Dashboard';
  panel.appendChild(header);

  // --- Holdings section ---
  const holdingsSection = document.createElement('div');
  holdingsSection.className = 'dashboard-holdings';

  // Row: Tickets
  holdingsSection.appendChild(makeInfoRow(
    'Tickets',
    holdings.tickets != null ? String(holdings.tickets) : '\u2014'
  ));

  // Row: Minted This Level
  holdingsSection.appendChild(makeInfoRow(
    'Minted This Level',
    holdings.totalMintedOnLevel != null ? String(holdings.totalMintedOnLevel) : '\u2014'
  ));

  // Rows: Token balances
  if (holdings.balances && holdings.balances.length > 0) {
    for (const entry of holdings.balances) {
      const label = formatContractLabel(entry.contract);
      const value = formatContractBalance(entry.contract, entry.balance);
      holdingsSection.appendChild(makeInfoRow(label, value));
    }
  }

  panel.appendChild(holdingsSection);

  // --- Sparkline section ---
  const sparklineWrapper = document.createElement('div');
  sparklineWrapper.className = 'dashboard-sparkline';
  sparklineWrapper.style.marginTop = '1rem';

  const sparklineLabel = document.createElement('div');
  sparklineLabel.className = 'info-label';
  sparklineLabel.style.fontSize = '0.72rem';
  sparklineLabel.style.fontWeight = '700';
  sparklineLabel.style.textTransform = 'uppercase';
  sparklineLabel.style.letterSpacing = '0.1em';
  sparklineLabel.style.marginBottom = '0.5rem';
  sparklineLabel.textContent = 'Ticket History';
  sparklineWrapper.appendChild(sparklineLabel);

  const canvas = document.createElement('canvas');
  canvas.style.height = '80px';
  canvas.style.width = '100%';
  sparklineWrapper.appendChild(canvas);
  panel.appendChild(sparklineWrapper);

  // --- Replace or append panel ---
  const existing = container.querySelector('.dashboard-panel');
  if (existing) {
    existing.replaceWith(panel);
  } else {
    container.appendChild(panel);
  }

  // --- Destroy previous chart before creating new one ---
  if (sparklineChart) {
    sparklineChart.destroy();
    sparklineChart = null;
  }

  // --- Build Chart.js sparkline ---
  const labels = (daysData || []).map(d => d.day);
  const ticketData = (daysData || []).map(d => d.ticketCount ?? 0);

  sparklineChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: ticketData,
        borderColor: '#f5a623',
        backgroundColor: 'rgba(245,166,35,0.08)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
      scales: {
        x: { display: false },
        y: { display: false, beginAtZero: true },
      },
    },
  });
}

// --- Helpers ---

/**
 * Create a .info-row div with label and value spans.
 */
function makeInfoRow(label, value) {
  const row = document.createElement('div');
  row.className = 'info-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'info-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'info-value';
  valueEl.textContent = value;

  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

/**
 * Determine a human-readable display name for a contract address.
 * We don't have canonical contract addresses at this layer, so use heuristics.
 * Cosmetic only -- the important part is the formatted balance.
 */
function formatContractLabel(contract) {
  // Fallback: show truncated address with "Token" prefix
  return `Token (${truncateAddress(contract)})`;
}

/**
 * Format balance for a given contract. Default to ETH formatting.
 * For known contract patterns, could use formatBurnie, but we default to formatEth
 * as a safe display for all unknown contracts.
 */
function formatContractBalance(contract, balance) {
  // Safe default: format as ETH wei string
  return formatEth(balance) + ' ETH';
}
