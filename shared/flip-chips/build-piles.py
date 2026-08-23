#!/usr/bin/env python3
"""Regenerate the FLIP pile ladder: pile-1.svg .. pile-20.svg + pile-ladder.css.

Run from the website root:  python3 shared/flip-chips/build-piles.py

Each level is a distinct seeded mound composition (drifting peak) that grows
bigger and messier. The coin recipe matches coin.svg exactly; face rotations
get physically correct wall segments. Compositions obey table physics: all
rows share one brick lattice (a stack either hides cleanly behind the stack
in front or emerges from a gap, never a half-overlap), each depth row sits on
one ground line at near-uniform coin scale, and a lean is a SHEAR (flat
coins sliding sideways coin over coin) sized so even the win-grown top cannot
enter a neighbor's space. The emitted pile-ladder.css chunk is spliced
between the AUTO-PILES markers in app/styles/coinflip-chipset.css by hand or
by rerunning this script's caller.
"""
import re, math, random, xml.dom.minidom, os

ROOT = os.path.dirname(os.path.abspath(__file__))

src = open(f'{ROOT}/coin.svg').read()
FLAME = re.search(r'<path fill="#111111" d="m 431\.48[^"]*"/>', src).group(0)
RED = '<stop offset="0" stop-color="#ff6152"/><stop offset="0.35" stop-color="#e30f12"/><stop offset="0.78" stop-color="#9c0608"/><stop offset="1" stop-color="#5e0304"/>'
GREEN = '<stop offset="0" stop-color="#63e52c"/><stop offset="0.35" stop-color="#28b303"/><stop offset="0.78" stop-color="#1a7a09"/><stop offset="1" stop-color="#0f5205"/>'
SIL = 'M2,23 a58,21 0 0 1 116,0 l0,16 a58,21 0 0 1 -116,0 z'
WALLC = 'M2,23 l0,16 a58,21 0 0 0 116,0 l0,-16 a58,21 0 0 0 -116,0 z'

DEFS = f'''<linearGradient id="wr" x1="0" y1="24" x2="0" y2="61" gradientUnits="userSpaceOnUse">{RED}</linearGradient>
<linearGradient id="wg" x1="0" y1="24" x2="0" y2="61" gradientUnits="userSpaceOnUse">{GREEN}</linearGradient>
<linearGradient id="curve" x1="2" y1="0" x2="118" y2="0" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="#000000" stop-opacity="0.45"/><stop offset="0.13" stop-color="#000000" stop-opacity="0.10"/><stop offset="0.30" stop-color="#ffffff" stop-opacity="0.18"/><stop offset="0.52" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.78" stop-color="#000000" stop-opacity="0.18"/><stop offset="1" stop-color="#000000" stop-opacity="0.52"/>
</linearGradient>
<linearGradient id="gloss" x1="14" y1="6" x2="100" y2="38" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="#ffffff" stop-opacity="0.34"/><stop offset="0.4" stop-color="#ffffff" stop-opacity="0.08"/><stop offset="0.7" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.20"/>
</linearGradient>
<pattern id="mill" width="7" height="8" patternUnits="userSpaceOnUse">
<rect x="0" y="0" width="7" height="8" fill="#ffffff" fill-opacity="0.05"/><rect x="0" y="0" width="2.6" height="8" fill="#000000" fill-opacity="0.26"/>
</pattern>
<clipPath id="wallc"><path d="{WALLC}"/></clipPath>
<clipPath id="facec"><ellipse cx="60" cy="23" rx="58" ry="21"/></clipPath>
<clipPath id="fclip"><circle cx="0" cy="0" r="31.5"/></clipPath>
<g id="logoart">
<path d="M 21.816,98.184 A 54,54 0 0 1 98.184,21.816 Z" fill="#30d100"/>
<path d="M 21.816,98.184 A 54,54 0 0 0 98.184,21.816 Z" fill="#ed0e11"/>
<line x1="21.8" y1="98.2" x2="98.2" y2="21.8" stroke="#0a0a0c" stroke-opacity="0.45" stroke-width="1.6"/>
<circle cx="60" cy="60" r="40.5" fill="#111111"/>
<circle cx="60" cy="60" r="31.5" fill="#ffffff"/>
<g transform="matrix(1.26,0,0,1.26,59.714594,49.634935)">
<g clip-path="url(#fclip)"><g transform="matrix(0.13,0,0,0.13,-56.16,-32.76)">
{FLAME}
</g></g></g>
</g>
<filter id="dim1" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="linear" slope="0.82"/><feFuncG type="linear" slope="0.82"/><feFuncB type="linear" slope="0.86"/></feComponentTransfer></filter>
<filter id="dim2" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="linear" slope="0.62"/><feFuncG type="linear" slope="0.62"/><feFuncB type="linear" slope="0.7"/></feComponentTransfer></filter>
<filter id="soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3"/></filter>
'''

THETAS = [0, 22, 45, 67, 90, 112, 135, 157, 180, 202, 225, 247, 270, 292, 315, 337]

def wall_segments(theta):
    a = (135 - theta) % 360
    green = lambda al: (al - a) % 360 < 180
    crossings = sorted(c for c in ((a % 360), ((a + 180) % 360)) if 0.5 < c < 179.5)
    bounds = [0.0] + crossings + [180.0]
    segs = [(min(60 + 58 * math.cos(math.radians(bounds[i + 1])), 60 + 58 * math.cos(math.radians(bounds[i]))),
             max(60 + 58 * math.cos(math.radians(bounds[i + 1])), 60 + 58 * math.cos(math.radians(bounds[i]))))
            for i in range(len(bounds) - 1) if green((bounds[i] + bounds[i + 1]) / 2)]
    return segs, [60 + 58 * math.cos(math.radians(c)) for c in crossings]

def coin_def(theta):
    segs, seams = wall_segments(theta)
    g = '\n'.join(f'<rect x="{a:.1f}" y="23" width="{b-a:.1f}" height="38" fill="url(#wg)"/>' for a, b in segs)
    ln = '\n'.join(f'<line x1="{x:.1f}" y1="23" x2="{x:.1f}" y2="60.8" stroke="#0a0a0c" stroke-opacity="0.5" stroke-width="1.5"/>' for x in seams)
    return (f'<g id="c{theta}">\n<path d="{SIL}" fill="url(#wr)"/>\n<g clip-path="url(#wallc)">\n{g}\n{ln}\n'
            f'<rect x="2" y="23" width="116" height="38" fill="url(#mill)"/>\n<path d="{WALLC}" fill="url(#curve)"/>\n'
            f'<path d="M2,24.6 a58,21 0 0 0 116,0" fill="none" stroke="#ffffff" stroke-opacity="0.4" stroke-width="1.4"/>\n</g>\n'
            f'<ellipse cx="60" cy="23" rx="58" ry="21" fill="#16181d"/>\n'
            f'<g transform="translate(60,23) scale(1.02778,0.37216) translate(-60,-60)">\n'
            f'<use href="#logoart" xlink:href="#logoart" transform="rotate({-theta} 60 60)"/>\n</g>\n'
            f'<g clip-path="url(#facec)"><rect x="2" y="2" width="116" height="42" fill="url(#gloss)"/></g>\n'
            f'<path d="M10.9,12.9 A56.7,20.2 0 0 1 109.1,12.9" fill="none" stroke="#ffffff" stroke-opacity="0.28" stroke-width="1.2"/>\n'
            f'<path d="{SIL}" fill="none" stroke="#150d08" stroke-width="2.8" stroke-linejoin="round"/>\n</g>')

COIN_DEFS = '\n'.join(coin_def(t) for t in THETAS)

ARCHETYPES = ['row', 'towers', 'mound', 'cascade', 'chaos']

# One rendered front-row coin stays ~1.6rem wide across the ladder
# (120px * 0.78 scale * PX_SCALE_REM). Whale rungs derive their CSS width
# from the finished composition at this scale, so growth is always MORE
# coins, never larger ones.
PX_SCALE_REM = 0.0169

# Daylight a stack needs to read as EMERGING from a gap rather than as a
# sliver jammed between the two stacks in front of it: about a quarter of a
# coin. Gaps narrower than this are butt joints, and nothing stands behind
# them.
EMERGE_MIN = 30.0

# How fast a mound falls away from its peak. At 1.6 the ends went to one or
# two coins: the pile read sparse at the shoulders AND could only make its
# count floor by inflating the stack count, which is how the ladder ends up
# sprawling instead of piling. A fuller shoulder buys the same coins inside
# the same footprint.
MOUND_TAPER = 0.95

# Win-overlay frames as shares of the base pile's coin count, matching the
# three payout classes Coinflip.sol actually rolls: ~5% unlucky (150% of the
# stake, so half the pile again), the [78,115] normal band, and ~5% lucky
# (250%+). Frames are CUMULATIVE prefixes of one addition sequence, so a
# bigger win is always the smaller win plus more coins.
WIN_FRACTIONS = (0.5, 1.0, 1.56)
# The historical single overlay. This frame alone sizes the base pile's
# viewBox and its footprint, which is what keeps pile-1..20 and their accepted
# attempts byte-identical. A luckier day may only grow TALLER on that same
# footprint; the sprite carries the extra headroom and the CSS gives the
# overlay element the matching extra height.
WIN_FREEZE_INDEX = 1

# Independent compositions per rung. The same bet size should not always show
# the same mound, so the UI picks a variant from the stake and every rung
# ships this many interchangeable piles of that size. Variant 'a' keeps the
# unsuffixed filename and drives the ladder's monotonic chain.
VARIANTS = 3
VSUF = ['', '-b', '-c']

# Rungs below this are ladder SCAFFOLDING: they still run, because every later
# rung's count and width floors chain off them, but no art or CSS is written.
# A two-layer scatter of 21-30 coins reads as less money than the three or
# four tidy 6-high stacks the composed lane shows below it, so flipPileLevel
# never serves them — keep this in step with FIRST_PILE_LEVEL in
# app/app/flip-piles.js.
FIRST_SERVED_LEVEL = 5
VLET = ['a', 'b', 'c']

# Squared-up compositions: equal columns, an even staircase, or two tidy runs.
# They stay grouped — one uniform joint across the whole lattice, no jitter,
# no lean, no spill — because an aligned rack reads as aligned only if it is
# all together.
ALIGNED_ARCHETYPES = ['rank', 'steps', 'block']

def heights(arch, k, tallest, rng):
    """Per-stack coin counts shaping the silhouette of one layer. The mound
    peak drifts off-center per layer so rungs keep individual character; the
    ALIGNED archetypes instead square the row up the way a dealer racks it."""
    peak = rng.uniform(0.35, 0.65)
    # Aligned rows commit to ONE reading and hold it across the whole row.
    rank_h = max(2, tallest - rng.randint(0, 1))
    step_lo = max(1, tallest - 1 - rng.randint(1, max(1, tallest - 2)))
    step_up = rng.random() < 0.5
    pair = (max(2, tallest - rng.randint(0, 1)), max(1, tallest - rng.randint(2, 4)))
    out = []
    for i in range(k):
        t = i / max(1, k - 1)
        if arch == 'row':      h = tallest - rng.randint(0, 1)
        elif arch == 'towers': h = tallest if (i == 0 or i == k - 1) else rng.randint(1, max(2, tallest - 2))
        elif arch == 'mound':  h = max(1, round(tallest * (1 - abs(t - peak) * MOUND_TAPER)) + rng.randint(0, 1))
        elif arch == 'cascade': h = max(1, tallest - round(t * (tallest - 1)) + rng.randint(0, 1))
        # ALIGNED: one flat rack of equal columns.
        elif arch == 'rank':   h = rank_h
        # ALIGNED: an even staircase, every step the same rise.
        elif arch == 'steps':  h = round(step_lo + (rank_h - step_lo) * (t if step_up else 1 - t))
        # ALIGNED: two squared-off runs, tall block beside short block.
        elif arch == 'block':  h = pair[0] if t < 0.55 else pair[1]
        else:                  h = rng.randint(1, tallest)
        out.append(max(1, min(tallest, h)))
    return out

def build_level(level, min_total=0, attempt=0, grown_cap_rem=None, variant=0, write=True, allow_aligned=True):
    rng = random.Random(7919 * level + 13 + 104729 * attempt + 15485863 * variant)
    # Variant 'a' is always the mound: it drives the ladder's monotonic chain,
    # and mixing archetypes ACROSS rungs is what made them statistically
    # incomparable (a dense rung sets a count bar its airier successor could
    # only beat by sprawling). Variants b and c are free of the chain, so they
    # are the ALIGNED compositions — squared-up racks the way a dealer sets
    # them down, one alignment per rung so the ladder shows several.
    # Whale rungs stay mounds on every variant: a rack deep enough to reach
    # their base-height floor would have to run either far more columns than
    # the rung's coin band allows or columns no dealer would build, and a
    # nine-figure pot reads as a sprawl anyway. Their variety is seed alone.
    arch = 'mound' if variant == 0 or level >= 16 or not allow_aligned \
        else ALIGNED_ARCHETYPES[(level + variant) % len(ALIGNED_ARCHETYPES)]
    aligned = arch != 'mound'
    # DEPTH is the density lever. Columns are bounded by the felt's width and
    # height by the plaque budget, but a pot can be as deep front-to-back as
    # it likes — and a big pot IS deep. The ladder covers a 320x value range
    # from rung 5 to rung 20, so the rows have to ramp with it.
    layers = 2 + (level > 4) + (level > 8) + (level > 12)
    # HEIGHT is what reads as money. A pile is judged against the four tidy
    # 6-high stacks the composed lane shows just below it, and a wide low
    # spread loses that comparison however many coins are in it — spending
    # every rung on width made rungs 1-12 read SMALLER than the stacks they
    # replaced. So the ladder buys height first: real columns, capped near the
    # plaque budget (base_h_cap), with the front row allowed to stand up
    # instead of being flattened to two coins.
    tallest = min(10, 5 + level // 2)
    front_cap = 3
    row_depth = 24
    # ...and a pot is not all tidy columns. The outermost lattice slots on
    # each side are PLANNED IN as spill rather than mound: each one comes up
    # empty felt, a loose coin or two, or a short stack standing off the
    # shoulder. Taking them out of the existing footprint instead of bolting
    # extra slots on the ends is what keeps the ladder's widths — a flanking
    # slot costs a whole coin-width of sprawl, and the pile is already as wide
    # as the felt allows.
    spill_slots = 0 if aligned else 1 + (level > 12)
    spill_empty = 0.34
    if level >= 16:
        # Whale rungs: a fifth layer, taller towers, deeper rows. (Back-row
        # coins render near full size now, so the tower budget is lower than
        # it was at the old 0.55 depth scale.)
        layers = 5
        tallest = 9 + (level - 16) // 4
        front_cap = 3
        row_depth = 32 + (level - 16) * 2
        k_fixed = {16: 7, 17: 7, 18: 8, 19: 8, 20: 9}[level] + attempt // 12
    else:
        # Stack count is the width knob: a fixed per-level table, monotone by
        # construction. No carryover from the previous rung's retries — an
        # accepted bump used as the next rung's floor ratchets the whole
        # ladder into runaway sprawl.
        k_fixed = 3 + round(level / 5.0) + attempt // 20

    # An aligned rack is set down, not thrown down: no per-coin jitter, no
    # lean, and one gap repeated across the lattice.
    # A rack is one or two rows deep — a dealer sets payouts down in front of
    # the pot, not in a five-deep drift. Aligned variants spend their coins on
    # columns instead, which is also what keeps their count inside the mound's
    # band: a rank runs every column at full height where a mound tapers.
    if aligned:
        layers = 2 + (level > 8) + (level > 12)
    mess = 0.0 if aligned else 0.5 + level * 0.075
    lean_max = 0.0 if aligned else 3 + level * 0.55

    placed, body_layers, total = [], [], 0
    # One shared brick lattice for the whole pile: even-depth rows stand ON
    # the lattice slots, odd-depth rows hold one fewer stack, centered in the
    # gaps. A stack in a neighboring row therefore either hides cleanly
    # behind the stack in front of it or emerges from a gap; the arbitrary
    # partial overlaps that made intermixed stacks read as impossible objects
    # are gone by construction. Coin scale barely shrinks with depth: a table
    # pile a few rows deep shows almost no size change, and the old steep
    # shrink read as different-sized coins, not distance.
    front_w = 120 * 0.78
    # One joint, repeated: either a tight rack or an evenly spaced one.
    aligned_gap = rng.uniform(7, 10) if rng.random() < 0.5 \
        else rng.uniform(EMERGE_MIN, EMERGE_MIN + 6)
    lattice, lat_gaps, run = [], [], rng.uniform(0, 14)
    for _i in range(k_fixed):
        lattice.append(run)
        # Gaps are BIMODAL. A stack in the row behind is centered on the gap
        # in front of it, so a narrow gap shows it as a two-pixel sliver
        # wedged between two stacks — neither hidden nor emerged, and the eye
        # reads it as one coin slicing through another. Every gap is therefore
        # either CLOSED (butt joint, wide enough only to clear the per-coin
        # jitter, so the row behind hides cleanly) or OPEN (a stack's worth of
        # daylight, so what stands in it emerges as a stack).
        gap = aligned_gap if aligned else (
            rng.uniform(6, 11) if rng.random() < 0.5
            else rng.uniform(EMERGE_MIN, EMERGE_MIN + 7 * min(mess, 1.5)))
        lat_gaps.append(gap)
        run += front_w + gap
    for li in range(layers):
        s = 0.70 + (0.78 - 0.70) * li / max(1, layers - 1)
        coin_w = 120 * s
        odd = li % 2 == 1
        # An odd row takes the doctrine's two legal positions, per joint: it
        # EMERGES from the gap when the gap is open, and otherwise tucks in
        # directly behind the stack in front of it, where it HIDES CLEANLY.
        # Straddling a closed joint is the third, illegal case — a sliver.
        if odd:
            xs = []
            right = -1e9
            for j in range(max(1, k_fixed - 1)):
                x = (lattice[j] + front_w + lat_gaps[j] / 2 - coin_w / 2) \
                    if lat_gaps[j] >= EMERGE_MIN \
                    else (lattice[j] + (front_w - coin_w) / 2)
                # Mixing the two modes can put an emerged stack and the next
                # tucked one barely half a coin apart. Two stacks on ONE
                # ground line may never overlap — that is the impossible
                # object, not the occlusion between rows — so a position that
                # would collide with the one before it goes unfilled.
                if x < right:
                    continue
                xs.append(x)
                right = x + coin_w
        else:
            xs = [lattice[j] + (front_w - coin_w) / 2 for j in range(k_fixed)]
        k = max(1, len(xs))
        gaps = [xs[j + 1] - (xs[j] + coin_w) for j in range(k - 1)]
        hs = heights(arch, k, tallest if li < layers - 1 else max(1, tallest - 2), rng)
        if li == layers - 1:
            hs = [min(h, front_cap) for h in hs]
        # The mound's own slots are the interior ones; the ends are spill, and
        # spill is FRONT ROW ONLY. A back row reaching past the front row's
        # coverage would stand there with its base showing at a ground line
        # 48px up the picture — a stack hovering above the felt.
        spill = spill_slots if k > 2 * spill_slots + 1 else 0
        for i in list(range(spill)) + list(range(k - spill, k)):
            hs[i] = 0 if li < layers - 1 or rng.random() < spill_empty else (
                1 if rng.random() < 0.55 else rng.randint(2, max(2, tallest // 2)))
        y = 52 + li * row_depth
        items, leaned_gaps = [], set()
        for i, h in enumerate(hs):
            if h <= 0:
                continue
            x = xs[i]
            ts = [THETAS[rng.randrange(16)] for _ in range(h)]
            yj = y if aligned else y + rng.uniform(-1.2, 1.2)
            # A lean is a SHEAR: every coin lies flat and each slides a
            # little sideways over the one below, the way chip stacks
            # actually lean. (A rigid tip lifts the far bottom edge and
            # shows felt under the stack; per-coin rotation slices through
            # stack neighbors.) Row ends may shear outward; an interior
            # stack only into an unclaimed gap wide enough for the
            # WIN-grown top (a win roughly doubles a stack).
            shear = 0.0
            if li == layers - 1 or rng.random() < 0.25:
                shear_max = math.tan(math.radians(lean_max)) * 16 * s
                sign, room, claim = 0, 0.0, None
                if i == 0:
                    sign, room = -1, 1e9
                elif i == k - 1:
                    sign, room = 1, 1e9
                else:
                    lg = gaps[i - 1] if (i - 1) not in leaned_gaps else 0.0
                    rg = gaps[i] if i not in leaned_gaps else 0.0
                    sign, room, claim = (-1, lg, i - 1) if lg >= rg else (1, rg, i)
                cap_px = shear_max if room > 1e8 \
                    else min(shear_max, room * 0.85 / max(1.0, 2.1 * h))
                shear = round(sign * rng.uniform(0.3, 1.0) * cap_px, 2)
                if abs(shear) < 0.5:
                    shear = 0.0
                elif claim is not None:
                    leaned_gaps.add(claim)
            items.append((x, yj, s, ts, shear))
            total += h
        placed.append((li, items))
        body_layers.append(items)

    # Plaque clearance. The pile is blessed to bury the printed TODAY'S BET
    # box and climb past the red/green boundary, but the BAF plaque (and the
    # mirrored all-time record plaque) own the felt's mid-line corners: no
    # coin may enter either plaque band. Tall growth is therefore confined to
    # the center; any stack whose footprint reaches the plaque x-band is
    # trimmed until it passes below the plaques' underside. Every level
    # renders at the fixed PX_SCALE_REM coin, so px * PX_SCALE_REM IS the
    # rendered rem size and no width guessing is needed.
    def _box(x, y, s, ts, sh):
        # Column box plus the shear drift of the upper coins.
        m = 2.5 * s + 3
        top = y - 16 * s * (len(ts) - 1) - m
        off = sh * (len(ts) - 1)
        a = x - m + min(0.0, off)
        b = x + 120 * s + m + max(0.0, off)
        return a, b, top, y + 64 * s + m
    boxes = [_box(*it) for items in body_layers for it in items]
    cx = (min(b[0] for b in boxes) + max(b[1] for b in boxes)) / 2
    baseline = max(b[3] for b in boxes)
    shoulder_px = SHOULDER_X_REM / PX_SCALE_REM
    def _in_shoulder(a, b):
        return a < cx - shoulder_px or b > cx + shoulder_px
    for items in body_layers:
        for (x, y, s, ts, sh) in items:
            a, b, _top, _bot = _box(x, y, s, ts, sh)
            if not _in_shoulder(a, b):
                continue
            while len(ts) > 1 and (
                baseline - _box(x, y, s, ts, sh)[2]
            ) * PX_SCALE_REM > SHOULDER_H_REM:
                ts.pop()
    total = sum(len(ts) for items in body_layers for (_x, _y, _s, ts, _sh) in items)

    # win additions (raw coordinates): grow the SAME composition — a winning
    # flip roughly doubles the pile. Coins land where a tossed coin would
    # settle: on the stacks with the most headroom under their ceiling (the
    # grown cap in the center, the plaque underside on the shoulders), so
    # growth fills the valleys instead of walling up whichever side the base
    # mound already favored. Additions inherit the base stack's lean AND
    # pivot, so grown coins ride the tipped top instead of hovering beside
    # it.
    # The day pays 150%-256% of the stake, so ONE overlay cannot tell the
    # story: WIN_FRACTIONS are the contract's three outcome classes as shares
    # of the base pile (unlucky 50%, the [78,115] normal band, lucky 150%),
    # emitted as cumulative frames of one sprite. The FREEZE fraction is the
    # historical single overlay: everything at or below it is generated
    # exactly as before, and it alone sets the viewBox — so the base ladder
    # and its accepted attempts are untouched. Growth past the freeze may only
    # SPREAD into the composition's own gaps, never climb out of the frame.
    additions = []
    front = placed[-1][1] if placed else []
    mid = placed[-2][1] if len(placed) > 1 else front
    goals = [max(3, round(total * f)) for f in WIN_FRACTIONS]
    goal = goals[-1]
    frozen_x = None
    marks = []
    added, tries = 0, 0
    pool = [[x, y, s, list(ts), sh] for (x, y, s, ts, sh) in ((mid + front) or front)]
    def _headroom(st):
        x, y, s, ts, sh = st
        a, b, _top, _bot = _box(x, y, s, ts, sh)
        centre = grown_cap_rem - 0.1
        # WIN-ONLY chips may cover the BAF plaque (user call 2026-08-17); the
        # plaque is only protected from the pile the table shows all day. Past
        # the freeze the shoulders open up, which is where a lucky day finds
        # the room to actually look lucky on the whale rungs.
        limit = centre if frozen_x is not None \
            else (SHOULDER_H_REM if _in_shoulder(a, b) else centre)
        top_rem = (baseline - (y - 16 * s * len(ts) - (2.5 * s + 3))) * PX_SCALE_REM
        return limit - top_rem
    def _freeze():
        # The frame the historical overlay drew. Its horizontal bounds are the
        # sprite's walls from here on: a lucky day grows TALLER on the same
        # footprint, so every frame keeps the base file's width and the
        # overlay stays pinned to the pile's own left and right edges.
        boxes = [_box(*it) for items in body_layers for it in items]
        boxes += [_box(*it[:5]) for it in additions]
        return (min(b[0] for b in boxes), max(b[1] for b in boxes))
    while added < goal and pool and tries < goal * 8:
        tries += 1
        pool.sort(key=_headroom, reverse=True)
        st = pool[rng.randrange(min(3, len(pool)))]
        x, y, s, ts, sh = st
        extra = rng.randint(1, 3)
        newts = [THETAS[rng.randrange(16)] for _ in range(extra)]
        jx = 0.0
        room_coins = int(_headroom(st) / (16 * s * PX_SCALE_REM))
        if room_coins < 1:
            pool.remove(st)
            continue
        newts = newts[:min(extra, room_coins)]
        top_y = y - 16 * s * len(ts)
        # The addition starts where the base stack's shear line has drifted
        # to, carries the same shear so the line continues, and remembers its
        # stack's ground line so the overlay can paint back-to-front.
        cand = (x + sh * len(ts) + jx,
                top_y, s, newts, sh, y)
        if frozen_x is not None:
            a, b, _t, _bt = _box(*cand[:5])
            if a < frozen_x[0] or b > frozen_x[1]:
                pool.remove(st)
                continue
        additions.append(cand)
        ts.extend(newts)
        added += len(newts)
        while len(marks) < len(goals) and added >= goals[len(marks)]:
            marks.append(len(additions))
            if len(marks) == WIN_FREEZE_INDEX + 1:
                frozen_x = _freeze()
    while len(marks) < len(goals):
        marks.append(len(additions))
        if len(marks) == WIN_FREEZE_INDEX + 1:
            frozen_x = _freeze()
    frozen_additions = additions[:marks[WIN_FREEZE_INDEX]]

    # exact content bounds over base AND win coins: stack rise lifts tops,
    # rigid-lean sweeps push sides. The overlay shares this viewBox, so grown
    # tops size the headroom exactly; the art is bottom-anchored (center
    # bottom / contain), so the frame hugs the lowest coin — any dead band
    # below would float the pile off the felt.
    # Only the frozen frame sizes the box: later frames are held inside it by
    # construction, so adding the lucky-day coins can never move the ladder.
    xs_min, xs_max, ys_min, ys_max = [], [], [], []
    ys_min_body, ys_max_body = [], []
    for items in body_layers + [frozen_additions]:
        for it in items:
            a, b, top, bot = _box(*it[:5])
            xs_min.append(a)
            xs_max.append(b)
            ys_min.append(top)
            ys_max.append(bot)
            if items is not frozen_additions:
                ys_min_body.append(top)
                ys_max_body.append(bot)
    tx, ty = -min(xs_min) + 3, -min(ys_min) + 3
    W = round(max(xs_max) + tx + 3)
    H = round(max(ys_max) + ty + 3)
    width_rem = round(W * PX_SCALE_REM, 2)
    # Rendered height of the BASE composition (the pre-win pile the table
    # shows all day). The main loop rejects attempts whose base mound would
    # climb into the BAF rank plaque at the felt's bottom-left corner — big
    # pots must sprawl WIDE past the printed box, never up over that readout.
    base_h_rem = (max(ys_max_body) - min(ys_min_body)) * width_rem / max(W, 1)
    for items in body_layers:
        for j, (x, y, s, ts, sh) in enumerate(items):
            items[j] = (x + tx, y + ty, s, ts, sh)
    # The sprite's own frame: same width and same baseline as the base pile,
    # but tall enough for the luckiest day's coins. The overlay element gets
    # exactly this much extra height in CSS, so every frame's coins land on
    # the base composition at 1:1.
    ty_add = max(ty, -min(_box(*it[:5])[2] for it in additions) + 3) if additions else ty
    H_add = round(max(ys_max) + ty_add + 3)
    # Kept in ADD order: every frame is a prefix of this list, and a prefix is
    # always physically whole because each addition landed on the stack as it
    # stood at that moment. Painting order is applied per frame.
    additions = [(x + tx, y + ty_add, s, ts, sh, gy + ty_add)
                 for (x, y, s, ts, sh, gy) in additions]

    jit = [0, 2.5, -2, 1.5, -1, 2]
    def emit_stack(x, y, s, ts, shear, jitter=True):
        rows = []
        for i, t in enumerate(ts):
            cx = x + (jit[i % 6] * s * min(mess, 1.3) if jitter else 0.0) + shear * i
            cy = y - 16 * s * i
            rows.append(f'<use href="#c{t}" xlink:href="#c{t}" transform="translate({cx:.1f} {cy:.1f}) scale({s:.2f})"/>')
        return '\n'.join(rows)

    # No baked shadows: a detached dark ellipse under the coins reads as the
    # pile hovering, and it smears across whatever rail sits under the art.
    # Depth comes from the back-layer dim filters and the consumer's own
    # drop-shadow.
    body = []
    for li, items in placed:
        filt = 'dim2' if li == 0 and layers > 2 else ('dim1' if li < layers - 1 else None)
        coins = '\n'.join(emit_stack(*it) for it in items)
        grp = f'<g filter="url(#{filt})">' if filt else '<g>'
        body.append(f'{grp}\n{coins}\n</g>')

    out = (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
           f'viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n'
           f'<!-- pile-{level}{VSUF[variant]}.svg: wager ladder level {level} ({arch}), variant {VLET[variant]}. Generated by build-piles.py. -->\n'
           f'<defs>{DEFS}{COIN_DEFS}</defs>\n' + '\n'.join(body) + '\n</svg>\n')
    path = f'{ROOT}/pile-{level}{VSUF[variant]}.svg'
    if write:
        open(path, 'w').write(out)
        xml.dom.minidom.parse(path)

    # One sprite, one frame per payout class, stacked top to bottom and each
    # the size of the base pile's own viewBox. The consumer picks a frame with
    # background-position alone, so the overlay element stays inset:0 over the
    # pile and every frame lands on the identical composition.
    frames = []
    for k, mark in enumerate(marks):
        # Within a frame, coins paint back-to-front by their stack's ground
        # line: an addition on a rear stack must never draw over a nearer one.
        coins = '\n'.join(emit_stack(*it[:5], jitter=False)
                          for it in sorted(additions[:mark], key=lambda it: it[5]))
        frames.append(f'<g transform="translate(0 {k * H_add})">\n{coins}\n</g>')
    add_out = (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
               f'viewBox="0 0 {W} {H_add * len(marks)}" width="{W}" height="{H_add * len(marks)}">\n'
               f'<!-- pile-{level}{VSUF[variant]}-add.svg: win growth sprite for pile-{level}{VSUF[variant]}. '
               f'{len(marks)} cumulative frames of {W}x{H_add}, one per payout class '
               f'({", ".join(f"{f:g}x" for f in WIN_FRACTIONS)} of the base pile). '
               f'Shares pile-{level}{VSUF[variant]}.svg\'s width and baseline; the extra '
               f'{H_add - H}px of headroom is added to the overlay element in CSS. '
               f'Generated by build-piles.py. -->\n'
               f'<defs>{DEFS}{COIN_DEFS}</defs>\n' + '\n'.join(frames) + '\n</svg>\n')
    add_path = f'{ROOT}/pile-{level}{VSUF[variant]}-add.svg'
    if write:
        open(add_path, 'w').write(add_out)
        xml.dom.minidom.parse(add_path)
    return W, H, total, base_h_rem, width_rem, k_fixed, H_add

# A dealer's stack is one chip design racked face-forward, so every coin in a
# neat column shares ONE rotation and the red/green wall seams line up into
# continuous vertical lines. Randomizing rotation per coin is precisely what
# makes a column read as a pile someone shoved together. Three orientations
# ship per height so a rank of stacks is not a row of identical twins:
# `a` is the canonical logo turn (red wall, green sliver), `b` splits the wall
# down the middle, `c` is its green counterpart.
NEAT_TURNS = {'': 0, 'b': 45, 'c': 180}

def build_stack(n, messy, turn=''):
    """One free-standing column of n coins: stack-{n}[-b|-c].svg is
    dealer-neat — every coin at the same rotation, seams aligned — and
    stack-{n}-messy.svg drifts sideways coin to coin and leans a few faces so
    the column reads hand-cut, not machine-racked. Bottom-tight viewBox (any
    dead band under the base coin floats the stack off whatever it sits on);
    like coin.svg/stack.svg, contact shadows stay unbaked."""
    rng = random.Random(1201 * n + (17 if messy else 0))
    coins = []
    drift = 0.0
    for i in range(n):
        if messy and i > 0:
            drift = max(-9.0, min(9.0, drift + rng.uniform(-5.5, 5.5)))
        lean = 0.0
        if messy and (i == n - 1 or rng.random() < 0.3):
            lean = round(rng.uniform(-4.5, 4.5), 1)
        # The messy column keeps its per-coin turns; that jumble is the point.
        theta = THETAS[rng.randrange(16)] if messy else NEAT_TURNS[turn]
        coins.append((drift, -16.0 * i, theta, lean))
    margins = [abs(l) * 1.3 + 1 for (_x, _y, _t, l) in coins]
    tx = -min(x - m for (x, _y, _t, _l), m in zip(coins, margins)) + 3
    ty = 16.0 * (n - 1) + 3
    W = round(max(x + 120 + m for (x, _y, _t, _l), m in zip(coins, margins)) + tx + 3)
    H = round(64 + 16 * (n - 1) + margins[0] + 3 + 3)
    body = '\n'.join(
        f'<use href="#c{t}" xlink:href="#c{t}" transform="translate({x + tx:.1f} {y + ty:.1f})'
        + (f' rotate({l} 60 44)' if l else '') + '"/>'
        for (x, y, t, l) in coins)
    used = '\n'.join(coin_def(t) for t in sorted({t for (_x, _y, t, _l) in coins}))
    name = f'stack-{n}-messy' if messy else f'stack-{n}{"-" + turn if turn else ""}'
    out = (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
           f'viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n'
           f'<!-- {name}.svg: {n}-coin FLIP stack{" with hand-cut drift and lean" if messy else ""}. '
           f'Generated by build-piles.py. -->\n'
           f'<defs>{DEFS}{used}</defs>\n<g>\n{body}\n</g>\n</svg>\n')
    path = f'{ROOT}/{name}.svg'
    open(path, 'w').write(out)
    xml.dom.minidom.parse(path)
    return W, H

css = ['/* AUTO-PILES begin — generated by shared/flip-chips/build-piles.py */']
prev, prev_width, prev_k = 0, 0.0, 2
css.append('''body.layout-basic .df-bet-pile {
  position: relative;
  z-index: 3;
  display: block;
  flex: 0 0 auto;
  align-self: flex-end;
  max-width: calc(100% + 5.2rem);
  background: center bottom / contain no-repeat;
  filter: drop-shadow(0 0.06rem 0.09rem rgba(0, 0, 0, 0.5));
  animation: df-pile-arrive 0.4s cubic-bezier(0.2, 0.84, 0.3, 1) backwards;
}''')
# The wager pile's baseline and the BAF rank plaque hang off the same
# panel-midline coordinate system, so the vertical budgets are viewport-
# independent: the plaque underside sits ~4.9rem above the pile baseline and
# its top ~6.5rem. Only the plaques' horizontal distance from the pile's
# center varies with panel width; ~5.4rem is the 360px-phone floor, which is
# what SHOULDER_X_REM protects with margin.
#
# Doctrine (user-approved 2026-08-16): a big enough pile may bury the printed
# TODAY'S BET box and climb past the red/green boundary; the felt is
# sacrificial. The BAF plaque is not. Tall growth stays inside the shoulder
# window; outside it every coin holds below the plaques' underside.
SHOULDER_X_REM = 5.0
SHOULDER_H_REM = 4.55

def count_floor(level):
    # How many coins a rung must place. The old 1.09-a-rung curve was set when
    # the ladder opened at rung 1 and only had to beat ~19 composed chips; it
    # left rung 12 (a 7.6M FLIP pot) showing barely 60 coins. The ladder now
    # spans a 320x value range, so the curve is steeper — and capped where the
    # geometry actually tops out, since columns are bounded by the felt and
    # height by the plaque budget.
    return round(min(190, 20 * 1.155 ** (level - 1)))

def base_h_cap(level):
    # Everything under the plaques through level 12; whale rungs then climb,
    # topping out near 5.6rem of center-tall base mound at level 20.
    return 4.15 if level <= 12 else 4.15 + 0.18 * (level - 12)

def base_h_floor(level):
    # Whale rungs must LOOK the part: the base mound passes the printed box
    # (~4.4rem) immediately and the red/green line (~4.8rem) by level 18.
    return 4.2 + 0.25 * (level - 16)

def grown_h_cap(_level):
    # The GROWN pile is win-only chips, and those may cover the BAF plaque
    # (user call 2026-08-17) — only base_h_cap still protects it. This is now
    # just a sanity ceiling on how far a payout may climb up the felt, and it
    # is deliberately generous: holding the grown height near the base's own
    # budget was rejecting every attempt at the denser mid rungs.
    return 6.6

for level in range(1, 21):
    # Every rung renders at the fixed PX_SCALE_REM coin (~1.58rem front coin,
    # matching the composed-stack chips below 100K), so the CSS width is
    # composition-derived everywhere: crossing the threshold keeps the same
    # physical coin, there is just more of it. Width monotonicity rides on
    # the monotone stack count (prev_k), not on a width bar — an accepted
    # width as the next rung's floor ratchets attempt inflation into
    # runaway sprawl.
    # Every rung ships VARIANTS independent compositions of the same size. The
    # UI picks one from the stake, so two players at the same bet do not stare
    # at the identical mound; variant 'a' drives the ladder's monotonic chain.
    chain = None
    chain_n = None
    for variant in range(VARIANTS):
        # An aligned rack that cannot satisfy the rung's bands falls back to a
        # mound rather than shipping an out-of-band pile: every rung always
        # has three valid alternates, aligned where alignment fits.
        picked = None
        for allow_aligned in ((True, False) if variant else (False,)):
          for attempt in range(36 if variant == 0 else 90):
              # Whale rungs cap grown height in-loop so a doubled pot flattens
              # out instead of failing every attempt; sub-whale rungs keep the
              # post-hoc rejection.
              W, H, n, base_h, width, k, H_add = build_level(
                    level, prev, attempt, grown_h_cap(level),
                  variant, level >= FIRST_SERVED_LEVEL, allow_aligned)
              if base_h > base_h_cap(level) or H * width / W > grown_h_cap(level):
                  continue
              # A rung's variants are alternates of the SAME bet, so they have
              # to read as the same money. Aligned racks pack far more coins
              # into a footprint than a mound does, so they are banded against
              # variant a rather than left to their own floors.
              if chain_n is not None and not (
                      chain_n[0] * 0.85 <= n <= chain_n[0] * 1.45
                      and base_h >= chain_n[1] * 0.85
                      and width <= chain_n[2] * 1.12):
                  continue
              if level <= 15:
                  # Sub-whale rungs hold a count-floor curve and may never thin
                  # visibly below or render narrower than the previous rung.
                  # NOTE: rungs 1-4 are ladder scaffolding only — they still set
                  # the count/width floors every later rung is measured against,
                  # but flipPileLevel no longer serves them. They must keep being
                  # generated: dropping them would re-chain prev/prev_width.
                  if n >= max(count_floor(level), round(prev * 0.8)) \
                          and width >= prev_width - 0.2:
                      picked = (W, H, n, base_h, width, k, H_add)
                      break
              # Whale rungs grow by silhouette: the base-height floors ramp
              # +0.25rem a rung and the width may never shrink, so each rung
              # reads strictly bigger even when an airier composition places
              # fewer coins.
              elif width >= prev_width - 0.2 and width <= 18.2 \
                      and base_h >= base_h_floor(level) and n >= round(prev * 0.95):
                  picked = (W, H, n, base_h, width, k, H_add)
                  break
          if picked:
              break
        if picked:
            W, H, n, base_h, width, k, H_add = picked
        if variant == 0:
            chain, chain_n = (n, width, k), (n, base_h, width)
        if level < FIRST_SERVED_LEVEL:
            continue
        sel = f'[data-pile="{level}"]' + (f'[data-variant="{VLET[variant]}"]'
                                          if variant else '')
        css.append(f'''body.layout-basic .df-bet-pile{sel} {{
  width: {width:.2f}rem;
  aspect-ratio: {W} / {H};
  background-image: url('/shared/flip-chips/pile-{level}{VSUF[variant]}.svg');
}}

body.layout-basic .df-bet-pile{sel} > .df-bet-pile-add {{
  height: {H_add / H * 100:.1f}%;
  background-image: url('/shared/flip-chips/pile-{level}{VSUF[variant]}-add.svg');
}}''')
        print(f'pile-{level}{VSUF[variant]}: {n} coins, {W}x{H}, '
              f'base {base_h:.2f}rem tall, attempt {attempt}')
    prev, prev_width, prev_k = chain
css.append('''/* On a win the SAME pile grows: the add overlay shares the base file's
   viewBox, so its extra coins land exactly on the original composition. The
   overlay file is a vertical sprite of cumulative frames — one per payout
   class — so how much the pile grows is how much the day paid. */
body.layout-basic .df-bet-pile-add {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: block;
  background-repeat: no-repeat;
  background-size: 100% ''' + f'{len(WIN_FRACTIONS) * 100}%' + ''';
  background-position: center 100%;
  animation: df-pile-arrive 0.45s cubic-bezier(0.2, 0.84, 0.3, 1) 0.28s backwards;
}

''' + '\n\n'.join(
    f'''body.layout-basic .df-bet-pile-add[data-pay="{k}"] {{
  background-position-y: {k * 100 / (len(WIN_FRACTIONS) - 1):.0f}%;
}}''' for k in range(len(WIN_FRACTIONS))
) + '''

@media (prefers-reduced-motion: reduce) {
  body.layout-basic .df-bet-pile-add {
    animation: none;
  }
}''')
css.append('/* AUTO-PILES end */')
open(f'{ROOT}/pile-ladder.css', 'w').write('\n\n'.join(css) + '\n')
print('wrote pile-ladder.css')

for n in range(2, 11):
    sizes = {turn: build_stack(n, False, turn) for turn in NEAT_TURNS}
    mw, mh = build_stack(n, True)
    neat = ' '.join(f'{turn or "a"}={w}x{h}' for turn, (w, h) in sizes.items())
    print(f'stack-{n}: neat {neat}, messy {mw}x{mh}')
