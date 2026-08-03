# Spec: sDGNRS Far-Future Ticket Salvage Swap

**Status:** design-complete, ready for contract implementation
**Audience:** contract implementer ("contract claude")
**Source of truth for existing primitives:** `/home/zak/Dev/PurgeGame/degenerus-audit/contracts/` (StakedDegenerusStonk.sol, DegenerusGame.sol, DegenerusQuests.sol, PriceLookupLib, DegenerusGameStorage.sol)

> All contract symbol names below (storage slots, function names, constants) are the ones surfaced during design. **Verify each against current source before wiring.** Where I specify a unit or formula, match the contract's existing convention so units stay consistent by construction; do not hardcode a scale I assert if the live code differs.

---

## 1. Purpose

Let a player convert **far-future ticket entries** they hold into **~60% current-level tickets and up to 40% withdrawable ETH** (the player always receives at least one whole current ticket; cash is the residual, see §5), with sDGNRS as the counterparty. sDGNRS pays a deep, distance-scaled discount out of **its own claimable winnings** and keeps the far-future entries (which it then plays via its existing afKing behavior).

This is the protocol's single sanctioned way to get ETH back out of a far-future ticket, and it is engineered to be **-EV for the seller** (they receive only 5-15% of face, scaled down with distance). That is the design. In this system a player's voluntary loss redistributes to everyone who stays, so **exercising this exit subsidizes the remaining players and sDGNRS holders.** The exit is not a leak in the lockup; it is the lockup thesis applied to the exit itself. The honest, strong claim it supports: *the only way to pull ETH out of a far-future ticket is to sell it to the protocol's own staking arm at a discount so deep that using it transfers most of the ticket's value to the people who stay.*

**Design intent (so no reviewer flags it as a problem): sDGNRS is the house, and the house is the committed players.** sDGNRS is soulbound, earned by playing (whale/affiliate/lootbox/reward/earlybird/presale reward pools), is itself a max-activity afKing game player, and is backed by what it wins; burning it claims a proportional share of the backing. It is a collective-ownership model deliberately built to reward the most committed players. So sDGNRS accumulating far-future claims through this feature is **not** a concentration risk to mitigate; it is the reward channel working. Value abandoned by leavers and discounted by distressed sellers flows into the committed collective. Higher utilization routes more of that value to the most committed players, which is the goal.

### Properties this must preserve
- **Solvency-safe.** Funded only from `claimableWinnings[sDGNRS]` (sDGNRS's own won treasury, which its afKing self-sub already churns daily), never from prize-pool funds owed to other players. The ticket leg routes ETH into the pools; the cash leg is a claimant-to-claimant relabel the player can withdraw. The invariant `claimablePool <= ETH + stETH` is never violated (it gains slack on the ticket leg, is neutral on the cash leg).
- **Run-proof.** Fail-closed on sDGNRS's own balance, behind a 1 ETH liquid buffer on its claimable so it can never starve the existing redemption desk. No daily cap: sDGNRS spends down to that floor, which is intended (the house accumulating discounted claims is the reward model).
- **No-arbitrage / mercenary-proof.** Max cash payout is 6% of face (40% x the 15% d6 ceiling). No acquisition path delivers a far entry below ~21% of face, so every round-trip and bundle-dump loses heavily. A 90%+ haircut is far too lossy to be any extractor's strategy; only distressed sellers use it.

---

## 2. Public interface (mass sell)

```solidity
/// @notice Sell far-future ticket entries to sDGNRS for 60% current-level tickets + 40% withdrawable ETH.
/// @param levels      Target levels to sell entries from. Each must satisfy 6 <= (level - currentLevel) <= 100.
/// @param quantities  Quantity to sell at each level, in the SAME unit ticketsOwed is stored in.
///                     levels.length == quantities.length, non-empty, bounded length (see §7).
function sellFarFutureTickets(
    uint32[] calldata levels,
    uint256[] calldata quantities
) external;
```

- Player-initiated. One transaction can sell across many far levels (the mass sell).
- All far levels are valued independently (§4), summed into one `totalBudget`, then split 60/40 into one aggregated current-level ticket mint and one cash credit (§5). Many far levels in; one ticket mint + one cash credit out.
- Match `uint32`/`uint256` to the contract's actual level and ticket-quantity types.

---

## 3. Pricing curve (distance scaling)

`d = targetLevel - currentLevel` (levels ahead). Eligible range: **`6 <= d <= 100`**. Outside that range, revert that line (near-future entries should just be held; >100 should not exist).

Two-line piecewise fraction of face, in basis points:

```
fractionBps(d):
    require 6 <= d <= 100
    if d <= 20:  return 1500 - ((d - 6)  * 500) / 14    // 15% @ d6  -> 10% @ d20
    else:        return 1000 - ((d - 20) * 500) / 80    // 10% @ d20 -> 5%  @ d100
```

Integer division truncation is sub-bps and acceptable. `d = 20` is the segment boundary; both branches yield 1000 there.

Reference / test-vector values:

| d  | fractionBps | % |
|----|-------------|------|
| 6  | 1500 | 15.00 |
| 10 | 1358 | 13.58 |
| 20 | 1000 | 10.00 |
| 30 | 938  | 9.38 |
| 50 | 813  | 8.13 |
| 70 | 688  | 6.88 |
| 100| 500  | 5.00 |

(If you prefer, precompute a 95-entry `uint16` bps lookup `[d-6]` instead of the formula; identical result, one array read.)

**Face value** of an entry at the target level comes from `PriceLookupLib.priceForLevel(targetLevel)`, NEVER the current-level price and never a user-supplied number. This is the only correct, non-manipulable anchor.

---

## 4. Per-line valuation and total budget

For each input line `i` with `(L_i = levels[i], n_i = quantities[i])`:

1. `d_i = L_i - currentLevel`; require `6 <= d_i <= 100`.
2. Require the player owns `>= n_i` far-future entries at `L_i` (read `ticketsOwedPacked[L_i][player]` or whatever the live far-future ledger is). Decrement against a running balance so duplicate levels are handled naturally; revert if any line exceeds remaining balance.
3. `faceWei_i = (priceForLevel(L_i) * n_i) / (4 * TICKET_SCALE)` — the exact wei it would cost to MINT `n_i` at `L_i`, using the existing mint-cost formula (`costWei = price * ticketQuantity / (4 * 100)`). Use the contract's real constants/units so this equals a true face value.
4. `budget_i = (faceWei_i * fractionBps(d_i)) / 10000`.

`totalBudget = Σ budget_i`.

---

## 5. Split, minimum, and execution (atomic)

### Split: ticket floor first, cash is the residual (up to 40%)

The player always receives **at least one whole current-level ticket.** Cash is whatever is left after funding the ticket leg, capped at 40%. For small swaps the cash portion shrinks (the ticket floor takes priority); only a swap too small to fund even one whole ticket reverts.

```
TICKET_BPS   = 6000                              // nominal 60% to tickets
oneTicketWei = priceForLevel(currentLevel) / 4   // wei cost of 1.00 current ticket

require totalBudget >= oneTicketWei              // else revert: too small to deliver even 1 ticket

ticketWei = max((totalBudget * TICKET_BPS) / 10000, oneTicketWei)  // 60%, floored at 1 whole ticket
cashWei   = totalBudget - ticketWei                                // residual: 40% for large swaps, tapering to 0 near the floor
```

Behavior by size (let `T = oneTicketWei`):
- `totalBudget >= T / 0.6` (~1.667 T): clean 60/40 (cash = 40%).
- `T <= totalBudget < T / 0.6`: ticket floor binds; ticketWei = T (exactly 1 ticket), cash shrinks from 40% toward 0 as budget approaches T. This is the "give it less eth" band.
- `totalBudget < T`: revert (genuinely too small).

No top-up / no subsidy: the ticket floor is funded by reducing cash, never by spending more than `totalBudget`. Keeps the swap anchored as a ticket roll-forward that includes cash, and guarantees a usable (non-dust) ticket position. Reducing cash only shrinks the ETH that leaves, so it is strictly safer for the no-arb bound (max cash fraction stays 40%).

### Execution order
In a single state transition:

1. **Validate everything first** (§4 loop, the minimum-ticket gate, §6 guards). Revert before any mutation if anything fails.
2. **Delete** the sold entries from the player: `ticketsOwed[L_i][player] -= n_i` for each line.
3. **Credit sDGNRS**: `ticketsOwed[L_i][SDGNRS] += n_i` for each line. (sDGNRS is an afKing player; it plays these when the levels activate.)
4. **Debit sDGNRS's claimable, fail-closed**: move `totalBudget` out of `claimableWinnings[SDGNRS]` using the same checked-subtraction as `pullRedemptionReserve` (revert on underflow).
5. **Ticket leg**: mint current-level tickets for the player with `ticketWei` as the ETH spend, routed through the prize-pool split exactly like a recycled ticket purchase: **90% nextPrizePool / 10% futurePrizePool** (`PURCHASE_TO_FUTURE_BPS = 1000`). The player receives the resulting current-level entries.
6. **Cash leg**: credit `cashWei` to `claimableWinnings[player]` (withdrawable). This is a claimant-to-claimant move within `claimablePool`.
7. **Credit the player's MINT_ETH quest** with `ethMintSpendWei = ticketWei` only (§8). The cash leg does NOT credit any quest.
8. Emit event (§9).

Net accounting: `claimableWinnings[SDGNRS] -= totalBudget`; `ticketWei` lands in the prize pools (claimablePool drops by ticketWei, ETH stays in contract, slack grows); `cashWei` becomes the player's withdrawable claim (claimablePool unchanged on that leg until the player withdraws). No claimable is created for the player beyond `cashWei`.

---

## 6. Safety guards (all mandatory)

1. **Fail-closed funding.** Revert if spendable `claimableWinnings[SDGNRS] < totalBudget`. Reuse the `pullRedemptionReserve` checked-debit pattern; no partial fills.
2. **Reserve floor (the throttle).** `spendable = claimableWinnings[SDGNRS] - 1 ether`. The swap spends only from `spendable`. No `pendingRedemptionEthValue` term is needed: the gambling-burn desk already segregates each redemption's reserve out of `claimableWinnings[SDGNRS]` into the contract's own balance at submit (`pullRedemptionReserve`), so the live claimable balance is already net of in-flight redemptions and reading it cannot touch reserved redemption ETH. The 1 ETH is just a liquid buffer. (Implementer: confirm that segregation happens at submit. Only if some redemption reserve can linger inside `claimableWinnings[SDGNRS]` until claim would you also subtract it.)
3. **No daily cap.** There is intentionally no per-day throttle. sDGNRS spends down to the reserve floor in (2). This is by design: extracting cash is deeply -EV (max 6% of face) so there is no profitable drain, and mass-selling only feeds the house cheap claims, which is the reward model. Accepted consequence: a high-volume day can convert most of sDGNRS's liquid claimable into far claims (plus up to 40% leaked as cash), temporarily thinning liquid redemption backing until claims mature via afKing. Self-correcting and accretive; not a reason to cap.
4. **Lifecycle gates.** Block when `rngLocked()`, during the liveness window (reuse `BurnsBlockedDuringLiveness`), and when `gameOver()`. A payout that `handleGameOverDrain` could sweep, or that fires mid-RNG, is a bug. Reuse existing guards verbatim.
5. **Minimum-ticket gate** (§5) and **eligibility** (`6 <= d <= 100` per line; player owns the quantity; arrays equal length, non-empty, length-bounded per §7).
6. **Atomicity.** Delete-then-credit-then-fund-then-mint/credit in one call; never credit sDGNRS or pay out before the player's entries are deleted. Mirror the gambling-burn path's burn-then-credit ordering.

---

## 7. Gas / array bounds

- `levels.length == quantities.length`, both non-empty.
- Cap line count at `<= 50`; revert if exceeded. This is only a UX/gas nicety (the block gas limit self-caps it anyway, and the loop touches only the caller's own holdings + sDGNRS's claimable, so there is no cross-user griefing). Not a safety parameter.
- Duplicate levels allowed, processed sequentially against the running owned balance.

---

## 8. Quest credit (the seller's impetus) and what to suppress

The **ticket leg** must credit the player's `MINT_ETH` daily quest with `ethMintSpendWei = ticketWei`, via the existing recycled-spend path. The quest system already credits "fresh + recycled" ETH 1:1 to `MINT_ETH` (`DegenerusQuests.sol` ~lines 751-752, 795-796), so this is the normal recycled-mint hook, not new quest logic. This lets a cash-dry but engaged player preserve their quest streak by taking the -EV swap. It is safe specifically because the swap is -EV and cannot be farmed for profit. The **cash leg credits no quest.**

**Suppress all other side effects** the output mint would normally generate:
- No FLIP credits.
- No claimable-rebuy 10% bonus.
- No purchase-boost consumption or bonus tickets.
- No boon rolls.
- Do **not** increment mint streak or mint count. The only engagement effect is the `MINT_ETH` quest progress from the ticket leg.

This likely needs a dedicated internal mint routine (deposit split + MINT_ETH quest credit only) rather than the full public `_purchaseFor`. Confirm which side effects the existing internal mint emits and gate them off for this caller.

---

## 9. Events

```solidity
event FarFutureSwap(
    address indexed player,
    uint256 lineCount,
    uint256 totalFaceWei,        // Σ faceWei_i
    uint256 totalBudgetWei,      // Σ budget_i (ETH debited from sDGNRS)
    uint256 ticketWei,           // 60% leg, into pools
    uint256 cashWei,             // 40% leg, to player claimable
    uint256 currentTicketsMinted
);
```

---

## 10. Contract placement

The `claimableWinnings` ledger and the far-future ticket ledger both live on the **game contract**, with the mint + quest hooks. So the natural home is a new game-contract function the player calls. It needs sDGNRS's authorization to spend `claimableWinnings[SDGNRS]`; since sDGNRS already opted into afKing/whale behavior at construction and *wants* these entries, a standing authorization (or a dedicated sDGNRS-side `fundFarFutureSwap`-style method performing the checked debit, analogous to `pullRedemptionReserve`) is appropriate. Implementer chooses the exact split, but the checked, fail-closed debit from `claimableWinnings[SDGNRS]` is non-negotiable.

---

## 11. Invariant checklist (for tests)

- [ ] `claimablePool == Σ claimableWinnings` holds throughout (player gets `cashWei` of claimable + tickets; sDGNRS's claimable drops by `totalBudget`; `ticketWei` left claimablePool into the pools).
- [ ] After swap (pre-withdrawal): `claimablePool` decreases by exactly `ticketWei`; ETH+stETH balance unchanged; slack grows.
- [ ] Reverts fail-closed if `spendableClaimable < totalBudget`.
- [ ] Reverts under `rngLocked`, liveness window, `gameOver`.
- [ ] Reverts only if `totalBudget < oneTicketWei`. Otherwise `ticketWei >= oneTicketWei` always (floored at 1 whole ticket); cash is the residual and shrinks to fund the floor. No subsidy/top-up: never spends more than `totalBudget`.
- [ ] Reserve floor enforced: spend never reduces `claimableWinnings[SDGNRS]` below `1 ether`. Since live claimable is already net of segregated redemption reserves, the gambling-burn desk reserve is never touched. (No daily cap.)
- [ ] Player far entries decrease by exactly the sold amounts; sDGNRS's increase by the same; duplicate-level lines don't double-spend.
- [ ] `MINT_ETH` quest credited by `ticketWei` only; cash leg credits no quest; no FLIP/rebuy/boost/mint-streak/mint-count side effects.
- [ ] No profitable round-trip: max cash = 6% of face (40% x 15% at d6); cheapest acquisition basis (~21% lootbox tier-1) is well above 6%, so mint-and-dump and bundle-dump both lose.

---

## 12. Worked example (test vector)

Current level 10. Player sells 4.00 tickets @ level 40 (`d=30`) and 4.00 tickets @ level 60 (`d=50`). (Convert quantities to the contract's scaled unit.)

- Line 1: faceWei = `priceForLevel(40)` for 4 tickets = 0.08 ETH. fractionBps(30)=938. budget_1 = 0.08 * 0.0938 = 0.007504 ETH.
- Line 2: faceWei = `priceForLevel(60)` for 4 tickets = 0.12 ETH. fractionBps(50)=813. budget_2 = 0.12 * 0.0813 = 0.009756 ETH.
- `totalBudget = 0.017260 ETH`.
- `ticketWei = 0.6 * totalBudget = 0.010356 ETH`. At level 10, `oneTicketWei = priceForLevel(10)/4 = 0.04/4 = 0.01 ETH`. `0.010356 >= 0.01` -> passes the gate. Buys ~1.036 current-level tickets, 90/10 into next/future pool.
- `cashWei = 0.006904 ETH` -> player's withdrawable claimable.
- MINT_ETH quest credit = `0.010356 ETH` (ticket leg only).
- Player loses 8 far entries; gains ~1.036 current tickets + 0.006904 ETH withdrawable + quest credit. sDGNRS gains the 8 far entries.

Mid-band example ("give it less eth"): a swap with `totalBudget = 0.012 ETH` at level 10 (`oneTicketWei = 0.01`). 60% would be 0.0072 < 0.01, so the ticket floor binds: `ticketWei = 0.01` (1 whole ticket), `cashWei = 0.002` (~16.7%, not 40%). Player gets exactly 1 ticket + 0.002 ETH.

Revert example (too small): selling only the 4 tickets @ L40 gives `totalBudget = 0.007504 ETH < 0.01 oneTicketWei` -> reverts, since the whole budget can't fund even one current ticket. Player must batch more.

---

## 13. Why these choices (rationale for the implementer)

- **~60% tickets / up to 40% cash, ticket-floored.** The ticket leg keeps the bulk of sDGNRS's spend funding the pools (90% futurePool flywheel) and pulls the player back into current play. The cash leg gives a genuine, deeply-lossy cash exit so the protocol can honestly claim funds are never fully trapped, without enabling extraction (max 6% of face is no one's strategy). The 1-ticket floor (cash shrinks to fund it on small swaps) keeps it primarily a roll-forward and avoids dust. Utilization is the point: serving the large "need cash now" population that tickets-only excludes multiplies the volume of -EV donations to sDGNRS and, past ~1.67x volume, funds the pools more in absolute terms than tickets-only would.
- **Deterministic target-level face** is the one parameter that breaks the whole thing if wrong. Pricing off the current level or any manipulable mark opens a money pump. Off `priceForLevel(targetLevel)` it is arb-free.
- **Distance scaling down** prices the claim's falling probability of ever maturing (GAMEOVER hazard rises with distance). sDGNRS pays least for the entries most likely to expire worthless, so its book is +EV even in the GAMEOVER-zero case.
- **Quest credit on the ticket leg only, no other byproducts.** Quest-streak preservation is the seller's reason to act and is safe only because the action is -EV. Any path that became +EV, or handed out FLIP/rebuy/score on top, would break that.
- **Fail-closed own-treasury funding + a reserve floor (no daily cap)** make it run-proof and unable to starve the redemption desk. `claimableWinnings[SDGNRS]` is sDGNRS's own churning treasury (afKing reinvests it daily), so spending it here is a redirection of sDGNRS's discretionary backing, not a drain on player-owed pool funds. No cap is needed because the action is -EV: there is no profitable drain, and volume only feeds the house, which is the goal.

---

## 14. Decided values

- **Daily cap: none.** Throttled only by the reserve floor (§6.2/§6.3).
- **Reserve floor: 1 ETH.** `spendable = claimableWinnings[SDGNRS] - 1 ether`. (Live claimable is already net of segregated gambling-burn redemption reserves, so no extra term is needed; implementer confirms segregation happens at submit.)
- **Max array length: 50** (UX/gas nicety, not a safety parameter).
- **UI requirement (ship together):** show the player their entries' face value vs the current-level tickets + ETH they will receive, so the -EV trade is clearly labeled, not hidden.
