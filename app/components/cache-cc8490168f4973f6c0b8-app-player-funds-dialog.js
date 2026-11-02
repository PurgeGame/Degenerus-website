var H=Object.defineProperty;var f=(a,t)=>H(a,"name",{value:t,configurable:!0});import{formatEther as _,parseEther as L}from"ethers";import{ETH_DIVISOR as I}from"../app/chain-config.js";import{dismissOnBackdrop as x}from"../app/backdrop-dismiss.js";import{claimEthAmount as $,claimFlip as k,readClaimableEth as N}from"../app/claims.js";import{readClaimableCoinflip as F}from"../app/coinflip.js";import{donateVrf as P,vrfDonationCredit as M,readVrfDonationState as O}from"../app/vrf-donation.js?rev=native-vrf-20261025";import{normalizePlayerFundsMode as B,PLAYER_FUNDS_OPEN_EVENT as T}from"../app/player-funds.js";import{get as D,getActingAddress as R,subscribe as U}from"../app/store.js";import{compactUiError as G}from"../app/ui-error.js";function C(a){return String(a??"").replace(/0+$/,"").replace(/\.$/,"")||"0"}f(C,"_trim");function b(a){try{return C(_(BigInt(a||0)*I))}catch{return"0"}}f(b,"_ethInput");function h(a){try{return C(_(BigInt(a||0)))}catch{return"0"}}f(h,"_tokenInput");function E(a){try{return L(String(a??"").trim())/I}catch{return null}}f(E,"_parseEthInput");function S(a){try{return L(String(a??"").trim())}catch{return null}}f(S,"_parseTokenInput");const g=[[1000000000000n,"T"],[1000000000n,"B"],[1000000n,"M"],[1000n,"K"]];function q(a,t){const i=/^(\d+)(?:\.(\d+))?$/.exec(String(a??"").trim());if(!i)return`0 ${t}`;const e=BigInt(i[1]||0),n=i[2]||"";let s=g.findIndex(([l])=>e>=l);if(s>=0){const l=e*1000000n+BigInt((n+"000000").slice(0,6));let[r,o]=g[s],c=(l*100n+r*500000n)/(r*1000000n);c>=100000n&&s>0&&([r,o]=g[--s],c=(l*100n+r*500000n)/(r*1000000n));const u=c/100n,p=String(c%100n).padStart(2,"0").replace(/0+$/,"");return`${u.toLocaleString("en-US")}${p?`.${p}`:""}${o} ${t}`}const d=n.slice(0,4).replace(/0+$/,"");return e===0n&&!d&&/[1-9]/.test(n)?`<0.0001 ${t}`:`${e.toLocaleString("en-US")}${d?`.${d}`:""} ${t}`}f(q,"_compactAmountLabel");function m(a,t,i){if(!a)return;if(t==null){a.textContent="—",a.removeAttribute("title"),a.removeAttribute("aria-label");return}const e=`${t} ${i}`;a.textContent=q(t,i),a.setAttribute("title",`Exact balance: ${e}`),a.setAttribute("aria-label",`Available balance: ${e}`)}f(m,"_paintBalance");class V extends HTMLElement{static{f(this,"AppPlayerFundsDialog")}#p=!1;#o=!1;#n="flip";#s=null;#e=null;#i=null;#a=null;#t=null;#f=0;#r=null;#u=null;connectedCallback(){this.#p||(this.#p=!0,this.#v(),this.#y(),globalThis.location?.hash==="#fund-rng"&&this.open("vrf"),this.#r=t=>this.open(t?.detail?.mode),typeof document<"u"&&document.addEventListener?.(T,this.#r),this.#u=U("connected.address",()=>{this.#o&&this.#b({seed:!1})}))}disconnectedCallback(){this.#r&&typeof document<"u"&&document.removeEventListener?.(T,this.#r);try{this.#u?.()}catch{}this.#r=null,this.#u=null,this.#f+=1,this.#p=!1}open(t="flip"){this.#n=B(t),this.#o=!0,this.#c(""),this.#d(),this.#b({seed:!0})}#h(){this.#s||(this.#o=!1,this.#c(""),this.#d())}#v(){this.innerHTML=`
      <div class="pfd-backdrop" data-bind="pfd-backdrop" hidden>
        <section class="pfd-card" role="dialog" aria-modal="true" aria-labelledby="pfd-title">
          <button type="button" class="pfd-close" data-bind="pfd-close" aria-label="Close funds popup">×</button>
          <header class="pfd-head">
            <span class="pfd-head__mark"><img src="/whitepaper/flame-logo-split.svg" alt="" aria-hidden="true"></span>
            <span class="pfd-head__copy">
              <small data-bind="pfd-kicker">PROTOCOL FUNDS</small>
              <h2 id="pfd-title" data-bind="pfd-title">Claim FLIP</h2>
              <p data-bind="pfd-subtitle">Move settled winnings to your wallet.</p>
            </span>
          </header>
          <div class="pfd-section" data-bind="pfd-eth-section" hidden>
            <article class="pfd-balance pfd-balance--eth">
              <header class="pfd-asset-head">
                <span class="pfd-asset">
                  <span class="pfd-asset__icon"><img src="/shared/eth-blue.svg" alt="" aria-hidden="true"></span>
                  <span class="pfd-asset__name"><strong>ETH</strong></span>
                </span>
                <span class="pfd-available"><small>AVAILABLE</small><strong data-bind="pfd-eth-balance">—</strong></span>
              </header>
              <div class="pfd-input-row">
                <label class="pfd-amount-field">
                  <input type="text" inputmode="decimal" name="pfd-eth" value="0" autocomplete="off" spellcheck="false" aria-label="ETH amount to claim">
                  <span aria-hidden="true">ETH</span>
                </label>
                <button type="button" data-bind="pfd-eth-max">MAX</button>
                <button type="button" data-write data-bind="pfd-eth-claim">CLAIM ETH</button>
              </div>
            </article>
          </div>
          <div class="pfd-section" data-bind="pfd-flip-section">
            <article class="pfd-balance pfd-balance--flip">
              <header class="pfd-asset-head">
                <span class="pfd-asset">
                  <span class="pfd-asset__icon"><img src="/whitepaper/flame-logo-split.svg" alt="" aria-hidden="true"></span>
                  <span class="pfd-asset__name"><strong>FLIP</strong><small>SETTLED COINFLIP WINS</small></span>
                </span>
                <span class="pfd-available"><small>AVAILABLE</small><strong data-bind="pfd-flip-balance">—</strong></span>
              </header>
              <div class="pfd-input-row">
                <label class="pfd-amount-field">
                  <input type="text" inputmode="decimal" name="pfd-flip" value="0" autocomplete="off" spellcheck="false" aria-label="FLIP amount to claim">
                  <span aria-hidden="true">FLIP</span>
                </label>
                <button type="button" data-bind="pfd-flip-max">MAX</button>
                <button type="button" data-write data-bind="pfd-flip-claim">CLAIM FLIP</button>
              </div>
            </article>
          </div>
          <div class="pfd-section pfd-vrf" data-bind="pfd-vrf-section" hidden>
            <div class="pfd-vrf__stats">
              <span><small>WALLET</small><strong data-bind="pfd-vrf-balance">—</strong></span>
              <span><small>RNG CREDIT</small><strong data-bind="pfd-vrf-credit">—</strong></span>
            </div>
            <div class="pfd-vrf__quote" data-bind="pfd-vrf-quote" data-state="ready" aria-live="polite">
              <span><small>CREDIT RATE</small><strong data-bind="pfd-vrf-multiplier">—</strong></span>
              <span class="pfd-vrf__conversion">
                <small>YOUR QUOTE</small>
                <strong><output data-bind="pfd-vrf-quote-input">0 ETH</output><i aria-hidden="true">→</i><output data-bind="pfd-vrf-quote-reward">— ETH credit</output></strong>
              </span>
            </div>
            <p>Funds the Chainlink subscription with network ETH. You receive 25% as nonwithdrawable RNG credit.</p>
            <div class="pfd-input-row">
              <label class="pfd-amount-field">
                <input type="text" inputmode="decimal" name="pfd-vrf" value="0" autocomplete="off" spellcheck="false" aria-label="ETH amount to donate">
                <span aria-hidden="true">ETH</span>
              </label>

              <button type="button" data-write data-bind="pfd-vrf-donate">DONATE ETH</button>
            </div>
          </div>
          <p class="pfd-error" data-bind="pfd-error" hidden role="alert"></p>
        </section>
      </div>
    `}#y(){this.querySelector('[data-bind="pfd-close"]')?.addEventListener("click",()=>this.#h()),x(this.querySelector('[data-bind="pfd-backdrop"]'),()=>this.#h()),this.querySelector('[data-bind="pfd-eth-max"]')?.addEventListener("click",()=>{const t=this.querySelector('[name="pfd-eth"]');t&&(t.value=b(this.#i??0n)),this.#l()}),this.querySelector('[data-bind="pfd-flip-max"]')?.addEventListener("click",()=>{const t=this.querySelector('[name="pfd-flip"]');t&&(t.value=h(this.#a??0n)),this.#l()});for(const t of["pfd-eth","pfd-flip","pfd-vrf"])this.querySelector(`[name="${t}"]`)?.addEventListener("input",()=>this.#l());this.querySelector('[data-bind="pfd-eth-claim"]')?.addEventListener("click",()=>this.#m("eth")),this.querySelector('[data-bind="pfd-flip-claim"]')?.addEventListener("click",()=>this.#m("flip")),this.querySelector('[data-bind="pfd-vrf-donate"]')?.addEventListener("click",()=>this.#m("vrf")),this.addEventListener("keydown",t=>{t?.key==="Escape"&&this.#h()})}async#b({seed:t=!1}={}){const i=R(),e=i?String(i).toLowerCase():null;e!==this.#e&&(this.#i=this.#a=null,this.#t=null),this.#e=e,this.#d();const n=++this.#f;if(!this.#e){this.#i=0n,this.#a=0n,this.#t={balanceWei:0n,creditWei:0n},this.#d();return}const[s,d,l]=await Promise.allSettled([N({player:this.#e}),F({player:this.#e}),O({player:D("connected.address")})]);if(n===this.#f){if(this.#i=s.status==="fulfilled"&&s.value!=null?BigInt(s.value):null,this.#a=d.status==="fulfilled"&&d.value!=null?BigInt(d.value):null,this.#t=l.status==="fulfilled"?l.value:null,t){const r=this.querySelector('[name="pfd-eth"]'),o=this.querySelector('[name="pfd-flip"]');r&&(r.value=b(this.#i??0n)),o&&(o.value=h(this.#a??0n))}this.#d()}}#c(t){const i=this.querySelector('[data-bind="pfd-error"]');i&&(i.textContent=String(t||""),i.hidden=!t)}#d(){const t=this.querySelector('[data-bind="pfd-backdrop"]');t&&(t.hidden=!this.#o);const i=this.querySelector('[data-bind="pfd-eth-section"]'),e=this.querySelector('[data-bind="pfd-flip-section"]'),n=this.querySelector('[data-bind="pfd-vrf-section"]'),s=this.#n==="cashout";i&&(i.hidden=!s&&this.#n!=="eth"),e&&(e.hidden=!s&&this.#n!=="flip"),n&&(n.hidden=this.#n!=="vrf");const d={cashout:["ETH & FLIP","Cash out","Send ETH and FLIP to your wallet."],eth:["ETH CASHOUT","Claim ETH","Move claimable ETH to your wallet."],flip:["COINFLIP FUNDS","Claim FLIP","Move settled winnings to your wallet."],vrf:["GAME RANDOMNESS","Fund RNG","Top up the protocol RNG subscription."]},[l,r,o]=d[this.#n]||d.flip,c=this.querySelector('[data-bind="pfd-kicker"]'),u=this.querySelector('[data-bind="pfd-title"]'),p=this.querySelector('[data-bind="pfd-subtitle"]');c&&(c.textContent=l),u&&(u.textContent=r),p&&(p.textContent=o);const v=this.querySelector('[data-bind="pfd-eth-balance"]'),y=this.querySelector('[data-bind="pfd-flip-balance"]'),A=this.querySelector('[data-bind="pfd-vrf-balance"]'),w=this.querySelector('[data-bind="pfd-vrf-credit"]');m(v,this.#i==null?null:b(this.#i),"ETH"),m(y,this.#a==null?null:h(this.#a),"FLIP"),m(A,this.#t==null?null:h(this.#t.balanceWei),"ETH"),m(w,this.#t==null?null:h(this.#t.creditWei),"ETH"),this.#l()}#l(){const t=!!this.#e,i=E(this.querySelector('[name="pfd-eth"]')?.value),e=S(this.querySelector('[name="pfd-flip"]')?.value),n=S(this.querySelector('[name="pfd-vrf"]')?.value);this.#E(n);const s=[["pfd-eth-claim",i,this.#i,"CLAIM ETH","CLAIMING…","eth"],["pfd-flip-claim",e,this.#a,"CLAIM FLIP","CLAIMING…","flip"],["pfd-vrf-donate",n,this.#t?.balanceWei,"DONATE ETH","DONATING…","vrf"]];for(const[d,l,r,o,c,u]of s){const p=this.querySelector(`[data-bind="${d}"]`);if(!p)continue;const v=u!=="vrf"||this.#t?.subscriptionReady&&!this.#t?.gameOver,y=t&&v&&l!=null&&l>0n&&r!=null&&(u==="vrf"?l<r:l<=r);p.disabled=!!this.#s||!y,p.textContent=this.#s===u?c:o}}#E(t){const i=this.querySelector('[data-bind="pfd-vrf-quote-input"]'),e=this.querySelector('[data-bind="pfd-vrf-quote-reward"]'),n=this.querySelector('[data-bind="pfd-vrf-multiplier"]');n&&(n.textContent="25%"),i&&(i.textContent=t==null?"— ETH":`${h(t)} ETH`),e&&(e.textContent=t==null?"— ETH credit":`${h(M(t))} ETH credit`)}async#m(t){if(this.#s||!this.#e||t==="vrf"&&(!this.#t?.subscriptionReady||this.#t?.gameOver))return;const i=this.querySelector(`[name="pfd-${t}"]`),e=t==="eth"?E(i?.value):S(i?.value),n=t==="eth"?this.#i:t==="flip"?this.#a:this.#t?.balanceWei;if(!(e==null||e<=0n||n==null||e>n)){this.#s=t,this.#c(""),this.#l();try{t==="eth"?await $({player:this.#e,amount:e}):t==="flip"?await k({player:this.#e,amount:e}):await P({amount:e}),await this.#b({seed:!0})}catch(s){this.#c(G(s,`${t==="vrf"?"Donation":"Claim"} did not go through.`))}finally{this.#s=null,this.#l()}}}}typeof customElements<"u"&&!customElements.get("app-player-funds-dialog")&&customElements.define("app-player-funds-dialog",V);export{q as formatCompactFundsLabel,b as formatClaimEthInput,E as parseClaimEthInput};
//# sourceMappingURL=app-player-funds-dialog.js.map
