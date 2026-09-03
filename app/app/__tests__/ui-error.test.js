import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compactUiError, briefTxError } from '../ui-error.js';

describe('player-facing error boundary', () => {
  test('turns a nested Base OutOfFunds response into a useful short message', () => {
    const error = {
      code: 'UNKNOWN_ERROR',
      info: {
        error: {
          code: -32003,
          message: 'EVM error: OutOfFunds',
        },
        payload: {
          method: 'eth_estimateGas',
          params: [{ data: `0x${'ab'.repeat(400)}` }],
        },
      },
    };

    const message = compactUiError(error);
    assert.equal(message, "This wallet doesn't have enough ETH for the transaction and gas.");
    assert.ok(message.length < 90);
  });

  test('never returns a raw provider blob or oversized message', () => {
    const raw = new Error(
      `could not coalesce error (error={"code":-32000,"data":"0x${'cd'.repeat(300)}"})`,
    );
    const message = compactUiError(raw, 'Purchase did not go through. Try again.');
    assert.equal(message, 'Purchase did not go through. Try again.');
    assert.doesNotMatch(message, /coalesce|0xcd|\{"code"/i);
    assert.ok(message.length <= 110);
  });

  test('keeps controlled short messages but rejects an unsafe fallback', () => {
    assert.equal(
      compactUiError({ userMessage: 'That symbol was already claimed.' }),
      'That symbol was already claimed.',
    );
    assert.equal(
      briefTxError(new Error(`provider exploded ${'x'.repeat(200)}`), `0x${'ef'.repeat(100)}`),
      'Transaction did not go through. Try again.',
    );
  });

  test('a verified public gas quote outranks a nested wallet insufficient-funds error', () => {
    const message = compactUiError({
      code: 'WalletGasQuoteRejected',
      userMessage: 'Your wallet rejected a valid gas quote. Reconnect the wallet and try again.',
      cause: { code: 'INSUFFICIENT_FUNDS', message: 'insufficient funds for gas' },
    });
    assert.equal(
      message,
      'Your wallet rejected a valid gas quote. Reconnect the wallet and try again.',
    );
  });
});
