var rt=Object.defineProperty;var d=(a,t)=>rt(a,"name",{value:t,configurable:!0});import{accruedPayoutWei as st,accruedShareBps as q,candidateRecordPayoutWei as at,fetchRecords as H,fetchProfiles as U,formatRecordValue as I,readLiveRecordMark as K,readPreviousDiceRunRecord as ot,recordClaimTarget as lt,recordClaimTargetForMark as ct,RECORD_KIND_BUY as T,RECORD_KIND_DICE_RUN as _,RECORD_KIND_FLIP as v,RECORD_KIND_LUCKBOX as C,RECORD_KIND_SPIN as f,shortAddress as L}from"../app/records.js";import{displayEthCompact as G,displayToken as D}from"../app/scaling.js";import{openPanelPopup as ut,closePanelPopup as Y}from"../app/panel-popups.js";import{TX_CONFIRMED_EVENT as V}from"../app/contracts.js";import{registerComponentPoll as dt}from"../app/component-poll.js";import{readPurchaseQuote as Q,ticketCostFromTickets as pt}from"../app/lootbox.js";import{ETH_DIVISOR as x}from"../app/chain-config.js";import{degeneretteLimits as ht}from"../app/degenerette.js";import{questCompletionBonusModel as ft}from"../app/quest-objectives.js";import{get as b,getActingAddress as A,getViewedAddress as X,subscribe as $,update as z}from"../app/store.js";import{readBiggestBountiesModePreference as R,subscribeUiPreferences as bt}from"../app/ui-preferences.js";import{openCrapsReplayTable as yt}from"../craps/replay-adapter.js";import{crapsReplayFetch as mt}from"../craps/replay-fetch.js";import{readRecordBountyFunds as j,recordBountyUnavailableReason as gt}from"../app/record-bounty-eligibility.js";import{readRecordsCache as _t,writeRecordsCache as St,RECORDS_REFRESH_MS as J}from"../app/records-cache.js";const vt=J,Z="degenerus:discord-profile-linked",Et="records-bounty",Tt=10n**18n;export const BIGGEST_SPIN_PRICE_STEP_WEI=10n**15n/BigInt(x)||1n,BIGGEST_SPIN_MAX_SPINS=ht(0)?.maxSpins??25;const Ct=100/1.2,tt=new Map([[f,0],[C,1],[T,2],[v,3],[_,4]]),Rt="/app/assets/biggest-bounty-card-v13.webp",kt="/app/assets/biggest-bounty-card-v13-w600.webp 600w, /app/assets/biggest-bounty-card-v13.webp 1200w",It=new Map([[_,"DICE RUN"],[f,"DEGENERETTE"],[C,"LUCKBOX"],[T,"PACK RIPPED"],[v,"COINFLIP"]]);export function recordBountyQuestProduct(a){const t=Number(a);return t===T?"purchase":t===C?"lootbox":t===v?"coinflip":t===f?"degenerette-eth":null}d(recordBountyQuestProduct,"recordBountyQuestProduct");let W=H,N=U,O=K,w=Q,M=j;function k(a){const[t,e]=String(a??"").split("."),i=t.replace(/\B(?=(\d{3})+(?!\d))/g,",");return e==null?i:`${i}.${e}`}d(k,"group");export function formatCompactBountyWei(a){let t;try{t=BigInt(a??0)}catch{return"—"}t<0n&&(t=-t);const e=t/10n**18n;if(e===0n)return t>0n?"<1":"0";const i=e.toString().length,n=i>2?10n**BigInt(i-2):1n,r=n>1n?(e+n/2n)/n*n:e,o=[[10n**15n,"Q"],[10n**12n,"T"],[10n**9n,"B"],[10n**6n,"M"],[10n**3n,"K"]].find(([h])=>r>=h);if(!o)return k(r.toString());const[c,l]=o,u=r*10n/c;return u<100n&&u%10n!==0n?`${u/10n}.${u%10n}${l}`:`${r/c}${l}`}d(formatCompactBountyWei,"formatCompactBountyWei");function F(a){let t;try{t=BigInt(a??0)}catch{return"—"}if(t<0n&&(t=-t),t<1000n)return k(t.toString());const e=t.toString().length,i=10n**BigInt(Math.max(0,e-3)),n=t/i*i,r=[[10n**15n,"Q"],[10n**12n,"T"],[10n**9n,"B"],[10n**6n,"M"],[10n**3n,"K"]],[s,o]=r.find(([h])=>n>=h)||[1n,""],c=n*100n/s,l=c/100n,u=(c%100n).toString().padStart(2,"0").replace(/0+$/,"");return u?`${l}.${u}${o}`:`${l}${o}`}d(F,"formatCompactWholeDown");function Bt(a){let t;try{t=BigInt(a??0)}catch{return"—"}t<0n&&(t=-t);const e=10n**18n,i=t*BigInt(x),n=i/e;if(n>=1000n)return F(n);const r=n.toString(),s=(i%e).toString().padStart(18,"0");if(n>0n){const l=Math.max(0,3-r.length),u=s.slice(0,l).replace(/0+$/,"");return u?`${r}.${u}`:r}const o=s.search(/[1-9]/);return o<0?"0":`0.${s.slice(0,o+3).replace(/0+$/,"")}`}d(Bt,"formatCompactEthRecord");export function formatCompactRecordValue(a,t){if(Number(a)===_){let e=0n;try{e=BigInt(t??0)}catch{}e<0n&&(e=-e);const i=(e/10000n).toString().length,n=Math.max(0,3-i),r=10n**BigInt(Math.max(0,4-n));return{amount:`${I(a,e/r*r).amount}x`,suffix:""}}if(Number(a)===T)return{amount:F(t),suffix:"TIX"};if(Number(a)===v){let e=0n;try{e=BigInt(t??0)/10n**18n}catch{}return{amount:F(e),suffix:"FLIP"}}return[f,C].includes(Number(a))?{amount:Bt(t),suffix:"ETH"}:I(a,t)}d(formatCompactRecordValue,"formatCompactRecordValue");export function orderBiggestRecords(a){return[...Array.isArray(a)?a:[]].sort((t,e)=>(tt.get(Number(t?.kind))??Number.MAX_SAFE_INTEGER)-(tt.get(Number(e?.kind))??Number.MAX_SAFE_INTEGER))}d(orderBiggestRecords,"orderBiggestRecords");function m(a){try{const t=BigInt(a??0);return t>0n?t:0n}catch{return 0n}}d(m,"nonNegativeWei");export function parseRecordBountyEthInput(a){const t=/^\s*(?:(\d+)(?:\.(\d{0,18}))?|\.(\d{1,18}))\s*$/.exec(String(a??""));if(!t)return null;try{const e=t[1]||"0",i=(t[2]||t[3]||"").padEnd(18,"0");return(BigInt(e)*Tt+BigInt(i||"0"))/BigInt(x)}catch{return null}}d(parseRecordBountyEthInput,"parseRecordBountyEthInput");function et(a,t){return a<=0n?0n:(a+t-1n)/t}d(et,"divideRoundUp");function it(a,t){return et(a,t)*t}d(it,"roundUpTo");export function recordBountySpinSelection(a,{spinCount:t=a?.spinCount??1,amountPerSpinWei:e=a?.amountPerSpinWei??a?.targetWei}={}){if(!a||Number(a.kind)!==f)return a??null;const i=Number(t);if(!Number.isInteger(i)||i<1||i>BIGGEST_SPIN_MAX_SPINS)return null;const n=m(a.targetWei);if(n<=0n)return null;const r=it(et(n,BigInt(i)),BIGGEST_SPIN_PRICE_STEP_WEI);let s=m(e);return s<r&&(s=r),s=it(s,BIGGEST_SPIN_PRICE_STEP_WEI),{...a,spinCount:i,amountPerSpinWei:s,minimumPerSpinWei:r,costWei:s*BigInt(i)}}d(recordBountySpinSelection,"recordBountySpinSelection");export function recordBountyTransactionQuote({state:a,kind:t,liveMarkWei:e=null,ticketPriceWei:i=null,today:n=null}={}){const r=Number(t);if(r===_)return null;const s=Array.isArray(a?.records)?a.records.find(y=>Number(y?.kind)===r):null;if(!s)return null;const o=e!=null,c=o?m(e):null,l=o?ct(r,c):lt(a,r);if(l==null||l<=0n)return null;let u=l;if(r===T){const y=Number(l),P=m(i);if(!Number.isSafeInteger(y)||y<=0||P<=0n)return null;u=pt(P,y)}const h=m(s.value),E=!o||h===c?at({state:a,kind:r,candidate:l,today:n}):null,S=r===v?"ONE COINFLIP DEPOSIT":r===f?"DEGENERETTE BET":r===C?"ONE LUCKBOX BUY":"ONE TICKET BUY",g={kind:r,meta:s.meta,action:S,targetWei:l,costWei:u,payoutWei:E,liveMarkWei:c,currency:r===v?"FLIP":"ETH"};return r===f?recordBountySpinSelection(g):g}d(recordBountyTransactionQuote,"recordBountyTransactionQuote");export function recordBountyActivationDetail(a){if(!a||a.targetWei==null)return null;const t={source:Et,variant:"bounty",submit:!0};if(a.kind===v)return{...t,questType:2,target:String(a.targetWei)};if(a.kind===f){const e=Number(a.spinCount??1),i=m(a.amountPerSpinWei??a.targetWei);return!Number.isInteger(e)||e<1||e>BIGGEST_SPIN_MAX_SPINS||i*BigInt(e)<m(a.targetWei)?null:{...t,questType:7,target:String(i*BigInt(e)),amountPerSpin:String(i),spinCount:e,preferClaimable:!0}}return a.kind===C?{...t,questType:6,target:String(a.targetWei),preferClaimable:!0,useAfking:!0}:a.kind===T?{...t,questType:1,target:String(a.costWei),ticketQuantity:String(a.targetWei),purchaseKind:"ticket",preferClaimable:!0,useAfking:!0}:null}d(recordBountyActivationDetail,"recordBountyActivationDetail");function p(a){return String(a??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}d(p,"escapeHtml");export function renderSnapshotKey(a){try{return JSON.stringify(a,(t,e)=>typeof e=="bigint"?`bigint:${e}`:e instanceof Map?[...e.entries()].sort(([i],[n])=>String(i).localeCompare(String(n))):e)}catch{return null}}d(renderSnapshotKey,"renderSnapshotKey");export function addressMonogram(a){const t=String(a||"").replace(/^0x/i,"").toUpperCase();return t.length>=2?t.slice(0,2):"··"}d(addressMonogram,"addressMonogram");export function addressHue(a){const t=String(a||"").replace(/^0x/i,"").slice(0,6),e=Number.parseInt(t,16);return Number.isFinite(e)?e%360:0}d(addressHue,"addressHue");class Nt extends HTMLElement{static{d(this,"AppRecordsRail")}#C=!1;#o=[];#R=null;#m=null;#g=null;#l=0;#n=null;#k=0;#c=!1;#u=new Map;#I=null;#r=null;#t=null;#d=null;#e=!1;#B=!1;#_=0;#a=!0;#N=!1;#$=null;#w=null;#x=null;#p=null;#P=null;#L=0;#D=null;#W=null;connectedCallback(){if(this.#C)return;this.#C=!0,this.#V();const t=_t();t&&(this.#n=t.state,this.#k=t.savedAt,z("app.records",t.state),this.#U()),this.#i(),this.#Q();for(const e of["connected.address","viewing.address","ui.mode"])this.#o.push($(e,()=>{this.#I=X?.()||A?.()||null;const i=renderSnapshotKey([b("connected.address"),this.#I,b("ui.mode")]);i!==this.#D&&(this.#D=i,this.#p=null,this.#y({restoreFocus:!1}),this.#i(),this.#v())}));this.#o.push($("app.gameState",e=>{const i=renderSnapshotKey([!!e,e?.gameOver,e?.phase==="GAMEOVER",e?.livenessTriggered]);i!==this.#W&&(this.#W=i,this.#i(),this.#b())})),this.#o.push($("app.daySync",e=>{const i=Number(e?.day)||null;i!==this.#$&&(this.#$=i,this.#i())})),this.#o.push($("ui.questObjectives",()=>{this.#t&&this.#E()})),this.#o.push(bt(({name:e})=>{e==="biggestBountiesMode"&&(R()!=="on"&&this.#y({restoreFocus:!1}),this.#i(),this.#v())})),typeof document<"u"&&typeof document.addEventListener=="function"&&(this.#m=()=>{this.#p=null,this.#i(),this.#b(),this.#v(),this.#T({force:!0})},document.addEventListener(V,this.#m),this.#g=()=>{this.#U()},document.addEventListener(Z,this.#g)),this.#R=dt(()=>Promise.all([this.#T(),this.#v()]),vt,{owner:this}),this.#T()}disconnectedCallback(){Y("bounty-details",{restoreFocus:!1});for(const t of this.#o)try{t()}catch{}if(this.#o=[],this.#m&&typeof document<"u")try{document.removeEventListener?.(V,this.#m)}catch{}if(this.#m=null,this.#g&&typeof document<"u")try{document.removeEventListener?.(Z,this.#g)}catch{}this.#g=null,typeof this.#R=="function"&&this.#R(),this.#R=null,this.#r!=null&&clearTimeout(this.#r),this.#r=null,this.#y({restoreFocus:!1}),this.#l+=1,this.#L+=1,this.#p=null,this.#D=null,this.#C=!1}#V(){this.hidden=!1,this.innerHTML=`
      <section class="records-rail" data-bind="records-shell" aria-labelledby="records-rail-title">
        <div class="records-rail__summary">
          <span class="records-rail__identity">
            <span class="records-rail__wordmark" id="records-rail-title" role="heading"
                  aria-level="2" aria-label="The Biggest Bounties">
              <img src="/app/assets/biggest-bounty-wordmark-v39-clean-pillowed-painted-wood.webp"
                   srcset="/app/assets/biggest-bounty-wordmark-v39-clean-pillowed-painted-wood-w440.webp 440w, /app/assets/biggest-bounty-wordmark-v39-clean-pillowed-painted-wood.webp 1898w" sizes="(max-width: 768px) 34vw, 1898px"
                   alt="" aria-hidden="true" loading="lazy" decoding="async">
            </span>
          </span>

          <span class="records-rail__leaders" data-bind="records-leaders"
                role="group" aria-label="The five current Biggest records"></span>

          <button type="button" class="records-rail__toggle" data-bind="records-details-open"
                  aria-label="View full bounty details" title="View full bounty details"
                  aria-haspopup="dialog" aria-expanded="false" aria-controls="panel-bounty-details">
            <span class="records-rail__chevron" aria-hidden="true"></span>
          </button>
        </div>
        <span class="records-rail__notice" data-bind="records-bounty-notice"
              role="status" aria-live="polite" hidden></span>
      </section>
      <section class="panel-popup records-details-popup" id="panel-bounty-details"
               data-panel-popup="bounty-details" data-bind="records-details-popup" hidden
               role="dialog" aria-modal="true" aria-labelledby="bounty-details-title">
        <div class="panel-popup__window">
          <header class="panel-popup__header">
            <h2 id="bounty-details-title">BIGGEST BOUNTIES</h2>
            <button type="button" class="panel-popup__close" data-panel-close aria-label="Close bounty details">×</button>
          </header>
          <div class="panel-popup__body records-rail__expanded">
            <div class="records-rail__expanded-intro">
              <span class="records-rail__rule">Hit an open minimum. The original four pay at +20%; Dice Run pays on any new high.</span>
            </div>
            <ol class="records-rail__cards" data-bind="records-cards" aria-label="Full details for the five all-time records"></ol>
          </div>
        </div>
      </section>
      <div class="records-bounty-dialog" data-bind="records-bounty-dialog" hidden
           role="dialog" aria-modal="true" aria-labelledby="records-bounty-title">
        <button type="button" class="records-bounty-dialog__backdrop"
                data-bind="records-bounty-close" aria-label="Close bounty transaction"></button>
        <section class="records-bounty-dialog__card">
          <button type="button" class="records-bounty-dialog__close"
                  data-bind="records-bounty-close" aria-label="Close bounty transaction">×</button>
          <header class="records-bounty-dialog__hero">
            <span class="records-bounty-dialog__sigil" aria-hidden="true">
              <img src="/app/assets/biggest-bounty-emblem.webp" alt="" loading="lazy" decoding="async">
            </span>
            <span class="records-bounty-dialog__heading">
              <span class="records-bounty-dialog__eyebrow">THE BIGGEST BOUNTY</span>
              <h3 id="records-bounty-title" data-bind="records-bounty-title">BIGGEST PACK RIPPED</h3>
            </span>
          </header>
          <section class="records-bounty-dialog__headline" aria-label="Current bounty on this record">
            <small>BOUNTY ON THE LINE</small>
            <strong>
              <img src="/whitepaper/flame-logo-split.svg" alt="FLIP">
              <b data-bind="records-bounty-payout">—</b>
            </strong>
            <span>BREAK THE RECORD. TAKE THE BOUNTY.</span>
          </section>
          <section class="records-bounty-dialog__spin-controls"
                   data-bind="records-bounty-spin-controls"
                   aria-label="Degenerette bounty bet controls" hidden>
            <label class="records-bounty-dialog__spin-field">
              <span>CARDS</span>
              <span class="records-bounty-dialog__stepper">
                <button type="button" data-bind="records-bounty-spins-down"
                        aria-label="Decrease cards">−</button>
                <input type="number" inputmode="numeric" min="1"
                       max="${BIGGEST_SPIN_MAX_SPINS}" step="1" value="1"
                       data-bind="records-bounty-spins" aria-label="Number of cards">
                <button type="button" data-bind="records-bounty-spins-up"
                        aria-label="Increase cards">+</button>
              </span>
            </label>
            <label class="records-bounty-dialog__spin-field records-bounty-dialog__spin-field--price">
              <span>PRICE / CARD</span>
              <span class="records-bounty-dialog__price-input">
                <input type="text" inputmode="decimal" autocomplete="off"
                       data-bind="records-bounty-spin-price" aria-label="ETH price per card"
                       aria-description="Rounded up to the nearest 0.001 ETH">
                <b>ETH</b>
              </span>
            </label>
            <p class="records-bounty-dialog__spin-floor">
              <strong data-bind="records-bounty-spin-min">—</strong>
              <span data-bind="records-bounty-spin-target">—</span>
            </p>
          </section>
          <p class="records-bounty-dialog__quest-bonus" data-bind="records-bounty-quest-bonus"
             role="status" hidden></p>
          <p class="records-bounty-dialog__alert" data-bind="records-bounty-alert"
             aria-live="polite" hidden></p>
          <button type="button" class="records-bounty-dialog__confirm" data-write
                  data-bind="records-bounty-confirm">
            <span class="records-bounty-dialog__confirm-copy">
              <small data-bind="records-bounty-confirm-action">CONFIRM EXACT SHOT</small>
              <strong data-bind="records-bounty-confirm-amount">—</strong>
            </span>
          </button>
        </section>
      </div>
    `}#Q(){const t=this.querySelector('[data-bind="records-details-open"]'),e=this.querySelector('[data-bind="records-details-popup"]');t?.addEventListener("click",()=>{this.setAttribute("data-bounty-details-open",""),ut("bounty-details",t,e)?t.setAttribute("aria-expanded","true"):this.removeAttribute("data-bounty-details-open")}),e?.addEventListener("app:panel-close",()=>{t?.setAttribute("aria-expanded","false"),this.removeAttribute("data-bounty-details-open")});for(const l of this.querySelectorAll?.('[data-bind="records-bounty-close"]')||[])l.addEventListener("click",()=>this.#y());const i=this.querySelector('[data-bind="records-bounty-confirm"]');i&&i.addEventListener("click",()=>{this.#it()});const n=this.querySelector('[data-bind="records-bounty-spins"]');n&&n.addEventListener("input",()=>this.#M(n.value));const r=this.querySelector('[data-bind="records-bounty-spins-down"]');r&&r.addEventListener("click",()=>this.#F(-1));const s=this.querySelector('[data-bind="records-bounty-spins-up"]');s&&s.addEventListener("click",()=>this.#F(1));const o=this.querySelector('[data-bind="records-bounty-spin-price"]');o&&(o.addEventListener("input",()=>this.#J(o.value)),o.addEventListener("change",()=>this.#q()),o.addEventListener("blur",()=>this.#q()));const c=this.querySelector('[data-bind="records-bounty-dialog"]');c&&c.addEventListener("keydown",l=>{l?.key==="Escape"&&!this.#e&&this.#y()})}#s(t,{error:e=!1,persist:i=!1}={}){const n=this.querySelector('[data-bind="records-bounty-notice"]');if(n&&(this.#r!=null&&clearTimeout(this.#r),this.#r=null,n.textContent=String(t||""),n.hidden=!t,n.classList?.toggle("is-error",!!e),n.classList?.toggle("is-working",!!t&&!e),t&&!i)){this.#r=setTimeout(()=>{n.hidden=!0,n.textContent="",this.#r=null},e?5e3:2e3);try{this.#r?.unref?.()}catch{}}}async#X(t){if(this.#N)return!1;const e=t?.replay??null;if(!e?.battleKey||!e?.viewerBetId)return this.#s("The Dice Run replay link is temporarily unavailable.",{error:!0}),!1;const i=globalThis.document?.querySelector?.("app-craps-table");if(!i?.open)return this.#s("The Craps replay table is unavailable.",{error:!0}),!1;this.#N=!0,this.#s("LOADING BIGGEST DICE RUN REPLAY…",{persist:!0});try{const n=await ot(t);let r=n?.player?this.#u.get(n.player)??null:null;if(n?.player&&!r)try{const o=await N([n.player]);r=o?.get?.(n.player)??null,this.#u=new Map([...this.#u,...o??[]])}catch{}const s=await yt(i,{...e,biggestDiceRun:n?{scoreBps:n.value?.toString?.()??String(n.value??0),player:n.player,label:n.player==null?"UNCLAIMED":r?.name??L(n.player),avatar:r?.avatar,bountyWei:n.bountyWei?.toString?.()??null}:null,fetchImpl:mt});if(!s?.ready){const o=String(s?.pointer?.status??"");return this.#s(o==="pending"||o==="settling"?"The Dice Run replay is still being sealed. Try again shortly.":"The Dice Run replay is unavailable.",{error:o==="failed"}),!1}return this.#s(""),!0}catch{return this.#s("The Dice Run replay is temporarily unavailable. Try again.",{error:!0}),!1}finally{this.#N=!1}}#O(t){return`${k(G(m(t),6))} ETH`}#z(t){const e=D(m(t),6),i=e.includes(".")?e.replace(/0+$/,"").replace(/\.$/,""):e;return`${k(i)} FLIP`}#j(t,e){return e==="FLIP"?this.#z(t):this.#O(t)}#S(t){return G(m(t),18)||"0"}#M(t){const e=this.#t;if(!e||e.kind!==f)return;const i=Math.trunc(Number(t)),n=Math.min(BIGGEST_SPIN_MAX_SPINS,Math.max(1,Number.isFinite(i)?i:e.spinCount||1)),r=e.amountPerSpinWei===e.minimumPerSpinWei,s=recordBountySpinSelection(e,{spinCount:n,amountPerSpinWei:r?0n:e.amountPerSpinWei});s&&(this.#t=s,this.#a=!0,this.#A(),this.#E(),this.#b())}#F(t){const e=this.#t;!e||e.kind!==f||this.#e||this.#M((e.spinCount||1)+Number(t||0))}#J(t){const e=this.#t;if(!e||e.kind!==f)return;const i=this.querySelector('[data-bind="records-bounty-spin-price"]'),n=this.querySelector('[data-bind="records-bounty-spin-controls"]'),r=parseRecordBountyEthInput(t),s=r!=null&&r>=e.minimumPerSpinWei;if(this.#a=s,i?.setAttribute?.("aria-invalid",s?"false":"true"),n?.classList?.toggle?.("is-invalid",!s),s){const o=recordBountySpinSelection(e,{amountPerSpinWei:r});o&&(this.#t=o)}this.#E(),this.#b()}#q(){const t=this.#t;if(!t||t.kind!==f)return;const e=this.querySelector('[data-bind="records-bounty-spin-price"]'),i=parseRecordBountyEthInput(e?.value),n=recordBountySpinSelection(t,{amountPerSpinWei:i!=null&&i>=t.minimumPerSpinWei?i:t.minimumPerSpinWei});n&&(this.#t=n,this.#a=!0,this.#A(),this.#E(),this.#b())}async#v(){const t=++this.#L,e=b("connected.address");if(!e||b("ui.mode")!=="self"||R()!=="on"){this.#p=null;return}const[i,n]=await Promise.allSettled([M(e),w()]);if(t!==this.#L||!this.#C)return;const r=i.status==="fulfilled"?i.value:null,s=n.status==="fulfilled"?n.value:null,o=renderSnapshotKey([r,s])!==renderSnapshotKey([this.#p,this.#P]);this.#p=r,this.#P=s,o&&this.#i(),this.#b()}#h(t,e=null){return gt(e||recordBountyTransactionQuote({state:this.#n,kind:t,ticketPriceWei:this.#P?.priceWei}),{connected:b("connected.address"),acting:A(),mode:b("ui.mode"),funds:this.#p,gameState:b("app.gameState")})}async#H(t){if(Number(t)===_)return{error:"The Dice Run record is set by a finalized scheduled Craps winner."};const e=String(b("connected.address")||"").toLowerCase(),i=String(A?.()||"").toLowerCase(),n=b("ui.mode");if(!e)return{error:"Connect your wallet to take a record shot."};if(!i||i!==e||n!=null&&n!=="self")return{error:"Switch to your connected account to prepare this transaction."};const r=Number(t),s=d(P=>Promise.resolve(P).then(nt=>({ok:!0,value:nt}),()=>({ok:!1,value:null})),"capture"),o=r===T,[c,l,u]=await Promise.all([s(this.#T({loadProfiles:!1,force:!0})),s(O(r)),s(o?w():null),this.#v()]),h=c.value||this.#n;if(!h)return{error:"The live record target is still loading. Try again."};const B=l.ok?l.value:null;if(B==null)return{error:"Could not verify the record on-chain. Try again in a moment."};const E=o?u.value?.priceWei:null,S=Number(b("app.daySync")?.day??b("app.lastDay")?.day)||null,g=recordBountyTransactionQuote({state:h,kind:r,liveMarkWei:B,ticketPriceWei:E,today:S});if(!g)return{error:o?"The live ticket price is unavailable. Try again in a moment.":"The live record target is unavailable. Try again in a moment."};const y=this.#h(r,g);return y?{error:y}:{quote:g}}async#Z(t){if(Number(t)===_||R()!=="on"||this.#h(t)||this.#e||this.#B||this.#t)return;const e=++this.#_;this.#B=!0,this.#s("CHECKING LIVE TARGET…",{persist:!0});let i;try{i=await this.#H(t)}catch{i={error:"Could not verify the live record. Try again in a moment."}}if(e!==this.#_)return;if(this.#B=!1,this.#s(""),i.error){this.#s(i.error,{error:!0});return}const{quote:n}=i;this.#d=Number(t),this.#t=n,Y("bounty-details",{restoreFocus:!1}),this.setAttribute("data-bounty-dialog-open",""),this.#f();const r=this.querySelector('[data-bind="records-bounty-dialog"]');r&&(r.hidden=!1,r.removeAttribute?.("hidden"));const s=d(()=>{try{this.querySelector('[data-bind="records-bounty-confirm"]')?.focus?.({preventScroll:!0})}catch{}},"focusConfirm");typeof requestAnimationFrame=="function"?requestAnimationFrame(s):s()}#f(t="",{error:e=!1}={}){const i=this.#t;if(!i)return;const n=this.querySelector('[data-bind="records-bounty-title"]'),r=this.querySelector('[data-bind="records-bounty-payout"]'),s=this.querySelector('[data-bind="records-bounty-alert"]'),o=this.querySelector('[data-bind="records-bounty-confirm"]');n&&(n.textContent=i.meta?.label||"THE BIGGEST"),r&&(r.textContent=i.payoutWei==null?"LIVE AMOUNT LOADING":k(D(i.payoutWei,0))),s&&(s.textContent=t,s.hidden=!t,s.classList?.toggle("is-error",!!e)),this.#A(),this.#E(),this.#b(o)}#E(){const t=this.querySelector('[data-bind="records-bounty-quest-bonus"]');if(!t)return;const e=this.#t,i=recordBountyQuestProduct(e?.kind),n=e?.kind!==f||this.#a,r=e&&i&&n?ft(b("ui.questObjectives"),i,e.costWei):null;t.hidden=r==null,t.textContent=r?.message||""}#A(){const t=this.#t,e=this.querySelector('[data-bind="records-bounty-spin-controls"]');if(!e)return;const i=t?.kind===f;if(e.hidden=!i,!i){e.setAttribute?.("hidden","");return}e.removeAttribute?.("hidden"),e.classList?.remove?.("is-invalid");const n=this.querySelector('[data-bind="records-bounty-spins"]'),r=this.querySelector('[data-bind="records-bounty-spins-down"]'),s=this.querySelector('[data-bind="records-bounty-spins-up"]'),o=this.querySelector('[data-bind="records-bounty-spin-price"]'),c=this.querySelector('[data-bind="records-bounty-spin-min"]'),l=this.querySelector('[data-bind="records-bounty-spin-target"]');n&&(n.value=String(t.spinCount),n.disabled=this.#e),r&&(r.disabled=this.#e||t.spinCount<=1),s&&(s.disabled=this.#e||t.spinCount>=BIGGEST_SPIN_MAX_SPINS),o&&(o.value=this.#S(t.amountPerSpinWei),o.disabled=this.#e,o.setAttribute?.("aria-invalid","false"),o.setAttribute?.("data-min-wei",String(t.minimumPerSpinWei))),c&&(c.textContent=`MIN ${this.#S(t.minimumPerSpinWei)} ETH / CARD`),l&&(l.textContent=`${this.#S(t.targetWei)} ETH TOTAL BOUNTY FLOOR`)}#b(t=null){const e=this.#t,i=t||this.querySelector('[data-bind="records-bounty-confirm"]');if(!e||!i)return;const n=e.kind!==f||this.#a,r=this.#h(e.kind,e);i.disabled=this.#e||!n||!!r,i.title=r||"";const s=i.querySelector?.('[data-bind="records-bounty-confirm-action"]'),o=i.querySelector?.('[data-bind="records-bounty-confirm-amount"]'),c=this.#tt(e);s&&(s.textContent=this.#e?"CHECKING LIVE TARGET…":n?r||c.action:"PRICE BELOW BOUNTY FLOOR"),o&&(o.textContent=this.#e?"":n?c.amount:`MIN ${this.#S(e.minimumPerSpinWei)} ETH / CARD`,o.hidden=this.#e),i.setAttribute?.("aria-label",this.#e?"Checking the live record target":r||(n?c.ariaLabel:`Price per card must be at least ${this.#S(e.minimumPerSpinWei)} ETH`))}#tt(t){const e=this.#j(t.costWei,t.currency);if(t.kind===v)return{action:"DEPOSIT",amount:e,ariaLabel:`Deposit ${e} to take The Biggest Flip`};if(t.kind===f){const r=Number(t.spinCount||1),s=this.#O(t.amountPerSpinWei||t.targetWei);return{action:r===1?"PLAY 1 CARD":`PLAY ${r} CARDS`,amount:e,ariaLabel:`Place ${r} Degenerette card${r===1?"":"s"} at ${s} each, ${e} total, to take The Biggest Degenerette`}}if(t.kind===C)return{action:"BUY LUCKBOX",amount:e,ariaLabel:`Buy a ${e} Luckbox to take The Biggest Luckbox`};const i=I(t.kind,t.targetWei),n=`${i.amount} ${i.suffix}`.trim();return{action:`BUY ${n}`,amount:e,ariaLabel:`Buy ${n} for ${e} to take The Biggest Pack Ripped`}}#et(t,e){return!t||!e?!0:t.targetWei!==e.targetWei||t.kind!==e.kind||t.kind!==f&&t.costWei!==e.costWei||t.payoutWei!==e.payoutWei}async#it(){if(this.#e||this.#d==null||!this.#a||this.#h(this.#d,this.#t))return;const t=++this.#_,e=this.#t;this.#e=!0,this.#f();let i;try{i=await this.#H(this.#d)}catch{i={error:"Could not refresh the live target."}}if(t!==this.#_)return;if(this.#e=!1,i.error||!i.quote){this.#f(i.error||"Could not refresh the live target.",{error:!0});return}const n=i.quote,r=this.#et(e,n),s=e?.kind===f?recordBountySpinSelection(n,{spinCount:e.spinCount,amountPerSpinWei:e.amountPerSpinWei===e.minimumPerSpinWei?0n:e.amountPerSpinWei}):n;this.#t=s||n,this.#a=!0;const o=this.#h(this.#d,this.#t);if(o){this.#f(o,{error:!0});return}if(r){this.#f("TARGET OR PRICE MOVED · REVIEW THE UPDATED TX",{error:!0});return}const c=recordBountyActivationDetail(this.#t);if(!c||typeof document>"u"){this.#f("THE TRANSACTION ROUTE IS NOT AVAILABLE",{error:!0});return}try{document.dispatchEvent(new CustomEvent("quest:activate",{detail:c}))}catch{this.#f("COULD NOT OPEN THE TRANSACTION",{error:!0});return}this.#y({restoreFocus:!1})}#y({restoreFocus:t=!0}={}){this.#_+=1;const e=this.#d;this.removeAttribute("data-bounty-dialog-open");const i=this.querySelector?.('[data-bind="records-bounty-dialog"]');if(i&&(i.hidden=!0,i.setAttribute?.("hidden","")),this.#t=null,this.#d=null,this.#e=!1,this.#B=!1,this.#a=!0,t&&e!=null)try{this.querySelector?.(`.records-rail__leader[data-kind="${e}"]`)?.focus?.({preventScroll:!0})}catch{}}async#T({loadProfiles:t=!0,force:e=!1}={}){if(!e&&this.#n&&Date.now()-this.#k<J)return this.#n;const i=++this.#l;let n=null;try{n=await W()}catch{return i===this.#l&&(this.#c=!0,this.#i()),null}if(i!==this.#l)return null;if(!n||!Array.isArray(n.records))return this.#c=!0,this.#i(),null;this.#n=n,this.#k=Date.now(),this.#c=!1,St(n,this.#k);const r=X?.()||A?.()||null,s=renderSnapshotKey({state:n,viewed:String(r??"")});if((s==null||s!==this.#w)&&(this.#w=s,z("app.records",n),this.#I=r,this.#i()),!t)return n;const o=n.records.map(u=>u.player).filter(Boolean),c=await N(o);if(i!==this.#l)return null;const l=renderSnapshotKey(c??null);return(l==null||l!==this.#x)&&(this.#x=l,this.#u=c,this.#i()),n}async#U(){const t=this.#n?.records;if(!Array.isArray(t))return null;const e=this.#l,i=t.map(r=>r.player).filter(Boolean),n=await N(i,{fresh:!0});return e!==this.#l?null:(this.#u=n,this.#i(),n)}#i(){const t=this.querySelector('[data-bind="records-shell"]');if(!t)return;const e=R(),i=this.#n;if(e==="off"){this.hidden=!0,t.hidden=!0;return}this.hidden=!1,t.hidden=!1,this.setAttribute("aria-busy",String(!i&&!this.#c));const n=this.querySelector('[data-bind="records-details-open"]');if(n&&(n.disabled=!i),!i){const l=this.querySelector('[data-bind="records-leaders"]');if(l){l.innerHTML="";const u=document.createElement("span");if(u.className="records-rail__loading",u.setAttribute("role","status"),u.textContent=this.#c?"Bounties could not load.":"Loading bounties…",l.appendChild(u),this.#c){const h=document.createElement("button");h.type="button",h.textContent="Retry",h.addEventListener("click",()=>{this.#c=!1,this.#i(),this.#T({force:!0})}),u.appendChild(h)}}return}const r=orderBiggestRecords(i.records),s=this.querySelector('[data-bind="records-leaders"]');if(s){s.innerHTML="";for(const l of r)s.appendChild(this.#nt(l))}const o=this.querySelector('[data-bind="records-cards"]');if(!o)return;o.innerHTML="";const c=String(this.#I||"").toLowerCase();for(const l of r)o.appendChild(this.#rt(l,c))}#nt(t){const e=document.createElement("button");e.type="button",e.className="records-rail__leader",e.dataset.kind=String(t.kind),t.held||e.classList.add("is-open");const i=I(t.kind,t.value),n=formatCompactRecordValue(t.kind,t.held?t.value:t.meta.floorValue),r=n.amount.length>=6?"tight":n.amount.length>=5?"compact":"standard",s=t.player?this.#u.get(t.player):null,o=L(t.player),c=t.held?s?.name||o:"OPEN RECORD",l=t.held&&s?.name?`${s.name} · ${o}`:c,u=this.#K(t),h=u==null?"—":formatCompactBountyWei(u),B=It.get(Number(t.kind))||t.meta.short,E=Number(t.kind)===_;e.classList.toggle("is-replay",E&&!!t.held);const S=E?!!t.held:R()==="on"&&!this.#h(t.kind);e.classList.toggle("is-view-only",!S),e.disabled=!S,S?(e.removeAttribute("aria-disabled"),e.removeAttribute("tabindex")):(e.setAttribute("aria-disabled","true"),e.setAttribute("tabindex","-1"));const g=E?t.held?" Click to replay from the record holder's perspective.":" Set by the winning scheduled Dice Run.":S?" Click to prepare the exact record shot.":R()==="on"?` ${this.#h(t.kind)}`:"";return e.title=t.held?`${t.meta.label}: ${i.amount} ${i.suffix}, held by ${c}; bounty ${h} FLIP.${g}`:`${t.meta.label}: unhit; bounty ${h} FLIP.${g}`,e.setAttribute("aria-label",e.title),e.innerHTML=`
      <img class="records-rail__leader-card-art"
           src="${Rt}" srcset="${kt}"
           sizes="(max-width: 768px) 46vw, 1200px"
           alt="" aria-hidden="true" loading="lazy" decoding="async">
      <span class="records-rail__leader-presentation">
        ${t.held?this.#Y(t.player,s):'<span class="records-rail__portrait records-rail__portrait--open" aria-hidden="true">?</span>'}
        <span class="records-rail__bounty-sight"
              aria-label="${t.held?`Held by ${p(l)}; `:"Open record; "}current bounty ${p(h)} FLIP"
              title="${p(l)} · bounty ${p(h)} FLIP">
          <svg class="records-rail__bounty-crosshair" viewBox="0 0 24 24"
               focusable="false" aria-hidden="true">
            <path d="M12 1v4M12 19v4M1 12h4M19 12h4"></path>
            <circle cx="12" cy="12" r="7"></circle>
            <circle cx="12" cy="12" r="2.25"></circle>
          </svg>
          <b class="records-rail__leader-bounty-amount" aria-hidden="true">${p(h)}</b>
        </span>
      </span>
      <span class="records-rail__leader-title" aria-hidden="true">
        <span>THE BIGGEST</span>
        <strong>${p(B)}</strong>
      </span>
      <span class="records-rail__leader-strip">
        <span class="records-rail__leader-holder" aria-hidden="true">${p(c)}</span>
      </span>
      <span class="records-rail__leader-bet">
        <strong class="records-rail__leader-value"
                data-amount-fit="${r}"
                aria-label="Current record ${p(n.amount)} ${p(n.suffix)}">
          <span class="records-rail__leader-amount">${p(n.amount)}</span>
          ${n.suffix?`<em>${p(n.suffix)}</em>`:""}
        </strong>
      </span>
    `,e.addEventListener("click",y=>{if(y?.preventDefault?.(),y?.stopPropagation?.(),Number(t.kind)===_){t.held&&this.#X(t);return}R()==="on"&&this.#Z(t.kind)}),this.#G(e,t.player),e}#rt(t,e){const i=document.createElement("li");i.className="records-rail__card",i.dataset.kind=String(t.kind),t.held||i.classList.add("is-open"),t.player&&t.player===e&&i.classList.add("is-you");const n=I(t.kind,t.value),r=I(t.kind,t.barToBeat),s=Number(t.kind)===_,o=t.player?this.#u.get(t.player):null,c=Number(b("app.daySync")?.day??b("app.lastDay")?.day)||null,l=q({held:t.held,clockDay:t.clockDay,today:c}),u=this.#K(t,c),h=t.claimCount>0?`${t.meta.label} — paid out ${t.claimCount}×`:t.meta.label;return i.innerHTML=`
      <header class="records-rail__card-head">
        <span class="records-rail__card-title">
          <b title="${p(h)}">${p(t.meta.label)}</b>
        </span>
        ${l?`<i aria-label="${(l/100).toFixed(1)} percent share"
                title="Share of the bounty pool paid for breaking this record">${(l/100).toFixed(1)}%</i>`:""}
      </header>
      ${t.held?`
          <div class="records-rail__metric">
            <small>CURRENT RECORD</small>
            <strong class="records-rail__mark">${p(n.amount)}<em>${p(n.suffix)}</em></strong>
          </div>
          <div class="records-rail__holder">
            ${this.#Y(t.player,o)}
            <span class="records-rail__holder-copy">
              <small>HELD BY</small>
              <b class="records-rail__holder-name">${p(o?.name||L(t.player))}</b>
            </span>
          </div>
          <div class="records-rail__track${s?" records-rail__track--strict":""}" role="presentation">
            <span class="records-rail__fill" style="width:${s?"100":Ct.toFixed(3)}%"></span>
            <span class="records-rail__notch"></span>
          </div>
          <div class="records-rail__stakes">
            <span class="records-rail__beat">
              <small>TARGET TO CLAIM</small>
              <b>${p(r.amount)} <em>${p(r.suffix)}</em></b>
            </span>
            ${u==null?"":`<span class="records-rail__pays">
                  <small>PAYOUT NOW</small>
                  <b>${p(k(D(u,0)))} <em>FLIP</em></b>
                </span>`}
          </div>
        `:`
          <div class="records-rail__metric records-rail__metric--open">
            <small>CURRENT RECORD</small>
            <strong class="records-rail__mark records-rail__mark--open">UNHIT</strong>
          </div>
          <div class="records-rail__holder records-rail__holder--open">
            <span class="records-rail__portrait records-rail__portrait--open" aria-hidden="true">?</span>
            <span class="records-rail__holder-copy">
              <small>HELD BY</small>
              <b class="records-rail__holder-name">Nobody yet</b>
            </span>
          </div>
          <div class="records-rail__stakes">
            <span class="records-rail__pays">
              <small>CURRENT BOUNTY</small>
              <b>${u==null?"—":p(k(D(u,0)))} <em>FLIP</em></b>
            </span>
            <span class="records-rail__beat">
              <small>MIN TO HIT</small>
              <b>${p(t.meta.floorText)}</b>
            </span>
          </div>
        `}
    `,this.#G(i,t.player),i}#K(t,e=Number(b("app.daySync")?.day??b("app.lastDay")?.day)||null){const i=q({held:t.held,clockDay:t.clockDay,today:e});return st(this.#n?.recordPoolWei,i)}#G(t,e){const i=t?.querySelector?.("img.records-rail__portrait");i&&i.addEventListener("error",()=>{const n=document.createElement("span");n.className="records-rail__portrait records-rail__portrait--monogram",n.setAttribute("aria-hidden","true"),n.style.setProperty("--portrait-hue",String(addressHue(e))),n.textContent=addressMonogram(e),i.replaceWith(n)},{once:!0})}#Y(t,e){const i=p(e?.name||L(t));return e?.avatar?`<img class="records-rail__portrait" src="${p(e.avatar)}"
                   alt="${i}" loading="lazy" referrerpolicy="no-referrer">`:`<span class="records-rail__portrait records-rail__portrait--monogram"
                  style="--portrait-hue:${addressHue(t)}"
                  aria-hidden="true">${p(addressMonogram(t))}</span>`}}typeof customElements<"u"&&!customElements.get("app-records-rail")&&customElements.define("app-records-rail",Nt);export function __setRecordsRailDepsForTest({records:a,profiles:t,mark:e,price:i,funds:n}={}){typeof a=="function"&&(W=a),typeof t=="function"&&(N=t),typeof e=="function"&&(O=e),typeof i=="function"&&(w=i),typeof n=="function"&&(M=n)}d(__setRecordsRailDepsForTest,"__setRecordsRailDepsForTest");export function __resetRecordsRailDepsForTest(){W=H,N=U,O=K,w=Q,M=j}d(__resetRecordsRailDepsForTest,"__resetRecordsRailDepsForTest");
//# sourceMappingURL=app-records-rail.js.map
