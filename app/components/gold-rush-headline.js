var y=Object.defineProperty;var a=(s,e)=>y(s,"name",{value:e,configurable:!0});import{displayEthCompact as T}from"../app/scaling.js";import{subscribe as b}from"../app/store.js";const u=900,v=3,E=4;function f(s){const e=s.indexOf("."),t=e===-1?s:s.slice(0,e),i=e===-1?"":s.slice(e),r=t.startsWith("-"),n=(r?t.slice(1):t).replace(/\B(?=(\d{3})+(?!\d))/g,",");return`${r?"-":""}${n}${i}`}a(f,"groupEth");function c(s,e=v){return f(T(s,e))}a(c,"fmtEth");function m(s){const e=c(s),t=e.split(".")[0];return t.replace(/[^0-9]/g,"").length>=7?t:e}a(m,"fmtHeadline");function p(s){const e=String(s??"").length;return e>=13?"long":e>=10?"medium":"normal"}a(p,"headlineAmountFit");function o(s,e){if(!s)return;const t=m(e);s.textContent=t,s.setAttribute("data-fit",p(t)),s.style.setProperty("--gr-chars",String(t.length))}a(o,"paintHeadlineAmount");function S(){return typeof window<"u"&&typeof window.matchMedia=="function"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches}a(S,"prefersReducedMotion");function g(s){const e=1-s;return 1-e*e*e}a(g,"easeOutCubic");class _ extends HTMLElement{static{a(this,"GoldRushHeadline")}#a=[];#r=!1;#e=null;#l=null;#n=null;#t=null;#s=null;#i=null;connectedCallback(){this.#r||(this.#r=!0,this.#o(),this.#a.push(b("app.goldRush",e=>this.#c(e))))}disconnectedCallback(){for(const e of this.#a)try{e()}catch{}this.#a=[],this.#t!=null&&typeof cancelAnimationFrame=="function"&&cancelAnimationFrame(this.#t),this.#s&&clearTimeout(this.#s),this.#i&&clearTimeout(this.#i),this.#t=null,this.#r=!1}#o(){this.classList.add("gr"),this.querySelector('[data-el="amount"]')&&this.querySelector('[data-el="chip"]')&&this.querySelector('[data-el="float"]')||(this.innerHTML=`
      <div class="gr__inner">
        <div class="gr__masthead">
          <span class="gr__brand">
            <img class="gr__brand-logo" src="/whitepaper/flame-logo.svg" alt="">
            <span class="gr__brand-copy">
              <strong>DEGENERUS</strong>
              <small>PROTOCOL</small>
            </span>
          </span>
          <span class="gr__masthead-divider" aria-hidden="true"></span>
          <div class="gr__label">
            <span class="gr__label-text">Golden Ticket Jackpot</span>
            <span class="gr__chip" data-el="chip" hidden></span>
          </div>
        </div>
        <div class="gr__amount-row">
          <span class="gr__amount" data-el="amount">—</span>
          <span class="gr__unit-code" title="Ethereum" aria-label="Ethereum">ETH</span>
          <span class="gr__float" data-el="float" hidden></span>
        </div>
      </div>
    `),this.#e={chip:this.querySelector('[data-el="chip"]'),amount:this.querySelector('[data-el="amount"]'),float:this.querySelector('[data-el="float"]')}}#c(e){if(!e||!this.#e)return;let t;try{t=BigInt(e.headlineWei)}catch{return}this.#h(e);const i=e.atBlock??null,r=this.#l===null,l=!r&&i!==null&&i!==this.#l;if(this.#l=i,r||!l||this.#n===null){this.#n=t,o(this.#e.amount,t);return}const n=this.#n;n!==t&&(this.#d(n,t),this.#u(t>n),t>n&&this.#f(t-n))}#h(e){const{chip:t}=this.#e,i=Number(e.lagBlocks??0);e.ready===!1?(t.hidden=!1,t.textContent="warming up",t.className="gr__chip gr__chip--wait"):i>50?(t.hidden=!1,t.textContent=`indexer ${i} blocks behind`,t.className="gr__chip gr__chip--wait"):(t.hidden=!0,t.textContent="",t.className="gr__chip")}#d(e,t){const{amount:i}=this.#e;if(this.#t!=null&&typeof cancelAnimationFrame=="function"&&(cancelAnimationFrame(this.#t),this.#t=null),this.#n=t,S()||typeof requestAnimationFrame!="function"){o(i,t);return}const r=t-e,l=typeof performance<"u"?performance.now():Date.now(),n=a(()=>{const h=typeof performance<"u"?performance.now():Date.now(),d=Math.min(1,(h-l)/u);if(d>=1){o(i,t),this.#t=null;return}const w=BigInt(Math.round(g(d)*1e3));o(i,e+r*w/1000n),this.#t=requestAnimationFrame(n)},"step");this.#t=requestAnimationFrame(n)}#u(e){this.classList.remove("gr--up","gr--down"),this.offsetWidth,this.classList.add(e?"gr--up":"gr--down"),this.#s&&clearTimeout(this.#s),this.#s=setTimeout(()=>{this.classList.remove("gr--up","gr--down"),this.#s=null},u+400)}#f(e){const{float:t}=this.#e;t.textContent=`+${c(e,E)}`,t.hidden=!1,t.classList.remove("is-rising"),t.offsetWidth,t.classList.add("is-rising"),this.#i&&clearTimeout(this.#i),this.#i=setTimeout(()=>{t.hidden=!0,t.classList.remove("is-rising"),this.#i=null},1600)}}typeof customElements<"u"&&!customElements.get("gold-rush-headline")&&customElements.define("gold-rush-headline",_);export const _testing={groupEth:f,fmtEth:c,fmtHeadline:m,easeOutCubic:g,headlineAmountFit:p};export default _;
//# sourceMappingURL=gold-rush-headline.js.map
