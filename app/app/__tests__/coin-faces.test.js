import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  __resetCoinFaceTrackingForTest,
  appendCoinFaces,
  coinSideFromTransform,
} from '../coin-faces.js';

describe('single-surface coin face tracking', () => {
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

  test('the CSS transform cannot outrun its main-thread artwork swap', () => {
    const previous = {
      cancelAnimationFrame: globalThis.cancelAnimationFrame,
      document: globalThis.document,
      getComputedStyle: globalThis.getComputedStyle,
      IntersectionObserver: globalThis.IntersectionObserver,
      requestAnimationFrame: globalThis.requestAnimationFrame,
    };
    const frames = [];
    let observedTarget = null;

    class FakeNode {
      constructor(tagName) {
        this.tagName = String(tagName || '').toUpperCase();
        this.attributes = new Map();
        this.children = [];
        this.className = '';
        this.dataset = {};
        this.hidden = false;
        this.isConnected = true;
        this.parentElement = null;
        this.style = {};
      }

      appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
      }

      setAttribute(name, value) {
        this.attributes.set(String(name), String(value));
      }

      querySelector(selector) {
        const match = String(selector).match(/^\[data-coin-face="([^"]+)"\]$/);
        if (!match) return null;
        const wanted = match[1];
        const pending = [...this.children];
        while (pending.length > 0) {
          const node = pending.shift();
          if (node.attributes?.get('data-coin-face') === wanted) return node;
          pending.push(...(node.children || []));
        }
        return null;
      }
    }

    try {
      globalThis.document = { createElement: (tagName) => new FakeNode(tagName) };
      globalThis.requestAnimationFrame = (callback) => {
        frames.push(callback);
        return frames.length;
      };
      globalThis.cancelAnimationFrame = () => {};
      globalThis.IntersectionObserver = class {
        disconnect() {}
        observe(target) { observedTarget = target; }
        unobserve() {}
      };

      const rotor = new FakeNode('span');
      const stableWrapper = new FakeNode('button');
      const animation = {
        currentTime: 0,
        effect: { target: rotor },
        pauseCalls: 0,
        playbackRate: 1,
        pause() { this.pauseCalls += 1; },
      };
      rotor.getAnimations = () => [animation];
      globalThis.getComputedStyle = (node) => ({
        transform: node === rotor && animation.currentTime >= 100
          ? 'matrix3d(1,0,0,0,0,-1,0,0,0,0,-1,0,0,0,0,1)'
          : 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)',
      });

      appendCoinFaces(rotor);
      stableWrapper.appendChild(rotor);
      assert.equal(rotor.style.animationPlayState, 'paused',
        'the compositor-owned CSS clock is held before the rotor is painted');
      assert.equal(frames.length, 1);

      frames.shift()(1_000);
      assert.equal(animation.pauseCalls, 1);
      assert.equal(animation.currentTime, 0);
      assert.equal(observedTarget, stableWrapper,
        'visibility tracking uses the stable wrapper, never the edge-on rotor');

      frames.shift()(1_120);
      assert.equal(animation.currentTime, 120,
        'requestAnimationFrame advances the held CSS animation explicitly');
      assert.equal(rotor.dataset.visibleCoinFace, 'eth',
        'the artwork is selected from the transform advanced in the same frame');
      assert.equal(rotor.querySelector('[data-coin-face="red"]').hidden, true);
      assert.equal(rotor.querySelector('[data-coin-face="eth"]').hidden, false);
    } finally {
      __resetCoinFaceTrackingForTest();
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[name];
        else globalThis[name] = value;
      }
    }
  });
});
