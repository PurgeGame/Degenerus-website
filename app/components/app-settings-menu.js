var P=Object.defineProperty;var r=(t,l)=>P(t,"name",{value:l,configurable:!0});import{mountSoundToggle as F}from"./app-sound-toggle.js";import{mountFeedbackButton as R}from"./app-feedback-button.js";import{readDegeneretteSpeed as C,writeDegeneretteSpeed as W}from"../app/degenerette-preferences.js";import{readAfkingLowFundWarningPreference as U,readAllInButtonPreference as G,readBiggestBountiesModePreference as H,readRevealAutoOpenPreference as V,writeAfkingLowFundWarningPreference as K,writeAllInButtonPreference as $,writeBiggestBountiesModePreference as j,writeRevealAutoOpenPreference as Y}from"../app/ui-preferences.js";import{subscribe as I}from"../app/store.js";const h="unav-settings",M="unav-settings-panel";function Z(){return`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.53-1H3v-4h.08A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.03 4.2l.06.06A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.03 1.53 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/>
    </svg>`}r(Z,"_gearIcon");function v(t,l,o,i){const c=!!i;t.classList.toggle("is-open",c),l.setAttribute("aria-expanded",c?"true":"false"),o.hidden=!c}r(v,"_setOpen");export function mountSettingsMenu(t=document){if(!t?.querySelector)return null;const l=t.getElementById?.(h)||t.querySelector(`#${h}`);if(l)return l.closest?.(".nav-settings")||l;const o=t.querySelector(".nav-auth");if(!o)return null;const i=t.nodeType===9?t:t.ownerDocument||document;F(t),R(t);const c=t.getElementById?.("unav-sound")||t.querySelector("#unav-sound"),y=t.getElementById?.("unav-feedback")||t.querySelector("#unav-feedback"),a=i.createElement("div");a.className="nav-settings";const n=i.createElement("button");n.type="button",n.id=h,n.className="nav-btn nav-settings__trigger",n.setAttribute("aria-label","Open player settings"),n.setAttribute("aria-haspopup","dialog"),n.setAttribute("aria-controls",M),n.setAttribute("aria-expanded","false"),n.title="Player settings",n.innerHTML=Z();const e=i.createElement("section");e.id=M,e.className="nav-settings__panel",e.setAttribute("role","dialog"),e.setAttribute("aria-modal","false"),e.setAttribute("aria-labelledby","unav-settings-title"),e.hidden=!0,e.innerHTML=`
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
          <strong>AUTO REVEALS</strong>
          <small>Open ready results automatically</small>
        </span>
        <input type="checkbox" data-bind="settings-auto-reveals">
        <i class="nav-settings__switch" aria-hidden="true"></i>
      </label>
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
    </div>`,a.append(n,e);const x=o.querySelector("#unav-discord"),N=o.querySelector("#unav-wallet-app")||o.querySelector("#unav-wallet");o.insertBefore(a,x||N||o.firstChild);const m=e.querySelector('[data-bind="settings-actions"]');c&&m?.appendChild(c),y&&m?.appendChild(y);const g=e.querySelector('[data-bind="settings-auto-reveals"]');g&&(g.checked=V(),g.addEventListener("change",()=>Y(g.checked)));const w=e.querySelector('[data-bind="settings-bounties-description"]'),_=[...e.querySelectorAll("[data-bounties-mode]")],S=r((s=H())=>{const d=s==="view"||s==="off"?s:"on";for(const q of _)q.setAttribute("aria-pressed",String(q.dataset.bountiesMode===d));w&&(w.textContent=d==="on"?"Show records and purchase shortcuts":d==="view"?"Show records without purchase shortcuts":"Hide the Biggest Bounties widget")},"paintBountyMode");S();for(const s of _)s.addEventListener("click",()=>{const d=j(s.dataset.bountiesMode);S(d)});const u=e.querySelector('[data-bind="settings-reveal-speed"]'),E=e.querySelector('[data-bind="settings-reveal-speed-value"]'),f=r(({persist:s=!1}={})=>{const d=Math.max(.5,Math.min(3,Number(u?.value)||1));E&&(E.textContent=`${d}×`),s&&W(d)},"paintSpeed");u&&(u.value=String(C()),f(),u.addEventListener("input",()=>f()),u.addEventListener("change",()=>f({persist:!0})));const p=e.querySelector('[data-bind="settings-afking-funding-warning"]');p&&(p.checked=U(),p.addEventListener("change",()=>{K(p.checked)}));const k=e.querySelector('[data-bind="settings-afking-funding-warning-row"]'),O=I("app.afkingSubscription",s=>{k&&(k.hidden=s?.active!==!0)}),A=e.querySelector('[data-bind="settings-all-in-row"]'),b=e.querySelector('[data-bind="settings-all-in-button"]');b&&(b.checked=G(),b.addEventListener("change",()=>$(b.checked)));const D=I("ui.allInEligible",s=>{A&&(A.hidden=s!==!0)});n.addEventListener("click",()=>{v(a,n,e,e.hidden),e.hidden||e.querySelector("input, button")?.focus?.()}),e.querySelector("[data-settings-close]")?.addEventListener("click",()=>{v(a,n,e,!1),n.focus?.()});const L=r(s=>{!e.hidden&&!a.contains(s.target)&&v(a,n,e,!1)},"onPointerDown"),B=r(s=>{s.key!=="Escape"||e.hidden||s.target?.closest?.(".feedback-overlay")||(v(a,n,e,!1),n.focus?.())},"onKeyDown");return i.addEventListener("pointerdown",L),i.addEventListener("keydown",B),a.destroySettingsMenu=()=>{O(),D(),i.removeEventListener("pointerdown",L),i.removeEventListener("keydown",B)},a}r(mountSettingsMenu,"mountSettingsMenu");function T(){if(mountSettingsMenu()||typeof MutationObserver!="function")return;const t=new MutationObserver(()=>{mountSettingsMenu()&&t.disconnect()});t.observe(document.documentElement,{childList:!0,subtree:!0})}r(T,"mountWhenReady"),typeof document<"u"&&(document.readyState==="loading"?document.addEventListener("DOMContentLoaded",T,{once:!0}):T());
//# sourceMappingURL=app-settings-menu.js.map
