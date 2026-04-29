// /app/app/decimator.js — Phase 62 Plan 62-01 (BUY-01 decimator level-mint helper).
//
// Re-exports Phase 60's purchaseEth + purchaseCoin from lootbox.js. RESEARCH Example 1.
//
// Why a re-export and not a thin wrapper? The on-chain BUY-01 surface is the SAME
// DegenerusGame.purchase() call as Phase 60 LBX-01 — the only thing that changes is
// the panel's choice of ticketQuantity > 0 (level-mint) vs lootboxQuantity > 0 (lootbox).
// Re-exporting preserves Phase 60's closure-form sendTx + requireStaticCall + reason-map
// registrations (CF-01..03, CF-05) automatically. NO new reason-map codes for BUY-01.
//
// CONTEXT D-01..D-08 LOCKED. RESEARCH Example 1 (BUY-01 = purchase() call). Plan 62-01
// adds NO new sendTx call sites and NO new register() reason-map codes — Phase 60
// already registered GameOverPossible / AfKingLockActive / NotApproved on lootbox.js
// eager import.

export { purchaseEth, purchaseCoin } from './lootbox.js';
