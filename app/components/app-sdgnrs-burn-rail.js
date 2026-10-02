var T=Object.defineProperty;var i=(e,t)=>T(e,"name",{value:t,configurable:!0});import{fetchJSON as G}from"../app/api.js";import{openPanelPopup as C,closePanelPopup as D}from"../app/panel-popups.js";import{registerComponentPoll as B}from"../app/component-poll.js";import{TX_CONFIRMED_EVENT as S}from"../app/contracts.js";import{displayEth as v}from"../app/scaling.js";import{readGnrusLifetimeFunding as O}from"../app/charity-vote.js";import{formatSdgnrsRedemptionAmount as u,previewSdgnrsBurn as x,SDGNRS_BURN_DIALOG_REQUEST_EVENT as I,SDGNRS_CHARITY_VOTE_DIALOG_REQUEST_EVENT as F}from"../app/sdgnrs.js";import{get as r,getViewedAddress as k,subscribe as w}from"../app/store.js";const h=10n**18n,P=3e4;function d(e){try{const t=BigInt(e??0);return t>0n?t:0n}catch{return 0n}}i(d,"_wei");function p(e){return String(e||"").trim().toLowerCase()||null}i(p,"_address");export function formatBurnRailSignificant(e){const t=Number(e);return!Number.isFinite(t)||t<0?"—":t===0?"0":new Intl.NumberFormat("en-US",{useGrouping:!1,maximumSignificantDigits:2}).format(t)}i(formatBurnRailSignificant,"formatBurnRailSignificant");export function formatBurnRailEth(e){return formatBurnRailSignificant(v(d(e),12))}i(formatBurnRailEth,"formatBurnRailEth");export function formatGnrusLifetimeFunding(e){if(e==null)return"—";try{const t=BigInt(e);if(t<0n)return"—";const[s,n=""]=v(t,3).split("."),a=n.replace(/0+$/,"");return`${BigInt(s).toLocaleString("en-US")}${a?`.${a}`:""}`}catch{return"—"}}i(formatGnrusLifetimeFunding,"formatGnrusLifetimeFunding");export function burnRailBalances(e){if(!e||typeof e!="object")return{sdgnrs:0n,dgnrs:0n,total:0n,known:!1};const t=d(e.sdgnrsBalance),s=d(e.dgnrsBalance);return{sdgnrs:t,dgnrs:s,total:t+s,known:!0}}i(burnRailBalances,"burnRailBalances");function U(e,t,s=""){e&&(e.disabled=!!t,t?(e.setAttribute("data-write-locked",""),e.setAttribute("data-write-lock-title",s),e.title=s):(e.removeAttribute("data-write-locked"),e.removeAttribute("data-write-lock-title"),e.removeAttribute("title")))}i(U,"_setWriteLock");export class AppSdgnrsBurnRail extends HTMLElement{static{i(this,"AppSdgnrsBurnRail")}#e=!1;#u=[];#h=null;#o=null;#p=!1;#c=0;#a=0;#n=null;#i=null;#t=null;#d=null;#r=!1;#m=null;#l=!1;#f=0;connectedCallback(){if(!this.#e){this.#e=!0,this.#v(),this.#k();for(const t of["connected.address","viewing.address","ui.mode","ui.chainOk"])this.#u.push(w(t,()=>this.#_()));this.#u.push(w("app.playerCombined",t=>{r("ui.mode")==="combined"&&(this.#i=t,this.#n=null,this.#s(),this.#g())})),this.#h=B(()=>this.#S(),P),typeof document<"u"&&(this.#o=()=>this.#y(),document.addEventListener?.(S,this.#o)),this.#_()}}disconnectedCallback(){D("token-details",{restoreFocus:!1});for(const t of this.#u)try{t()}catch{}this.#u=[],typeof this.#h=="function"&&this.#h(),this.#o&&typeof document<"u"&&document.removeEventListener?.(S,this.#o),this.#h=null,this.#o=null,this.#p=!1,this.#c+=1,this.#a+=1,this.#f+=1,this.#l=!1,this.#e=!1}#v(){this.innerHTML=`
      <section class="sdgnrs-rail" data-bind="sdr-shell"
               aria-label="sDGNRS and DGNRS balances, expected burn value, and all-time GNRUS funding">
        <span class="sdgnrs-rail__logo" role="img" aria-label="sDGNRS">
          <img class="sdgnrs-rail__logo-frame"
               src="/app/assets/degenerette/sdgnrs-logo.svg?v=larger-flames-20261002" alt="">
        </span>

        <div class="sdgnrs-rail__heading">
          <h2>DGNRS / sDGNRS</h2>
          <button type="button" class="secondary-info" data-bind="sdr-info"
                  aria-label="Token backing and charity funding" title="Token backing and charity funding"
                  aria-haspopup="dialog" aria-expanded="false" aria-controls="panel-token-details"><span aria-hidden="true">i</span></button>
        </div>

        <span class="sdgnrs-rail__metric sdgnrs-rail__metric--balances">
          <small>BALANCE</small>
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
          <small>APPROX. BURN VALUE</small>
          <strong class="sdgnrs-rail__value">
            <b data-bind="sdr-eth">—</b>
            <i data-bind="sdr-plus" hidden aria-hidden="true">+</i>
            <b class="sdgnrs-rail__flip" data-bind="sdr-flip" hidden
               title="FLIP backing pays only if the resolving coinflip wins"></b>
          </strong>
        </span>

        <span class="sdgnrs-rail__actions">
          <button type="button" class="sdgnrs-rail__vote" data-bind="sdr-vote"
                  aria-haspopup="dialog" title="Vote for charity. Total donated is the cumulative yield credited to GNRUS since deployment.">
            <span aria-hidden="true">♥</span>
            <b class="sdgnrs-rail__vote-label"><span>CHARITY</span><span>VOTE</span></b>
            <small class="sdgnrs-rail__donated"><b data-bind="sdr-gnrus-total">—</b> ETH DONATED</small>
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
    `}#k(){const t=this.querySelector('[data-bind="sdr-info"]');t?.addEventListener("click",()=>{C("token-details",t,this.querySelector('[data-bind="sdr-info-dialog"]')),t.setAttribute("aria-expanded","true")}),this.querySelector('[data-bind="sdr-info-dialog"]')?.addEventListener("app:panel-close",()=>{t?.setAttribute("aria-expanded","false")});const s=this.querySelector('[data-bind="sdr-burn"]');s?.addEventListener("click",()=>{const l=burnRailBalances(this.#i).sdgnrs>=h?"sdgnrs":"dgnrs";this.#b(I,s,{preferredAsset:l})});const n=this.querySelector('[data-bind="sdr-vote"]');n?.addEventListener("click",()=>{this.#b(F,n)})}#b(t,s,n={}){typeof document>"u"||typeof CustomEvent!="function"||document.dispatchEvent(new CustomEvent(t,{detail:{trigger:s,...n}}))}#_(){const t=r("ui.mode")==="combined",s=t?null:p(k());(s!==this.#n||t)&&(this.#c+=1,this.#a+=1,this.#n=s,this.#i=t?r("app.playerCombined"):null,this.#t=null,this.#d=null,this.#r=!1),this.#s(),t&&this.#g(),this.#y()}#y(){!this.#e||this.#p||(this.#p=!0,queueMicrotask(()=>{this.#p=!1,this.#e&&this.#S()}))}async#S(){if(this.#w(),r("ui.mode")==="combined"){this.#i=r("app.playerCombined"),this.#n=null,this.#s(),this.#g();return}const t=p(k());if(t!==this.#n&&(this.#n=t,this.#i=null,this.#t=null,this.#d=null,this.#a+=1,this.#s()),!t)return;const s=++this.#c;try{const n=await G(`/player/${t}`);if(!this.#e||s!==this.#c||r("ui.mode")==="combined"||t!==this.#n)return;this.#i=n,this.#s(),this.#g()}catch{s===this.#c&&!this.#i&&this.#s()}}async#w(){if(this.#l)return;const t=++this.#f;this.#l=!0,this.#s();try{const s=await O();if(!this.#e||t!==this.#f)return;this.#m=d(s)}catch{}finally{this.#e&&t===this.#f&&(this.#l=!1,this.#s())}}#g(){const t=burnRailBalances(this.#i),s=t.total;if(!t.known||s<=0n){this.#a+=1,this.#t=null,this.#d=s,this.#r=!1,this.#s();return}if(this.#d===s&&(this.#t||this.#r))return;const n=++this.#a;this.#t=null,this.#d=s,this.#r=!0,this.#s(),x({amount:s,publicRead:!0}).then(a=>{!this.#e||n!==this.#a||s!==this.#d||(this.#t=a,this.#r=!1,this.#s())},()=>{!this.#e||n!==this.#a||s!==this.#d||(this.#t=null,this.#r=!1,this.#s())})}#E(){const t=p(r("connected.address"));return r("ui.mode")==="self"&&!!(t&&this.#n)&&t===this.#n}#s(){const t=this.querySelector('[data-bind="sdr-shell"]');if(!t)return;const s=burnRailBalances(this.#i),n=this.querySelector('[data-bind="sdr-sdgnrs"]'),a=this.querySelector('[data-bind="sdr-dgnrs"]'),l=this.querySelector('[data-bind="sdr-dgnrs-wrap"]'),f=this.querySelector('[data-bind="sdr-dgnrs-divider"]'),g=this.querySelector('[data-bind="sdr-eth"]'),o=this.querySelector('[data-bind="sdr-flip"]'),m=this.querySelector('[data-bind="sdr-plus"]'),E=this.querySelectorAll('[data-bind="sdr-gnrus"], [data-bind="sdr-gnrus-total"]');n&&(n.textContent=s.known?u(s.sdgnrs):"—");const b=s.known&&s.dgnrs>0n;a&&(a.textContent=u(s.dgnrs)),l&&(l.hidden=!b),f&&(f.hidden=!b);const _=!!this.#t,c=_&&d(this.#t.flipOut)>0n;g&&(g.textContent=this.#r?"…":_?`≈${formatBurnRailEth(this.#t.ethOut)} ETH`:"—"),o&&(o.hidden=!c,o.textContent=c?`${u(this.#t.flipOut)} FLIP`:"",c&&o.setAttribute("aria-label",`${u(this.#t.flipOut)} FLIP backing if the resolving coinflip wins`)),m&&(m.hidden=!c);for(const L of E)L.textContent=this.#l&&this.#m==null?"…":formatGnrusLifetimeFunding(this.#m);t.classList?.toggle("is-loading",!s.known||this.#r),t.classList?.toggle("is-gnrus-loading",this.#l),t.classList?.toggle("is-readonly",r("ui.mode")!=="self");const N=this.querySelector('[data-bind="sdr-burn"]'),R=s.sdgnrs>=h||s.dgnrs>=h,y=this.#E(),q=!s.known||!y||!R,A=s.known?y?"Minimum burn is 1 sDGNRS or DGNRS":"Open your own wallet view to burn DGNRS":"Balance is loading";U(N,q,A)}}typeof customElements<"u"&&typeof customElements.define=="function"&&(customElements.get("app-sdgnrs-burn-rail")||customElements.define("app-sdgnrs-burn-rail",AppSdgnrsBurnRail));
//# sourceMappingURL=app-sdgnrs-burn-rail.js.map
