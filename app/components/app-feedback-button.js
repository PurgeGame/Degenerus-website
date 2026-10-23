var g=Object.defineProperty;var o=(e,r)=>g(e,"name",{value:r,configurable:!0});import{submitFeedback as y}from"../app/feedback.js";import{dismissOnBackdrop as E}from"../app/backdrop-dismiss.js";import{compactUiError as v}from"../app/ui-error.js";const f="unav-feedback",p="app-feedback-dialog";function S(){const e=document.createElement("button");return e.type="button",e.id=f,e.className="nav-btn nav-btn-feedback",e.setAttribute("aria-haspopup","dialog"),e.setAttribute("aria-controls",p),e.innerHTML=`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3v-7a4 4 0 0 1-1-2.6V7a4 4 0 0 1 4-4h11a4 4 0 0 1 4 4z"/>
      <path d="M12 7v4"/><path d="M12 15h.01"/>
    </svg>
    <span class="btn-label">BUGS / IDEAS</span>`,e}o(S,"_button");function x(){const e=document.createElement("div");return e.id=p,e.className="feedback-overlay",e.hidden=!0,e.innerHTML=`
    <section class="feedback-dialog" role="dialog" aria-modal="true"
             aria-labelledby="feedback-dialog-title">
      <header class="feedback-dialog__head">
        <span>
          <small>PLAYER FEEDBACK</small>
          <strong id="feedback-dialog-title">BUGS &amp; IDEAS</strong>
        </span>
        <button type="button" class="feedback-dialog__close" data-feedback-close
                aria-label="Close feedback form">×</button>
      </header>
      <form class="feedback-form" data-feedback-form>
        <div class="feedback-kind" role="group" aria-label="Feedback type">
          <button type="button" class="is-active" data-feedback-kind="bug"
                  aria-pressed="true">BUG</button>
          <button type="button" data-feedback-kind="suggestion"
                  aria-pressed="false">SUGGESTION</button>
        </div>
        <label>
          <span>SHORT TITLE</span>
          <input name="title" maxlength="120" autocomplete="off" required
                 placeholder="What happened?">
        </label>
        <label>
          <span>DETAILS</span>
          <textarea name="message" maxlength="4000" required
                    placeholder="What did you do, what did you expect, and what happened?"></textarea>
        </label>
        <label>
          <span>CONTACT <em>OPTIONAL</em></span>
          <input name="contact" maxlength="200" autocomplete="off"
                 placeholder="Discord handle or email">
        </label>
        <label class="feedback-honeypot" aria-hidden="true">
          <span>Website</span><input name="website" tabindex="-1" autocomplete="off">
        </label>
        <p class="feedback-form__context">Page, wallet, level, day, and browser context are attached automatically.</p>
        <p class="feedback-form__status" data-feedback-status hidden aria-live="polite"></p>
        <button type="submit" class="feedback-form__submit" data-feedback-submit>SEND REPORT</button>
      </form>
    </section>`,e}o(x,"_dialog");export function mountFeedbackButton(e=document){if(!e?.querySelector||e.getElementById?.(f))return null;const r=e.querySelector(".nav-auth");if(!r)return null;const d=S(),t=x(),u=t.querySelector("[data-feedback-form]"),a=t.querySelector("[data-feedback-status]"),i=t.querySelector("[data-feedback-submit]");let c="bug";const b=o(()=>{t.hidden=!0,d.setAttribute("aria-expanded","false"),d.focus?.()},"close"),k=o(()=>{t.hidden=!1,d.setAttribute("aria-expanded","true"),a.hidden=!0,a.textContent="",t.querySelector('input[name="title"]')?.focus?.()},"open");d.setAttribute("aria-expanded","false"),d.addEventListener("click",k),t.querySelectorAll("[data-feedback-close]").forEach(s=>s.addEventListener("click",b)),E(t,b),t.addEventListener("keydown",s=>{s.key==="Escape"&&b()}),t.querySelectorAll("[data-feedback-kind]").forEach(s=>{s.addEventListener("click",()=>{c=s.dataset.feedbackKind==="suggestion"?"suggestion":"bug",t.querySelectorAll("[data-feedback-kind]").forEach(n=>{const l=n===s;n.classList.toggle("is-active",l),n.setAttribute("aria-pressed",l?"true":"false")}),i.textContent=c==="bug"?"SEND REPORT":"SEND IDEA"})}),u.addEventListener("submit",async s=>{if(s.preventDefault(),!i.disabled){i.disabled=!0,i.textContent="SENDING…",a.hidden=!0,a.classList.remove("is-error","is-success");try{const n=new FormData(u),l=await y({kind:c,title:n.get("title"),message:n.get("message"),contact:n.get("contact"),website:n.get("website")});a.textContent=l?.id?`SENT · REPORT #${l.id}`:"SENT · THANK YOU",a.classList.add("is-success"),a.hidden=!1,u.reset()}catch(n){a.textContent=v(n,"Could not send that right now."),a.classList.add("is-error"),a.hidden=!1}finally{i.disabled=!1,i.textContent=c==="bug"?"SEND REPORT":"SEND IDEA"}}});const h=r.querySelector("#unav-discord");return r.insertBefore(d,h||r.firstChild),(e.body||document.body)?.appendChild(t),{button:d,overlay:t}}o(mountFeedbackButton,"mountFeedbackButton");function m(){if(mountFeedbackButton()||typeof MutationObserver!="function")return;const e=new MutationObserver(()=>{mountFeedbackButton()&&e.disconnect()});e.observe(document.documentElement,{childList:!0,subtree:!0})}o(m,"mountWhenReady"),typeof document<"u"&&(document.readyState==="loading"?document.addEventListener("DOMContentLoaded",m,{once:!0}):m());
//# sourceMappingURL=app-feedback-button.js.map
