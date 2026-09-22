import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {rpcFixture} from './helpers/chain-rpc.js';
import {SCHEMA_HASH} from '../../chain/generated/index.js';
const exec=promisify(execFile),root=new URL('../../../',import.meta.url);

test('next-deployment preparation verifies both RPCs and never activates an incomplete manifest',async()=>{
  const f=await rpcFixture();await f.field('GAME','ticketGenerationStartBlock',1,0);f.answer('GAME','currentDayView',[121]);
  const server=createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;const job=JSON.parse(body);
    try{const result=req.url==='/wrong'&&job.method==='eth_chainId'?'0x2':await f.client.provider.send(job.method,job.params);res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:job.id,result}));}
    catch(error){res.end(JSON.stringify({jsonrpc:'2.0',id:job.id,error:{code:-32000,message:error.message}}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref();const base=`http://127.0.0.1:${server.address().port}`;
  const directory=await mkdtemp(join(tmpdir(),'chain-deployment-')),path=join(directory,'manifest.json');
  const original=await readFile(new URL('app/app/chain-config.js',root),'utf8');
  const manifest={chainId:f.client.chain.id,chainName:'Fixture',explorerUrl:'https://example.invalid',gameDeployBlock:1,readSchema:SCHEMA_HASH,crapsReplayEngineVersion:'craps-solidity-ed035463-v1',contracts:{...f.contracts,LINK_TOKEN:'0x'+'11'.repeat(20)},publicRpcUrls:[base+'/rpc',base+'/fallback'],dayClock:f.client.clock,crapsSchedule:{daySeconds:1000,anchorSeconds:0,blockSeconds:12,openerCloseSeconds:100,clockAlignSeconds:0,routinePeriodSeconds:100,eventLeadSeconds:10},ethDivisor:'1',ticketDivisor:'100'};
  const run=async(...args)=>{await writeFile(path,JSON.stringify(manifest));return exec(process.execPath,[fileURLToPath(new URL('db/prepare-chain-deployment.mjs',root)),'--manifest',path,...args]);};
  try{
    const result=await run('--verify');assert.match(result.stdout,/Active selector unchanged/);
    await assert.rejects(run('--activate'),/requires --verify --write/);
    manifest.publicRpcUrls[1]=base+'/wrong';await assert.rejects(run('--verify'),/chain ID mismatch/);
    manifest.readSchema='old';await assert.rejects(run(),/explicitly pin readSchema/);
    assert.equal(await readFile(new URL('app/app/chain-config.js',root),'utf8'),original);
  }finally{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
