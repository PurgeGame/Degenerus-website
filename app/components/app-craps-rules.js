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
          width: min(36rem, calc(100vw - 2rem));
          max-height: min(47rem, calc(100dvh - 2rem));
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
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 1rem;
          align-items: start;
          padding: 1.25rem 1.25rem 1rem;
          background:
            radial-gradient(circle at 8% 0%, rgba(218, 224, 235, 0.13), transparent 44%),
            linear-gradient(145deg, #151b24, #0c1016 72%);
          border-bottom: 1px solid #29313d;
        }

        .craps-rules__eyebrow {
          margin: 0 0 0.25rem;
          color: #aeb6c2;
          font: 700 0.67rem/1.2 system-ui, sans-serif;
          letter-spacing: 0.18em;
        }

        h2 {
          margin: 0;
          color: #fff;
          font: 800 clamp(1.25rem, 5vw, 1.65rem)/1.08 system-ui, sans-serif;
          letter-spacing: 0.02em;
        }

        #craps-rules-summary {
          margin: 0.5rem 0 0;
          color: #b9c0ca;
          font: 500 0.88rem/1.45 system-ui, sans-serif;
        }

        .craps-rules__close {
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
          gap: 0.85rem;
          margin: 0;
          padding: 0;
          list-style: none;
          counter-reset: rules-step;
        }

        .craps-rules__steps li {
          position: relative;
          min-height: 2.05rem;
          padding-left: 2.65rem;
          color: #c4cad3;
          font-size: 0.84rem;
          line-height: 1.45;
          counter-increment: rules-step;
        }

        .craps-rules__steps li > strong {
          display: block;
          margin-bottom: 0.08rem;
        }

        .craps-rules__steps li::before {
          content: counter(rules-step);
          position: absolute;
          left: 0;
          top: 0;
          display: grid;
          place-items: center;
          width: 1.9rem;
          height: 1.9rem;
          color: #0a0d12;
          background: #d9dee6;
          border-radius: 50%;
          font-size: 0.74rem;
          font-weight: 800;
        }

        strong {
          color: #f5f6f8;
        }

        .craps-rules__riu {
          margin: 1rem 0;
          padding: 0.85rem 0.9rem;
          color: #cbd1da;
          background:
            radial-gradient(circle at 100% 0%, rgba(108, 92, 231, 0.18), transparent 45%),
            #131923;
          border: 1px solid #465164;
          border-radius: 9px;
          font-size: 0.8rem;
          line-height: 1.45;
        }

        .craps-rules__riu h3 {
          margin: 0 0 0.45rem;
          color: #fff;
          font-size: 0.72rem;
          letter-spacing: 0.13em;
        }

        .craps-rules__riu p {
          margin: 0;
        }

        .craps-rules__riu p + p {
          margin-top: 0.55rem;
        }

        .craps-rules__settlement {
          margin: 0;
          padding: 0.75rem 0.8rem;
          color: #c5cbd3;
          background: rgba(219, 225, 234, 0.06);
          border-left: 3px solid #cdd3dc;
          font-size: 0.79rem;
          line-height: 1.45;
        }

        .craps-rules__actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          margin-top: 1rem;
        }

        .craps-rules__risk {
          margin: 0;
          color: #89929e;
          font-size: 0.68rem;
          line-height: 1.35;
        }

        .craps-rules__learn {
          flex: 0 0 auto;
          color: #090c10;
          background: #e1e5eb;
          border-radius: 7px;
          padding: 0.62rem 0.85rem;
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
            padding-left: 1rem;
            padding-right: 1rem;
          }

          .craps-rules__actions {
            align-items: stretch;
            flex-direction: column;
          }

          .craps-rules__learn {
            text-align: center;
          }
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
          <div>
            <p class="craps-rules__eyebrow">HOW IT WORKS</p>
            <h2 id="craps-rules-title">CRAPS AUTOBATTLE</h2>
            <p id="craps-rules-summary">Build once. Every entry plays the same dice. Best run wins.</p>
          </div>
          <button class="craps-rules__close" type="button" aria-label="Close Craps rules">&times;</button>
        </header>

        <div class="craps-rules__body">
          <ol class="craps-rules__steps">
            <li><strong>Build a 10-chip board.</strong> Choose zero through seven chips, with no more than three per spot. Random chips fill the rest.</li>
            <li><strong>The bet doubles every three shooters.</strong> Everyone gets the same dice, and your board repeats. Your bankroll starts at 5× the initial board bet. If you cannot cover the next bet but have at least half, you get a survival flip; below half is a Bust.</li>
            <li><strong>Reach Goal, then climb.</strong> Reaching 5× your starting bankroll locks Goal; the run continues to set a high point. Goals beat Busts. Highest Goal wins; if all Bust, the longest run wins.</li>
          </ol>

          <section class="craps-rules__riu" aria-labelledby="craps-rules-riu-title">
            <h3 id="craps-rules-riu-title">HOW TO WIN RUN IT UP</h3>
            <p>Win a scheduled battle&rsquo;s main field with a Goal whose high point reaches <strong>25× starting bankroll</strong>. A <strong>120× rare tier</strong> pays a larger share. It is automatic&mdash;there is no second draw.</p>
            <p>The seventh battle is the daily Event and pays a larger share. If the Event winner also has an earlier Goal win that day, the Event share doubles.</p>
          </section>

          <p class="craps-rules__settlement"><strong>Settlement:</strong> Goal returns and prizes become Coinflip credit; a Bust run returns zero. Activity standing can reduce Run It Up and other protocol-funded awards.</p>

          <div class="craps-rules__actions">
            <p class="craps-rules__risk">Entry burns FLIP and can be lost in full.</p>
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
