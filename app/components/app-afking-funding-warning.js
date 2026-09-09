var b=Object.defineProperty;var a=(t,e)=>b(t,"name",{value:e,configurable:!0});import{get as u,subscribe as c}from"../app/store.js";import{lock as m,unlock as f}from"../app/scroll-lock.js";import{readAfkingLowFundWarningPreference as p,subscribeUiPreferences as k}from"../app/ui-preferences.js";export const AFKING_LOW_FUND_THRESHOLD_DAYS=7n;function d(t){return String(t||"").trim().toLowerCase()||null}a(d,"normalizedAddress");function h(t){try{const e=BigInt(t);return e>=0n?e:null}catch{return null}}a(h,"parsedDays");export function isBlockingModal(t,e){if(!t||t===e||e?.contains?.(t))return!1;for(let n=t;n;n=n.parentElement)if(n.hidden===!0||n.hasAttribute?.("hidden")||n.getAttribute?.("aria-hidden")==="true"||n.inert===!0)return!1;return!0}a(isBlockingModal,"isBlockingModal");export function afkingFundingWarningModel({snapshot:t,connectedAddress:e,mode:n="self",enabled:i=!0}={}){const s=d(e),r=d(t?.address),o=h(t?.fundedDays);if(!!!(i&&s&&n==="self"&&t?.known===!0&&t?.active===!0&&r===s&&o!=null&&o<AFKING_LOW_FUND_THRESHOLD_DAYS))return Object.freeze({visible:!1});const l=Math.max(1,Math.trunc(Number(t?.dailyQuantity)||1)),g=t?.settingsKnown?t?.useTickets?l===1?"TICKET":"TICKETS":"LUCKBOX":l===1?"ITEM":"ITEMS";return Object.freeze({visible:!0,address:s,days:o,daysLabel:`${o} DAY${o===1n?"":"S"} FUNDED`,orderLabel:`${l} ${g} / DAY`,fundedSegments:Number(o)})}a(afkingFundingWarningModel,"afkingFundingWarningModel");export class AppAfkingFundingWarning extends HTMLElement{static{a(this,"AppAfkingFundingWarning")}#d=!1;#n=!1;#i=!0;#c=[];#l=null;#t=null;#e=Object.freeze({visible:!1});#s=new Set;#u=null;#f=a(e=>{e?.key==="Escape"&&this.#n&&this.#o({dismiss:!0})},"#keydown");connectedCallback(){this.#d||(this.#d=!0,this.#i=p(),this.#g(),this.#b(),this.#c=[c("app.afkingSubscription",()=>this.#r()),c("connected.address",()=>this.#r()),c("ui.mode",()=>this.#r())],this.#l=k(e=>{if(e?.name!=="afkingLowFundWarning")return;const n=this.#i;this.#i=!!e.value,!n&&this.#i&&this.#s.clear(),this.#r()}),globalThis.document?.addEventListener?.("keydown",this.#f),this.#r())}disconnectedCallback(){for(const e of this.#c.splice(0))try{e?.()}catch{}try{this.#l?.()}catch{}this.#l=null,globalThis.document?.removeEventListener?.("keydown",this.#f),this.#a(),this.#n&&(this.#n=!1,f()),this.#d=!1}#g(){this.hidden=!0,this.setAttribute("role","dialog"),this.setAttribute("aria-modal","true"),this.setAttribute("aria-labelledby","afking-funding-warning-title"),this.innerHTML=`
      <button type="button" class="afking-funding-warning__backdrop"
              data-bind="afking-warning-dismiss" aria-label="Dismiss AFKing funding warning"></button>
      <section class="afking-funding-warning__card" tabindex="-1">
        <button type="button" class="afking-funding-warning__close"
                data-bind="afking-warning-dismiss" aria-label="Dismiss AFKing funding warning">×</button>
        <header class="afking-funding-warning__head">
          <span class="afking-funding-warning__sigil" aria-hidden="true">
            <i>AUTO</i><b>!</b>
          </span>
          <span>
            <small>SUBSCRIPTION ALERT</small>
            <h2 id="afking-funding-warning-title">AFKING RUNNING LOW</h2>
          </span>
        </header>
        <div class="afking-funding-warning__runway">
          <strong data-bind="afking-warning-days">— DAYS FUNDED</strong>
          <span class="afking-funding-warning__meter" aria-hidden="true">
            ${Array.from({length:7},()=>"<i></i>").join("")}
          </span>
          <small data-bind="afking-warning-order">— / DAY</small>
        </div>
        <p>Your active AFKing order has less than one week of prepaid funding.
           Top it up before automatic buys stop.</p>
        <div class="afking-funding-warning__actions">
          <button type="button" class="afking-funding-warning__later"
                  data-bind="afking-warning-dismiss">NOT NOW</button>
          <button type="button" class="afking-funding-warning__topup"
                  data-bind="afking-warning-topup">TOP UP AFKING</button>
        </div>
        <small class="afking-funding-warning__setting-note">
          You can turn this alert off in <b>⚙ PLAYER SETTINGS</b>.
        </small>
      </section>`}#b(){for(const e of this.querySelectorAll('[data-bind="afking-warning-dismiss"]'))e.addEventListener("click",()=>this.#o({dismiss:!0}));this.querySelector('[data-bind="afking-warning-topup"]')?.addEventListener("click",()=>this.#k())}#r(){const e=u("app.afkingSubscription"),n=u("connected.address"),i=d(n),s=d(e?.address),r=h(e?.fundedDays);if(e?.known===!0&&i&&s===i&&(e.active!==!0||r!=null&&r>=AFKING_LOW_FUND_THRESHOLD_DAYS)&&this.#s.delete(i),this.#e=afkingFundingWarningModel({snapshot:e,connectedAddress:n,mode:u("ui.mode"),enabled:this.#i}),!this.#e.visible){this.#a(),this.#n&&this.#o({dismiss:!1});return}this.#m(),!(this.#s.has(this.#e.address)||this.#n)&&this.#h()}#m(){const e=this.querySelector('[data-bind="afking-warning-days"]'),n=this.querySelector('[data-bind="afking-warning-order"]');e&&(e.textContent=this.#e.daysLabel||"— DAYS FUNDED"),n&&(n.textContent=this.#e.orderLabel||"— / DAY");const i=Math.max(0,Math.min(7,Number(this.#e.fundedSegments)||0));this.querySelectorAll(".afking-funding-warning__meter i").forEach((s,r)=>{s.classList.toggle("is-funded",r<i)})}#h(e=450){this.#a(),this.#t=setTimeout(()=>{if(this.#t=null,!this.#e.visible||this.#s.has(this.#e.address))return;if(Array.from(globalThis.document?.querySelectorAll?.('[role="dialog"][aria-modal="true"]:not([hidden])')||[]).some(i=>isBlockingModal(i,this))){this.#h(900);return}this.#p()},e);try{this.#t?.unref?.()}catch{}}#a(){this.#t!=null&&clearTimeout(this.#t),this.#t=null}#p(){if(!(this.#n||!this.#e.visible)){this.#u=globalThis.document?.activeElement||null,this.#n=!0,this.hidden=!1,this.removeAttribute("hidden"),m();try{this.querySelector(".afking-funding-warning__card")?.focus?.({preventScroll:!0})}catch{}}}#o({dismiss:e=!1}={}){if(this.#a(),e&&this.#e?.address&&this.#s.add(this.#e.address),!!this.#n){this.#n=!1,this.hidden=!0,this.setAttribute("hidden",""),f();try{this.#u?.focus?.({preventScroll:!0})}catch{}this.#u=null}}#k(){this.#o({dismiss:!0});const e=globalThis.document?.querySelector?.("#afking-passes");if(!e)return;e.open=!0;const n=a(()=>{const i=e.querySelector?.('[data-bind="pass-afking"]')||e;try{i.scrollIntoView?.({behavior:"smooth",block:"center"})}catch{i.scrollIntoView?.()}const s=e.querySelector?.('[name="pass-afking-topup"]');try{s?.focus?.({preventScroll:!0})}catch{}try{s?.select?.()}catch{}},"focusFunding");typeof requestAnimationFrame=="function"?requestAnimationFrame(n):setTimeout(n,0)}}typeof customElements<"u"&&!customElements.get("app-afking-funding-warning")&&customElements.define("app-afking-funding-warning",AppAfkingFundingWarning);
//# sourceMappingURL=app-afking-funding-warning.js.map
