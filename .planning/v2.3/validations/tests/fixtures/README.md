# Phase 19 Test Fixtures

Recorded live API payloads from `localhost:3000`, captured 2026-04-13.

## Structure

- `replay_rng.json` — seeded subset of `/replay/rng` (days 2, 5, 50).
- `api/day-{N}-winners.json` — `/game/jackpot/day/{N}/winners` snapshots.
- `api/day-{N}-roll1.json`, `api/day-{N}-roll2.json` — Roll 1/2 distributions.

## Re-record

```
RUN_LIVE_VALIDATION=1 python -m validations.jackpot --record <day>
```

(Scaffolded minimally in Plan 19-01; expanded by 19-02..04.)

## Path-traversal guard

`fixtures_io.load_fixture(name)` rejects any name not matching
`^[A-Za-z0-9_\-\.]+$`. Do not place fixtures in subdirectories; use flat
names like `day-5-winners.json`.
