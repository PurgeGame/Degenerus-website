var F=Object.defineProperty;var r=(t,l)=>F(t,"name",{value:l,configurable:!0});import{mountSoundToggle as R}from"./app-sound-toggle.js";import{mountFeedbackButton as C}from"./app-feedback-button.js";import{readDegeneretteSpeed as W,writeDegeneretteSpeed as G}from"../app/degenerette-preferences.js";import{readAfkingLowFundWarningPreference as H,readAllInButtonPreference as U,readBiggestBountiesModePreference as V,readRevealAutoOpenPreference as K,readLightweightModePreference as $,writeLightweightModePreference as j,writeAfkingLowFundWarningPreference as Y,writeAllInButtonPreference as Z,writeBiggestBountiesModePreference as z,writeRevealAutoOpenPreference as J}from"../app/ui-preferences.js";import{subscribe as M}from"../app/store.js";const w="unav-settings",T="unav-settings-panel";function Q(){return`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.53-1H3v-4h.08A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.03 4.2l.06.06A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.03 1.53 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/>
    </svg>`}r(Q,"_gearIcon");function f(t,l,o,i){const c=!!i;t.classList.toggle("is-open",c),l.setAttribute("aria-expanded",c?"true":"false"),o.hidden=!c}r(f,"_setOpen");export function mountSettingsMenu(t=document){if(!t?.querySelector)return null;const l=t.getElementById?.(w)||t.querySelector(`#${w}`);if(l)return l.closest?.(".nav-settings")||l;const o=t.querySelector(".nav-auth");if(!o)return null;const i=t.nodeType===9?t:t.ownerDocument||document;R(t),C(t);const c=t.getElementById?.("unav-sound")||t.querySelector("#unav-sound"),y=t.getElementById?.("unav-feedback")||t.querySelector("#unav-feedback"),a=i.createElement("div");a.className="nav-settings";const n=i.createElement("button");n.type="button",n.id=w,n.className="nav-btn nav-settings__trigger",n.setAttribute("aria-label","Open player settings"),n.setAttribute("aria-haspopup","dialog"),n.setAttribute("aria-controls",T),n.setAttribute("aria-expanded","false"),n.title="Player settings",n.innerHTML=Q();const e=i.createElement("section");e.id=T,e.className="nav-settings__panel",e.setAttribute("role","dialog"),e.setAttribute("aria-modal","false"),e.setAttribute("aria-labelledby","unav-settings-title"),e.hidden=!0,e.innerHTML=`
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
    </div>`,a.append(n,e);const O=o.querySelector("#unav-discord"),P=o.querySelector("#unav-wallet-app")||o.querySelector("#unav-wallet");o.insertBefore(a,O||P||o.firstChild);const _=e.querySelector('[data-bind="settings-actions"]');c&&_?.appendChild(c),y&&_?.appendChild(y);const g=e.querySelector('[data-bind="settings-auto-reveals"]'),p=e.querySelector('[data-bind="settings-lightweight"]');p&&(p.checked=$(),p.addEventListener("change",()=>j(p.checked))),g&&(g.checked=K(),g.addEventListener("change",()=>J(g.checked)));const m=e.querySelector('[data-bind="settings-bounties-description"]'),S=[...e.querySelectorAll("[data-bounties-mode]")],k=r((s=V())=>{const d=s==="view"||s==="off"?s:"on";for(const I of S)I.setAttribute("aria-pressed",String(I.dataset.bountiesMode===d));m&&(m.textContent=d==="on"?"Show records and purchase shortcuts":d==="view"?"Show records without purchase shortcuts":"Hide the Biggest Bounties widget")},"paintBountyMode");k();for(const s of S)s.addEventListener("click",()=>{const d=z(s.dataset.bountiesMode);k(d)});const u=e.querySelector('[data-bind="settings-reveal-speed"]'),E=e.querySelector('[data-bind="settings-reveal-speed-value"]'),h=r(({persist:s=!1}={})=>{const d=Math.max(.5,Math.min(3,Number(u?.value)||1));E&&(E.textContent=`${d}×`),s&&G(d)},"paintSpeed");u&&(u.value=String(W()),h(),u.addEventListener("input",()=>h()),u.addEventListener("change",()=>h({persist:!0})));const b=e.querySelector('[data-bind="settings-afking-funding-warning"]');b&&(b.checked=H(),b.addEventListener("change",()=>{Y(b.checked)}));const L=e.querySelector('[data-bind="settings-afking-funding-warning-row"]'),D=M("app.afkingSubscription",s=>{L&&(L.hidden=s?.active!==!0)}),A=e.querySelector('[data-bind="settings-all-in-row"]'),v=e.querySelector('[data-bind="settings-all-in-button"]');v&&(v.checked=U(),v.addEventListener("change",()=>Z(v.checked)));const N=M("ui.allInEligible",s=>{A&&(A.hidden=s!==!0)});n.addEventListener("click",()=>{f(a,n,e,e.hidden),e.hidden||e.querySelector("input, button")?.focus?.()}),e.querySelector("[data-settings-close]")?.addEventListener("click",()=>{f(a,n,e,!1),n.focus?.()});const B=r(s=>{!e.hidden&&!a.contains(s.target)&&f(a,n,e,!1)},"onPointerDown"),q=r(s=>{s.key!=="Escape"||e.hidden||s.target?.closest?.(".feedback-overlay")||(f(a,n,e,!1),n.focus?.())},"onKeyDown");return i.addEventListener("pointerdown",B),i.addEventListener("keydown",q),a.destroySettingsMenu=()=>{D(),N(),i.removeEventListener("pointerdown",B),i.removeEventListener("keydown",q)},a}r(mountSettingsMenu,"mountSettingsMenu");function x(){if(mountSettingsMenu()||typeof MutationObserver!="function")return;const t=new MutationObserver(()=>{mountSettingsMenu()&&t.disconnect()});t.observe(document.documentElement,{childList:!0,subtree:!0})}r(x,"mountWhenReady"),typeof document<"u"&&(document.readyState==="loading"?document.addEventListener("DOMContentLoaded",x,{once:!0}):x());
//# sourceMappingURL=app-settings-menu.js.map
