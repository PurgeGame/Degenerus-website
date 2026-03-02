#!/usr/bin/env python3
"""Build GAME_THEORY_ANALYSIS.html from .md with proper math protection."""

import os
import re
import markdown

SRC = "GAME_THEORY_ANALYSIS.md"
DST = "analysis/index.html"

with open(SRC) as f:
    md_text = f.read()

# --- Phase 1: Protect math from markdown processing ---
# Replace inline $...$ and display $$...$$ with placeholders
math_store = []

def stash_math(m):
    idx = len(math_store)
    math_store.append(m.group(0))
    return f"\x00MATH{idx}\x00"

# Display math first (greedy $$...$$), then inline ($...$)
md_text = re.sub(r'\$\$(.+?)\$\$', stash_math, md_text, flags=re.DOTALL)
md_text = re.sub(r'\$([^\$\n]+?)\$', stash_math, md_text)

# --- Phase 2: Convert markdown to HTML ---
html_body = markdown.markdown(md_text, extensions=["tables", "fenced_code"])

# --- Phase 3: Restore math from placeholders ---
def restore_math(m):
    idx = int(m.group(1))
    return math_store[idx]

html_body = re.sub(r'\x00MATH(\d+)\x00', restore_math, html_body)

# --- Phase 3.5: Inject interactive widgets ---
widget_path = "gta-jackpot-widget.html"
if os.path.exists(widget_path):
    with open(widget_path) as wf:
        widget_html = wf.read()
    html_body = html_body.replace('<!-- JACKPOT_WIDGET -->', widget_html)

chart_path = "gta-sim-chart.html"
if os.path.exists(chart_path):
    with open(chart_path) as cf:
        chart_html = cf.read()
    html_body = html_body.replace('<!-- SIM_CHART -->', chart_html)

# --- Phase 4: Wrap theorem/proof/definition blocks ---
block_types = {
    "Theorem": "theorem",
    "Proposition": "proposition",
    "Definition": "definition",
    "Corollary": "corollary",
    "Lemma": "lemma",
    "Claim": "claim",
    "Design Property": "design-property",
    "Proof": "proof",
    "Proof sketch": "proof",
}

for label, css_class in block_types.items():
    # Match <p><strong>Label N.N</strong> or <p><strong>Label N.N (Title)</strong>
    pattern = rf'<p><strong>{re.escape(label)}[\s\d.]*(?:\([^)]*\))?\.?</strong>'

    # Find all starts
    parts = []
    last_end = 0
    for m in re.finditer(pattern, html_body):
        # Find the closing </p> for this paragraph
        start = m.start()
        # Find end of this block - look for next blank-line-equivalent (next <p>, <h, <div, <table, <hr, or end)
        block_end = start
        # Consume paragraphs that belong to this block
        pos = start
        depth = 0
        first = True
        while pos < len(html_body):
            if first:
                # Find end of first <p>...</p>
                p_end = html_body.find('</p>', pos)
                if p_end == -1:
                    break
                block_end = p_end + 4
                pos = block_end
                first = False
                continue
            # Check if next content is a continuation paragraph (not a heading, table, hr, or new block)
            rest = html_body[pos:].lstrip()
            if rest.startswith(('<h', '<table', '<hr', '<nav', '<div', '<pre')):
                break
            # Check if it's a new theorem/proof/definition block
            is_new_block = False
            for bl in block_types:
                if rest.startswith(f'<p><strong>{bl}'):
                    is_new_block = True
                    break
            if is_new_block:
                break
            if rest.startswith('<p>'):
                p_end = html_body.find('</p>', pos)
                if p_end == -1:
                    break
                block_end = p_end + 4
                pos = block_end
                continue
            if rest.startswith('<ul>') or rest.startswith('<ol>'):
                # Find matching close
                tag = 'ul' if rest.startswith('<ul>') else 'ol'
                close = html_body.find(f'</{tag}>', pos)
                if close == -1:
                    break
                block_end = close + len(f'</{tag}>')
                pos = block_end
                continue
            break

        parts.append(html_body[last_end:start])
        block_content = html_body[start:block_end]
        parts.append(f'<div class="{css_class}">{block_content}</div>')
        last_end = block_end

    if parts:
        parts.append(html_body[last_end:])
        html_body = ''.join(parts)

# QED markers for proofs
html_body = re.sub(r'∎', '<span style="float:right">∎</span>', html_body)

# --- Phase 5: Add section IDs and build TOC ---
toc_entries = []
section_count = [0]

def add_id(m):
    tag = m.group(1)
    content = m.group(2)
    level = int(tag[1])
    if level < 2:
        return m.group(0)  # skip h1
    section_count[0] += 1
    sid = f"section-{section_count[0]}"
    toc_class = "" if level == 2 else ' class="toc-sub"'
    toc_entries.append(f'<li{toc_class}><a href="#{sid}">{content}</a></li>')
    return f'<{tag} id="{sid}">{content}</{tag}>'

html_body = re.sub(r'<(h[1-6])>(.*?)</\1>', add_id, html_body)

toc_html = '<nav class="toc"><h2>Table of Contents</h2><ul>\n' + '\n'.join(toc_entries) + '\n</ul></nav>'

# Insert TOC after first </h1> or at start
h1_end = html_body.find('</h1>')
if h1_end != -1:
    insert_pos = h1_end + 5
    html_body = html_body[:insert_pos] + '\n' + toc_html + '\n' + html_body[insert_pos:]
else:
    html_body = toc_html + '\n' + html_body

# --- Phase 6: Wrap in full HTML document ---
full_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>The Mechanism Design of Resilient Games</title>
<link rel="stylesheet" href="/shared/nav.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"
  onload="renderMathInElement(document.body,{{delimiters:[{{left:'$$',right:'$$',display:true}},{{left:'$',right:'$',display:false}}],throwOnError:false}});"></script>
<style>
:root{{--text:#1a1a1a;--bg:#fefefe;--accent:#2c3e50;--theorem-bg:#f0f4f8;--theorem-border:#3498db;--proof-bg:#fafafa;--proof-border:#95a5a6;--def-bg:#fdf6e3;--def-border:#e67e22;--prop-bg:#f0fff0;--prop-border:#27ae60;--corollary-bg:#f5f0ff;--corollary-border:#8e44ad;--claim-bg:#f0f7f7;--claim-border:#0097a7;--design-property-bg:#f5f2ee;--design-property-border:#795548;--link:#2980b9}}
*{{box-sizing:border-box;margin:0;padding:0}}
.page{{font-family:'Latin Modern Roman','Computer Modern','CMU Serif',Georgia,'Times New Roman',serif;font-size:17px;line-height:1.65;color:var(--text);background:var(--bg);max-width:740px;margin:0 auto;padding:2rem 1.5rem 4rem;text-align:justify;hyphens:auto}}
.page h1{{font-size:1.9rem;text-align:center;margin:2rem 0 .5rem;line-height:1.3;letter-spacing:-.01em}}
.page h2{{font-size:1.4rem;margin:2.5rem 0 1rem;padding-bottom:.3rem;border-bottom:1px solid #ddd;color:var(--accent)}}
.page h3{{font-size:1.15rem;margin:1.8rem 0 .8rem;color:var(--accent)}}
.page h4{{font-size:1.05rem;margin:1.3rem 0 .6rem;font-style:italic}}
.page p{{margin:.8rem 0}}
.page ul,.page ol{{margin:.6rem 0 .6rem 1.8rem}}
.page li{{margin:.25rem 0}}
.page a{{color:var(--link);text-decoration:none}}
.page a:hover{{text-decoration:underline}}
.page hr{{border:none;border-top:1px solid #ddd;margin:2.5rem 0}}
.page table{{width:100%;border-collapse:collapse;margin:1.2rem 0;font-size:.92rem;line-height:1.5}}
.page thead{{border-top:2px solid #333;border-bottom:1px solid #333}}
.page th{{font-weight:600;text-align:left;padding:.5rem .6rem}}
.page td{{padding:.4rem .6rem;border-bottom:1px solid #eee;vertical-align:top}}
.page tbody tr:last-child td{{border-bottom:2px solid #333}}
.theorem,.proposition,.definition,.corollary,.lemma,.claim,.design-property{{margin:1.5rem 0;padding:1rem 1.2rem;border-left:4px solid;border-radius:0 4px 4px 0;page-break-inside:avoid}}
.theorem{{background:var(--theorem-bg);border-color:var(--theorem-border)}}
.proposition{{background:var(--prop-bg);border-color:var(--prop-border)}}
.definition{{background:var(--def-bg);border-color:var(--def-border)}}
.corollary{{background:var(--corollary-bg);border-color:var(--corollary-border)}}
.lemma{{background:var(--theorem-bg);border-color:var(--theorem-border)}}
.claim{{background:var(--claim-bg);border-color:var(--claim-border)}}
.design-property{{background:var(--design-property-bg);border-color:var(--design-property-border)}}
.theorem p,.proposition p,.definition p,.corollary p,.lemma p,.claim p,.design-property p{{margin:.4rem 0}}
.proof{{margin:1rem 0 1.5rem;padding:.8rem 1.2rem;border-left:3px solid var(--proof-border);background:var(--proof-bg);font-size:.96rem}}
.proof p{{margin:.4rem 0}}
.page blockquote{{border-left:3px solid #ccc;padding-left:1rem;margin:1rem 0;color:#555;font-style:italic}}
.page code{{font-family:'Fira Code',Consolas,monospace;font-size:.88em;background:#f4f4f4;padding:.15em .35em;border-radius:3px}}
.page pre{{background:#f4f4f4;padding:1rem;border-radius:4px;overflow-x:auto;margin:1rem 0;font-size:.88rem;line-height:1.5}}
.page pre code{{background:none;padding:0}}
.toc{{background:#f8f9fa;border:1px solid #e0e0e0;border-radius:4px;padding:1.2rem 1.5rem;margin:1.5rem 0 2.5rem}}
.toc h2{{font-size:1.1rem;margin:0 0 .8rem;border:none;padding:0}}
.toc ul{{list-style:none;margin:0;padding:0}}
.toc li{{margin:.2rem 0;font-size:.95rem}}
.toc li.toc-sub{{margin-left:1.5rem;font-size:.9rem}}
.katex-display{{margin:1rem 0;overflow-x:auto;overflow-y:hidden}}
@media(max-width:780px){{.page{{padding:1rem;font-size:16px}}.page table{{font-size:.85rem}}.katex-display{{font-size:.9rem}}}}
@media print{{.page{{max-width:none;padding:0}}.toc{{page-break-after:always}}.page h2{{page-break-before:always}}.theorem,.proof,.proposition,.definition,.claim,.design-property{{break-inside:avoid}}}}
</style>
</head>
<body>
<div class="page">
{html_body}
</div>
<script src="/shared/nav.js"></script>
<script>initNav({{ currentPage: 'analysis' }});</script>
</body>
</html>"""

with open(DST, 'w') as f:
    f.write(full_html)

print(f"Built {DST} ({len(full_html):,} bytes, {len(toc_entries)} TOC entries, {len(math_store)} math expressions protected)")
