var T=Object.defineProperty;var l=(s,t)=>T(s,"name",{value:t,configurable:!0});import{displayEth as C,displayToken as x}from"../app/scaling.js";import{get as _,getActingAddress as g,getViewedAddress as E,subscribe as k}from"../app/store.js";import{readGameState as F}from"../app/game-state.js";import{activeBoonForProduct as R}from"../app/boons.js";import{burnForDecimator as $,DECIMATOR_MIN_FLIP_WEI as b,decimatorEffectiveMultiplierBps as M,decimatorStackCreditWei as q,decimatorPoolWei as O,decimatorWindowIsOpen as D,readDecimatorContext as N}from"../app/decimator.js";import{compactUiError as A}from"../app/ui-error.js";import{registerComponentPoll as U}from"../app/component-poll.js";import"./boon-product-indicator.js";import"./quest-objective-indicator.js";const W=15e3,z=350,m=10n**18n;let v=F,S=N,L=$;function I(s){try{const t=x(BigInt(s||0),0),e=Number(t);return Number.isSafeInteger(e)?e.toLocaleString("en-US"):t}catch{return"—"}}l(I,"_fmtFlip");function w(s){let t;try{t=BigInt(s??0)}catch{return"—"}const e=t<0n,n=(e?-t:t)/m,i=e?"-":"";if(n<1000n)return`${i}${n.toLocaleString("en-US")}`;const o=[[1000000000000n,"T"],[1000000000n,"B"],[1000000n,"M"],[1000n,"K"]],[r,p]=o.find(([B])=>n>=B),a=n/r,u=a>=100n?0:a>=10n?1:2,h=10n**BigInt(u),f=n*h/r,c=f/h,d=u===0?"":String(f%h).padStart(u,"0").replace(/0+$/,"");return`${i}${c}${d?`.${d}`:""}${p}`}l(w,"_compactFlip");export function formatDecimatorBurnQuote(s,t=0n){let e=0n;try{e=BigInt(t??0)}catch{e=0n}const n=w(s);return e>0n?`+${n} · +${w(e)} BOON`:`+${n} SCORE`}l(formatDecimatorBurnQuote,"formatDecimatorBurnQuote");function H(s){try{const t=C(BigInt(s||0),3).replace(/\.000$/,"").replace(/(\.\d*?)0+$/,"$1"),[e,n]=t.split("."),i=e.replace(/\B(?=(\d{3})+(?!\d))/g,",");return n==null?i:`${i}.${n}`}catch{return"—"}}l(H,"_fmtEth");function y(s){const t=String(s??"").trim().replace(/,/g,"").match(/^(\d+)(?:\.(\d{1,18}))?$/);return t?BigInt(t[1])*m+BigInt(String(t[2]||"").padEnd(18,"0")):null}l(y,"_parseFlip");function P(s){const t=BigInt(s||0),e=t/m,n=t%m;return n===0n?String(e):`${e}.${String(n).padStart(18,"0").replace(/0+$/,"")}`}l(P,"_inputFlip");function V(s,{signed:t=!1}={}){const e=Number(s||0);if(!Number.isFinite(e))return"—";const n=e/100,i=Number.isInteger(n)?String(n):n.toFixed(2).replace(/0+$/,"").replace(/\.$/,"");return`${t&&n>0?"+":""}${i}%`}l(V,"_percentFromBps");export function decimatorBoonBps(s){const t=Number(R(s,"decimator")?.row?.boonType||0);return t===13?1e3:t===14?2500:t===15?5e3:0}l(decimatorBoonBps,"decimatorBoonBps");class G extends HTMLElement{static{l(this,"AppDecimatorBurn")}#m=!1;#f=[];#d=null;#n=null;#e=null;#o=null;#a=null;#b=0;#y=null;#t=null;#i=null;#s=!1;#l=!1;#c="1000";connectedCallback(){if(!this.#m){this.#m=!0,this.#S(),this.#L();for(const t of["connected.address","viewing.address","ui.mode","app.boons"])this.#f.push(k(t,()=>{t==="app.boons"||t==="ui.mode"?this.#h():this.#u()}));this.#d=U(()=>this.#u(),W),this.#u()}}disconnectedCallback(){for(const t of this.#f)try{t()}catch{}this.#f=[],typeof this.#d=="function"&&this.#d(),this.#n!=null&&clearTimeout(this.#n),this.#e!=null&&clearTimeout(this.#e),typeof document<"u"&&(this.#o&&document.removeEventListener?.("quest:activate",this.#o),this.#a&&document.removeEventListener?.("app-decimator:burn-confirmed",this.#a)),this.#d=null,this.#n=null,this.#e=null,this.#o=null,this.#a=null,this.#b+=1,this.#m=!1}#S(){this.hidden=!0,this.innerHTML=`
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
          <span><small>YOUR SCORE</small><strong data-bind="dbb-player-score">—</strong></span>
        </article>
      </section>
    `}#L(){const t=this.querySelector('[name="dbb-amount"]');t?.addEventListener("input",()=>{this.#c=String(t.value||""),this.#r()}),t?.addEventListener("keydown",e=>{e?.key==="Enter"&&this.#_()}),this.querySelector('[data-bind="dbb-up"]')?.addEventListener("click",()=>this.#g(1)),this.querySelector('[data-bind="dbb-down"]')?.addEventListener("click",()=>this.#g(-1)),this.querySelector('[data-bind="dbb-burn"]')?.addEventListener("click",()=>this.#_()),typeof document<"u"&&(this.#o=e=>{if(Number(e?.detail?.questType)!==5)return;let n;try{n=BigInt(e?.detail?.target??0)}catch{n=0n}n<b&&(n=2000n*m),this.#c=P(n),t&&(t.value=this.#c),this.#r();try{this.scrollIntoView?.({behavior:"smooth",block:"center"})}catch{}e?.detail?.submit&&this.#_()},this.#a=e=>{e?.target!==this&&this.#u()},document.addEventListener?.("quest:activate",this.#o),document.addEventListener?.("app-decimator:burn-confirmed",this.#a))}#g(t){const e=this.querySelector('[name="dbb-amount"]'),n=y(e?.value),o=(n??b)+BigInt(t)*1000n*m,r=o<b?b:o;this.#c=P(r),e&&(e.value=this.#c),this.#r()}async#u(){const t=++this.#b;let e=null;try{e=await v()}catch{e=null}if(t!==this.#b)return;this.#y=e;const n=Number(e?.level);if(this.#i=Number.isInteger(n)&&n>=0?n+1:null,this.#s=this.#i!=null&&D(e),!this.#s){this.#t=null,this.#h();return}this.#h();const i=(typeof E=="function"?E():null)||g()||null,o=await S(i,this.#i).catch(()=>null);t===this.#b&&(o&&(this.#t=o),this.#h())}#h(){const t=this.querySelector('[data-bind="dbb-shell"]');if(this.hidden=!this.#s,t&&(t.hidden=!this.#s),!this.#s||!t)return;const e=this.querySelector('[data-bind="dbb-level"]');e&&(e.textContent=this.#i==null?"—":String(this.#i));const n=this.#t?.futurePoolWei??this.#y?.prizePools?.futurePrizePool,i=this.#i==null?null:O(n,this.#i),o=[["dbb-prize",i==null?"—":H(i)],["dbb-player-score",this.#t?.stackWei==null?"—":I(this.#t.stackWei)]];for(const[r,p]of o){const a=this.querySelector(`[data-bind="${r}"]`);a&&(a.textContent=p)}this.#r(decimatorBoonBps(_("app.boons")))}#v(){const t=g(),e=_("connected.address");return!!(t&&e&&String(t).toLowerCase()===String(e).toLowerCase()&&_("ui.mode")==="self")}#r(t=null){const e=this.querySelector('[name="dbb-amount"]'),n=this.querySelector('[data-bind="dbb-quote"]'),i=this.querySelector('[data-bind="dbb-burn"]'),o=this.querySelector('[data-bind="dbb-burn-action"]'),r=y(e?.value),p=Number(this.#t?.activityScore);let a=null,u=0n,h=null;if(r!=null&&r>=b&&Number.isFinite(p)&&this.#t?.activityScore!=null&&this.#t?.daysLate!=null){const c={amountWei:r,activityScore:Math.max(0,Math.trunc(p)),daysLate:this.#t.daysLate,boonBps:t??decimatorBoonBps(_("app.boons"))};if(a=q(c),c.boonBps>0){const d=q({...c,boonBps:0});u=a>d?a-d:0n}h=M(c)}if(n){const c=a!=null&&u>0n;if(n.textContent=r!=null&&r<b?"MIN 1,000 FLIP":a==null?"SCORE —":formatDecimatorBurnQuote(a,u),n.classList?.toggle("has-boon",c),c){const d=`Adds ${I(a)} to your score, including ${I(u)} from Decimator boon`;n.setAttribute?.("title",d),n.setAttribute?.("aria-label",d)}else n.removeAttribute?.("title"),n.removeAttribute?.("aria-label")}o&&(o.textContent=this.#l?"BURNING…":"BURN FLIP");const f=this.querySelector('[data-bind="dbb-live-multi"]');f&&(f.textContent=h==null?"—":V(h)),i&&(i.disabled=this.#l||!this.#s||!this.#v()||r==null||r<b)}#p(t,e=!1){const n=this.querySelector('[data-bind="dbb-feedback"]');if(n&&(n.textContent=String(t||""),n.hidden=!t,n.classList?.toggle("is-error",!!e),this.#e!=null&&clearTimeout(this.#e),this.#e=null,t)){this.#e=setTimeout(()=>{n.hidden=!0,n.textContent=""},1e4);try{this.#e?.unref?.()}catch{}}}async#_(){if(this.#l||!this.#s||!this.#v())return;const t=this.querySelector('[name="dbb-amount"]'),e=y(t?.value);if(e==null||e<b){this.#p("Minimum burn is 1,000 FLIP.",!0);return}const n=g();if(n){this.#l=!0,this.#p(""),this.#r();try{const{receipt:i}=await L({player:n,amount:e});this.#p("BURN CONFIRMED");try{this.dispatchEvent(new CustomEvent("app-decimator:burn-confirmed",{bubbles:!0,detail:{player:n,amountWei:e,transactionHash:i?.hash||i?.transactionHash||null}}))}catch{}this.#n!=null&&clearTimeout(this.#n),this.#n=setTimeout(()=>{this.#u()},z);try{this.#n?.unref?.()}catch{}}catch(i){this.#p(A(i,"Decimator burn did not go through."),!0)}finally{this.#l=!1,this.#r()}}}}typeof customElements<"u"&&!customElements.get("app-decimator-burn")&&customElements.define("app-decimator-burn",G);export function __setDecimatorBurnWidgetDepsForTest({game:s,context:t,burn:e}={}){typeof s=="function"&&(v=s),typeof t=="function"&&(S=t),typeof e=="function"&&(L=e)}l(__setDecimatorBurnWidgetDepsForTest,"__setDecimatorBurnWidgetDepsForTest");export function __resetDecimatorBurnWidgetDepsForTest(){v=F,S=N,L=$}l(__resetDecimatorBurnWidgetDepsForTest,"__resetDecimatorBurnWidgetDepsForTest");export{y as parseDecimatorFlipInput};
//# sourceMappingURL=app-decimator-burn.js.map
