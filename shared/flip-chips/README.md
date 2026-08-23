# /shared/flip-chips/ — the canonical FLIP chip set

One source of art for every surface that shows FLIP as physical chips. All
files are self-contained SVG (safe in `<img>`, CSS `background`, and canvas
`drawImage`) and carry root `width`/`height` attributes.

There is exactly ONE FLIP coin design: **green top side, red bottom side**,
seam running diagonal-up like the flame logo, and the wall under any point of
the ring continues that point's color. Variants are orientations of that same
coin, never recolors — a coin with red on top does not exist.

| File | viewBox | What it is |
| --- | --- | --- |
| `face.svg` | 120×120 | Top-down chip icon: the split flame logo with a milled coin rim. Buttons, compact "FLIP as a chip" marks. |
| `coin.svg` | 120×64 | THE FLIP coin in 3/4 view, logo orientation. Visible wall band = 16/64 = 25% of image height (transparent padding below). |
| `coin-spun.svg` | 120×64 | The same coin given a spin on the felt (face art rotated −22°, wall seam recomputed to match). Use for pile variety. |
| `stack.svg` / `stack-spun.svg` | 120×128 | Pre-baked five-coin stacks at 16-unit rise — every coin, top included, shows the same 25% band. |
| `stack-2.svg` … `stack-10.svg` (+ `-b`, `-c`) | varies | The stack ladder: free-standing dealer-neat columns of 2–10 coins. **Every coin in a column shares ONE rotation**, so the wall seams run in unbroken vertical lines the way a racked stack of one chip design does — per-coin spins are exactly what makes a column read as a shoved-together pile. Three turns ship per height so a rank of stacks is not a row of twins: unsuffixed is the canonical logo turn (red wall, green sliver), `-b` splits the wall down the middle, `-c` is its green counterpart. Bottom-tight viewBox, so the base coin sits flush on whatever the art is anchored to. |
| `stack-N-messy.svg` | varies | The same heights hand-cut: coins drift sideways coin to coin, a few faces lean, and each coin keeps its own spin, for spots where a machine-racked column would look staged. |
| `pile-5.svg` … `pile-20.svg` (+ `-b`, `-c`) | varies | The wager ladder: seeded mound compositions growing from 37 coins to roughly a 180-coin whale sprawl, three interchangeable variants per rung so one bet size is not one fixed picture. Variant `a` is the mound: real columns plus planned spill, where the outermost lattice slots on each side come up empty felt, a loose coin, or a short stack. Variants `-b` and `-c` are ALIGNED racks — equal columns, an even staircase, or two squared runs, set down all together with one repeated joint and no jitter, lean, or spill. Levels are spaced ×1.45 to keep the large-wager ladder legible. **Rungs 1-4 are not shipped:** a two-layer scatter of 21-30 coins reads as LESS money than the tidy stacks below it, so common wagers grow through composed stacks before the mound ladder opens at rung 5 (100K FLIP). The generator still computes them — every later rung's count and width floors chain off them. |
| `pile-N-add.svg` (+ `-b`, `-c`) | W × 3·H | Legacy win-growth sprite: three vertically stacked frames of extra coins on the same footprint and baseline as `pile-N.svg`, cumulative, at 0.5× / 1.0× / 1.56× the base pile. The live coinflip felt now keeps the original pile and pays it off with a bounded rank of `stack-N.svg` dealer columns in front of it; these generated sprites remain available to isolated art consumers. |

## Usage

Static decoration:

```html
<img src="/shared/flip-chips/stack.svg" alt="" width="40">
```

Dynamic stacks (how `/app/` composes wagers — see `coinflip-chipset.css`):
layer N absolutely-positioned elements with
`background: url('/shared/flip-chips/coin.svg') center / 100% 100% no-repeat`,
raising each by **25% of the coin's rendered height** (the wall-band fraction:
equal rise gives every coin an identical visible band; never exceed 26% or
buried faces peek out). Alternate `coin.svg` / `coin-spun.svg` per pile. Add
depth with `filter: drop-shadow(...)` — contact shadows are intentionally not
baked into the assets.

Escalate presentation with the amount the way the app does
(`coinflipBetPresentation`): composed stacks below 100K FLIP, then ladder level
`min(20, floor(log(flip/100000)/log(1.45)) + 5)`. Regenerate the whole ladder
(piles, the stack ladder, and `pile-ladder.css`) with
`python3 shared/flip-chips/build-piles.py`, then splice the css between the
AUTO-PILES markers in `coinflip-chipset.css`.

Keep rendered aspects at the native ratios or the ellipses distort. Brand
tones live in the art: green `#30d100`, red `#ed0e11`.

Regenerating: the face art is the exact geometry of
`/whitepaper/flame-logo-split.svg` inlined into each file (SVG-in-img cannot
load external resources). Derive `coin-spun` by rotating the face group
(`rotate(-22 60 60)` before the squash) and recomputing the wall seam x as
`60 + 58·cos(135° + θ_ccw)`; stacks and piles are `<use>` compositions of the
coin bodies. If the logo ever changes, rebuild from it rather than editing
the flame path by hand.
