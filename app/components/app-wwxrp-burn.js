var I=Object.defineProperty;var s=(i,t)=>I(i,"name",{value:t,configurable:!0});import{readFlipWidgetBalances as y}from"../app/coinflip.js";import{TX_CONFIRMED_EVENT as g}from"../app/contracts.js";import{deriveCanSign as A,get as W,getViewedAddress as v,subscribe as R}from"../app/store.js";import{burnWwxrp as S,MIN_WWXRP_BURN_WEI as w}from"../app/wwxrp.js";import{compactUiError as k}from"../app/ui-error.js";import{registerComponentPoll as P}from"../app/component-poll.js";import{openPanelPopup as B,closePanelPopup as b}from"../app/panel-popups.js";import"./boon-product-indicator.js";const p=10n**18n,X=3e4;let m=y,x=S;function _(i){return String(i||"").trim().toLowerCase()||null}s(_,"_address");export function parseWwxrpAmount(i){const t=/^\s*(\d+)(?:\.(\d{0,18}))?\s*$/.exec(String(i??""));if(!t)return null;const e=String(t[2]||"").padEnd(18,"0");try{return BigInt(t[1])*p+BigInt(e||"0")}catch{return null}}s(parseWwxrpAmount,"parseWwxrpAmount");function E(i){let t;try{t=BigInt(i??0)}catch{t=0n}t<0n&&(t=0n);const e=t/p,n=String(t%p).padStart(18,"0").replace(/0+$/,"");return n?`${e}.${n}`:String(e)}s(E,"_amountInput");export function formatWwxrpBalance(i){let t;try{t=BigInt(i??0)}catch{return"—"}if(t<0n&&(t=-t),t>0n&&t<p)return"<1";const e=t/p;if(e<1000n)return e.toLocaleString("en-US");const n=[[10n**15n,"Q"],[10n**12n,"T"],[10n**9n,"B"],[10n**6n,"M"],[10n**3n,"K"]];let r=n.findIndex(([o])=>e>=o);for(r<0&&(r=n.length-1);;){const[o,h]=n[r],u=e/o,a=u>=100n?0:u>=10n?1:2,l=10n**BigInt(a),c=(e*l+o/2n)/o;if(c>=1000n*l&&r>0){r-=1;continue}const f=c/l,d=a===0?"":String(c%l).padStart(a,"0").replace(/0+$/,"");return`${f.toLocaleString("en-US")}${d?`.${d}`:""}${h}`}}s(formatWwxrpBalance,"formatWwxrpBalance");function q(i,t,e=""){i&&(i.disabled=!!t,t?(i.setAttribute("data-write-locked",""),i.setAttribute("data-write-lock-title",e),i.title=e):(i.removeAttribute("data-write-locked"),i.removeAttribute("data-write-lock-title"),i.removeAttribute("title")))}s(q,"_setWriteLock");class L extends HTMLElement{static{s(this,"AppWwxrpBurn")}#a=!1;#l=[];#c=null;#s=null;#d=!1;#o=0;#e=null;#t=null;#i=!1;connectedCallback(){if(!this.#a){this.#a=!0,this.#b(),this.#m();for(const t of["connected.address","viewing.address"])this.#l.push(R(t,()=>this.#p()));for(const t of["ui.mode","ui.chainOk"])this.#l.push(R(t,()=>this.#n()));this.#c=P(()=>this.#h(),X),typeof document<"u"&&(this.#s=()=>this.#u(),document.addEventListener?.(g,this.#s)),this.#p()}}disconnectedCallback(){b("incinerator",{restoreFocus:!1});for(const t of this.#l)try{t()}catch{}this.#l=[],typeof this.#c=="function"&&this.#c(),this.#s&&typeof document<"u"&&document.removeEventListener?.(g,this.#s),this.#c=null,this.#s=null,this.#d=!1,this.#o+=1,this.#a=!1}#b(){this.hidden=!0,this.innerHTML=`
      <div class="incinerator-summary" aria-label="Daily Incinerator">
        <img class="incinerator-summary__badge" src="/shared/coinflip-face-red.svg"
             width="28" height="28" alt="" aria-hidden="true">
        <span class="incinerator-summary__balance" title="Available WWXRP">
          <b data-bind="wwxrp-summary-balance">—</b><small>WWXRP</small>
        </span>
        <button type="button" class="secondary-action" data-bind="wwxrp-open"
                aria-haspopup="dialog" aria-expanded="false" aria-controls="panel-incinerator"
                aria-label="Enter the Daily Incinerator">ENTER INCINERATOR</button>
      </div>
      <section class="panel-popup secondary-popup" id="panel-incinerator" data-panel-popup="incinerator"
               data-bind="wwxrp-dialog" hidden role="dialog" aria-modal="true" aria-labelledby="incinerator-title">
        <div class="panel-popup__window">
          <header class="panel-popup__header">
            <h2 id="incinerator-title">DAILY INCINERATOR</h2>
            <button type="button" class="panel-popup__close" data-panel-close aria-label="Close Incinerator">×</button>
          </header>
          <div class="panel-popup__body">
            <p class="secondary-popup__intro">Burn WWXRP to enter the Daily Incinerator. Choose an amount below; burned tokens are permanently spent. Minimum: 25 WWXRP.</p>
            <section class="pari-wwxrp pari-funding-card pari-funding-card--wwxrp" data-bind="wwxrp-shell"
                     aria-label="WWXRP balance and Daily Incinerator entry">
              <span class="pari-wwxrp__mark pari-funding-card__mark" aria-hidden="true">
                <img src="/shared/coinflip-face-red.svg" alt="">
              </span>
              <span class="pari-wwxrp__identity pari-funding-card__identity">
                <small>DAILY INCINERATOR</small>
                <strong>WWXRP</strong>
                <span class="pari-wwxrp__balance pari-funding-card__balance" data-bind="wwxrp-balance-wrap">
                  <small>AVAILABLE</small>
                  <strong><span data-bind="wwxrp-balance">—</span></strong>
                </span>
              </span>
              <span class="pari-wwxrp__amount pari-funding-card__amount">
                <small>BURN AMOUNT</small>
                <span class="pari-wwxrp__amount-control pari-funding-card__amount-control">
                  <input type="text" data-bind="wwxrp-amount" inputmode="decimal"
                         autocomplete="off" spellcheck="false" aria-label="WWXRP to burn">
                  <span class="pari-wwxrp__unit pari-funding-card__unit">WWXRP</span>
                  <button type="button" data-bind="wwxrp-max">MAX</button>
                </span>
              </span>
              <button type="button" class="pari-wwxrp__burn pari-funding-card__action" data-write data-write-locked
                      data-write-lock-title="WWXRP balance is loading"
                      data-bind="wwxrp-burn">
                <b data-bind="wwxrp-burn-label">BURN</b>
                <!-- WWXRP boons (38/39/40) are spent by this burn (WWXRP.enter). -->
                <boon-product-indicator product="degenerette-wwxrp"></boon-product-indicator>
              </button>
              <p class="pari-wwxrp__feedback pari-funding-card__feedback" data-bind="wwxrp-feedback"
                 hidden role="status"></p>
            </section>
          </div>
        </div>
      </section>
    `;const t=this.querySelector('[data-bind="wwxrp-amount"]');t&&(t.value="25")}#m(){const t=this.querySelector('[data-bind="wwxrp-open"]');t?.addEventListener("click",()=>{B("incinerator",t,this.querySelector('[data-bind="wwxrp-dialog"]')),t.setAttribute("aria-expanded","true")}),this.querySelector('[data-bind="wwxrp-dialog"]')?.addEventListener("app:panel-close",()=>{t?.setAttribute("aria-expanded","false")}),this.querySelector('[data-bind="wwxrp-burn"]')?.addEventListener("click",()=>{this.#w()}),this.querySelector('[data-bind="wwxrp-max"]')?.addEventListener("click",()=>this.#_());const e=this.querySelector('[data-bind="wwxrp-amount"]');e?.addEventListener("input",()=>this.#n()),e?.addEventListener("keydown",n=>{n?.key==="Enter"&&this.#w()})}#p(){const t=_(v());t!==this.#e&&(b("incinerator",{restoreFocus:!1}),this.#o+=1,this.#e=t,this.#t=null,this.#r("")),this.#n(),this.#u()}#u(){!this.#a||this.#d||(this.#d=!0,queueMicrotask(()=>{this.#d=!1,this.#a&&this.#h()}))}async#h(){const t=_(v());if(t!==this.#e&&(this.#e=t,this.#t=null,this.#o+=1,this.#n()),!t)return;const e=++this.#o;let n;try{n=await m({player:t})}catch{return}if(!(e!==this.#o||t!==this.#e)){if(n?.wwxrpBalance!=null)try{this.#t=BigInt(n.wwxrpBalance)}catch{this.#t=null}else this.#t=null;this.#n()}}#f(){const t=_(W("connected.address"));return!!(t&&t===this.#e&&W("ui.mode")==="self"&&A())}#x(){return this.#i?"Transaction in progress":this.#e?this.#f()?this.#t==null?"WWXRP balance is loading":this.#t<w?"Minimum burn is 25 WWXRP":"":"Open your own wallet view to incinerate WWXRP":"Connect a wallet first"}#n(){this.hidden=!this.#e||this.#t==null||this.#t<=0n,this.hidden&&b("incinerator",{restoreFocus:!1});const t=this.querySelector('[data-bind="wwxrp-shell"]');t&&(t.hidden=this.hidden);const e=this.querySelector('[data-bind="wwxrp-balance"]'),n=this.querySelector('[data-bind="wwxrp-balance-wrap"]');e&&(e.textContent=this.#t==null?"—":formatWwxrpBalance(this.#t));const r=this.querySelector('[data-bind="wwxrp-summary-balance"]');if(r&&(r.textContent=this.#t==null?"—":formatWwxrpBalance(this.#t)),n){const d=this.#t==null?"":`${E(this.#t)} WWXRP`;n.title=d,d?n.setAttribute("aria-label",`WWXRP balance: ${d}`):n.removeAttribute("aria-label")}const o=this.querySelector('[data-bind="wwxrp-burn"]'),h=this.querySelector('[data-bind="wwxrp-burn-label"]'),u=this.#x();h&&(h.textContent=this.#i?"WAIT":"BURN");const a=this.querySelector('[data-bind="wwxrp-amount"]'),l=parseWwxrpAmount(a?.value),c=l!=null&&l>=w&&this.#t!=null&&l<=this.#t;a&&(a.value&&!c?a.setAttribute("aria-invalid","true"):a.removeAttribute("aria-invalid"),a.disabled=this.#i),q(o,!!u||!c,u||"Enter an amount from 25 through your WWXRP balance");const f=this.querySelector('[data-bind="wwxrp-max"]');f&&(f.disabled=this.#i||this.#t==null)}#_(){if(this.#t==null)return;const t=this.querySelector('[data-bind="wwxrp-amount"]');t&&(t.value=E(this.#t),this.#n())}#r(t,{error:e=!1}={}){const n=this.querySelector('[data-bind="wwxrp-feedback"]');n&&(n.textContent=String(t||""),n.hidden=!t,e?n.setAttribute("data-state","error"):n.removeAttribute("data-state"))}async#w(){if(this.#i||!this.#f())return;const t=this.querySelector('[data-bind="wwxrp-amount"]'),e=parseWwxrpAmount(t?.value);if(e==null||e<w){this.#r("Minimum burn is 25 WWXRP.",{error:!0});return}if(this.#t==null||e>this.#t){this.#r("Not enough WWXRP for that burn.",{error:!0});return}const n=this.#e;this.#i=!0,this.#r(""),this.#n();try{if(await x({amount:e}),n!==this.#e)return;this.#t!=null&&(this.#t-=e),this.#r(`${formatWwxrpBalance(e)} WWXRP INCINERATED`),this.#u()}catch(r){n===this.#e&&this.#r(k(r,"WWXRP incineration did not go through."),{error:!0})}finally{this.#i=!1,this.#n()}}}typeof customElements<"u"&&!customElements.get("app-wwxrp-burn")&&customElements.define("app-wwxrp-burn",L);export function __setWwxrpBurnWidgetDepsForTest({balances:i,burn:t}={}){typeof i=="function"&&(m=i),typeof t=="function"&&(x=t)}s(__setWwxrpBurnWidgetDepsForTest,"__setWwxrpBurnWidgetDepsForTest");export function __resetWwxrpBurnWidgetDepsForTest(){m=y,x=S}s(__resetWwxrpBurnWidgetDepsForTest,"__resetWwxrpBurnWidgetDepsForTest");
//# sourceMappingURL=app-wwxrp-burn.js.map
