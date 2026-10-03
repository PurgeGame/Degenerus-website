var et=Object.defineProperty;var u=(s,t)=>et(s,"name",{value:t,configurable:!0});import{accruedPayoutWei as nt,accruedShareBps as q,candidateRecordPayoutWei as rt,fetchRecords as H,fetchProfiles as U,formatRecordValue as k,readLiveRecordMark as K,readPreviousDiceRunRecord as it,recordClaimTarget as st,recordClaimTargetForMark as at,RECORD_KIND_BUY as T,RECORD_KIND_DICE_RUN as _,RECORD_KIND_FLIP as v,RECORD_KIND_LUCKBOX as C,RECORD_KIND_SPIN as f,shortAddress as L}from"../app/records.js";import{displayEthCompact as G,displayToken as D}from"../app/scaling.js";import{TX_CONFIRMED_EVENT as Y}from"../app/contracts.js";import{registerComponentPoll as ot}from"../app/component-poll.js";import{readPurchaseQuote as V,ticketCostFromTickets as lt}from"../app/lootbox.js";import{ETH_DIVISOR as x}from"../app/chain-config.js";import{degeneretteLimits as ct}from"../app/degenerette.js";import{questCompletionBonusModel as ut}from"../app/quest-objectives.js";import{get as m,getActingAddress as $,getViewedAddress as Q,subscribe as A,update as dt}from"../app/store.js";import{readBiggestBountiesModePreference as R,subscribeUiPreferences as pt}from"../app/ui-preferences.js";import{openCrapsReplayTable as ht}from"../craps/replay-adapter.js";import{crapsReplayFetch as ft}from"../craps/replay-fetch.js";import{readRecordBountyFunds as X,recordBountyUnavailableReason as mt}from"../app/record-bounty-eligibility.js";const yt=15e3,z="degenerus:discord-profile-linked",bt="records-bounty",gt=10n**18n;export const BIGGEST_SPIN_PRICE_STEP_WEI=10n**15n/BigInt(x)||1n,BIGGEST_SPIN_MAX_SPINS=ct(0)?.maxSpins??25;const _t=100/1.2,j=new Map([[f,0],[C,1],[T,2],[v,3],[_,4]]),St="/app/assets/biggest-bounty-card-v13.webp",vt=new Map([[_,"DICE RUN"],[f,"DEGENERETTE"],[C,"LUCKBOX"],[T,"PACK RIPPED"],[v,"COINFLIP"]]);export function recordBountyQuestProduct(s){const t=Number(s);return t===T?"purchase":t===C?"lootbox":t===v?"coinflip":t===f?"degenerette-eth":null}u(recordBountyQuestProduct,"recordBountyQuestProduct");let O=H,N=U,w=K,W=V,M=X;function I(s){const[t,e]=String(s??"").split("."),n=t.replace(/\B(?=(\d{3})+(?!\d))/g,",");return e==null?n:`${n}.${e}`}u(I,"group");export function formatCompactBountyWei(s){let t;try{t=BigInt(s??0)}catch{return"—"}t<0n&&(t=-t);const e=t/10n**18n;if(e===0n)return t>0n?"<1":"0";const n=e.toString().length,r=n>2?10n**BigInt(n-2):1n,i=r>1n?(e+r/2n)/r*r:e,o=[[10n**15n,"Q"],[10n**12n,"T"],[10n**9n,"B"],[10n**6n,"M"],[10n**3n,"K"]].find(([h])=>i>=h);if(!o)return I(i.toString());const[l,c]=o,p=i*10n/l;return p<100n&&p%10n!==0n?`${p/10n}.${p%10n}${c}`:`${i/l}${c}`}u(formatCompactBountyWei,"formatCompactBountyWei");function F(s){let t;try{t=BigInt(s??0)}catch{return"—"}if(t<0n&&(t=-t),t<1000n)return I(t.toString());const e=t.toString().length,n=10n**BigInt(Math.max(0,e-3)),r=t/n*n,i=[[10n**15n,"Q"],[10n**12n,"T"],[10n**9n,"B"],[10n**6n,"M"],[10n**3n,"K"]],[a,o]=i.find(([h])=>r>=h)||[1n,""],l=r*100n/a,c=l/100n,p=(l%100n).toString().padStart(2,"0").replace(/0+$/,"");return p?`${c}.${p}${o}`:`${c}${o}`}u(F,"formatCompactWholeDown");function Et(s){let t;try{t=BigInt(s??0)}catch{return"—"}t<0n&&(t=-t);const e=10n**18n,n=t*BigInt(x),r=n/e;if(r>=1000n)return F(r);const i=r.toString(),a=(n%e).toString().padStart(18,"0");if(r>0n){const c=Math.max(0,3-i.length),p=a.slice(0,c).replace(/0+$/,"");return p?`${i}.${p}`:i}const o=a.search(/[1-9]/);return o<0?"0":`0.${a.slice(0,o+3).replace(/0+$/,"")}`}u(Et,"formatCompactEthRecord");export function formatCompactRecordValue(s,t){if(Number(s)===_){let e=0n;try{e=BigInt(t??0)}catch{}e<0n&&(e=-e);const n=(e/10000n).toString().length,r=Math.max(0,3-n),i=10n**BigInt(Math.max(0,4-r));return{amount:`${k(s,e/i*i).amount}x`,suffix:""}}if(Number(s)===T)return{amount:F(t),suffix:"TIX"};if(Number(s)===v){let e=0n;try{e=BigInt(t??0)/10n**18n}catch{}return{amount:F(e),suffix:"FLIP"}}return[f,C].includes(Number(s))?{amount:Et(t),suffix:"ETH"}:k(s,t)}u(formatCompactRecordValue,"formatCompactRecordValue");export function orderBiggestRecords(s){return[...Array.isArray(s)?s:[]].sort((t,e)=>(j.get(Number(t?.kind))??Number.MAX_SAFE_INTEGER)-(j.get(Number(e?.kind))??Number.MAX_SAFE_INTEGER))}u(orderBiggestRecords,"orderBiggestRecords");function b(s){try{const t=BigInt(s??0);return t>0n?t:0n}catch{return 0n}}u(b,"nonNegativeWei");export function parseRecordBountyEthInput(s){const t=/^\s*(?:(\d+)(?:\.(\d{0,18}))?|\.(\d{1,18}))\s*$/.exec(String(s??""));if(!t)return null;try{const e=t[1]||"0",n=(t[2]||t[3]||"").padEnd(18,"0");return(BigInt(e)*gt+BigInt(n||"0"))/BigInt(x)}catch{return null}}u(parseRecordBountyEthInput,"parseRecordBountyEthInput");function J(s,t){return s<=0n?0n:(s+t-1n)/t}u(J,"divideRoundUp");function Z(s,t){return J(s,t)*t}u(Z,"roundUpTo");export function recordBountySpinSelection(s,{spinCount:t=s?.spinCount??1,amountPerSpinWei:e=s?.amountPerSpinWei??s?.targetWei}={}){if(!s||Number(s.kind)!==f)return s??null;const n=Number(t);if(!Number.isInteger(n)||n<1||n>BIGGEST_SPIN_MAX_SPINS)return null;const r=b(s.targetWei);if(r<=0n)return null;const i=Z(J(r,BigInt(n)),BIGGEST_SPIN_PRICE_STEP_WEI);let a=b(e);return a<i&&(a=i),a=Z(a,BIGGEST_SPIN_PRICE_STEP_WEI),{...s,spinCount:n,amountPerSpinWei:a,minimumPerSpinWei:i,costWei:a*BigInt(n)}}u(recordBountySpinSelection,"recordBountySpinSelection");export function recordBountyTransactionQuote({state:s,kind:t,liveMarkWei:e=null,ticketPriceWei:n=null,today:r=null}={}){const i=Number(t);if(i===_)return null;const a=Array.isArray(s?.records)?s.records.find(y=>Number(y?.kind)===i):null;if(!a)return null;const o=e!=null,l=o?b(e):null,c=o?at(i,l):st(s,i);if(c==null||c<=0n)return null;let p=c;if(i===T){const y=Number(c),P=b(n);if(!Number.isSafeInteger(y)||y<=0||P<=0n)return null;p=lt(P,y)}const h=b(a.value),E=!o||h===l?rt({state:s,kind:i,candidate:c,today:r}):null,S=i===v?"ONE COINFLIP DEPOSIT":i===f?"DEGENERETTE BET":i===C?"ONE LUCKBOX BUY":"ONE TICKET BUY",g={kind:i,meta:a.meta,action:S,targetWei:c,costWei:p,payoutWei:E,liveMarkWei:l,currency:i===v?"FLIP":"ETH"};return i===f?recordBountySpinSelection(g):g}u(recordBountyTransactionQuote,"recordBountyTransactionQuote");export function recordBountyActivationDetail(s){if(!s||s.targetWei==null)return null;const t={source:bt,variant:"bounty",submit:!0};if(s.kind===v)return{...t,questType:2,target:String(s.targetWei)};if(s.kind===f){const e=Number(s.spinCount??1),n=b(s.amountPerSpinWei??s.targetWei);return!Number.isInteger(e)||e<1||e>BIGGEST_SPIN_MAX_SPINS||n*BigInt(e)<b(s.targetWei)?null:{...t,questType:7,target:String(n*BigInt(e)),amountPerSpin:String(n),spinCount:e,preferClaimable:!0}}return s.kind===C?{...t,questType:6,target:String(s.targetWei),preferClaimable:!0,useAfking:!0}:s.kind===T?{...t,questType:1,target:String(s.costWei),ticketQuantity:String(s.targetWei),purchaseKind:"ticket",preferClaimable:!0,useAfking:!0}:null}u(recordBountyActivationDetail,"recordBountyActivationDetail");function d(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}u(d,"escapeHtml");export function renderSnapshotKey(s){try{return JSON.stringify(s,(t,e)=>typeof e=="bigint"?`bigint:${e}`:e instanceof Map?[...e.entries()].sort(([n],[r])=>String(n).localeCompare(String(r))):e)}catch{return null}}u(renderSnapshotKey,"renderSnapshotKey");export function addressMonogram(s){const t=String(s||"").replace(/^0x/i,"").toUpperCase();return t.length>=2?t.slice(0,2):"··"}u(addressMonogram,"addressMonogram");export function addressHue(s){const t=String(s||"").replace(/^0x/i,"").slice(0,6),e=Number.parseInt(t,16);return Number.isFinite(e)?e%360:0}u(addressHue,"addressHue");class Tt extends HTMLElement{static{u(this,"AppRecordsRail")}#E=!1;#a=[];#T=null;#y=null;#b=null;#h=0;#f=null;#o=new Map;#C=null;#n=null;#t=null;#l=null;#e=!1;#R=!1;#g=0;#s=!0;#k=!1;#D=null;#$=null;#A=null;#c=null;#B=null;#N=0;#P=null;#W=null;connectedCallback(){if(!this.#E){this.#E=!0,this.#K(),this.#G();for(const t of["connected.address","viewing.address","ui.mode"])this.#a.push(A(t,()=>{this.#C=Q?.()||$?.()||null;const e=renderSnapshotKey([m("connected.address"),this.#C,m("ui.mode")]);e!==this.#P&&(this.#P=e,this.#c=null,this.#m({restoreFocus:!1}),this.#i(),this.#S())}));this.#a.push(A("app.gameState",t=>{const e=renderSnapshotKey([!!t,t?.gameOver,t?.phase==="GAMEOVER",t?.livenessTriggered]);e!==this.#W&&(this.#W=e,this.#i(),this.#p())})),this.#a.push(A("app.daySync",t=>{const e=Number(t?.day)||null;e!==this.#D&&(this.#D=e,this.#i())})),this.#a.push(A("ui.questObjectives",()=>{this.#t&&this.#v()})),this.#a.push(pt(({name:t})=>{t==="biggestBountiesMode"&&(R()!=="on"&&this.#m({restoreFocus:!1}),this.#i(),this.#S())})),typeof document<"u"&&typeof document.addEventListener=="function"&&(this.#y=()=>{this.#c=null,this.#i(),this.#p(),this.#S(),this.#I()},document.addEventListener(Y,this.#y),this.#b=()=>{this.#tt()},document.addEventListener(z,this.#b)),this.#T=ot(()=>Promise.all([this.#I(),this.#S()]),yt),this.#I()}}disconnectedCallback(){for(const t of this.#a)try{t()}catch{}if(this.#a=[],this.#y&&typeof document<"u")try{document.removeEventListener?.(Y,this.#y)}catch{}if(this.#y=null,this.#b&&typeof document<"u")try{document.removeEventListener?.(z,this.#b)}catch{}this.#b=null,typeof this.#T=="function"&&this.#T(),this.#T=null,this.#n!=null&&clearTimeout(this.#n),this.#n=null,this.#m({restoreFocus:!1}),this.#h+=1,this.#N+=1,this.#c=null,this.#P=null,this.#E=!1}#K(){this.hidden=!0,this.innerHTML=`
      <section class="records-rail" data-bind="records-shell" hidden aria-labelledby="records-rail-title">
        <details class="records-rail__disclosure">
          <summary class="records-rail__summary" title="Show or hide full bounty details">
          <span class="records-rail__identity">
            <span class="records-rail__wordmark" id="records-rail-title" role="heading"
                  aria-level="2" aria-label="The Biggest Bounties">
              <img src="/app/assets/biggest-bounty-wordmark-v39-clean-pillowed-painted-wood.webp"
                   alt="" aria-hidden="true" loading="lazy" decoding="async">
            </span>
          </span>

          <span class="records-rail__leaders" data-bind="records-leaders"
                role="group" aria-label="The five current Biggest records"></span>

          <span class="records-rail__toggle" aria-hidden="true">
            <span class="records-rail__chevron"></span>
          </span>
          </summary>

          <div class="records-rail__expanded">
            <div class="records-rail__expanded-intro">
              <span class="records-rail__rule">Hit an open minimum. The original four pay at +20%; Dice Run pays on any new high.</span>
            </div>
            <ol class="records-rail__cards" data-bind="records-cards" aria-label="Full details for the five all-time records"></ol>
          </div>
        </details>
        <span class="records-rail__notice" data-bind="records-bounty-notice"
              role="status" aria-live="polite" hidden></span>
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
    `}#G(){for(const o of this.querySelectorAll?.('[data-bind="records-bounty-close"]')||[])o.addEventListener("click",()=>this.#m());const t=this.querySelector('[data-bind="records-bounty-confirm"]');t&&t.addEventListener("click",()=>{this.#Z()});const e=this.querySelector('[data-bind="records-bounty-spins"]');e&&e.addEventListener("input",()=>this.#O(e.value));const n=this.querySelector('[data-bind="records-bounty-spins-down"]');n&&n.addEventListener("click",()=>this.#w(-1));const r=this.querySelector('[data-bind="records-bounty-spins-up"]');r&&r.addEventListener("click",()=>this.#w(1));const i=this.querySelector('[data-bind="records-bounty-spin-price"]');i&&(i.addEventListener("input",()=>this.#X(i.value)),i.addEventListener("change",()=>this.#M()),i.addEventListener("blur",()=>this.#M()));const a=this.querySelector('[data-bind="records-bounty-dialog"]');a&&a.addEventListener("keydown",o=>{o?.key==="Escape"&&!this.#e&&this.#m()})}#r(t,{error:e=!1,persist:n=!1}={}){const r=this.querySelector('[data-bind="records-bounty-notice"]');if(r&&(this.#n!=null&&clearTimeout(this.#n),this.#n=null,r.textContent=String(t||""),r.hidden=!t,r.classList?.toggle("is-error",!!e),r.classList?.toggle("is-working",!!t&&!e),t&&!n)){this.#n=setTimeout(()=>{r.hidden=!0,r.textContent="",this.#n=null},e?5e3:2e3);try{this.#n?.unref?.()}catch{}}}async#Y(t){if(this.#k)return!1;const e=t?.replay??null;if(!e?.battleKey||!e?.viewerBetId)return this.#r("The Dice Run replay link is temporarily unavailable.",{error:!0}),!1;const n=globalThis.document?.querySelector?.("app-craps-table");if(!n?.open)return this.#r("The Craps replay table is unavailable.",{error:!0}),!1;this.#k=!0,this.#r("LOADING BIGGEST DICE RUN REPLAY…",{persist:!0});try{const r=await it(t);let i=r?.player?this.#o.get(r.player)??null:null;if(r?.player&&!i)try{const o=await N([r.player]);i=o?.get?.(r.player)??null,this.#o=new Map([...this.#o,...o??[]])}catch{}const a=await ht(n,{...e,biggestDiceRun:r?{scoreBps:r.value?.toString?.()??String(r.value??0),player:r.player,label:r.player==null?"UNCLAIMED":i?.name??L(r.player),avatar:i?.avatar,bountyWei:r.bountyWei?.toString?.()??null}:null,fetchImpl:ft});if(!a?.ready){const o=String(a?.pointer?.status??"");return this.#r(o==="pending"||o==="settling"?"The Dice Run replay is still being sealed. Try again shortly.":"The Dice Run replay is unavailable.",{error:o==="failed"}),!1}return this.#r(""),!0}catch{return this.#r("The Dice Run replay is temporarily unavailable. Try again.",{error:!0}),!1}finally{this.#k=!1}}#x(t){return`${I(G(b(t),6))} ETH`}#V(t){const e=D(b(t),6),n=e.includes(".")?e.replace(/0+$/,"").replace(/\.$/,""):e;return`${I(n)} FLIP`}#Q(t,e){return e==="FLIP"?this.#V(t):this.#x(t)}#_(t){return G(b(t),18)||"0"}#O(t){const e=this.#t;if(!e||e.kind!==f)return;const n=Math.trunc(Number(t)),r=Math.min(BIGGEST_SPIN_MAX_SPINS,Math.max(1,Number.isFinite(n)?n:e.spinCount||1)),i=e.amountPerSpinWei===e.minimumPerSpinWei,a=recordBountySpinSelection(e,{spinCount:r,amountPerSpinWei:i?0n:e.amountPerSpinWei});a&&(this.#t=a,this.#s=!0,this.#L(),this.#v(),this.#p())}#w(t){const e=this.#t;!e||e.kind!==f||this.#e||this.#O((e.spinCount||1)+Number(t||0))}#X(t){const e=this.#t;if(!e||e.kind!==f)return;const n=this.querySelector('[data-bind="records-bounty-spin-price"]'),r=this.querySelector('[data-bind="records-bounty-spin-controls"]'),i=parseRecordBountyEthInput(t),a=i!=null&&i>=e.minimumPerSpinWei;if(this.#s=a,n?.setAttribute?.("aria-invalid",a?"false":"true"),r?.classList?.toggle?.("is-invalid",!a),a){const o=recordBountySpinSelection(e,{amountPerSpinWei:i});o&&(this.#t=o)}this.#v(),this.#p()}#M(){const t=this.#t;if(!t||t.kind!==f)return;const e=this.querySelector('[data-bind="records-bounty-spin-price"]'),n=parseRecordBountyEthInput(e?.value),r=recordBountySpinSelection(t,{amountPerSpinWei:n!=null&&n>=t.minimumPerSpinWei?n:t.minimumPerSpinWei});r&&(this.#t=r,this.#s=!0,this.#L(),this.#v(),this.#p())}async#S(){const t=++this.#N,e=m("connected.address");if(!e||m("ui.mode")!=="self"||R()!=="on"){this.#c=null;return}const[n,r]=await Promise.allSettled([M(e),W()]);if(t!==this.#N||!this.#E)return;const i=n.status==="fulfilled"?n.value:null,a=r.status==="fulfilled"?r.value:null,o=renderSnapshotKey([i,a])!==renderSnapshotKey([this.#c,this.#B]);this.#c=i,this.#B=a,o&&this.#i(),this.#p()}#u(t,e=null){return mt(e||recordBountyTransactionQuote({state:this.#f,kind:t,ticketPriceWei:this.#B?.priceWei}),{connected:m("connected.address"),acting:$(),mode:m("ui.mode"),funds:this.#c,gameState:m("app.gameState")})}async#F(t){if(Number(t)===_)return{error:"The Dice Run record is set by a finalized scheduled Craps winner."};const e=String(m("connected.address")||"").toLowerCase(),n=String($?.()||"").toLowerCase(),r=m("ui.mode");if(!e)return{error:"Connect your wallet to take a record shot."};if(!n||n!==e||r!=null&&r!=="self")return{error:"Switch to your connected account to prepare this transaction."};const i=Number(t),a=u(P=>Promise.resolve(P).then(tt=>({ok:!0,value:tt}),()=>({ok:!1,value:null})),"capture"),o=i===T,[l,c,p]=await Promise.all([a(this.#I({loadProfiles:!1})),a(w(i)),a(o?W():null),this.#S()]),h=l.value||this.#f;if(!h)return{error:"The live record target is still loading. Try again."};const B=c.ok?c.value:null;if(B==null)return{error:"Could not verify the record on-chain. Try again in a moment."};const E=o?p.value?.priceWei:null,S=Number(m("app.daySync")?.day??m("app.lastDay")?.day)||null,g=recordBountyTransactionQuote({state:h,kind:i,liveMarkWei:B,ticketPriceWei:E,today:S});if(!g)return{error:o?"The live ticket price is unavailable. Try again in a moment.":"The live record target is unavailable. Try again in a moment."};const y=this.#u(i,g);return y?{error:y}:{quote:g}}async#z(t){if(Number(t)===_||R()!=="on"||this.#u(t)||this.#e||this.#R||this.#t)return;const e=++this.#g;this.#R=!0,this.#r("CHECKING LIVE TARGET…",{persist:!0});let n;try{n=await this.#F(t)}catch{n={error:"Could not verify the live record. Try again in a moment."}}if(e!==this.#g)return;if(this.#R=!1,this.#r(""),n.error){this.#r(n.error,{error:!0});return}const{quote:r}=n;this.#l=Number(t),this.#t=r,this.setAttribute("data-bounty-dialog-open",""),this.#d();const i=this.querySelector('[data-bind="records-bounty-dialog"]');i&&(i.hidden=!1,i.removeAttribute?.("hidden"));const a=u(()=>{try{this.querySelector('[data-bind="records-bounty-confirm"]')?.focus?.({preventScroll:!0})}catch{}},"focusConfirm");typeof requestAnimationFrame=="function"?requestAnimationFrame(a):a()}#d(t="",{error:e=!1}={}){const n=this.#t;if(!n)return;const r=this.querySelector('[data-bind="records-bounty-title"]'),i=this.querySelector('[data-bind="records-bounty-payout"]'),a=this.querySelector('[data-bind="records-bounty-alert"]'),o=this.querySelector('[data-bind="records-bounty-confirm"]');r&&(r.textContent=n.meta?.label||"THE BIGGEST"),i&&(i.textContent=n.payoutWei==null?"LIVE AMOUNT LOADING":I(D(n.payoutWei,0))),a&&(a.textContent=t,a.hidden=!t,a.classList?.toggle("is-error",!!e)),this.#L(),this.#v(),this.#p(o)}#v(){const t=this.querySelector('[data-bind="records-bounty-quest-bonus"]');if(!t)return;const e=this.#t,n=recordBountyQuestProduct(e?.kind),r=e?.kind!==f||this.#s,i=e&&n&&r?ut(m("ui.questObjectives"),n,e.costWei):null;t.hidden=i==null,t.textContent=i?.message||""}#L(){const t=this.#t,e=this.querySelector('[data-bind="records-bounty-spin-controls"]');if(!e)return;const n=t?.kind===f;if(e.hidden=!n,!n){e.setAttribute?.("hidden","");return}e.removeAttribute?.("hidden"),e.classList?.remove?.("is-invalid");const r=this.querySelector('[data-bind="records-bounty-spins"]'),i=this.querySelector('[data-bind="records-bounty-spins-down"]'),a=this.querySelector('[data-bind="records-bounty-spins-up"]'),o=this.querySelector('[data-bind="records-bounty-spin-price"]'),l=this.querySelector('[data-bind="records-bounty-spin-min"]'),c=this.querySelector('[data-bind="records-bounty-spin-target"]');r&&(r.value=String(t.spinCount),r.disabled=this.#e),i&&(i.disabled=this.#e||t.spinCount<=1),a&&(a.disabled=this.#e||t.spinCount>=BIGGEST_SPIN_MAX_SPINS),o&&(o.value=this.#_(t.amountPerSpinWei),o.disabled=this.#e,o.setAttribute?.("aria-invalid","false"),o.setAttribute?.("data-min-wei",String(t.minimumPerSpinWei))),l&&(l.textContent=`MIN ${this.#_(t.minimumPerSpinWei)} ETH / CARD`),c&&(c.textContent=`${this.#_(t.targetWei)} ETH TOTAL BOUNTY FLOOR`)}#p(t=null){const e=this.#t,n=t||this.querySelector('[data-bind="records-bounty-confirm"]');if(!e||!n)return;const r=e.kind!==f||this.#s,i=this.#u(e.kind,e);n.disabled=this.#e||!r||!!i,n.title=i||"";const a=n.querySelector?.('[data-bind="records-bounty-confirm-action"]'),o=n.querySelector?.('[data-bind="records-bounty-confirm-amount"]'),l=this.#j(e);a&&(a.textContent=this.#e?"CHECKING LIVE TARGET…":r?i||l.action:"PRICE BELOW BOUNTY FLOOR"),o&&(o.textContent=this.#e?"":r?l.amount:`MIN ${this.#_(e.minimumPerSpinWei)} ETH / CARD`,o.hidden=this.#e),n.setAttribute?.("aria-label",this.#e?"Checking the live record target":i||(r?l.ariaLabel:`Price per card must be at least ${this.#_(e.minimumPerSpinWei)} ETH`))}#j(t){const e=this.#Q(t.costWei,t.currency);if(t.kind===v)return{action:"DEPOSIT",amount:e,ariaLabel:`Deposit ${e} to take The Biggest Flip`};if(t.kind===f){const i=Number(t.spinCount||1),a=this.#x(t.amountPerSpinWei||t.targetWei);return{action:i===1?"PLAY 1 CARD":`PLAY ${i} CARDS`,amount:e,ariaLabel:`Place ${i} Degenerette card${i===1?"":"s"} at ${a} each, ${e} total, to take The Biggest Degenerette`}}if(t.kind===C)return{action:"BUY LUCKBOX",amount:e,ariaLabel:`Buy a ${e} Luckbox to take The Biggest Luckbox`};const n=k(t.kind,t.targetWei),r=`${n.amount} ${n.suffix}`.trim();return{action:`BUY ${r}`,amount:e,ariaLabel:`Buy ${r} for ${e} to take The Biggest Pack Ripped`}}#J(t,e){return!t||!e?!0:t.targetWei!==e.targetWei||t.kind!==e.kind||t.kind!==f&&t.costWei!==e.costWei||t.payoutWei!==e.payoutWei}async#Z(){if(this.#e||this.#l==null||!this.#s||this.#u(this.#l,this.#t))return;const t=++this.#g,e=this.#t;this.#e=!0,this.#d();let n;try{n=await this.#F(this.#l)}catch{n={error:"Could not refresh the live target."}}if(t!==this.#g)return;if(this.#e=!1,n.error||!n.quote){this.#d(n.error||"Could not refresh the live target.",{error:!0});return}const r=n.quote,i=this.#J(e,r),a=e?.kind===f?recordBountySpinSelection(r,{spinCount:e.spinCount,amountPerSpinWei:e.amountPerSpinWei===e.minimumPerSpinWei?0n:e.amountPerSpinWei}):r;this.#t=a||r,this.#s=!0;const o=this.#u(this.#l,this.#t);if(o){this.#d(o,{error:!0});return}if(i){this.#d("TARGET OR PRICE MOVED · REVIEW THE UPDATED TX",{error:!0});return}const l=recordBountyActivationDetail(this.#t);if(!l||typeof document>"u"){this.#d("THE TRANSACTION ROUTE IS NOT AVAILABLE",{error:!0});return}try{document.dispatchEvent(new CustomEvent("quest:activate",{detail:l}))}catch{this.#d("COULD NOT OPEN THE TRANSACTION",{error:!0});return}this.#m({restoreFocus:!1})}#m({restoreFocus:t=!0}={}){this.#g+=1;const e=this.#l;this.removeAttribute("data-bounty-dialog-open");const n=this.querySelector?.('[data-bind="records-bounty-dialog"]');if(n&&(n.hidden=!0,n.setAttribute?.("hidden","")),this.#t=null,this.#l=null,this.#e=!1,this.#R=!1,this.#s=!0,t&&e!=null)try{this.querySelector?.(`.records-rail__leader[data-kind="${e}"]`)?.focus?.({preventScroll:!0})}catch{}}async#I({loadProfiles:t=!0}={}){const e=++this.#h;let n=null;try{n=await O()}catch{return null}if(e!==this.#h)return null;this.#f=n;const r=Q?.()||$?.()||null,i=renderSnapshotKey({state:n,viewed:String(r??"")});if((i==null||i!==this.#$)&&(this.#$=i,dt("app.records",n),this.#C=r,this.#i()),!t)return n;const a=n.records.map(c=>c.player).filter(Boolean),o=await N(a);if(e!==this.#h)return null;const l=renderSnapshotKey(o??null);return(l==null||l!==this.#A)&&(this.#A=l,this.#o=o,this.#i()),n}async#tt(){const t=this.#f?.records;if(!Array.isArray(t))return null;const e=this.#h,n=t.map(i=>i.player).filter(Boolean),r=await N(n,{fresh:!0});return e!==this.#h?null:(this.#o=r,this.#i(),r)}#i(){const t=this.querySelector('[data-bind="records-shell"]');if(!t)return;const e=R(),n=this.#f;if(!n||e==="off"){this.hidden=!0,t.hidden=!0;return}this.hidden=!1,t.hidden=!1;const r=orderBiggestRecords(n.records),i=this.querySelector('[data-bind="records-leaders"]');if(i){i.innerHTML="";for(const l of r)i.appendChild(this.#et(l))}const a=this.querySelector('[data-bind="records-cards"]');if(!a)return;a.innerHTML="";const o=String(this.#C||"").toLowerCase();for(const l of r)a.appendChild(this.#nt(l,o))}#et(t){const e=document.createElement("button");e.type="button",e.className="records-rail__leader",e.dataset.kind=String(t.kind),t.held||e.classList.add("is-open");const n=k(t.kind,t.value),r=formatCompactRecordValue(t.kind,t.held?t.value:t.meta.floorValue),i=r.amount.length>=6?"tight":r.amount.length>=5?"compact":"standard",a=t.player?this.#o.get(t.player):null,o=L(t.player),l=t.held?a?.name||o:"OPEN RECORD",c=t.held&&a?.name?`${a.name} · ${o}`:l,p=this.#q(t),h=p==null?"—":formatCompactBountyWei(p),B=vt.get(Number(t.kind))||t.meta.short,E=Number(t.kind)===_;e.classList.toggle("is-replay",E&&!!t.held);const S=E?!!t.held:R()==="on"&&!this.#u(t.kind);e.classList.toggle("is-view-only",!S),e.disabled=!S,S?(e.removeAttribute("aria-disabled"),e.removeAttribute("tabindex")):(e.setAttribute("aria-disabled","true"),e.setAttribute("tabindex","-1"));const g=E?t.held?" Click to replay from the record holder's perspective.":" Set by the winning scheduled Dice Run.":S?" Click to prepare the exact record shot.":R()==="on"?` ${this.#u(t.kind)}`:"";return e.title=t.held?`${t.meta.label}: ${n.amount} ${n.suffix}, held by ${l}; bounty ${h} FLIP.${g}`:`${t.meta.label}: unhit; bounty ${h} FLIP.${g}`,e.setAttribute("aria-label",e.title),e.innerHTML=`
      <img class="records-rail__leader-card-art"
           src="${St}"
           alt="" aria-hidden="true" loading="lazy" decoding="async">
      <span class="records-rail__leader-presentation">
        ${t.held?this.#U(t.player,a):'<span class="records-rail__portrait records-rail__portrait--open" aria-hidden="true">?</span>'}
        <span class="records-rail__bounty-sight"
              aria-label="${t.held?`Held by ${d(c)}; `:"Open record; "}current bounty ${d(h)} FLIP"
              title="${d(c)} · bounty ${d(h)} FLIP">
          <svg class="records-rail__bounty-crosshair" viewBox="0 0 24 24"
               focusable="false" aria-hidden="true">
            <path d="M12 1v4M12 19v4M1 12h4M19 12h4"></path>
            <circle cx="12" cy="12" r="7"></circle>
            <circle cx="12" cy="12" r="2.25"></circle>
          </svg>
          <b class="records-rail__leader-bounty-amount" aria-hidden="true">${d(h)}</b>
        </span>
      </span>
      <span class="records-rail__leader-title" aria-hidden="true">
        <span>THE BIGGEST</span>
        <strong>${d(B)}</strong>
      </span>
      <span class="records-rail__leader-strip">
        <span class="records-rail__leader-holder" aria-hidden="true">${d(l)}</span>
      </span>
      <span class="records-rail__leader-bet">
        <strong class="records-rail__leader-value"
                data-amount-fit="${i}"
                aria-label="Current record ${d(r.amount)} ${d(r.suffix)}">
          <span class="records-rail__leader-amount">${d(r.amount)}</span>
          ${r.suffix?`<em>${d(r.suffix)}</em>`:""}
        </strong>
      </span>
    `,e.addEventListener("click",y=>{if(y?.preventDefault?.(),y?.stopPropagation?.(),Number(t.kind)===_){t.held&&this.#Y(t);return}R()==="on"&&this.#z(t.kind)}),this.#H(e,t.player),e}#nt(t,e){const n=document.createElement("li");n.className="records-rail__card",n.dataset.kind=String(t.kind),t.held||n.classList.add("is-open"),t.player&&t.player===e&&n.classList.add("is-you");const r=k(t.kind,t.value),i=k(t.kind,t.barToBeat),a=Number(t.kind)===_,o=t.player?this.#o.get(t.player):null,l=Number(m("app.daySync")?.day??m("app.lastDay")?.day)||null,c=q({held:t.held,clockDay:t.clockDay,today:l}),p=this.#q(t,l),h=t.claimCount>0?`${t.meta.label} — paid out ${t.claimCount}×`:t.meta.label;return n.innerHTML=`
      <header class="records-rail__card-head">
        <span class="records-rail__card-title">
          <b title="${d(h)}">${d(t.meta.label)}</b>
        </span>
        ${c?`<i aria-label="${(c/100).toFixed(1)} percent share"
                title="Share of the bounty pool paid for breaking this record">${(c/100).toFixed(1)}%</i>`:""}
      </header>
      ${t.held?`
          <div class="records-rail__metric">
            <small>CURRENT RECORD</small>
            <strong class="records-rail__mark">${d(r.amount)}<em>${d(r.suffix)}</em></strong>
          </div>
          <div class="records-rail__holder">
            ${this.#U(t.player,o)}
            <span class="records-rail__holder-copy">
              <small>HELD BY</small>
              <b class="records-rail__holder-name">${d(o?.name||L(t.player))}</b>
            </span>
          </div>
          <div class="records-rail__track${a?" records-rail__track--strict":""}" role="presentation">
            <span class="records-rail__fill" style="width:${a?"100":_t.toFixed(3)}%"></span>
            <span class="records-rail__notch"></span>
          </div>
          <div class="records-rail__stakes">
            <span class="records-rail__beat">
              <small>TARGET TO CLAIM</small>
              <b>${d(i.amount)} <em>${d(i.suffix)}</em></b>
            </span>
            ${p==null?"":`<span class="records-rail__pays">
                  <small>PAYOUT NOW</small>
                  <b>${d(I(D(p,0)))} <em>FLIP</em></b>
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
              <b>${p==null?"—":d(I(D(p,0)))} <em>FLIP</em></b>
            </span>
            <span class="records-rail__beat">
              <small>MIN TO HIT</small>
              <b>${d(t.meta.floorText)}</b>
            </span>
          </div>
        `}
    `,this.#H(n,t.player),n}#q(t,e=Number(m("app.daySync")?.day??m("app.lastDay")?.day)||null){const n=q({held:t.held,clockDay:t.clockDay,today:e});return nt(this.#f?.recordPoolWei,n)}#H(t,e){const n=t?.querySelector?.("img.records-rail__portrait");n&&n.addEventListener("error",()=>{const r=document.createElement("span");r.className="records-rail__portrait records-rail__portrait--monogram",r.setAttribute("aria-hidden","true"),r.style.setProperty("--portrait-hue",String(addressHue(e))),r.textContent=addressMonogram(e),n.replaceWith(r)},{once:!0})}#U(t,e){const n=d(e?.name||L(t));return e?.avatar?`<img class="records-rail__portrait" src="${d(e.avatar)}"
                   alt="${n}" loading="lazy" referrerpolicy="no-referrer">`:`<span class="records-rail__portrait records-rail__portrait--monogram"
                  style="--portrait-hue:${addressHue(t)}"
                  aria-hidden="true">${d(addressMonogram(t))}</span>`}}typeof customElements<"u"&&!customElements.get("app-records-rail")&&customElements.define("app-records-rail",Tt);export function __setRecordsRailDepsForTest({records:s,profiles:t,mark:e,price:n,funds:r}={}){typeof s=="function"&&(O=s),typeof t=="function"&&(N=t),typeof e=="function"&&(w=e),typeof n=="function"&&(W=n),typeof r=="function"&&(M=r)}u(__setRecordsRailDepsForTest,"__setRecordsRailDepsForTest");export function __resetRecordsRailDepsForTest(){O=H,N=U,w=K,W=V,M=X}u(__resetRecordsRailDepsForTest,"__resetRecordsRailDepsForTest");
//# sourceMappingURL=app-records-rail.js.map
