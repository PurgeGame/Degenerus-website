var W=Object.defineProperty;var r=(n,d)=>W(n,"name",{value:d,configurable:!0});import{mountSoundToggle as G}from"./app-sound-toggle.js";import{mountFeedbackButton as U}from"./app-feedback-button.js";import{readDegeneretteSpeed as V,writeDegeneretteSpeed as K}from"../app/degenerette-preferences.js";import{readAfkingLowFundWarningPreference as $,readAllInButtonPreference as j,readMineFlipButtonPreference as Y,readHideBalancesPreference as Z,readBiggestBountiesModePreference as z,readRevealAutoOpenPreference as J,readLightweightModePreference as Q,writeLightweightModePreference as X,writeAfkingLowFundWarningPreference as ee,writeAllInButtonPreference as te,writeMineFlipButtonPreference as ne,writeHideBalancesPreference as se,writeBiggestBountiesModePreference as ae,writeRevealAutoOpenPreference as ie}from"../app/ui-preferences.js";import{subscribe as O}from"../app/store.js";const _="unav-settings",x="unav-settings-panel";function re(){return`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.53-1H3v-4h.08A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.03 4.2l.06.06A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.03 1.53 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/>
    </svg>`}r(re,"_gearIcon");function f(n,d,l,o){const c=!!o;n.classList.toggle("is-open",c),d.setAttribute("aria-expanded",c?"true":"false"),l.hidden=!c}r(f,"_setOpen");export function mountSettingsMenu(n=document){if(!n?.querySelector)return null;const d=n.getElementById?.(_)||n.querySelector(`#${_}`);if(d)return d.closest?.(".nav-settings")||d;const l=n.querySelector(".nav-auth");if(!l)return null;const o=n.nodeType===9?n:n.ownerDocument||document;G(n),U(n);const c=n.getElementById?.("unav-sound")||n.querySelector("#unav-sound"),y=n.getElementById?.("unav-feedback")||n.querySelector("#unav-feedback"),i=o.createElement("div");i.className="nav-settings";const s=o.createElement("button");s.type="button",s.id=_,s.className="nav-btn nav-settings__trigger",s.setAttribute("aria-label","Open player settings"),s.setAttribute("aria-haspopup","dialog"),s.setAttribute("aria-controls",x),s.setAttribute("aria-expanded","false"),s.title="Player settings",s.innerHTML=re();const e=o.createElement("section");e.id=x,e.className="nav-settings__panel",e.setAttribute("role","dialog"),e.setAttribute("aria-modal","false"),e.setAttribute("aria-labelledby","unav-settings-title"),e.hidden=!0,e.innerHTML=`
    <header class="nav-settings__head">
      <span>
        <small>PLAYER</small>
        <strong id="unav-settings-title">SETTINGS</strong>
      </span>
      <button type="button" class="nav-settings__close" data-settings-close
              aria-label="Close player settings">×</button>
    </header>
    <div class="nav-settings__body">
      <div class="nav-settings__actions" data-bind="settings-actions"></div>
      <label class="nav-settings__row nav-settings__row--toggle">
        <span class="nav-settings__copy">
          <strong>LIGHTWEIGHT MODE</strong>
          <small>Reduce background effects and load ticket details when needed</small>
        </span>
        <input type="checkbox" data-bind="settings-lightweight">
        <i class="nav-settings__switch" aria-hidden="true"></i>
      </label>
      <label class="nav-settings__row nav-settings__row--toggle">
        <span class="nav-settings__copy">
          <strong>AUTO REVEALS</strong>
          <small>Open ready results automatically</small>
        </span>
        <input type="checkbox" data-bind="settings-auto-reveals">
        <i class="nav-settings__switch" aria-hidden="true"></i>
      </label>
      <label class="nav-settings__row nav-settings__row--toggle">
        <span class="nav-settings__copy">
          <strong>MINE FLIP BUTTON</strong>
          <small>Show Mine FLIP when work is ready</small>
        </span>
        <input type="checkbox" data-bind="settings-mine-flip-button">
        <i class="nav-settings__switch" aria-hidden="true"></i>
      </label>
      <div class="nav-settings__row nav-settings__row--three-way">
        <span class="nav-settings__copy">
          <strong>HIDE BALANCES</strong>
          <small data-bind="settings-hide-balances-description">Show balance amounts</small>
        </span>
        <span class="nav-settings__three-way" role="group" aria-label="Blur balance amounts">
          <button type="button" data-hide-balances="none" aria-pressed="false">NO</button>
          <button type="button" data-hide-balances="eth" aria-pressed="false">ETH</button>
          <button type="button" data-hide-balances="both" aria-pressed="false">BOTH</button>
        </span>
      </div>
      <div class="nav-settings__row nav-settings__row--three-way">
        <span class="nav-settings__copy">
          <strong>BIGGEST BOUNTIES</strong>
          <small data-bind="settings-bounties-description">Show records and purchase shortcuts</small>
        </span>
        <span class="nav-settings__three-way" role="group"
              aria-label="Biggest Bounties visibility and interaction">
          <button type="button" data-bounties-mode="on" aria-pressed="false">ON</button>
          <button type="button" data-bounties-mode="view" aria-pressed="false">VIEW</button>
          <button type="button" data-bounties-mode="off" aria-pressed="false">OFF</button>
        </span>
      </div>
      <label class="nav-settings__row nav-settings__row--speed">
        <span class="nav-settings__copy">
          <strong>DEFAULT SPEED</strong>
          <small>Reveal animation pace</small>
        </span>
        <span class="nav-settings__speed-control">
          <input type="range" min="0.5" max="3" step="0.5"
                 data-bind="settings-reveal-speed" aria-label="Default reveal speed">
          <output data-bind="settings-reveal-speed-value">1×</output>
        </span>
      </label>
      <label class="nav-settings__row nav-settings__row--toggle"
             data-bind="settings-afking-funding-warning-row" hidden>
        <span class="nav-settings__copy">
          <strong>AFKING FUNDING ALERT</strong>
          <small>Warn when fewer than 7 funded days remain</small>
        </span>
        <input type="checkbox" data-bind="settings-afking-funding-warning">
        <i class="nav-settings__switch" aria-hidden="true"></i>
      </label>
      <label class="nav-settings__row nav-settings__row--toggle"
             data-bind="settings-all-in-row" hidden>
        <span class="nav-settings__copy">
          <strong>ALL IN BUTTON</strong>
          <small>Show the eligible purchase shortcut</small>
        </span>
        <input type="checkbox" data-bind="settings-all-in-button">
        <i class="nav-settings__switch" aria-hidden="true"></i>
      </label>
    </div>`,i.append(s,e);const F=l.querySelector("#unav-discord"),H=l.querySelector("#unav-wallet-app")||l.querySelector("#unav-wallet");l.insertBefore(i,F||H||l.firstChild);const m=e.querySelector('[data-bind="settings-actions"]');c&&m?.appendChild(c),y&&m?.appendChild(y);const g=e.querySelector('[data-bind="settings-auto-reveals"]'),p=e.querySelector('[data-bind="settings-lightweight"]');p&&(p.checked=Q(),p.addEventListener("change",()=>X(p.checked))),g&&(g.checked=J(),g.addEventListener("change",()=>ie(g.checked)));const b=e.querySelector('[data-bind="settings-mine-flip-button"]');b&&(b.checked=Y(),b.addEventListener("change",()=>ne(b.checked)));const S=e.querySelector('[data-bind="settings-bounties-description"]'),E=e.querySelector('[data-bind="settings-hide-balances-description"]'),k=[...e.querySelectorAll("[data-hide-balances]")],L=r((t=Z())=>{for(const a of k)a.setAttribute("aria-pressed",String(a.dataset.hideBalances===t));E&&(E.textContent=t==="both"?"Blur ETH and FLIP amounts":t==="eth"?"Blur ETH amounts":"Show balance amounts")},"paintBalanceMode");L();for(const t of k)t.addEventListener("click",()=>{L(se(t.dataset.hideBalances))});const A=[...e.querySelectorAll("[data-bounties-mode]")],B=r((t=z())=>{const a=t==="view"||t==="off"?t:"on";for(const N of A)N.setAttribute("aria-pressed",String(N.dataset.bountiesMode===a));S&&(S.textContent=a==="on"?"Show records and purchase shortcuts":a==="view"?"Show records without purchase shortcuts":"Hide the Biggest Bounties widget")},"paintBountyMode");B();for(const t of A)t.addEventListener("click",()=>{const a=ae(t.dataset.bountiesMode);B(a)});const u=e.querySelector('[data-bind="settings-reveal-speed"]'),I=e.querySelector('[data-bind="settings-reveal-speed-value"]'),w=r(({persist:t=!1}={})=>{const a=Math.max(.5,Math.min(3,Number(u?.value)||1));I&&(I.textContent=`${a}×`),t&&K(a)},"paintSpeed");u&&(u.value=String(V()),w(),u.addEventListener("input",()=>w()),u.addEventListener("change",()=>w({persist:!0})));const h=e.querySelector('[data-bind="settings-afking-funding-warning"]');h&&(h.checked=$(),h.addEventListener("change",()=>{ee(h.checked)}));const M=e.querySelector('[data-bind="settings-afking-funding-warning-row"]'),C=O("app.afkingSubscription",t=>{M&&(M.hidden=t?.active!==!0)}),q=e.querySelector('[data-bind="settings-all-in-row"]'),v=e.querySelector('[data-bind="settings-all-in-button"]');v&&(v.checked=j(),v.addEventListener("change",()=>te(v.checked)));const R=O("ui.allInEligible",t=>{q&&(q.hidden=t!==!0)});s.addEventListener("click",()=>{f(i,s,e,e.hidden),e.hidden||e.querySelector("input, button")?.focus?.()}),e.querySelector("[data-settings-close]")?.addEventListener("click",()=>{f(i,s,e,!1),s.focus?.()});const T=r(t=>{!e.hidden&&!i.contains(t.target)&&f(i,s,e,!1)},"onPointerDown"),P=r(t=>{t.key!=="Escape"||e.hidden||t.target?.closest?.(".feedback-overlay")||(f(i,s,e,!1),s.focus?.())},"onKeyDown");return o.addEventListener("pointerdown",T),o.addEventListener("keydown",P),i.destroySettingsMenu=()=>{C(),R(),o.removeEventListener("pointerdown",T),o.removeEventListener("keydown",P)},i}r(mountSettingsMenu,"mountSettingsMenu");function D(){if(mountSettingsMenu()||typeof MutationObserver!="function")return;const n=new MutationObserver(()=>{mountSettingsMenu()&&n.disconnect()});n.observe(document.documentElement,{childList:!0,subtree:!0})}r(D,"mountWhenReady"),typeof document<"u"&&(document.readyState==="loading"?document.addEventListener("DOMContentLoaded",D,{once:!0}):D());
//# sourceMappingURL=app-settings-menu.js.map
