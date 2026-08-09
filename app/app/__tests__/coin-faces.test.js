import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { coinSideFromTransform } from '../coin-faces.js';

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
});
