var v=Object.defineProperty;var a=(o,t)=>v(o,"name",{value:t,configurable:!0});export function mobileEventMarkup(o,{id:t,title:e,mark:l,action:s,content:r}){return o.hasAttribute("data-mpage")?`
    <button type="button" class="mobile-event-summary" data-event="${t}"
            aria-haspopup="dialog" aria-controls="${t}-mobile-details" aria-expanded="false">
      <img class="mobile-event-summary__mark" src="${l}" alt="">
      <span class="mobile-event-summary__copy"><strong>${e}</strong><small data-event-meta>—</small></span>
      <span class="mobile-event-summary__pool"><strong data-event-pool>—</strong><small>ETH POOL</small></span>
      <span class="mobile-event-summary__action">${s}<b aria-hidden="true">›</b></span>
    </button>
    <dialog class="mobile-event-sheet" id="${t}-mobile-details" aria-label="${e}">
      <header class="mobile-event-sheet__header"><strong>${e}</strong>
        <button type="button" class="mobile-event-sheet__close" aria-label="Close ${e}" autofocus>×</button>
      </header>
      <div class="mobile-event-sheet__body">${r}</div>
    </dialog>`:r}a(mobileEventMarkup,"mobileEventMarkup");export function mountMobileEventSheet(o){const t=o.querySelector(".mobile-event-summary");if(!t)return null;const e=o.querySelector(".mobile-event-sheet"),l=o.querySelector(".mobile-event-sheet__close"),s=window.matchMedia("(max-width: 768px)"),r=a(()=>{s.matches&&e.open&&(e.close(),t.setAttribute("aria-expanded","false"))},"close"),c=a(()=>{!s.matches||o.hidden||e.open||(e.showModal(),t.setAttribute("aria-expanded","true"))},"open"),m=a(()=>t.setAttribute("aria-expanded",String(s.matches&&e.open)),"onClose"),u=a(n=>{if(n.target!==e)return;const i=e.getBoundingClientRect();(n.clientX<i.left||n.clientX>i.right||n.clientY<i.top||n.clientY>i.bottom)&&r()},"onBackdrop"),p=a(n=>{n.detail?.page!=="flip"&&r()},"onPage"),d=a(()=>{e.open&&e.close(),t.setAttribute("aria-expanded","false"),s.matches?e.removeAttribute("role"):(e.setAttribute("role","presentation"),e.show())},"syncMode");return t.addEventListener("click",c),l.addEventListener("click",r),e.addEventListener("close",m),e.addEventListener("click",u),s.addEventListener("change",d),document.addEventListener("mobile-pager:change",p),d(),{open:c,update({visible:n,pool:i,meta:b}){n||r(),i!=null&&(t.querySelector("[data-event-pool]").textContent=i),b!=null&&(t.querySelector("[data-event-meta]").textContent=b)},destroy(){e.open&&e.close(),t.removeEventListener("click",c),l.removeEventListener("click",r),e.removeEventListener("close",m),e.removeEventListener("click",u),s.removeEventListener("change",d),document.removeEventListener("mobile-pager:change",p)}}}a(mountMobileEventSheet,"mountMobileEventSheet");
//# sourceMappingURL=mobile-event-sheet.js.map
