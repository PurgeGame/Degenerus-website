import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';

import { CONTRACTS } from '../chain-config.js';
import * as contracts from '../contracts.js';
import * as donation from '../link-donation.js';

const UNIT = 10n ** 18n;
const COORDINATOR = '0x1111111111111111111111111111111111111111';

test('the browser quote mirrors the contract reward curve and weighted tiers', () => {
  assert.equal(donation.linkDonationMultiplierWei(0n), 3n * UNIT);
  assert.equal(donation.linkDonationMultiplierWei(100n * UNIT), 2n * UNIT);
  assert.equal(donation.linkDonationMultiplierWei(200n * UNIT), UNIT);
  assert.equal(donation.linkDonationMultiplierWei(600n * UNIT), UNIT / 2n);
  assert.equal(donation.linkDonationMultiplierWei(1_000n * UNIT), 0n);
  assert.equal(donation.linkDonationAverageMultiplierWei(0n, 200n * UNIT), 2n * UNIT,
    'the displayed reward averages the declining 3x-to-1x rate across the donation');
  assert.equal(donation.linkDonationAverageMultiplierWei(200n * UNIT, 800n * UNIT), UNIT / 2n);
  assert.equal(donation.linkDonationAverageMultiplierWei(1_000n * UNIT, 10n * UNIT), 0n);
  assert.equal(donation.formatLinkDonationMultiplier(3n * UNIT), '3×');
  assert.equal(donation.formatLinkDonationMultiplier(UNIT / 2n), '0.5×');
});

test('the FLIP quote applies live LINK value, ticket price, and weighted multiplier', () => {
  const quote = donation.linkDonationFlipQuote({
    amountWei: 200n * UNIT,
    subscriptionBalanceWei: 0n,
    ethPerLinkWei: UNIT / 100n,
    mintPriceWei: 4n * UNIT / 100n,
  });
  assert.equal(quote.currentMultiplierWei, 3n * UNIT);
  assert.equal(quote.averageMultiplierWei, 2n * UNIT);
  assert.equal(quote.ethEquivalentWei, 2n * UNIT);
  assert.equal(quote.flipWei, 100_000n * UNIT);

  const disabled = donation.linkDonationFlipQuote({
    amountWei: 10n * UNIT,
    subscriptionBalanceWei: 0n,
    ethPerLinkWei: 0n,
    mintPriceWei: 4n * UNIT / 100n,
  });
  assert.equal(disabled.currentMultiplierWei, 0n,
    'a missing or unhealthy LINK price feed cannot advertise a theoretical 3x reward');
  assert.equal(disabled.flipWei, 0n);
});

describe('live LINK donation quote reads', () => {
  afterEach(() => {
    donation.__resetLinkDonationForTest();
    contracts.clearProvider();
  });

  test('reads the active subscription balance and valuation beside wallet state', async () => {
    contracts.setProvider({});
    donation.__setLinkDonationContractFactoryForTest((address) => {
      const target = String(address).toLowerCase();
      if (target === CONTRACTS.LINK_TOKEN.toLowerCase()) {
        return { balanceOf: async () => 12n * UNIT };
      }
      if (target === CONTRACTS.GAME.toLowerCase()) {
        return {
          middayRngCredits: async () => 4n * UNIT,
          mintPrice: async () => 4n * UNIT / 100n,
        };
      }
      if (target === CONTRACTS.ADMIN.toLowerCase()) {
        return {
          coordinator: async () => COORDINATOR,
          subscriptionId: async () => 77n,
          linkAmountToEth: async () => UNIT / 200n,
        };
      }
      if (target === COORDINATOR.toLowerCase()) {
        return { getSubscription: async () => [250n * UNIT, 0n, 0n, CONTRACTS.ADMIN, []] };
      }
      throw new Error(`Unexpected contract ${address}`);
    });

    const state = await donation.readLinkDonationState({
      player: '0xab12000000000000000000000000000000000000',
    });
    assert.deepEqual(state, {
      balanceWei: 12n * UNIT,
      creditWei: 4n * UNIT,
      subscriptionBalanceWei: 250n * UNIT,
      ethPerLinkWei: UNIT / 200n,
      mintPriceWei: 4n * UNIT / 100n,
    });
  });
});

test('the Donate LINK surface exposes a live multiplier and input-driven FLIP quote', () => {
  const component = readFileSync(new URL('../../components/app-player-funds-dialog.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
  assert.match(component, /data-bind="pfd-link-multiplier"/);
  assert.match(component, /data-bind="pfd-link-quote-input"/);
  assert.match(component, /data-bind="pfd-link-quote-reward"/);
  assert.match(component, /this\.#renderLinkQuote\(linkAmount\)/,
    'typing or choosing MAX repaints the quote with the current input');
  assert.match(component, /linkDonationFlipQuote\(\{/,
    'the widget uses the same amount-weighted quote helper covered above');
  assert.match(css, /\.pfd-link__quote\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /\.pfd-link__conversion > strong\s*\{[^}]*display:\s*flex/s);
});
