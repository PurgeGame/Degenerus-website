#!/usr/bin/env node
// Exports jackpot UI data from analysis.db to beta/jackpot-data.json
// Run: node db/export-jackpot-data.js (from website root)
// Requires: sqlite3 CLI

const { execSync } = require('child_process');
const { writeFileSync } = require('fs');
const path = require('path');

const DB = path.join(__dirname, 'analysis.db');
const OUT = path.join(__dirname, '..', 'beta', 'jackpot-data.json');

function query(sql) {
  const raw = execSync(`sqlite3 -json "${DB}" "${sql}"`, { encoding: 'utf8' });
  return raw.trim() ? JSON.parse(raw) : [];
}

// All distinct players that ever had tickets
const players = query(
  'SELECT DISTINCT player FROM level_tickets ORDER BY player'
).map(r => r.player);

// Per-player: which levels they have tickets for
const tickets = {};
for (const p of players) {
  const rows = query(
    `SELECT DISTINCT level FROM level_tickets WHERE player = '${p}' ORDER BY level`
  );
  tickets[p] = rows.map(r => r.level);
}

// Level summary for context (only main levels 1-11)
const levelSummary = query(
  'SELECT level, total_whole_tickets, player_count FROM level_summary WHERE level <= 11 ORDER BY level'
);

// The simulation runs 8 days per level (3 purchase + 5 burn).
// Total days = 84, main levels = 10, plus partial level 11.
const DAYS_PER_LEVEL = 8;
const mainLevels = levelSummary.length;
const totalDays = (mainLevels - 1) * DAYS_PER_LEVEL + 4; // level 11 had ~4 days

const output = {
  players,
  tickets,
  levelSummary,
  daysPerLevel: DAYS_PER_LEVEL,
  totalDays,
  mainLevels,
};

writeFileSync(OUT, JSON.stringify(output, null, 2));
console.log(`Exported ${players.length} players, ${mainLevels} levels to ${OUT}`);
