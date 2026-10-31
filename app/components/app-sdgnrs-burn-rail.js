var O=Object.defineProperty;var r=(n,t)=>O(n,"name",{value:t,configurable:!0});import{readDisplaySnapshot as _,writeDisplaySnapshot as y}from"../app/local-display-cache.js";import{fetchJSON as x}from"../app/api.js";import{openPanelPopup as I,closePanelPopup as U}from"../app/panel-popups.js";import{registerComponentPoll as F}from"../app/component-poll.js";import{TX_CONFIRMED_EVENT as q}from"../app/contracts.js";import{displayEth as P,displayEthCompact as $}from"../app/scaling.js";import{readGnrusBalance as H}from"../app/gnrus.js";import{readGnrusLifetimeFunding as M}from"../app/charity-vote.js";import{formatSdgnrsRedemptionAmount as b,previewSdgnrsBurn as Q,SDGNRS_BURN_DIALOG_REQUEST_EVENT as V,SDGNRS_CHARITY_VOTE_DIALOG_REQUEST_EVENT as Y}from"../app/sdgnrs.js";import{get as a,getViewedAddress as A,subscribe as B}from"../app/store.js";const S=10n**18n,z=3e4;function u(n){try{const t=BigInt(n??0);return t>0n?t:0n}catch{return 0n}}r(u,"_wei");function v(n){return String(n||"").trim().toLowerCase()||null}r(v,"_address");export function formatBurnRailSignificant(n){const t=Number(n);return!Number.isFinite(t)||t<0?"—":t===0?"0":new Intl.NumberFormat("en-US",{useGrouping:!1,maximumSignificantDigits:2}).format(t)}r(formatBurnRailSignificant,"formatBurnRailSignificant");export function formatBurnRailEth(n){return $(u(n),2)}r(formatBurnRailEth,"formatBurnRailEth");export function formatGnrusLifetimeFunding(n){if(n==null)return"—";try{const t=BigInt(n);if(t<0n)return"—";const[s,e=""]=P(t,2).split("."),i=e.replace(/0+$/,"");return`${BigInt(s).toLocaleString("en-US")}${i?`.${i}`:""}`}catch{return"—"}}r(formatGnrusLifetimeFunding,"formatGnrusLifetimeFunding");export function burnRailBalances(n){if(!n||typeof n!="object")return{sdgnrs:0n,dgnrs:0n,total:0n,known:!1};const t=u(n.sdgnrsBalance),s=u(n.dgnrsBalance);return{sdgnrs:t,dgnrs:s,total:t+s,known:!0}}r(burnRailBalances,"burnRailBalances");function K(n,t,s=""){n&&(n.disabled=!!t,t?(n.setAttribute("data-write-locked",""),n.setAttribute("data-write-lock-title",s),n.title=s):(n.removeAttribute("data-write-locked"),n.removeAttribute("data-write-lock-title"),n.removeAttribute("title")))}r(K,"_setWriteLock");export class AppSdgnrsBurnRail extends HTMLElement{static{r(this,"AppSdgnrsBurnRail")}#n=!1;#p=[];#g=null;#d=null;#f=!1;#c=0;#r=0;#t=null;#e=null;#i=null;#o=null;#a=!1;#_=null;#u=!1;#b=0;#l=null;#h=0;connectedCallback(){if(!this.#n){this.#n=!0,this.#E(),this.#N();for(const t of["connected.address","viewing.address","ui.mode","ui.chainOk"])this.#p.push(B(t,()=>this.#S()));this.#p.push(B("app.playerCombined",t=>{a("ui.mode")==="combined"&&(this.#e=t,this.#t=null,this.#s(),this.#m())})),this.#g=F(()=>this.#k(),z,{owner:this}),typeof document<"u"&&(this.#d=()=>this.#v(),document.addEventListener?.(q,this.#d)),this.#S()}}disconnectedCallback(){U("token-details",{restoreFocus:!1});for(const t of this.#p)try{t()}catch{}this.#p=[],typeof this.#g=="function"&&this.#g(),this.#d&&typeof document<"u"&&document.removeEventListener?.(q,this.#d),this.#g=null,this.#d=null,this.#f=!1,this.#c+=1,this.#h+=1,this.#r+=1,this.#b+=1,this.#u=!1,this.#n=!1}#E(){this.innerHTML=`
      <section class="sdgnrs-rail" data-bind="sdr-shell"
               aria-label="sDGNRS balance and burn value">
        <div class="sdgnrs-rail__redemption" role="group" aria-label="Token redemption">


          <div class="sdgnrs-rail__heading">
            <h2>DGNRS / sDGNRS</h2>
            <button type="button" class="secondary-info" data-bind="sdr-info"
                    aria-label="Token backing and charity funding" title="Token backing and charity funding"
                    aria-haspopup="dialog" aria-expanded="false" aria-controls="panel-token-details"><span aria-hidden="true">i</span></button>
          </div>

          <span class="sdgnrs-rail__metric sdgnrs-rail__metric--balances">
            <small>BALANCE</small>
          <span class="sdgnrs-rail__logo" role="img" aria-label="sDGNRS">
            <img class="sdgnrs-rail__logo-frame"
                 src="/app/assets/degenerette/sdgnrs-logo.svg?v=larger-flames-20261002" alt="">
          </span>
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
            <small title="Approximate burn value">BURN VALUE</small>
            <strong class="sdgnrs-rail__value">
              <b data-bind="sdr-eth">—</b>
              <i data-bind="sdr-plus" hidden aria-hidden="true">+</i>
              <b class="sdgnrs-rail__flip" data-bind="sdr-flip" hidden
                 title="FLIP backing pays only if the resolving coinflip wins"></b>
            </strong>
          </span>

          <button type="button" class="sdgnrs-rail__burn" data-bind="sdr-burn"
                  data-write data-write-locked data-write-lock-title="Balance is loading"
                  aria-haspopup="dialog">
            <span class="sdgnrs-rail__burn-emblem" aria-hidden="true">
              <img src="/app/assets/jackpot/flame-center-silver.svg" alt="">
            </span>
            <b>BURN</b>
          </button>
        </div>
      </section>
      <section class="gnrus-rail" aria-label="GNRUS donations">
        <img class="gnrus-rail__logo" src="/shared/gnrus-logo.svg" width="44" height="44" alt="GNRUS">
        <strong class="gnrus-rail__total"><span class="gnrus-rail__amount"><b data-bind="sdr-gnrus-total">—</b><em>ETH</em></span><small>GNRUS</small></strong>
        <span class="gnrus-rail__caption">DONATED TO CHARITY</span>
        <div class="gnrus-rail__actions">
          <button type="button" data-bind="gnrus-action" aria-haspopup="dialog" disabled>DONATE</button>
          <button type="button" class="sdgnrs-rail__vote" data-bind="sdr-vote" aria-haspopup="dialog">VOTE</button>
        </div>
        <span data-bind="gnrus-feedback" role="status" hidden></span>
      </section>
      <section class="panel-popup secondary-popup" id="panel-token-details" data-panel-popup="token-details"
               data-bind="sdr-info-dialog" hidden role="dialog" aria-modal="true" aria-labelledby="token-details-title">
        <div class="panel-popup__window">
          <header class="panel-popup__header">
            <h2 id="token-details-title">TOKEN BACKING & CHARITY</h2>
            <button type="button" class="panel-popup__close" data-panel-close aria-label="Close token details">×</button>
          </header>
          <div class="panel-popup__body">
            <p class="secondary-popup__intro">Your sDGNRS and DGNRS balances share the same backing. This estimates the combined burn value of your holdings.</p>
            <div class="secondary-token-metrics">
                <span class="sdgnrs-rail__metric sdgnrs-rail__metric--gnrus"
                      title="Cumulative stETH yield credited to GNRUS since this deployment began">
                  <small>GNRUS DONATIONS</small>
                  <strong class="sdgnrs-rail__value sdgnrs-rail__gnrus">
                    <b data-bind="sdr-gnrus">—</b><em>ETH</em>
                  </strong>
                </span>
            </div>
            <p class="secondary-popup__intro">FLIP backing pays only if the resolving coinflip wins. GNRUS donations show the total stETH yield credited to charity since deployment.</p>
          </div>
        </div>
      </section>
    `}#N(){const t=this.querySelector('[data-bind="sdr-info"]');t?.addEventListener("click",()=>{I("token-details",t,this.querySelector('[data-bind="sdr-info-dialog"]')),t.setAttribute("aria-expanded","true")}),this.querySelector('[data-bind="sdr-info-dialog"]')?.addEventListener("app:panel-close",()=>{t?.setAttribute("aria-expanded","false")});const s=this.querySelector('[data-bind="sdr-burn"]');s?.addEventListener("click",()=>{const d=burnRailBalances(this.#e).sdgnrs>=S?"sdgnrs":"dgnrs";this.#y(V,s,{preferredAsset:d})});const e=this.querySelector('[data-bind="gnrus-action"]');e?.addEventListener("click",async()=>{e.disabled=!0;const l=this.#t,d=this.#l>0n?"redeem":"donate";try{const{openGnrusDialog:o}=await import("./gnrus-dialog.js");if(!this.#n||l!==this.#t||!this.#w())return;o({mode:d,owner:l,trigger:e})}catch{const o=this.querySelector('[data-bind="gnrus-feedback"]');o&&(o.textContent="Could not open GNRUS. Try again.",o.hidden=!1)}finally{this.#s()}});const i=this.querySelector('[data-bind="sdr-vote"]');i?.addEventListener("click",()=>{this.#y(Y,i)})}#y(t,s,e={}){typeof document>"u"||typeof CustomEvent!="function"||document.dispatchEvent(new CustomEvent(t,{detail:{trigger:s,...e}}))}#S(){const t=a("ui.mode")==="combined",s=t?null:v(A());(s!==this.#t||t)&&(this.#c+=1,this.#r+=1,this.#t=s,this.#l=null,this.#h+=1,this.#e=t?a("app.playerCombined"):null,this.#i=null,this.#o=null,this.#a=!1),this.#s(),t&&this.#m(),this.#v()}#v(){!this.#n||this.#f||(this.#f=!0,queueMicrotask(()=>{this.#f=!1,this.#n&&this.#k()}))}async#k(){if(this.#q(),this.#R(),a("ui.mode")==="combined"){this.#e=a("app.playerCombined"),this.#t=null,this.#s(),this.#m();return}const t=v(A());if(t!==this.#t&&(this.#t=t,this.#e=null,this.#i=null,this.#o=null,this.#r+=1,this.#s()),!t)return;const s=++this.#c;try{const e=await x(`/player/${t}`);if(!this.#n||s!==this.#c||a("ui.mode")==="combined"||t!==this.#t)return;this.#e=e,(e?.sdgnrsBalance!=null||e?.dgnrsBalance!=null)&&y(`token-dgnrs:${t}`,{sdgnrsBalance:e.sdgnrsBalance,dgnrsBalance:e.dgnrsBalance}),this.#s(),this.#m()}catch{s===this.#c&&!this.#e&&this.#s()}}async#R(){const t=this.#t;if(!t||a("ui.mode")==="combined")return;const s=++this.#h;try{const e=await H(t);if(!this.#n||s!==this.#h||t!==this.#t)return;this.#l=e}catch{}this.#n&&s===this.#h&&this.#s()}async#q(){if(this.#u)return;const t=++this.#b;this.#u=!0,this.#s();try{const s=await M();if(!this.#n||t!==this.#b)return;this.#_=u(s),y("token-gnrus",this.#_)}catch{}finally{this.#n&&t===this.#b&&(this.#u=!1,this.#s())}}#m(){const t=burnRailBalances(this.#e),s=t.total;if(!t.known||s<=0n){this.#r+=1,this.#i=null,this.#o=s,this.#a=!1,this.#s();return}if(this.#o===s&&(this.#i||this.#a))return;const e=++this.#r;this.#i=null,this.#o=s,this.#a=!0,this.#s(),Q({amount:s,publicRead:!0}).then(i=>{!this.#n||e!==this.#r||s!==this.#o||(this.#i=i,i&&this.#t&&y(`token-dgnrs-quote:${this.#t}`,{amount:s,quote:i}),this.#a=!1,this.#s())},()=>{!this.#n||e!==this.#r||s!==this.#o||(this.#i=null,this.#a=!1,this.#s())})}#w(){const t=v(a("connected.address"));return a("ui.mode")==="self"&&!!(t&&this.#t)&&t===this.#t}#s(){const t=this.querySelector('[data-bind="sdr-shell"]');if(!t)return;const s=burnRailBalances(this.#e),e=s.known?s:burnRailBalances(this.#t?_(`token-dgnrs:${this.#t}`)?.value:null),i=this.querySelector('[data-bind="sdr-sdgnrs"]'),l=this.querySelector('[data-bind="sdr-dgnrs"]'),d=this.querySelector('[data-bind="sdr-dgnrs-wrap"]'),o=this.querySelector('[data-bind="sdr-dgnrs-divider"]'),k=this.querySelector('[data-bind="sdr-eth"]'),h=this.querySelector('[data-bind="sdr-flip"]'),w=this.querySelector('[data-bind="sdr-plus"]'),G=this.querySelectorAll('[data-bind="sdr-gnrus"], [data-bind="sdr-gnrus-total"]');i&&(i.textContent=e.known?b(e.sdgnrs):"—");const E=e.known&&e.dgnrs>0n;l&&(l.textContent=b(e.dgnrs)),d&&(d.hidden=!E),o&&(o.hidden=!E);const N=this.#t?_(`token-dgnrs-quote:${this.#t}`)?.value:null,c=this.#i??(N?.amount===e.total?N.quote:null),R=!!c,p=R&&u(c.flipOut)>0n;k&&(k.textContent=R?`≈${formatBurnRailEth(c.ethOut)} ETH`:this.#a?"…":"—"),h&&(h.hidden=!p,h.textContent=p?`${b(c.flipOut)} FLIP`:"",p&&h.setAttribute("aria-label",`${b(c.flipOut)} FLIP backing if the resolving coinflip wins`)),w&&(w.hidden=!p);for(const m of G)m.textContent=formatGnrusLifetimeFunding(this.#_??_("token-gnrus")?.value),m.style.setProperty("--token-amount-chars",String(m.textContent.length));t.classList?.toggle("is-loading",!s.known||this.#a),t.classList?.toggle("is-gnrus-loading",this.#u),t.classList?.toggle("is-readonly",a("ui.mode")!=="self");const T=this.querySelector('[data-bind="sdr-burn"]'),C=s.sdgnrs>=S||s.dgnrs>=S,g=this.#w(),f=this.querySelector('[data-bind="gnrus-action"]');f&&(f.textContent=this.#l>0n?"REDEEM":"DONATE",f.disabled=!g||this.#l==null,f.title=g?this.#l==null?"Loading GNRUS balance":"":"Open your own wallet view");const D=!s.known||!g||!C,L=s.known?g?"Minimum burn is 1 sDGNRS or DGNRS":"Open your own wallet view to burn DGNRS":"Balance is loading";K(T,D,L)}}typeof customElements<"u"&&typeof customElements.define=="function"&&(customElements.get("app-sdgnrs-burn-rail")||customElements.define("app-sdgnrs-burn-rail",AppSdgnrsBurnRail));
//# sourceMappingURL=app-sdgnrs-burn-rail.js.map
