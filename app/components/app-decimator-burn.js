var P=Object.defineProperty;var l=(s,t)=>P(s,"name",{value:t,configurable:!0});import{displayEth as C,displayToken as k}from"../app/scaling.js";import{get as y,getActingAddress as S,getViewedAddress as $,subscribe as R}from"../app/store.js";import{readGameState as F}from"../app/game-state.js";import{activeBoonForProduct as M}from"../app/boons.js";import{burnForDecimator as q,decimatorMinFlipText as w,decimatorMinFlipWei as m,decimatorEffectiveMultiplierBps as O,decimatorStackCreditWei as N,decimatorPoolWei as D,decimatorWindowIsOpen as U,readDecimatorContext as T}from"../app/decimator.js";import{compactUiError as A}from"../app/ui-error.js";import{registerComponentPoll as W}from"../app/component-poll.js";import"./boon-product-indicator.js";import"./quest-objective-indicator.js";const z=15e3,H=350,f=10n**18n;let L=F,B=T,E=q;function I(s){try{const t=k(BigInt(s||0),0),e=Number(t);return Number.isSafeInteger(e)?e.toLocaleString("en-US"):t}catch{return"—"}}l(I,"_fmtFlip");function x(s){let t;try{t=BigInt(s??0)}catch{return"—"}const e=t<0n,n=(e?-t:t)/f,i=e?"-":"";if(n<1000n)return`${i}${n.toLocaleString("en-US")}`;const a=[[1000000000000n,"T"],[1000000000n,"B"],[1000000n,"M"],[1000n,"K"]],[r,u]=a.find(([b])=>n>=b),o=n/r,d=o>=100n?0:o>=10n?1:2,h=10n**BigInt(d),p=n*h/r,_=p/h,c=d===0?"":String(p%h).padStart(d,"0").replace(/0+$/,"");return`${i}${_}${c?`.${c}`:""}${u}`}l(x,"_compactFlip");export function formatDecimatorBurnQuote(s,t=0n){let e=0n;try{e=BigInt(t??0)}catch{e=0n}const n=x(s);return e>0n?`+${n} · +${x(e)} BOON`:`+${n} SCORE`}l(formatDecimatorBurnQuote,"formatDecimatorBurnQuote");function V(s){try{const t=C(BigInt(s||0),3).replace(/\.000$/,"").replace(/(\.\d*?)0+$/,"$1"),[e,n]=t.split("."),i=e.replace(/\B(?=(\d{3})+(?!\d))/g,",");return n==null?i:`${i}.${n}`}catch{return"—"}}l(V,"_fmtEth");function g(s){const t=String(s??"").trim().replace(/,/g,"").match(/^(\d+)(?:\.(\d{1,18}))?$/);return t?BigInt(t[1])*f+BigInt(String(t[2]||"").padEnd(18,"0")):null}l(g,"_parseFlip");function v(s){const t=BigInt(s||0),e=t/f,n=t%f;return n===0n?String(e):`${e}.${String(n).padStart(18,"0").replace(/0+$/,"")}`}l(v,"_inputFlip");function G(s,{signed:t=!1}={}){const e=Number(s||0);if(!Number.isFinite(e))return"—";const n=e/100,i=Number.isInteger(n)?String(n):n.toFixed(2).replace(/0+$/,"").replace(/\.$/,"");return`${t&&n>0?"+":""}${i}%`}l(G,"_percentFromBps");export function decimatorBoonBps(s){const t=Number(M(s,"decimator")?.row?.boonType||0);return t===13?1e3:t===14?2500:t===15?5e3:0}l(decimatorBoonBps,"decimatorBoonBps");class Q extends HTMLElement{static{l(this,"AppDecimatorBurn")}#m=!1;#f=[];#d=null;#i=null;#e=null;#o=null;#a=null;#b=0;#g=null;#t=null;#_=null;#n=null;#s=!1;#l=!1;#c=v(m());connectedCallback(){if(!this.#m){this.#m=!0,this.#L(),this.#B();for(const t of["connected.address","viewing.address","ui.mode","app.boons"])this.#f.push(R(t,()=>{t==="app.boons"||t==="ui.mode"?this.#h():this.#u()}));this.#d=W(()=>this.#u(),z),this.#u()}}disconnectedCallback(){for(const t of this.#f)try{t()}catch{}this.#f=[],typeof this.#d=="function"&&this.#d(),this.#i!=null&&clearTimeout(this.#i),this.#e!=null&&clearTimeout(this.#e),typeof document<"u"&&(this.#o&&document.removeEventListener?.("quest:activate",this.#o),this.#a&&document.removeEventListener?.("app-decimator:burn-confirmed",this.#a)),this.#d=null,this.#i=null,this.#e=null,this.#o=null,this.#a=null,this.#b+=1,this.#m=!1}#L(){this.hidden=!0,this.innerHTML=`
      <section class="dbb" data-bind="dbb-shell" hidden aria-labelledby="dbb-title">
        <header class="dbb__identity">
          <span class="dbb__reactor" aria-hidden="true">
            <span class="dbb__reactor-ring"></span>
            <img src="/app/assets/decimator-draw-mark.svg" alt="">
          </span>
          <span class="dbb__identity-copy">
            <small>LEVEL <span data-bind="dbb-level">—</span> EVENT</small>
            <h2 id="dbb-title">DECIMATOR</h2>
            <span class="dbb__live">BURN <img src="/whitepaper/flame-logo-split.svg" alt="FLIP"> TO WIN</span>
          </span>
        </header>

        <div class="dbb__stats" aria-label="Decimator prize pool">
          <article class="dbb-stat dbb-stat--prize">
            <span><small>PRIZE POOL</small><strong><b data-bind="dbb-prize">—</b><em>ETH</em></strong></span>
          </article>
        </div>

        <div class="dbb__entry">
          <span class="dbb__entry-meta">
            <span class="dbb__actual-multi"
                  title="Score per FLIP burned: your degen multiplier, times 0.9 for each day since the window opened, plus any boon.">
              <small>YOUR MULTIPLIER</small>
              <strong><b data-bind="dbb-live-multi">—</b></strong>
            </span>
          </span>
          <div class="dbb__entry-controls">
            <label class="dbb__input">
              <boon-product-indicator product="decimator"></boon-product-indicator>
              <span class="dbb__input-control">
                <small>BURN AMOUNT</small>
                <input type="text" inputmode="decimal" name="dbb-amount" value="${v(m())}"
                       aria-label="Decimator burn amount in FLIP">
                <b>FLIP</b>
                <span class="dbb__stepper">
                  <button type="button" data-bind="dbb-up" aria-label="Add 1,000 FLIP">▲</button>
                  <button type="button" data-bind="dbb-down" aria-label="Remove 1,000 FLIP">▼</button>
                </span>
              </span>
            </label>
            <button type="button" class="dbb__burn" data-write data-bind="dbb-burn">
              <span data-bind="dbb-burn-action">BURN FLIP</span>
              <strong data-bind="dbb-quote">SCORE —</strong>
              <quest-objective-indicator product="decimator"></quest-objective-indicator>
            </button>
          </div>
        </div>

        <article class="dbb-stat dbb-stat--score">
          <span><small>YOUR SCORE</small><strong data-bind="dbb-player-score">—</strong></span>
        </article>
        <p class="dbb__feedback" data-bind="dbb-feedback" hidden role="status"></p>
      </section>
    `}#B(){const t=this.querySelector('[name="dbb-amount"]');t?.addEventListener("input",()=>{this.#c=String(t.value||""),this.#r()}),t?.addEventListener("keydown",e=>{e?.key==="Enter"&&this.#y()}),this.querySelector('[data-bind="dbb-up"]')?.addEventListener("click",()=>this.#v(1)),this.querySelector('[data-bind="dbb-down"]')?.addEventListener("click",()=>this.#v(-1)),this.querySelector('[data-bind="dbb-burn"]')?.addEventListener("click",()=>this.#y()),typeof document<"u"&&(this.#o=e=>{if(Number(e?.detail?.questType)!==5)return;let n;try{n=BigInt(e?.detail?.target??0)}catch{n=0n}n<m()&&(n=2000n*f),this.#c=v(n),t&&(t.value=this.#c),this.#r();try{this.scrollIntoView?.({behavior:"smooth",block:"center"})}catch{}e?.detail?.submit&&this.#y()},this.#a=e=>{e?.target!==this&&this.#u()},document.addEventListener?.("quest:activate",this.#o),document.addEventListener?.("app-decimator:burn-confirmed",this.#a))}#v(t){const e=this.querySelector('[name="dbb-amount"]'),n=g(e?.value),i=m(),r=(n??i)+BigInt(t)*1000n*f,u=r<i?i:r;this.#c=v(u),e&&(e.value=this.#c),this.#r()}async#u(){const t=++this.#b;let e=null;try{e=await L()}catch{e=null}if(t!==this.#b)return;this.#g=e;const n=Number(e?.level);if(this.#n=Number.isInteger(n)&&n>=0?n+1:null,this.#s=this.#n!=null&&U(e),!this.#s){this.#t=null,this.#_=null,this.#h();return}const i=(typeof $=="function"?$():null)||S()||null,a=`${this.#n}:${String(i||"").toLowerCase()}`;a!==this.#_&&(this.#t=null),this.#_=a,this.#h();const r=await B(i,this.#n,{includeRoundTotal:!1}).catch(()=>null);t===this.#b&&(r&&(this.#t=r),this.#h())}#h(){const t=this.querySelector('[data-bind="dbb-shell"]');if(this.hidden=!this.#s,t&&(t.hidden=!this.#s),!this.#s||!t)return;const e=this.querySelector('[data-bind="dbb-level"]');e&&(e.textContent=this.#n==null?"—":String(this.#n));const n=this.#t?.futurePoolWei??this.#g?.prizePools?.futurePrizePool,i=this.#n==null?null:D(n,this.#n),a=[["dbb-prize",i==null?"—":V(i)],["dbb-player-score",this.#t?.stackWei==null?"—":I(this.#t.stackWei)]];for(const[r,u]of a){const o=this.querySelector(`[data-bind="${r}"]`);o&&(o.textContent=u)}this.#r(decimatorBoonBps(y("app.boons")))}#S(){const t=S(),e=y("connected.address");return!!(t&&e&&String(t).toLowerCase()===String(e).toLowerCase()&&y("ui.mode")==="self")}#r(t=null){const e=this.querySelector('[name="dbb-amount"]'),n=this.querySelector('[data-bind="dbb-quote"]'),i=this.querySelector('[data-bind="dbb-burn"]'),a=this.querySelector('[data-bind="dbb-burn-action"]'),r=g(e?.value),u=Number(this.#t?.activityScore);let o=null,d=0n,h=null;const p=m();if(r!=null&&r>=p&&Number.isFinite(u)&&this.#t?.activityScore!=null&&this.#t?.daysLate!=null){const c={amountWei:r,activityScore:Math.max(0,Math.trunc(u)),daysLate:this.#t.daysLate,boonBps:t??decimatorBoonBps(y("app.boons"))};if(o=N(c),c.boonBps>0){const b=N({...c,boonBps:0});d=o>b?o-b:0n}h=O(c)}if(n){const c=o!=null&&d>0n;if(n.textContent=r!=null&&r<p?`MIN ${w()} FLIP`:o==null?"SCORE —":formatDecimatorBurnQuote(o,d),n.classList?.toggle("has-boon",c),c){const b=`Adds ${I(o)} to your score, including ${I(d)} from Decimator boon`;n.setAttribute?.("title",b),n.setAttribute?.("aria-label",b)}else n.removeAttribute?.("title"),n.removeAttribute?.("aria-label")}a&&(a.textContent=this.#l?"BURNING…":"BURN FLIP");const _=this.querySelector('[data-bind="dbb-live-multi"]');_&&(_.textContent=h==null?"—":G(h)),i&&(i.disabled=this.#l||!this.#s||!this.#S()||r==null||r<p)}#p(t,e=!1){const n=this.querySelector('[data-bind="dbb-feedback"]');if(n&&(n.textContent=String(t||""),n.hidden=!t,n.classList?.toggle("is-error",!!e),this.#e!=null&&clearTimeout(this.#e),this.#e=null,t)){this.#e=setTimeout(()=>{n.hidden=!0,n.textContent=""},1e4);try{this.#e?.unref?.()}catch{}}}async#y(){if(this.#l||!this.#s||!this.#S())return;const t=this.querySelector('[name="dbb-amount"]'),e=g(t?.value);if(e==null||e<m()){this.#p(`Minimum burn is ${w()} FLIP.`,!0);return}const n=S();if(n){this.#l=!0,this.#p(""),this.#r();try{const{receipt:i}=await E({player:n,amount:e});this.#p("BURN CONFIRMED");try{this.dispatchEvent(new CustomEvent("app-decimator:burn-confirmed",{bubbles:!0,detail:{player:n,amountWei:e,transactionHash:i?.hash||i?.transactionHash||null}}))}catch{}this.#i!=null&&clearTimeout(this.#i),this.#i=setTimeout(()=>{this.#u()},H);try{this.#i?.unref?.()}catch{}}catch(i){this.#p(A(i,"Decimator burn did not go through."),!0)}finally{this.#l=!1,this.#r()}}}}typeof customElements<"u"&&!customElements.get("app-decimator-burn")&&customElements.define("app-decimator-burn",Q);export function __setDecimatorBurnWidgetDepsForTest({game:s,context:t,burn:e}={}){typeof s=="function"&&(L=s),typeof t=="function"&&(B=t),typeof e=="function"&&(E=e)}l(__setDecimatorBurnWidgetDepsForTest,"__setDecimatorBurnWidgetDepsForTest");export function __resetDecimatorBurnWidgetDepsForTest(){L=F,B=T,E=q}l(__resetDecimatorBurnWidgetDepsForTest,"__resetDecimatorBurnWidgetDepsForTest");export{g as parseDecimatorFlipInput};
//# sourceMappingURL=app-decimator-burn.js.map
