#!/usr/bin/env python3
"""Regenerate the FLIP pile ladder: pile-1.svg .. pile-20.svg + pile-ladder.css.

Run from the website root:  python3 shared/flip-chips/build-piles.py

Each level is a distinct seeded composition (archetypes cycle: row, towers,
mound, cascade, chaos) that grows bigger and messier. The coin recipe matches
coin.svg exactly; face rotations get physically correct wall segments. The
emitted pile-ladder.css chunk is spliced between the AUTO-PILES markers in
app/styles/coinflip-chipset.css by hand or by rerunning this script's caller.
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

def heights(arch, k, tallest, rng):
    """Per-stack coin counts shaping the silhouette of one layer."""
    out = []
    for i in range(k):
        t = i / max(1, k - 1)
        if arch == 'row':      h = tallest - rng.randint(0, 1)
        elif arch == 'towers': h = tallest if (i == 0 or i == k - 1) else rng.randint(1, max(2, tallest - 2))
        elif arch == 'mound':  h = max(1, round(tallest * (1 - abs(t - 0.5) * 1.6)) + rng.randint(0, 1))
        elif arch == 'cascade': h = max(1, tallest - round(t * (tallest - 1)) + rng.randint(0, 1))
        else:                  h = rng.randint(1, tallest)
        out.append(max(1, min(tallest, h)))
    return out

def build_level(level, min_total=0, attempt=0, width_rem=None, grown_cap_rem=None):
    rng = random.Random(7919 * level + 13 + 104729 * attempt)
    arch = ARCHETYPES[(level - 1) % len(ARCHETYPES)]
    # The composed-stacks lane below 50K peaks around 17 tidy coins, so the
    # ladder's FIRST rung must already beat that or crossing the threshold
    # reads as the bet shrinking. Start near 20 and grow to the ~110-coin
    # whale sprawl.
    coins_target = round(17 * (1.095 ** level) * (1 + 0.12 * attempt))
    layers = 2 + (level > 4) + (level > 12)
    # Height carries perceived value as much as count: even level 1 owns a
    # proper 4-coin tower rather than a spill of singles.
    base_tallest = min(8, 4 + level // 4)
    tallest = base_tallest
    front_cap = 2
    row_depth = 24
    k_fixed = None
    if level >= 16:
        # Whale rungs: a fifth layer, taller towers, deeper rows, and an
        # explicit stack count. The render width is derived from the finished
        # composition at the fixed physical coin size, so these rungs read as
        # a genuinely bigger mountain, not the same art stretched.
        layers = 5
        tallest = 10 + (level - 16) // 2
        front_cap = 3
        row_depth = 32 + (level - 16) * 2
        k_fixed = {16: 9, 17: 10, 18: 11, 19: 11, 20: 12}[level] + attempt // 12
    mess = 0.5 + level * 0.075
    lean_max = 3 + level * 0.55
    scales = [0.56 + 0.06 * li / max(1, layers - 1) + 0.12 * (li == layers - 1) for li in range(layers)]

    placed, body_layers, total = [], [], 0
    for li in range(layers):
        s = 0.55 + (0.78 - 0.55) * li / max(1, layers - 1)
        k = k_fixed if k_fixed is not None \
            else max(2, round((coins_target / layers) / max(1.6, base_tallest * 0.62)))
        hs = heights(arch, k, tallest if li < layers - 1 else max(1, tallest - 2), rng)
        if li == layers - 1:
            hs = [min(h, front_cap) for h in hs]
        pitch = 118 * s * 0.92
        x0 = rng.uniform(0, 14) + (li % 2) * pitch * 0.35
        y = 52 + li * row_depth
        items = []
        for i, h in enumerate(hs):
            x = x0 + i * pitch + rng.uniform(-6, 6) * mess
            lean = round(rng.uniform(-lean_max, lean_max), 1) if (li == layers - 1 or rng.random() < 0.25) else 0
            ts = [THETAS[rng.randrange(16)] for _ in range(h)]
            items.append((x, y + rng.uniform(-3, 3) * mess, s, ts, lean))
            total += h
        placed.append((li, items))
        body_layers.append(items)

    # Plaque clearance. The pile is blessed to bury the printed TODAY'S BET
    # box and climb past the red/green boundary, but the BAF plaque (and the
    # mirrored all-time record plaque) own the felt's mid-line corners: no
    # coin may enter either plaque band. Tall growth is therefore confined to
    # the center; any stack whose footprint reaches the plaque x-band is
    # trimmed until it passes below the plaques' underside.
    def _margin(s, l):
        return (2.5 + abs(l) * 0.9) * s + 3
    def _span(x, s, l):
        m = _margin(s, l)
        return x - m, x + 120 * s + m
    spans = [_span(x, s, l) for items in body_layers for (x, _y, s, _ts, l) in items]
    est_w = max(b for _a, b in spans) - min(a for a, _b in spans) + 6
    if width_rem is None:
        width_rem = round(est_w * PX_SCALE_REM, 2)
    scale = width_rem / max(1, est_w)
    cx = (min(a for a, _b in spans) + max(b for _a, b in spans)) / 2
    baseline = max(y + 64 * s + _margin(s, l)
                   for items in body_layers for (_x, y, s, _ts, l) in items)
    shoulder_px = SHOULDER_X_REM / scale
    def _in_shoulder(a, b):
        return a < cx - shoulder_px or b > cx + shoulder_px
    for items in body_layers:
        for (x, y, s, ts, l) in items:
            a, b = _span(x, s, l)
            if not _in_shoulder(a, b):
                continue
            while len(ts) > 1 and (
                baseline - (y - 16 * s * (len(ts) - 1) - _margin(s, l))
            ) * scale > SHOULDER_H_REM:
                ts.pop()
    total = sum(len(ts) for items in body_layers for (_x, _y, _s, ts, _l) in items)

    # win additions (raw coordinates): grow the SAME composition — a winning
    # flip roughly doubles the pile, so extra coins land on existing stack
    # tops (each stack's grown height is tracked so repeat visits keep
    # climbing) plus a few fresh strays on the ground line (~100% more).
    # Every stack refuses additions past its ceiling: the grown cap for
    # center stacks, the plaque underside for shoulder stacks.
    additions = []
    front = placed[-1][1] if placed else []
    mid = placed[-2][1] if len(placed) > 1 else front
    goal = max(3, round(total * 1.0))
    added, i = 0, 0
    pool = [[x, y, s, list(ts), l] for (x, y, s, ts, l) in ((mid + front) or front)]
    while added < goal and pool and i < goal * 8:
        x, y, s, ts, l = pool[i % len(pool)]
        i += 1
        extra = rng.randint(1, 3)
        newts = [THETAS[rng.randrange(16)] for _ in range(extra)]
        jx = rng.uniform(-3, 3)
        top_y = y - 16 * s * len(ts)
        a, b = _span(x, s, l)
        grown_top = top_y - 16 * s * (extra - 1) - _margin(s, l)
        limit = SHOULDER_H_REM if _in_shoulder(a, b) \
            else (grown_cap_rem - 0.1 if grown_cap_rem else 1e9)
        if (baseline - grown_top) * scale > limit:
            continue
        additions.append((x + jx * mess, top_y, s, newts, l))
        ts.extend(newts)
        added += extra
    base_left = min(x for items in body_layers for (x, _y, _s, _ts, _l) in items)
    base_right = max(x + 120 * s for items in body_layers for (x, _y, s, _ts, _l) in items)
    base_bottom = max(y + 64 * s for items in body_layers for (_x, y, s, _ts, _l) in items)
    for _ in range(1 + level // 8):
        s = 0.74
        additions.append((rng.uniform(base_left, max(base_left + 1, base_right - 120 * s)),
                          base_bottom - 64 * s - 2, s,
                          [THETAS[rng.randrange(16)]], round(rng.uniform(-12, 12), 1)))

    # exact content bounds over base AND win coins: stack rise lifts tops,
    # jitter/lean push sides. The overlay shares this viewBox, so grown tops
    # size the headroom exactly; the art is bottom-anchored (center bottom /
    # contain), so the frame hugs the lowest coin — any dead band below would
    # float the pile off the felt.
    xs_min, xs_max, ys_min, ys_max = [], [], [], []
    ys_min_body, ys_max_body = [], []
    for items in body_layers + [additions]:
        for (x, y, s, ts, l) in items:
            margin = (2.5 + abs(l) * 0.9) * s + 3
            xs_min.append(x - margin)
            xs_max.append(x + 120 * s + margin)
            ys_min.append(y - 16 * s * (len(ts) - 1) - margin)
            ys_max.append(y + 64 * s + margin)
            if items is not additions:
                ys_min_body.append(ys_min[-1])
                ys_max_body.append(ys_max[-1])
    tx, ty = -min(xs_min) + 3, -min(ys_min) + 3
    W = round(max(xs_max) + tx + 3)
    H = round(max(ys_max) + ty + 3)
    # Rendered height of the BASE composition (the pre-win pile the table
    # shows all day). The main loop rejects attempts whose base mound would
    # climb into the BAF rank plaque at the felt's bottom-left corner — big
    # pots must sprawl WIDE past the printed box, never up over that readout.
    base_h_rem = (max(ys_max_body) - min(ys_min_body)) * width_rem / max(W, 1)
    for items in body_layers:
        for j, (x, y, s, ts, l) in enumerate(items):
            items[j] = (x + tx, y + ty, s, ts, l)
    additions = [(x + tx, y + ty, s, ts, l) for (x, y, s, ts, l) in additions]

    jit = [0, 2.5, -2, 1.5, -1, 2]
    def emit_stack(x, y, s, ts, lean):
        rows = []
        for i, t in enumerate(ts):
            cx = x + jit[i % 6] * s * mess
            cy = y - 16 * s * i
            rot = f' rotate({lean} 60 44)' if lean else ''
            rows.append(f'<use href="#c{t}" xlink:href="#c{t}" transform="translate({cx:.1f} {cy:.1f}) scale({s:.2f}){rot}"/>')
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
           f'<!-- pile-{level}.svg: wager ladder level {level} ({arch}). Generated by build-piles.py. -->\n'
           f'<defs>{DEFS}{COIN_DEFS}</defs>\n' + '\n'.join(body) + '\n</svg>\n')
    path = f'{ROOT}/pile-{level}.svg'
    open(path, 'w').write(out)
    xml.dom.minidom.parse(path)

    add_coins = '\n'.join(emit_stack(*it) for it in additions)
    add_out = (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
               f'viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n'
               f'<!-- pile-{level}-add.svg: win growth overlay for pile-{level} (same viewBox). Generated by build-piles.py. -->\n'
               f'<defs>{DEFS}{COIN_DEFS}</defs>\n<g>\n{add_coins}\n</g>\n</svg>\n')
    add_path = f'{ROOT}/pile-{level}-add.svg'
    open(add_path, 'w').write(add_out)
    xml.dom.minidom.parse(add_path)
    return W, H, total, base_h_rem, width_rem

def build_stack(n, messy):
    """One free-standing column of n coins: stack-{n}.svg is dealer-neat,
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
        coins.append((drift, -16.0 * i, THETAS[rng.randrange(16)], lean))
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
    name = f'stack-{n}-messy' if messy else f'stack-{n}'
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
prev, prev_width = 0, 0.0
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

def base_h_cap(level):
    # Everything under the plaques through level 12; whale rungs then climb,
    # topping out near 5.6rem of center-tall base mound at level 20.
    return 4.15 if level <= 12 else 4.15 + 0.18 * (level - 12)

def base_h_floor(level):
    # Whale rungs must LOOK the part: the base mound passes the printed box
    # (~4.4rem) immediately and the red/green line (~4.8rem) by level 18.
    return 4.2 + 0.25 * (level - 16)

def grown_h_cap(level):
    # The win overlay climbs from the same baseline; the fully-grown whale
    # pile may reach ~6.35rem, still under the plaques' top line.
    return 5.2 if level <= 12 else 5.2 + 0.145 * (level - 12)

for level in range(1, 21):
    # Sized so a level-1 front coin matches the composed-stack chip width
    # (~1.58rem): crossing the 50K threshold keeps the same physical coin,
    # there is just more of it. From 16 up the width is composition-derived
    # (preset None): the whale rungs sprawl wall to wall AND climb inside the
    # shoulder window.
    preset = 6.0 + level * 0.45 if level <= 15 else None
    for attempt in range(36):
        # Sub-whale rungs keep their established compositions: the center
        # grown cap stays a post-hoc rejection there (in-loop capping would
        # shift which attempt passes), while whale rungs cap in-loop so a
        # doubled pot flattens out instead of failing every attempt.
        W, H, n, base_h, width = build_level(
            level, prev, attempt, preset, grown_h_cap(level) if level >= 16 else None)
        if base_h > base_h_cap(level) or H * width / W > grown_h_cap(level):
            continue
        if level <= 15:
            # Sub-whale rungs grow by coin count.
            if n > prev:
                break
        # Whale rungs grow by silhouette: the base-height floors ramp +0.25rem
        # a rung and the width may never shrink, so each rung reads strictly
        # bigger even when an airier archetype places fewer coins.
        elif width >= prev_width - 0.2 and width <= 18.2 and base_h >= base_h_floor(level):
            break
    prev, prev_width = n, width
    css.append(f'''body.layout-basic .df-bet-pile[data-pile="{level}"] {{
  width: {width:.2f}rem;
  aspect-ratio: {W} / {H};
  background-image: url('/shared/flip-chips/pile-{level}.svg');
}}

body.layout-basic .df-bet-pile[data-pile="{level}"] > .df-bet-pile-add {{
  background-image: url('/shared/flip-chips/pile-{level}-add.svg');
}}''')
    print(f'pile-{level}: {n} coins, {W}x{H}, base {base_h:.2f}rem tall, attempt {attempt}')
css.append('''/* On a win the SAME pile grows: the add overlay shares the base file's
   viewBox, so its extra coins land exactly on the original composition. */
body.layout-basic .df-bet-pile-add {
  position: absolute;
  inset: 0;
  display: block;
  background: center bottom / contain no-repeat;
  animation: df-pile-arrive 0.45s cubic-bezier(0.2, 0.84, 0.3, 1) 0.28s backwards;
}

@media (prefers-reduced-motion: reduce) {
  body.layout-basic .df-bet-pile-add {
    animation: none;
  }
}''')
css.append('/* AUTO-PILES end */')
open(f'{ROOT}/pile-ladder.css', 'w').write('\n\n'.join(css) + '\n')
print('wrote pile-ladder.css')

for n in range(2, 11):
    W, H = build_stack(n, False)
    mw, mh = build_stack(n, True)
    print(f'stack-{n}: {W}x{H} neat, {mw}x{mh} messy')
