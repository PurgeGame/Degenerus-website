# INTEG-05 Spec: GET /player/:address/baf?level=N (per-player BAF score endpoint)

**Phase:** 54 -- Coinflip & BAF Leaderboards
**Requirement:** INTEG-05 (hard gate; blocks Phase 54 Wave 2 BAF-01 + BAF-03 hydration)
**Owner:** website repo (proposal); database repo (implementation)
**Status:** DRAFT -- solo dev self-coordination; implement when switching to /home/zak/Dev/PurgeGame/database/
**Posted:** 2026-04-24 -- solo dev (no external team); this file is the canonical spec to reference when adding the endpoint in the database repo.

## Why This Endpoint Is Needed

BAF-01 requires showing "selected player's BAF score and rank at current level/window". The existing `/leaderboards/baf?level=N` returns only the top-4 per level by design (the materialized view `mv_baf_top4` has a `WHERE rank <= 4` filter). Any player outside the top-4 needs a separate lookup: their BAF score AND their rank relative to all participants in the level.

BAF-03 requires showing "whether the round is open or closed". The round status is a combination of: (1) did BAF-eligibility hit (level % 10 == 0)? (2) did the coinflip on the advance day win? (3) has the jackpot distribution already run? Deriving this purely from `game.phase` in the frontend is unreliable -- the backend has the authoritative state via `baf_skipped` events + jackpot-distribution history.

A new endpoint class is cleanest: it does not pollute `/player/:address` (already one of the largest dashboard endpoints), and it keeps the BAF-specific indexing logic colocated with BAF data.

## Endpoint

`GET /player/:address/baf?level=N`

### Path Parameters

- `:address` -- 42-char `0x...` Ethereum address, lowercased (same validation pattern as existing routes via `addressParamSchema`)

### Query Parameters

- `level` (required, integer, >= 1) -- BAF level. Not optional because the view is per-level; there is no meaningful "no level" state. If omitted, return 400.

**Recommendation:** Require `level`. Phase 54 frontend ALWAYS supplies it (from `state.replay.level`). Reject missing with 400.

**Alternative:** Accept `day` instead of `level` (backend resolves day -> level via `daily_rng`). Pro: matches Phase 51's `?day=N` pattern. Con: BAF is level-scoped not day-scoped (a level spans ~5 days). For INTEG-05 v1, ship `?level=N` only; add `?day=M` later if needed.

## Response JSON Schema

```json
{
  "level": 20,
  "player": "0x71be63f3384f5fb98995898a86b02fb2426c5788",
  "score": "344863111573291904385281",
  "rank": 7,
  "totalParticipants": 42,
  "roundStatus": "open"
}
```

Field notes:

- `level` -- echo of `?level=N` query parameter
- `player` -- echo of `:address` path parameter (lowercased)
- `score` -- wei-encoded BURNIE as decimal string (same scale as `/leaderboards/baf` entries); `"0"` if the player has no stake at this level
- `rank` -- 1-indexed rank within the level; `null` if player has no BAF stake at this level
- `totalParticipants` -- count of DISTINCT players with totalStake > 0 at this level; `0` if the level has no BAF entries at all
- `roundStatus` -- one of `"open"` | `"closed"` | `"skipped"` | `"not_eligible"` (see derivation below)

### Edge cases

| Condition | score | rank | totalParticipants | roundStatus |
|-----------|-------|------|-------------------|-------------|
| Player has BAF stake at this level | "123..." | 1..N | N | "open" / "closed" / "skipped" |
| Player has ZERO BAF stake at this level | "0" | null | N (others exist) | whatever the level's status is |
| Level has no BAF entries at all (no one staked) | "0" | null | 0 | "open" or "not_eligible" |
| Level is NOT a multiple of 10 (no BAF eligibility) | "0" | null | 0 | "not_eligible" |
| BAF was skipped (coinflip lost on advance day) | "0" or actual | null or rank | N | "skipped" |

## roundStatus Derivation

Four states:

1. **"not_eligible"** -- Level is not a multiple of 10. BAF jackpots only fire at level boundaries where `level % 10 == 0`. Frontend shows a softer label such as "BAF active at next level {nextBafLevel}".
2. **"open"** -- Level % 10 == 0 AND no `baf_skipped` row AND no `jackpot_distributions` row with `awardType IN ('eth_baf', 'tickets_baf')` for this level. Players can still stake.
3. **"closed"** -- Level % 10 == 0 AND the BAF jackpot has run (there EXISTS a `jackpot_distributions` row with `awardType IN ('eth_baf', 'tickets_baf')` for this level).
4. **"skipped"** -- Level % 10 == 0 AND `baf_skipped` row exists for this level (coinflip lost on advance day). Contract `DegenerusJackpots.markBafSkipped` emits; handler `handleBafSkipped` at `database/src/handlers/baf-jackpot.ts:53-68` indexes.

Backend pseudo-code:

```sql
IF level % 10 != 0 THEN roundStatus := 'not_eligible'
ELSIF EXISTS (SELECT 1 FROM baf_skipped WHERE level = ?) THEN roundStatus := 'skipped'
ELSIF EXISTS (SELECT 1 FROM jackpot_distributions WHERE level = ? AND awardType IN ('eth_baf', 'tickets_baf')) THEN roundStatus := 'closed'
ELSE roundStatus := 'open'
```

## Contract-Call Map

| Response field | Primary source | Notes |
|----------------|----------------|-------|
| `level` | Query echo | From `?level=N` |
| `player` | Path echo | Validated via `addressParamSchema`; lowercased |
| `score` | `baf_flip_totals.totalStake` | Filtered by `(player, level)`; returns '0' if no row |
| `rank` | `ROW_NUMBER() OVER (PARTITION BY level ORDER BY CAST("totalStake" AS NUMERIC) DESC)` | Same expression used by `mv_baf_top4`; returns `null` when the player has no row |
| `totalParticipants` | `SELECT COUNT(*) FROM baf_flip_totals WHERE level = ?` | Count of distinct (player, level) rows at the level |
| `roundStatus` | See derivation above | Three-table query: `baf_skipped`, `jackpot_distributions`, level arithmetic |

## Proposed Backend Implementation

Handler file: extend `database/src/api/routes/player.ts` (where Phase 52 INTEG-01's `/player/:address/tickets/by-trait` already landed; place the new handler just before or after it).

```typescript
// INTEG-05 (Phase 54): GET /player/:address/baf?level=N
// Returns the player's BAF score and rank at a given level, plus the round status.
fastify.get('/:address/baf', {
  schema: {
    params: addressParamSchema,
    querystring: bafQuerySchema,
    response: {
      200: bafPlayerResponseSchema,
      400: errorResponseSchema,
    },
  },
}, async (request, reply) => {
  const { address } = request.params;
  const { level } = request.query;

  // --- Score + rank + totalParticipants ---
  // One CTE derives both: ranked row for the player + count window.
  const result = await fastify.db.execute(sql`
    WITH ranked AS (
      SELECT
        player,
        "totalStake",
        ROW_NUMBER() OVER (ORDER BY CAST("totalStake" AS NUMERIC) DESC) AS rank,
        COUNT(*) OVER () AS total_participants
      FROM baf_flip_totals
      WHERE level = ${level}
    )
    SELECT player, "totalStake", rank, total_participants
    FROM ranked
    WHERE player = ${address}
    UNION ALL
    SELECT NULL, '0', NULL, COALESCE((SELECT MAX(total_participants) FROM ranked), 0)
    WHERE NOT EXISTS (SELECT 1 FROM ranked WHERE player = ${address})
    LIMIT 1
  `);

  const row = (result as any).rows?.[0] ?? (result as any)[0];
  const score = row?.totalStake ?? '0';
  const rank = row?.rank != null ? Number(row.rank) : null;
  const totalParticipants = Number(row?.total_participants ?? 0);

  // --- roundStatus derivation ---
  let roundStatus: 'open' | 'closed' | 'skipped' | 'not_eligible';
  if (level % 10 !== 0) {
    roundStatus = 'not_eligible';
  } else {
    const [skipped] = await fastify.db
      .select({ level: bafSkipped.level })
      .from(bafSkipped)
      .where(eq(bafSkipped.level, level));
    if (skipped) {
      roundStatus = 'skipped';
    } else {
      const [distributed] = await fastify.db
        .select({ id: jackpotDistributions.id })
        .from(jackpotDistributions)
        .where(and(
          eq(jackpotDistributions.level, level),
          inArray(jackpotDistributions.awardType, ['eth_baf', 'tickets_baf']),
        ))
        .limit(1);
      roundStatus = distributed ? 'closed' : 'open';
    }
  }

  return {
    level,
    player: address,
    score,
    rank,
    totalParticipants,
    roundStatus,
  };
});
```

## New Schema Definitions

Add to `database/src/api/schemas/player.ts`:

```typescript
// INTEG-05 (Phase 54): GET /player/:address/baf
export const bafQuerySchema = z.object({
  level: z.coerce.number().int().min(1),
});

export const bafPlayerResponseSchema = z.object({
  level: z.number().int(),
  player: z.string(),
  score: z.string(),
  rank: z.number().int().nullable(),
  totalParticipants: z.number().int(),
  roundStatus: z.enum(['open', 'closed', 'skipped', 'not_eligible']),
});
```

## Error Modes

| Status | Condition | Response |
|--------|-----------|----------|
| 200 | Player has BAF stake at level | Full payload with non-null rank |
| 200 | Player has NO BAF stake at level | Full payload, score="0", rank=null, totalParticipants echoes level-wide count |
| 200 | Level has no entries at all | Full payload, all zeros; roundStatus reflects level-eligibility |
| 400 | `level` missing or invalid | `{ statusCode: 400, error: "Bad Request", message: "..." }` (Zod validation handles this) |

## Acceptance Criteria

- Endpoint reachable at `GET /player/:address/baf?level=N`
- `score` matches `mv_baf_top4.score` for the same `(player, level)` tuple when the player is in the top-4
- `rank` is 1 for the top staker at that level, continuing through 1..N
- `rank` is `null` when the player has no row in `baf_flip_totals` at that level (including all players at level % 10 != 0)
- `totalParticipants` equals `COUNT(DISTINCT player)` from `baf_flip_totals WHERE level = :level`
- `roundStatus === 'not_eligible'` when `level % 10 != 0`
- `roundStatus === 'skipped'` when a `baf_skipped` row exists for the level
- `roundStatus === 'closed'` when a BAF `jackpot_distributions` row exists for the level
- `roundStatus === 'open'` otherwise

## Timeline

Same pattern as INTEG-01 (Phase 52) and INTEG-02 (Phase 51) -- 3 atomic commits on `database/main`:

1. **Commit 1 -- `feat(api): add GET /player/:address/baf endpoint (INTEG-05)`** -- handler + schema definitions
2. **Commit 2 -- `docs(openapi): document /player/:address/baf (INTEG-05)`** -- openapi.json update
3. **Commit 3 -- `test(api): cover INTEG-05 happy path, rank null, empty level, not_eligible, skipped, closed`** -- Vitest tests

Precedent shipped in 3-5 minutes per Phase 51 INTEG-02 (`d135605`, `dab5adf`, `64fe8db`) and Phase 52 INTEG-01 (`a46fdcb`, `e130547`, `9988887`). Phase 54 INTEG-05 is comparable scope.

## Open Questions (for INTEG-05 spec)

1. **Should `?level=N` or `?day=M` be the primary query?** v1 ships `?level=N` only; defer `?day=M` support.
2. **Should the rank be a dense-rank or row-number?** Tied scores get sequential ranks with row-number (e.g., two players at 100 BURNIE get ranks 1 and 2 by insertion order). Dense-rank would give both rank 1. Backend uses row-number because `mv_baf_top4` already does. Consistency > philosophical correctness; ties are rare in practice.
3. **Should the endpoint echo the player's deposited coinflip amount for bundled coinflip+BAF rendering?** No -- separate concern. If the panel needs both, fetch from `/player/:address?day=N` (coinflip block) AND `/player/:address/baf?level=N` (BAF block).

## Confidence

- **HIGH** on the need + path (new endpoint class; no conflict with existing routes)
- **HIGH** on data source (`baf_flip_totals` is the authoritative indexed table; `handleBafFlipRecorded` stores cumulative `totalStake` per `(player, level)` pair)
- **HIGH** on `roundStatus` derivation (3 tables covered: `baf_skipped`, `jackpot_distributions`, level arithmetic)
- **MEDIUM** on the ROW_NUMBER CTE behavior (verified PostgreSQL supports the UNION ALL pattern but exact escape for parameter binding in Drizzle may need adjustment; the database team will finalize at commit time)
