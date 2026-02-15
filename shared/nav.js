/* Unified nav: wallet connect, Discord auth, affiliate code gen/catch */
(function () {
  'use strict';

  var API = 'https://api.degener.us';
  var REFERRER_KEY = 'degenerette_referrer_code';

  // State
  var address = null;
  var discord = null;
  var player = null; // server player object

  // SVGs
  var DISCORD_SVG = '<svg viewBox="0 0 245 240"><path fill="currentColor" d="M104.4 104.9c-5.7 0-10.2 5-10.2 11.1 0 6.1 4.6 11.1 10.2 11.1 5.7 0 10.2-5 10.2-11.1.1-6.1-4.5-11.1-10.2-11.1zm36.2 0c-5.7 0-10.2 5-10.2 11.1 0 6.1 4.6 11.1 10.2 11.1 5.7 0 10.2-5 10.2-11.1 0-6.1-4.6-11.1-10.2-11.1z"/><path fill="currentColor" d="M189.5 20h-134C24.9 20 10 34.9 10 53.5v126.9C10 199 24.9 214 43.5 214h113.4l-5.3-18.5 12.8 11.9 12.1 11.2 21.4 19V53.5c0-18.6-14.9-33.5-33.4-33.5zM163 149.7s-4.6-5.5-8.4-10.3c16.7-4.7 23.1-15.1 23.1-15.1-5.2 3.4-10.1 5.8-14.5 7.4-6.3 2.7-12.3 4.5-18.2 5.5-12.2 2.3-23.4 1.7-33.1-.1-7.3-1.4-13.6-3.3-18.9-5.5-3-1.1-6.2-2.5-9.4-4.3-.4-.2-.8-.4-1.2-.6-.2-.1-.3-.2-.5-.3-2.2-1.2-3.4-2-3.4-2s6.2 10.2 22.6 15c-3.8 4.8-8.5 10.5-8.5 10.5-28.1-.9-38.8-19.3-38.8-19.3 0-41 18.4-74.2 18.4-74.2 18.4-13.8 35.9-13.4 35.9-13.4l1.3 1.5c-23 6.6-33.6 16.6-33.6 16.6s2.8-1.5 7.5-3.6c13.6-6 24.4-7.6 28.8-8 .7-.1 1.3-.2 2-.2 7.2-1 15.3-1.3 23.7-.3 11.1 1.3 23 4.7 35.2 11.8 0 0-10-9.5-31.5-16.1l1.8-2c0 .1 17.5-.4 35.9 13.4 0 0 18.4 33.2 18.4 74.2 0 0-10.8 18.4-38.9 19.3z"/></svg>';

  var WALLET_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="22" height="14" rx="2"/><path d="M1 10h22"/><circle cx="18" cy="14" r="1"/><path d="M5 6V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2"/></svg>';

  // --- Helpers ---

  function api(path, opts) {
    opts = opts || {};
    return fetch(API + path, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          var msg = 'Request failed';
          try { msg = JSON.parse(t).error || msg; } catch (e) { msg = t || msg; }
          throw new Error(msg);
        });
      }
      if (res.status === 204) return null;
      return res.json();
    });
  }

  function $(id) { return document.getElementById(id); }

  function getRef() {
    try { return localStorage.getItem(REFERRER_KEY); } catch (e) { return null; }
  }

  function setRef(code) {
    try {
      if (code) localStorage.setItem(REFERRER_KEY, code.toUpperCase());
      else localStorage.removeItem(REFERRER_KEY);
    } catch (e) { /* ignore */ }
  }

  // --- Referral code catcher ---

  function captureReferrer() {
    var params = new URLSearchParams(window.location.search);
    var raw = params.get('ref') || params.get('referral') || params.get('code');
    if (!raw) return;
    var trimmed = raw.trim().toUpperCase();
    if (trimmed) setRef(trimmed);
    params.delete('ref');
    params.delete('referral');
    params.delete('code');
    var q = params.toString();
    var next = window.location.pathname + (q ? '?' + q : '') + window.location.hash;
    window.history.replaceState({}, '', next);
  }

  // --- UI updates ---

  function updateWalletBtn() {
    var btn = $('unav-wallet');
    if (!btn) return;
    var lbl = btn.querySelector('.btn-label');
    if (address) {
      var short = address.slice(0, 6) + '...' + address.slice(-4);
      if (lbl) lbl.textContent = short;
      btn.classList.add('connected');
    } else {
      if (lbl) lbl.textContent = 'Connect';
      btn.classList.remove('connected');
    }
    updateAffiliate();
  }

  function updateDiscordBtn() {
    var btn = $('unav-discord');
    if (!btn) return;
    var lbl = btn.querySelector('.btn-label');
    if (discord) {
      if (lbl) lbl.textContent = discord.username || 'Connected';
      btn.classList.add('connected');
    } else {
      if (lbl) lbl.textContent = 'Discord';
      btn.classList.remove('connected');
    }
    updateAffiliate();
  }

  function updateAffiliate() {
    var panel = $('unav-affiliate');
    if (!panel) return;
    var canShow = address && discord;
    panel.classList.toggle('hidden', !canShow);
    if (!canShow) return;

    var createDiv = $('unav-aff-create');
    var displayDiv = $('unav-aff-display');
    var codeVal = $('unav-aff-code');
    var code = player && player.referral_code;
    var locked = player && player.referral_locked;

    if (code && locked) {
      if (createDiv) createDiv.style.display = 'none';
      if (displayDiv) displayDiv.style.display = 'flex';
      if (codeVal) codeVal.textContent = code;
    } else {
      if (createDiv) createDiv.style.display = 'flex';
      if (displayDiv) displayDiv.style.display = 'none';
    }
  }

  function setAffStatus(msg, cls) {
    var el = $('unav-aff-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'aff-status' + (cls ? ' ' + cls : '');
  }

  // --- Auth flows ---

  function connectWallet() {
    var ethereum = window.ethereum;
    if (!ethereum) {
      alert('No Ethereum wallet detected. Install MetaMask to connect.');
      return;
    }
    var btn = $('unav-wallet');
    if (btn) btn.disabled = true;

    ethereum.request({ method: 'eth_requestAccounts' })
      .then(function (accounts) {
        var addr = accounts && accounts[0];
        if (!addr) throw new Error('No account');
        address = addr;
        return api('/api/wallet/nonce', { method: 'POST', body: { address: addr } });
      })
      .then(function (resp) {
        return window.ethereum.request({
          method: 'personal_sign',
          params: [resp.message, address],
        });
      })
      .then(function (sig) {
        var ref = getRef();
        return api('/api/wallet/verify', {
          method: 'POST',
          body: { address: address, signature: sig, referrerCode: ref },
        });
      })
      .then(function (resp) {
        player = resp.player;
        address = player.eth_address;
        if (player.referrer_code) setRef(null);
        updateWalletBtn();
      })
      .catch(function (err) {
        console.warn('Wallet connect failed', err);
        address = null;
        updateWalletBtn();
      })
      .finally(function () {
        var btn = $('unav-wallet');
        if (btn) btn.disabled = false;
      });
  }

  function disconnectWallet() {
    api('/api/wallet/logout', { method: 'POST' }).catch(function () {});
    address = null;
    player = null;
    updateWalletBtn();
  }

  function checkDiscord() {
    fetch(API + '/auth/discord/me', { credentials: 'include' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        discord = data && data.user ? data.user : null;
        updateDiscordBtn();
      })
      .catch(function () {
        discord = null;
        updateDiscordBtn();
      });
  }

  function checkSession() {
    api('/api/player').then(function (data) {
      if (data && data.player) {
        player = data.player;
        address = player.eth_address || null;
        if (player.referrer_code) setRef(null);
        updateWalletBtn();
      }
    }).catch(function () {});
  }

  function disconnectDiscord() {
    fetch(API + '/auth/discord/logout', { method: 'POST', credentials: 'include' }).catch(function () {});
    discord = null;
    updateDiscordBtn();
  }

  // --- Affiliate ---

  function createAffiliate() {
    var input = $('unav-aff-input');
    var select = $('unav-aff-rakeback');
    if (!input) return;

    if (!address || !discord) {
      setAffStatus('Connect wallet + Discord first', 'error');
      return;
    }

    var code = input.value.trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{3,12}$/.test(code)) {
      setAffStatus('3-12 letters or numbers', 'error');
      return;
    }

    var bps = select ? parseInt(select.value, 10) : 0;
    var btn = $('unav-aff-create-btn');
    if (btn) btn.disabled = true;
    setAffStatus('Saving...', '');

    api('/api/affiliate/config', { method: 'POST', body: { code: code, rakebackBps: bps } })
      .then(function (resp) {
        if (player && resp.player) {
          player.referral_code = resp.player.referral_code;
          player.referral_locked = 1;
        }
        updateAffiliate();
        setAffStatus('Saved!', 'success');
        setTimeout(function () { setAffStatus(''); }, 1600);
      })
      .catch(function (err) {
        setAffStatus(err.message || 'Failed', 'error');
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  function copyAffLink() {
    var code = player && player.referral_code;
    if (!code) return;
    var link = window.location.origin + '/degenerette/?ref=' + code;
    var btn = $('unav-aff-copy');
    navigator.clipboard.writeText(link).then(function () {
      if (btn) {
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = 'Copy Link'; }, 1200);
      }
    }).catch(function () {});
  }

  // --- DOM creation ---

  function buildNav(currentPage) {
    var nav = document.createElement('nav');
    nav.className = 'unified-nav';

    var pages = [
      { key: 'degenerette', label: 'Degenerette', href: '/degenerette/' },
      { key: 'lootbox', label: 'Lootbox Sim', href: '/lootbox/' },
      { key: 'whitepaper', label: 'Whitepaper', href: '/whitepaper/' },
    ];

    // Left side
    var left = document.createElement('div');
    left.className = 'nav-left';

    var logo = document.createElement('a');
    logo.href = '/';
    logo.innerHTML = '<img class="nav-logo" src="/badges-circular/flame_red.svg" alt="Degenerus" />';
    left.appendChild(logo);

    var links = document.createElement('div');
    links.className = 'nav-links';
    pages.forEach(function (p) {
      var a = document.createElement('a');
      a.href = p.href;
      a.textContent = p.label;
      if (p.key === currentPage) a.className = 'active';
      links.appendChild(a);
    });
    left.appendChild(links);

    // Right side
    var right = document.createElement('div');
    right.className = 'nav-right';

    var auth = document.createElement('div');
    auth.className = 'nav-auth';

    // Discord button
    var dBtn = document.createElement('button');
    dBtn.id = 'unav-discord';
    dBtn.className = 'nav-btn nav-btn-discord';
    dBtn.innerHTML = DISCORD_SVG + '<span class="btn-label">Discord</span>';
    dBtn.addEventListener('click', function () {
      if (discord) disconnectDiscord();
      else window.location.href = API + '/auth/discord';
    });
    auth.appendChild(dBtn);

    // Wallet button
    var wBtn = document.createElement('button');
    wBtn.id = 'unav-wallet';
    wBtn.className = 'nav-btn nav-btn-wallet';
    wBtn.innerHTML = WALLET_SVG + '<span class="btn-label">Connect</span>';
    wBtn.addEventListener('click', function () {
      if (address) disconnectWallet();
      else connectWallet();
    });
    auth.appendChild(wBtn);
    right.appendChild(auth);

    // Affiliate panel
    var aff = document.createElement('div');
    aff.id = 'unav-affiliate';
    aff.className = 'nav-affiliate hidden';

    // Create mode
    var createDiv = document.createElement('div');
    createDiv.id = 'unav-aff-create';
    createDiv.style.display = 'flex';
    createDiv.style.alignItems = 'center';
    createDiv.style.gap = '0.4rem';

    var inp = document.createElement('input');
    inp.id = 'unav-aff-input';
    inp.type = 'text';
    inp.maxLength = 12;
    inp.placeholder = 'Affiliate code';
    inp.style.textTransform = 'uppercase';
    createDiv.appendChild(inp);

    var sel = document.createElement('select');
    sel.id = 'unav-aff-rakeback';
    [0, 500, 1000, 1500, 2000, 2500].forEach(function (bps) {
      var opt = document.createElement('option');
      opt.value = bps;
      opt.textContent = (bps / 100) + '% back';
      sel.appendChild(opt);
    });
    createDiv.appendChild(sel);

    var cBtn = document.createElement('button');
    cBtn.id = 'unav-aff-create-btn';
    cBtn.textContent = 'Create';
    cBtn.addEventListener('click', createAffiliate);
    createDiv.appendChild(cBtn);

    var status = document.createElement('span');
    status.id = 'unav-aff-status';
    status.className = 'aff-status';
    createDiv.appendChild(status);
    aff.appendChild(createDiv);

    // Display mode
    var displayDiv = document.createElement('div');
    displayDiv.id = 'unav-aff-display';
    displayDiv.className = 'aff-display';
    displayDiv.style.display = 'none';

    var codeSpan = document.createElement('span');
    codeSpan.innerHTML = 'Your Code: <strong id="unav-aff-code"></strong>';
    displayDiv.appendChild(codeSpan);

    var cpBtn = document.createElement('button');
    cpBtn.id = 'unav-aff-copy';
    cpBtn.textContent = 'Copy Link';
    cpBtn.addEventListener('click', copyAffLink);
    displayDiv.appendChild(cpBtn);

    aff.appendChild(displayDiv);
    right.appendChild(aff);

    nav.appendChild(left);
    nav.appendChild(right);
    return nav;
  }

  // --- Entry point ---

  window.initNav = function (config) {
    config = config || {};
    captureReferrer();

    var nav = buildNav(config.currentPage || '');

    // Insert at top of .container or .page or body
    var container = document.querySelector('.container') || document.querySelector('.page') || document.body;
    if (container.firstChild) {
      container.insertBefore(nav, container.firstChild);
    } else {
      container.appendChild(nav);
    }

    // Check existing sessions
    checkDiscord();
    checkSession();
  };
})();
