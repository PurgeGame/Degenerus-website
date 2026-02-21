/**
 * Degenerus Protocol — Mint Module
 * Vanilla JS, no build step. Requires window.ethers (ethers v6) to be set
 * before this script runs (loaded via ESM shim in the HTML).
 *
 * Exposes: window.Mint
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Contract config
  // ---------------------------------------------------------------------------

  var CONTRACTS = {
    GAME: '0x68B1D87F95878fE05B998F19b66F4baba5De1aed',
    COIN: '0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1',
    AFFILIATE: '0xc6e7DF5E7b4f2A278906862b61205850344D4e7d',
    QUESTS: '0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1',
    DEITY_PASS: '0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44',
  };

  var DEITY_PASS_ABI = [
    'function ownerOf(uint256 tokenId) view returns (address)',
  ];

  var CHAIN_ID = 31337; // localhost / Hardhat

  var REFERRER_KEY = 'degenerette_referrer_code';

  // ---------------------------------------------------------------------------
  // ABI fragments (ethers v6 human-readable)
  // ---------------------------------------------------------------------------

  var ABI = [
    // View
    'function purchaseInfo() view returns (uint24 lvl, bool inJackpotPhase, bool lastPurchaseDay, bool rngLocked, uint256 priceWei)',
    'function mintPrice() view returns (uint256)',
    'function level() view returns (uint24)',
    'function lootboxPresaleActiveFlag() view returns (bool)',
    'function hasActiveLazyPass(address player) view returns (bool)',
    'function deityPassTotalIssuedCount() view returns (uint32)',
    'function deityPassCountFor(address player) view returns (uint16)',
    'function gameOver() view returns (bool)',
    'function playerActivityScore(address player) view returns (uint256)',
    'function ethMintStats(address player) view returns (uint24 lvl, uint24 levelCount, uint24 streak)',
    // Write
    'function purchase(address buyer, uint256 ticketQuantity, uint256 lootBoxAmount, bytes32 affiliateCode, uint8 payKind) payable',
    'function purchaseCoin(address buyer, uint256 ticketQuantity, uint256 lootBoxBurnieAmount)',
    'function purchaseBurnieLootbox(address buyer, uint256 burnieAmount)',
    'function purchaseWhaleBundle(address buyer, uint256 quantity) payable',
    'function purchaseLazyPass(address buyer) payable',
    'function purchaseDeityPass(address buyer, uint8 symbolId) payable',
  ];

  var COIN_ABI = [
    'function balanceOf(address account) view returns (uint256)',
  ];

  var AFFILIATE_ABI = [
    'function getReferrer(address player) view returns (address)',
  ];

  var QUESTS_ABI = [
    'function getPlayerQuestView(address player) view returns (tuple(tuple(uint48 day, uint8 questType, bool highDifficulty, tuple(uint32 mints, uint256 tokenAmount) requirements)[2] quests, uint128[2] progress, bool[2] completed, uint32 lastCompletedDay, uint32 baseStreak))',
  ];

  var QUEST_NAMES = [
    'Mint (BURNIE)', 'Mint (ETH)', 'Coinflip', 'Affiliate',
    'Reserved', 'Decimator', 'Lootbox', 'Degenerette (ETH)', 'Degenerette (BURNIE)'
  ];

  // ---------------------------------------------------------------------------
  // Module state
  // ---------------------------------------------------------------------------

  var provider = null;
  var signer = null;
  var contract = null;
  var coinContract = null;
  var affiliateContract = null;
  var questsContract = null;
  var currentAddress = null;
  var currentMintPrice = 10000000000000000n; // BigInt — default 0.01 ETH, updated by refreshState
  var isPresale = true; // default to presale until contract says otherwise
  var pollTimer = null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  var CACHE_KEY = 'degenerus_beta_cache';

  function $(id) { return document.getElementById(id); }

  function ethers() { return window.ethers; }

  function saveCache(data) {
    try {
      var existing = loadCache();
      var merged = {};
      for (var k in existing) merged[k] = existing[k];
      for (var k2 in data) merged[k2] = data[k2];
      merged._ts = Date.now();
      localStorage.setItem(CACHE_KEY, JSON.stringify(merged));
    } catch (e) {}
  }

  function loadCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function restoreFromCache() {
    var c = loadCache();
    if (!c._ts) return;
    // Only use cache less than 1 hour old
    if (Date.now() - c._ts > 3600000) return;

    if (c.level != null) {
      setEl('status-level', c.level.toString());
      setEl('ticket-level', c.level.toString());
      setEl('burnie-ticket-level', c.level.toString());
    }
    if (c.price) setEl('status-price', c.price);
    if (c.priceWei) currentMintPrice = BigInt(c.priceWei);
    if (c.presale != null) {
      isPresale = c.presale;
      setPresale(c.presale);
    }
    if (c.phase) {
      setPhase(c.phase === 'Jackpot', c.phase === 'RNG Locked');
    }
    if (c.takenSymbols) applyTakenSymbols(c.takenSymbols);

    refreshPassPrices();
    updateEthTotal();
  }

  function getAffiliateCode() {
    var raw = '';
    // 1. Check the form field
    var input = $('affiliate-code');
    if (input && input.value.trim()) {
      raw = input.value.trim().toUpperCase();
    }
    // 2. Fall back to localStorage
    if (!raw) {
      try { raw = localStorage.getItem(REFERRER_KEY) || ''; } catch (e) { raw = ''; }
    }
    // Pad / encode as bytes32
    if (!raw) return ethers().ZeroHash;
    try {
      return ethers().encodeBytes32String(raw.slice(0, 31));
    } catch (e) {
      return ethers().ZeroHash;
    }
  }

  function formatEth(wei) {
    return ethers().formatEther(wei);
  }

  function formatBurnie(wei) {
    var full = ethers().formatEther(wei);
    var n = parseFloat(full);
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toFixed(0);
  }

  function truncateHash(hash) {
    if (!hash) return '';
    return hash.slice(0, 10) + '...' + hash.slice(-8);
  }

  // ---------------------------------------------------------------------------
  // TX status DOM helpers
  // ---------------------------------------------------------------------------

  function setTxStatus(state, message, hash) {
    var el = $('tx-status');
    if (!el) return;
    el.className = 'tx-status tx-status--' + state;
    if (state === 'pending') {
      el.innerHTML = '<span class="tx-spinner"></span><span>' + message + '</span>';
    } else if (state === 'confirmed' && hash) {
      var truncated = truncateHash(hash);
      el.innerHTML =
        '<span class="tx-icon tx-icon--ok">&#x2713;</span>' +
        '<span>' + message + ' </span>' +
        '<a href="https://etherscan.io/tx/' + hash + '" target="_blank" rel="noopener" class="tx-hash">' + truncated + '</a>';
    } else if (state === 'error') {
      el.innerHTML = '<span class="tx-icon tx-icon--err">&#x2715;</span><span>' + message + '</span>';
    } else {
      el.textContent = message || '';
    }
  }

  function clearTxStatus() {
    var el = $('tx-status');
    if (!el) return;
    el.className = 'tx-status';
    el.textContent = '';
  }

  // ---------------------------------------------------------------------------
  // DOM update helpers
  // ---------------------------------------------------------------------------

  function setEl(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function setPhase(inJackpot, rngLocked) {
    var el = $('status-phase');
    if (!el) return;
    el.className = 'status-value';
    if (rngLocked) {
      el.textContent = 'RNG Locked';
      el.classList.add('phase--rng');
    } else if (inJackpot) {
      el.textContent = 'Jackpot';
      el.classList.add('phase--jackpot');
    } else {
      el.textContent = 'Normal';
      el.classList.add('phase--normal');
    }
  }

  function setPresale(active) {
    var el = $('status-presale');
    if (!el) return;
    el.className = 'status-value';
    if (active) {
      el.textContent = '62% Bonus BURNIE';
      el.classList.add('presale--active');
    } else {
      el.textContent = 'Inactive';
      el.classList.add('presale--inactive');
    }
    // Also show/hide the badge in the purchase panel
    var badge = $('presale-badge');
    if (badge) {
      badge.style.display = active ? 'block' : 'none';
      badge.textContent = active ? 'PRESALE - 62% BONUS BURNIE' : '';
    }
  }

  function weiToStr(wei) {
    var eth = ethers();
    return eth ? eth.formatEther(wei) : (Number(wei) / 1e18).toString();
  }

  function parseEthInput(str) {
    str = (str || '0').trim();
    if (parseFloat(str) < 0) return 0n;
    var parts = str.split('.');
    var whole = parts[0] || '0';
    var frac = (parts[1] || '').slice(0, 18).padEnd(18, '0');
    return BigInt(whole) * 1000000000000000000n + BigInt(frac);
  }

  function updateEthTotal() {
    var costEl = $('eth-total-cost');
    if (!costEl) return;
    try {
      var qty = parseInt(($('ticket-qty') || {}).value, 10) || 0;
      var lootboxStr = ($('lootbox-amount') || {}).value || '0';
      var ticketWei = currentMintPrice ? currentMintPrice * BigInt(Math.max(qty, 0)) : 0n;
      var lootboxWei = parseEthInput(lootboxStr);
      costEl.textContent = weiToStr(ticketWei + lootboxWei);
      var rewardEl = $('eth-coin-reward');
      if (rewardEl) {
        var burnie = Math.max(qty, 0) * PRICE_COIN_UNIT;
        rewardEl.textContent = burnie > 0 ? '+ ' + burnie.toLocaleString() + ' free BURNIE' : '';
      }
    } catch (e) {
      costEl.textContent = '—';
    }
  }

  var PRICE_COIN_UNIT = 1000; // 1000 BURNIE per ticket

  function updateBurnieTotal() {
    var costEl = $('burnie-total-cost');
    if (!costEl) return;
    try {
      var qty = parseInt(($('burnie-ticket-qty') || {}).value, 10) || 0;
      var lootbox = parseFloat(($('burnie-lootbox-amount') || {}).value) || 0;
      var total = Math.max(qty, 0) * PRICE_COIN_UNIT + Math.max(lootbox, 0);
      costEl.textContent = total.toLocaleString();
    } catch (e) {
      costEl.textContent = '—';
    }
  }

  function lootboxBadge(priceWei) {
    var bps = isPresale ? 2000n : 1000n;
    var lootWei = (priceWei * bps) / 10000n;
    var pct = isPresale ? '20%' : '10%';
    return '+ free ' + formatEth(lootWei) + ' ETH lootbox (' + pct + ')';
  }

  function refreshPassPrices() {
    var eth = ethers();
    if (!eth) return;

    var levelEl = $('status-level');
    var lvl = levelEl ? parseInt(levelEl.textContent || '0', 10) : 0;

    // Whale pass: 2.4 ETH at levels 0-3, 4 ETH otherwise, × qty
    var whaleUnitWei = lvl <= 3 ? eth.parseEther('2.4') : eth.parseEther('4');
    var whaleQty = parseInt(($('whale-qty') || {}).value || '1', 10) || 1;
    var whaleWei = whaleUnitWei * BigInt(Math.max(whaleQty, 1));
    setEl('whale-price', formatEth(whaleWei));
    setEl('whale-lootbox', lootboxBadge(whaleUnitWei));

    // Lazy pass: flat 0.24 ETH at levels 0-2, 10 × mintPrice otherwise
    var lazyWei = lvl <= 2
      ? eth.parseEther('0.24')
      : (currentMintPrice ? currentMintPrice * 10n : eth.parseEther('0.4'));
    setEl('lazy-price', formatEth(lazyWei));
    setEl('lazy-lootbox', lootboxBadge(lazyWei));

    // Deity pass: 24 + T(k) where T(k) = k*(k+1)/2, k = issued count
    var deityBaseWei = eth.parseEther('24');
    setEl('deity-price', formatEth(deityBaseWei) + '+');
    setEl('deity-lootbox', lootboxBadge(deityBaseWei));
    if (contract) {
      contract.deityPassTotalIssuedCount().then(function (issued) {
        var tri = (issued * (issued + 1n)) / 2n * eth.parseEther('1');
        var deityWei = deityBaseWei + tri;
        setEl('deity-price', formatEth(deityWei));
        setEl('deity-lootbox', lootboxBadge(deityWei));
      }).catch(function () {});
    }

  }

  function applyTakenSymbols(taken) {
    var select = $('deity-symbol');
    if (!select) return;
    var opts = select.querySelectorAll('option');
    for (var j = 0; j < opts.length; j++) {
      var val = parseInt(opts[j].value, 10);
      var isTaken = taken.indexOf(val) !== -1;
      opts[j].disabled = isTaken;
      opts[j].textContent = opts[j].textContent.replace(/ \(taken\)$/, '') + (isTaken ? ' (taken)' : '');
    }
    // If current selection is taken, pick first available
    var cur = parseInt(select.value, 10);
    if (taken.indexOf(cur) !== -1) {
      for (var k = 0; k < 32; k++) {
        if (taken.indexOf(k) === -1) {
          select.value = k.toString();
          select.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }
  }

  var deityPassContract = null;

  function refreshDeitySymbols() {
    var select = $('deity-symbol');
    var eth = ethers();
    if (!select || !eth || !provider) return;

    if (!deityPassContract) {
      deityPassContract = new eth.Contract(CONTRACTS.DEITY_PASS, DEITY_PASS_ABI, provider);
    }

    var checks = [];
    for (var i = 0; i < 32; i++) checks.push(i);

    var selectedBefore = select.value;
    Promise.all(checks.map(function (id) {
      return deityPassContract.ownerOf(id).then(function () {
        return { id: id, taken: true };
      }).catch(function () {
        return { id: id, taken: false };
      });
    })).then(function (results) {
      var taken = [];
      for (var r = 0; r < results.length; r++) {
        if (results[r].taken) taken.push(results[r].id);
      }
      applyTakenSymbols(taken);
      saveCache({ takenSymbols: taken });
    });
  }

  // ---------------------------------------------------------------------------
  // init
  // ---------------------------------------------------------------------------

  async function init() {
    if (!window.ethereum) {
      setTxStatus('error', 'No Ethereum wallet detected. Install MetaMask.');
      return;
    }

    try {
      var eth = ethers();
      provider = new eth.BrowserProvider(window.ethereum);
      signer = await provider.getSigner();
      currentAddress = await signer.getAddress();

      contract = new eth.Contract(CONTRACTS.GAME, ABI, signer);
      coinContract = new eth.Contract(CONTRACTS.COIN, COIN_ABI, provider);
      affiliateContract = new eth.Contract(CONTRACTS.AFFILIATE, AFFILIATE_ABI, provider);
      questsContract = new eth.Contract(CONTRACTS.QUESTS, QUESTS_ABI, provider);

      // Pre-fill affiliate code from localStorage
      var storedCode = '';
      try { storedCode = localStorage.getItem(REFERRER_KEY) || ''; } catch (e) {}
      var affInput = $('affiliate-code');
      if (affInput && storedCode && !affInput.value) {
        affInput.value = storedCode;
      }

      await refreshState();
      await refreshPlayer(currentAddress);
      refreshDeitySymbols();

      // Listen for account changes
      window.ethereum.on('accountsChanged', async function (accounts) {
        if (accounts && accounts.length > 0) {
          signer = await provider.getSigner();
          currentAddress = await signer.getAddress();
          contract = new eth.Contract(CONTRACTS.GAME, ABI, signer);
          coinContract = new eth.Contract(CONTRACTS.COIN, COIN_ABI, provider);
          affiliateContract = new eth.Contract(CONTRACTS.AFFILIATE, AFFILIATE_ABI, provider);
          questsContract = new eth.Contract(CONTRACTS.QUESTS, QUESTS_ABI, provider);
          await refreshState();
          await refreshPlayer(currentAddress);
        } else {
          currentAddress = null;
        }
      });

      // Start polling
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(async function () {
        try { await refreshState(); } catch (e) { console.warn('Poll error:', e); }
        if (currentAddress) {
          try { await refreshPlayer(currentAddress); } catch (e) { console.warn('Player poll error:', e); }
        }
      }, 15000);

    } catch (err) {
      console.error('Mint.init error:', err);
      setTxStatus('error', err.message || 'Failed to initialise wallet');
    }
  }

  // ---------------------------------------------------------------------------
  // refreshState
  // ---------------------------------------------------------------------------

  async function refreshState() {
    if (!contract) return;

    try {
      var [info, presale] = await Promise.all([
        contract.purchaseInfo(),
        contract.lootboxPresaleActiveFlag(),
      ]);

      // purchaseInfo returns: (lvl, inJackpotPhase, lastPurchaseDay, rngLocked, priceWei)
      var lvl = info[0];
      var inJackpot = info[1];
      var rngLocked = info[3];
      var priceWei = info[4];

      currentMintPrice = priceWei;
      isPresale = presale;

      setEl('status-level', lvl.toString());
      setEl('ticket-level', lvl.toString());
      setEl('burnie-ticket-level', lvl.toString());
      setEl('status-price', formatEth(priceWei) + ' ETH');
      var phaseName = rngLocked ? 'RNG Locked' : (inJackpot ? 'Jackpot' : 'Normal');
      setPhase(inJackpot, rngLocked);
      setPresale(presale);
      updateEthTotal();
      refreshPassPrices();

      saveCache({
        level: Number(lvl),
        price: formatEth(priceWei) + ' ETH',
        priceWei: priceWei.toString(),
        presale: presale,
        phase: phaseName,
      });

    } catch (err) {
      console.error('refreshState error:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // refreshPlayer
  // ---------------------------------------------------------------------------

  async function refreshPlayer(address) {
    if (!contract || !address) return;

    try {
      var promises = [
        contract.hasActiveLazyPass(address),
        contract.playerActivityScore(address),
        contract.ethMintStats(address),
      ];
      if (coinContract) promises.push(coinContract.balanceOf(address));
      if (affiliateContract) promises.push(affiliateContract.getReferrer(address));
      if (questsContract) promises.push(questsContract.getPlayerQuestView(address));

      var results = await Promise.all(promises);
      var idx = 0;
      var hasLazy = results[idx++];
      var scoreBps = results[idx++];
      var mintStats = results[idx++];
      var burnieBalance = coinContract ? results[idx++] : 0n;
      var referrer = affiliateContract ? results[idx++] : '0x0000000000000000000000000000000000000000';
      var questView = questsContract ? results[idx++] : null;

      // Score in status bar (bps → percentage)
      var scorePct = (Number(scoreBps) / 100).toFixed(0);
      setEl('status-score', scorePct + '%');

      setEl('burnie-balance', formatBurnie(burnieBalance) + ' BURNIE');

      // Hide referral input if player already has a referrer on-chain
      var affItem = $('affiliate-code');
      if (affItem) {
        var hasReferrer = referrer !== '0x0000000000000000000000000000000000000000';
        var affParent = affItem.closest('.status-item');
        if (affParent) affParent.style.display = hasReferrer ? 'none' : '';
      }

      // Streaks panel
      var infoPanel = $('player-info-panel');
      if (infoPanel) infoPanel.style.display = '';

      setEl('player-mint-streak', mintStats.streak.toString());
      setEl('player-level-count', mintStats.levelCount.toString());

      // Green/orange row backgrounds
      var gameLevel = parseInt($('status-level').textContent || '0', 10);
      var activeLevel = gameLevel + 2;
      var mintedThisLevel = Number(mintStats.lvl) >= activeLevel;

      var mintRow = $('row-mint-streak');
      if (mintRow) mintRow.className = 'info-row' + (mintedThisLevel ? ' info-row--good' : ' info-row--warn');

      var levelRow = $('row-level-count');
      if (levelRow) levelRow.className = 'info-row' + (mintedThisLevel ? ' info-row--good' : ' info-row--warn');

      // Quests
      if (questView) {
        setEl('player-quest-streak', questView.baseStreak.toString());

        // Quest streak row: green if both quests done today, orange if not
        var allQuestsDone = questView.completed[0] && questView.completed[1];
        var questRow = $('row-quest-streak');
        if (questRow) questRow.className = 'info-row' + (allQuestsDone ? ' info-row--good' : ' info-row--warn');
        for (var q = 0; q < 2; q++) {
          var quest = questView.quests[q];
          var typeName = QUEST_NAMES[quest.questType] || ('Type ' + quest.questType);
          if (quest.highDifficulty) typeName += ' (Hard)';
          setEl('quest-' + q + '-type', typeName);

          var progEl = $('quest-' + q + '-progress');
          if (progEl) {
            if (questView.completed[q]) {
              progEl.innerHTML = '<span class="quest-done">Completed</span>';
            } else if (quest.requirements.mints > 0) {
              progEl.textContent = questView.progress[q].toString() + ' / ' + quest.requirements.mints.toString() + ' mints';
            } else {
              progEl.textContent = 'In progress';
            }
          }
        }
      }

      var lazyEl = $('player-lazy-status');
      if (lazyEl) {
        if (hasLazy) {
          lazyEl.textContent = 'Active pass';
          lazyEl.className = 'pass-status pass-status--active';
        } else {
          lazyEl.textContent = 'No active pass';
          lazyEl.className = 'pass-status pass-status--inactive';
        }
      }
    } catch (err) {
      console.error('refreshPlayer error:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // purchase
  // ---------------------------------------------------------------------------

  async function purchase() {
    if (!signer || !contract) {
      setTxStatus('error', 'Connect your wallet first');
      return;
    }

    var eth = ethers();

    try {
      clearTxStatus();

      var ticketQty = parseInt(($('ticket-qty') || {}).value || '0', 10);
      var lootboxRaw = parseFloat(($('lootbox-amount') || {}).value || '0');
      var affCode = getAffiliateCode();

      if (ticketQty < 0) ticketQty = 0;
      if (lootboxRaw < 0) lootboxRaw = 0;

      // lootboxAmount in wei
      var lootboxWei = eth.parseEther(lootboxRaw.toString());

      // Contract expects ticketQuantity scaled: 1 ticket = 4 * TICKET_SCALE (400)
      // Cost formula: (priceWei * ticketQuantity) / 400 = priceWei * qty
      var TICKET_UNIT = 400n;
      var ticketScaled = BigInt(ticketQty) * TICKET_UNIT;

      // ticket cost in wei (1 ticket set = 1 × mintPrice)
      var ticketWei = currentMintPrice
        ? currentMintPrice * BigInt(ticketQty)
        : 0n;

      var msgValue = ticketWei + lootboxWei;

      setTxStatus('pending', 'Confirming...');

      var tx = await contract.purchase(
        eth.ZeroAddress,
        ticketScaled,
        lootboxWei,
        affCode,
        0, // DirectEth
        { value: msgValue }
      );

      var receipt = await tx.wait();
      setTxStatus('confirmed', 'Confirmed!', receipt.hash);

      await refreshState();
      if (currentAddress) await refreshPlayer(currentAddress);

    } catch (err) {
      console.error('purchase error:', err);
      var msg = err.reason || err.shortMessage || err.message || 'Transaction failed';
      setTxStatus('error', msg);
    }
  }

  // ---------------------------------------------------------------------------
  // purchaseBurnie — buy tickets and/or lootboxes with BURNIE
  // ---------------------------------------------------------------------------

  async function purchaseBurnie() {
    if (!signer || !contract) {
      setTxStatus('error', 'Connect your wallet first');
      return;
    }

    var eth = ethers();

    try {
      clearTxStatus();

      var ticketQty = parseInt(($('burnie-ticket-qty') || {}).value || '0', 10);
      var lootboxRaw = parseFloat(($('burnie-lootbox-amount') || {}).value || '0');

      if (ticketQty < 0) ticketQty = 0;
      if (lootboxRaw < 0) lootboxRaw = 0;
      if (ticketQty === 0 && lootboxRaw <= 0) {
        setTxStatus('error', 'Enter a ticket quantity or BURNIE lootbox amount');
        return;
      }

      // Ticket scaling: 1 ticket = 400 units
      var TICKET_UNIT = 400n;
      var ticketScaled = BigInt(ticketQty) * TICKET_UNIT;

      // Lootbox amount in BURNIE wei (18 decimals), min 1000 BURNIE
      var lootboxBurnie = eth.parseEther(lootboxRaw.toString());

      setTxStatus('pending', 'Confirming...');

      var tx;
      if (ticketQty > 0) {
        // purchaseCoin handles both tickets + optional lootbox
        tx = await contract.purchaseCoin(
          eth.ZeroAddress,
          ticketScaled,
          lootboxBurnie
        );
      } else {
        // Lootbox-only BURNIE purchase
        tx = await contract.purchaseBurnieLootbox(
          await signer.getAddress(),
          lootboxBurnie
        );
      }

      var receipt = await tx.wait();
      setTxStatus('confirmed', 'Confirmed!', receipt.hash);

      await refreshState();
      if (currentAddress) await refreshPlayer(currentAddress);

    } catch (err) {
      console.error('purchaseBurnie error:', err);
      var msg = err.reason || err.shortMessage || err.message || 'Transaction failed';
      setTxStatus('error', msg);
    }
  }

  // ---------------------------------------------------------------------------
  // purchaseWhaleBundle
  // ---------------------------------------------------------------------------

  async function purchaseWhaleBundle() {
    if (!signer || !contract) {
      setTxStatus('error', 'Connect your wallet first');
      return;
    }

    try {
      clearTxStatus();

      var qty = parseInt(($('whale-qty') || {}).value || '1', 10);
      if (qty < 1) qty = 1;

      var eth = ethers();

      // Price: 2.4 ETH at levels 0-3, 4 ETH at x49/x99 levels.
      // Contract validates exact pricing; this is a best-effort estimate.
      var levelEl = $('status-level');
      var currentLevel = levelEl ? parseInt(levelEl.textContent || '0', 10) : 0;
      var bundlePrice = currentLevel <= 3
        ? eth.parseEther('2.4')
        : eth.parseEther('4');

      var msgValue = bundlePrice * BigInt(qty);

      setTxStatus('pending', 'Confirming...');

      var tx = await contract.purchaseWhaleBundle(
        eth.ZeroAddress,
        BigInt(qty),
        { value: msgValue }
      );

      var receipt = await tx.wait();
      setTxStatus('confirmed', 'Confirmed!', receipt.hash);

      await refreshState();
      if (currentAddress) await refreshPlayer(currentAddress);

    } catch (err) {
      console.error('purchaseWhaleBundle error:', err);
      var msg = err.reason || err.shortMessage || err.message || 'Transaction failed';
      setTxStatus('error', msg);
    }
  }

  // ---------------------------------------------------------------------------
  // purchaseLazyPass
  // ---------------------------------------------------------------------------

  async function purchaseLazyPass() {
    if (!signer || !contract) {
      setTxStatus('error', 'Connect your wallet first');
      return;
    }

    try {
      clearTxStatus();
      setTxStatus('pending', 'Confirming...');

      var eth = ethers();

      // Lazy pass cost: levels 0-2 = flat 0.24 ETH, otherwise sum of 10
      // per-level ticket prices. Contract reverts on wrong value, so we
      // estimate generously — at early levels mintPrice is constant, so
      // 10 × mintPrice is close enough; 0.24 ETH for the flat early levels.
      var levelEl = $('status-level');
      var currentLevel = levelEl ? parseInt(levelEl.textContent || '0', 10) : 0;
      var lazyPrice = (currentLevel <= 2)
        ? eth.parseEther('0.24')
        : (currentMintPrice ? currentMintPrice * 10n : eth.parseEther('0.4'));

      var tx = await contract.purchaseLazyPass(
        eth.ZeroAddress,
        { value: lazyPrice }
      );

      var receipt = await tx.wait();
      setTxStatus('confirmed', 'Confirmed!', receipt.hash);

      await refreshState();
      if (currentAddress) await refreshPlayer(currentAddress);

    } catch (err) {
      console.error('purchaseLazyPass error:', err);
      var msg = err.reason || err.shortMessage || err.message || 'Transaction failed';
      setTxStatus('error', msg);
    }
  }

  // ---------------------------------------------------------------------------
  // purchaseDeityPass
  // ---------------------------------------------------------------------------

  async function purchaseDeityPass() {
    if (!signer || !contract) {
      setTxStatus('error', 'Connect your wallet first');
      return;
    }

    try {
      clearTxStatus();

      var symbolId = parseInt(($('deity-symbol') || {}).value || '0', 10);
      var eth = ethers();

      // Deity pass pricing: 24 ETH + T(k) where T(k) = k*(k+1)/2 ETH,
      // k = number of passes already issued. Contract reverts on wrong value.
      var issued = 0n;
      try {
        issued = await contract.deityPassTotalIssuedCount();
      } catch (e) { /* default 0 */ }

      var basePrice = eth.parseEther('24');
      // T(k) = k*(k+1)/2 in ETH
      var triangular = (issued * (issued + 1n)) / 2n;
      var msgValue = basePrice + triangular * eth.parseEther('1');

      setTxStatus('pending', 'Confirming...');

      var tx = await contract.purchaseDeityPass(
        eth.ZeroAddress,
        symbolId,
        { value: msgValue }
      );

      var receipt = await tx.wait();
      setTxStatus('confirmed', 'Confirmed!', receipt.hash);

      await refreshState();
      if (currentAddress) await refreshPlayer(currentAddress);

    } catch (err) {
      console.error('purchaseDeityPass error:', err);
      var msg = err.reason || err.shortMessage || err.message || 'Transaction failed';
      setTxStatus('error', msg);
    }
  }

  // ---------------------------------------------------------------------------
  // claimWinnings
  // ---------------------------------------------------------------------------
  // Attach qty change listener after DOM ready
  // ---------------------------------------------------------------------------

  function attachListeners() {
    // ETH total: tickets + lootbox
    ['ticket-qty', 'lootbox-amount'].forEach(function (id) {
      var el = $(id);
      if (el) {
        el.addEventListener('input', updateEthTotal);
        el.addEventListener('change', updateEthTotal);
      }
    });
    // BURNIE total: tickets + lootbox
    ['burnie-ticket-qty', 'burnie-lootbox-amount'].forEach(function (id) {
      var el = $(id);
      if (el) {
        el.addEventListener('input', updateBurnieTotal);
        el.addEventListener('change', updateBurnieTotal);
      }
    });
    // Whale qty updates price
    var whaleQtyEl = $('whale-qty');
    if (whaleQtyEl) {
      whaleQtyEl.addEventListener('input', refreshPassPrices);
      whaleQtyEl.addEventListener('change', refreshPassPrices);
    }


    // Pre-fill affiliate code from URL param or localStorage
    var affInput = $('affiliate-code');
    if (affInput) {
      var params = new URLSearchParams(window.location.search);
      var urlRef = (params.get('ref') || params.get('referral') || params.get('code') || '').trim().toUpperCase();
      if (urlRef) {
        affInput.value = urlRef;
        try { localStorage.setItem(REFERRER_KEY, urlRef); } catch (e) {}
      } else if (!affInput.value) {
        try {
          var stored = localStorage.getItem(REFERRER_KEY) || '';
          if (stored) affInput.value = stored;
        } catch (e) {}
      }
      affInput.addEventListener('change', function () {
        var val = affInput.value.trim().toUpperCase();
        if (val) {
          try { localStorage.setItem(REFERRER_KEY, val); } catch (e) {}
        }
      });
    }

    // Deity symbol preview
    var SYMBOL_SVGS = [
      'crypto_00_xrp', 'crypto_01_tron', 'crypto_02_sui', 'crypto_03_monero',
      'crypto_04_solana', 'crypto_05_chainlink', 'crypto_06_ethereum', 'crypto_07_bitcoin',
      'zodiac_00_aries', 'zodiac_01_taurus', 'zodiac_02_gemini', 'zodiac_03_cancer',
      'zodiac_04_leo', 'zodiac_05_libra', 'zodiac_06_sagittarius', 'zodiac_07_aquarius',
      'cards_00_horseshoe', 'cards_01_king', 'cards_02_cashsack', 'cards_03_club',
      'cards_04_diamond', 'cards_05_heart', 'cards_06_spade', 'cards_07_ace',
      'dice_00_1', 'dice_01_2', 'dice_02_3', 'dice_03_4',
      'dice_04_5', 'dice_05_6', 'dice_06_7', 'dice_07_8',
    ];
    var deitySelect = $('deity-symbol');
    var deityPreview = $('deity-symbol-preview');
    if (deitySelect && deityPreview) {
      function updateDeityPreview() {
        var idx = parseInt(deitySelect.value, 10);
        var svg = SYMBOL_SVGS[idx];
        if (svg) {
          deityPreview.src = '/symbols/' + svg + '_gold.svg';
          deityPreview.alt = deitySelect.options[deitySelect.selectedIndex].text;
        }
      }
      deitySelect.addEventListener('change', updateDeityPreview);
      deitySelect.addEventListener('input', updateDeityPreview);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      attachListeners();
      restoreFromCache();
    });
  } else {
    attachListeners();
    restoreFromCache();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  window.Mint = {
    init: init,
    refreshState: refreshState,
    refreshPlayer: refreshPlayer,
    purchase: purchase,
    purchaseBurnie: purchaseBurnie,
    purchaseWhaleBundle: purchaseWhaleBundle,
    purchaseLazyPass: purchaseLazyPass,
    purchaseDeityPass: purchaseDeityPass,
  };

})();
