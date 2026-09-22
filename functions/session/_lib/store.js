// D1 access for the session service — the port of degenerette-api's storage.js.
//
// D1 is SQLite, so every statement here is the original statement. What changed is only the
// driver: better-sqlite3's synchronous `.get()/.all()/.run()` become awaited D1 calls.

/** ⛔ Must match the old generator exactly: 8 chars, base36, uppercase. Codes are user-visible. */
function generateReferralCode() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

const PLAYER_FIELDS = ['id', 'eth_address', 'discord_id', 'discord_name', 'discord_avatar',
  'balance_wwxrp', 'activity_score_bps', 'referral_code', 'referrer_code',
  'affiliate_rakeback_bps', 'referral_locked', 'nonce'];

function serializePlayer(row) {
  if (!row) return null;
  return Object.fromEntries(PLAYER_FIELDS.map((field) => [field, row[field]]));
}

/** Strips `nonce` — the one field that must never reach a client. */
export function sanitizePlayer(row) {
  if (!row) return null;
  const { nonce, ...safe } = row;
  return safe;
}

export async function getPlayerByAddress(db, address) {
  const row = await db.prepare('SELECT * FROM players WHERE eth_address = ?').bind(address).first();
  return serializePlayer(row);
}

export async function getPlayerByDiscordId(db, discordId) {
  const row = await db.prepare(
    `SELECT * FROM players
       WHERE discord_id = ? AND eth_address IS NOT NULL AND eth_address != ''
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
  ).bind(String(discordId)).first();
  return serializePlayer(row);
}

export async function getOrCreatePlayer(db, address) {
  const existing = await getPlayerByAddress(db, address);
  if (existing) return existing;
  // The retry loop is the original's: referral_code is UNIQUE and the code is random, so a
  // collision is a retry rather than an error.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await db.prepare('INSERT INTO players (eth_address, referral_code) VALUES (?, ?)')
        .bind(address, generateReferralCode()).run();
      break;
    } catch (error) {
      if (attempt === 19) throw new Error('Failed to generate unique referral code');
    }
  }
  return getPlayerByAddress(db, address);
}

export async function setPlayerNonce(db, address, nonce) {
  await db.prepare("UPDATE players SET nonce = ?, updated_at = datetime('now') WHERE eth_address = ?")
    .bind(nonce, address).run();
}

export async function clearPlayerNonce(db, address) {
  await db.prepare("UPDATE players SET nonce = NULL, updated_at = datetime('now') WHERE eth_address = ?")
    .bind(address).run();
}

export async function updatePlayerDiscord(db, address, user) {
  await db.prepare(
    `UPDATE players
        SET discord_id = ?, discord_name = ?, discord_avatar = ?, updated_at = datetime('now')
      WHERE eth_address = ?`,
  ).bind(String(user.id), String(user.username ?? ''), String(user.avatarUrl ?? ''), address).run();
}

/**
 * ⛔ `referral_locked` is why this is not a plain UPDATE: a referrer is set ONCE. The original
 * refused to move a locked referrer and refused self-referral; both are preserved.
 */
export async function setReferrerCode(db, address, referrerCode) {
  const player = await getPlayerByAddress(db, address);
  if (!player || player.referral_locked) return;
  const code = String(referrerCode || '').trim().toUpperCase();
  if (!code || code === String(player.referral_code || '').toUpperCase()) return;
  const referrer = await db.prepare('SELECT eth_address FROM players WHERE referral_code = ?').bind(code).first();
  if (!referrer || referrer.eth_address === address) return;
  await db.prepare(
    "UPDATE players SET referrer_code = ?, referral_locked = 1, updated_at = datetime('now') WHERE eth_address = ?",
  ).bind(code, address).run();
}

export async function getProfilesByAddresses(db, addresses) {
  const list = [...new Set((Array.isArray(addresses) ? addresses : [])
    .map((address) => String(address || '').toLowerCase())
    .filter(Boolean))];
  if (list.length === 0) return [];
  // D1 caps bound parameters per statement; chunk rather than build one enormous IN list.
  const out = [];
  for (let i = 0; i < list.length; i += 80) {
    const chunk = list.slice(i, i + 80);
    const rows = await db.prepare(
      `SELECT eth_address, discord_name, discord_avatar
         FROM players
        WHERE LOWER(eth_address) IN (${chunk.map(() => '?').join(',')})
          AND discord_id IS NOT NULL AND discord_id != ''`,
    ).bind(...chunk).all();
    for (const row of rows.results ?? []) {
      out.push({ address: row.eth_address, discord_name: row.discord_name, discord_avatar: row.discord_avatar });
    }
  }
  return out;
}
