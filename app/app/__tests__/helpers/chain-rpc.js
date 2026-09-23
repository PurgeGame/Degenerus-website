// ABI-backed JSON-RPC fixture. Contract calls really encode/decode the generated
// deployment ABI, so renamed methods, bad arguments and tuple shapes fail tests.
import { Interface, toBeHex } from '../../../vendor/ethers-app.mjs';
import { ChainClient, contractInterface, wordHex } from '../../../chain/client.js';
import { SCHEMA_HASH } from '../../../chain/generated/index.js';
const names = ['GAME','GAME_LENS','COIN','COINFLIP','CRAPS','QUESTS','AFFILIATE','JACKPOTS','PARIMUTUEL','DEITY_PASS','WWXRP','SDGNRS','DGNRS','GNRUS','VAULT','ADMIN','AFKING_SUB_TOKEN','COIN_DRAW_BATTLE'];
const multi = new Interface(['function blockAndAggregate((address target,bytes callData)[] calls) payable returns (uint256 blockNumber,bytes32 blockHash,(bool success,bytes returnData)[] returnData)', 'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)']);
export const PLAYER = '0x1234567890123456789012345678901234567890';
export const OTHER_PLAYER = '0x2234567890123456789012345678901234567890';
let serial = 9000;
function empty(p) {
  if (p.baseType === 'array') return Array.from({length:Math.max(0,p.arrayLength)},()=>empty(p.arrayChildren));
  if (p.baseType === 'tuple') return p.components.map(empty);
  if (p.type === 'bool') return false;
  if (p.type === 'address') return toBeHex(0,20);
  if (p.type === 'string') return '';
  if (p.type === 'bytes') return '0x';
  if (/^bytes\d+$/.test(p.type)) return toBeHex(0,Number(p.type.slice(5)));
  return 0n;
}
export async function rpcFixture({ head=10000, timestamp=head*12, period=1000 }={}) {
  const contracts = Object.fromEntries(names.map((name,i)=>[name,toBeHex(i+100,20)]));
  const interfaces = new Map(await Promise.all(names.map(async name=>[contracts[name],{name,iface:await contractInterface(name)}])));
  const storage = new Map(), answers = new Map(), logs=[], requests=[];
  const hash = n=>wordHex(n+serial*1000000);
  const header = n=>({number:toBeHex(n),timestamp:toBeHex(timestamp-(head-n)*12),hash:hash(n)});
  const key=(address,slot)=>address.toLowerCase()+':'+BigInt(slot);
  const call = async ({to,data})=>{
    if (to.toLowerCase()==='0xca11bde05977b3631167028862be2a173976ca11') {
      const parsed=multi.parseTransaction({data}); const method=parsed.name, jobs=parsed.args[0];
      const outputs=await Promise.all(jobs.map(async job=>[true,await call({to:job.target,data:job.callData})]));
      return multi.encodeFunctionResult(method,method==='aggregate3'?[outputs]:[head,hash(head),outputs]);
    }
    if (data.slice(0,10)==='0x1e2eaeaf') return wordHex(storage.get(key(to,'0x'+data.slice(10)))??0n);
    const source=interfaces.get(to.toLowerCase()); if(!source) throw Error('Unknown contract '+to);
    const tx=source.iface.parseTransaction({data}); if(!tx) throw Error('Unknown selector '+data);
    const handler=answers.get(source.name+'.'+tx.name);
    const result=handler ? await handler(tx.args) : tx.fragment.outputs.map(empty);
    return source.iface.encodeFunctionResult(tx.fragment,result);
  };
  const chainId=++serial;
  const provider={send:async(method,params)=>{
    requests.push({method,params});
    if(method==='eth_chainId')return toBeHex(chainId);
    if(method==='eth_getCode')return '0x01';
    if(method==='eth_getBlockByNumber')return header(params[0]==='latest'?head:Number(params[0]));
    if(method==='eth_getStorageAt')return wordHex(storage.get(key(params[0],params[1]))??0n);
    if(method==='eth_call')return call(params[0]);
    if(method==='eth_getLogs') {
      const f=params[0];return logs.filter(l=>l.address.toLowerCase()===f.address.toLowerCase()&&Number(l.blockNumber)>=Number(f.fromBlock)&&Number(l.blockNumber)<=Number(f.toBlock)
        &&(f.topics??[]).every((topic,i)=>topic==null||(Array.isArray(topic)?topic:[topic]).includes(l.topics[i])));
    }
    if(method==='eth_getTransactionReceipt'){const selected=logs.filter(l=>l.transactionHash===params[0]);if(!selected.length)return null;return {...selected[0],logs:selected};}
    throw Error('Unexpected RPC '+method);
  }};
  const client=new ChainClient({provider,contracts,chain:{id:chainId,deployBlock:1,readSchema:SCHEMA_HASH},clock:{anchor:0,period,deployDayBoundary:0}});
  const s=await client.snapshot();
  const field=async(name,label,value,...path)=>{
    const l=await s.location(name,label,path);const shift=BigInt(l.offset*8), mask=((1n<<BigInt(l.shape.bytes*8))-1n)<<shift;
    const k=key(contracts[name],l.slot),prior=storage.get(k)??0n;storage.set(k,(prior&~mask)|((BigInt(value)<<shift)&mask));s.reads.clear();
  };
  const event=async(name,eventName,args,{block=head-1,index=logs.length,tx=wordHex(block)}={})=>{
    const iface=await contractInterface(name);const fragment=iface.getEvent(eventName);
    const encoded=iface.encodeEventLog(fragment,fragment.inputs.map(p=>args[p.name]??empty(p)));
    const log={...encoded,address:contracts[name],blockNumber:toBeHex(block),blockHash:hash(block),transactionHash:tx,transactionIndex:'0x0',logIndex:toBeHex(index)};logs.push(log);return log;
  };
  const answer=(name,method,values)=>answers.set(name+'.'+method,typeof values==='function'?values:()=>values);
  return {client,s,field,event,answer,requests,contracts,logs,storage,header};
}
