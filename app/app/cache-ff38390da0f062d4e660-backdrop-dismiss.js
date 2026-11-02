var l=Object.defineProperty;var s=(e,n)=>l(e,"name",{value:n,configurable:!0});export function dismissOnBackdrop(e,n){if(!e?.addEventListener)return;let r=null;e.addEventListener("pointerdown",t=>{r=t?.target??null}),e.addEventListener("click",t=>{const i=r;r=null,t?.target===e&&(i&&i!==e||n(t))})}s(dismissOnBackdrop,"dismissOnBackdrop");
//# sourceMappingURL=backdrop-dismiss.js.map
