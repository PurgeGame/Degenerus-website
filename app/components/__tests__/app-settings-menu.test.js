import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = readFileSync(new URL('../app-settings-menu.js', import.meta.url), 'utf8');
const settingsCss = readFileSync(new URL('../../styles/settings-menu.css', import.meta.url), 'utf8');
const tray = readFileSync(new URL('../app-reveal-tray.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

describe('top-bar player settings', () => {
  test('one gear menu owns sound, feedback, Auto, reveal speed, and eligible ALL IN', () => {
    for (const marker of [
      'id = BUTTON_ID',
      'data-bind="settings-actions"',
      'data-bind="settings-auto-reveals"',
      'data-bind="settings-reveal-speed"',
      'data-bind="settings-all-in-button"',
    ]) assert.match(settings, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(settings, /mountSoundToggle\(root\)/);
    assert.match(settings, /mountFeedbackButton\(root\)/);
    assert.match(settings, /actions\?\.appendChild\(sound\)/);
    assert.match(settings, /actions\?\.appendChild\(feedback\)/);
    assert.match(settings, /subscribe\('ui\.allInEligible'/,
      'ALL IN preference row follows raw live eligibility');
    assert.match(settings, /allInRow\.hidden = eligible !== true/);
  });

  test('Pending keeps only dismissal actions while preferences are in the gear menu', () => {
    assert.doesNotMatch(tray, /data-bind="rrt-auto-open"|data-bind="rrt-speed"/);
    assert.match(tray, /data-bind="rrt-hide"/);
    assert.match(tray, /data-bind="rrt-clear"/);
    assert.match(settings, /readDegeneretteSpeed\(\)/);
    assert.match(settings, /writeDegeneretteSpeed\(value\)/);
    assert.match(settings, /writeRevealAutoOpenPreference\(auto\.checked\)/);
  });

  test('the menu is keyboard-accessible, responsive, and loaded after the original controls', () => {
    const soundAt = html.indexOf('/app/components/app-sound-toggle.js');
    const feedbackAt = html.indexOf('/app/components/app-feedback-button.js');
    const settingsAt = html.indexOf('/app/components/app-settings-menu.js');
    assert.ok(soundAt >= 0 && feedbackAt > soundAt && settingsAt > feedbackAt);
    assert.match(settings, /aria-haspopup', 'dialog'/);
    assert.match(settings, /event\.key !== 'Escape'/);
    assert.match(settings, /doc\.addEventListener\('pointerdown'/);
    assert.match(settingsCss, /\.nav-settings__panel\s*\{[^}]*position:\s*absolute[^}]*z-index:\s*2500/s);
    assert.match(settingsCss, /@media \(max-width: 640px\)[\s\S]*?\.nav-settings__panel\s*\{[^}]*position:\s*fixed/s);
    assert.match(settingsCss, /input:checked \+ \.nav-settings__switch/);
  });
});
