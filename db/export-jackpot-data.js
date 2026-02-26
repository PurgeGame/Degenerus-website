#!/usr/bin/env node
// Exports jackpot UI data from degenerus-contracts analysis.db + events.db
// to beta/jackpot-data.json
// Run: node db/export-jackpot-data.js (from website root)
// Requires: sqlite3 CLI

const { execSync } = require('child_process');
const { writeFileSync } = require('fs');
const path = require('path');

const RUNS_DIR = process.argv[2] || __dirname;
const ANALYSIS_DB = path.join(RUNS_DIR, 'analysis.db');
const EVENTS_DB = path.join(RUNS_DIR, 'events.db');
const OUT = path.join(__dirname, '..', 'beta', 'jackpot-data.json');

function queryDb(dbPath, sql) {
  const raw = execSync(`sqlite3 -json "${dbPath}" "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  return raw.trim() ? JSON.parse(raw) : [];
}

const qa = (sql) => queryDb(ANALYSIS_DB, sql);
const qe = (sql) => queryDb(EVENTS_DB, sql);

// --- from analysis.db ---

// All distinct players that ever had tickets
const players = qa(
  'SELECT DISTINCT player FROM level_tickets ORDER BY player'
).map(r => r.player);

// Per-player: which levels they have tickets for
const tickets = {};
for (const p of players) {
  const rows = qa(
    `SELECT DISTINCT level FROM level_tickets WHERE player = '${p}' ORDER BY level`
  );
  tickets[p] = rows.map(r => r.level);
}

// Per-player per-level: total whole tickets
const ticketCounts = {};
for (const p of players) {
  const rows = qa(
    `SELECT level, SUM(whole_tickets) as total FROM level_tickets WHERE player = '${p}' GROUP BY level ORDER BY level`
  );
  ticketCounts[p] = {};
  for (const r of rows) {
    ticketCounts[p][r.level] = r.total;
  }
}

// Level summary (all levels with tickets)
const levelSummary = qa(
  'SELECT level, total_whole_tickets, player_count FROM level_summary ORDER BY level'
);

// Find max level that actually has jackpot wins
const maxWinLevel = qa(
  "SELECT MAX(level) as ml FROM jackpot_results WHERE amount_wei IS NOT NULL AND CAST(amount_wei AS REAL) > 0"
)[0]?.ml || 1;

// Build block-to-level/day mapping from daily jackpot results only
// (daily_purchase entries have no day_index so must be excluded)
const blockRanges = qa(
  `SELECT level, day_index, MIN(block_number) as min_block, MAX(block_number) as max_block
   FROM jackpot_results WHERE level <= ${maxWinLevel}
   AND jackpot_type = 'daily' AND day_index IS NOT NULL AND day_index != ''
   GROUP BY level, day_index ORDER BY min_block`
);

function blockToLevelDay(block) {
  // Find the range that contains this block, or the closest one before it
  let best = null;
  for (const r of blockRanges) {
    if (block >= r.min_block && block <= r.max_block) return { level: r.level, day: r.day_index };
    if (r.min_block <= block) best = r;
  }
  return best ? { level: best.level, day: best.day_index } : null;
}

// Per-player per-level per-day: jackpot wins as [amount, type, quadrant] tuples.
// Types: "eth", "burnie", "tickets"
// Quadrant: 0-3 (from trait_id) or -1 (unassigned, e.g. lootbox)
const jackpotWins = {};

function addWin(player, level, day, amount, type, quadrant, extra) {
  if (!jackpotWins[player]) jackpotWins[player] = {};
  if (!jackpotWins[player][level]) jackpotWins[player][level] = {};
  if (!jackpotWins[player][level][day]) jackpotWins[player][level][day] = [];
  const entry = [amount, type, quadrant];
  if (extra !== undefined) entry.push(extra);
  jackpotWins[player][level][day].push(entry);
}

// Primary source: jackpot_ticket_wins (has trait_id → quadrant, currency, game_level).
// game_level = current game level when jackpot fired
// level = ticket pool level (can be up to game_level+4 for BURNIE)
// 4th tuple element = ticket level when it differs from game_level
//
// NOTE: The contract emits duplicate JackpotTicketWinner events (same winner/trait/ticket/amount
// appearing multiple times with different log_indexes). Deduplicate by selecting DISTINCT rows
// before aggregating.
const jtwRows = qa(
  `SELECT d.level, d.game_level, LOWER(d.winner) as player, d.block_number,
    (d.trait_id >> 6) & 3 as quadrant,
    SUM(CAST(d.amount_wei AS REAL))/1e18 as total_amount,
    COUNT(*) as ticket_count,
    d.currency
   FROM (
     SELECT DISTINCT level, game_level, winner, trait_id, ticket_index, amount_wei, currency, block_number
     FROM jackpot_ticket_wins
   ) d
   GROUP BY d.level, d.game_level, d.winner, d.block_number, quadrant, d.currency`
);

// Track which (block, level) combos are covered by jtw so we know where to fallback
const jtwCovered = new Set();
let jtwEthCount = 0, jtwBurnieCount = 0;

for (const r of jtwRows) {
  const ld = blockToLevelDay(r.block_number);
  if (!ld) continue;
  const p = players.find(pl => pl.toLowerCase() === r.player);
  if (!p) continue;
  const amount = parseFloat(r.total_amount.toFixed(6));
  if (amount <= 0) continue;

  const type = r.currency === 'BURNIE' ? 'burnie' : 'eth';
  if (type === 'eth') jtwEthCount++; else jtwBurnieCount++;

  // Include ticket level as 4th element when it differs from game level
  const extra = (r.level !== r.game_level) ? r.level : undefined;
  addWin(p, ld.level, ld.day, amount, type, r.quadrant, extra);
  jtwCovered.add(r.block_number + '-' + r.level);
}

// Fallback: jackpot_results daily ETH for days without jtw per-ticket data (31 days).
// These go as quadrant = -1 (will be distributed in UI).
let jrFallback = 0;
for (const p of players) {
  const rows = qa(
    `SELECT level, day_index, amount_wei, block_number FROM jackpot_results
     WHERE LOWER(winner) = '${p.toLowerCase()}' AND jackpot_type = 'daily'
     AND amount_wei IS NOT NULL AND CAST(amount_wei AS REAL) > 0`
  );
  for (const r of rows) {
    if (jtwCovered.has(r.block_number + '-' + r.level)) continue;
    const ethAmount = parseFloat((parseFloat(r.amount_wei) / 1e18).toFixed(6));
    if (ethAmount <= 0) continue;
    addWin(p, r.level, r.day_index, ethAmount, 'eth', -1);
    jrFallback++;
  }
}

// Lootbox prizes (all types, quadrant = -1)
// Ticket wins include future_level as 4th tuple element: [amount, 'tickets', -1, futureLevel]
const lootboxRows = qa(
  `SELECT LOWER(player) as player,
    CAST(amount AS REAL) / 1e18 as eth,
    CAST(burnie AS REAL) / 1e18 as burnie_eth,
    future_tickets, future_level, block_number
   FROM lootbox_opens
   WHERE CAST(amount AS REAL) > 0 OR CAST(burnie AS REAL) > 0 OR future_tickets > 0`
);

let lootboxAdded = 0;
for (const r of lootboxRows) {
  const ld = blockToLevelDay(r.block_number);
  if (!ld) continue;
  const p = players.find(pl => pl.toLowerCase() === r.player);
  if (!p) continue;
  if (r.eth > 0) { addWin(p, ld.level, ld.day, parseFloat(r.eth.toFixed(6)), 'eth', -1); lootboxAdded++; }
  if (r.burnie_eth > 0) { addWin(p, ld.level, ld.day, parseFloat(r.burnie_eth.toFixed(2)), 'burnie', -1); lootboxAdded++; }
  if (r.future_tickets > 0) { addWin(p, ld.level, ld.day, r.future_tickets, 'tickets', -1, r.future_level); lootboxAdded++; }
}

// Jackpot ticket prizes (auto_rebuy + daily_ticket stage 17, quadrant = -1)
// quantity_scaled / 100 = entries; / 4 = whole tickets (4 entries per ticket)
// Aggregate per (player, target_level, block) first, then merge by day+target_level
const ticketPrizeRows = qa(
  `SELECT LOWER(player) as player, target_level,
    SUM(quantity_scaled) / 400 as total_tickets, block_number
   FROM jackpot_ticket_prizes
   WHERE quantity_scaled > 0
   GROUP BY player, target_level, block_number`
);

// Collect per (player, level, day, target_level) to merge duplicates
const ticketPrizeAcc = {};
for (const r of ticketPrizeRows) {
  const ld = blockToLevelDay(r.block_number);
  if (!ld) continue;
  const p = players.find(pl => pl.toLowerCase() === r.player);
  if (!p) continue;
  if (r.total_tickets <= 0) continue;
  const key = p + '|' + ld.level + '|' + ld.day + '|' + r.target_level;
  ticketPrizeAcc[key] = (ticketPrizeAcc[key] || 0) + r.total_tickets;
}

let ticketPrizesAdded = 0;
for (const key in ticketPrizeAcc) {
  const [p, level, day, targetLevel] = key.split('|');
  addWin(p, parseInt(level), parseInt(day), ticketPrizeAcc[key], 'tickets', -1, parseInt(targetLevel));
  ticketPrizesAdded++;
}

// --- from events.db: per-player per-level trait ownership ---
// trait_id encoding: quadrant * 64 + symbol * 8 + color
// Aggregate to distinct (player, level, quadrant, symbol) then build bitmasks
// Bit i set = player has ≥1 ticket with symbol i in that quadrant

const traitOwnership = {};
const traitCounts = {};
const traitRows = qe(
  `SELECT player_address, level, trait_id, count
  FROM trait_entries WHERE count > 0 AND level <= ${maxWinLevel}
  ORDER BY player_address, level`
);

for (const r of traitRows) {
  const p = r.player_address;
  const level = r.level;
  const quadrant = (r.trait_id >> 6) & 3;
  const symbol = (r.trait_id >> 3) & 7;

  if (!traitOwnership[p]) traitOwnership[p] = {};
  if (!traitOwnership[p][level]) traitOwnership[p][level] = [0, 0, 0, 0];
  traitOwnership[p][level][quadrant] |= (1 << symbol);

  // Sparse map: traitCounts[player][level][trait_id] = count
  if (!traitCounts[p]) traitCounts[p] = {};
  if (!traitCounts[p][level]) traitCounts[p][level] = {};
  traitCounts[p][level][r.trait_id] = r.count;
}

// --- deity pass virtual trait entries ---
// Deity pass token_id = color index. Holder gets virtual Q0 tickets for all 8 symbols
// at that color, at every level they have tickets.
const deityPasses = qa(
  'SELECT token_id, LOWER(owner) as owner FROM deity_passes ORDER BY token_id'
);

for (const dp of deityPasses) {
  const p = players.find(pl => pl.toLowerCase() === dp.owner);
  if (!p) continue;
  const deityColor = dp.token_id;
  // Add virtual entries at every level from 1 to maxWinLevel
  for (let lv = 1; lv <= maxWinLevel; lv++) {
    if (!traitOwnership[p]) traitOwnership[p] = {};
    if (!traitOwnership[p][lv]) traitOwnership[p][lv] = [0, 0, 0, 0];
    // Set all Q0 symbol bits
    traitOwnership[p][lv][0] = 0xFF; // all 8 symbols

    if (!traitCounts[p]) traitCounts[p] = {};
    if (!traitCounts[p][lv]) traitCounts[p][lv] = {};
    for (let sym = 0; sym < 8; sym++) {
      const traitId = 0 * 64 + sym * 8 + deityColor; // Q0
      traitCounts[p][lv][traitId] = (traitCounts[p][lv][traitId] || 0) + 2;
    }
  }
}

// --- backfill trait ownership from actual wins ---
// The trait_entries table can be inaccurate (indexer uses single VRF word instead of per-event
// entropy). If jackpot_ticket_wins says a player won at trait X / level Y, they MUST have owned
// that trait. Ensure traitCounts and traitOwnership reflect this.
const winTraitRows = qa(
  `SELECT DISTINCT LOWER(winner) as player, level, trait_id
   FROM jackpot_ticket_wins
   WHERE is_deity = 0`
);

let backfilled = 0;
for (const r of winTraitRows) {
  const p = players.find(pl => pl.toLowerCase() === r.player);
  if (!p) continue;
  const level = r.level;
  const traitId = r.trait_id;
  const quadrant = (traitId >> 6) & 3;
  const symbol = (traitId >> 3) & 7;

  // Ensure ownership bitmask includes this symbol
  if (!traitOwnership[p]) traitOwnership[p] = {};
  if (!traitOwnership[p][level]) traitOwnership[p][level] = [0, 0, 0, 0];
  traitOwnership[p][level][quadrant] |= (1 << symbol);

  // Ensure count is at least 1
  if (!traitCounts[p]) traitCounts[p] = {};
  if (!traitCounts[p][level]) traitCounts[p][level] = {};
  if (!traitCounts[p][level][traitId]) {
    traitCounts[p][level][traitId] = 1;
    backfilled++;
  }
}

// --- coinflip results per player per day ---
// coinflipResults[player][level][day] = [stake, payout, rewardPercent, win]
// payout > 0 = win (stake * reward% / 100), payout < 0 = loss (-stake)
const coinflipResults = {};

// Map coinflip day → jackpot level/day via block_number, get per-player stakes
const cfRows = qa(
  `SELECT cd.player, cd.day,
    MAX(CAST(cd.new_total AS REAL))/1e18 as total_stake,
    cday.win, cday.reward_percent, cday.block_number
   FROM coinflip_deposits cd
   JOIN coinflip_days cday ON cday.day = cd.day
   GROUP BY cd.player, cd.day`
);

let cfAdded = 0;
for (const r of cfRows) {
  const ld = blockToLevelDay(r.block_number);
  if (!ld) continue;
  const p = players.find(pl => pl.toLowerCase() === r.player.toLowerCase());
  if (!p) continue;
  const stake = parseFloat(r.total_stake.toFixed(2));
  if (stake <= 0) continue;
  const payout = r.win ? parseFloat((stake * r.reward_percent / 100).toFixed(2)) : -stake;
  if (!coinflipResults[p]) coinflipResults[p] = {};
  if (!coinflipResults[p][ld.level]) coinflipResults[p][ld.level] = {};
  // Multiple coinflip days can map to the same jackpot day — accumulate
  // Keep last reward_percent and win flag (most meaningful for display)
  if (!coinflipResults[p][ld.level][ld.day]) {
    coinflipResults[p][ld.level][ld.day] = [0, 0, 0, 0];
  }
  coinflipResults[p][ld.level][ld.day][0] += stake;
  coinflipResults[p][ld.level][ld.day][1] += payout;
  coinflipResults[p][ld.level][ld.day][2] = r.reward_percent;
  coinflipResults[p][ld.level][ld.day][3] = r.win;
  cfAdded++;
}

// Round accumulated values
for (const p in coinflipResults) {
  for (const l in coinflipResults[p]) {
    for (const d in coinflipResults[p][l]) {
      coinflipResults[p][l][d][0] = parseFloat(coinflipResults[p][l][d][0].toFixed(2));
      coinflipResults[p][l][d][1] = parseFloat(coinflipResults[p][l][d][1].toFixed(2));
    }
  }
}

// --- daily draw results: the actual trait drawn per quadrant per day ---
// All winners in the same (block, quadrant) matched the same drawn trait.
// trait_id encoding: quadrant * 64 + symbol * 8 + color
const drawRows = qa(
  `SELECT block_number, game_level,
    (trait_id >> 6) & 3 as quadrant,
    (trait_id >> 3) & 7 as symbol,
    trait_id & 7 as color
   FROM jackpot_ticket_wins
   GROUP BY block_number, quadrant`
);

// Which ticket pool levels were drawn from per day (game_level + any differing ticket levels)
const drawLevelRows = qa(
  `SELECT block_number, game_level, level
   FROM jackpot_ticket_wins
   GROUP BY block_number, level`
);

// dailyDraw[level][dayIdx] = { traits: [[sym,col]×4], levels: [list of drawn-from levels] }
const dailyDraw = {};
for (const r of drawRows) {
  const ld = blockToLevelDay(r.block_number);
  if (!ld) continue;
  if (!dailyDraw[ld.level]) dailyDraw[ld.level] = {};
  if (!dailyDraw[ld.level][ld.day]) dailyDraw[ld.level][ld.day] = { traits: [null, null, null, null], levels: [] };
  dailyDraw[ld.level][ld.day].traits[r.quadrant] = [r.symbol, r.color];
}

// Collect draw levels per day
for (const r of drawLevelRows) {
  const ld = blockToLevelDay(r.block_number);
  if (!ld) continue;
  if (!dailyDraw[ld.level] || !dailyDraw[ld.level][ld.day]) continue;
  const lvs = dailyDraw[ld.level][ld.day].levels;
  if (lvs.indexOf(r.level) === -1) lvs.push(r.level);
}

// Fill missing quadrants and ensure game level is in levels list
for (const lv in dailyDraw) {
  for (const d in dailyDraw[lv]) {
    const entry = dailyDraw[lv][d];
    // Ensure game level is included
    if (entry.levels.indexOf(parseInt(lv)) === -1) entry.levels.push(parseInt(lv));
    entry.levels.sort((a, b) => a - b);
    for (let q = 0; q < 4; q++) {
      if (!entry.traits[q]) {
        const h = (parseInt(lv) * 31 + parseInt(d) * 97 + q * 53) & 0xFFFF;
        entry.traits[q] = [(h >> 3) & 7, h & 7];
      }
    }
  }
}

const DAYS_PER_LEVEL = 8;
const totalDays = maxWinLevel * DAYS_PER_LEVEL;

const output = {
  players,
  tickets,
  ticketCounts,
  jackpotWins,
  coinflipResults,
  traitOwnership,
  traitCounts,
  dailyDraw,
  levelSummary,
  daysPerLevel: DAYS_PER_LEVEL,
  totalDays,
  maxWinLevel,
};

writeFileSync(OUT, JSON.stringify(output, null, 2));

// Stats
let totalWinEntries = 0;
let ethCount = 0, burnieCount = 0, ticketsCount = 0;
let withQuad = 0, noQuad = 0;
for (const p in jackpotWins) {
  for (const l in jackpotWins[p]) {
    for (const d in jackpotWins[p][l]) {
      for (const w of jackpotWins[p][l][d]) {
        totalWinEntries++;
        if (w[1] === 'eth') ethCount++;
        else if (w[1] === 'burnie') burnieCount++;
        else if (w[1] === 'tickets') ticketsCount++;
        if (w[2] >= 0) withQuad++; else noQuad++;
      }
    }
  }
}
const traitPlayers = Object.keys(traitOwnership).length;
console.log(`Exported ${players.length} players, ${maxWinLevel} levels, ${totalWinEntries} wins (${ethCount} ETH, ${burnieCount} BURNIE, ${ticketsCount} tickets), ${withQuad} with quadrant, ${noQuad} unassigned (${jrFallback} jr-fallback, ${lootboxAdded} lootbox, ${ticketPrizesAdded} ticket-prizes), ${backfilled} trait backfills, ${traitPlayers} trait players to ${OUT}`);
