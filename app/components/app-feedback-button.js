var g=Object.defineProperty;var o=(e,r)=>g(e,"name",{value:r,configurable:!0});import{submitFeedback as E}from"../app/feedback.js";import{compactUiError as y}from"../app/ui-error.js";const f="unav-feedback",p="app-feedback-dialog";function v(){const e=document.createElement("button");return e.type="button",e.id=f,e.className="nav-btn nav-btn-feedback",e.setAttribute("aria-haspopup","dialog"),e.setAttribute("aria-controls",p),e.innerHTML=`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3v-7a4 4 0 0 1-1-2.6V7a4 4 0 0 1 4-4h11a4 4 0 0 1 4 4z"/>
      <path d="M12 7v4"/><path d="M12 15h.01"/>
    </svg>
    <span class="btn-label">BUGS / IDEAS</span>`,e}o(v,"_button");function S(){const e=document.createElement("div");return e.id=p,e.className="feedback-overlay",e.hidden=!0,e.innerHTML=`
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
    </section>`,e}o(S,"_dialog");export function mountFeedbackButton(e=document){if(!e?.querySelector||e.getElementById?.(f))return null;const r=e.querySelector(".nav-auth");if(!r)return null;const d=v(),t=S(),u=t.querySelector("[data-feedback-form]"),n=t.querySelector("[data-feedback-status]"),i=t.querySelector("[data-feedback-submit]");let c="bug";const b=o(()=>{t.hidden=!0,d.setAttribute("aria-expanded","false"),d.focus?.()},"close"),k=o(()=>{t.hidden=!1,d.setAttribute("aria-expanded","true"),n.hidden=!0,n.textContent="",t.querySelector('input[name="title"]')?.focus?.()},"open");d.setAttribute("aria-expanded","false"),d.addEventListener("click",k),t.querySelectorAll("[data-feedback-close]").forEach(a=>a.addEventListener("click",b)),t.addEventListener("click",a=>{a.target===t&&b()}),t.addEventListener("keydown",a=>{a.key==="Escape"&&b()}),t.querySelectorAll("[data-feedback-kind]").forEach(a=>{a.addEventListener("click",()=>{c=a.dataset.feedbackKind==="suggestion"?"suggestion":"bug",t.querySelectorAll("[data-feedback-kind]").forEach(s=>{const l=s===a;s.classList.toggle("is-active",l),s.setAttribute("aria-pressed",l?"true":"false")}),i.textContent=c==="bug"?"SEND REPORT":"SEND IDEA"})}),u.addEventListener("submit",async a=>{if(a.preventDefault(),!i.disabled){i.disabled=!0,i.textContent="SENDING…",n.hidden=!0,n.classList.remove("is-error","is-success");try{const s=new FormData(u),l=await E({kind:c,title:s.get("title"),message:s.get("message"),contact:s.get("contact"),website:s.get("website")});n.textContent=l?.id?`SENT · REPORT #${l.id}`:"SENT · THANK YOU",n.classList.add("is-success"),n.hidden=!1,u.reset()}catch(s){n.textContent=y(s,"Could not send that right now."),n.classList.add("is-error"),n.hidden=!1}finally{i.disabled=!1,i.textContent=c==="bug"?"SEND REPORT":"SEND IDEA"}}});const h=r.querySelector("#unav-discord");return r.insertBefore(d,h||r.firstChild),(e.body||document.body)?.appendChild(t),{button:d,overlay:t}}o(mountFeedbackButton,"mountFeedbackButton");function m(){if(mountFeedbackButton()||typeof MutationObserver!="function")return;const e=new MutationObserver(()=>{mountFeedbackButton()&&e.disconnect()});e.observe(document.documentElement,{childList:!0,subtree:!0})}o(m,"mountWhenReady"),typeof document<"u"&&(document.readyState==="loading"?document.addEventListener("DOMContentLoaded",m,{once:!0}):m());
//# sourceMappingURL=app-feedback-button.js.map
