// Learn-page Degenerette demo. Plays canned results through the app's own reveal
// overlay (the same modules /app/degenerette-demo.js drives). No wallet, no RPC.
import { queueReveal, REVEAL_OVERLAY_IDLE_EVENT } from '/app/components/reveal-queue.js';
import '/app/components/reveal-overlay.js';
import { dgnScore, dgnWilds } from '/app/app/dgn-reels.js';
import { degeneretteSpinPayout } from '/app/app/degenerette.js';
import { ETH_DIVISOR } from '/app/app/chain-config.js';
import { SFX_MUTE_KEY, isMuted, setMuted, warmup } from '/app/app/jackpot-sfx.js';
import { initButtonFeedback } from '/app/app/button-feedback.js';

initButtonFeedback();

// The app's mute flag lives in localStorage on this origin. Keep the demo muted by
// default and in memory only, so it never reads or overwrites the player's app setting.
let demoMuted = true;
const storageGet = Storage.prototype.getItem;
const storageSet = Storage.prototype.setItem;
const storageRemove = Storage.prototype.removeItem;
Storage.prototype.getItem = function (key) {
  return key === SFX_MUTE_KEY ? (demoMuted ? '1' : null) : storageGet.call(this, key);
};
Storage.prototype.setItem = function (key, value) {
  if (key === SFX_MUTE_KEY) { demoMuted = String(value) === '1'; return; }
  storageSet.call(this, key, value);
};
Storage.prototype.removeItem = function (key) {
  if (key === SFX_MUTE_KEY) { demoMuted = false; return; }
  storageRemove.call(this, key);
};

// A lane is [symbol 0-7, color 0-7, wild?]. A wild lane is 0x40 | symbol.
const pack = lanes => lanes.reduce(
  (word, [sym, col, wild], q) => word | ((wild ? 0x40 | sym : col * 8 + sym) << (q * 8)), 0) >>> 0;

// The player's card: quadrant 0 is the hero lane, always wild.
const player = pack([[6, 0, true], [2, 4], [5, 2], [3, 1]]);

const STAKE = 10n ** 16n / ETH_DIVISOR; // 0.01 ETH per spin
const samples = [
  {
    name: 'a small hit',
    house: pack([[6, 7], [1, 4], [5, 0], [4, 3]]),
  },
  {
    name: 'a miss',
    house: pack([[5, 3], [1, 2], [4, 5], [2, 4]]),
  },
  {
    name: 'a big hit with a wild',
    house: pack([[6, 7], [2, 4], [5, 0, true], [3, 0]]),
  },
];

for (const sample of samples) {
  const score = dgnScore(player, sample.house);
  const wilds = dgnWilds(sample.house);
  sample.score = score;
  sample.wilds = wilds;
  sample.payout = degeneretteSpinPayout({ currency: 0, amountPerSpin: STAKE, score, wilds });
}

const spinBtn = document.getElementById('spin');
const soundBtn = document.getElementById('sound');
const resultEl = document.getElementById('result');
let next = 0;
let last = -1;
let playing = false;

function multiplier(sample) {
  if (sample.payout <= 0n) return 'Paid nothing.';
  const hundredths = (sample.payout * 100n) / STAKE;
  const whole = hundredths / 100n;
  const cents = String(hundredths % 100n).padStart(2, '0');
  return `Paid ${whole.toLocaleString('en-US')}.${cents}x the stake.`;
}

function describe() {
  if (last < 0) return `${samples.length} sample results, played in turn.`;
  if (playing) return `Playing sample ${last + 1} of ${samples.length}.`;
  const sample = samples[last];
  const wild = sample.wilds > 0 ? ` ${sample.wilds} wild on the house card.` : '';
  return `Sample ${last + 1} of ${samples.length}: ${sample.name}. Score ${sample.score} of 9.${wild} ${multiplier(sample)}`;
}

function render() {
  spinBtn.textContent = last < 0 ? 'Play a card' : 'Play another card';
  spinBtn.disabled = playing;
  resultEl.textContent = describe();
  const muted = isMuted();
  soundBtn.textContent = muted ? 'Sound off' : 'Sound on';
  soundBtn.setAttribute('aria-pressed', muted ? 'false' : 'true');
}

spinBtn.addEventListener('click', () => {
  if (playing) return;
  const index = next;
  const sample = samples[index];
  playing = true;
  last = index;
  next = (index + 1) % samples.length;
  warmup();
  queueReveal({
    kind: 'degenerette', currency: 0, heroIdx: 0, amountPerSpin: STAKE,
    totalPayout: sample.payout,
    spins: [{
      spinIndex: 0, playerTraits: player, houseTraits: sample.house,
      score: sample.score, payout: sample.payout,
    }],
  });
  render();
});

soundBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  render();
});

document.addEventListener(REVEAL_OVERLAY_IDLE_EVENT, () => {
  playing = false;
  render();
});

render();
