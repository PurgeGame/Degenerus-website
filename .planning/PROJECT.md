# Degenerus Captcha Landing Page

## What This Is

A fake Google reCAPTCHA-style widget that serves as the front page of degener.us. Shows three cropped wojak characters from the midwit bell curve meme and asks "Select the image that looks most like you." Each character routes to a different part of the site based on self-identified player archetype.

## Core Value

First-touch visitor routing through a memorable, meme-native interaction that self-selects users into the right content for their attention span and sophistication level.

## Requirements

### Validated

- Site has existing pages at /wtf/, /whitepaper/, /theory/ that serve as destinations
- Dark theme design system with gold accents (#f5a623), Inter font
- Vanilla HTML/CSS/JS stack, no build step
- Shared nav component at /shared/nav.js and /shared/nav.css

### Active

- [ ] Front page (index.html) displays a Google reCAPTCHA-style captcha widget
- [ ] Widget contains three clickable character portraits cropped from the midwit bell curve meme
- [ ] Captcha header reads "Select the image that looks most like you" (or similar)
- [ ] Left character (simple happy guy) routes to /wtf/
- [ ] Middle character (crying midwit) routes to /whitepaper/
- [ ] Right character (calm gigabrain) routes to /theory/
- [ ] Visual style mimics Google reCAPTCHA framing (checkbox area, grid, branding parody)
- [ ] Dark theme consistent with rest of site
- [ ] Centered on page, clean, nothing else on the page
- [ ] Character images cropped from the provided meme and saved as separate files

### Out of Scope

- Actual captcha verification or bot detection
- Analytics tracking of which character is selected
- Animation or loading spinners after selection
- Mobile-specific layout (should be responsive but not a separate design)
- Nav bar on this page (it's a clean splash)

## Context

- Current index.html is a meta-refresh redirect to /whitepaper/. This replaces it entirely.
- The midwit meme maps naturally to player archetypes: degens (just ape in), midwits (need the whitepaper to feel safe), gigabrains (want the game theory proof).
- The /wtf/ page was just built as a hook page for degens with interactive demos.
- Site is static HTML hosted, no server-side routing needed.

## Constraints

- **Tech stack**: Vanilla HTML/CSS/JS only, no frameworks, no build step
- **Images**: Must crop three characters from the provided meme image (user will supply or we extract)
- **No nav**: This page has no navigation bar. The captcha IS the navigation.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace index.html entirely | Front page should be memorable, not a redirect | -- Pending |
| No nav bar | Page is a single interaction, nav would distract | -- Pending |
| Google captcha parody | Instantly recognizable framing, funny for crypto audience | -- Pending |
| Route by character selection | Self-selecting funnel puts users in the right content | -- Pending |

---
*Last updated: 2026-03-05 after initialization*
