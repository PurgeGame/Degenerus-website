import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.HTMLElement ??= class {};

const {
  LOW_FUNDS_DISPLAY_WEI,
  METAMASK_ETH_BUY_URL,
  ethFundingDestination,
  lowFundsThresholdWei,
  shouldShowEthFunding,
} = await import('../app-eth-onramp.js');

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../app-eth-onramp.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/eth-onramp.css', import.meta.url), 'utf8');

describe('low-ETH funding helper', () => {
  test('uses one display threshold across scaled testnet and unscaled mainnet', () => {
    assert.equal(LOW_FUNDS_DISPLAY_WEI, 20_000_000_000_000_000n);
    assert.equal(lowFundsThresholdWei(1n), LOW_FUNDS_DISPLAY_WEI);
    assert.equal(lowFundsThresholdWei(1_000_000n), 20_000_000_000n);
  });

  test('appears only for a connected, correctly-networked, known low balance', () => {
    const thresholdWei = 100n;
    const base = { connected: '0xabc', chainOk: true, thresholdWei };
    assert.equal(shouldShowEthFunding({ ...base, balanceWei: 99n }), true);
    assert.equal(shouldShowEthFunding({ ...base, balanceWei: 100n }), false);
    assert.equal(shouldShowEthFunding({ ...base, balanceWei: null }), false);
    assert.equal(shouldShowEthFunding({ ...base, connected: null, balanceWei: 0n }), false);
    assert.equal(shouldShowEthFunding({ ...base, chainOk: false, balanceWei: 0n }), false);
  });

  test('never sells real ETH into the Base Sepolia experience', () => {
    const testnet = ethFundingDestination({ id: 84_532 });
    assert.equal(testnet.mode, 'testnet');
    assert.match(testnet.href, /alchemy\.com\/faucets\/base-sepolia/);
    assert.match(testnet.note, /FREE TEST FUNDS · NOT REAL MONEY/);

    const mainnet = ethFundingDestination({ id: 1 });
    assert.equal(mainnet.mode, 'onramp');
    assert.equal(mainnet.href, METAMASK_ETH_BUY_URL);
    assert.match(mainnet.note, /CARD\/BANK · FEES & KYC MAY APPLY/);
    assert.equal(ethFundingDestination({ id: 11_155_111 }), null,
      'unknown testnets never fall through to a real-money on-ramp');
  });

  test('mounts in the wallet-context slot with a private external link', () => {
    const poolAt = html.indexOf('<app-pool-progress>');
    const protocolAt = html.indexOf('<app-protocol-wallet-banner');
    const fundingAt = html.indexOf('<app-eth-onramp');
    const jackpotAt = html.indexOf('class="jackpot-hero"');
    assert.ok(poolAt >= 0 && protocolAt > poolAt && fundingAt > protocolAt && jackpotAt > fundingAt);
    assert.match(html, /href="\/app\/styles\/eth-onramp\.css"/);
    assert.match(html, /src="\/app\/components\/app-eth-onramp\.js"/);
    assert.match(source, /target="_blank"/);
    assert.match(source, /rel="noopener noreferrer" referrerpolicy="no-referrer"/);
    assert.match(source, /provider\.getBalance\(address\)/);
    assert.match(source, /subscribe\('connected\.address'/);
    assert.match(source, /subscribe\('ui\.chainOk'/);
    assert.doesNotMatch(source, /destinationWallet|walletAddress=/,
      'the external provider receives no wallet address from this site');
    assert.match(css, /app-eth-onramp\[hidden\]\s*\{\s*display:\s*none !important/);
    assert.match(css, /@media \(max-width: 620px\)[\s\S]*eth-onramp__action\s*\{[^}]*width:\s*100%/s);
  });
});
