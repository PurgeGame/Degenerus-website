var A=Object.defineProperty;var o=(l,m)=>A(l,"name",{value:m,configurable:!0});import{previewAccountLiquidation as N,sellAccountToSdgnrs as k,liquidationUnavailableReason as S}from"../app/account-liquidation.js";import{get as C,subscribe as E,deriveCanSign as D}from"../app/store.js";import{displayEthCompact as G}from"../app/scaling.js";import{compactUiError as R}from"../app/ui-error.js";import{openPanelPopup as I,closePanelPopup as _}from"../app/panel-popups.js";let g=null;export function closeAccountLiquidation(){_("liquidation",{restoreFocus:!1})}o(closeAccountLiquidation,"closeAccountLiquidation");export function openAccountLiquidation({player:l,trigger:m,onSold:L,onClose:T}={}){closeAccountLiquidation();const t=document.createElement("section");t.className="panel-popup liquidation-popup",t.id="panel-liquidation",t.dataset.panelPopup="liquidation",t.hidden=!0,t.setAttribute("role","dialog"),t.setAttribute("aria-modal","true"),t.setAttribute("aria-labelledby","liquidation-title"),t.innerHTML=`
    <div class="panel-popup__window">
      <header class="panel-popup__header">
        <h2 id="liquidation-title">LIQUIDATE ACCOUNT</h2>
        <button type="button" class="panel-popup__close" data-panel-close aria-label="Close liquidation">×</button>
      </header>
      <div class="panel-popup__body">
        <p class="liquidation-intro">Sell your game account for ETH. Your eligible unprinted future tickets determine the offer.</p>
        <div class="liquidation-quote" data-bind="liquidation-quote" hidden>
          <span>YOU RECEIVE</span><strong data-bind="liquidation-price">—</strong>
          <span data-bind="liquidation-buyer"></span>
        </div>
        <p data-bind="liquidation-status" role="status" aria-live="polite"></p>
        <div class="liquidation-terms">
          <p><strong>This sells the whole account.</strong> All its tickets, passes, claimable ETH, prepaid funding and pending rewards go with it. Selling a main account also transfers its remaining child accounts.</p>
          <p><strong>Your wallet’s entire native sDGNRS balance is burned with no payout.</strong> Withdraw or claim anything you want to keep, and redeem sDGNRS, before selling. Pending redemptions stay with the sold account. Wrapped DGNRS is unaffected.</p>
          <p>The sale cannot be undone. You receive at least the quoted ETH if it succeeds. The contract may use the Vault if sDGNRS funding changes before confirmation.</p>
        </div>
        <label class="liquidation-consent"><input type="checkbox" data-bind="liquidation-consent">
          <span>I understand that I am selling the whole account and forfeiting my native sDGNRS.</span></label>
        <div class="liquidation-actions">
          <button type="button" data-bind="liquidation-refresh">Refresh quote</button>
          <button type="button" data-bind="liquidation-sell" disabled>Sell to sDGNRS</button>
        </div>
      </div>
    </div>`,document.body.appendChild(t);const n=o(e=>t.querySelector(`[data-bind="liquidation-${e}"]`),"node"),u=n("consent"),b=n("sell"),q=n("refresh");let i=null,c=!1,s=!1,a=!1,p=0,f=!1;const y=[],v=o(()=>D()&&C("ui.mode")==="self"&&String(C("connected.address")).toLowerCase()===String(l).toLowerCase()&&i?.payee===String(l).toLowerCase(),"ownerCanSell"),d=o((e,h=!1)=>{n("status").textContent=e,n("status").classList.toggle("is-error",h)},"status"),r=o(()=>{const e=i&&!S(i);b.disabled=c||s||f||!e||!v()||!u.checked,u.disabled=c||s||f||!e||!v(),q.disabled=c||s||f,b.textContent=s?"Confirming…":f?"Account sold":"Sell to sDGNRS"},"sync"),w=o(async()=>{const e=++p;c=!0,i=null,u.checked=!1,n("quote").hidden=!0,d("Loading the current liquidation offer…"),r();try{const h=await N({player:l});if(a||e!==p)return;i=h,i.price>0n&&(n("quote").hidden=!1,n("price").textContent=`${G(i.price,18)} ETH`,n("buyer").textContent=i.buyerId===2?"Buyer: sDGNRS":"sDGNRS funding unavailable"),d(S(i)||(v()?"Review what transfers before confirming the sale.":"Connect the owner wallet to sell this account. Operators cannot liquidate."))}catch(h){!a&&e===p&&d(R(h,"Could not load the offer. Refresh to try again."),!0)}finally{!a&&e===p&&(c=!1,r())}},"load");u.addEventListener("change",r),q.addEventListener("click",()=>{q.disabled||w()}),b.addEventListener("click",async()=>{if(!(b.disabled||s)){s=!0,d("Confirm the account sale in your wallet…"),r();try{const e=await k({player:l,accountId:i.accountId,minEthOut:i.price});f=!0,a||d("Account sold. The ETH payout was sent to your wallet.");try{await L?.(e)}catch{}}catch(e){a||(i=null,u.checked=!1,d(R(e,"Sale did not complete. Refresh the quote to try again."),!0))}finally{s=!1,a||r()}}}),t.addEventListener("app:panel-close",()=>{a||(a=!0,p++,y.forEach(e=>e()),t.remove(),g===t&&(g=null),T?.())});for(const e of["connected.address","viewing.address","ui.mode"])y.push(E(e,()=>{g===t&&closeAccountLiquidation()}));y.push(E("ui.chainOk",r)),g=t,I("liquidation",m,t),w()}o(openAccountLiquidation,"openAccountLiquidation");
//# sourceMappingURL=account-liquidation-dialog.js.map
