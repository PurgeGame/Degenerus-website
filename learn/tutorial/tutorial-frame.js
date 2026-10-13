import { queueReveal, buildPaperTicket } from '/app/components/reveal-overlay.js';
import { paintTutorialGame } from './tutorial-presentation.js?v=22';
import { __resetPendingActionsForTest as resetPendingActions } from '/app/app/pending-actions.js';
import { __resetForTest as stopLiveWriteManager } from '/app/components/view-mode-banner.js';
import { stop as stopAppPolling } from '/app/app/polling.js';
import { stopDayRollover } from '/app/app/day-rollover.js';
import { stopPackWatch } from '/app/app/pack-watch.js';
import { stopBingoWatch } from '/app/app/bingo-watch.js';
import { stopWhalePassClaims } from '/app/app/whale-pass-claims.js';
import { setMuted } from '/app/app/jackpot-sfx.js';
// These panels are now lazy in the app. The lesson needs them constructed
// before it freezes the frame, even when they start outside the viewport.
import '/app/components/app-decimator-panel.js';
import '/app/components/app-daily-flip.js';
import '/app/components/app-quest-panel.js';
import '/app/components/app-reveal-tray.js';
import '/app/components/replay-panel.js';

// The tutorial frame is a stable training surface, not a second live dashboard.
// main.js also owns several self-contained day/claim watchers outside the
// central polling module; stop every one of them. Leaving those alive meant
// each old tutorial tab kept hitting the shared API indefinitely and could
// rate-limit the real jackpot page at the next day boundary.
stopAppPolling();
stopDayRollover();
stopPackWatch();
stopBingoWatch();
stopWhalePassClaims();
// The parent owns every practice click. Release live wallet gating while
// keeping data-write attributes, which the normal Buy In styling also uses.
stopLiveWriteManager();

// The parent tutorial owns only scripted state. Expose the production reveal
// queue so ticket packs use the same full-screen presentation as the app.
let revealGuard = null;

function queueTutorialReveal(sequence) {
  // This frame is a disposable training realm. Its app components can still
  // discover permissionless/live reminders, but those must never become a
  // NEXT action after a scripted reward.
  resetPendingActions();
  if (revealGuard != null) window.clearInterval(revealGuard);
  revealGuard = window.setInterval(() => {
    if (!document.documentElement.classList.contains('tutorial-reveal-active')) {
      window.clearInterval(revealGuard);
      revealGuard = null;
      return;
    }
    resetPendingActions();
  }, 120);
  return queueReveal(sequence);
}

window.__DEGENERUS_TUTORIAL_REVEAL__ = Object.freeze({
  queueReveal: queueTutorialReveal,
  paintGame: paintTutorialGame,
  buildPaperTicket,
  clearLivePending: resetPendingActions,
  setSound: enabled => setMuted(!enabled),
});
window.dispatchEvent(new CustomEvent('degenerus:tutorial-reveal-ready'));
