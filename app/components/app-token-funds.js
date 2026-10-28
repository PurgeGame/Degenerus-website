var y=Object.defineProperty;var i=(n,t)=>y(n,"name",{value:t,configurable:!0});import{get as f,getActingAddress as A,getViewedAddress as S,subscribe as C}from"../app/store.js";import{displayEthCompact as p,displayToken as b}from"../app/scaling.js";import{openPlayerFundsDialog as E}from"../app/player-funds.js";const c=i(n=>String(n||"").toLowerCase()||null,"address");function g(n,t){const o=f(n);return t&&c(o?.address)===t?o:null}i(g,"scopedDisclosure");function L(n){const t=BigInt(b(n,0));return new Intl.NumberFormat("en-US",{notation:t>=10000n?"compact":"standard",maximumFractionDigits:1}).format(t)}i(L,"formatFlip");export class AppTokenFunds extends HTMLElement{static{i(this,"AppTokenFunds")}#t=[];connectedCallback(){if(!this.#t.length){this.innerHTML=`
      <section class="token-fund token-fund--flip" aria-label="Available FLIP">
        <small>FLIP AVAILABLE</small>
        <img class="token-fund__badge" src="/shared/flip-chips/face.svg" alt="" aria-hidden="true">
        <strong data-bind="token-flip">—</strong>
        <span class="token-fund__note" data-bind="token-flip-note">Wallet + winnings</span>
        <button type="button" data-funds="flip" aria-haspopup="dialog" disabled>CASH OUT</button>
      </section>
      <section class="token-fund token-fund--eth" aria-label="Claimable ETH">
        <small>ETH CLAIMABLE</small>
        <img class="token-fund__badge" src="/shared/coinflip-face-eth.svg" alt="" aria-hidden="true">
        <strong data-bind="token-eth">—</strong>
        <span class="token-fund__note" data-bind="token-eth-note">Ready to claim</span>
        <button type="button" data-funds="eth" aria-haspopup="dialog" disabled>CLAIM ETH</button>
      </section>
      <section class="token-fund token-fund--afking" aria-label="AFKing funding" hidden>
        <small>AFKING FUNDING</small>
        <img class="token-fund__badge" src="/app/assets/afking-passes-teal-ember-v18.svg" alt="" aria-hidden="true">
        <strong data-bind="token-afking">—</strong>
        <span class="token-fund__note" data-bind="token-afking-note">Days funded</span>
        <button type="button" data-panel-open="passes" aria-haspopup="dialog">MANAGE</button>
      </section>`;for(const t of this.querySelectorAll("[data-funds]"))t.addEventListener("click",()=>{t.disabled||E(t.dataset.funds)});for(const t of["connected.address","viewing.address","ui.mode","ui.protocolCoinsFlipDisclosure","ui.claimableEthDisclosure","app.afkingSubscription"])this.#t.push(C(t,()=>this.#n()));this.#n()}}disconnectedCallback(){for(const t of this.#t.splice(0))t()}#n(){const t=f("ui.mode")==="combined"?null:c(S()),o=!!(t&&c(A())===t);for(const[s,k]of[["flip","ui.protocolCoinsFlipDisclosure"],["eth","ui.claimableEthDisclosure"]]){const l=g(k,t),r=this.querySelector(`[data-bind="token-${s}"]`),h=this.querySelector(`[data-bind="token-${s}-note"]`);let e=null;try{l?.valueWei!=null&&(e=BigInt(l.valueWei))}catch{}r.textContent=e==null?"—":s==="flip"?L(e):p(e),r.title=e==null?"":s==="flip"?`${b(e,0)} FLIP available`:`${p(e)} ETH claimable`;const m=l?.held!==!1;h.textContent=t?!l||e==null?"Awaiting balance":m?"Last revealed balance":s==="flip"?"Wallet + winnings":"Ready to claim":"Select a wallet",this.querySelector(`[data-funds="${s}"]`).disabled=!o}const d=g("app.afkingSubscription",t),u=this.querySelector(".token-fund--afking");u.hidden=d?.active!==!0;const a=d?.known===!0?d.fundedDays:null;this.querySelector('[data-bind="token-afking"]').textContent=a==null?"—":String(a),this.querySelector('[data-bind="token-afking-note"]').textContent=a==null?"Checking funding":`${String(a)==="1"?"Day":"Days"} funded`,u.classList.toggle("is-low",a!=null&&BigInt(a)<7n),u.querySelector("button").disabled=!o}}customElements.get("app-token-funds")||customElements.define("app-token-funds",AppTokenFunds);
//# sourceMappingURL=app-token-funds.js.map
