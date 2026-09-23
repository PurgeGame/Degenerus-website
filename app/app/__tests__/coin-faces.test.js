import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync, readdirSync } from 'node:fs';
import {
  appendCoinFaces,
  coinSideFromTransform,
} from '../coin-faces.js';

describe('coin pose side (coinSideFromTransform)', () => {
  test('uses the transformed plane normal to select red or ETH', () => {
    assert.equal(coinSideFromTransform(
      'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)',
    ), 'red');
    assert.equal(coinSideFromTransform(
      'matrix3d(1,0,0,0,0,-0.5,0.866,0,0,-0.866,-0.5,0,0,-34,0,1)',
    ), 'eth');
  });

  test('holds the prior artwork at the exact edge instead of flickering', () => {
    const edge = 'matrix3d(1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1)';
    assert.equal(coinSideFromTransform(edge, 'red'), 'red');
    assert.equal(coinSideFromTransform(edge, 'eth'), 'eth');
  });

  test('supports authored rotateX values in lightweight DOMs', () => {
    assert.equal(coinSideFromTransform('rotateX(0deg)'), 'red');
    assert.equal(coinSideFromTransform('rotateX(180deg)'), 'eth');
    assert.equal(coinSideFromTransform('rotateX(540deg)'), 'eth');
    assert.equal(coinSideFromTransform('none', 'eth'), 'red');
  });

  test('handles Chromium-flattened matrix() poses without showing the front backwards', () => {
    assert.equal(coinSideFromTransform('matrix(1, 0, 0, 1, 0, 0)'), 'red');
    assert.equal(coinSideFromTransform('matrix(1, 0, 0, -1, 0, 0)'), 'eth');
    assert.equal(
      coinSideFromTransform('matrix(0.866, 0.5, 0.5, -0.866, 4, -8)'),
      'eth',
      'the determinant retains back-face orientation through a rotateZ lean',
    );
    assert.equal(coinSideFromTransform('matrix(1, 0, 0, 0, 0, 0)', 'eth'), 'eth');
  });
});

describe('two culled faces, no per-frame work', () => {
  test('mounts both faces, visible to the compositor, and schedules nothing', () => {
    const previous = { document: globalThis.document, requestAnimationFrame: globalThis.requestAnimationFrame };
    const node = (tag) => ({ tagName: tag.toUpperCase(), children: [], attributes: {}, className: '', hidden: false,
      appendChild(child) { this.children.push(child); return child; }, setAttribute(k, v) { this.attributes[k] = v; } });
    let frames = 0;
    globalThis.document = { createElement: node };
    globalThis.requestAnimationFrame = () => { frames += 1; return 0; };
    try {
      const rotor = node('span');
      const faces = appendCoinFaces(rotor, { frontSrc: '/red.svg', backSrc: '/eth.svg' });
      const surface = rotor.children[0];
      assert.equal(surface.className, 'df-coin3d__surface');
      assert.deepEqual(surface.children.map((face) => face.attributes['data-coin-face']), ['red', 'eth']);
      assert.ok(surface.children.every((face) => !face.hidden), 'which face is seen is the pose, never a DOM toggle');
      assert.equal(faces.frontImage.src, '/red.svg'); assert.equal(faces.backImage.src, '/eth.svg');
      assert.equal(frames, 0, 'no animation-frame loop: the compositor owns motion and face together');
    } finally {
      globalThis.document = previous.document; globalThis.requestAnimationFrame = previous.requestAnimationFrame;
    }
  });

  // ⛔ The regression guard. A flattening property on the rotor, the surface or a face collapses
  // the coin's 3D context; culling stops and the red face's reverse (the upside-down WWXRP) shows
  // on every back-facing half-turn. Measured, not theorised: db/coin-face-stress.mjs variants v6
  // (isolation + contain on the surface) and v7 (filter on the rotor) fail on every back-facing
  // frame. Effects belong on the rotor's parent.
  test('no stylesheet flattens a coin rotor, surface or face, statically or by animation', () => {
    const dir = new URL(process.env.COIN_CSS_DIR ? `file://${process.env.COIN_CSS_DIR}/` : '../../styles/', import.meta.url);
    const css = readdirSync(dir).filter((f) => f.endsWith('.css') && !f.includes('.min.'))
      .map((f) => [f, readFileSync(new URL(f, dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')]);
    const COIN = /\.(?:df-coin3d__inner|df-coin3d__surface|df-coin3d__face(?:--(?:red|eth))?|rvl-box-currency-coin|baf-res__coin-rotor)(?![\w-])/;
    const FLATTENING = [
      [/(?:^|;|\{)\s*filter\s*:\s*(?!none\b)/, 'filter'],
      [/(?:^|;|\{)\s*opacity\s*:\s*(?!1\b|1\.0*\b)/, 'opacity'],
      [/(?:^|;|\{)\s*isolation\s*:\s*isolate/, 'isolation'],
      [/(?:^|;|\{)\s*contain\s*:\s*[^;}]*\b(?:paint|strict|content)\b/, 'contain'],
      [/(?:^|;|\{)\s*overflow(?:-[xy])?\s*:\s*(?!visible\b)/, 'overflow'],
      [/(?:^|;|\{)\s*clip-path\s*:\s*(?!none\b)/, 'clip-path'],
      [/(?:^|;|\{)\s*mask(?:-image)?\s*:\s*(?!none\b)/, 'mask'],
      [/(?:^|;|\{)\s*mix-blend-mode\s*:\s*(?!normal\b)/, 'mix-blend-mode'],
      [/(?:^|;|\{)\s*transform-style\s*:\s*flat/, 'transform-style: flat'],
    ];
    const offences = []; const animations = new Set();
    for (const [file, text] of css) {
      const keyframes = new Map();
      for (const m of text.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) keyframes.set(m[1], m[2]);
      for (const m of text.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
        // The SUBJECT (last compound) must be a coin element; `.df-coin3d__face img` styles the art
        // inside a face, which is flattened into that face anyway and is harmless.
        // :has()/:not() only condition the subject; their arguments are not what gets styled.
        const selector = m[1].replace(/:(?:has|not)\((?:[^()]|\([^()]*\))*\)/g, '');
        const subjects = selector.split(',').map((sel) => sel.trim().split(/\s+|>|~|\+/).filter(Boolean).at(-1) || '');
        if (!subjects.some((subject) => COIN.test(subject))) continue;
        for (const [re, name] of FLATTENING) if (re.test(`{${m[2]}`)) offences.push(`${file}: ${m[1].trim()} -> ${name}`);
        for (const a of m[2].matchAll(/animation(?:-name)?\s*:\s*([^;]+)/g)) for (const n of a[1].split(/[\s,]+/)) if (keyframes.has(n)) animations.add([file, n, keyframes.get(n)]);
      }
    }
    for (const [file, name, body] of animations) {
      for (const [re, prop] of FLATTENING) if (re.test(body.replace(/[{}]/g, ';'))) offences.push(`${file}: @keyframes ${name} animates ${prop}`);
    }
    assert.deepEqual(offences, [], 'move these effects to the rotor\'s parent');
  });
});
