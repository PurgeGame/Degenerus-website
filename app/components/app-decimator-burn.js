var A=Object.defineProperty;var d=(s,t)=>A(s,"name",{value:t,configurable:!0});import{displayEth as D,displayToken as M}from"../app/scaling.js";import{get as v,getActingAddress as L,getViewedAddress as R,subscribe as O}from"../app/store.js";import{readGameState as T}from"../app/game-state.js";import{activeBoonForProduct as W}from"../app/boons.js";import{degenScoreLootTier as U}from"../app/activity-score.js";import{burnForDecimator as N,DECIMATOR_MIN_FLIP_WEI as m,decimatorBracket as z,decimatorEffectiveBaseMultiplierBps as H,decimatorEffectiveMultiplierBps as G,decimatorEntryScoreWei as $,decimatorMultiplierCapApplied as V,decimatorPoolWei as Q,decimatorWindowIsOpen as j,readDecimatorContext as q,readDecimatorRawBurnTotal as F}from"../app/decimator.js";import{compactUiError as K}from"../app/ui-error.js";import{registerComponentPoll as Y}from"../app/component-poll.js";import"./boon-product-indicator.js";import"./quest-objective-indicator.js";const Z=15e3,J=350,g=10n**18n;let I=T,P=q,C=F,w=N;function S(s){try{const t=M(BigInt(s||0),0),n=Number(t);return Number.isSafeInteger(n)?n.toLocaleString("en-US"):t}catch{return"—"}}d(S,"_fmtFlip");function k(s){let t;try{t=BigInt(s??0)}catch{return"—"}const n=t<0n,e=(n?-t:t)/g,i=n?"-":"";if(e<1000n)return`${i}${e.toLocaleString("en-US")}`;const u=[[1000000000000n,"T"],[1000000000n,"B"],[1000000n,"M"],[1000n,"K"]],[r,o]=u.find(([_])=>e>=_),a=e/r,l=a>=100n?0:a>=10n?1:2,c=10n**BigInt(l),b=e*c/r,f=b/c,y=l===0?"":String(b%c).padStart(l,"0").replace(/0+$/,"");return`${i}${f}${y?`.${y}`:""}${o}`}d(k,"_compactFlip");export function formatDecimatorBurnQuote(s,t=0n){let n=0n;try{n=BigInt(t??0)}catch{n=0n}const e=k(s);return n>0n?`+${e} · +${k(n)} BOON`:`+${e} SCORE`}d(formatDecimatorBurnQuote,"formatDecimatorBurnQuote");function X(s){try{const t=D(BigInt(s||0),3).replace(/\.000$/,"").replace(/(\.\d*?)0+$/,"$1"),[n,e]=t.split("."),i=n.replace(/\B(?=(\d{3})+(?!\d))/g,",");return e==null?i:`${i}.${e}`}catch{return"—"}}d(X,"_fmtEth");function B(s){const t=String(s??"").trim().replace(/,/g,"").match(/^(\d+)(?:\.(\d{1,18}))?$/);return t?BigInt(t[1])*g+BigInt(String(t[2]||"").padEnd(18,"0")):null}d(B,"_parseFlip");function x(s){const t=BigInt(s||0),n=t/g,e=t%g;return e===0n?String(n):`${n}.${String(e).padStart(18,"0").replace(/0+$/,"")}`}d(x,"_inputFlip");function tt(s,{signed:t=!1}={}){const n=Number(s||0);if(!Number.isFinite(n))return"—";const e=n/100,i=Number.isInteger(e)?String(e):e.toFixed(2).replace(/0+$/,"").replace(/\.$/,"");return`${t&&e>0?"+":""}${i}%`}d(tt,"_percentFromBps");export function decimatorBoonBps(s){const t=Number(W(s,"decimator")?.row?.boonType||0);return t===13?1e3:t===14?2500:t===15?5e3:0}d(decimatorBoonBps,"decimatorBoonBps");class et extends HTMLElement{static{d(this,"AppDecimatorBurn")}#m=!1;#f=[];#h=null;#i=null;#n=null;#a=null;#o=null;#l=0;#g=null;#t=null;#e=null;#s=!1;#c=!1;#u="1000";connectedCallback(){if(!this.#m){this.#m=!0,this.#S(),this.#B();for(const t of["connected.address","viewing.address","ui.mode","app.boons"])this.#f.push(O(t,()=>{t==="app.boons"||t==="ui.mode"?this.#b():this.#d()}));this.#h=Y(()=>this.#d(),Z),this.#d()}}disconnectedCallback(){for(const t of this.#f)try{t()}catch{}this.#f=[],typeof this.#h=="function"&&this.#h(),this.#i!=null&&clearTimeout(this.#i),this.#n!=null&&clearTimeout(this.#n),typeof document<"u"&&(this.#a&&document.removeEventListener?.("quest:activate",this.#a),this.#o&&document.removeEventListener?.("app-decimator:burn-confirmed",this.#o)),this.#h=null,this.#i=null,this.#n=null,this.#a=null,this.#o=null,this.#l+=1,this.#m=!1}#S(){this.hidden=!0,this.innerHTML=`
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

        <div class="dbb__stats" aria-label="Live Decimator results">
          <article class="dbb-stat dbb-stat--prize">
            <span><small>PRIZE POOL</small><strong><b data-bind="dbb-prize">—</b><em>ETH</em></strong></span>
          </article>
          <article class="dbb-stat dbb-stat--burned">
            <span><small>FLIP BURNED</small><strong><b data-bind="dbb-burned">—</b><em>FLIP</em></strong></span>
          </article>
        </div>

        <div class="dbb__entry">
          <span class="dbb__entry-meta">
            <span class="dbb__bracket">
              <span class="dbb__bracket-id">
                <small>BRACKET</small>
                <strong><b data-bind="dbb-bracket-number">—</b></strong>
              </span>
              <span class="dbb__bracket-score">
                <small>DEGEN RATING</small>
                <strong data-bind="dbb-bracket-range">—</strong>
              </span>
            </span>
            <span class="dbb__actual-multi"
                  title="Total includes activity, timing, and any boon. CAPPED applies to the non-boon base.">
              <small>YOUR MULTIPLIER</small>
              <strong>
                <b data-bind="dbb-live-multi">—</b>
                <em data-bind="dbb-multi-cap" hidden></em>
              </strong>
            </span>
          </span>
          <div class="dbb__entry-controls">
            <label class="dbb__input">
              <boon-product-indicator product="decimator"></boon-product-indicator>
              <span class="dbb__input-control">
                <small>BURN AMOUNT</small>
                <input type="text" inputmode="decimal" name="dbb-amount" value="1000"
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
          <p class="dbb__feedback" data-bind="dbb-feedback" hidden role="status"></p>
        </div>

        <article class="dbb-stat dbb-stat--score">
          <span><small>YOUR DECIMATOR SCORE</small><strong data-bind="dbb-player-score">—</strong></span>
        </article>
      </section>
    `}#B(){const t=this.querySelector('[name="dbb-amount"]');t?.addEventListener("input",()=>{this.#u=String(t.value||""),this.#r()}),t?.addEventListener("keydown",n=>{n?.key==="Enter"&&this.#_()}),this.querySelector('[data-bind="dbb-up"]')?.addEventListener("click",()=>this.#y(1)),this.querySelector('[data-bind="dbb-down"]')?.addEventListener("click",()=>this.#y(-1)),this.querySelector('[data-bind="dbb-burn"]')?.addEventListener("click",()=>this.#_()),typeof document<"u"&&(this.#a=n=>{if(Number(n?.detail?.questType)!==5)return;let e;try{e=BigInt(n?.detail?.target??0)}catch{e=0n}e<m&&(e=2000n*g),this.#u=x(e),t&&(t.value=this.#u),this.#r();try{this.scrollIntoView?.({behavior:"smooth",block:"center"})}catch{}n?.detail?.submit&&this.#_()},this.#o=n=>{n?.target!==this&&this.#d()},document.addEventListener?.("quest:activate",this.#a),document.addEventListener?.("app-decimator:burn-confirmed",this.#o))}#y(t){const n=this.querySelector('[name="dbb-amount"]'),e=B(n?.value),u=(e??m)+BigInt(t)*1000n*g,r=u<m?m:u;this.#u=x(r),n&&(n.value=this.#u),this.#r()}async#d(){const t=++this.#l;let n=null;try{n=await I()}catch{n=null}if(t!==this.#l)return;this.#g=n;const e=Number(n?.level);if(this.#e=Number.isInteger(e)&&e>=0?e+1:null,this.#s=this.#e!=null&&j(n),!this.#s){this.#t=null,this.#b();return}this.#b();const i=(typeof R=="function"?R():null)||L()||null,u=P(i,this.#e).catch(()=>null),r=C({level:this.#e}).catch(()=>null),o=await u;if(t!==this.#l)return;o&&(this.#t=o),this.#b();const a=await r;t===this.#l&&(a!=null&&(this.#t={...this.#t||{},totalRawBurnWei:BigInt(a)}),this.#b())}#b(){const t=this.querySelector('[data-bind="dbb-shell"]');if(this.hidden=!this.#s,t&&(t.hidden=!this.#s),!this.#s||!t)return;const n=this.querySelector('[data-bind="dbb-level"]');n&&(n.textContent=this.#e==null?"—":String(this.#e));const e=this.#t?.futurePoolWei??this.#g?.prizePools?.futurePrizePool,i=this.#e==null?null:Q(e,this.#e),u=[["dbb-prize",i==null?"—":X(i)],["dbb-burned",this.#t?.totalRawBurnWei==null?"—":S(this.#t.totalRawBurnWei)],["dbb-player-score",this.#t?.totalBurnWeight==null?"—":S(this.#t.totalBurnWeight)]];for(const[c,b]of u){const f=this.querySelector(`[data-bind="${c}"]`);f&&(f.textContent=b)}const r=this.#t?.activityScore,o=r==null?null:z(r,{level:this.#e}),a=this.querySelector('[data-bind="dbb-bracket-number"]'),l=this.querySelector('[data-bind="dbb-bracket-range"]');if(a&&(a.textContent=o==null?"—":String(o.bucket)),l){const c=o==null?null:o.maxScore==null?`${o.minScore.toLocaleString("en-US")}+`:`${o.minScore.toLocaleString("en-US")}–${o.maxScore.toLocaleString("en-US")}`;l.textContent=c||"—";const b=U(r);b?l.setAttribute("data-score-tier",b):l.removeAttribute("data-score-tier")}this.#r(decimatorBoonBps(v("app.boons")))}#v(){const t=L(),n=v("connected.address");return!!(t&&n&&String(t).toLowerCase()===String(n).toLowerCase()&&v("ui.mode")==="self")}#r(t=null){const n=this.querySelector('[name="dbb-amount"]'),e=this.querySelector('[data-bind="dbb-quote"]'),i=this.querySelector('[data-bind="dbb-burn"]'),u=this.querySelector('[data-bind="dbb-burn-action"]'),r=B(n?.value),o=Number(this.#t?.activityScore);let a=null,l=0n,c=null,b=null,f=!1;if(r!=null&&r>=m&&Number.isFinite(o)&&this.#t?.activityScore!=null&&this.#t?.totalBaseBurnWei!=null){let h=0n;try{h=BigInt(this.#t?.totalBaseBurnWei??0)}catch{h=0n}const p={amountWei:r,previousBaseWei:h,activityScore:Math.max(0,Math.trunc(o)),dayOneActive:this.#t?.dayOneActive===!0,lastPurchaseDay:this.#t?.lastPurchaseDay===!0,boonBps:t??decimatorBoonBps(v("app.boons"))};if(a=$(p),p.boonBps>0){const E=$({...p,boonBps:0});l=a>E?a-E:0n}c=G(p),b=H(p),f=V(p)}if(e){const h=a!=null&&l>0n;if(e.textContent=r!=null&&r<m?"MIN 1,000 FLIP":a==null?"SCORE —":formatDecimatorBurnQuote(a,l),e.classList?.toggle("has-boon",h),h){const p=`Adds ${S(a)} score, including ${S(l)} from Decimator boon`;e.setAttribute?.("title",p),e.setAttribute?.("aria-label",p)}else e.removeAttribute?.("title"),e.removeAttribute?.("aria-label")}u&&(u.textContent=this.#c?"BURNING…":"BURN FLIP");const y=this.querySelector('[data-bind="dbb-live-multi"]');y&&(y.textContent=c==null?"—":tt(c));const _=this.querySelector('[data-bind="dbb-multi-cap"]');if(_){const h=f&&c!=null&&c<=10000n;_.hidden=!h,_.textContent=h?b===c?"(CAPPED)":"(BASE CAPPED)":""}i&&(i.disabled=this.#c||!this.#s||!this.#v()||r==null||r<m)}#p(t,n=!1){const e=this.querySelector('[data-bind="dbb-feedback"]');if(e&&(e.textContent=String(t||""),e.hidden=!t,e.classList?.toggle("is-error",!!n),this.#n!=null&&clearTimeout(this.#n),this.#n=null,t)){this.#n=setTimeout(()=>{e.hidden=!0,e.textContent=""},1e4);try{this.#n?.unref?.()}catch{}}}async#_(){if(this.#c||!this.#s||!this.#v())return;const t=this.querySelector('[name="dbb-amount"]'),n=B(t?.value);if(n==null||n<m){this.#p("Minimum burn is 1,000 FLIP.",!0);return}const e=L();if(e){this.#c=!0,this.#p(""),this.#r();try{const{receipt:i}=await w({player:e,amount:n});this.#p("BURN CONFIRMED");try{this.dispatchEvent(new CustomEvent("app-decimator:burn-confirmed",{bubbles:!0,detail:{player:e,amountWei:n,transactionHash:i?.hash||i?.transactionHash||null}}))}catch{}this.#i!=null&&clearTimeout(this.#i),this.#i=setTimeout(()=>{this.#d()},J);try{this.#i?.unref?.()}catch{}}catch(i){this.#p(K(i,"Decimator burn did not go through."),!0)}finally{this.#c=!1,this.#r()}}}}typeof customElements<"u"&&!customElements.get("app-decimator-burn")&&customElements.define("app-decimator-burn",et);export function __setDecimatorBurnWidgetDepsForTest({game:s,context:t,rawBurn:n,burn:e}={}){typeof s=="function"&&(I=s),typeof t=="function"&&(P=t),typeof n=="function"&&(C=n),typeof e=="function"&&(w=e)}d(__setDecimatorBurnWidgetDepsForTest,"__setDecimatorBurnWidgetDepsForTest");export function __resetDecimatorBurnWidgetDepsForTest(){I=T,P=q,C=F,w=N}d(__resetDecimatorBurnWidgetDepsForTest,"__resetDecimatorBurnWidgetDepsForTest");export{B as parseDecimatorFlipInput};
//# sourceMappingURL=app-decimator-burn.js.map
