#!/usr/bin/env python3
"""Build the high-angle FLIP chips used for player markers on game tables.

These are not recolors.  The green- and red-facing files are two 180-degree
turns of the one canonical FLIP coin, with the face and visible wall seam
rotated together.  Geometry is intentionally between face.svg's overhead
circle and coin.svg's low 3/4 ellipse so the logo remains readable at marker
sizes while the chip still has a physical edge.

The metallic gold/silver set is the temporary shooter-boost skin. It keeps the
same coin, seams, flame, camera, and stack geometry, but gives the two protocol
halves distinct minted-metal finishes while a player's boost is active.

Run from the website root:

    python3 shared/flip-chips/build-table-coins.py
"""

from pathlib import Path
import math
import re
import xml.dom.minidom


ROOT = Path(__file__).resolve().parent

# Preserve the exact canonical flame path instead of maintaining a second
# hand-edited logo.  Every emitted SVG still inlines it and is self-contained.
source = (ROOT / "coin.svg").read_text()
match = re.search(r'<path fill="#111111" d="m 431\.48[^"]*"/>', source)
if not match:
    raise RuntimeError("Could not find the canonical flame path in coin.svg")
FLAME = match.group(0)

W = 120
CY = 39
RX = 58
RY = 37
DEPTH = 11
SINGLE_H = 90
STACK_RISE = DEPTH

SILHOUETTE = (
    f"M2,{CY} a{RX},{RY} 0 0 1 {RX * 2},0 "
    f"l0,{DEPTH} a{RX},{RY} 0 0 1 -{RX * 2},0 z"
)
WALL_CLIP = (
    f"M2,{CY} l0,{DEPTH} a{RX},{RY} 0 0 0 {RX * 2},0 "
    f"l0,-{DEPTH} a{RX},{RY} 0 0 0 -{RX * 2},0 z"
)

RED_STOPS = (
    '<stop offset="0" stop-color="#ff675b"/>'
    '<stop offset="0.22" stop-color="#ed171a"/>'
    '<stop offset="0.72" stop-color="#a3070a"/>'
    '<stop offset="1" stop-color="#510204"/>'
)
GREEN_STOPS = (
    '<stop offset="0" stop-color="#72ed3c"/>'
    '<stop offset="0.22" stop-color="#30c908"/>'
    '<stop offset="0.72" stop-color="#197609"/>'
    '<stop offset="1" stop-color="#0b4604"/>'
)
GOLD_STOPS = (
    '<stop offset="0" stop-color="#fff3b0"/>'
    '<stop offset="0.09" stop-color="#edc45d"/>'
    '<stop offset="0.22" stop-color="#9b5d07"/>'
    '<stop offset="0.39" stop-color="#dca52b"/>'
    '<stop offset="0.52" stop-color="#fff0a0"/>'
    '<stop offset="0.66" stop-color="#ad6b09"/>'
    '<stop offset="0.82" stop-color="#e1ac35"/>'
    '<stop offset="1" stop-color="#4a2902"/>'
)
SILVER_STOPS = (
    '<stop offset="0" stop-color="#ffffff"/>'
    '<stop offset="0.09" stop-color="#dce5ea"/>'
    '<stop offset="0.22" stop-color="#697780"/>'
    '<stop offset="0.39" stop-color="#b8c4cb"/>'
    '<stop offset="0.52" stop-color="#f8fbfd"/>'
    '<stop offset="0.66" stop-color="#76848d"/>'
    '<stop offset="0.82" stop-color="#c8d2d8"/>'
    '<stop offset="1" stop-color="#2d373e"/>'
)

BRAND_PALETTE = {
    "metallic": False,
    "primary_stops": RED_STOPS,
    "secondary_stops": GREEN_STOPS,
    "logo_primary": "#ed0e11",
    "logo_secondary": "#30d100",
}
METAL_PALETTE = {
    "metallic": True,
    "primary_stops": GOLD_STOPS,
    "secondary_stops": SILVER_STOPS,
}
SILVER_METAL_PALETTE = {
    "metallic": True,
    "primary_stops": SILVER_STOPS,
    "secondary_stops": GOLD_STOPS,
    "swap_materials": True,
}


def wall_segments(theta: int):
    """Return visible green wall spans and their seams for this coin turn."""
    seam_angle = (135 - theta) % 360

    def is_green(angle):
        return (angle - seam_angle) % 360 < 180

    crossings = sorted(
        crossing
        for crossing in (seam_angle % 360, (seam_angle + 180) % 360)
        if 0.5 < crossing < 179.5
    )
    bounds = [0.0, *crossings, 180.0]
    segments = []
    for index in range(len(bounds) - 1):
        if not is_green((bounds[index] + bounds[index + 1]) / 2):
            continue
        xa = 60 + RX * math.cos(math.radians(bounds[index]))
        xb = 60 + RX * math.cos(math.radians(bounds[index + 1]))
        segments.append((min(xa, xb), max(xa, xb)))
    seams = [60 + RX * math.cos(math.radians(crossing)) for crossing in crossings]
    return segments, seams


def shared_defs(palette):
    metallic = palette["metallic"]
    if metallic:
        material_defs = '''
<linearGradient id="face-gold" x1="12" y1="106" x2="108" y2="14" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#704005"/>
  <stop offset="0.14" stop-color="#c88716"/>
  <stop offset="0.28" stop-color="#fff2ab"/>
  <stop offset="0.39" stop-color="#d4a139"/>
  <stop offset="0.55" stop-color="#925506"/>
  <stop offset="0.72" stop-color="#eac052"/>
  <stop offset="0.86" stop-color="#fff0a0"/>
  <stop offset="1" stop-color="#885006"/>
</linearGradient>
<linearGradient id="face-silver" x1="12" y1="106" x2="108" y2="14" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#35414a"/>
  <stop offset="0.14" stop-color="#8997a0"/>
  <stop offset="0.28" stop-color="#fbfdff"/>
  <stop offset="0.39" stop-color="#c5d0d6"/>
  <stop offset="0.55" stop-color="#5d6a73"/>
  <stop offset="0.72" stop-color="#d8e1e6"/>
  <stop offset="0.86" stop-color="#ffffff"/>
  <stop offset="1" stop-color="#59666f"/>
</linearGradient>
<linearGradient id="metal-sheen" x1="8" y1="104" x2="112" y2="16" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
  <stop offset="0.22" stop-color="#ffffff" stop-opacity="0.04"/>
  <stop offset="0.31" stop-color="#ffffff" stop-opacity="0.46"/>
  <stop offset="0.38" stop-color="#ffffff" stop-opacity="0.07"/>
  <stop offset="0.56" stop-color="#ffffff" stop-opacity="0"/>
  <stop offset="0.67" stop-color="#050708" stop-opacity="0.14"/>
  <stop offset="0.76" stop-color="#ffffff" stop-opacity="0"/>
  <stop offset="0.89" stop-color="#ffffff" stop-opacity="0.24"/>
  <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
</linearGradient>
<linearGradient id="metal-bevel" x1="18" y1="16" x2="105" y2="105" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#ffffff" stop-opacity="0.78"/>
  <stop offset="0.28" stop-color="#aeb8bd" stop-opacity="0.34"/>
  <stop offset="0.58" stop-color="#101316" stop-opacity="0.72"/>
  <stop offset="0.82" stop-color="#ffffff" stop-opacity="0.55"/>
  <stop offset="1" stop-color="#23292d" stop-opacity="0.72"/>
</linearGradient>
<radialGradient id="logo-core" cx="35%" cy="28%" r="78%">
  <stop offset="0" stop-color="#42474a"/>
  <stop offset="0.42" stop-color="#151719"/>
  <stop offset="1" stop-color="#030405"/>
</radialGradient>
<radialGradient id="logo-center" cx="36%" cy="27%" r="76%">
  <stop offset="0" stop-color="#ffffff"/>
  <stop offset="0.66" stop-color="#f7f5ed"/>
  <stop offset="1" stop-color="#cbd0d1"/>
</radialGradient>
<pattern id="metal-brush" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">
  <path d="M0,0.6 H3" stroke="#ffffff" stroke-opacity="0.09" stroke-width="0.34"/>
  <path d="M0,2.1 H3" stroke="#050607" stroke-opacity="0.055" stroke-width="0.3"/>
</pattern>'''
        if palette.get("swap_materials"):
            logo_primary = 'url(#face-silver)'
            logo_secondary = 'url(#face-gold)'
        else:
            logo_primary = 'url(#face-gold)'
            logo_secondary = 'url(#face-silver)'
        logo_core = 'url(#logo-core)'
        logo_center = 'url(#logo-center)'
        logo_finish = '''
  <circle cx="60" cy="60" r="53" fill="url(#metal-sheen)"/>
  <circle cx="60" cy="60" r="52.7" fill="url(#metal-brush)" opacity="0.72"/>
  <circle cx="60" cy="60" r="52.7" fill="none" stroke="url(#metal-bevel)" stroke-width="1.45"/>
  <circle cx="60" cy="60" r="42.25" fill="none" stroke="url(#metal-bevel)" stroke-width="1.55"/>'''
        face_rim_stops = (
            '<stop offset="0" stop-color="#f3f6f7"/>'
            '<stop offset="0.15" stop-color="#808a90"/>'
            '<stop offset="0.34" stop-color="#20262a"/>'
            '<stop offset="0.54" stop-color="#aeb7bc"/>'
            '<stop offset="0.72" stop-color="#30373c"/>'
            '<stop offset="0.88" stop-color="#d9dfe2"/>'
            '<stop offset="1" stop-color="#151a1e"/>'
        )
        face_gloss_stops = (
            '<stop offset="0" stop-color="#ffffff" stop-opacity="0.42"/>'
            '<stop offset="0.28" stop-color="#ffffff" stop-opacity="0.10"/>'
            '<stop offset="0.57" stop-color="#ffffff" stop-opacity="0"/>'
            '<stop offset="0.78" stop-color="#050708" stop-opacity="0.13"/>'
            '<stop offset="1" stop-color="#000000" stop-opacity="0.25"/>'
        )
        wall_mill = '''<pattern id="wall-mill" width="4.8" height="7" patternUnits="userSpaceOnUse">
  <rect width="4.8" height="7" fill="#ffffff" fill-opacity="0.035"/>
  <rect width="1.05" height="7" fill="#ffffff" fill-opacity="0.17"/>
  <rect x="1.4" width="1.15" height="7" fill="#050607" fill-opacity="0.20"/>
</pattern>'''
    else:
        material_defs = ''
        logo_primary = palette["logo_primary"]
        logo_secondary = palette["logo_secondary"]
        logo_core = '#111111'
        logo_center = '#ffffff'
        logo_finish = ''
        face_rim_stops = (
            '<stop offset="0" stop-color="#565b66"/>'
            '<stop offset="0.48" stop-color="#2b2e35"/>'
            '<stop offset="1" stop-color="#111217"/>'
        )
        face_gloss_stops = (
            '<stop offset="0" stop-color="#ffffff" stop-opacity="0.34"/>'
            '<stop offset="0.34" stop-color="#ffffff" stop-opacity="0.09"/>'
            '<stop offset="0.68" stop-color="#ffffff" stop-opacity="0"/>'
            '<stop offset="1" stop-color="#000000" stop-opacity="0.22"/>'
        )
        wall_mill = '''<pattern id="wall-mill" width="6.5" height="7" patternUnits="userSpaceOnUse">
  <rect width="6.5" height="7" fill="#ffffff" fill-opacity="0.045"/>
  <rect width="2.15" height="7" fill="#000000" fill-opacity="0.27"/>
</pattern>'''

    return f'''<linearGradient id="wall-red" x1="0" y1="{CY}" x2="0" y2="{CY + RY + DEPTH}" gradientUnits="userSpaceOnUse">{palette["primary_stops"]}</linearGradient>
<linearGradient id="wall-green" x1="0" y1="{CY}" x2="0" y2="{CY + RY + DEPTH}" gradientUnits="userSpaceOnUse">{palette["secondary_stops"]}</linearGradient>
{material_defs}
<linearGradient id="wall-curve" x1="2" y1="0" x2="118" y2="0" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#000000" stop-opacity="0.54"/>
  <stop offset="0.12" stop-color="#000000" stop-opacity="0.12"/>
  <stop offset="0.31" stop-color="#ffffff" stop-opacity="0.20"/>
  <stop offset="0.52" stop-color="#ffffff" stop-opacity="0.02"/>
  <stop offset="0.78" stop-color="#000000" stop-opacity="0.18"/>
  <stop offset="1" stop-color="#000000" stop-opacity="0.58"/>
</linearGradient>
<linearGradient id="face-rim" x1="15" y1="5" x2="106" y2="78" gradientUnits="userSpaceOnUse">
  {face_rim_stops}
</linearGradient>
<linearGradient id="face-gloss" x1="14" y1="4" x2="104" y2="76" gradientUnits="userSpaceOnUse">
  {face_gloss_stops}
</linearGradient>
{wall_mill}
<clipPath id="wall-clip"><path d="{WALL_CLIP}"/></clipPath>
<clipPath id="face-clip"><ellipse cx="60" cy="{CY}" rx="{RX}" ry="{RY}"/></clipPath>
<clipPath id="flame-clip"><circle cx="0" cy="0" r="31.5"/></clipPath>
<g id="logo-art">
  <path d="M 21.816,98.184 A 54,54 0 0 1 98.184,21.816 Z" fill="{logo_secondary}"/>
  <path d="M 21.816,98.184 A 54,54 0 0 0 98.184,21.816 Z" fill="{logo_primary}"/>
  <line x1="21.8" y1="98.2" x2="98.2" y2="21.8" stroke="#0a0a0c" stroke-opacity="0.48" stroke-width="1.6"/>
  {logo_finish}
  <circle cx="60" cy="60" r="40.5" fill="{logo_core}"/>
  <circle cx="60" cy="60" r="31.5" fill="{logo_center}"/>
  <g transform="matrix(1.26,0,0,1.26,59.714594,49.634935)">
    <g clip-path="url(#flame-clip)"><g transform="matrix(0.13,0,0,0.13,-56.16,-32.76)">{FLAME}</g></g>
  </g>
</g>'''


def coin_def(theta: int, name: str, palette):
    green_segments, seams = wall_segments(theta)
    green = "\n".join(
        f'<rect x="{left:.2f}" y="{CY}" width="{right - left:.2f}" '
        f'height="{RY + DEPTH + 2}" fill="url(#wall-green)"/>'
        for left, right in green_segments
    )
    seam_lines = "\n".join(
        f'<line x1="{x:.2f}" y1="{CY}" x2="{x:.2f}" y2="{CY + RY + DEPTH}" '
        'stroke="#090a0c" stroke-opacity="0.58" stroke-width="1.35"/>'
        for x in seams
    )
    # 37/54 retains the exact canonical circular artwork while projecting it
    # to the high-angle face ellipse.  Existing coin.svg uses 21/54 here.
    return f'''<g id="{name}">
  <path d="{SILHOUETTE}" fill="url(#wall-red)"/>
  <g clip-path="url(#wall-clip)">
    {green}
    {seam_lines}
    <rect x="2" y="{CY}" width="116" height="{RY + DEPTH + 2}" fill="url(#wall-mill)"/>
    <path d="{WALL_CLIP}" fill="url(#wall-curve)"/>
    <path d="M2,{CY + 1.15} a{RX},{RY} 0 0 0 {RX * 2},0" fill="none" stroke="#ffffff" stroke-opacity="0.42" stroke-width="1.2"/>
  </g>
  <ellipse cx="60" cy="{CY}" rx="{RX}" ry="{RY}" fill="url(#face-rim)"/>
  <g transform="translate(60,{CY}) scale(1.02778,{RY / 54:.6f}) translate(-60,-60)">
    <use href="#logo-art" xlink:href="#logo-art" transform="rotate({-theta} 60 60)"/>
  </g>
  <ellipse cx="60" cy="{CY}" rx="56.1" ry="35.8" fill="none" stroke="#050608" stroke-opacity="0.60" stroke-width="2.15" stroke-dasharray="4.2 8.8"/>
  <g clip-path="url(#face-clip)"><rect x="2" y="2" width="116" height="74" fill="url(#face-gloss)"/></g>
  <path d="M10.9,20.5 A56.7,35.6 0 0 1 109.1,20.5" fill="none" stroke="#ffffff" stroke-opacity="0.32" stroke-width="1.25"/>
  <path d="{SILHOUETTE}" fill="none" stroke="#150d08" stroke-width="2.8" stroke-linejoin="round"/>
</g>'''


def render_single(filename: str, theta: int, facing: str, palette=BRAND_PALETTE):
    coin_id = f"coin-{facing}"
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {W} {SINGLE_H}" width="{W}" height="{SINGLE_H}" shape-rendering="geometricPrecision">
<!-- {filename}: high-angle {facing}-facing orientation of the one canonical FLIP coin. Generated by build-table-coins.py. -->
<defs>
{shared_defs(palette)}
{coin_def(theta, coin_id, palette)}
</defs>
<use href="#{coin_id}" xlink:href="#{coin_id}"/>
</svg>
'''


def render_stack(filename: str, count: int, theta: int, facing: str, palette=BRAND_PALETTE):
    coin_id = f"coin-{facing}"
    height = SINGLE_H + STACK_RISE * (count - 1)
    # Paint from the base upward so each higher chip cleanly occludes the face
    # behind it.  One repeated turn keeps both color seams in a straight rack.
    body = "\n".join(
        f'<use href="#{coin_id}" xlink:href="#{coin_id}" '
        f'transform="translate(0 {STACK_RISE * layer})"/>'
        for layer in range(count - 1, -1, -1)
    )
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {W} {height}" width="{W}" height="{height}" shape-rendering="geometricPrecision">
<!-- {filename}: {count}-chip high-angle {facing}-facing FLIP stack with aligned seams. Generated by build-table-coins.py. -->
<defs>
{shared_defs(palette)}
{coin_def(theta, coin_id, palette)}
</defs>
{body}
</svg>
'''


outputs = {
    "coin-high-red.svg": render_single("coin-high-red.svg", 0, "red"),
    "coin-high-green.svg": render_single("coin-high-green.svg", 180, "green"),
    "coin-high-gold.svg": render_single("coin-high-gold.svg", 0, "gold", METAL_PALETTE),
    # Swap the two materials instead of rotating the whole face. This keeps
    # the opponent-facing silver edge while the directional FLIP flame stays
    # upright on the table.
    "coin-high-silver.svg": render_single(
        "coin-high-silver.svg", 0, "silver", SILVER_METAL_PALETTE,
    ),
}

for count in range(2, 11):
    for facing, theta in (("red", 0), ("green", 180)):
        filename = f"stack-{count}-high-{facing}.svg"
        outputs[filename] = render_stack(filename, count, theta, facing)
    for facing, theta, palette in (
        ("gold", 0, METAL_PALETTE),
        ("silver", 0, SILVER_METAL_PALETTE),
    ):
        filename = f"stack-{count}-high-{facing}.svg"
        outputs[filename] = render_stack(filename, count, theta, facing, palette)

for filename, svg in outputs.items():
    path = ROOT / filename
    path.write_text(svg)
    xml.dom.minidom.parse(str(path))
    print(f"wrote {path.relative_to(ROOT.parent.parent)}")


# Large escalated bets use the existing mound ladder. Derive two metallic
# table-only orientations from its dealer-composed art so a boost never falls
# back to ordinary red/green merely because the fifth-shooter escalator made
# the physical count large.
PILE_RED_STOPS = (
    '<stop offset="0" stop-color="#ff6152"/>'
    '<stop offset="0.35" stop-color="#e30f12"/>'
    '<stop offset="0.78" stop-color="#9c0608"/>'
    '<stop offset="1" stop-color="#5e0304"/>'
)
PILE_GREEN_STOPS = (
    '<stop offset="0" stop-color="#63e52c"/>'
    '<stop offset="0.35" stop-color="#28b303"/>'
    '<stop offset="0.78" stop-color="#1a7a09"/>'
    '<stop offset="1" stop-color="#0f5205"/>'
)
PILE_METAL_DEFS = '''
<linearGradient id="pile-face-gold" x1="12" y1="106" x2="108" y2="14" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#704005"/><stop offset="0.14" stop-color="#c88716"/>
  <stop offset="0.28" stop-color="#fff2ab"/><stop offset="0.39" stop-color="#d4a139"/>
  <stop offset="0.55" stop-color="#925506"/><stop offset="0.72" stop-color="#eac052"/>
  <stop offset="0.86" stop-color="#fff0a0"/><stop offset="1" stop-color="#885006"/>
</linearGradient>
<linearGradient id="pile-face-silver" x1="12" y1="106" x2="108" y2="14" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#35414a"/><stop offset="0.14" stop-color="#8997a0"/>
  <stop offset="0.28" stop-color="#fbfdff"/><stop offset="0.39" stop-color="#c5d0d6"/>
  <stop offset="0.55" stop-color="#5d6a73"/><stop offset="0.72" stop-color="#d8e1e6"/>
  <stop offset="0.86" stop-color="#ffffff"/><stop offset="1" stop-color="#59666f"/>
</linearGradient>
<linearGradient id="pile-face-rim" x1="15" y1="5" x2="106" y2="78" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#eef2f4"/><stop offset="0.18" stop-color="#737e85"/>
  <stop offset="0.42" stop-color="#1d2327"/><stop offset="0.62" stop-color="#abb5ba"/>
  <stop offset="0.82" stop-color="#30373c"/><stop offset="1" stop-color="#111518"/>
</linearGradient>'''

for level in range(5, 21):
    for facing in ("gold", "silver"):
        # Both skins inherit the upright pile composition. Silver swaps the
        # material roles rather than using the 180-degree `-c` artwork, which
        # used to turn every opponent flame upside down.
        source_path = ROOT / f"pile-{level}.svg"
        if not source_path.exists():
            continue
        filename = f"pile-{level}-metal-{facing}.svg"
        svg = source_path.read_text()
        primary_stops = GOLD_STOPS if facing == "gold" else SILVER_STOPS
        secondary_stops = SILVER_STOPS if facing == "gold" else GOLD_STOPS
        primary_face = 'url(#pile-face-gold)' if facing == "gold" else 'url(#pile-face-silver)'
        secondary_face = 'url(#pile-face-silver)' if facing == "gold" else 'url(#pile-face-gold)'
        svg = svg.replace(PILE_RED_STOPS, primary_stops)
        svg = svg.replace(PILE_GREEN_STOPS, secondary_stops)
        svg = svg.replace('<defs>', f'<defs>{PILE_METAL_DEFS}', 1)
        svg = svg.replace('fill="#30d100"', f'fill="{secondary_face}"')
        svg = svg.replace('fill="#ed0e11"', f'fill="{primary_face}"')
        svg = svg.replace('fill="#16181d"', 'fill="url(#pile-face-rim)"')
        svg = re.sub(
            r'<!-- pile-[^:]+:',
            f'<!-- {filename}: metallic shooter-boost table skin derived from',
            svg,
            count=1,
        ).replace('Generated by build-piles.py.', 'Generated by build-table-coins.py.', 1)
        path = ROOT / filename
        path.write_text(svg)
        xml.dom.minidom.parse(str(path))
        print(f"wrote {path.relative_to(ROOT.parent.parent)}")
