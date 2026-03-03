#!/usr/bin/env python3
"""Fix ALL numbering in the broken GAME_THEORY_ANALYSIS.md.

The broken restructure cascaded all section numbers ≥5 down to 4.
This script fixes everything using:
1. Title matching for main headers
2. Position within parent section for subsection headers
3. Position-based fixing for Claim/Proposition/Definition definitions
4. Context-based fixing for body references (using HTML as ground truth)
"""
import re

filepath = '/home/zak/Dev/PurgeGame/website/GAME_THEORY_ANALYSIS.md'
with open(filepath, 'r') as f:
    content = f.read()

# ══════════════════════════════════════════════════════════
# STEP 1: Fix main section headers by title
# ══════════════════════════════════════════════════════════
title_map = {
    "Player Types and Strategies": 4,
    "Mechanism Design Properties": 5,
    "Equilibrium Analysis": 6,
    "Dynamic Game and Commitment Devices": 7,
    "BURNIE Economics and the 100-Level Cycle": 8,
    "Robustness and Attack Vectors": 9,
    "Failure Modes and Resilience": 10,
    "Comparisons": 11,
    "Conclusion: The Resilience Thesis": 12,
}
for title, n in title_map.items():
    content = content.replace(f'## 4. {title}', f'## {n}. {title}')

# ══════════════════════════════════════════════════════════
# STEP 2: Build section position map
# ══════════════════════════════════════════════════════════
def build_section_map(text):
    """Return sorted list of (position, section_number) for main sections."""
    smap = []
    for m in re.finditer(r'^## (\d+)\. ', text, re.MULTILINE):
        smap.append((m.start(), int(m.group(1))))
    # Add appendix boundary
    m_app = re.search(r'^## Appendix', text, re.MULTILINE)
    if m_app:
        smap.append((m_app.start(), -1))  # -1 = appendix, don't renumber
    smap.sort()
    return smap

def parent_at(pos, smap):
    """Return parent section number for a character position."""
    result = None
    for sec_pos, sec_num in smap:
        if sec_pos <= pos:
            result = sec_num
        else:
            break
    return result

smap = build_section_map(content)

# ══════════════════════════════════════════════════════════
# STEP 3: Fix subsection headers by position
# ══════════════════════════════════════════════════════════
def fix_sub_headers(text, smap):
    def replacer(m):
        parent = parent_at(m.start(), smap)
        if parent and parent >= 4:
            return f'### {parent}.{m.group(1)}{m.group(2)}'
        return m.group(0)
    return re.sub(r'^### 4\.(\d+)(.*)', replacer, text, flags=re.MULTILINE)

content = fix_sub_headers(content, smap)
# Rebuild smap after header changes
smap = build_section_map(content)

# ══════════════════════════════════════════════════════════
# STEP 4: Fix Claim/Proposition/Definition DEFINITIONS
# These are bold: **Claim 4.X**, **Proposition 4.X**, etc.
# The correct number = parent section number
# ══════════════════════════════════════════════════════════
def fix_definitions(text, smap):
    prefixes = ['Claim', 'Proposition', 'Definition', 'Corollary', 'Design Property']
    for prefix in prefixes:
        # Match bold definitions: **Prefix 4.X**
        pattern = rf'(\*\*{prefix}s? )4\.(\d+)(\*\*)'
        def replacer(m):
            parent = parent_at(m.start(), smap)
            if parent and parent >= 4:
                return f'{m.group(1)}{parent}.{m.group(2)}{m.group(3)}'
            return m.group(0)
        text = re.sub(pattern, replacer, text)
    return text

content = fix_definitions(content, smap)

# ══════════════════════════════════════════════════════════
# STEP 5: Fix body "Section" references using context
# ══════════════════════════════════════════════════════════
# From the original HTML, here is every "Section X" reference
# with unique context and the correct NEW number.
# Format: (context_before, broken_form, correct_form)
# context_before is text that appears JUST BEFORE the broken reference

section_fixes = [
    # Section 2 area
    ("appreciate over time (", "Section 4.1)", "Section 8.1)"),
    ("(characterized in ", "Section 4).", "Section 4)."),  # correct! old 5→4
    ("is examined in ", "Section 4.1, where we provide", "Section 6.1, where we provide"),
    ("commitment devices (", "Section 4) work", "Section 7) work"),
    ("are resisted (", "Section 4.2): existing", "Section 10.2): existing"),
    # Section 3.2 (new Key Parameters)
    ("cycle are analyzed in ", "Section 4.", "Section 8."),  # in new Section 3.2
    # Section 4 area (Player Types)
    ("threshold is trivially met (see ", "Section 2.2)", "Section 2.2)"),  # correct
    ("(see ", "Section 3.1 for the lootbox delivery", "Section 3.1 for the lootbox delivery"),  # correct
    ("cold-start problem (", "Section 4.3, Limitation #5", "Section 12.3, Limitation #5"),
    # Section 6 (Equilibrium)
    ("(as characterized in ", "Section 4). This profile", "Section 4). This profile"),  # correct
    ("BURNIE price ratchet (", "Section 4.1) creates", "Section 8.1) creates"),
    # Section 8 (BURNIE)
    ("level progression (", "Section 3.2), but", "Section 3.2), but"),  # correct
    ("Proposition 4.3 in ", "Section 4):", "Section 10):"),
    ("Proposition 4.3 (", "Section 4). The", "Section 10). The"),
    ("pricing schedule (", "Section 3.2) creates", "Section 3.2) creates"),  # correct
    # Section 9 (Robustness)
    ("whale departure paradox,\" ", "Section 4.3).", "Section 10.3)."),
    # Section 10 (Failure)
    ("burn weight multiplier (", "Section 4.2). A max", "Section 8.2). A max"),
    ("severe bear market (", "Section 4.5), these", "Section 10.5), these"),
    ("payout distribution (", "Section 4.7). The decimator", "Section 10.7). The decimator"),
    ("progression guarantors (", "Section 4.3) may all", "Section 7.3) may all"),
    # Section 11 (Comparisons)
    ("poker analogy, ", "Section 4.6). Traditional", "Section 4.6). Traditional"),  # correct (old 5.6→4.6)
    # Section 12 (Conclusion)
    ("forward progression (", "Section 4). No single", "Section 6). No single"),
    # The resilience thesis line has multiple refs - handle carefully
    ("interlocking economic equilibria (", "Section 4), yield", "Section 6), yield"),
    ("yield-driven pool growth (", "Section 4), commitment", "Section 10), commitment"),
    ("quadratic switching costs (", "Section 4), redundant", "Section 7), redundant"),
    ("progression channels (", "Section 4.3), and", "Section 7.3), and"),
    ("via affiliates (", "Section 4.4). These", "Section 4.4). These"),  # correct (old 5.4→4.4)
    ("where targets are larger (", "Section 4.5)", "Section 10.5)"),
    ("theoretical predictions (", "Section 4.2), but", "Section 10.2), but"),
    ("bear market stress test (", "Section 4.5) is qualitative", "Section 10.5) is qualitative"),
    ("affiliate program (", "Section 4.4) is the intended", "Section 4.4) is the intended"),  # correct
]

for ctx, broken, correct in section_fixes:
    old = ctx + broken
    new = ctx + correct
    if old in content:
        content = content.replace(old, new, 1)  # replace only first occurrence
    else:
        # Try without exact match (might have slight whitespace diffs)
        pass

# ══════════════════════════════════════════════════════════
# STEP 6: Fix Claim/Proposition/etc REFERENCES in body
# ══════════════════════════════════════════════════════════
# These are non-bold references like "Claim 4.1" or "(Proposition 4.3)"
# Use context to identify the correct number

claim_fixes = [
    # Propositions referenced in body text
    ("Proposition 4.3 in Section", "Proposition 4.3", "Proposition 10.3"),  # old 11.3
    ("Proposition 4.3 (Section", "Proposition 4.3", "Proposition 10.3"),  # old 11.3
    ("Propositions 4.1", "Propositions 4.1", "Propositions 7.1"),  # old 8.1-8.2
    # Claims referenced
    ("Claim 4.1 (Death Spiral", "Claim 4.1", "Claim 10.1"),  # old 11.1
    ("Claim 4.3 (Forward", "Claim 4.3", "Claim 7.3"),  # old 8.3
    ("(Claim 4.1)", "Claim 4.1)", "Claim 10.1)"),  # ref to old 11.1
    ("Claim 4.1)", "Claim 4.1)", "Claim 5.1)"),
]

# Actually, the claim references are harder because the context varies.
# Let me take a position-based approach instead:
# For each non-bold "Claim 4.X" in the text, determine its parent section,
# then look up what the original claim number should be.

# Original claims by section:
# Section 5 (new 4): Claim 5.1→4.1, 5.4→4.4, 5.5→4.5, Prop 5.2→4.2, 5.3→4.3, Corollary 5.1→4.1
# Section 6 (new 5): Def 6.1→5.1, Claim 6.1→5.1, Def 6.2→5.2, Claim 6.2→5.2, Prop 6.3→5.3, Def 6.3→5.3, Claim 6.4→5.4, Corollary 6.5→5.5
# Section 7 (new 6): Claim 7.1→6.1, Claim 7.2→6.2
# Section 8 (new 7): Prop 8.1→7.1, Prop 8.2→7.2, Claim 8.3→7.3
# Section 9 (new 8): (none with numbers)
# Section 10 (new 9): Prop 10.1→9.1
# Section 11 (new 10): Def 11.1→10.1, Claim 11.1→10.1, Prop 11.2→10.2, Prop 11.3→10.3, DP 11.4→10.4
# Section 12 (new 11): Claim 12.1→11.1
# Section 13 (new 12): references only, no definitions

# For DEFINITIONS (bold), already fixed by parent section in Step 4.
# For REFERENCES (non-bold), I need to use context.
# Most references point to claims defined in the SAME section or in specific known sections.

# Let me do the remaining non-bold reference fixes by context:

ref_fixes = [
    # In Section 12 (Conclusion) - references to claims from various sections
    ("Claim 4.1 in the conclusion area", None, None),  # need better context

    # Propositions 8.1-8.2 (old) → Propositions 7.1-7.2 (new)
    # In the conclusion this appears as "Propositions 4.1" after cascading
    # The en-dash range: "Propositions 4.1–4.2" should be "Propositions 7.1–7.2"
]

# Let me just handle the remaining non-bold refs with explicit context replacements:
remaining_fixes = [
    # Conclusion section references (Section 12)
    ("(Claim 4.1).\n\n2.", "Claim 4.1", "Claim 5.1"),  # behavioral IC
    ("(Claims 4.1", "Claims 4.1", "Claims 6.1"),  # if this pattern exists
    ("Claim 4.3, Forward", "Claim 4.3", "Claim 7.3"),
    ("(Claim 4.1).\n\n4.", "Claim 4.1", "Claim 10.1"),
    # Propositions in conclusion
    ("(Propositions 4.1", "Propositions 4.1", "Propositions 7.1"),
    # Claim 8.3 → 7.3 references
    ("(Claim 4.3).\n\n5.", "Claim 4.3", "Claim 7.3"),
]

# This piecemeal approach is getting fragile. Let me do one final comprehensive pass.
# Strategy: read the file line by line, and for each line containing "4.X" patterns
# that should be different, fix them based on which section the line is in AND
# what the surrounding text says.

# Build a complete map: for each (parent_section, definition_or_ref, subsec_num) → correct number
# For definitions in a section, the claim number = that section number
# For references, we need to know which claim is being referenced

# PRACTICAL APPROACH: Since I've already fixed definitions (bold) by parent section,
# let me now find ALL remaining "4.X" patterns in Claim/Prop/Def/etc contexts
# and fix them based on what makes sense.

# Actually, the simplest remaining fix:
# In each section N, non-bold references to Claims/Props should use the same
# section-number prefix as the definitions nearby. Cross-section references
# need individual handling.

# Let me just read the current state and do remaining fixes manually with precise context.

# ══════════════════════════════════════════════════════════
# STEP 7: Fix "Sections 10–11" range
# ══════════════════════════════════════════════════════════
content = content.replace('Sections 10\u201311', 'Sections 9\u201310')
content = content.replace('Sections 10-11', 'Sections 9-10')

# ══════════════════════════════════════════════════════════
# STEP 8: Fix Propositions range reference
# ══════════════════════════════════════════════════════════
# "Propositions 4.1–4.2" should be "Propositions 7.1–7.2"
# (originally Propositions 8.1–8.2)
content = content.replace('Propositions 4.1\u20134.2', 'Propositions 7.1\u20137.2')
content = content.replace('Propositions 4.1-4.2', 'Propositions 7.1-7.2')

# ══════════════════════════════════════════════════════════
# Write and report
# ══════════════════════════════════════════════════════════
with open(filepath, 'w') as f:
    f.write(content)

# Verify main section numbering
headers = re.findall(r'^## (\d+)\. ', content, re.MULTILINE)
print(f"Main sections: {headers}")
expected = [str(i) for i in range(1, 13)]
if headers == expected:
    print("Main section numbering: OK (1-12)")
else:
    print(f"WARNING: Expected {expected}, got {headers}")

# Count remaining "4." patterns in claims/props that might need fixing
for prefix in ['Claim', 'Proposition', 'Definition', 'Corollary']:
    non_bold = re.findall(rf'(?<!\*){prefix}s? 4\.\d', content)
    bold = re.findall(rf'\*\*{prefix}s? 4\.\d', content)
    if non_bold:
        print(f"Remaining non-bold '{prefix} 4.X': {len(non_bold)} occurrences")
    if bold:
        print(f"Remaining bold '{prefix} 4.X': {len(bold)} occurrences (should be in Section 4 only)")

# Count remaining "Section 4" refs
sec4_refs = re.findall(r'Section 4(?:\.\d)?', content)
print(f"\nTotal 'Section 4[.X]' references: {len(sec4_refs)}")
print("(Some of these are correct - Section 4 = Player Types)")

print("\nDone. Review the file for any remaining issues.")
