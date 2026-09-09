var c=Object.defineProperty;var o=(e,t)=>c(e,"name",{value:t,configurable:!0});import{CONTRACTS as i}from"../app/chain-config.js";import{connectWithPicker as a}from"../app/wallet.js";import{get as s,subscribe as l}from"../app/store.js";const r=i.SDGNRS?String(i.SDGNRS).toLowerCase():null;export function isDisconnectedProtocolWalletView({connected:e,viewing:t}={}){return!!(r&&!e&&t&&String(t).toLowerCase()===r)}o(isDisconnectedProtocolWalletView,"isDisconnectedProtocolWalletView");function d(e){const t=String(e||"");return t.length>12?`${t.slice(0,6)}…${t.slice(-4)}`:t}o(d,"_shortAddress");export class AppProtocolWalletBanner extends HTMLElement{static{o(this,"AppProtocolWalletBanner")}#n=!1;#t=!1;#o=[];connectedCallback(){this.#n||(this.#n=!0,this.innerHTML=`
      <div class="protocol-wallet-banner__mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3 4.5 6.2v5.4c0 4.5 3 7.7 7.5 9.4 4.5-1.7 7.5-4.9 7.5-9.4V6.2L12 3Z"/>
          <path d="M8.2 11.8h7.6M9.2 9.2h5.6v5.3H9.2z"/>
        </svg>
      </div>
      <span class="protocol-wallet-banner__copy">
        <strong>VIEWING THE sDGNRS PROTOCOL WALLET</strong>
        <small>Live read-only protocol activity · ${d(r)}</small>
      </span>
      <button type="button" class="protocol-wallet-banner__connect"
              data-bind="protocol-wallet-connect">CONNECT YOUR WALLET</button>`,this.querySelector('[data-bind="protocol-wallet-connect"]')?.addEventListener("click",()=>{this.#s()}),this.#o=[l("connected.address",()=>this.#e()),l("viewing.address",()=>this.#e())],this.#e())}disconnectedCallback(){for(const t of this.#o.splice(0))try{t?.()}catch{}this.#n=!1,this.#t=!1}#e(){const t=isDisconnectedProtocolWalletView({connected:s("connected.address"),viewing:s("viewing.address")});this.hidden=!t;const n=this.querySelector('[data-bind="protocol-wallet-connect"]');n&&(n.disabled=this.#t,n.textContent=this.#t?"CONNECTING…":"CONNECT YOUR WALLET")}async#s(){if(!(this.#t||s("connected.address"))){this.#t=!0,this.#e();try{await a()}catch{}finally{this.#t=!1,this.#e()}}}}typeof customElements<"u"&&!customElements.get("app-protocol-wallet-banner")&&customElements.define("app-protocol-wallet-banner",AppProtocolWalletBanner);
//# sourceMappingURL=app-protocol-wallet-banner.js.map
