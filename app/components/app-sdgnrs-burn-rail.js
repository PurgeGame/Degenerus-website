var I=Object.defineProperty;var a=(i,t)=>I(i,"name",{value:t,configurable:!0});import{readDisplaySnapshot as b,writeDisplaySnapshot as _}from"../app/local-display-cache.js";import{fetchJSON as F}from"../app/api.js";import{registerComponentPoll as U}from"../app/component-poll.js";import{TX_CONFIRMED_EVENT as A}from"../app/contracts.js";import{displayEth as $,displayEthCompact as M}from"../app/scaling.js";import{readGnrusBalance as P,readGnrusRedemption as V,gnrusRedemptionValue as H}from"../app/gnrus.js";import{readGnrusLifetimeFunding as Q}from"../app/charity-vote.js";import{formatSdgnrsRedemptionAmount as m,previewSdgnrsBurn as z,SDGNRS_BURN_DIALOG_REQUEST_EVENT as W,SDGNRS_CHARITY_VOTE_DIALOG_REQUEST_EVENT as Y}from"../app/sdgnrs.js";import{get as r,getViewedAddress as C,subscribe as D}from"../app/store.js";const y=10n**18n,j=3e4;function u(i){try{const t=BigInt(i??0);return t>0n?t:0n}catch{return 0n}}a(u,"_wei");function S(i){return String(i||"").trim().toLowerCase()||null}a(S,"_address");export function formatBurnRailSignificant(i){const t=Number(i);return!Number.isFinite(t)||t<0?"—":t===0?"0":new Intl.NumberFormat("en-US",{useGrouping:!1,maximumSignificantDigits:2}).format(t)}a(formatBurnRailSignificant,"formatBurnRailSignificant");export function formatBurnRailEth(i){return M(u(i),2)}a(formatBurnRailEth,"formatBurnRailEth");export function formatGnrusLifetimeFunding(i){if(i==null)return"—";try{const t=BigInt(i);if(t<0n)return"—";const[s,n=""]=$(t,2).split("."),e=n.replace(/0+$/,"");return`${BigInt(s).toLocaleString("en-US")}${e?`.${e}`:""}`}catch{return"—"}}a(formatGnrusLifetimeFunding,"formatGnrusLifetimeFunding");export function burnRailBalances(i){if(!i||typeof i!="object")return{sdgnrs:0n,dgnrs:0n,total:0n,known:!1};const t=u(i.sdgnrsBalance),s=u(i.dgnrsBalance);return{sdgnrs:t,dgnrs:s,total:t+s,known:!0}}a(burnRailBalances,"burnRailBalances");function J(i,t,s=""){i&&(i.disabled=!!t,t?(i.setAttribute("data-write-locked",""),i.setAttribute("data-write-lock-title",s),i.title=s):(i.removeAttribute("data-write-locked"),i.removeAttribute("data-write-lock-title"),i.removeAttribute("title")))}a(J,"_setWriteLock");export class AppSdgnrsBurnRail extends HTMLElement{static{a(this,"AppSdgnrsBurnRail")}#n=!1;#g=[];#f=null;#u=null;#p=!1;#c=0;#o=0;#t=null;#i=null;#r=null;#l=null;#a=!1;#y=null;#h=!1;#m=0;#e=null;#b=null;#d=0;connectedCallback(){if(!this.#n){this.#n=!0,this.#R(),this.#q();for(const t of["connected.address","viewing.address","ui.mode","ui.chainOk"])this.#g.push(D(t,()=>this.#w()));this.#g.push(D("app.playerCombined",t=>{r("ui.mode")==="combined"&&(this.#i=t,this.#t=null,this.#s(),this.#_())})),this.#f=U(()=>this.#v(),j,{owner:this}),typeof document<"u"&&(this.#u=()=>this.#E(),document.addEventListener?.(A,this.#u)),this.#w()}}disconnectedCallback(){for(const t of this.#g)try{t()}catch{}this.#g=[],typeof this.#f=="function"&&this.#f(),this.#u&&typeof document<"u"&&document.removeEventListener?.(A,this.#u),this.#f=null,this.#u=null,this.#p=!1,this.#c+=1,this.#d+=1,this.#o+=1,this.#m+=1,this.#h=!1,this.#n=!1}#R(){this.innerHTML=`
      <section class="sdgnrs-rail" data-bind="sdr-shell"
               aria-label="sDGNRS balance and burn value">
        <div class="sdgnrs-rail__redemption" role="group" aria-label="Token redemption">


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
    `}#q(){const t=this.querySelector('[data-bind="sdr-burn"]');t?.addEventListener("click",()=>{const l=burnRailBalances(this.#i).sdgnrs>=y?"sdgnrs":"dgnrs";this.#S(W,t,{preferredAsset:l})});const s=this.querySelector('[data-bind="gnrus-action"]');s?.addEventListener("click",async()=>{s.disabled=!0;const e=this.#t,l=this.#e>0n?"redeem":"donate";try{const{openGnrusDialog:o}=await import("./gnrus-dialog.js");if(!this.#n||e!==this.#t||!this.#k())return;o({mode:l,owner:e,trigger:s})}catch{const o=this.querySelector('[data-bind="gnrus-feedback"]');o&&(o.textContent="Could not open GNRUS. Try again.",o.hidden=!1)}finally{this.#s()}});const n=this.querySelector('[data-bind="sdr-vote"]');n?.addEventListener("click",()=>{this.#S(Y,n)})}#S(t,s,n={}){typeof document>"u"||typeof CustomEvent!="function"||document.dispatchEvent(new CustomEvent(t,{detail:{trigger:s,...n}}))}#w(){const t=r("ui.mode")==="combined",s=t?null:S(C());(s!==this.#t||t)&&(this.#c+=1,this.#o+=1,this.#t=s,this.#e=null,this.#b=null,this.#d+=1,this.#i=t?r("app.playerCombined"):null,this.#r=null,this.#l=null,this.#a=!1),this.#s(),t&&this.#_(),this.#E()}#E(){!this.#n||this.#p||(this.#p=!0,queueMicrotask(()=>{this.#p=!1,this.#n&&this.#v()}))}async#v(){if(this.#N(),this.#B(),r("ui.mode")==="combined"){this.#i=r("app.playerCombined"),this.#t=null,this.#s(),this.#_();return}const t=S(C());if(t!==this.#t&&(this.#t=t,this.#i=null,this.#r=null,this.#l=null,this.#o+=1,this.#s()),!t)return;const s=++this.#c;try{const n=await F(`/player/${t}`);if(!this.#n||s!==this.#c||r("ui.mode")==="combined"||t!==this.#t)return;this.#i=n,(n?.sdgnrsBalance!=null||n?.dgnrsBalance!=null)&&_(`token-dgnrs:${t}`,{sdgnrsBalance:n.sdgnrsBalance,dgnrsBalance:n.dgnrsBalance}),this.#s(),this.#_()}catch{s===this.#c&&!this.#i&&this.#s()}}async#B(){const t=this.#t;if(!t||r("ui.mode")==="combined")return;const s=++this.#d;try{const n=await P(t);if(!this.#n||s!==this.#d||t!==this.#t)return;if((n!==this.#e||n<=0n)&&(this.#b=null),this.#e=n,this.#s(),n>0n){const e=await V(t);if(!this.#n||s!==this.#d||t!==this.#t)return;this.#e=e.balance,this.#b=H(e,e.balance)}}catch{}this.#n&&s===this.#d&&this.#s()}async#N(){if(this.#h)return;const t=++this.#m;this.#h=!0,this.#s();try{const s=await Q();if(!this.#n||t!==this.#m)return;this.#y=u(s),_("token-gnrus",this.#y)}catch{}finally{this.#n&&t===this.#m&&(this.#h=!1,this.#s())}}#_(){const t=burnRailBalances(this.#i),s=t.total;if(!t.known||s<=0n){this.#o+=1,this.#r=null,this.#l=s,this.#a=!1,this.#s();return}if(this.#l===s&&(this.#r||this.#a))return;const n=++this.#o;this.#r=null,this.#l=s,this.#a=!0,this.#s(),z({amount:s,publicRead:!0}).then(e=>{!this.#n||n!==this.#o||s!==this.#l||(this.#r=e,e&&this.#t&&_(`token-dgnrs-quote:${this.#t}`,{amount:s,quote:e}),this.#a=!1,this.#s())},()=>{!this.#n||n!==this.#o||s!==this.#l||(this.#r=null,this.#a=!1,this.#s())})}#k(){const t=S(r("connected.address"));return r("ui.mode")==="self"&&!!(t&&this.#t)&&t===this.#t}#s(){const t=this.querySelector('[data-bind="sdr-shell"]');if(!t)return;const s=burnRailBalances(this.#i),n=s.known?s:burnRailBalances(this.#t?b(`token-dgnrs:${this.#t}`)?.value:null),e=this.querySelector('[data-bind="sdr-sdgnrs"]'),l=this.querySelector('[data-bind="sdr-dgnrs"]'),o=this.querySelector('[data-bind="sdr-dgnrs-wrap"]'),w=this.querySelector('[data-bind="sdr-dgnrs-divider"]'),E=this.querySelector('[data-bind="sdr-eth"]'),c=this.querySelector('[data-bind="sdr-flip"]'),v=this.querySelector('[data-bind="sdr-plus"]'),h=this.querySelector('[data-bind="sdr-gnrus-total"]');e&&(e.textContent=n.known?m(n.sdgnrs):"—");const k=n.known&&n.dgnrs>0n;l&&(l.textContent=m(n.dgnrs)),o&&(o.hidden=!k),w&&(w.hidden=!k);const R=this.#t?b(`token-dgnrs-quote:${this.#t}`)?.value:null,d=this.#r??(R?.amount===n.total?R.quote:null),q=!!d,g=q&&u(d.flipOut)>0n;E&&(E.textContent=q?`≈${formatBurnRailEth(d.ethOut)} ETH`:this.#a?"…":"—"),c&&(c.hidden=!g,c.textContent=g?`${m(d.flipOut)} FLIP`:"",g&&c.setAttribute("aria-label",`${m(d.flipOut)} FLIP backing if the resolving coinflip wins`)),v&&(v.hidden=!g);const B=this.#e>0n,L=this.#y??b("token-gnrus")?.value;h&&(h.textContent=formatGnrusLifetimeFunding(B?this.#b:L),h.style.setProperty("--token-amount-chars",String(h.textContent.length)));const N=this.querySelector(".gnrus-rail__caption");N&&(N.textContent=B?"REDEEMABLE":"DONATED TO CHARITY"),t.classList?.toggle("is-loading",!s.known||this.#a),t.classList?.toggle("is-gnrus-loading",this.#h),t.classList?.toggle("is-readonly",r("ui.mode")!=="self");const G=this.querySelector('[data-bind="sdr-burn"]'),T=s.sdgnrs>=y||s.dgnrs>=y,f=this.#k(),p=this.querySelector('[data-bind="gnrus-action"]');p&&(p.textContent=this.#e>0n?"REDEEM":"DONATE",p.disabled=!f||this.#e==null,p.title=f?this.#e==null?"Loading GNRUS balance":"":"Open your own wallet view");const O=!s.known||!f||!T,x=s.known?f?"Minimum burn is 1 sDGNRS or DGNRS":"Open your own wallet view to burn DGNRS":"Balance is loading";J(G,O,x)}}typeof customElements<"u"&&typeof customElements.define=="function"&&(customElements.get("app-sdgnrs-burn-rail")||customElements.define("app-sdgnrs-burn-rail",AppSdgnrsBurnRail));
//# sourceMappingURL=app-sdgnrs-burn-rail.js.map
