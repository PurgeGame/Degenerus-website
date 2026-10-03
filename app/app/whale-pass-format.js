var e=Object.defineProperty;var o=(a,n)=>e(a,"name",{value:n,configurable:!0});export function formatWhalePassAward(a){let n=0n;try{n=BigInt(a||0)}catch{}n<0n&&(n=0n);const s=n/2n,t=n%2n===1n;return`${t?s===0n?"½":`${s}½`:s.toString()} whale pass${s===1n&&!t||s===0n&&t?"":"es"}`}o(formatWhalePassAward,"formatWhalePassAward");
//# sourceMappingURL=whale-pass-format.js.map
