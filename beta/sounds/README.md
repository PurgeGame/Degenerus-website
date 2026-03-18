# Sound Effects (Placeholders Needed)

Replace these files with real audio:

| File | Description | Duration |
|------|-------------|----------|
| `win.mp3` | Bright reward chime for jackpot/coinflip/degenerette wins | Under 2s |
| `flip.mp3` | Quick mechanical click for coinflip resolution | Under 1s |
| `urgency.mp3` | Warning alarm tone for death timer stage transitions | Under 2s |

The `audio.js` module silently fails on missing files via `.play().catch(() => {})`.
