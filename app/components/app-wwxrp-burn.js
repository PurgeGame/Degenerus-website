var B=Object.defineProperty;var c=(i,t)=>B(i,"name",{value:t,configurable:!0});import{readFlipWidgetBalances as S}from"../app/coinflip.js";import{TX_CONFIRMED_EVENT as P}from"../app/contracts.js";import{deriveCanSign as L,get as E,getViewedAddress as I,subscribe as A}from"../app/store.js";import{burnWwxrp as X,MIN_WWXRP_BURN_WEI as s}from"../app/wwxrp.js";import{compactUiError as q}from"../app/ui-error.js";import{registerComponentPoll as N}from"../app/component-poll.js";import{openPanelPopup as C,closePanelPopup as _}from"../app/panel-popups.js";import"./boon-product-indicator.js";const f=10n**18n,M=3e4,g=10000n;let y=S,W=X;function v(i){return String(i||"").trim().toLowerCase()||null}c(v,"_address");export function parseWwxrpAmount(i){const t=/^\s*(\d+)(?:\.(\d{0,18}))?\s*$/.exec(String(i??""));if(!t)return null;const e=String(t[2]||"").padEnd(18,"0");try{return BigInt(t[1])*f+BigInt(e||"0")}catch{return null}}c(parseWwxrpAmount,"parseWwxrpAmount");function w(i){let t;try{t=BigInt(i??0)}catch{t=0n}t<0n&&(t=0n);const e=t/f,n=String(t%f).padStart(18,"0").replace(/0+$/,"");return n?`${e}.${n}`:String(e)}c(w,"_amountInput");export function formatWwxrpBalance(i){let t;try{t=BigInt(i??0)}catch{return"—"}if(t<0n&&(t=-t),t>0n&&t<f)return"<1";const e=t/f;if(e<1000n)return e.toLocaleString("en-US");const n=[[10n**15n,"Q"],[10n**12n,"T"],[10n**9n,"B"],[10n**6n,"M"],[10n**3n,"K"]];let r=n.findIndex(([o])=>e>=o);for(r<0&&(r=n.length-1);;){const[o,b]=n[r],h=e/o,l=h>=100n?0:h>=10n?1:2,a=10n**BigInt(l),p=(e*a+o/2n)/o;if(p>=1000n*a&&r>0){r-=1;continue}const m=p/a,u=l===0?"":String(p%a).padStart(l,"0").replace(/0+$/,"");return`${m.toLocaleString("en-US")}${u?`.${u}`:""}${b}`}}c(formatWwxrpBalance,"formatWwxrpBalance");function T(i,t,e=""){i&&(i.disabled=!!t,t?(i.setAttribute("data-write-locked",""),i.setAttribute("data-write-lock-title",e),i.title=e):(i.removeAttribute("data-write-locked"),i.removeAttribute("data-write-lock-title"),i.removeAttribute("title")))}c(T,"_setWriteLock");class $ extends HTMLElement{static{c(this,"AppWwxrpBurn")}#a=!1;#l=[];#d=null;#s=null;#c=!1;#o=0;#e=null;#t=null;#n=!1;connectedCallback(){if(!this.#a){this.#a=!0,this.#b(),this.#m();for(const t of["connected.address","viewing.address"])this.#l.push(A(t,()=>this.#p()));for(const t of["ui.mode","ui.chainOk"])this.#l.push(A(t,()=>this.#i()));this.#d=N(()=>this.#h(),M),typeof document<"u"&&(this.#s=()=>this.#u(),document.addEventListener?.(P,this.#s)),this.#p()}}disconnectedCallback(){_("incinerator",{restoreFocus:!1});for(const t of this.#l)try{t()}catch{}this.#l=[],typeof this.#d=="function"&&this.#d(),this.#s&&typeof document<"u"&&document.removeEventListener?.(P,this.#s),this.#d=null,this.#s=null,this.#c=!1,this.#o+=1,this.#a=!1}#b(){this.hidden=!0,this.innerHTML=`
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
            <p class="secondary-popup__intro incinerator-prizes">Burn WWXRP for a chance to win <strong>10,000 FLIP</strong> or a <strong>100,000 FLIP jackpot</strong>.</p>
            <p class="incinerator-note">Prizes are credited to Community Coinflip. Minimum burn: 25 WWXRP. Burned tokens are permanently spent.</p>
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
              <div class="incinerator-range">
                <input type="range" min="0" max="10000" step="1" value="0"
                       data-bind="wwxrp-slider" aria-label="WWXRP burn amount">
                <div class="incinerator-range__limits"><span>25 WWXRP</span><span data-bind="wwxrp-slider-max">— WWXRP</span></div>
              </div>
              <p class="pari-wwxrp__feedback pari-funding-card__feedback" data-bind="wwxrp-feedback"
                 hidden role="status"></p>
            </section>
          </div>
        </div>
      </section>
    `;const t=this.querySelector('[data-bind="wwxrp-amount"]');t&&(t.value="25")}#m(){const t=this.querySelector('[data-bind="wwxrp-open"]');t?.addEventListener("click",()=>{C("incinerator",t,this.querySelector('[data-bind="wwxrp-dialog"]')),t.setAttribute("aria-expanded","true")}),this.querySelector('[data-bind="wwxrp-dialog"]')?.addEventListener("app:panel-close",()=>{t?.setAttribute("aria-expanded","false")}),this.querySelector('[data-bind="wwxrp-burn"]')?.addEventListener("click",()=>{this.#w()}),this.querySelector('[data-bind="wwxrp-max"]')?.addEventListener("click",()=>this.#_());const e=this.querySelector('[data-bind="wwxrp-amount"]');e?.addEventListener("input",()=>this.#i()),this.querySelector('[data-bind="wwxrp-slider"]')?.addEventListener("input",n=>{if(this.#n||this.#t==null||this.#t<=s||!e)return;const r=BigInt(Math.max(0,Math.min(Number(g),Math.round(Number(n.target.value)||0)))),o=this.#t-s;e.value=w(s+o*r/g),this.#i()}),e?.addEventListener("keydown",n=>{n?.key==="Enter"&&this.#w()})}#p(){const t=v(I());t!==this.#e&&(_("incinerator",{restoreFocus:!1}),this.#o+=1,this.#e=t,this.#t=null,this.#r("")),this.#i(),this.#u()}#u(){!this.#a||this.#c||(this.#c=!0,queueMicrotask(()=>{this.#c=!1,this.#a&&this.#h()}))}async#h(){const t=v(I());if(t!==this.#e&&(this.#e=t,this.#t=null,this.#o+=1,this.#i()),!t)return;const e=++this.#o;let n;try{n=await y({player:t})}catch{return}if(!(e!==this.#o||t!==this.#e)){if(n?.wwxrpBalance!=null)try{this.#t=BigInt(n.wwxrpBalance)}catch{this.#t=null}else this.#t=null;this.#i()}}#f(){const t=v(E("connected.address"));return!!(t&&t===this.#e&&E("ui.mode")==="self"&&L())}#x(){return this.#n?"Transaction in progress":this.#e?this.#f()?this.#t==null?"WWXRP balance is loading":this.#t<s?"Minimum burn is 25 WWXRP":"":"Open your own wallet view to incinerate WWXRP":"Connect a wallet first"}#i(){this.hidden=!this.#e||this.#t==null||this.#t<=0n,this.hidden&&_("incinerator",{restoreFocus:!1});const t=this.querySelector('[data-bind="wwxrp-shell"]');t&&(t.hidden=this.hidden);const e=this.querySelector('[data-bind="wwxrp-balance"]'),n=this.querySelector('[data-bind="wwxrp-balance-wrap"]');e&&(e.textContent=this.#t==null?"—":formatWwxrpBalance(this.#t));const r=this.querySelector('[data-bind="wwxrp-summary-balance"]');if(r&&(r.textContent=this.#t==null?"—":formatWwxrpBalance(this.#t)),n){const d=this.#t==null?"":`${w(this.#t)} WWXRP`;n.title=d,d?n.setAttribute("aria-label",`WWXRP balance: ${d}`):n.removeAttribute("aria-label")}const o=this.querySelector('[data-bind="wwxrp-burn"]'),b=this.querySelector('[data-bind="wwxrp-burn-label"]'),h=this.#x();b&&(b.textContent=this.#n?"WAIT":"BURN");const l=this.querySelector('[data-bind="wwxrp-amount"]'),a=parseWwxrpAmount(l?.value),p=a!=null&&a>=s&&this.#t!=null&&a<=this.#t;l&&(l.value&&!p?l.setAttribute("aria-invalid","true"):l.removeAttribute("aria-invalid"),l.disabled=this.#n),T(o,!!h||!p,h||"Enter an amount from 25 through your WWXRP balance");const m=this.querySelector('[data-bind="wwxrp-max"]');m&&(m.disabled=this.#n||this.#t==null);const u=this.querySelector('[data-bind="wwxrp-slider"]');if(u){const d=(this.#t??0n)-s,R=a==null||a<s?s:a>this.#t?this.#t:a,k=d>0n?((R-s)*g+d/2n)/d:0n;u.value=String(k),u.disabled=this.#n||d<=0n,u.setAttribute("aria-valuetext",`${w(d>0n?R:s)} WWXRP`)}const x=this.querySelector('[data-bind="wwxrp-slider-max"]');x&&(x.textContent=`${this.#t==null?"—":formatWwxrpBalance(this.#t)} WWXRP`,x.title=this.#t==null?"":`${w(this.#t)} WWXRP`)}#_(){if(this.#t==null)return;const t=this.querySelector('[data-bind="wwxrp-amount"]');t&&(t.value=w(this.#t),this.#i())}#r(t,{error:e=!1}={}){const n=this.querySelector('[data-bind="wwxrp-feedback"]');n&&(n.textContent=String(t||""),n.hidden=!t,e?n.setAttribute("data-state","error"):n.removeAttribute("data-state"))}async#w(){if(this.#n||!this.#f())return;const t=this.querySelector('[data-bind="wwxrp-amount"]'),e=parseWwxrpAmount(t?.value);if(e==null||e<s){this.#r("Minimum burn is 25 WWXRP.",{error:!0});return}if(this.#t==null||e>this.#t){this.#r("Not enough WWXRP for that burn.",{error:!0});return}const n=this.#e;this.#n=!0,this.#r(""),this.#i();try{if(await W({amount:e}),n!==this.#e)return;this.#t!=null&&(this.#t-=e),this.#r(`${formatWwxrpBalance(e)} WWXRP INCINERATED`),this.#u()}catch(r){n===this.#e&&this.#r(q(r,"WWXRP incineration did not go through."),{error:!0})}finally{this.#n=!1,this.#i()}}}typeof customElements<"u"&&!customElements.get("app-wwxrp-burn")&&customElements.define("app-wwxrp-burn",$);export function __setWwxrpBurnWidgetDepsForTest({balances:i,burn:t}={}){typeof i=="function"&&(y=i),typeof t=="function"&&(W=t)}c(__setWwxrpBurnWidgetDepsForTest,"__setWwxrpBurnWidgetDepsForTest");export function __resetWwxrpBurnWidgetDepsForTest(){y=S,W=X}c(__resetWwxrpBurnWidgetDepsForTest,"__resetWwxrpBurnWidgetDepsForTest");
//# sourceMappingURL=app-wwxrp-burn.js.map
