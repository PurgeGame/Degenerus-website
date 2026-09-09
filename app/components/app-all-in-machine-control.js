var l=Object.defineProperty;var i=(n,t)=>l(n,"name",{value:t,configurable:!0});import{get as o,subscribe as r}from"../app/store.js";import{readAllInButtonPreference as c,subscribeUiPreferences as d}from"../app/ui-preferences.js";export function allInMachineControlActive({eligible:n=!1,preferred:t=!0}={}){return n===!0&&t===!0}i(allInMachineControlActive,"allInMachineControlActive");class a extends HTMLElement{static{i(this,"AppAllInMachineControl")}#s=[];#e=null;#t=!1;#a=!1;connectedCallback(){this.hasAttribute("data-mounted")||(this.setAttribute("data-mounted",""),this.innerHTML=`
      <span class="jackpot-all-in-socket" data-bind="all-in-machine-socket"
            role="img" aria-label="Empty ALL IN socket">
        <span class="jackpot-all-in-socket__port" aria-hidden="true">
          <span class="jackpot-all-in-socket__pins">
            <span class="jackpot-all-in-socket__pin"></span>
            <span class="jackpot-all-in-socket__pin"></span>
            <span class="jackpot-all-in-socket__pin"></span>
            <span class="jackpot-all-in-socket__pin"></span>
          </span>
        </span>
        <span class="jackpot-all-in-socket__label" aria-hidden="true">AI</span>
      </span>
      <button type="button" class="jackpot-all-in-button"
              data-bind="all-in-machine-button" aria-label="Open ALL IN choices"
              title="Choose a currency and where to go all in" hidden disabled>
        <img src="/app/assets/jackpot/all-in-button-v1.webp?v=physical-1" width="256" height="256"
             alt="" aria-hidden="true" decoding="async">
      </button>
    `,this.querySelector('[data-bind="all-in-machine-button"]')?.addEventListener("click",()=>{this.#r()}),this.#s.push(r("ui.allInEligible",()=>this.#l()),d(({name:t})=>{t==="allInButton"&&this.#l()})),this.#l())}disconnectedCallback(){for(const t of this.#s)try{t()}catch{}this.#s=[],this.#e?.disconnect?.(),this.#e=null,this.removeAttribute("data-mounted")}#i(){return typeof document>"u"?null:document.querySelector?.('app-decimator-panel [data-bind="dec-all-in"]')||null}#l(){const t=o("ui.allInEligible")===!0;this.#t=allInMachineControlActive({eligible:t,preferred:c()});const e=this.querySelector('[data-bind="all-in-machine-socket"]'),s=this.querySelector('[data-bind="all-in-machine-button"]');!e||!s||(e.hidden=this.#t,s.hidden=!this.#t,e.setAttribute("aria-label",t?"Empty ALL IN socket; button hidden in settings":"Empty ALL IN socket; unlocks above 60 Degen Rating"),this.toggleAttribute("data-active",this.#t),this.#o(),this.#n())}#o(){this.#e?.disconnect?.(),this.#e=null;const t=this.#i();!t||typeof MutationObserver!="function"||(this.#e=new MutationObserver(()=>this.#n()),this.#e.observe(t,{attributes:!0,attributeFilter:["class","disabled","hidden"]}))}#n(){const t=this.querySelector('[data-bind="all-in-machine-button"]');if(!t)return;const e=this.#i();t.disabled=!this.#t||!e||e.disabled===!0,t.classList.toggle("is-cued",!!e?.classList?.contains?.("dec-all-in--do-it"))}async#r(){if(!this.#t||this.#a)return;const t=this.#i();if(!t||t.hidden||t.disabled){this.#n();return}this.#a=!0;try{if(await import("./app-all-in-dialog.js"),!this.#t)return;const e=this.#i();if(!e||e.hidden||e.disabled){this.#n();return}e.click?.()}finally{this.#a=!1,this.#n()}}}typeof customElements<"u"&&!customElements.get("app-all-in-machine-control")&&customElements.define("app-all-in-machine-control",a);export{a as AppAllInMachineControl};
//# sourceMappingURL=app-all-in-machine-control.js.map
