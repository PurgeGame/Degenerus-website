// /app/app/share-win.js — "SHARE MY WIN" card builder + share flow.
//
// Consumed by reveal-overlay.js on the summary stage. Given a normalized
// reveal sequence, extracts the winnings lines, paints a 1080×1350 share
// card on an offscreen canvas (dark felt, gold amounts, QR code carrying the
// sharer's affiliate link), and hands the PNG to the Web Share API — with a
// download fallback for desktop browsers that can't share files.
//
// Affiliate link: a registered vanity code when the player has one (bytes32
// ?ref= form — it can carry a kickback %, strictly better for the referred
// player), else the bare-address ?ref= form (`https://degener.us/?ref=0x…`)
// that /js/ref.js captures site-wide and DegenerusAffiliate resolves as an
// address-derived default code — commissions flow with zero registration.
// No connected wallet → plain degener.us link (still a share, just no ref).
//
// Registered-code lookup lives in affiliate.js resolveRegisteredCode
// (DB-first via the indexer's owner-keyed affiliate_codes table, then the
// chain-verified localStorage fallback). Any doubt falls back to the bare
// address, which always pays the sharer.
//
// QR: lean-qr via the import-map CDN (same dynamic-import pattern as
// canvas-confetti). If the import fails the card renders without a QR —
// the ref URL is always printed as text, so the link survives regardless.

import { get } from './store.js';
import { displayEth, displayToken } from './scaling.js';
import { ethers } from './contracts.js';
import { resolveRegisteredCode } from './affiliate.js';

const SITE_ORIGIN = 'https://degener.us';
const MAX_UINT160 = (1n << 160n) - 1n;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/**
 * Shareable referral URL. With a verified registered code, the bytes32 ?ref=
 * form (ref.js accepts it; the code's kickback % rides along). Otherwise the
 * bare-address form — the shortest string ref.js accepts (smaller QR).
 * Falsy/malformed address → plain origin.
 */
export function buildShareRefUrl(addr, registeredCode = null) {
  if (typeof registeredCode === 'string' && /^0x[0-9a-fA-F]{64}$/.test(registeredCode)) {
    return `${SITE_ORIGIN}/?ref=${registeredCode.toLowerCase()}`;
  }
  if (typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr)) {
    return `${SITE_ORIGIN}/?ref=${addr.toLowerCase()}`;
  }
  return `${SITE_ORIGIN}/`;
}

/**
 * Winnings lines for a normalized sequence → [{amount, unit}] display strings.
 * Empty array = nothing share-worthy (packs are purchases, NO HIT is a miss,
 * lootbox contents are what you bought — only spin payouts count as wins).
 */
export function extractWinLines(seq) {
  if (!seq || !Array.isArray(seq.cards)) return [];
  const lines = [];
  if (seq.kind === 'jackpot') {
    for (const c of seq.cards) {
      if (c.type === 'eth') lines.push({ amount: c.value, unit: 'ETH' });
      else if (c.type === 'flip') lines.push({ amount: c.value, unit: 'FLIP' });
      else if (c.type === 'tickets') lines.push({ amount: c.value, unit: c.label || 'TICKETS' });
    }
    return lines;
  }
  if (seq.kind === 'degenerette') {
    // A bet total is a win the player played for — the board's own payout line.
    const board = seq.spinBoard;
    if (!board) return lines;
    let total = 0n;
    try { total = BigInt(board.total ?? 0); } catch (_e) { return lines; }
    if (total <= 0n) return lines;
    lines.push({
      amount: board.currency === 0 ? displayEth(total) : displayToken(total),
      unit: board.unit || 'FLIP',
    });
    return lines;
  }
  if (seq.kind === 'lootbox') {
    let eth = 0n; let flip = 0n; let wwxrp = 0n;
    for (const c of seq.cards) {
      const s = c.spin;
      if (!s) continue;
      let payout = 0n;
      try { payout = BigInt(s.payout ?? 0); } catch (_e) { continue; }
      if (payout <= 0n) continue;
      if (s.spinType === 'eth') {
        try { eth += BigInt(s.ethShare ?? 0); } catch (_e) { /* skip */ }
      } else if (s.spinType === 'wwxrp') {
        wwxrp += payout;
      } else {
        flip += payout;
      }
    }
    if (eth > 0n) lines.push({ amount: displayEth(eth), unit: 'ETH' });
    if (flip > 0n) lines.push({ amount: displayToken(flip), unit: 'FLIP' });
    if (wwxrp > 0n) lines.push({ amount: displayToken(wwxrp), unit: 'WWXRP' });
    return lines;
  }
  return lines;
}

/** True when the summary should offer a share button for this sequence. */
export function canShareWin(seq) {
  if (get('ui.mode') === 'view') return false; // not YOUR win
  return extractWinLines(seq).length > 0;
}

// ---------------------------------------------------------------------------
// QR (lean-qr, CDN dynamic import — never blocks the card)
// ---------------------------------------------------------------------------

async function _qrFor(text) {
  try {
    const { generate } = await import('lean-qr');
    return generate(text);
  } catch (_e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Canvas card
// ---------------------------------------------------------------------------

const CARD_W = 1080;
const CARD_H = 1350;

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// QR modules drawn by hand (code.size / code.get(x,y) — lean-qr Bitmap2D)
// for exact placement + a spec-proper 4-module quiet zone on white.
function _drawQr(ctx, code, x, y, size) {
  const quiet = 4;
  const n = code.size + quiet * 2;
  const cell = size / n;
  ctx.fillStyle = '#ffffff';
  _roundRect(ctx, x, y, size, size, 20);
  ctx.fill();
  ctx.fillStyle = '#10142a';
  for (let my = 0; my < code.size; my++) {
    for (let mx = 0; mx < code.size; mx++) {
      if (!code.get(mx, my)) continue;
      ctx.fillRect(
        x + (mx + quiet) * cell,
        y + (my + quiet) * cell,
        Math.ceil(cell), Math.ceil(cell),
      );
    }
  }
}

/**
 * Paint the share card. Returns the canvas, or null when canvas 2D is
 * unavailable (fakeDOM / very old browsers).
 */
export function renderShareCard({ title, lines, refUrl, qr }) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  if (typeof canvas.getContext !== 'function') return null;
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Backdrop — the overlay's dark felt with a soft gold bloom.
  const bg = ctx.createLinearGradient(0, 0, 0, CARD_H);
  bg.addColorStop(0, '#131a2e');
  bg.addColorStop(1, '#0a0d1a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const bloom = ctx.createRadialGradient(CARD_W / 2, 430, 60, CARD_W / 2, 430, 640);
  bloom.addColorStop(0, 'rgba(245, 166, 35, 0.22)');
  bloom.addColorStop(1, 'rgba(245, 166, 35, 0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Confetti dots (deterministic LCG so identical wins render identical cards).
  let s = 1337;
  const rnd = () => { s = (s * 48271) % 2147483647; return s / 2147483647; };
  const dotColors = ['#f5a623', '#ffc04d', '#ffffff', '#22c55e'];
  for (let i = 0; i < 70; i++) {
    ctx.globalAlpha = 0.25 + rnd() * 0.5;
    ctx.fillStyle = dotColors[Math.floor(rnd() * dotColors.length)];
    const dx = rnd() * CARD_W;
    const dy = rnd() * CARD_H * 0.62;
    ctx.beginPath();
    ctx.arc(dx, dy, 3 + rnd() * 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Gold frame.
  ctx.strokeStyle = 'rgba(245, 166, 35, 0.55)';
  ctx.lineWidth = 6;
  _roundRect(ctx, 24, 24, CARD_W - 48, CARD_H - 48, 32);
  ctx.stroke();

  const fontStack = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';

  // Brand.
  ctx.fillStyle = '#f5a623';
  ctx.font = `800 44px ${fontStack}`;
  ctx.fillText('D E G E N E R U S', CARD_W / 2, 130);

  // Title (e.g. "DAY 15 — YOU WON").
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 64px ${fontStack}`;
  ctx.fillText(String(title || 'YOU WON').toUpperCase(), CARD_W / 2, 260);

  // Winnings lines — amount huge gold, unit smaller beneath.
  const shown = lines.slice(0, 3);
  const blockH = shown.length > 2 ? 200 : 250;
  let y = 430;
  for (const line of shown) {
    ctx.fillStyle = '#ffc04d';
    ctx.shadowColor = 'rgba(245, 166, 35, 0.6)';
    ctx.shadowBlur = 40;
    ctx.font = `900 ${shown.length > 2 ? 110 : 140}px ${fontStack}`;
    ctx.fillText(line.amount, CARD_W / 2, y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#e8e8f2';
    ctx.font = `800 52px ${fontStack}`;
    ctx.fillText(line.unit, CARD_W / 2, y + 70);
    y += blockH;
  }
  if (lines.length > shown.length) {
    ctx.fillStyle = '#9a9ab8';
    ctx.font = `700 40px ${fontStack}`;
    ctx.fillText(`+ ${lines.length - shown.length} more`, CARD_W / 2, y - 40);
  }

  // Footer — QR left with caption, pitch right; shortened URL along the
  // bottom (the QR carries the full link; the text is a human-readable hint).
  const footY = 980;
  if (qr) {
    const qrSize = 240;
    const qrX = 110;
    _drawQr(ctx, qr, qrX, footY, qrSize);
    ctx.fillStyle = '#f5a623';
    ctx.font = `800 34px ${fontStack}`;
    ctx.fillText('SCAN TO PLAY', qrX + qrSize / 2, footY + qrSize + 46);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8e8f2';
    ctx.font = `800 46px ${fontStack}`;
    ctx.fillText('Daily on-chain jackpots.', 410, footY + 92);
    ctx.fillText('Zero rake.', 410, footY + 158);
    ctx.textAlign = 'center';
  } else {
    ctx.fillStyle = '#e8e8f2';
    ctx.font = `800 46px ${fontStack}`;
    ctx.fillText('Daily on-chain jackpots. Zero rake.', CARD_W / 2, footY + 110);
  }
  ctx.fillStyle = '#9a9ab8';
  ctx.font = `600 34px ${fontStack}`;
  ctx.fillText(displayShareUrl(refUrl), CARD_W / 2, CARD_H - 44);

  return canvas;
}

/**
 * Human-readable form of the ref URL for the card: scheme stripped, hex refs
 * middle-truncated (0x7fc329…00e7a); a bytes32 vanity code decodes back to
 * its string ("degener.us · code SHARK"). Full URL stays in the QR and the
 * share text.
 */
export function displayShareUrl(refUrl) {
  let s = String(refUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const m64 = s.match(/0x[0-9a-fA-F]{64}/);
  if (m64) {
    const hex = m64[0];
    try {
      if (BigInt(hex) > MAX_UINT160) {
        const txt = ethers.decodeBytes32String(hex);
        if (/^[A-Za-z0-9]{3,31}$/.test(txt)) return `${s.split('/')[0]} · code ${txt}`;
      }
    } catch (_e) { /* fall through to truncation */ }
    return s.replace(hex, `${hex.slice(0, 8)}…${hex.slice(-5)}`);
  }
  s = s.replace(/(0x[0-9a-fA-F]{40})/, (hex) => `${hex.slice(0, 8)}…${hex.slice(-5)}`);
  return s;
}

// ---------------------------------------------------------------------------
// Share flow
// ---------------------------------------------------------------------------

function _toBlob(canvas) {
  return new Promise((resolve) => {
    try {
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob((b) => resolve(b), 'image/png');
        return;
      }
      // toBlob-less fallback (old Safari): dataURL → Blob.
      const dataUrl = canvas.toDataURL('image/png');
      const bin = atob(dataUrl.split(',')[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      resolve(new Blob([bytes], { type: 'image/png' }));
    } catch (_e) {
      resolve(null);
    }
  });
}

function _download(blob) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'degenerus-win.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_e) { /* defensive */ } }, 10_000);
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Build the card for a normalized sequence and share it.
 * Returns: 'shared' | 'downloaded' | 'cancelled' | 'nothing' | 'failed'.
 */
export async function shareWin(seq) {
  const lines = extractWinLines(seq);
  if (lines.length === 0) return 'nothing';
  const addr = get('connected.address');
  const registeredCode = await resolveRegisteredCode(addr);
  const refUrl = buildShareRefUrl(addr, registeredCode);
  const qr = await _qrFor(refUrl);
  const canvas = renderShareCard({ title: seq.title, lines, refUrl, qr });
  if (!canvas) return 'failed';
  const blob = await _toBlob(canvas);
  if (!blob) return 'failed';

  const text = `I just won ${lines.map((l) => `${l.amount} ${l.unit}`).join(' + ')} on Degenerus. ${refUrl}`;
  try {
    const file = new File([blob], 'degenerus-win.png', { type: 'image/png' });
    if (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'
        && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
    // fall through to download
  }
  // Desktop fallback: save the PNG + put the ref link on the clipboard.
  const ok = _download(blob);
  if (ok) {
    try { await navigator.clipboard.writeText(text); } catch (_e) { /* optional */ }
    return 'downloaded';
  }
  return 'failed';
}
