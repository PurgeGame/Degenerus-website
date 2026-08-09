import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const galleryRoot = resolve(here, '..');
const websiteRoot = resolve(galleryRoot, '..');
const html = readFileSync(resolve(galleryRoot, 'index.html'), 'utf8');
const js = readFileSync(resolve(galleryRoot, 'flip-animations.js'), 'utf8');
const css = readFileSync(resolve(galleryRoot, 'flip-animations.css'), 'utf8');
const appCss = readFileSync(resolve(websiteRoot, 'app/styles/app.css'), 'utf8');
const statusCss = readFileSync(resolve(websiteRoot, 'app/styles/status-indicators.css'), 'utf8');

function keyframeBlock(source, name) {
  const marker = `@keyframes ${name}`;
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `missing ${name}`);
  const openingBrace = source.indexOf('{', markerIndex + marker.length);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] !== '}') continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }
  assert.fail(`unterminated ${name}`);
}

function keyframeTimeline(source, name, durationMs) {
  const frames = [];
  const block = keyframeBlock(source, name);
  for (const match of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declaration = match[2].replace(/\s+/g, ' ').trim();
    for (const selector of match[1].split(',')) {
      const token = selector.trim();
      const percent = token === 'from' ? 0 : token === 'to' ? 100 : Number.parseFloat(token);
      assert.ok(Number.isFinite(percent), `invalid selector in ${name}: ${selector}`);
      frames.push({
        ms: Math.round((percent / 100) * durationMs),
        declaration,
      });
    }
  }
  return frames.sort((left, right) => left.ms - right.ms);
}

function assertAnimationPrefix(shortSource, shortName, shortMs, longSource, longName, longMs) {
  const expected = keyframeTimeline(shortSource, shortName, shortMs);
  const actual = keyframeTimeline(longSource, longName, longMs)
    .filter((frame) => frame.ms <= shortMs);
  assert.deepEqual(actual, expected, `${longName} must be ${shortName} plus one appended step`);
}

test('offers every production motion profile in one selector', () => {
  for (const [profile, rate] of [['comet', 60], ['ricochet', 55], ['orbit', 45], ['pulse', 40]]) {
    assert.match(html, new RegExp(`<option value="${profile}">[^<]*${rate}% win</option>`));
    assert.match(js, new RegExp(`df-reveal-track--\\$\\{profile\\}`));
  }
  assert.match(html, /data-bind="pattern"/);
  assert.doesNotMatch(html, /data-bind="ending"/);
});

test('renders all eight production endings side by side with every Reverse-card cue', () => {
  for (const ending of [
    'win', 'loss', 'loss-to-win', 'win-to-loss',
    'double-to-win', 'double-to-loss', 'triple-to-win', 'triple-to-loss',
  ]) {
    assert.match(html, new RegExp(`data-ending="${ending}"`));
  }
  assert.match(css, /grid-template-columns:\s*repeat\(4,/);
  assert.match(js, /df-reveal-ending--\$\{ending\}/);
  assert.match(js, /df-fakeout-reverse-card--to-\$\{target\}/);
  assert.match(js, /Array\.from\(\{ length: reversalCount \}/);
  assert.match(js, /\/shared\/reverse-flip-card\.svg/);
  assert.match(js, /const REVERSE_CARD_ENTRY_WAIT_MS = 100;/);
  assert.match(js, /const REVERSE_CARD_ANIMATION_MS = 600;/);
  assert.match(
    js,
    /TRACK_MS \+ plan\.openingMs \+ REVERSE_CARD_ENTRY_WAIT_MS\s*\+ \(offset \* REVERSE_CARD_STAGGER_MS\)/,
    'the gallery mirrors the production pause before every reversal card',
  );
  assert.deepEqual(
    [...html.matchAll(/data-ending="([^"]+)"/g)].map((match) => match[1]),
    [
      'win', 'win-to-loss', 'double-to-win', 'triple-to-loss',
      'loss', 'loss-to-win', 'double-to-loss', 'triple-to-win',
    ],
    'rows group branches by their mimicked opening face, not final result',
  );
});

test('loads production keyframes instead of maintaining a gallery copy', () => {
  assert.match(html, /href="\/app\/styles\/app\.css"/);
  assert.match(html, /href="\/app\/styles\/status-indicators\.css"/);
  assert.doesNotMatch(css, /@keyframes\s+df-reveal-/);
  assert.match(appCss, /@keyframes df-reveal-track-comet/);
});

test('uses the two production coin faces and synchronized timings', () => {
  assert.match(js, /const TRACK_MS = 3300/);
  assert.match(js, /const BIASED_EXTENSION_MS = 650/);
  assert.match(js, /openingWon === prefersWin \? BIASED_END_MS : SHORT_END_MS/);
  assert.match(js, /df-reveal-bias--\$\{plan\.bias\}/);
  assert.match(js, /coinflip-face-red\.svg/);
  assert.match(js, /coinflip-face-eth\.svg/);
  assert.match(js, /demos\.forEach\(playDemo\)/);
});

test('uses production coinflip audio and commits the verdict at the visual result', () => {
  assert.match(html, /data-bind="sound"/);
  assert.match(css, /\.flip-gallery__sound/);
  assert.match(js, /from '\/app\/app\/jackpot-sfx\.js'/);
  for (const cue of [
    'warmup', 'sfxCoinflipStart', 'sfxCoinflipWhoosh', 'sfxReverseBonk', 'sfxCoinflipLand',
  ]) {
    assert.match(js, new RegExp(`\\b${cue}\\b`));
  }
  assert.match(js, /const METER_SETTLE_MS = 1600;/,
    'gallery thermometer uses the same settle duration as production');
  assert.match(js, /const LOSS_VERDICT_DELAY_MS = 300;/);
  assert.match(
    js,
    /renderMeterFlash\(meterHost\);[\s\S]{0,260}sfxCoinflipLand\(true\)/,
    'the win cue and final thermometer number share one callback',
  );
  assert.match(
    js,
    /sfxCoinflipLand\(false\)[\s\S]{0,100}LOSS_VERDICT_DELAY_MS/,
    'a true loss stays silent for the production post-stop beat',
  );
  assert.match(js, /audibleDemo === demo/,
    'Replay All keeps only the selected branch audible instead of playing eight soundtracks');
  assert.match(js, /function replayDemo\(demo\)[\s\S]{0,180}audibleDemo = demo/,
    'tapping a coin selects and replays that branch with sound');
});

test('shows the production-style modifier meter only for real or apparent wins', () => {
  assert.match(js, /reversalCount % 2 === 0 \? isWinEnding\(ending\) : !isWinEnding\(ending\)/);
  assert.match(js, /completed < reversalCount/);
  assert.match(js, /renderMeter\(meterHost, \{ apparent: true \}\)/);
  assert.match(js, /scheduleDemo\(demo, drain, landingAt - METER_DRAIN_MS\)/);
  assert.match(js, /if \(anotherCardRemains\) \{[\s\S]*?scheduleDemo\(demo, rebound, landingAt\)/);
  assert.match(js, /meterHasRebounded \? terminalDrain : drain/);
  assert.match(js, /anotherCardRemains && !meterVisible/);
  assert.match(statusCss, /@keyframes df-meter-drain-to-min[\s\S]*?bottom:\s*0%/);
  assert.match(
    statusCss,
    /@keyframes df-meter-rebound-from-min[\s\S]*?0%, 6\.086957%[^}]*bottom:\s*0%[\s\S]*?56\.521739%[^}]*\+ 30%[\s\S]*?100%[^}]*var\(--df-meter-stop/,
  );
  assert.match(statusCss, /@keyframes df-meter-recovery-tail[\s\S]*?0%[^}]*\+ 14%[\s\S]*?100%[^}]*var\(--df-meter-stop/);
  assert.match(js, /recoveryTail: reversalCountForEnding\(ending\) >= 2/);
  assert.match(js, /if \(won\) \{\s*renderMeter\(meterHost, \{ recoveryTail:/);
  assert.match(js, /df-modifier-meter--settling/);
  assert.match(js, /df-modifier-flash/);
  assert.match(css, /\.flip-demo__stage \.df-modifier-meter-slot/);
});

test('frame-identity groups match the normal face they mimic before card one', () => {
  assert.match(appCss, /@keyframes df-reveal-end-win[\s\S]*?20%[^}]*2094\.71deg[\s\S]*?97\.142857%[^}]*2336\.51deg[\s\S]*?100%[^}]*2340deg/);
  assert.match(appCss, /@keyframes df-reveal-end-win-to-loss[\s\S]*?8\.75%[^}]*2094\.71deg[\s\S]*?42\.5%[^}]*2336\.51deg[\s\S]*?43\.75%[^}]*2340deg/);
  assert.match(statusCss, /@keyframes df-reveal-end-double-to-win[\s\S]*?5\.6%[^}]*2094\.71deg[\s\S]*?27\.2%[^}]*2336\.51deg[\s\S]*?28%[^}]*2340deg/);
  assert.match(statusCss, /@keyframes df-reveal-end-triple-to-loss[\s\S]*?4\.117647%[^}]*2094\.71deg[\s\S]*?20%[^}]*2336\.51deg[\s\S]*?20\.588235%[^}]*2340deg/);

  assert.match(appCss, /@keyframes df-reveal-end-loss[\s\S]*?20%[^}]*2077\.23deg[\s\S]*?97\.142857%[^}]*2157\.99deg[\s\S]*?100%[^}]*2160deg/);
  assert.match(appCss, /@keyframes df-reveal-end-loss-to-win[\s\S]*?8\.75%[^}]*2077\.23deg[\s\S]*?42\.5%[^}]*2157\.99deg[\s\S]*?43\.75%[^}]*2160deg/);
  assert.match(statusCss, /@keyframes df-reveal-end-double-to-loss[\s\S]*?5\.6%[^}]*2077\.23deg[\s\S]*?27\.2%[^}]*2157\.99deg[\s\S]*?28%[^}]*2160deg/);
  assert.match(statusCss, /@keyframes df-reveal-end-triple-to-win[\s\S]*?4\.117647%[^}]*2077\.23deg[\s\S]*?20%[^}]*2157\.99deg[\s\S]*?20\.588235%[^}]*2160deg/);
  assert.match(js, /scheduleApparentResultStatus\(demo, ending, plan, status\)/);
  assert.doesNotMatch(js, /REVERSE INCOMING/);
});

test('both result paths append reversals without changing any prior keyframe', () => {
  assertAnimationPrefix(appCss, 'df-reveal-end-win', 700,
    appCss, 'df-reveal-end-win-to-loss', 1600);
  assertAnimationPrefix(appCss, 'df-reveal-end-win-to-loss', 1600,
    statusCss, 'df-reveal-end-double-to-win', 2500);
  assertAnimationPrefix(statusCss, 'df-reveal-end-double-to-win', 2500,
    statusCss, 'df-reveal-end-triple-to-loss', 3400);

  assertAnimationPrefix(appCss, 'df-reveal-end-loss', 700,
    appCss, 'df-reveal-end-loss-to-win', 1600);
  assertAnimationPrefix(appCss, 'df-reveal-end-loss-to-win', 1600,
    statusCss, 'df-reveal-end-double-to-loss', 2500);
  assertAnimationPrefix(statusCss, 'df-reveal-end-double-to-loss', 2500,
    statusCss, 'df-reveal-end-triple-to-win', 3400);
});

test('profile-favored normals pass through the opposite result frame without stopping', () => {
  assertAnimationPrefix(appCss, 'df-reveal-end-loss', 700,
    statusCss, 'df-reveal-end-long-win', 1350);
  assertAnimationPrefix(appCss, 'df-reveal-end-win', 700,
    statusCss, 'df-reveal-end-long-loss', 1350);
  assert.match(appCss, /--df-ending-easing:\s*linear/,
    'the shared result frame retains velocity unless the animation ends there');
  assert.match(statusCss, /@keyframes df-reveal-end-long-win[\s\S]*?51\.851852%[^}]*2160deg[\s\S]*?56\.296296%[^}]*2168\.97deg[\s\S]*?98\.518519%[^}]*2339\.56deg[\s\S]*?100%[^}]*2340deg/);
  assert.match(statusCss, /@keyframes df-reveal-end-long-loss[\s\S]*?51\.851852%[^}]*2340deg[\s\S]*?56\.296296%[^}]*2351\.44deg[\s\S]*?98\.518519%[^}]*2519\.59deg[\s\S]*?100%[^}]*2520deg/);
  const continuedWin = keyframeTimeline(statusCss, 'df-reveal-end-long-win', 1350)
    .filter((frame) => frame.ms > 700);
  const continuedLoss = keyframeTimeline(statusCss, 'df-reveal-end-long-loss', 1350)
    .filter((frame) => frame.ms > 700);
  assert.ok(continuedWin.length >= 8 && continuedLoss.length >= 8,
    'each face change uses enough continuation frames to read as one smooth pass');
});

test('every normal and Reverse-card ending keeps rotating forward through settlement', () => {
  const animations = [
    [appCss, 'df-reveal-end-win', 700],
    [appCss, 'df-reveal-end-loss', 700],
    [appCss, 'df-reveal-end-win-to-loss', 1600],
    [appCss, 'df-reveal-end-loss-to-win', 1600],
    [statusCss, 'df-reveal-end-double-to-win', 2500],
    [statusCss, 'df-reveal-end-double-to-loss', 2500],
    [statusCss, 'df-reveal-end-triple-to-win', 3400],
    [statusCss, 'df-reveal-end-triple-to-loss', 3400],
    [statusCss, 'df-reveal-end-long-win', 1350],
    [statusCss, 'df-reveal-end-long-loss', 1350],
    [statusCss, 'df-reveal-end-long-win-to-loss', 2250],
    [statusCss, 'df-reveal-end-long-loss-to-win', 2250],
    [statusCss, 'df-reveal-end-long-double-to-win', 3150],
    [statusCss, 'df-reveal-end-long-double-to-loss', 3150],
    [statusCss, 'df-reveal-end-long-triple-to-win', 4050],
    [statusCss, 'df-reveal-end-long-triple-to-loss', 4050],
  ];

  for (const [source, name, duration] of animations) {
    const rotations = keyframeTimeline(source, name, duration).map((frame) => {
      const match = frame.declaration.match(/rotateX\((-?[\d.]+)deg\)/);
      assert.ok(match, `${name} frame at ${frame.ms}ms needs a rotation`);
      return Number.parseFloat(match[1]);
    });
    for (let index = 1; index < rotations.length; index += 1) {
      assert.ok(rotations[index] >= rotations[index - 1],
        `${name} reverses from ${rotations[index - 1]}deg to ${rotations[index]}deg`);
    }
  }
});

test('both profile-biased paths remain additive through three reversals', () => {
  assertAnimationPrefix(statusCss, 'df-reveal-end-long-win', 1350,
    statusCss, 'df-reveal-end-long-win-to-loss', 2250);
  assertAnimationPrefix(statusCss, 'df-reveal-end-long-win-to-loss', 2250,
    statusCss, 'df-reveal-end-long-double-to-win', 3150);
  assertAnimationPrefix(statusCss, 'df-reveal-end-long-double-to-win', 3150,
    statusCss, 'df-reveal-end-long-triple-to-loss', 4050);

  assertAnimationPrefix(statusCss, 'df-reveal-end-long-loss', 1350,
    statusCss, 'df-reveal-end-long-loss-to-win', 2250);
  assertAnimationPrefix(statusCss, 'df-reveal-end-long-loss-to-win', 2250,
    statusCss, 'df-reveal-end-long-double-to-loss', 3150);
  assertAnimationPrefix(statusCss, 'df-reveal-end-long-double-to-loss', 3150,
    statusCss, 'df-reveal-end-long-triple-to-win', 4050);
});

test('the 3x thermometer continues the exact 2x recovery before its terminal sweep', () => {
  const continuingRecovery = keyframeTimeline(
    statusCss,
    'df-meter-rebound-from-min',
    1150,
  ).filter((frame) => frame.ms >= 900).map((frame) => ({
    ...frame,
    ms: frame.ms - 900,
  }));
  const completedRecovery = keyframeTimeline(statusCss, 'df-meter-recovery-tail', 250);
  assert.deepEqual(continuingRecovery, completedRecovery,
    '2x completion and 3x continuation must share every recovery-tail frame');

  const recoveryEnd = continuingRecovery.at(-1).declaration;
  const terminalStart = keyframeTimeline(statusCss, 'df-meter-terminal-drain', 650)[0].declaration;
  assert.equal(terminalStart, recoveryEnd,
    'the 3x loss must descend immediately from the exact recovery endpoint');
});
