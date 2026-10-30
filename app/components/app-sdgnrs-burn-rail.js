var x=Object.defineProperty;var a=(e,t)=>x(e,"name",{value:t,configurable:!0});import{readDisplaySnapshot as p,writeDisplaySnapshot as g}from"../app/local-display-cache.js";import{fetchJSON as O}from"../app/api.js";import{openPanelPopup as I,closePanelPopup as F}from"../app/panel-popups.js";import{registerComponentPoll as U}from"../app/component-poll.js";import{TX_CONFIRMED_EVENT as N}from"../app/contracts.js";import{displayEth as R}from"../app/scaling.js";import{readGnrusLifetimeFunding as P}from"../app/charity-vote.js";import{formatSdgnrsRedemptionAmount as h,previewSdgnrsBurn as $,SDGNRS_BURN_DIALOG_REQUEST_EVENT as H,SDGNRS_CHARITY_VOTE_DIALOG_REQUEST_EVENT as V}from"../app/sdgnrs.js";import{get as r,getViewedAddress as q,subscribe as A}from"../app/store.js";const f=10n**18n,M=3e4;function l(e){try{const t=BigInt(e??0);return t>0n?t:0n}catch{return 0n}}a(l,"_wei");function m(e){return String(e||"").trim().toLowerCase()||null}a(m,"_address");export function formatBurnRailSignificant(e){const t=Number(e);return!Number.isFinite(t)||t<0?"—":t===0?"0":new Intl.NumberFormat("en-US",{useGrouping:!1,maximumSignificantDigits:2}).format(t)}a(formatBurnRailSignificant,"formatBurnRailSignificant");export function formatBurnRailEth(e){return formatBurnRailSignificant(R(l(e),12))}a(formatBurnRailEth,"formatBurnRailEth");export function formatGnrusLifetimeFunding(e){if(e==null)return"—";try{const t=BigInt(e);if(t<0n)return"—";const[s,n=""]=R(t,3).split("."),i=n.replace(/0+$/,"");return`${BigInt(s).toLocaleString("en-US")}${i?`.${i}`:""}`}catch{return"—"}}a(formatGnrusLifetimeFunding,"formatGnrusLifetimeFunding");export function burnRailBalances(e){if(!e||typeof e!="object")return{sdgnrs:0n,dgnrs:0n,total:0n,known:!1};const t=l(e.sdgnrsBalance),s=l(e.dgnrsBalance);return{sdgnrs:t,dgnrs:s,total:t+s,known:!0}}a(burnRailBalances,"burnRailBalances");function Q(e,t,s=""){e&&(e.disabled=!!t,t?(e.setAttribute("data-write-locked",""),e.setAttribute("data-write-lock-title",s),e.title=s):(e.removeAttribute("data-write-locked"),e.removeAttribute("data-write-lock-title"),e.removeAttribute("title")))}a(Q,"_setWriteLock");export class AppSdgnrsBurnRail extends HTMLElement{static{a(this,"AppSdgnrsBurnRail")}#e=!1;#c=[];#h=null;#l=null;#p=!1;#o=0;#r=0;#t=null;#n=null;#i=null;#d=null;#a=!1;#m=null;#u=!1;#g=0;connectedCallback(){if(!this.#e){this.#e=!0,this.#S(),this.#k();for(const t of["connected.address","viewing.address","ui.mode","ui.chainOk"])this.#c.push(A(t,()=>this.#_()));this.#c.push(A("app.playerCombined",t=>{r("ui.mode")==="combined"&&(this.#n=t,this.#t=null,this.#s(),this.#f())})),this.#h=U(()=>this.#v(),M,{owner:this}),typeof document<"u"&&(this.#l=()=>this.#y(),document.addEventListener?.(N,this.#l)),this.#_()}}disconnectedCallback(){F("token-details",{restoreFocus:!1});for(const t of this.#c)try{t()}catch{}this.#c=[],typeof this.#h=="function"&&this.#h(),this.#l&&typeof document<"u"&&document.removeEventListener?.(N,this.#l),this.#h=null,this.#l=null,this.#p=!1,this.#o+=1,this.#r+=1,this.#g+=1,this.#u=!1,this.#e=!1}#S(){this.innerHTML=`
      <section class="sdgnrs-rail" data-bind="sdr-shell"
               aria-label="sDGNRS and DGNRS balances, expected burn value, and all-time GNRUS funding">
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
        <div class="sdgnrs-rail__charity">
          <button type="button" class="sdgnrs-rail__vote" data-bind="sdr-vote"
                  aria-haspopup="dialog" title="Vote for charity. Total donated is the cumulative yield credited to GNRUS since deployment.">
            <span aria-hidden="true">♥</span>
            <b class="sdgnrs-rail__vote-label"><span>CHARITY</span><span>VOTE</span></b>
            <small class="sdgnrs-rail__donated"><b data-bind="sdr-gnrus-total">—</b> ETH DONATED</small>
          </button>
        </div>
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
    `}#k(){const t=this.querySelector('[data-bind="sdr-info"]');t?.addEventListener("click",()=>{I("token-details",t,this.querySelector('[data-bind="sdr-info-dialog"]')),t.setAttribute("aria-expanded","true")}),this.querySelector('[data-bind="sdr-info-dialog"]')?.addEventListener("app:panel-close",()=>{t?.setAttribute("aria-expanded","false")});const s=this.querySelector('[data-bind="sdr-burn"]');s?.addEventListener("click",()=>{const o=burnRailBalances(this.#n).sdgnrs>=f?"sdgnrs":"dgnrs";this.#b(H,s,{preferredAsset:o})});const n=this.querySelector('[data-bind="sdr-vote"]');n?.addEventListener("click",()=>{this.#b(V,n)})}#b(t,s,n={}){typeof document>"u"||typeof CustomEvent!="function"||document.dispatchEvent(new CustomEvent(t,{detail:{trigger:s,...n}}))}#_(){const t=r("ui.mode")==="combined",s=t?null:m(q());(s!==this.#t||t)&&(this.#o+=1,this.#r+=1,this.#t=s,this.#n=t?r("app.playerCombined"):null,this.#i=null,this.#d=null,this.#a=!1),this.#s(),t&&this.#f(),this.#y()}#y(){!this.#e||this.#p||(this.#p=!0,queueMicrotask(()=>{this.#p=!1,this.#e&&this.#v()}))}async#v(){if(this.#w(),r("ui.mode")==="combined"){this.#n=r("app.playerCombined"),this.#t=null,this.#s(),this.#f();return}const t=m(q());if(t!==this.#t&&(this.#t=t,this.#n=null,this.#i=null,this.#d=null,this.#r+=1,this.#s()),!t)return;const s=++this.#o;try{const n=await O(`/player/${t}`);if(!this.#e||s!==this.#o||r("ui.mode")==="combined"||t!==this.#t)return;this.#n=n,(n?.sdgnrsBalance!=null||n?.dgnrsBalance!=null)&&g(`token-dgnrs:${t}`,{sdgnrsBalance:n.sdgnrsBalance,dgnrsBalance:n.dgnrsBalance}),this.#s(),this.#f()}catch{s===this.#o&&!this.#n&&this.#s()}}async#w(){if(this.#u)return;const t=++this.#g;this.#u=!0,this.#s();try{const s=await P();if(!this.#e||t!==this.#g)return;this.#m=l(s),g("token-gnrus",this.#m)}catch{}finally{this.#e&&t===this.#g&&(this.#u=!1,this.#s())}}#f(){const t=burnRailBalances(this.#n),s=t.total;if(!t.known||s<=0n){this.#r+=1,this.#i=null,this.#d=s,this.#a=!1,this.#s();return}if(this.#d===s&&(this.#i||this.#a))return;const n=++this.#r;this.#i=null,this.#d=s,this.#a=!0,this.#s(),$({amount:s,publicRead:!0}).then(i=>{!this.#e||n!==this.#r||s!==this.#d||(this.#i=i,i&&this.#t&&g(`token-dgnrs-quote:${this.#t}`,{amount:s,quote:i}),this.#a=!1,this.#s())},()=>{!this.#e||n!==this.#r||s!==this.#d||(this.#i=null,this.#a=!1,this.#s())})}#E(){const t=m(r("connected.address"));return r("ui.mode")==="self"&&!!(t&&this.#t)&&t===this.#t}#s(){const t=this.querySelector('[data-bind="sdr-shell"]');if(!t)return;const s=burnRailBalances(this.#n),n=s.known?s:burnRailBalances(this.#t?p(`token-dgnrs:${this.#t}`)?.value:null),i=this.querySelector('[data-bind="sdr-sdgnrs"]'),o=this.querySelector('[data-bind="sdr-dgnrs"]'),b=this.querySelector('[data-bind="sdr-dgnrs-wrap"]'),_=this.querySelector('[data-bind="sdr-dgnrs-divider"]'),y=this.querySelector('[data-bind="sdr-eth"]'),u=this.querySelector('[data-bind="sdr-flip"]'),v=this.querySelector('[data-bind="sdr-plus"]'),T=this.querySelectorAll('[data-bind="sdr-gnrus"], [data-bind="sdr-gnrus-total"]');i&&(i.textContent=n.known?h(n.sdgnrs):"—");const S=n.known&&n.dgnrs>0n;o&&(o.textContent=h(n.dgnrs)),b&&(b.hidden=!S),_&&(_.hidden=!S);const k=this.#t?p(`token-dgnrs-quote:${this.#t}`)?.value:null,d=this.#i??(k?.amount===n.total?k.quote:null),w=!!d,c=w&&l(d.flipOut)>0n;y&&(y.textContent=w?`≈${formatBurnRailEth(d.ethOut)} ETH`:this.#a?"…":"—"),u&&(u.hidden=!c,u.textContent=c?`${h(d.flipOut)} FLIP`:"",c&&u.setAttribute("aria-label",`${h(d.flipOut)} FLIP backing if the resolving coinflip wins`)),v&&(v.hidden=!c);for(const C of T)C.textContent=formatGnrusLifetimeFunding(this.#m??p("token-gnrus")?.value);t.classList?.toggle("is-loading",!s.known||this.#a),t.classList?.toggle("is-gnrus-loading",this.#u),t.classList?.toggle("is-readonly",r("ui.mode")!=="self");const B=this.querySelector('[data-bind="sdr-burn"]'),L=s.sdgnrs>=f||s.dgnrs>=f,E=this.#E(),D=!s.known||!E||!L,G=s.known?E?"Minimum burn is 1 sDGNRS or DGNRS":"Open your own wallet view to burn DGNRS":"Balance is loading";Q(B,D,G)}}typeof customElements<"u"&&typeof customElements.define=="function"&&(customElements.get("app-sdgnrs-burn-rail")||customElements.define("app-sdgnrs-burn-rail",AppSdgnrsBurnRail));
//# sourceMappingURL=app-sdgnrs-burn-rail.js.map
