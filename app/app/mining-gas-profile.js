var a=Object.defineProperty;var r=(n,m)=>a(n,"name",{value:m,configurable:!0});import{CHAIN as o}from"./chain-config.js";export function miningGasBounds(n=o.id,m=Math.floor(Date.now()/1e3)){return Number(n)===11155111&&Number(m)>=1791294816?{min:30000000n,max:30000000n}:{min:10000000n,max:16000000n}}r(miningGasBounds,"miningGasBounds");
//# sourceMappingURL=mining-gas-profile.js.map
