var L=Object.defineProperty;var c=(i,t)=>L(i,"name",{value:t,configurable:!0});import{readDisplaySnapshot as q,writeDisplaySnapshot as N}from"../app/local-display-cache.js";import{setActionFeedback as C}from"../app/action-feedback.js";import{readFlipWidgetBalances as P}from"../app/coinflip.js";import{TX_CONFIRMED_EVENT as k}from"../app/contracts.js";import{deriveCanSign as M,get as x,getViewedAddress as E,subscribe as I}from"../app/store.js";import{burnWwxrp as A,MIN_WWXRP_BURN_WEI as l}from"../app/wwxrp.js";import{compactUiError as T}from"../app/ui-error.js";import{registerComponentPoll as $}from"../app/component-poll.js";import{openPanelPopup as D,closePanelPopup as X}from"../app/panel-popups.js";import"./boon-product-indicator.js";const f=10n**18n,O=3e4,_=10000n;let W=P,v=A;function S(i){return String(i||"").trim().toLowerCase()||null}c(S,"_address");export function parseWwxrpAmount(i){const t=/^\s*(\d+)(?:\.(\d{0,18}))?\s*$/.exec(String(i??""));if(!t)return null;const e=String(t[2]||"").padEnd(18,"0");try{return BigInt(t[1])*f+BigInt(e||"0")}catch{return null}}c(parseWwxrpAmount,"parseWwxrpAmount");function w(i){let t;try{t=BigInt(i??0)}catch{t=0n}t<0n&&(t=0n);const e=t/f,n=String(t%f).padStart(18,"0").replace(/0+$/,"");return n?`${e}.${n}`:String(e)}c(w,"_amountInput");export function formatWwxrpBalance(i){let t;try{t=BigInt(i??0)}catch{return"—"}if(t<0n&&(t=-t),t>0n&&t<f)return"<1";const e=t/f;if(e<1000n)return e.toLocaleString("en-US");const n=[[10n**15n,"Q"],[10n**12n,"T"],[10n**9n,"B"],[10n**6n,"M"],[10n**3n,"K"]];let a=n.findIndex(([r])=>e>=r);for(a<0&&(a=n.length-1);;){const[r,g]=n[a],p=e/r,u=p>=100n?0:p>=10n?1:2,s=10n**BigInt(u),o=(e*s+r/2n)/r;if(o>=1000n*s&&a>0){a-=1;continue}const b=o/s,h=u===0?"":String(o%s).padStart(u,"0").replace(/0+$/,"");return`${b.toLocaleString("en-US")}${h?`.${h}`:""}${g}`}}c(formatWwxrpBalance,"formatWwxrpBalance");function F(i,t,e=""){i&&(i.disabled=!!t,t?(i.setAttribute("data-write-locked",""),i.setAttribute("data-write-lock-title",e),i.title=e):(i.removeAttribute("data-write-locked"),i.removeAttribute("data-write-lock-title"),i.removeAttribute("title")))}c(F,"_setWriteLock");class U extends HTMLElement{static{c(this,"AppWwxrpBurn")}#a=!1;#l=[];#d=null;#r=null;#c=!1;#s=0;#e=null;#t=null;#n=!1;connectedCallback(){if(!this.#a){this.#a=!0,this.#b(),this.#m();for(const t of["connected.address","viewing.address"])this.#l.push(I(t,()=>this.#p()));for(const t of["ui.mode","ui.chainOk","app.gameState"])this.#l.push(I(t,()=>this.#i()));this.#d=$(()=>this.#h(),O,{owner:this}),typeof document<"u"&&(this.#r=()=>this.#u(),document.addEventListener?.(k,this.#r)),this.#p()}}disconnectedCallback(){X("incinerator",{restoreFocus:!1});for(const t of this.#l)try{t()}catch{}this.#l=[],typeof this.#d=="function"&&this.#d(),this.#r&&typeof document<"u"&&document.removeEventListener?.(k,this.#r),this.#d=null,this.#r=null,this.#c=!1,this.#s+=1,this.#a=!1}#b(){this.hidden=!1,this.innerHTML=`
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
    `;const t=this.querySelector('[data-bind="wwxrp-amount"]');t&&(t.value="25")}#m(){const t=this.querySelector('[data-bind="wwxrp-open"]');t?.addEventListener("click",()=>{D("incinerator",t,this.querySelector('[data-bind="wwxrp-dialog"]')),t.setAttribute("aria-expanded","true")}),this.querySelector('[data-bind="wwxrp-dialog"]')?.addEventListener("app:panel-close",()=>{t?.setAttribute("aria-expanded","false")}),this.querySelector('[data-bind="wwxrp-burn"]')?.addEventListener("click",()=>{this.#w()}),this.querySelector('[data-bind="wwxrp-max"]')?.addEventListener("click",()=>this.#g());const e=this.querySelector('[data-bind="wwxrp-amount"]');e?.addEventListener("input",()=>this.#i()),this.querySelector('[data-bind="wwxrp-slider"]')?.addEventListener("input",n=>{if(this.#n||this.#t==null||this.#t<=l||!e)return;const a=BigInt(Math.max(0,Math.min(Number(_),Math.round(Number(n.target.value)||0)))),r=this.#t-l;e.value=w(l+r*a/_),this.#i()}),e?.addEventListener("keydown",n=>{n?.key==="Enter"&&this.#w()})}#p(){const t=S(E());t!==this.#e&&(X("incinerator",{restoreFocus:!1}),this.#s+=1,this.#e=t,this.#t=null,this.#o("")),this.#i(),this.#u()}#u(){!this.#a||this.#c||(this.#c=!0,queueMicrotask(()=>{this.#c=!1,this.#a&&this.#h()}))}async#h(){const t=S(E());if(t!==this.#e&&(this.#e=t,this.#t=null,this.#s+=1,this.#i()),!t)return;const e=++this.#s;let n;try{n=await W({player:t})}catch{return}if(!(e!==this.#s||t!==this.#e)){if(n?.wwxrpBalance!=null)try{this.#t=BigInt(n.wwxrpBalance),N(`token-wwxrp:${t}`,this.#t)}catch{this.#t=null}else this.#t=null;this.#i()}}#f(){if(x("app.gameState")?.gameOver)return!1;const t=S(x("connected.address"));return!!(t&&t===this.#e&&x("ui.mode")==="self"&&M())}#x(){return x("app.gameState")?.gameOver?"Game over — entries are closed.":this.#n?"Transaction in progress":this.#e?this.#f()?this.#t==null?"WWXRP balance is loading":this.#t<l?"Minimum burn is 25 WWXRP":"":"Open your own wallet view to incinerate WWXRP":"Connect a wallet first"}#i(){this.hidden=!1;const t=this.querySelector('[data-bind="wwxrp-shell"]');t&&(t.hidden=!1);const e=this.#t??(this.#e?q(`token-wwxrp:${this.#e}`)?.value:null),n=this.querySelector('[data-bind="wwxrp-balance"]'),a=this.querySelector('[data-bind="wwxrp-balance-wrap"]');n&&(n.textContent=e==null?"—":formatWwxrpBalance(e));const r=this.querySelector('[data-bind="wwxrp-summary-balance"]');if(r&&(r.textContent=e==null?"—":formatWwxrpBalance(e)),a){const d=this.#t==null?"":`${w(this.#t)} WWXRP`;a.title=d,d?a.setAttribute("aria-label",`WWXRP balance: ${d}`):a.removeAttribute("aria-label")}const g=this.querySelector('[data-bind="wwxrp-burn"]'),p=this.querySelector('[data-bind="wwxrp-burn-label"]'),u=this.#x();p&&(p.textContent=this.#n?"WAIT":"BURN");const s=this.querySelector('[data-bind="wwxrp-amount"]'),o=parseWwxrpAmount(s?.value),b=o!=null&&o>=l&&this.#t!=null&&o<=this.#t;s&&(s.value&&!b?s.setAttribute("aria-invalid","true"):s.removeAttribute("aria-invalid"),s.disabled=this.#n),F(g,!!u||!b,u||"Enter an amount from 25 through your WWXRP balance");const h=this.querySelector('[data-bind="wwxrp-max"]');h&&(h.disabled=this.#n||this.#t==null);const m=this.querySelector('[data-bind="wwxrp-slider"]');if(m){const d=(this.#t??0n)-l,R=o==null||o<l?l:o>this.#t?this.#t:o,B=d>0n?((R-l)*_+d/2n)/d:0n;m.value=String(B),m.disabled=this.#n||d<=0n,m.setAttribute("aria-valuetext",`${w(d>0n?R:l)} WWXRP`)}const y=this.querySelector('[data-bind="wwxrp-slider-max"]');y&&(y.textContent=`${this.#t==null?"—":formatWwxrpBalance(this.#t)} WWXRP`,y.title=this.#t==null?"":`${w(this.#t)} WWXRP`)}#g(){if(this.#t==null)return;const t=this.querySelector('[data-bind="wwxrp-amount"]');t&&(t.value=w(this.#t),this.#i())}#o(t,{error:e=!1}={}){const n=this.querySelector('[data-bind="wwxrp-feedback"]');n&&(C(n,t),e?n.setAttribute("data-state","error"):n.removeAttribute("data-state"))}async#w(){if(this.#n||!this.#f())return;const t=this.querySelector('[data-bind="wwxrp-amount"]'),e=parseWwxrpAmount(t?.value);if(e==null||e<l){this.#o("Minimum burn is 25 WWXRP.",{error:!0});return}if(this.#t==null||e>this.#t){this.#o("Not enough WWXRP for that burn.",{error:!0});return}const n=this.#e;this.#n=!0,this.#o(""),this.#i();try{if(await v({amount:e}),n!==this.#e)return;this.#t!=null&&(this.#t-=e),this.#u()}catch(a){n===this.#e&&this.#o(T(a,"WWXRP incineration did not go through."),{error:!0})}finally{this.#n=!1,this.#i()}}}typeof customElements<"u"&&!customElements.get("app-wwxrp-burn")&&customElements.define("app-wwxrp-burn",U);export function __setWwxrpBurnWidgetDepsForTest({balances:i,burn:t}={}){typeof i=="function"&&(W=i),typeof t=="function"&&(v=t)}c(__setWwxrpBurnWidgetDepsForTest,"__setWwxrpBurnWidgetDepsForTest");export function __resetWwxrpBurnWidgetDepsForTest(){W=P,v=A}c(__resetWwxrpBurnWidgetDepsForTest,"__resetWwxrpBurnWidgetDepsForTest");
//# sourceMappingURL=app-wwxrp-burn.js.map
