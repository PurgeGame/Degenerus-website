var J=Object.defineProperty;var u=(s,t)=>J(s,"name",{value:t,configurable:!0});import{accruedPayoutWei as Z,accruedShareBps as q,candidateRecordPayoutWei as tt,fetchRecords as F,fetchProfiles as H,formatRecordValue as N,readLiveRecordMark as U,readPreviousDiceRunRecord as et,recordClaimTarget as rt,recordClaimTargetForMark as nt,RECORD_KIND_BUY as v,RECORD_KIND_DICE_RUN as b,RECORD_KIND_FLIP as S,RECORD_KIND_LUCKBOX as C,RECORD_KIND_SPIN as f,shortAddress as L}from"../app/records.js";import{displayEthCompact as K,displayToken as $}from"../app/scaling.js";import{TX_CONFIRMED_EVENT as G}from"../app/contracts.js";import{registerComponentPoll as it}from"../app/component-poll.js";import{readPurchaseQuote as Y,ticketCostFromTickets as st}from"../app/lootbox.js";import{ETH_DIVISOR as D}from"../app/chain-config.js";import{degeneretteLimits as at}from"../app/degenerette.js";import{questCompletionBonusModel as ot}from"../app/quest-objectives.js";import{get as g,getActingAddress as W,getViewedAddress as V,subscribe as x,update as lt}from"../app/store.js";import{readBiggestBountiesModePreference as k,subscribeUiPreferences as ct}from"../app/ui-preferences.js";import{openCrapsReplayTable as ut}from"../craps/replay-adapter.js";import{crapsReplayFetch as dt}from"../craps/replay-fetch.js";const pt=15e3,Q="degenerus:discord-profile-linked",ht="records-bounty",ft=10n**18n;export const BIGGEST_SPIN_PRICE_STEP_WEI=10n**15n/BigInt(D)||1n,BIGGEST_SPIN_MAX_SPINS=at(0)?.maxSpins??25;const mt=100/1.2,X=new Map([[f,0],[C,1],[v,2],[S,3],[b,4]]),yt="/app/assets/biggest-bounty-card-v13.webp",bt=new Map([[b,"DICE RUN"],[f,"DEGENERETTE"],[C,"LUCKBOX"],[v,"PACK RIPPED"],[S,"COINFLIP"]]);export function recordBountyQuestProduct(s){const t=Number(s);return t===v?"purchase":t===C?"lootbox":t===S?"coinflip":t===f?"degenerette-eth":null}u(recordBountyQuestProduct,"recordBountyQuestProduct");let A=F,B=H,O=U,w=Y;function I(s){const[t,e]=String(s??"").split("."),r=t.replace(/\B(?=(\d{3})+(?!\d))/g,",");return e==null?r:`${r}.${e}`}u(I,"group");export function formatCompactBountyWei(s){let t;try{t=BigInt(s??0)}catch{return"—"}t<0n&&(t=-t);const e=t/10n**18n;if(e===0n)return t>0n?"<1":"0";const r=e.toString().length,n=r>2?10n**BigInt(r-2):1n,i=n>1n?(e+n/2n)/n*n:e,o=[[10n**15n,"Q"],[10n**12n,"T"],[10n**9n,"B"],[10n**6n,"M"],[10n**3n,"K"]].find(([h])=>i>=h);if(!o)return I(i.toString());const[l,c]=o,p=i*10n/l;return p<100n&&p%10n!==0n?`${p/10n}.${p%10n}${c}`:`${i/l}${c}`}u(formatCompactBountyWei,"formatCompactBountyWei");function M(s){let t;try{t=BigInt(s??0)}catch{return"—"}if(t<0n&&(t=-t),t<1000n)return I(t.toString());const e=t.toString().length,r=10n**BigInt(Math.max(0,e-3)),n=t/r*r,i=[[10n**15n,"Q"],[10n**12n,"T"],[10n**9n,"B"],[10n**6n,"M"],[10n**3n,"K"]],[a,o]=i.find(([h])=>n>=h)||[1n,""],l=n*100n/a,c=l/100n,p=(l%100n).toString().padStart(2,"0").replace(/0+$/,"");return p?`${c}.${p}${o}`:`${c}${o}`}u(M,"formatCompactWholeDown");function gt(s){let t;try{t=BigInt(s??0)}catch{return"—"}t<0n&&(t=-t);const e=10n**18n,r=t*BigInt(D),n=r/e;if(n>=1000n)return M(n);const i=n.toString(),a=(r%e).toString().padStart(18,"0");if(n>0n){const c=Math.max(0,3-i.length),p=a.slice(0,c).replace(/0+$/,"");return p?`${i}.${p}`:i}const o=a.search(/[1-9]/);return o<0?"0":`0.${a.slice(0,o+3).replace(/0+$/,"")}`}u(gt,"formatCompactEthRecord");export function formatCompactRecordValue(s,t){if(Number(s)===b){let e=0n;try{e=BigInt(t??0)}catch{}e<0n&&(e=-e);const r=(e/10000n).toString().length,n=Math.max(0,3-r),i=10n**BigInt(Math.max(0,4-n));return{amount:`${N(s,e/i*i).amount}x`,suffix:""}}if(Number(s)===v)return{amount:M(t),suffix:"TIX"};if(Number(s)===S){let e=0n;try{e=BigInt(t??0)/10n**18n}catch{}return{amount:M(e),suffix:"FLIP"}}return[f,C].includes(Number(s))?{amount:gt(t),suffix:"ETH"}:N(s,t)}u(formatCompactRecordValue,"formatCompactRecordValue");export function orderBiggestRecords(s){return[...Array.isArray(s)?s:[]].sort((t,e)=>(X.get(Number(t?.kind))??Number.MAX_SAFE_INTEGER)-(X.get(Number(e?.kind))??Number.MAX_SAFE_INTEGER))}u(orderBiggestRecords,"orderBiggestRecords");function y(s){try{const t=BigInt(s??0);return t>0n?t:0n}catch{return 0n}}u(y,"nonNegativeWei");export function parseRecordBountyEthInput(s){const t=/^\s*(?:(\d+)(?:\.(\d{0,18}))?|\.(\d{1,18}))\s*$/.exec(String(s??""));if(!t)return null;try{const e=t[1]||"0",r=(t[2]||t[3]||"").padEnd(18,"0");return(BigInt(e)*ft+BigInt(r||"0"))/BigInt(D)}catch{return null}}u(parseRecordBountyEthInput,"parseRecordBountyEthInput");function z(s,t){return s<=0n?0n:(s+t-1n)/t}u(z,"divideRoundUp");function j(s,t){return z(s,t)*t}u(j,"roundUpTo");export function recordBountySpinSelection(s,{spinCount:t=s?.spinCount??1,amountPerSpinWei:e=s?.amountPerSpinWei??s?.targetWei}={}){if(!s||Number(s.kind)!==f)return s??null;const r=Number(t);if(!Number.isInteger(r)||r<1||r>BIGGEST_SPIN_MAX_SPINS)return null;const n=y(s.targetWei);if(n<=0n)return null;const i=j(z(n,BigInt(r)),BIGGEST_SPIN_PRICE_STEP_WEI);let a=y(e);return a<i&&(a=i),a=j(a,BIGGEST_SPIN_PRICE_STEP_WEI),{...s,spinCount:r,amountPerSpinWei:a,minimumPerSpinWei:i,costWei:a*BigInt(r)}}u(recordBountySpinSelection,"recordBountySpinSelection");export function recordBountyTransactionQuote({state:s,kind:t,liveMarkWei:e=null,ticketPriceWei:r=null,today:n=null}={}){const i=Number(t);if(i===b)return null;const a=Array.isArray(s?.records)?s.records.find(m=>Number(m?.kind)===i):null;if(!a)return null;const o=e!=null,l=o?y(e):null,c=o?nt(i,l):rt(s,i);if(c==null||c<=0n)return null;let p=c;if(i===v){const m=Number(c),P=y(r);if(!Number.isSafeInteger(m)||m<=0||P<=0n)return null;p=st(P,m)}const h=y(a.value),E=!o||h===l?tt({state:s,kind:i,candidate:c,today:n}):null,T=i===S?"ONE COINFLIP DEPOSIT":i===f?"DEGENERETTE BET":i===C?"ONE LUCKBOX BUY":"ONE TICKET BUY",_={kind:i,meta:a.meta,action:T,targetWei:c,costWei:p,payoutWei:E,liveMarkWei:l,currency:i===S?"FLIP":"ETH"};return i===f?recordBountySpinSelection(_):_}u(recordBountyTransactionQuote,"recordBountyTransactionQuote");export function recordBountyActivationDetail(s){if(!s||s.targetWei==null)return null;const t={source:ht,variant:"bounty",submit:!0};if(s.kind===S)return{...t,questType:2,target:String(s.targetWei)};if(s.kind===f){const e=Number(s.spinCount??1),r=y(s.amountPerSpinWei??s.targetWei);return!Number.isInteger(e)||e<1||e>BIGGEST_SPIN_MAX_SPINS||r*BigInt(e)<y(s.targetWei)?null:{...t,questType:7,target:String(r*BigInt(e)),amountPerSpin:String(r),spinCount:e,preferClaimable:!0}}return s.kind===C?{...t,questType:6,target:String(s.targetWei),preferClaimable:!0,useAfking:!0}:s.kind===v?{...t,questType:1,target:String(s.costWei),ticketQuantity:String(s.targetWei),purchaseKind:"ticket",preferClaimable:!0,useAfking:!0}:null}u(recordBountyActivationDetail,"recordBountyActivationDetail");function d(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}u(d,"escapeHtml");export function renderSnapshotKey(s){try{return JSON.stringify(s,(t,e)=>typeof e=="bigint"?`bigint:${e}`:e instanceof Map?[...e.entries()].sort(([r],[n])=>String(r).localeCompare(String(n))):e)}catch{return null}}u(renderSnapshotKey,"renderSnapshotKey");export function addressMonogram(s){const t=String(s||"").replace(/^0x/i,"").toUpperCase();return t.length>=2?t.slice(0,2):"··"}u(addressMonogram,"addressMonogram");export function addressHue(s){const t=String(s||"").replace(/^0x/i,"").slice(0,6),e=Number.parseInt(t,16);return Number.isFinite(e)?e%360:0}u(addressHue,"addressHue");class _t extends HTMLElement{static{u(this,"AppRecordsRail")}#T=!1;#a=[];#g=null;#u=null;#d=null;#o=0;#p=null;#i=new Map;#v=null;#r=null;#t=null;#h=null;#e=!1;#_=!1;#f=0;#s=!0;#C=!1;#N=null;#R=null;#k=null;connectedCallback(){if(!this.#T){this.#T=!0,this.#O(),this.#w();for(const t of["connected.address","viewing.address"])this.#a.push(x(t,()=>{this.#v=V?.()||W?.()||null,this.#c()}));this.#a.push(x("app.daySync",t=>{const e=Number(t?.day)||null;e!==this.#N&&(this.#N=e,this.#c())})),this.#a.push(x("ui.questObjectives",()=>{this.#t&&this.#y()})),this.#a.push(ct(({name:t})=>{t==="biggestBountiesMode"&&(k()!=="on"&&this.#b({restoreFocus:!1}),this.#c())})),typeof document<"u"&&typeof document.addEventListener=="function"&&(this.#u=()=>{this.#E()},document.addEventListener(G,this.#u),this.#d=()=>{this.#V()},document.addEventListener(Q,this.#d)),this.#g=it(()=>this.#E(),pt),this.#E()}}disconnectedCallback(){for(const t of this.#a)try{t()}catch{}if(this.#a=[],this.#u&&typeof document<"u")try{document.removeEventListener?.(G,this.#u)}catch{}if(this.#u=null,this.#d&&typeof document<"u")try{document.removeEventListener?.(Q,this.#d)}catch{}this.#d=null,typeof this.#g=="function"&&this.#g(),this.#g=null,this.#r!=null&&clearTimeout(this.#r),this.#r=null,this.#b({restoreFocus:!1}),this.#o+=1,this.#T=!1}#O(){this.hidden=!0,this.innerHTML=`
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
              <span>SPINS</span>
              <span class="records-bounty-dialog__stepper">
                <button type="button" data-bind="records-bounty-spins-down"
                        aria-label="Decrease spins">−</button>
                <input type="number" inputmode="numeric" min="1"
                       max="${BIGGEST_SPIN_MAX_SPINS}" step="1" value="1"
                       data-bind="records-bounty-spins" aria-label="Number of spins">
                <button type="button" data-bind="records-bounty-spins-up"
                        aria-label="Increase spins">+</button>
              </span>
            </label>
            <label class="records-bounty-dialog__spin-field records-bounty-dialog__spin-field--price">
              <span>PRICE / SPIN</span>
              <span class="records-bounty-dialog__price-input">
                <input type="text" inputmode="decimal" autocomplete="off"
                       data-bind="records-bounty-spin-price" aria-label="ETH price per spin"
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
    `}#w(){for(const o of this.querySelectorAll?.('[data-bind="records-bounty-close"]')||[])o.addEventListener("click",()=>this.#b());const t=this.querySelector('[data-bind="records-bounty-confirm"]');t&&t.addEventListener("click",()=>{this.#Y()});const e=this.querySelector('[data-bind="records-bounty-spins"]');e&&e.addEventListener("input",()=>this.#P(e.value));const r=this.querySelector('[data-bind="records-bounty-spins-down"]');r&&r.addEventListener("click",()=>this.#L(-1));const n=this.querySelector('[data-bind="records-bounty-spins-up"]');n&&n.addEventListener("click",()=>this.#L(1));const i=this.querySelector('[data-bind="records-bounty-spin-price"]');i&&(i.addEventListener("input",()=>this.#H(i.value)),i.addEventListener("change",()=>this.#$()),i.addEventListener("blur",()=>this.#$()));const a=this.querySelector('[data-bind="records-bounty-dialog"]');a&&a.addEventListener("keydown",o=>{o?.key==="Escape"&&!this.#e&&this.#b()})}#n(t,{error:e=!1,persist:r=!1}={}){const n=this.querySelector('[data-bind="records-bounty-notice"]');if(n&&(this.#r!=null&&clearTimeout(this.#r),this.#r=null,n.textContent=String(t||""),n.hidden=!t,n.classList?.toggle("is-error",!!e),n.classList?.toggle("is-working",!!t&&!e),t&&!r)){this.#r=setTimeout(()=>{n.hidden=!0,n.textContent="",this.#r=null},e?5e3:2e3);try{this.#r?.unref?.()}catch{}}}async#M(t){if(this.#C)return!1;const e=t?.replay??null;if(!e?.battleKey||!e?.viewerBetId)return this.#n("The Dice Run replay link is temporarily unavailable.",{error:!0}),!1;const r=globalThis.document?.querySelector?.("app-craps-table");if(!r?.open)return this.#n("The Craps replay table is unavailable.",{error:!0}),!1;this.#C=!0,this.#n("LOADING BIGGEST DICE RUN REPLAY…",{persist:!0});try{const n=await et(t);let i=n?.player?this.#i.get(n.player)??null:null;if(n?.player&&!i)try{const o=await B([n.player]);i=o?.get?.(n.player)??null,this.#i=new Map([...this.#i,...o??[]])}catch{}const a=await ut(r,{...e,biggestDiceRun:n?{scoreBps:n.value?.toString?.()??String(n.value??0),player:n.player,label:n.player==null?"UNCLAIMED":i?.name??L(n.player),avatar:i?.avatar,bountyWei:n.bountyWei?.toString?.()??null}:null,fetchImpl:dt});if(!a?.ready){const o=String(a?.pointer?.status??"");return this.#n(o==="pending"||o==="settling"?"The Dice Run replay is still being sealed. Try again shortly.":"The Dice Run replay is unavailable.",{error:o==="failed"}),!1}return this.#n(""),!0}catch{return this.#n("The Dice Run replay is temporarily unavailable. Try again.",{error:!0}),!1}finally{this.#C=!1}}#B(t){return`${I(K(y(t),6))} ETH`}#q(t){const e=$(y(t),6),r=e.includes(".")?e.replace(/0+$/,"").replace(/\.$/,""):e;return`${I(r)} FLIP`}#F(t,e){return e==="FLIP"?this.#q(t):this.#B(t)}#m(t){return K(y(t),18)||"0"}#P(t){const e=this.#t;if(!e||e.kind!==f)return;const r=Math.trunc(Number(t)),n=Math.min(BIGGEST_SPIN_MAX_SPINS,Math.max(1,Number.isFinite(r)?r:e.spinCount||1)),i=e.amountPerSpinWei===e.minimumPerSpinWei,a=recordBountySpinSelection(e,{spinCount:n,amountPerSpinWei:i?0n:e.amountPerSpinWei});a&&(this.#t=a,this.#s=!0,this.#I(),this.#y(),this.#S())}#L(t){const e=this.#t;!e||e.kind!==f||this.#e||this.#P((e.spinCount||1)+Number(t||0))}#H(t){const e=this.#t;if(!e||e.kind!==f)return;const r=this.querySelector('[data-bind="records-bounty-spin-price"]'),n=this.querySelector('[data-bind="records-bounty-spin-controls"]'),i=parseRecordBountyEthInput(t),a=i!=null&&i>=e.minimumPerSpinWei;if(this.#s=a,r?.setAttribute?.("aria-invalid",a?"false":"true"),n?.classList?.toggle?.("is-invalid",!a),a){const o=recordBountySpinSelection(e,{amountPerSpinWei:i});o&&(this.#t=o)}this.#y(),this.#S()}#$(){const t=this.#t;if(!t||t.kind!==f)return;const e=this.querySelector('[data-bind="records-bounty-spin-price"]'),r=parseRecordBountyEthInput(e?.value),n=recordBountySpinSelection(t,{amountPerSpinWei:r!=null&&r>=t.minimumPerSpinWei?r:t.minimumPerSpinWei});n&&(this.#t=n,this.#s=!0,this.#I(),this.#y(),this.#S())}async#D(t){if(Number(t)===b)return{error:"The Dice Run record is set by a finalized scheduled Craps winner."};const e=String(g("connected.address")||"").toLowerCase(),r=String(W?.()||"").toLowerCase(),n=g("ui.mode");if(!e)return{error:"Connect your wallet to take a record shot."};if(!r||r!==e||n!=null&&n!=="self")return{error:"Switch to your connected account to prepare this transaction."};const i=Number(t),a=u(m=>Promise.resolve(m).then(P=>({ok:!0,value:P}),()=>({ok:!1,value:null})),"capture"),o=i===v,[l,c,p]=await Promise.all([a(this.#E({loadProfiles:!1})),a(O(i)),a(o?w():null)]),h=l.value||this.#p;if(!h)return{error:"The live record target is still loading. Try again."};const R=c.ok?c.value:null;if(R==null)return{error:"Could not verify the record on-chain. Try again in a moment."};const E=o?p.value?.priceWei:null,T=Number(g("app.daySync")?.day??g("app.lastDay")?.day)||null,_=recordBountyTransactionQuote({state:h,kind:i,liveMarkWei:R,ticketPriceWei:E,today:T});return _?{quote:_}:{error:o?"The live ticket price is unavailable. Try again in a moment.":"The live record target is unavailable. Try again in a moment."}}async#U(t){if(Number(t)===b||k()!=="on"||this.#e||this.#_||this.#t)return;const e=++this.#f;this.#_=!0,this.#n("CHECKING LIVE TARGET…",{persist:!0});let r;try{r=await this.#D(t)}catch{r={error:"Could not verify the live record. Try again in a moment."}}if(e!==this.#f)return;if(this.#_=!1,this.#n(""),r.error){this.#n(r.error,{error:!0});return}const{quote:n}=r;this.#h=Number(t),this.#t=n,this.setAttribute("data-bounty-dialog-open",""),this.#l();const i=this.querySelector('[data-bind="records-bounty-dialog"]');i&&(i.hidden=!1,i.removeAttribute?.("hidden"));const a=u(()=>{try{this.querySelector('[data-bind="records-bounty-confirm"]')?.focus?.({preventScroll:!0})}catch{}},"focusConfirm");typeof requestAnimationFrame=="function"?requestAnimationFrame(a):a()}#l(t="",{error:e=!1}={}){const r=this.#t;if(!r)return;const n=this.querySelector('[data-bind="records-bounty-title"]'),i=this.querySelector('[data-bind="records-bounty-payout"]'),a=this.querySelector('[data-bind="records-bounty-alert"]'),o=this.querySelector('[data-bind="records-bounty-confirm"]');n&&(n.textContent=r.meta?.label||"THE BIGGEST"),i&&(i.textContent=r.payoutWei==null?"LIVE AMOUNT LOADING":I($(r.payoutWei,0))),a&&(a.textContent=t,a.hidden=!t,a.classList?.toggle("is-error",!!e)),this.#I(),this.#y(),this.#S(o)}#y(){const t=this.querySelector('[data-bind="records-bounty-quest-bonus"]');if(!t)return;const e=this.#t,r=recordBountyQuestProduct(e?.kind),n=e?.kind!==f||this.#s,i=e&&r&&n?ot(g("ui.questObjectives"),r,e.costWei):null;t.hidden=i==null,t.textContent=i?.message||""}#I(){const t=this.#t,e=this.querySelector('[data-bind="records-bounty-spin-controls"]');if(!e)return;const r=t?.kind===f;if(e.hidden=!r,!r){e.setAttribute?.("hidden","");return}e.removeAttribute?.("hidden"),e.classList?.remove?.("is-invalid");const n=this.querySelector('[data-bind="records-bounty-spins"]'),i=this.querySelector('[data-bind="records-bounty-spins-down"]'),a=this.querySelector('[data-bind="records-bounty-spins-up"]'),o=this.querySelector('[data-bind="records-bounty-spin-price"]'),l=this.querySelector('[data-bind="records-bounty-spin-min"]'),c=this.querySelector('[data-bind="records-bounty-spin-target"]');n&&(n.value=String(t.spinCount),n.disabled=this.#e),i&&(i.disabled=this.#e||t.spinCount<=1),a&&(a.disabled=this.#e||t.spinCount>=BIGGEST_SPIN_MAX_SPINS),o&&(o.value=this.#m(t.amountPerSpinWei),o.disabled=this.#e,o.setAttribute?.("aria-invalid","false"),o.setAttribute?.("data-min-wei",String(t.minimumPerSpinWei))),l&&(l.textContent=`MIN ${this.#m(t.minimumPerSpinWei)} ETH / SPIN`),c&&(c.textContent=`${this.#m(t.targetWei)} ETH TOTAL BOUNTY FLOOR`)}#S(t=null){const e=this.#t,r=t||this.querySelector('[data-bind="records-bounty-confirm"]');if(!e||!r)return;const n=e.kind!==f||this.#s;r.disabled=this.#e||!n;const i=r.querySelector?.('[data-bind="records-bounty-confirm-action"]'),a=r.querySelector?.('[data-bind="records-bounty-confirm-amount"]'),o=this.#K(e);i&&(i.textContent=this.#e?"CHECKING LIVE TARGET…":n?o.action:"PRICE BELOW BOUNTY FLOOR"),a&&(a.textContent=this.#e?"":n?o.amount:`MIN ${this.#m(e.minimumPerSpinWei)} ETH / SPIN`,a.hidden=this.#e),r.setAttribute?.("aria-label",this.#e?"Checking the live record target":n?o.ariaLabel:`Price per spin must be at least ${this.#m(e.minimumPerSpinWei)} ETH`)}#K(t){const e=this.#F(t.costWei,t.currency);if(t.kind===S)return{action:"DEPOSIT",amount:e,ariaLabel:`Deposit ${e} to take The Biggest Flip`};if(t.kind===f){const i=Number(t.spinCount||1),a=this.#B(t.amountPerSpinWei||t.targetWei);return{action:i===1?"SPIN ONCE":`SPIN ${i}×`,amount:e,ariaLabel:`Place ${i} Degenerette spin${i===1?"":"s"} at ${a} each, ${e} total, to take The Biggest Degenerette`}}if(t.kind===C)return{action:"BUY LUCKBOX",amount:e,ariaLabel:`Buy a ${e} Luckbox to take The Biggest Luckbox`};const r=N(t.kind,t.targetWei),n=`${r.amount} ${r.suffix}`.trim();return{action:`BUY ${n}`,amount:e,ariaLabel:`Buy ${n} for ${e} to take The Biggest Pack Ripped`}}#G(t,e){return!t||!e?!0:t.targetWei!==e.targetWei||t.kind!==e.kind||t.kind!==f&&t.costWei!==e.costWei||t.payoutWei!==e.payoutWei}async#Y(){if(this.#e||this.#h==null)return;const t=++this.#f,e=this.#t;this.#e=!0,this.#l();let r;try{r=await this.#D(this.#h)}catch{r={error:"Could not refresh the live target."}}if(t!==this.#f)return;if(this.#e=!1,r.error||!r.quote){this.#l(r.error||"Could not refresh the live target.",{error:!0});return}const n=r.quote,i=this.#G(e,n),a=e?.kind===f?recordBountySpinSelection(n,{spinCount:e.spinCount,amountPerSpinWei:e.amountPerSpinWei===e.minimumPerSpinWei?0n:e.amountPerSpinWei}):n;if(this.#t=a||n,this.#s=!0,i){this.#l("TARGET OR PRICE MOVED · REVIEW THE UPDATED TX",{error:!0});return}const o=recordBountyActivationDetail(this.#t);if(!o||typeof document>"u"){this.#l("THE TRANSACTION ROUTE IS NOT AVAILABLE",{error:!0});return}try{document.dispatchEvent(new CustomEvent("quest:activate",{detail:o}))}catch{this.#l("COULD NOT OPEN THE TRANSACTION",{error:!0});return}this.#b({restoreFocus:!1})}#b({restoreFocus:t=!0}={}){this.#f+=1;const e=this.#h;this.removeAttribute("data-bounty-dialog-open");const r=this.querySelector?.('[data-bind="records-bounty-dialog"]');if(r&&(r.hidden=!0,r.setAttribute?.("hidden","")),this.#t=null,this.#h=null,this.#e=!1,this.#_=!1,this.#s=!0,t&&e!=null)try{this.querySelector?.(`.records-rail__leader[data-kind="${e}"]`)?.focus?.({preventScroll:!0})}catch{}}async#E({loadProfiles:t=!0}={}){const e=++this.#o;let r=null;try{r=await A()}catch{return null}if(e!==this.#o)return null;this.#p=r;const n=V?.()||W?.()||null,i=renderSnapshotKey({state:r,viewed:String(n??"")});if((i==null||i!==this.#R)&&(this.#R=i,lt("app.records",r),this.#v=n,this.#c()),!t)return r;const a=r.records.map(c=>c.player).filter(Boolean),o=await B(a);if(e!==this.#o)return null;const l=renderSnapshotKey(o??null);return(l==null||l!==this.#k)&&(this.#k=l,this.#i=o,this.#c()),r}async#V(){const t=this.#p?.records;if(!Array.isArray(t))return null;const e=this.#o,r=t.map(i=>i.player).filter(Boolean),n=await B(r,{fresh:!0});return e!==this.#o?null:(this.#i=n,this.#c(),n)}#c(){const t=this.querySelector('[data-bind="records-shell"]');if(!t)return;const e=k(),r=this.#p;if(!r||e==="off"){this.hidden=!0,t.hidden=!0;return}this.hidden=!1,t.hidden=!1;const n=orderBiggestRecords(r.records),i=this.querySelector('[data-bind="records-leaders"]');if(i){i.innerHTML="";for(const l of n)i.appendChild(this.#Q(l))}const a=this.querySelector('[data-bind="records-cards"]');if(!a)return;a.innerHTML="";const o=String(this.#v||"").toLowerCase();for(const l of n)a.appendChild(this.#X(l,o))}#Q(t){const e=document.createElement("button");e.type="button",e.className="records-rail__leader",e.dataset.kind=String(t.kind),t.held||e.classList.add("is-open");const r=N(t.kind,t.value),n=formatCompactRecordValue(t.kind,t.held?t.value:t.meta.floorValue),i=n.amount.length>=6?"tight":n.amount.length>=5?"compact":"standard",a=t.player?this.#i.get(t.player):null,o=L(t.player),l=t.held?a?.name||o:"OPEN RECORD",c=t.held&&a?.name?`${a.name} · ${o}`:l,p=this.#W(t),h=p==null?"—":formatCompactBountyWei(p),R=bt.get(Number(t.kind))||t.meta.short,E=Number(t.kind)===b;e.classList.toggle("is-replay",E&&!!t.held);const T=E?!!t.held:k()==="on";e.classList.toggle("is-view-only",!T),T?(e.removeAttribute("aria-disabled"),e.removeAttribute("tabindex")):(e.setAttribute("aria-disabled","true"),e.setAttribute("tabindex","-1"));const _=E?t.held?" Click to replay from the record holder's perspective.":" Set by the winning scheduled Dice Run.":T?" Click to prepare the exact record shot.":"";return e.title=t.held?`${t.meta.label}: ${r.amount} ${r.suffix}, held by ${l}; bounty ${h} FLIP.${_}`:`${t.meta.label}: unhit; bounty ${h} FLIP.${_}`,e.setAttribute("aria-label",e.title),e.innerHTML=`
      <img class="records-rail__leader-card-art"
           src="${yt}"
           alt="" aria-hidden="true" loading="lazy" decoding="async">
      <span class="records-rail__leader-presentation">
        ${t.held?this.#A(t.player,a):'<span class="records-rail__portrait records-rail__portrait--open" aria-hidden="true">?</span>'}
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
        <strong>${d(R)}</strong>
      </span>
      <span class="records-rail__leader-strip">
        <span class="records-rail__leader-holder" aria-hidden="true">${d(l)}</span>
      </span>
      <span class="records-rail__leader-bet">
        <strong class="records-rail__leader-value"
                data-amount-fit="${i}"
                aria-label="Current record ${d(n.amount)} ${d(n.suffix)}">
          <span class="records-rail__leader-amount">${d(n.amount)}</span>
          ${n.suffix?`<em>${d(n.suffix)}</em>`:""}
        </strong>
      </span>
    `,e.addEventListener("click",m=>{if(m?.preventDefault?.(),m?.stopPropagation?.(),Number(t.kind)===b){t.held&&this.#M(t);return}k()==="on"&&this.#U(t.kind)}),this.#x(e,t.player),e}#X(t,e){const r=document.createElement("li");r.className="records-rail__card",r.dataset.kind=String(t.kind),t.held||r.classList.add("is-open"),t.player&&t.player===e&&r.classList.add("is-you");const n=N(t.kind,t.value),i=N(t.kind,t.barToBeat),a=Number(t.kind)===b,o=t.player?this.#i.get(t.player):null,l=Number(g("app.daySync")?.day??g("app.lastDay")?.day)||null,c=q({held:t.held,clockDay:t.clockDay,today:l}),p=this.#W(t,l),h=t.claimCount>0?`${t.meta.label} — paid out ${t.claimCount}×`:t.meta.label;return r.innerHTML=`
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
            <strong class="records-rail__mark">${d(n.amount)}<em>${d(n.suffix)}</em></strong>
          </div>
          <div class="records-rail__holder">
            ${this.#A(t.player,o)}
            <span class="records-rail__holder-copy">
              <small>HELD BY</small>
              <b class="records-rail__holder-name">${d(o?.name||L(t.player))}</b>
            </span>
          </div>
          <div class="records-rail__track${a?" records-rail__track--strict":""}" role="presentation">
            <span class="records-rail__fill" style="width:${a?"100":mt.toFixed(3)}%"></span>
            <span class="records-rail__notch"></span>
          </div>
          <div class="records-rail__stakes">
            <span class="records-rail__beat">
              <small>TARGET TO CLAIM</small>
              <b>${d(i.amount)} <em>${d(i.suffix)}</em></b>
            </span>
            ${p==null?"":`<span class="records-rail__pays">
                  <small>PAYOUT NOW</small>
                  <b>${d(I($(p,0)))} <em>FLIP</em></b>
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
              <b>${p==null?"—":d(I($(p,0)))} <em>FLIP</em></b>
            </span>
            <span class="records-rail__beat">
              <small>MIN TO HIT</small>
              <b>${d(t.meta.floorText)}</b>
            </span>
          </div>
        `}
    `,this.#x(r,t.player),r}#W(t,e=Number(g("app.daySync")?.day??g("app.lastDay")?.day)||null){const r=q({held:t.held,clockDay:t.clockDay,today:e});return Z(this.#p?.recordPoolWei,r)}#x(t,e){const r=t?.querySelector?.("img.records-rail__portrait");r&&r.addEventListener("error",()=>{const n=document.createElement("span");n.className="records-rail__portrait records-rail__portrait--monogram",n.setAttribute("aria-hidden","true"),n.style.setProperty("--portrait-hue",String(addressHue(e))),n.textContent=addressMonogram(e),r.replaceWith(n)},{once:!0})}#A(t,e){const r=d(e?.name||L(t));return e?.avatar?`<img class="records-rail__portrait" src="${d(e.avatar)}"
                   alt="${r}" loading="lazy" referrerpolicy="no-referrer">`:`<span class="records-rail__portrait records-rail__portrait--monogram"
                  style="--portrait-hue:${addressHue(t)}"
                  aria-hidden="true">${d(addressMonogram(t))}</span>`}}typeof customElements<"u"&&!customElements.get("app-records-rail")&&customElements.define("app-records-rail",_t);export function __setRecordsRailDepsForTest({records:s,profiles:t,mark:e,price:r}={}){typeof s=="function"&&(A=s),typeof t=="function"&&(B=t),typeof e=="function"&&(O=e),typeof r=="function"&&(w=r)}u(__setRecordsRailDepsForTest,"__setRecordsRailDepsForTest");export function __resetRecordsRailDepsForTest(){A=F,B=H,O=U,w=Y}u(__resetRecordsRailDepsForTest,"__resetRecordsRailDepsForTest");
//# sourceMappingURL=app-records-rail.js.map
