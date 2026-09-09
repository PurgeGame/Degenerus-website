var C=Object.defineProperty;var r=(n,s)=>C(n,"name",{value:s,configurable:!0});import{fetchJSON as A}from"../app/api.js";import{registerComponentPoll as B}from"../app/component-poll.js";import{TX_CONFIRMED_EVENT as w}from"../app/contracts.js";import{displayEth as E}from"../app/scaling.js";import{readGnrusLifetimeFunding as D}from"../app/charity-vote.js";import{formatSdgnrsRedemptionAmount as u,previewSdgnrsBurn as G,SDGNRS_BURN_DIALOG_REQUEST_EVENT as T,SDGNRS_CHARITY_VOTE_DIALOG_REQUEST_EVENT as O}from"../app/sdgnrs.js";import{get as a,getViewedAddress as v,subscribe as k}from"../app/store.js";const c=10n**18n,x=3e4;function l(n){try{const s=BigInt(n??0);return s>0n?s:0n}catch{return 0n}}r(l,"_wei");function h(n){return String(n||"").trim().toLowerCase()||null}r(h,"_address");export function formatBurnRailSignificant(n){const s=Number(n);return!Number.isFinite(s)||s<0?"—":s===0?"0":new Intl.NumberFormat("en-US",{useGrouping:!1,maximumSignificantDigits:2}).format(s)}r(formatBurnRailSignificant,"formatBurnRailSignificant");export function formatBurnRailEth(n){return formatBurnRailSignificant(E(l(n),12))}r(formatBurnRailEth,"formatBurnRailEth");export function formatGnrusLifetimeFunding(n){if(n==null)return"—";try{const s=BigInt(n);if(s<0n)return"—";const[t,i=""]=E(s,3).split("."),e=i.replace(/0+$/,"");return`${BigInt(t).toLocaleString("en-US")}${e?`.${e}`:""}`}catch{return"—"}}r(formatGnrusLifetimeFunding,"formatGnrusLifetimeFunding");export function burnRailBalances(n){if(!n||typeof n!="object")return{sdgnrs:0n,dgnrs:0n,total:0n,known:!1};const s=l(n.sdgnrsBalance),t=l(n.dgnrsBalance);return{sdgnrs:s,dgnrs:t,total:s+t,known:!0}}r(burnRailBalances,"burnRailBalances");function I(n,s,t=""){n&&(n.disabled=!!s,s?(n.setAttribute("data-write-locked",""),n.setAttribute("data-write-lock-title",t),n.title=t):(n.removeAttribute("data-write-locked"),n.removeAttribute("data-write-lock-title"),n.removeAttribute("title")))}r(I,"_setWriteLock");export class AppSdgnrsBurnRail extends HTMLElement{static{r(this,"AppSdgnrsBurnRail")}#n=!1;#c=[];#h=null;#o=null;#f=!1;#u=0;#a=0;#i=null;#e=null;#s=null;#l=null;#r=!1;#m=null;#d=!1;#g=0;connectedCallback(){if(!this.#n){this.#n=!0,this.#w(),this.#E();for(const s of["connected.address","viewing.address","ui.mode","ui.chainOk"])this.#c.push(k(s,()=>this.#_()));this.#c.push(k("app.playerCombined",s=>{a("ui.mode")==="combined"&&(this.#e=s,this.#i=null,this.#t(),this.#p())})),this.#h=B(()=>this.#y(),x),typeof document<"u"&&(this.#o=()=>this.#S(),document.addEventListener?.(w,this.#o)),this.#_()}}disconnectedCallback(){for(const s of this.#c)try{s()}catch{}this.#c=[],typeof this.#h=="function"&&this.#h(),this.#o&&typeof document<"u"&&document.removeEventListener?.(w,this.#o),this.#h=null,this.#o=null,this.#f=!1,this.#u+=1,this.#a+=1,this.#g+=1,this.#d=!1,this.#n=!1}#w(){this.innerHTML=`
      <section class="sdgnrs-rail" data-bind="sdr-shell"
               aria-label="sDGNRS and DGNRS balances, expected burn value, and all-time GNRUS funding">
        <span class="sdgnrs-rail__logo" role="img" aria-label="sDGNRS">
          <img class="sdgnrs-rail__logo-frame"
               src="/badges-circular/crypto_06_ethereum_purple.svg" alt="">
          <img class="sdgnrs-rail__logo-mark"
               src="/specials/special_eth.svg" alt="">
        </span>

        <span class="sdgnrs-rail__metric sdgnrs-rail__metric--balances">
          <small>BALANCES</small>
          <strong class="sdgnrs-rail__balances">
            <span class="sdgnrs-rail__token">
              <b data-bind="sdr-sdgnrs">—</b><em>sDGNRS</em>
            </span>
            <i data-bind="sdr-dgnrs-divider" hidden aria-hidden="true">·</i>
            <span class="sdgnrs-rail__token sdgnrs-rail__token--dgnrs"
                  data-bind="sdr-dgnrs-wrap" hidden>
              <b data-bind="sdr-dgnrs">—</b><em>DGNRS</em>
            </span>
          </strong>
        </span>

        <span class="sdgnrs-rail__metric sdgnrs-rail__metric--value">
          <small>EXPECTED BURN VALUE</small>
          <strong class="sdgnrs-rail__value">
            <b data-bind="sdr-eth">—</b>
            <i data-bind="sdr-plus" hidden aria-hidden="true">+</i>
            <b class="sdgnrs-rail__flip" data-bind="sdr-flip" hidden
               title="FLIP backing pays only if the resolving coinflip wins"></b>
          </strong>
        </span>

        <span class="sdgnrs-rail__metric sdgnrs-rail__metric--gnrus"
              title="Cumulative stETH yield credited to GNRUS since this deployment began">
          <small>GNRUS DONATIONS</small>
          <strong class="sdgnrs-rail__value sdgnrs-rail__gnrus">
            <b data-bind="sdr-gnrus">—</b><em>ETH</em>
          </strong>
        </span>

        <span class="sdgnrs-rail__actions">
          <button type="button" class="sdgnrs-rail__vote" data-bind="sdr-vote"
                  aria-haspopup="dialog" title="Open charity vote">
            <span aria-hidden="true">♥</span>
            <b class="sdgnrs-rail__vote-label"><span>CHARITY</span><span>VOTE</span></b>
          </button>
          <button type="button" class="sdgnrs-rail__burn" data-bind="sdr-burn"
                  data-write data-write-locked data-write-lock-title="Balance is loading"
                  aria-haspopup="dialog">
            <span class="sdgnrs-rail__burn-emblem" aria-hidden="true">
              <img src="/app/assets/jackpot/flame-center-silver.svg" alt="">
            </span>
            <b>BURN</b>
          </button>
        </span>
      </section>
    `}#E(){const s=this.querySelector('[data-bind="sdr-burn"]');s?.addEventListener("click",()=>{const e=burnRailBalances(this.#e).sdgnrs>=c?"sdgnrs":"dgnrs";this.#b(T,s,{preferredAsset:e})});const t=this.querySelector('[data-bind="sdr-vote"]');t?.addEventListener("click",()=>{this.#b(O,t)})}#b(s,t,i={}){typeof document>"u"||typeof CustomEvent!="function"||document.dispatchEvent(new CustomEvent(s,{detail:{trigger:t,...i}}))}#_(){const s=a("ui.mode")==="combined",t=s?null:h(v());(t!==this.#i||s)&&(this.#u+=1,this.#a+=1,this.#i=t,this.#e=s?a("app.playerCombined"):null,this.#s=null,this.#l=null,this.#r=!1),this.#t(),s&&this.#p(),this.#S()}#S(){!this.#n||this.#f||(this.#f=!0,queueMicrotask(()=>{this.#f=!1,this.#n&&this.#y()}))}async#y(){if(this.#v(),a("ui.mode")==="combined"){this.#e=a("app.playerCombined"),this.#i=null,this.#t(),this.#p();return}const s=h(v());if(s!==this.#i&&(this.#i=s,this.#e=null,this.#s=null,this.#l=null,this.#a+=1,this.#t()),!s)return;const t=++this.#u;try{const i=await A(`/player/${s}`);if(!this.#n||t!==this.#u||a("ui.mode")==="combined"||s!==this.#i)return;this.#e=i,this.#t(),this.#p()}catch{t===this.#u&&!this.#e&&this.#t()}}async#v(){if(this.#d)return;const s=++this.#g;this.#d=!0,this.#t();try{const t=await D();if(!this.#n||s!==this.#g)return;this.#m=l(t)}catch{}finally{this.#n&&s===this.#g&&(this.#d=!1,this.#t())}}#p(){const s=burnRailBalances(this.#e),t=s.total;if(!s.known||t<=0n){this.#a+=1,this.#s=null,this.#l=t,this.#r=!1,this.#t();return}if(this.#l===t&&(this.#s||this.#r))return;const i=++this.#a;this.#s=null,this.#l=t,this.#r=!0,this.#t(),G({amount:t,publicRead:!0}).then(e=>{!this.#n||i!==this.#a||t!==this.#l||(this.#s=e,this.#r=!1,this.#t())},()=>{!this.#n||i!==this.#a||t!==this.#l||(this.#s=null,this.#r=!1,this.#t())})}#k(){const s=h(a("connected.address"));return a("ui.mode")==="self"&&!!(s&&this.#i)&&s===this.#i}#t(){const s=this.querySelector('[data-bind="sdr-shell"]');if(!s)return;const t=burnRailBalances(this.#e),i=this.querySelector('[data-bind="sdr-sdgnrs"]'),e=this.querySelector('[data-bind="sdr-dgnrs"]'),f=this.querySelector('[data-bind="sdr-dgnrs-wrap"]'),g=this.querySelector('[data-bind="sdr-dgnrs-divider"]'),p=this.querySelector('[data-bind="sdr-eth"]'),d=this.querySelector('[data-bind="sdr-flip"]'),m=this.querySelector('[data-bind="sdr-plus"]'),b=this.querySelector('[data-bind="sdr-gnrus"]');i&&(i.textContent=t.known?u(t.sdgnrs):"—");const _=t.known&&t.dgnrs>0n;e&&(e.textContent=u(t.dgnrs)),f&&(f.hidden=!_),g&&(g.hidden=!_);const S=!!this.#s,o=S&&l(this.#s.flipOut)>0n;p&&(p.textContent=this.#r?"…":S?`≈${formatBurnRailEth(this.#s.ethOut)} ETH`:"—"),d&&(d.hidden=!o,d.textContent=o?`${u(this.#s.flipOut)} FLIP`:"",o&&d.setAttribute("aria-label",`${u(this.#s.flipOut)} FLIP backing if the resolving coinflip wins`)),m&&(m.hidden=!o),b&&(b.textContent=this.#d&&this.#m==null?"…":formatGnrusLifetimeFunding(this.#m)),s.classList?.toggle("is-loading",!t.known||this.#r),s.classList?.toggle("is-gnrus-loading",this.#d),s.classList?.toggle("is-readonly",a("ui.mode")!=="self");const N=this.querySelector('[data-bind="sdr-burn"]'),R=t.sdgnrs>=c||t.dgnrs>=c,y=this.#k(),q=!t.known||!y||!R,L=t.known?y?"Minimum burn is 1 sDGNRS or DGNRS":"Open your own wallet view to burn DGNRS":"Balance is loading";I(N,q,L)}}typeof customElements<"u"&&typeof customElements.define=="function"&&(customElements.get("app-sdgnrs-burn-rail")||customElements.define("app-sdgnrs-burn-rail",AppSdgnrsBurnRail));
//# sourceMappingURL=app-sdgnrs-burn-rail.js.map
