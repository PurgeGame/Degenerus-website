// A compact, dependency-free rules overlay for the Craps launcher. Keeping it
// separate from app-craps-entry means opening help cannot disturb live board or
// entry state.

export class AppCrapsRules extends HTMLElement {
  #dialog = null;
  #listeners = null;
  #returnFocus = null;

  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = this.#template();
    }

    this.#dialog = this.shadowRoot.querySelector('#craps-rules-dialog');
    this.#wireEvents();
    this.removeAttribute('hidden');
  }

  disconnectedCallback() {
    this.#listeners?.abort();
    this.#listeners = null;
  }

  open(trigger = null) {
    const dialog = this.#dialog;
    if (!dialog || dialog.hasAttribute('open')) return;
    this.#returnFocus = trigger ?? this.ownerDocument?.activeElement ?? null;
    this.shadowRoot.querySelector('.craps-rules__body').scrollTop = 0;

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }

    this.shadowRoot.querySelector('.craps-rules__close')?.focus();
  }

  close() {
    const dialog = this.#dialog;
    if (!dialog) return;

    if (typeof dialog.close === 'function' && dialog.hasAttribute('open')) {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
    this.#returnFocus?.focus?.();
  }

  #wireEvents() {
    this.#listeners?.abort();
    this.#listeners = new AbortController();
    const { signal } = this.#listeners;

    this.ownerDocument?.addEventListener('craps-rules:open', (event) => {
      this.open(event?.detail?.trigger);
    }, { signal });
    this.shadowRoot.querySelector('.craps-rules__close')
      ?.addEventListener('click', () => this.close(), { signal });

    this.#dialog?.addEventListener('click', (event) => {
      if (event.target !== this.#dialog) return;
      const rect = this.#dialog.getBoundingClientRect();
      const outside = event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom;
      if (outside) this.close();
    }, { signal });

    this.#dialog?.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    }, { signal });

    this.#dialog?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    }, { signal });

    this.#dialog?.addEventListener('close', () => {
      this.#returnFocus?.focus?.();
    }, { signal });
  }

  #template() {
    return `
      <style>
        :host {
          grid-area: craps;
          width: 0;
          height: 0;
          z-index: 12;
          pointer-events: none;
        }

        [hidden] {
          display: none !important;
        }

        dialog {
          pointer-events: auto;
          position: fixed;
          inset: 0;
          box-sizing: border-box;
          width: min(52rem, calc(100vw - 2rem));
          max-height: calc(100dvh - 2rem);
          margin: auto;
          padding: 0;
          overflow: hidden;
          color: #e8ebef;
          background: #0c1016;
          border: 1px solid #47515f;
          border-radius: 14px;
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.72),
            inset 0 1px rgba(255, 255, 255, 0.05);
        }

        dialog[open] {
          display: flex;
          flex-direction: column;
          animation: craps-rules-in 170ms ease-out;
        }

        dialog::backdrop {
          background: rgba(1, 3, 7, 0.78);
          backdrop-filter: blur(3px);
        }

        .craps-rules__head {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1fr);
          gap: 1rem;
          align-items: center;
          padding: 1rem 1.25rem 0.75rem;
          background:
            radial-gradient(circle at 8% 0%, rgba(218, 224, 235, 0.13), transparent 44%),
            linear-gradient(145deg, #151b24, #0c1016 72%);
          border-bottom: 1px solid #29313d;
        }

        h2 {
          display: contents;
          margin: 0;
          color: #fff;
          font: 800 clamp(0.8rem, 2.8vw, 1rem)/1.1 system-ui, sans-serif;
          white-space: nowrap;
        }

        .craps-rules__logo {
          grid-column: 2;
          justify-self: center;
          width: 100%;
          max-width: 18rem;
          height: auto;
        }

        #craps-rules-summary {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: 1.1fr 1.4fr 0.55fr;
          gap: 0.75rem;
          margin: 0.25rem 0 0;
          padding: 0.65rem 0.75rem;
          border: 1px solid rgba(245, 202, 98, 0.24);
          border-radius: 8px;
          background:
            radial-gradient(ellipse at 50% 0%, rgba(245, 202, 98, 0.11), transparent 75%),
            linear-gradient(135deg, #1b2028, #10141b);
          box-shadow: inset 0 1px rgba(255, 255, 255, 0.04);
          list-style: none;
          font: 800 0.85rem/1.3 system-ui, sans-serif;
        }

        #craps-rules-summary li { min-width: 0; text-align: center; }
        .craps-rules__first-step { display: inline-block; }
        #craps-rules-summary small {
          display: block;
          margin-top: 0.2rem;
          color: #aeb6c2;
          font-size: 0.8em;
          font-weight: 500;
        }

        .craps-rules__close {
          grid-column: 3;
          justify-self: end;
          display: grid;
          place-items: center;
          width: 2rem;
          height: 2rem;
          padding: 0;
          color: #ccd2da;
          background: #0a0e14;
          border: 1px solid #3c4653;
          border-radius: 999px;
          font: 400 1.25rem/1 system-ui, sans-serif;
          cursor: pointer;
        }

        .craps-rules__close:hover,
        .craps-rules__close:focus-visible {
          color: #fff;
          border-color: #e2e6ec;
          outline: none;
        }

        .craps-rules__body {
          overflow: auto;
          overscroll-behavior: contain;
          padding: 1rem 1.25rem 1.25rem;
          font-family: system-ui, sans-serif;
          scrollbar-color: #555e6b #11161d;
        }

        .craps-rules__steps {
          display: grid;
          gap: 0.65rem;
          margin: 0;
          padding: 0;
          list-style: none;
        }

        .craps-rules__steps section {
          position: relative;
          min-height: 2.05rem;
          color: #c4cad3;
          font-size: 0.84rem;
          line-height: 1.4;
        }

        .craps-rules__steps section > strong {
          display: block;
          margin-bottom: 0.08rem;
        }

        .craps-rules__steps p {
          margin: 0.35rem 0 0;
        }

        .craps-rules__steps p + p {
          margin-top: 0.5rem;
        }

        .craps-rules__hot-shooter {
          color: #f5ca62;
        }

        strong {
          color: #f5f6f8;
        }

        .craps-rules__actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 1rem;
          margin-top: 0.65rem;
        }

        .craps-rules__learn {
          flex: 0 0 auto;
          color: #090c10;
          background: #e1e5eb;
          border-radius: 7px;
          padding: 0.4rem 0.75rem;
          font-size: 0.76rem;
          font-weight: 800;
          text-decoration: none;
          white-space: nowrap;
        }

        .craps-rules__learn:hover,
        .craps-rules__learn:focus-visible {
          background: #fff;
          outline: 2px solid #fff;
          outline-offset: 2px;
        }

        @keyframes craps-rules-in {
          from { opacity: 0; transform: translateY(8px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @media (max-width: 520px) {
          dialog {
            width: calc(100vw - 1rem);
            max-height: calc(100dvh - 1rem);
            border-radius: 11px;
          }

          .craps-rules__head,
          .craps-rules__body {
            padding: 0.65rem 0.85rem;
          }

          .craps-rules__head { gap: 0.65rem 0.4rem; }
          h2 { font-size: 0.72rem; }
          .craps-rules__close { grid-column: 3; grid-row: 1; }
          #craps-rules-summary {
            gap: 0.4rem;
            margin-top: 0;
            padding: 0.55rem 0.4rem;
            font-size: 0.62rem;
          }
          .craps-rules__steps section {
            font-size: clamp(0.7rem, 1.42dvh, 0.78rem);
            line-height: 1.32;
          }
          .craps-rules__steps { gap: 0.5rem; }
          .craps-rules__steps p { margin-top: 0.2rem; }
          .craps-rules__steps p + p { margin-top: 0.35rem; }
          .craps-rules__actions { margin-top: 0.5rem; }
          .craps-rules__learn { font-size: 0.7rem; padding: 0.3rem 0.6rem; }
        }


        @media (prefers-reduced-motion: reduce) {
          dialog[open] {
            animation: none;
          }

        }
      </style>

      <dialog
        id="craps-rules-dialog"
        aria-labelledby="craps-rules-title"
        aria-describedby="craps-rules-summary"
      >
        <header class="craps-rules__head">
          <h2 id="craps-rules-title"><span>HOW TO PLAY</span>
            <img class="craps-rules__logo" src="/app/assets/craps/craps-autobattle-integrated-swords-v8.webp" width="2025" height="466" alt="Craps Autobattle">
          </h2>
          <button class="craps-rules__close" type="button" aria-label="Close Craps rules">&times;</button>
          <ol id="craps-rules-summary">
            <li><span class="craps-rules__first-step">1. PLACE YOUR BETS<small>or play random</small></span></li>
            <li>2. BUY INTO A TOURNAMENT</li>
            <li>3. WIN?</li>
          </ol>
        </header>

        <div class="craps-rules__body">
          <div class="craps-rules__steps">
            <section>
              <strong>PLACE YOUR BETS.</strong>
              <p>Place between 0 and 7 chips on the simplified craps table, with 3 max per spot. Your final board will include your selections, plus enough random bets for a total of 10 chips bet. Allowing more of your bets to be assigned randomly increases your chances of receiving a <strong class="craps-rules__hot-shooter">Hot Shooter</strong> bonus.</p>
            </section>
            <section>
              <strong>REACH THE GOAL.</strong>
              <p>Your bets will be played automatically until your run is over. The goal is to run your stack up to 5× your starting bankroll. Every 3 shooters, all bets are doubled. After a 7-out, if you cannot cover the next betting round, you are at risk. If you have less than half a bet, you bust; if you have at least half a bet, you receive a double-or-nothing survival flip that will allow you to continue half the time.</p>
              <p>After reaching the goal, that amount is locked in. You keep playing with the winnings above it until they can no longer cover the next bet, then you keep your remaining stack, including the protected goal amount.</p>
            </section>
            <section>
              <strong>WIN THE BATTLE.</strong>
              <p>There are two ways to win a Craps Autobattle. If the goal is met by any player, then whoever achieves the highest peak wins the prize. If no player reaches the goal, then the one who lasts the longest is declared the winner.</p>
            </section>
            <section aria-labelledby="craps-rules-riu-title">
              <strong id="craps-rules-riu-title">RUN IT UP.</strong>
              <p>Win the main Battle and reach a peak of at least <strong>25× your starting bankroll</strong> to claim a share of the Run It Up progressive jackpot. Reach <strong>120×</strong> for a bigger payout, with the biggest shares awarded in the daily Event.</p>
            </section>
          </div>

          <div class="craps-rules__actions">
            <a class="craps-rules__learn" href="/learn/craps/">Full rules</a>
          </div>
        </div>
      </dialog>
    `;
  }
}

if (!customElements.get('app-craps-rules')) {
  customElements.define('app-craps-rules', AppCrapsRules);
}
