// The major-draw gate pauses every poller in the app while a reveal animates.
// A source that never settles used to hold that pause until a full reload.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const gate = await import('../major-draw-activity.js');

test('a source still active past the watchdog is released and observers hear it', () => {
  gate.__resetMajorDrawActivityForTest();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const seen = [];
    gate.subscribeMajorDrawActivity((active) => seen.push(active));
    gate.setMajorDrawActivity('daily-flip', true);
    assert.equal(gate.isMajorDrawActive(), true);
    mock.timers.tick(gate.MAJOR_DRAW_WATCHDOG_MS - 1);
    assert.equal(gate.isMajorDrawActive(), true, 'a long reveal is left alone');
    mock.timers.tick(1);
    assert.equal(gate.isMajorDrawActive(), false, 'the wedged source is released');
    assert.deepEqual(seen, [true, false]);
    assert.equal(gate.isAutomaticPopupBlocked(), true, 'the usual reading window still follows the release');
  } finally {
    mock.timers.reset();
    gate.__resetMajorDrawActivityForTest();
  }
});

test('re-marking a source restarts its watchdog, and settling it disarms the watchdog', () => {
  gate.__resetMajorDrawActivityForTest();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    gate.setMajorDrawActivity('jackpot-replay', true);
    mock.timers.tick(gate.MAJOR_DRAW_WATCHDOG_MS - 1000);
    gate.setMajorDrawActivity('jackpot-replay', true);
    mock.timers.tick(1000);
    assert.equal(gate.isMajorDrawActive(), true, 'the restart bought a fresh window');
    mock.timers.tick(gate.MAJOR_DRAW_WATCHDOG_MS);
    assert.equal(gate.isMajorDrawActive(), false);

    gate.setMajorDrawActivity('daily-flip', true);
    gate.setMajorDrawActivity('daily-flip', false);
    gate.setMajorDrawActivity('jackpot-replay', true);
    mock.timers.tick(gate.MAJOR_DRAW_WATCHDOG_MS - 1);
    assert.equal(gate.isMajorDrawActive(), true, 'the settled source left no timer behind to release the live one');
  } finally {
    mock.timers.reset();
    gate.__resetMajorDrawActivityForTest();
  }
});
