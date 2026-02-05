# Degenerus Website

Static site shell for the Degenerus Protocol, with the Degenerette simulator mounted at `/degenerette/`.

## Structure

- `index.html` - redirect to the simulator
- `degenerette/index.html` - Degenerette simulator entry
- `degenerette/` - simulator assets copied from the sim build

## Local preview

Use any static server:

```
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Updating the simulator

The simulator is copied from the build output of `/home/zak/Dev/PurgeGame/degenerette-simulator`.
To refresh it:

1. Build the simulator (`npm run build` in the simulator repo).
2. Copy `dist/` contents into this repo:
   - `dist/` -> `degenerette/`

## Scaling + deployment notes

This site is static and can handle thousands of concurrent users when served from a CDN.
Recommended hosts: Cloudflare Pages, Vercel, Netlify, S3 + CloudFront.

If you add server-side or web3 API calls later, prefer serverless functions and cache aggressively.

## Event indexer

The event indexer lives in `event-indexer/`:

- `event-indexer/event_indexer.py`
- `event-indexer/config.example.json`
- `event-indexer/requirements.txt`

Run it from that folder (see the script header for CLI usage).
