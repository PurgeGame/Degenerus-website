import{deriveTraits as r}from"./traits.js";self.onmessage=({data:e})=>{try{const s=r(BigInt(e.baseKey),e.startIndex,e.count,BigInt(e.entropy));self.postMessage({traits:s},[s.buffer])}catch(s){self.postMessage({error:s.message})}};
//# sourceMappingURL=traits-worker.js.map
