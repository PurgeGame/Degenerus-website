# INTEG-03 Spec: GET /player/:address/decimator?level=N&day=M (per-player per-level decimator endpoint)

**Phase:** 55 -- Decimator
**Requirement:** INTEG-03 (hard gate; blocks Phase 55 Wave 2 DECIMATOR-02 + DECIMATOR-04 hydration, partial DECIMATOR-03)
**Owner:** website repo (proposal); database repo (implementation)
**Status:** DRAFT -- solo dev self-coordination; implement when switching to /home/zak/Dev/PurgeGame/database/
**Posted:** 2026-04-24 -- solo dev (no external team); this file is the canonical spec to reference when adding the endpoint in the database repo.

## Why This Endpoint Is Needed

DECIMATOR-02 and DECIMATOR-04 are *per-level, per-player* surfaces. The existing `/player/:address?day=N` `decimator` block returns a flat `claimablePerLevel` array of `{level, ethAmount, lootboxCount, claimed}`. That gives the payout-per-level (DECIMATOR-04 partial) but does NOT reveal the bucket assignment, the subbucket, the raw effective burn amount, the weighted amount, or the winning subbucket for the level. No existing endpoint exposes any of that.

A new endpoint class is cleanest: it does not pollute `/player/:address` (one of the largest dashboard endpoints) and keeps the decimator-specific join + derive logic colocated with decimator data. The pattern is identical to INTEG-05's `/player/:address/baf?level=N` -- a per-player per-level focused read.

DECIMATOR-03 full requires the bucket denominator (to derive "weighted amount" as `effectiveAmount / bucket`). That too needs the new endpoint.

### Pitfall 1 Note: Bucket Range per Contract Truth

Phase 55 CONTEXT D-03 states "Buckets are 1-8 (per the game model)." This is **incorrect** per contract source. `BurnieCoin.sol:142-147` defines:

- `DECIMATOR_BUCKET_BASE = 12`
- `DECIMATOR_MIN_BUCKET_NORMAL = 5`
- `DECIMATOR_MIN_BUCKET_100 = 2`

Actual bucket range: buckets 5-12 on normal levels (`level % 100 !== 0`), buckets 2-12 on centennial levels (`level > 0 && level % 100 === 0`). SubBucket range is `0` to `bucket - 1` per `DegenerusGameDecimatorModule.sol:27`. All references in this spec use the contract-truth range.

## Endpoint

`GET /player/:address/decimator?level=N&day=M`

### Path Parameters

- `:address` -- 42-char `0x...` Ethereum address, lowercased (validated via `addressParamSchema` -- same as INTEG-01, INTEG-02, INTEG-05).

### Query Parameters

- `level` (required, integer >= 1) -- decimator level. Required because the data is per-level; there is no meaningful "no level" state for a decimator round. If omitted, return 400 via Zod validation.
- `day` (optional, integer >= 1) -- day-scoping for historical queries. When supplied, `bucket`, `subbucket`, `effectiveAmount`, `weightedAmount`, and `winningSubbucket` are resolved as of the end-of-day-M block (block-scoped via `blockNumber <= endBlock` filter on each query). When omitted, returns latest state. Pattern matches INTEG-01 (`/tickets/by-trait`) and INTEG-05 (`/baf`).

**Recommendation:** Require `level`, accept optional `day`. Frontend always supplies `level` (from `state.replay.level`); `day` is supplied when the scrubber is at a historical day.

## Response JSON Schema

```json
{
  "level": 20,
  "player": "0x71be63f3384f5fb98995898a86b02fb2426c5788",
  "bucket": 7,
  "subbucket": 3,
  "effectiveAmount": "5832100000000000000000",
  "weightedAmount": "833157142857142857142",
  "winningSubbucket": 3,
  "payoutAmount": "41235700000000000000",
  "roundStatus": "closed"
}
```

Field notes:

- `level` -- echo of `?level=N` query parameter
- `player` -- echo of `:address` path parameter (lowercased)
- `bucket` -- integer in the contract-truth range (2-12 on centennial levels, 5-12 on normal levels, per Pitfall 1 note above); `null` if player did not burn at this level
- `subbucket` -- integer 0 to bucket-1 (e.g., if bucket=7 then subbucket is in {0,1,2,3,4,5,6}); `null` if player did not burn at this level
- `effectiveAmount` -- wei-encoded BURNIE as decimal string; the base amount + activity-score boost + boon multiplier accumulated for this player at this level. Source: `decimator_burns.effectiveAmount`. Returns `"0"` if the player has no burn at this level.
- `weightedAmount` -- wei-encoded BURNIE as decimal string; the effectiveAmount divided by the bucket denominator (per contract math at `DegenerusGameDecimatorModule.sol:465-486`). The weighted amount is the contributor share: lower bucket means larger weighted share. Returns `"0"` if the player has no burn at this level.
- `winningSubbucket` -- integer 0 to bucket-1; `null` if the round has not been resolved (roundStatus=`'open'`) OR the level is still `'not_eligible'`. For resolved rounds (`'closed'`), this is the winning subbucket for the player's bucket (looked up from `decimator_winning_subbuckets` on the `(level, bucket)` tuple).
- `payoutAmount` -- wei-encoded ETH as decimal string; the pro-rata ETH share the player receives from this round. Returns `"0"` if the player did not burn OR the player's subbucket != winningSubbucket. Sourced from `decimator_claims.ethAmount` for the `(player, level)` tuple OR computed on-the-fly as `pool_eth * playerBurn / totalBurn` if `decimator_claims` row has not been created yet (claim not issued).
- `roundStatus` -- one of `"open"` | `"closed"` | `"not_eligible"`. See derivation below. Three states (simpler than INTEG-05's four) because decimator rounds do not have a "skipped" path; the coinflip-loss gate applies to BAF only.

### Edge Cases

| Condition | bucket | subbucket | effectiveAmount | weightedAmount | winningSubbucket | payoutAmount | roundStatus |
|-----------|--------|-----------|-----------------|----------------|------------------|--------------|-------------|
| Player burned at level, round open | 7 | 3 | "5832e21" | "833e21" | null | "0" | "open" |
| Player burned at level, round closed, won | 7 | 3 | "5832e21" | "833e21" | 3 | "4.12e19" | "closed" |
| Player burned at level, round closed, lost | 7 | 4 | "5832e21" | "833e21" | 3 | "0" | "closed" |
| Player did NOT burn at level (any state) | null | null | "0" | "0" | null (if open) / 3 (if closed) | "0" | "open" / "closed" |
| Level has NO decimator round (not eligible) | null | null | "0" | "0" | null | "0" | "not_eligible" |

## roundStatus Derivation

Three states (simpler than INTEG-05's four -- decimator rounds do not have a "skipped" path because the coinflip-loss gate applies to BAF only):

1. **`"not_eligible"`** -- The level has no decimator round. A decimator round is triggered by contract logic at specific levels (every level except the last level in a 100-cycle where terminal-decimator takes over, and outside the active-game phase). Derivation: `NOT EXISTS (SELECT 1 FROM decimator_rounds WHERE level = ?)` AND `NOT EXISTS (SELECT 1 FROM decimator_burns WHERE level = ?)`.
2. **`"closed"`** -- Round exists AND has been resolved. Derivation: `EXISTS (SELECT 1 FROM decimator_rounds WHERE level = ? AND resolved = true)`.
3. **`"open"`** -- Round exists (either in `decimator_rounds` OR at least one `decimator_burns` row at the level exists) AND not yet resolved. Default.

Backend pseudo-code:

```sql
-- Prefer the authoritative decimator_rounds row
IF EXISTS (SELECT 1 FROM decimator_rounds WHERE level = ? AND resolved = true) THEN
  roundStatus := 'closed'
ELSIF EXISTS (SELECT 1 FROM decimator_rounds WHERE level = ? AND resolved = false) THEN
  roundStatus := 'open'
ELSIF EXISTS (SELECT 1 FROM decimator_burns WHERE level = ?) THEN
  -- Burns exist but no decimator_rounds row yet (indexer lag or round not snapshot-ed)
  roundStatus := 'open'
ELSE
  roundStatus := 'not_eligible'
```

## Contract-Call Map

| Response field | Primary source | Notes |
|----------------|----------------|-------|
| `level` | Query echo | From `?level=N` |
| `player` | Path echo | Validated via `addressParamSchema`; lowercased |
| `bucket` | `decimator_burns.bucket` | Filtered by `(player, level)`; null if no row. Range 5-12 normal / 2-12 centennial per BurnieCoin.sol:142-147 (MIN_BUCKET_NORMAL = 5, MIN_BUCKET_100 = 2, BUCKET_BASE = 12). |
| `subbucket` | `decimator_burns.subBucket` | Filtered by `(player, level)`; null if no row. Range 0 to bucket-1 per DegenerusGameDecimatorModule.sol:27. |
| `effectiveAmount` | `decimator_burns.effectiveAmount` | Filtered by `(player, level)`; returns '0' if no row |
| `weightedAmount` | Derived: `effectiveAmount / bucket` | Computed as BigInt divide (NOT wei-scale divide); returns '0' if no row |
| `winningSubbucket` | `decimator_winning_subbuckets.winningSubBucket` | Filtered by `(level, bucket)` tuple -- requires bucket from prior query; null if round not closed |
| `payoutAmount` | `decimator_claims.ethAmount` OR derived from pool/totalBurn | Filtered by `(player, level)`; returns '0' if no row; derivation uses `decimator_rounds.poolEth` + `decimator_bucket_totals.totalBurn` for on-the-fly computation |
| `roundStatus` | See derivation above | Two-table query: `decimator_rounds` + `decimator_burns` |

## Proposed Backend Implementation

Handler file: extend `database/src/api/routes/player.ts` (where INTEG-01 `/tickets/by-trait` at lines 556-705 and INTEG-05 `/baf` at lines 707-862 already landed; place the new handler just after INTEG-05 for a consistent grouping).

Schema imports to add at top of routes/player.ts (some already present):

```typescript
import { decimatorBurns, decimatorBucketTotals, decimatorWinningSubbuckets, decimatorRounds, decimatorClaims } from '../../db/schema/decimator.js';
// (decimatorClaims + decimatorBurns already imported at line 4; add the other three)
import {
  // ...existing imports
  decimatorQuerySchema,
  decimatorPlayerResponseSchema,
} from '../schemas/player.js';
```

Handler:

```typescript
// INTEG-03 (Phase 55): GET /player/:address/decimator?level=N[&day=M]
// Returns a player's decimator bucket, subbucket, burn amounts, and (for resolved
// rounds) the winning subbucket + payout at the specified level.
//
// Core joins:
//   decimator_burns               -> bucket, subBucket, effectiveAmount
//   decimator_winning_subbuckets  -> winningSubBucket (only for closed rounds)
//   decimator_rounds              -> resolved flag + poolEth for roundStatus
//   decimator_claims              -> authoritative payoutAmount (fallback derivation)
//   decimator_bucket_totals       -> denominator for on-the-fly payout compute
//
// Day resolution: when ?day=M is supplied, scope each query to blockNumber <= endBlock
// via daily_rng lookup. Mirrors the INTEG-01 and INTEG-05 pattern.
fastify.get('/:address/decimator', {
  schema: {
    params: addressParamSchema,
    querystring: decimatorQuerySchema,
    response: {
      200: decimatorPlayerResponseSchema,
      400: errorResponseSchema,
      404: errorResponseSchema,
    },
  },
}, async (request, reply) => {
  const { address } = request.params;
  const { level, day } = request.query;

  // --- Optional day resolution (mirrors /:address/baf pattern) ---
  let endBlock: bigint | undefined;
  if (day != null) {
    const rows = await fastify.db.execute(sql`
      SELECT day, "blockNumber" FROM daily_rng
      WHERE day IN (${day}, ${day + 1})
      ORDER BY day
    `);
    const list = (((rows as any).rows ?? rows) as any[]);
    const thisDay = list.find((r: any) => Number(r.day) === day);
    if (!thisDay) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'day_not_found', day });
    }
    const nextDay = list.find((r: any) => Number(r.day) === day + 1);
    if (nextDay) {
      endBlock = BigInt(nextDay.blockNumber ?? nextDay.blocknumber) - 1n;
    }
  }

  // --- Player burn row (bucket + subBucket + effectiveAmount) ---
  const burnWhere = endBlock != null
    ? and(
        eq(decimatorBurns.player, address),
        eq(decimatorBurns.level, level),
        lte(decimatorBurns.blockNumber, endBlock),
      )
    : and(eq(decimatorBurns.player, address), eq(decimatorBurns.level, level));

  const [burnRow] = await fastify.db
    .select({
      bucket: decimatorBurns.bucket,
      subBucket: decimatorBurns.subBucket,
      effectiveAmount: decimatorBurns.effectiveAmount,
    })
    .from(decimatorBurns)
    .where(burnWhere);

  const bucket = burnRow?.bucket ?? null;
  const subbucket = burnRow?.subBucket ?? null;
  const effectiveAmount = burnRow?.effectiveAmount ?? '0';

  // --- Weighted amount = effectiveAmount / bucket (BigInt divide) ---
  let weightedAmount = '0';
  if (bucket != null && bucket > 0 && effectiveAmount !== '0') {
    weightedAmount = (BigInt(effectiveAmount) / BigInt(bucket)).toString();
  }

  // --- Round status derivation ---
  let roundStatus: 'open' | 'closed' | 'not_eligible';
  const roundWhere = endBlock != null
    ? and(eq(decimatorRounds.level, level), lte(decimatorRounds.blockNumber, endBlock))
    : eq(decimatorRounds.level, level);
  const [roundRow] = await fastify.db
    .select({ resolved: decimatorRounds.resolved, poolEth: decimatorRounds.poolEth })
    .from(decimatorRounds)
    .where(roundWhere)
    .limit(1);

  if (roundRow?.resolved) {
    roundStatus = 'closed';
  } else if (roundRow) {
    roundStatus = 'open';
  } else if (bucket != null) {
    // Burns exist, no rounds row yet (indexer lag) -- treat as open
    roundStatus = 'open';
  } else {
    roundStatus = 'not_eligible';
  }

  // --- Winning subbucket (only meaningful when round is closed + bucket known) ---
  let winningSubbucket: number | null = null;
  if (roundStatus === 'closed' && bucket != null) {
    const winWhere = endBlock != null
      ? and(eq(decimatorWinningSubbuckets.level, level), eq(decimatorWinningSubbuckets.bucket, bucket), lte(decimatorWinningSubbuckets.blockNumber, endBlock))
      : and(eq(decimatorWinningSubbuckets.level, level), eq(decimatorWinningSubbuckets.bucket, bucket));
    const [winRow] = await fastify.db
      .select({ winningSubBucket: decimatorWinningSubbuckets.winningSubBucket })
      .from(decimatorWinningSubbuckets)
      .where(winWhere)
      .limit(1);
    winningSubbucket = winRow?.winningSubBucket ?? null;
  }

  // --- Payout amount ---
  let payoutAmount = '0';
  if (bucket != null && subbucket != null && winningSubbucket != null && subbucket === winningSubbucket) {
    // Prefer authoritative decimator_claims row if present
    const claimWhere = endBlock != null
      ? and(eq(decimatorClaims.player, address), eq(decimatorClaims.level, level), lte(decimatorClaims.blockNumber, endBlock))
      : and(eq(decimatorClaims.player, address), eq(decimatorClaims.level, level));
    const [claimRow] = await fastify.db
      .select({ ethAmount: decimatorClaims.ethAmount })
      .from(decimatorClaims)
      .where(claimWhere);

    if (claimRow?.ethAmount && claimRow.ethAmount !== '0') {
      payoutAmount = claimRow.ethAmount;
    } else if (roundRow?.poolEth && roundRow.poolEth !== '0') {
      // Fallback: compute pro-rata from pool + winning subbucket's totalBurn
      const [totalsRow] = await fastify.db
        .select({ totalBurn: decimatorBucketTotals.totalBurn })
        .from(decimatorBucketTotals)
        .where(and(
          eq(decimatorBucketTotals.level, level),
          eq(decimatorBucketTotals.bucket, bucket),
          eq(decimatorBucketTotals.subBucket, winningSubbucket),
        ));
      if (totalsRow?.totalBurn && totalsRow.totalBurn !== '0') {
        const pool = BigInt(roundRow.poolEth);
        const playerBurn = BigInt(effectiveAmount);
        const denom = BigInt(totalsRow.totalBurn);
        payoutAmount = denom > 0n
          ? ((pool * playerBurn) / denom).toString()
          : '0';
      }
    }
  }

  return {
    level,
    player: address,
    bucket,
    subbucket,
    effectiveAmount,
    weightedAmount,
    winningSubbucket,
    payoutAmount,
    roundStatus,
  };
});
```

## New Schema Definitions

Add to `database/src/api/schemas/player.ts`:

```typescript
// INTEG-03 (Phase 55): GET /player/:address/decimator?level=N[&day=M]
export const decimatorQuerySchema = z.object({
  level: z.coerce.number().int().min(1),
  day: z.coerce.number().int().min(1).optional(),
});

export const decimatorPlayerResponseSchema = z.object({
  level: z.number().int(),
  player: z.string(),
  bucket: z.number().int().nullable(),
  subbucket: z.number().int().nullable(),
  effectiveAmount: z.string(),
  weightedAmount: z.string(),
  winningSubbucket: z.number().int().nullable(),
  payoutAmount: z.string(),
  roundStatus: z.enum(['open', 'closed', 'not_eligible']),
});
```

## Error Modes

| Status | Condition | Response |
|--------|-----------|----------|
| 200 | Player burned at level, any round state | Full payload with non-null bucket + subbucket |
| 200 | Player did NOT burn at level | Full payload, bucket=null, subbucket=null, amounts='0'; roundStatus reflects level-level state |
| 200 | Level has no decimator round AND no burns | Full payload, all nulls/zeros; roundStatus='not_eligible' |
| 400 | `level` missing or invalid | `{ statusCode: 400, error: "Bad Request", message: "..." }` (Zod validation handles this) |
| 404 | `?day=M` supplied but day does not exist in `daily_rng` | `{ statusCode: 404, error: "Not Found", message: "day_not_found", day: M }` |

## Acceptance Criteria

- Endpoint reachable at `GET /player/:address/decimator?level=N` (day optional)
- `bucket` matches the contract-assigned bucket (range 5-12 on normal levels, 2-12 on centennial levels per MIN_BUCKET_NORMAL/MIN_BUCKET_100/BUCKET_BASE; validated against `_adjustDecimatorBucket` contract logic for a known player at a known level)
- `subbucket` is in range `[0, bucket-1]` per contract invariant
- `bucket === null` AND `subbucket === null` when the player did not burn at the level
- `effectiveAmount` matches `decimator_burns.effectiveAmount` for the (player, level) tuple
- `weightedAmount === BigInt(effectiveAmount) / BigInt(bucket)` when bucket != null, else `'0'`
- `winningSubbucket` matches `decimator_winning_subbuckets.winningSubBucket` when roundStatus = 'closed' AND bucket != null, else `null`
- `payoutAmount` matches `decimator_claims.ethAmount` when claim row exists; otherwise computed as `pool * playerBurn / totalBurn` for the winning (bucket, subbucket)
- `payoutAmount === '0'` when the player's subbucket != winningSubbucket
- `roundStatus === 'not_eligible'` when no `decimator_rounds` row exists AND no burns exist at the level
- `roundStatus === 'closed'` when `decimator_rounds.resolved = true`
- `roundStatus === 'open'` when rounds row exists but not resolved, OR burns exist but rounds row absent (indexer lag)
- `?day=M` correctly scopes each query to `blockNumber <= endBlock`

## Timeline

Same pattern as INTEG-01 (Phase 52: a46fdcb, e130547, 9988887), INTEG-02 (Phase 51: d135605, dab5adf, 64fe8db), and INTEG-05 (Phase 54: a0d4e69, 6392541, 08ef417) -- 3 atomic commits on `database/main`:

1. **Commit 1 -- `feat(api): add GET /player/:address/decimator endpoint (INTEG-03)`** -- handler + schema definitions
2. **Commit 2 -- `docs(openapi): document /player/:address/decimator (INTEG-03)`** -- openapi.json update
3. **Commit 3 -- `test(api): cover INTEG-03 happy path, bucket null, empty level, not_eligible, closed, day-scoped`** -- Vitest tests

Precedent shipped in ~3-5 minutes per prior INTEG side-quest. INTEG-03 is slightly more complex than INTEG-05 (more table joins + more derivation logic) so budget 10-15 minutes for careful implementation.

## Open Questions

1. **Should the endpoint accept `?day=M` as the primary query (resolving to latest level at day M) instead of requiring `?level=N`?** No -- decimator is level-scoped; day maps to a single level, but the inverse is lossy (a level spans many days). Keep `?level=N` primary; `?day=M` as optional historical scoping.
2. **Should the endpoint return multiple bucket rows (in case a player burned at the level twice with different buckets)?** Per `decimator_burns` UNIQUE(player, level), the answer is no -- one row per (player, level). The contract logic at `DegenerusGameDecimatorModule.sol:147-158` confirms: first burn sets bucket; subsequent burns can only IMPROVE the bucket (migrate to lower). So final `bucket` is the best-seen; `effectiveAmount` is cumulative.
3. **Should the endpoint expose `totalBurn` (the whole-subbucket total) so the frontend can compute pro-rata?** No -- the backend does the computation (`payoutAmount` field). Exposing raw totals would leak implementation detail and couple frontend to contract math. Derived field is better.
4. **Is `weightedAmount` the right name?** The contract math uses `effectiveAmount / bucket` conceptually as the player's "weighted contribution" to the subbucket, but the actual pro-rata divides `effectiveAmount` (full, unweighted) by `totalBurn` at resolution. "Weighted" is a UI-facing term; the backend exposes `weightedAmount = effectiveAmount / bucket` as a convenience for the UI to display "your weighted contribution tier". This is a semantic choice -- alternatives: `bucketNormalizedAmount`, `perBucketShare`. Stick with `weightedAmount`; document in the openapi description.
5. **Should `?level=N` return 404 for invalid levels (e.g., negative, zero) or 400?** 400 (via Zod `z.coerce.number().int().min(1)` validation). 404 is reserved for valid-shape-but-missing-data cases (e.g., `?day=M` where day does not exist).

## Confidence

- **HIGH** on the need + path (new endpoint class; no conflict with existing routes)
- **HIGH** on data sources (five tables all already indexed by existing handlers -- `decimator_burns`, `decimator_bucket_totals`, `decimator_winning_subbuckets`, `decimator_rounds`, `decimator_claims` -- verified via `database/src/db/schema/decimator.ts`)
- **HIGH** on roundStatus derivation (two-table query with short-circuit cascade; decimator_rounds.resolved is authoritative)
- **HIGH** on contract math for `weightedAmount` derivation (`DegenerusGameDecimatorModule.sol:465-486` read at research time)
- **MEDIUM** on the payout computation fallback path (pool * playerBurn / totalBurn when claim row is absent). Correctness depends on `decimator_bucket_totals` being populated in sync with `decimator_rounds`. If indexer ordering can put burns AFTER a round resolves (rare edge case), the totalBurn used could be stale. Verify with test case: a player who burned but has not claimed yet. Low risk in practice.
- **MEDIUM** on the Drizzle SQL builder translating BigInt divisions correctly. JavaScript BigInt in the handler is fine; the SQL-level is avoided (we pull raw strings and divide in JS). Risk LOW.
