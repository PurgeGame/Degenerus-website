var y=Object.defineProperty;var i=(n,t)=>y(n,"name",{value:t,configurable:!0});import{get as p,getActingAddress as A,getViewedAddress as S,subscribe as C}from"../app/store.js";import{displayEthCompact as f,displayToken as b}from"../app/scaling.js";import{openPlayerFundsDialog as E}from"../app/player-funds.js";const c=i(n=>String(n||"").toLowerCase()||null,"address");function g(n,t){const s=p(n);return t&&c(s?.address)===t?s:null}i(g,"scopedDisclosure");function L(n){const t=BigInt(b(n,0));return new Intl.NumberFormat("en-US",{notation:t>=10000n?"compact":"standard",maximumFractionDigits:1}).format(t)}i(L,"formatFlip");export class AppTokenFunds extends HTMLElement{static{i(this,"AppTokenFunds")}#t=[];connectedCallback(){if(!this.#t.length){this.innerHTML=`
      <section class="token-fund token-fund--flip" aria-label="Available FLIP">
        <small>FLIP AVAILABLE</small>
        <strong data-bind="token-flip">—</strong>
        <span class="token-fund__note" data-bind="token-flip-note">Wallet + winnings</span>
        <button type="button" data-funds="flip" aria-haspopup="dialog" disabled>CASH OUT</button>
      </section>
      <section class="token-fund token-fund--eth" aria-label="Claimable ETH">
        <small>ETH CLAIMABLE</small>
        <strong data-bind="token-eth">—</strong>
        <span class="token-fund__note" data-bind="token-eth-note">Ready to claim</span>
        <button type="button" data-funds="eth" aria-haspopup="dialog" disabled>CLAIM ETH</button>
      </section>
      <section class="token-fund token-fund--afking" aria-label="AFKing funding" hidden>
        <small>AFKING FUNDING</small>
        <strong data-bind="token-afking">—</strong>
        <span class="token-fund__note" data-bind="token-afking-note">Days funded</span>
        <button type="button" data-panel-open="passes" aria-haspopup="dialog">MANAGE</button>
      </section>`;for(const t of this.querySelectorAll("[data-funds]"))t.addEventListener("click",()=>{t.disabled||E(t.dataset.funds)});for(const t of["connected.address","viewing.address","ui.mode","ui.protocolCoinsFlipDisclosure","ui.claimableEthDisclosure","app.afkingSubscription"])this.#t.push(C(t,()=>this.#n()));this.#n()}}disconnectedCallback(){for(const t of this.#t.splice(0))t()}#n(){const t=p("ui.mode")==="combined"?null:c(S()),s=!!(t&&c(A())===t);for(const[o,k]of[["flip","ui.protocolCoinsFlipDisclosure"],["eth","ui.claimableEthDisclosure"]]){const l=g(k,t),r=this.querySelector(`[data-bind="token-${o}"]`),h=this.querySelector(`[data-bind="token-${o}-note"]`);let e=null;try{l?.valueWei!=null&&(e=BigInt(l.valueWei))}catch{}r.textContent=e==null?"—":o==="flip"?L(e):f(e),r.title=e==null?"":o==="flip"?`${b(e,0)} FLIP available`:`${f(e)} ETH claimable`;const m=l?.held!==!1;h.textContent=t?!l||e==null?"Awaiting balance":m?"Last revealed balance":o==="flip"?"Wallet + winnings":"Ready to claim":"Select a wallet",this.querySelector(`[data-funds="${o}"]`).disabled=!s}const d=g("app.afkingSubscription",t),u=this.querySelector(".token-fund--afking");u.hidden=d?.active!==!0;const a=d?.known===!0?d.fundedDays:null;this.querySelector('[data-bind="token-afking"]').textContent=a==null?"—":String(a),this.querySelector('[data-bind="token-afking-note"]').textContent=a==null?"Checking funding":`${String(a)==="1"?"Day":"Days"} funded`,u.classList.toggle("is-low",a!=null&&BigInt(a)<7n),u.querySelector("button").disabled=!s}}customElements.get("app-token-funds")||customElements.define("app-token-funds",AppTokenFunds);
//# sourceMappingURL=app-token-funds.js.map
