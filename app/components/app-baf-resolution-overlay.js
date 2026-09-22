var W=Object.defineProperty;var f=(t,e)=>W(t,"name",{value:e,configurable:!0});import{displayEthCompact as v}from"../app/scaling.js";import{formatBafResolutionScore as _,loadBafResolutionSnapshot as U}from"../app/baf-resolution.js";import{buildBafDrawAllocation as x,formatBafDrawPercent as N}from"../app/baf-draw.js";import{appendCoinFaces as k}from"../app/coin-faces.js";import{warmup as D,sfxCoinflipLand as Y,sfxCoinflipStart as q,sfxCoinflipWhoosh as F}from"../app/jackpot-sfx.js";const H=Object.freeze({intro:520,flip:3250,results:2650,wheel:1550}),G=Object.freeze({intro:80,flip:80,results:120,wheel:80});let b=null,y=0;function p(t){try{return BigInt(t??0)}catch{return 0n}}f(p,"_big");function O(t){const e=Number(t);return Number.isInteger(e)&&e>=1&&e<=4?`RANK #${e}`:""}f(O,"_rankLabel");function R(t,e=3){try{const[a,s]=v(p(t),e).split("."),r=a.replace(/\B(?=(\d{3})+(?!\d))/g,",");return s==null?r:`${r}.${s}`}catch{return"0"}}f(R,"_formatEth");function A(t){const e=p(t),a=[[1000000000000n,"T"],[1000000000n,"B"],[1000000n,"M"],[1000n,"K"]];for(const[s,r]of a){if(e<s)continue;const n=e*10n/s;return`${n/10n}${n%10n===0n?"":`.${n%10n}`}${r}`}return e.toLocaleString("en-US")}f(A,"_formatDrawWeight");export function formatBafWhalePassHalves(t){const e=p(t);if(e>0n&&e%2n===0n){const a=e/2n;return`${a} WHALE PASS${a===1n?"":"ES"}`}return`${e} HALF-PASS${e===1n?"":"ES"}`}f(formatBafWhalePassHalves,"formatBafWhalePassHalves");function K(){try{return matchMedia("(prefers-reduced-motion: reduce)").matches}catch{return!1}}f(K,"_motionReduced");function E(t){try{const e=t?.();e&&typeof e.catch=="function"&&e.catch(()=>{})}catch{}}f(E,"_sound");function g(t,e){if(!b)return null;const a=setTimeout(()=>{b&&(b.timers.delete(a),t())},e);b.timers.add(a);try{a?.unref?.()}catch{}return a}f(g,"_schedule");function T(){const t=b;if(b=null,t){for(const e of t.timers)clearTimeout(e);t.timers.clear();try{document.removeEventListener("keydown",t.onKeydown)}catch{}try{t.overlay.remove()}catch{}}try{document.body?.classList?.remove("baf-resolution-pending"),document.body?.classList?.remove("baf-resolution-open")}catch{}}f(T,"_destroyActive");function w(){y+=1,T()}f(w,"_clearActive");export function closeBafResolution(){w()}f(closeBafResolution,"closeBafResolution");function P({kind:t,color:e,label:a,weight:s,percent:r}){const n=document.createElement("li");n.dataset.kind=t;const d=document.createElement("i");d.style.setProperty("--baf-draw-color",e),d.setAttribute("aria-hidden","true");const c=document.createElement("span");c.textContent=a;const i=document.createElement("b");i.textContent=s;const l=document.createElement("strong");return l.textContent=r,n.appendChild(d),n.appendChild(c),n.appendChild(i),n.appendChild(l),n}f(P,"_drawLegendRow");function M(t,e){const a=e.draw,s=x(a,e.player.address),r=t.querySelector('[data-bind="baf-draw-pie"]'),n=t.querySelector('[data-bind="baf-draw-legend"]'),d=t.querySelector('[data-bind="baf-draw-player-percent"]'),c=t.querySelector('[data-bind="baf-draw-player-weight"]'),i=t.querySelector('[data-bind="baf-draw-context"]'),l=t.querySelector('[data-bind="baf-draw-state"]'),o=p(a?.totalWeight),u=p(a?.player?.score),S=N(u,a?.totalWeight);if(d&&(d.textContent=S),c&&(c.textContent=a?.player?`${A(u)} FLIP WEIGHT`:"NO FINAL-DAY ENTRY"),i){const m=a?.totalParticipants==null?"— PLAYERS":`${a.totalParticipants.toLocaleString("en-US")} PLAYERS`;i.textContent=o<=0n?`FINAL-DAY BOOK UNAVAILABLE · ${m}`:`${A(o)} FLIP IN THE BOOK · ${m}`}l&&(l.textContent=e.gateWon?"WAITING FOR DRAW":"VOID · BAF LOSS");const L=s.entries.filter(m=>m.endPpm>m.startPpm);if(r){if(r.classList.toggle("is-empty",L.length===0),L.length>0){const m=L.flatMap(C=>{const B=(C.startPpm/1e4).toFixed(4),$=(C.endPpm/1e4).toFixed(4);return`${C.color} ${B}% ${$}%`});r.style.setProperty("--baf-draw-pie",`conic-gradient(from -90deg, ${m.join(", ")})`)}else r.style.removeProperty("--baf-draw-pie");r.setAttribute("aria-label",`Final-day BAF draw weights. Your chance ${S}.`)}if(!n)return;n.textContent="",n.appendChild(P({kind:"player",color:"#d9fff5",label:"YOU",weight:a?.player?`${A(u)} FLIP`:"NO ENTRY",percent:S}));const I=o>u?o-u:0n;n.appendChild(P({kind:"field",color:"#334155",label:"EVERYONE ELSE",weight:o>0n?`${A(I)} FLIP`:"—",percent:N(I,a?.totalWeight)}))}f(M,"_paintWeightedDraw");function h({eyebrow:t,value:e,detail:a,kind:s,icon:r=null}){const n=document.createElement("article");if(n.className="baf-res__result-card",n.dataset.kind=s,r){const o=document.createElement("img");o.src=r,o.alt="",n.appendChild(o)}const d=document.createElement("span"),c=document.createElement("small");c.textContent=t;const i=document.createElement("strong");i.textContent=e;const l=document.createElement("b");return l.textContent=a,d.appendChild(c),d.appendChild(i),d.appendChild(l),n.appendChild(d),n}f(h,"_resultCard");function V(t,e){const a=t.querySelector('[data-bind="baf-player-results"]'),s=t.querySelector('[data-bind="baf-results-heading"]'),r=t.querySelector('[data-bind="baf-results-copy"]'),n=t.querySelector('[data-bind="baf-result-grid"]');if(!a||!s||!r||!n)return;if(n.textContent="",!e.gateWon){a.dataset.outcome="loss",s.textContent="THE BAF DID NOT FIRE",r.textContent="The red face kept the pool in the futurepool. No ticket samples or final-day draw ran.",p(e.player.consolation)>0n&&n.appendChild(h({eyebrow:"YOUR CONSOLATION",value:`${_(e.player.consolation)} WWXRP`,detail:"CLAIMABLE BAF LOSS REWARD",kind:"consolation"}));return}const d=Array.isArray(e.player.prizeHits)?e.player.prizeHits:[];a.dataset.outcome=e.player.wonAny?"win":"miss",e.player.wonAny?(s.textContent="YOUR BAF RESULTS",r.textContent="Only this wallet’s prize-bearing ticket draws and direct BAF awards are shown."):(s.textContent="NO PRIZE LANDED ON YOUR TICKETS",r.textContent="The BAF ran, but no prize-bearing ticket result was recorded for this wallet.");const c=d.slice(0,6);for(let i=0;i<c.length;i+=1){const l=c[i],o=Number(l.count)>1?` · ×${l.count}`:"";if(l.kind==="eth")n.appendChild(h({eyebrow:`PRIZE RESULT ${i+1}${o}`,value:`${R(l.amount,4)} ETH`,detail:"PAID TO YOUR CLAIMABLE BALANCE",kind:"eth",icon:"/badges-circular/crypto_06_ethereum_green.svg"}));else if(l.kind==="tickets"){const u=p(l.amount);n.appendChild(h({eyebrow:`PRIZE RESULT ${i+1}${o}`,value:`${u} TICKET${u===1n?"":"S"}`,detail:l.level==null?"FUTURE TICKET PAYOUT":`LEVEL ${l.level} TICKET PAYOUT`,kind:"tickets",icon:"/whitepaper/flame-center.svg"}))}else n.appendChild(h({eyebrow:`PRIZE RESULT ${i+1}${o}`,value:formatBafWhalePassHalves(l.amount),detail:"DEFERRED BAF TICKET VALUE",kind:"whale-pass",icon:"/app/assets/baf-mark.svg"}))}if(d.length>c.length&&n.appendChild(h({eyebrow:"MORE RESULTS",value:`+${d.length-c.length}`,detail:"INCLUDED IN YOUR TOTAL BELOW",kind:"overflow"})),!n.childElementCount&&e.player.leaderSlicePct>0&&n.appendChild(h({eyebrow:e.player.leaderSlicePct===10?"TOP BAF SCORE":"CUT SURVIVOR",value:`${e.player.leaderSlicePct}% SLICE`,detail:"PAYOUT DETAILS ARE STILL SYNCING",kind:"leader"})),!n.childElementCount){const i=O(e.player.rank);n.appendChild(h({eyebrow:i?"YOUR FINISH":"YOUR BAF SCORE",value:i||_(e.player.score),detail:i?`${_(e.player.score)} BAF SCORE · NO PAYOUT`:"NO PAYOUT",kind:"miss"}))}}f(V,"_paintPlayerResults");function z(t,e){const a=O(e.player.rank);t.dataset.gate=e.gateWon?"win":"loss",t.innerHTML=`
    <div class="baf-res__ambient" aria-hidden="true"></div>
    <main class="baf-res__shell" data-bind="baf-shell" data-stage="coin">
      <header class="baf-res__header">
        <span class="baf-res__brand">
          <span class="baf-res__mark" aria-hidden="true"><b>BAF</b><small>×10</small></span>
          <span><small>LEVEL ${e.level} FINAL</small><h1>BIG ASS FLIP</h1></span>
        </span>
        <span class="baf-res__pool" ${e.estimatedPoolWei==null?"hidden":""}>
          <img src="/badges-circular/crypto_06_ethereum_green.svg" alt="ETH">
          <span><small>BAF PRIZE POOL</small><strong>${R(e.estimatedPoolWei)} <em>ETH</em></strong></span>
        </span>
      </header>

      <ol class="baf-res__steps" aria-label="Big Ass Flip reveal progress">
        <li><i></i><span>THE FLIP</span></li>
        <li><i></i><span>YOUR RESULTS</span></li>
        <li><i></i><span>LAST-DAY DRAW</span></li>
      </ol>

      <section class="baf-res__scene baf-res__gate" aria-live="polite">
        <small>50 / 50 FIRE GATE</small>
        <h2>ONE FLIP DECIDES THE WHOLE BAF</h2>
        <div class="baf-res__coin-scene" aria-hidden="true">
          <span class="baf-res__coin-aura"></span>
          <span class="baf-res__coin-shadow"></span>
          <span class="baf-res__coin-rotor" data-bind="baf-coin"></span>
        </div>
        <strong data-bind="baf-gate-result">FLIP TO RUN THE DRAW</strong>
        <p>Green fires the ticket draws. Red leaves the prize pool untouched.</p>
      </section>

      <section class="baf-res__scene baf-res__results" data-bind="baf-player-results" hidden
               aria-label="Your BAF draw results">
        <header>
          <span><small>YOUR WALLET ONLY</small><h2 data-bind="baf-results-heading">YOUR BAF RESULTS</h2></span>
          <span class="baf-res__standing">
            ${a?`<b>${a}</b>`:""}
            <small>${_(e.player.score)} BAF SCORE</small>
          </span>
        </header>
        <p data-bind="baf-results-copy"></p>
        <div class="baf-res__result-grid" data-bind="baf-result-grid"></div>
        <footer>50 SCATTER ROUNDS · 2 FAR-FUTURE DRAWS · ONLY YOUR RESULTS SHOWN</footer>
      </section>

      <section class="baf-res__scene baf-res__weighted" data-bind="baf-weighted" hidden
               aria-label="Final purchase day BAF weighted draw">
        <header>
          <span><small>5% BAF SLICE</small><h2>FINAL-DAY WEIGHTED DRAW</h2></span>
          <b data-bind="baf-draw-state">WAITING FOR GATE</b>
        </header>
        <div class="baf-res__weighted-body">
          <div class="baf-res__draw-wheel" data-bind="baf-draw-wheel">
            <span class="baf-res__draw-pointer" aria-hidden="true"></span>
            <span class="baf-res__draw-ticks" aria-hidden="true"></span>
            <div class="baf-res__draw-pie" data-bind="baf-draw-pie" role="img">
              <span class="baf-res__draw-core">
                <img src="/app/assets/baf-mark.svg" alt="">
                <small>YOUR CHANCE</small>
                <strong data-bind="baf-draw-player-percent">—</strong>
                <b data-bind="baf-draw-player-weight">NO FINAL-DAY ENTRY</b>
              </span>
            </div>
          </div>
          <div class="baf-res__draw-copy">
            <h3>YOUR LAST-DAY FLIP WEIGHT</h3>
            <p>Direct FLIP added on the final purchase day became one weighted chance at this five-percent slice.</p>
            <ol class="baf-res__draw-legend" data-bind="baf-draw-legend"></ol>
          </div>
        </div>
        <footer data-bind="baf-draw-context">FINAL-DAY BOOK UNAVAILABLE</footer>
      </section>

      <footer class="baf-res__footer">
        <div class="baf-res__payout" data-bind="baf-payout"></div>
        <button type="button" class="baf-res__done" data-bind="baf-done" hidden>BACK TO GAME</button>
      </footer>
    </main>
    <button type="button" class="baf-res__close" data-bind="baf-close" aria-label="Close BAF resolution">×</button>
  `,V(t,e),M(t,e);const s=t.querySelector('[data-bind="baf-coin"]');k(s,{initialSide:"red"}),t.querySelector('[data-bind="baf-close"]')?.addEventListener("click",w),t.querySelector('[data-bind="baf-done"]')?.addEventListener("click",w)}f(z,"_renderSnapshot");function Z(t,e){const a=t.querySelector('[data-bind="baf-payout"]');if(!a)return;a.textContent="",a.className="baf-res__payout";const s=document.createElement("strong"),r=document.createElement("span");r.className="baf-res__reward-list";const n=f((d,c,i=null)=>{const l=document.createElement("b");if(l.className="baf-res__reward",l.dataset.kind=c,i){const u=document.createElement("img");u.src=i,u.alt="",l.appendChild(u)}const o=document.createElement("span");o.textContent=d,l.appendChild(o),r.appendChild(l)},"addReward");e.gateWon?e.player.wonAny?(a.classList.add("is-win"),s.textContent="YOUR BAF RESULT",p(e.player.eth)>0n&&n(`${R(e.player.eth,4)} ETH`,"eth","/badges-circular/crypto_06_ethereum_green.svg"),p(e.player.tickets)>0n&&n(`${e.player.tickets} TICKET${p(e.player.tickets)===1n?"":"S"}`,"tickets","/whitepaper/flame-center.svg"),p(e.player.whalePassHalves)>0n&&n(formatBafWhalePassHalves(e.player.whalePassHalves),"whale-pass","/app/assets/baf-mark.svg"),!r.childElementCount&&e.player.leaderSlicePct>0&&n(`${e.player.leaderSlicePct}% LEADER PRIZE · SYNCING`,"leader")):(a.classList.add("is-miss"),s.textContent="NO BAF PAYOUT",r.classList.add("is-summary"),r.textContent=[O(e.player.rank),`${_(e.player.score)} SCORE`].filter(Boolean).join(" · ")):(a.classList.add("is-loss"),s.textContent="BAF LOSS",r.classList.add("is-summary"),r.textContent=p(e.player.consolation)>0n?`${_(e.player.consolation)} WWXRP CONSOLATION`:"NO DRAW · POOL STAYS IN THE FUTUREPOOL"),a.appendChild(s),a.appendChild(r)}f(Z,"_paintPayout");function j(t,e){const a=t.querySelector('[data-bind="baf-shell"]');if(!a)return;a.dataset.stage="complete";const s=t.querySelector('[data-bind="baf-draw-wheel"]');s?.classList.remove("is-spinning"),s?.classList.add(e.gateWon?"is-settled":"is-void");const r=t.querySelector('[data-bind="baf-draw-state"]');r&&(r.textContent=e.gateWon?"DRAW COMPLETE":"NOT DRAWN · BAF LOSS"),Z(t,e);const n=t.querySelector('[data-bind="baf-done"]');if(n){n.hidden=!1;try{n.focus({preventScroll:!0})}catch{try{n.focus()}catch{}}}try{document.dispatchEvent(new CustomEvent("baf:revealed",{detail:{level:e.level,won:e.gateWon,prizeHits:e.player.prizeHits?.length||0}}))}catch{}}f(j,"_finishCeremony");function X(t,e){const a=t.querySelector('[data-bind="baf-shell"]'),s=t.querySelector('[data-bind="baf-coin"]'),r=t.querySelector('[data-bind="baf-gate-result"]'),n=t.querySelector(".baf-res__gate"),d=t.querySelector('[data-bind="baf-player-results"]'),c=t.querySelector('[data-bind="baf-weighted"]'),i=t.querySelector('[data-bind="baf-draw-wheel"]'),l=t.querySelector('[data-bind="baf-draw-state"]'),o=K()?G:H;g(()=>{!a||!s||(a.dataset.stage="coin-flip",s.classList.add("is-flipping",e.gateWon?"is-win":"is-loss"),r&&(r.textContent="FLIPPING"),E(D),E(q),g(()=>E(()=>F(.82)),Math.floor(o.flip*.46)),g(()=>{a&&(E(()=>Y(e.gateWon)),r&&(r.textContent=e.gateWon?"BAF FIRES":"BAF LOSS"),a.dataset.stage="results",n&&(n.hidden=!0),d&&(d.hidden=!1),g(()=>{a&&(a.dataset.stage=e.gateWon?"wheel":"wheel-loss",d&&(d.hidden=!0),c&&(c.hidden=!1),e.gateWon?(i?.classList.add("is-spinning"),l&&(l.textContent="DRAWING"),E(()=>F(.42,!0))):l&&(l.textContent="VOID · BAF LOSS"),g(()=>j(t,e),o.wheel))},o.results))},o.flip))},o.intro)}f(X,"_runCeremony");export async function openBafResolution({level:t,player:e,consolation:a=0,snapshot:s=null,playerOutcome:r=null,history:n=null}={}){if(typeof document>"u"||!document.body)return!1;const d=++y;T(),document.body.classList.add("baf-resolution-pending");let c;try{c=s||await U({level:t,player:e,consolation:a,playerOutcome:r,history:n})}catch(o){throw d===y&&document.body.classList.remove("baf-resolution-pending"),o}if(d!==y)return!1;const i=document.createElement("section");i.className="baf-res-modal",i.setAttribute("role","dialog"),i.setAttribute("aria-modal","true"),i.setAttribute("aria-label",`Level ${Number(t)} Big Ass Flip resolution`);const l=f(o=>{o?.key==="Escape"&&w()},"onKeydown");b={overlay:i,timers:new Set,onKeydown:l};try{if(z(i,c),d!==y||b?.overlay!==i)return!1;document.addEventListener("keydown",l),document.body.appendChild(i),document.body.classList.remove("baf-resolution-pending"),document.body.classList.add("baf-resolution-open"),X(i,c);try{i.querySelector('[data-bind="baf-close"]')?.focus({preventScroll:!0})}catch{}return!0}catch(o){throw b?.overlay===i&&T(),o}}f(openBafResolution,"openBafResolution");
//# sourceMappingURL=app-baf-resolution-overlay.js.map
