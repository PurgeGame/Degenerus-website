import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const componentUrl = new URL('../app-craps-table.js', import.meta.url);
const source = fs.readFileSync(componentUrl, 'utf8');

test('craps resolution wires one restrained cue to each visible gameplay beat', () => {
  assert.match(source, /if \(step % 2 === 0\) \{\s*sfxCrapsDiceTick\(step, frame\.globalRoll \?\? frame\.ordinal \?\? index\);/s,
    'seven animation steps produce four clacks, not a machine-gun tick on every face');
  assert.match(source, /#lockDicePair\(dicePair\);[\s\S]*?#popDiceLockReadout\(frame, \{ comeOut \}\);[\s\S]*?sfxCrapsDiceLand\(\{\s*total: frame\.total,[\s\S]*?crapsSevenRollOutcome\(frame, \{ comeOut \}\)/s,
    'the total tone and semantic seven treatment share the visual lock beat');
  assert.match(source, /#animateBankrollLoss[\s\S]*?sfxCrapsSettlement\('sweep'\)/s,
    'a whole felt loss gets one sweep');
  assert.match(source, /firstLocalPayoutChip\?\.addEventListener\?\.\('animationend', playLocalClack,[\s\S]*?firstOpponentPayoutChip\?\.addEventListener\?\.\('animationend', playOpponentClack/s,
    'local and opponent payout flights get separate impact cues');
  assert.match(source, /#localPayoutSoundChipCount[\s\S]*?crapsPayoutChipCount\(frame\?\.deltaFlip, this\.#playedFlip\)[\s\S]*?placedWinners \* multiplier/s,
    'the local impact converts the multiplied payout back into physical base-chip weight');
  assert.match(source, /playLocalClack[\s\S]*?sfxCrapsSettlement\('collect', localPayoutChips\);[\s\S]*?playOpponentClack[\s\S]*?sfxCrapsSettlement\('opponent', this\.#featuredPayoutSoundChipCount\(frameIndex\)\);/s,
    'local and opponent impacts each receive their own scaled chip count and timbre');
  assert.match(source, /#placeChip[\s\S]*?this\.#bets\.set\(id, previous \+ 1n\);\s*sfxCrapsBetPlace\(\);/s,
    'each successful manual bet placement gets one physical contact');
  assert.match(source, /#animateBoardReload[\s\S]*?addEventListener\?\.\('animationend', playBetPlace/s,
    'automated board dealing gets the same placement language at impact');
  assert.match(source, /#syncWagerMultiplier[\s\S]*?multiplier > previousMultiplier\) sfxCrapsDouble\(\);/s,
    'an escalator doubling gets the stack-split cue');
  assert.match(source, /#showSurvivalLanding\(survived\);\s*sfxCoinflipLand\(survived\);\s*if \(survived\) sfxCrapsDouble\(\{ at: 0\.14 \}\);/s,
    'a successful survival flip follows its landing with the same doubling language');
  assert.match(source, /#announceShooterBoost[\s\S]*?sfxCrapsBonusShooter\(\);/s,
    'the local bonus-shooter reveal owns a distinct cue');
  assert.match(source, /#startSurvivalFlip[\s\S]*?sfxCoinflipStart\(\);[\s\S]*?#showSurvivalLanding\(survived\);\s*sfxCoinflipLand\(survived\);/s,
    'survival reuses the established coin launch and landing language');
  assert.match(source, /if \(battleWon\) sfxFanfare\(true\);\s*else if \(last\.terminal === 'goal'\) sfxFanfare\(false\);\s*else if \(last\.terminal === 'bust'\) sfxNoWin\(\);/s,
    'completion reserves the large fanfare for an actual battle bounty');
});
