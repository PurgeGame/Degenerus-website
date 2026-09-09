var T=Object.defineProperty;var p=(n,t)=>T(n,"name",{value:t,configurable:!0});import{formatEther as S,parseEther as E}from"ethers";import{ETH_DIVISOR as g}from"../app/chain-config.js";import{claimEthAmount as w,claimFlip as W,readClaimableEth as x}from"../app/claims.js";import{readClaimableCoinflip as $}from"../app/coinflip.js";import{donateLink as F,formatLinkDonationMultiplier as M,linkDonationFlipQuote as _,readLinkDonationState as B}from"../app/link-donation.js?rev=link-reward-v1";import{normalizePlayerFundsMode as D,PLAYER_FUNDS_OPEN_EVENT as q}from"../app/player-funds.js";import{getActingAddress as K,subscribe as R}from"../app/store.js";import{compactUiError as H}from"../app/ui-error.js";function C(n){return String(n??"").replace(/0+$/,"").replace(/\.$/,"")||"0"}p(C,"_trim");function b(n){try{return C(S(BigInt(n||0)*g))}catch{return"0"}}p(b,"_ethInput");function f(n){try{return C(S(BigInt(n||0)))}catch{return"0"}}p(f,"_tokenInput");function k(n){try{return E(String(n??"").trim())/g}catch{return null}}p(k,"_parseEthInput");function v(n){try{return E(String(n??"").trim())}catch{return null}}p(v,"_parseTokenInput");const I=[[1000000000000n,"T"],[1000000000n,"B"],[1000000n,"M"],[1000n,"K"]];function m(n,t){const i=/^(\d+)(?:\.(\d+))?$/.exec(String(n??"").trim());if(!i)return`0 ${t}`;const e=BigInt(i[1]||0),a=i[2]||"";let l=I.findIndex(([s])=>e>=s);if(l>=0){const s=e*1000000n+BigInt((a+"000000").slice(0,6));let[d,h]=I[l],o=(s*100n+d*500000n)/(d*1000000n);o>=100000n&&l>0&&([d,h]=I[--l],o=(s*100n+d*500000n)/(d*1000000n));const u=o/100n,c=String(o%100n).padStart(2,"0").replace(/0+$/,"");return`${u.toLocaleString("en-US")}${c?`.${c}`:""}${h} ${t}`}const r=a.slice(0,4).replace(/0+$/,"");return e===0n&&!r&&/[1-9]/.test(a)?`<0.0001 ${t}`:`${e.toLocaleString("en-US")}${r?`.${r}`:""} ${t}`}p(m,"_compactAmountLabel");function L(n,t,i){if(!n)return;if(t==null){n.textContent="—",n.removeAttribute("title"),n.removeAttribute("aria-label");return}const e=`${t} ${i}`;n.textContent=m(t,i),n.setAttribute("title",`Exact balance: ${e}`),n.setAttribute("aria-label",`Available balance: ${e}`)}p(L,"_paintBalance");class O extends HTMLElement{static{p(this,"AppPlayerFundsDialog")}#u=!1;#d=!1;#l="flip";#s=null;#e=null;#i=null;#n=null;#t=null;#p=0;#r=null;#h=null;connectedCallback(){this.#u||(this.#u=!0,this.#L(),this.#y(),this.#r=t=>this.open(t?.detail?.mode),typeof document<"u"&&document.addEventListener?.(q,this.#r),this.#h=R("connected.address",()=>{this.#d&&this.#b({seed:!1})}))}disconnectedCallback(){this.#r&&typeof document<"u"&&document.removeEventListener?.(q,this.#r);try{this.#h?.()}catch{}this.#r=null,this.#h=null,this.#p+=1,this.#u=!1}open(t="flip"){this.#l=D(t),this.#d=!0,this.#o(""),this.#c(),this.#b({seed:!0})}#f(){this.#s||(this.#d=!1,this.#o(""),this.#c())}#L(){this.innerHTML=`
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
                  <span class="pfd-asset__name"><strong>ETH</strong><small>ACTIVITY RULES APPLY</small></span>
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
          <div class="pfd-section pfd-link" data-bind="pfd-link-section" hidden>
            <div class="pfd-link__stats">
              <span><small>WALLET</small><strong data-bind="pfd-link-balance">—</strong></span>
              <span><small>RNG CREDIT</small><strong data-bind="pfd-link-credit">—</strong></span>
            </div>
            <div class="pfd-link__quote" data-bind="pfd-link-quote" data-state="loading" aria-live="polite">
              <span><small>CURRENT MULTIPLIER</small><strong data-bind="pfd-link-multiplier">—</strong></span>
              <span class="pfd-link__conversion">
                <small>YOUR QUOTE</small>
                <strong><output data-bind="pfd-link-quote-input">0 LINK</output><i aria-hidden="true">→</i><output data-bind="pfd-link-quote-reward">— FLIP</output></strong>
              </span>
            </div>
            <p>Funds Chainlink, banks equal RNG credit, and earns the live FLIP reward quoted above.</p>
            <div class="pfd-input-row">
              <label class="pfd-amount-field">
                <input type="text" inputmode="decimal" name="pfd-link" value="0" autocomplete="off" spellcheck="false" aria-label="LINK amount to donate">
                <span aria-hidden="true">LINK</span>
              </label>
              <button type="button" data-bind="pfd-link-max">MAX</button>
              <button type="button" data-write data-bind="pfd-link-donate">DONATE LINK</button>
            </div>
          </div>
          <p class="pfd-error" data-bind="pfd-error" hidden role="alert"></p>
        </section>
      </div>
    `}#y(){this.querySelector('[data-bind="pfd-close"]')?.addEventListener("click",()=>this.#f()),this.querySelector('[data-bind="pfd-backdrop"]')?.addEventListener("click",t=>{t?.target===this.querySelector('[data-bind="pfd-backdrop"]')&&this.#f()}),this.querySelector('[data-bind="pfd-eth-max"]')?.addEventListener("click",()=>{const t=this.querySelector('[name="pfd-eth"]');t&&(t.value=b(this.#i??0n)),this.#a()}),this.querySelector('[data-bind="pfd-flip-max"]')?.addEventListener("click",()=>{const t=this.querySelector('[name="pfd-flip"]');t&&(t.value=f(this.#n??0n)),this.#a()}),this.querySelector('[data-bind="pfd-link-max"]')?.addEventListener("click",()=>{const t=this.querySelector('[name="pfd-link"]');t&&(t.value=f(this.#t?.balanceWei??0n)),this.#a()});for(const t of["pfd-eth","pfd-flip","pfd-link"])this.querySelector(`[name="${t}"]`)?.addEventListener("input",()=>this.#a());this.querySelector('[data-bind="pfd-eth-claim"]')?.addEventListener("click",()=>this.#m("eth")),this.querySelector('[data-bind="pfd-flip-claim"]')?.addEventListener("click",()=>this.#m("flip")),this.querySelector('[data-bind="pfd-link-donate"]')?.addEventListener("click",()=>this.#m("link")),this.addEventListener("keydown",t=>{t?.key==="Escape"&&this.#f()})}async#b({seed:t=!1}={}){const i=K();this.#e=i?String(i).toLowerCase():null;const e=++this.#p;if(!this.#e){this.#i=0n,this.#n=0n,this.#t={balanceWei:0n,creditWei:0n},this.#c();return}const[a,l,r]=await Promise.allSettled([x({player:this.#e}),$({player:this.#e}),B({player:this.#e})]);if(e===this.#p){if(this.#i=a.status==="fulfilled"&&a.value!=null?BigInt(a.value):null,this.#n=l.status==="fulfilled"&&l.value!=null?BigInt(l.value):null,this.#t=r.status==="fulfilled"?r.value:null,t){const s=this.querySelector('[name="pfd-eth"]'),d=this.querySelector('[name="pfd-flip"]');s&&(s.value=b(this.#i??0n)),d&&(d.value=f(this.#n??0n))}this.#c()}}#o(t){const i=this.querySelector('[data-bind="pfd-error"]');i&&(i.textContent=String(t||""),i.hidden=!t)}#c(){const t=this.querySelector('[data-bind="pfd-backdrop"]');t&&(t.hidden=!this.#d);const i=this.querySelector('[data-bind="pfd-eth-section"]'),e=this.querySelector('[data-bind="pfd-flip-section"]'),a=this.querySelector('[data-bind="pfd-link-section"]'),l=this.#l==="cashout";i&&(i.hidden=!l&&this.#l!=="eth"),e&&(e.hidden=!l&&this.#l!=="flip"),a&&(a.hidden=this.#l!=="link");const r={cashout:["WITHDRAWAL DESK","Cash out","Move claimable funds to your wallet."],eth:["ETH CASHOUT","Claim ETH","Move claimable ETH to your wallet."],flip:["COINFLIP FUNDS","Claim FLIP","Move settled winnings to your wallet."],link:["CHAINLINK RNG","Fund RNG","Top up the protocol RNG subscription."]},[s,d,h]=r[this.#l]||r.flip,o=this.querySelector('[data-bind="pfd-kicker"]'),u=this.querySelector('[data-bind="pfd-title"]'),c=this.querySelector('[data-bind="pfd-subtitle"]');o&&(o.textContent=s),u&&(u.textContent=d),c&&(c.textContent=h);const y=this.querySelector('[data-bind="pfd-eth-balance"]'),A=this.querySelector('[data-bind="pfd-flip-balance"]'),N=this.querySelector('[data-bind="pfd-link-balance"]'),P=this.querySelector('[data-bind="pfd-link-credit"]');L(y,this.#i==null?null:b(this.#i),"ETH"),L(A,this.#n==null?null:f(this.#n),"FLIP"),L(N,this.#t==null?null:f(this.#t.balanceWei),"LINK"),L(P,this.#t==null?null:f(this.#t.creditWei),"LINK"),this.#a()}#a(){const t=!!this.#e,i=k(this.querySelector('[name="pfd-eth"]')?.value),e=v(this.querySelector('[name="pfd-flip"]')?.value),a=v(this.querySelector('[name="pfd-link"]')?.value);this.#k(a);const l=[["pfd-eth-claim",i,this.#i,"CLAIM ETH","CLAIMING…","eth"],["pfd-flip-claim",e,this.#n,"CLAIM FLIP","CLAIMING…","flip"],["pfd-link-donate",a,this.#t?.balanceWei,"DONATE LINK","DONATING…","link"]];for(const[r,s,d,h,o,u]of l){const c=this.querySelector(`[data-bind="${r}"]`);if(!c)continue;const y=t&&s!=null&&s>0n&&d!=null&&s<=d;c.disabled=!!this.#s||!y,c.textContent=this.#s===u?o:h}}#k(t){const i=this.querySelector('[data-bind="pfd-link-quote"]'),e=this.querySelector('[data-bind="pfd-link-multiplier"]'),a=this.querySelector('[data-bind="pfd-link-quote-input"]'),l=this.querySelector('[data-bind="pfd-link-quote-reward"]');if(!i||!e||!a||!l)return;const r=t!=null&&t>=0n?t:null,s=this.#t?.subscriptionBalanceWei!=null&&this.#t?.ethPerLinkWei!=null&&this.#t?.mintPriceWei!=null,h=(s?_({amountWei:0n,subscriptionBalanceWei:this.#t.subscriptionBalanceWei,ethPerLinkWei:this.#t.ethPerLinkWei,mintPriceWei:this.#t.mintPriceWei}):null)?.currentMultiplierWei??null,o=r==null||!s?null:_({amountWei:r,subscriptionBalanceWei:this.#t.subscriptionBalanceWei,ethPerLinkWei:this.#t.ethPerLinkWei,mintPriceWei:this.#t.mintPriceWei}),u=r==null?"— LINK":m(f(r),"LINK"),c=o==null?"— FLIP":m(f(o.flipWei),"FLIP");e.textContent=M(h),a.textContent=u,l.textContent=c,i.dataset.state=this.#t==null?"loading":s?"ready":"unavailable",i.setAttribute("aria-label",o?`Current LINK reward multiplier ${e.textContent}. Donating ${u} is estimated to earn ${c}.`:s?`Current LINK reward multiplier ${e.textContent}. Enter a valid LINK amount for a FLIP quote.`:this.#t==null?"Loading the current LINK reward quote.":"The current LINK reward quote is unavailable.")}async#m(t){if(this.#s||!this.#e)return;const i=this.querySelector(`[name="pfd-${t}"]`),e=t==="eth"?k(i?.value):v(i?.value),a=t==="eth"?this.#i:t==="flip"?this.#n:this.#t?.balanceWei;if(!(e==null||e<=0n||a==null||e>a)){this.#s=t,this.#o(""),this.#a();try{t==="eth"?await w({player:this.#e,amount:e}):t==="flip"?await W({player:this.#e,amount:e}):await F({amount:e}),await this.#b({seed:!0})}catch(l){this.#o(H(l,`${t==="link"?"Donation":"Claim"} did not go through.`))}finally{this.#s=null,this.#a()}}}}typeof customElements<"u"&&!customElements.get("app-player-funds-dialog")&&customElements.define("app-player-funds-dialog",O);export{m as formatCompactFundsLabel,b as formatClaimEthInput,k as parseClaimEthInput};
//# sourceMappingURL=app-player-funds-dialog.js.map
