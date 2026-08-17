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
| `stack-2.svg` … `stack-10.svg` | varies | The stack ladder: free-standing dealer-neat columns of 2–10 coins with seeded face spins. Bottom-tight viewBox, so the base coin sits flush on whatever the art is anchored to. |
| `stack-N-messy.svg` | varies | The same heights hand-cut: coins drift sideways coin to coin and a few faces lean, for spots where a machine-racked column would look staged. |
| `pile-1.svg` … `pile-20.svg` | varies | The wager ladder: twenty distinct seeded compositions (archetypes cycle row / towers / mound / cascade / chaos) growing from ~19 coins with a proper tower to a ~135-coin whale sprawl. The first rung deliberately beats the composed-stacks lane's ~17-coin peak so crossing the 50K threshold never reads as the bet shrinking. Levels are spaced ×1.45 so any ≥×1.5 win crosses a level. |
| `pile-N-add.svg` | same as its base | Win-growth overlay: extra coins in the SAME viewBox as `pile-N.svg`. Layer it over the base (absolute inset 0, same contain fit) so a win grows the original pile in place instead of switching graphics. |

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
(`coinflipBetPresentation`): composed stacks below 50K FLIP, then ladder level
`min(20, floor(log(flip/50000)/log(1.45)) + 1)`. Regenerate the whole ladder
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
