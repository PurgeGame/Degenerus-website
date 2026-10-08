import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink, copyFile } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {rpcFixture} from './helpers/chain-rpc.js';
import {SCHEMA_HASH, CONTRACT_REVISION} from '../../chain/generated/index.js';
import {useSchema} from '../../chain/schema.js';
import {Interface} from '../../vendor/ethers-app.mjs';
import {CRAPS_REPLAY_ENGINE_VERSION} from '../../craps/replay-contract.js';
const exec=promisify(execFile),root=new URL('../../../',import.meta.url);

test('next-deployment preparation verifies the new registry, units and layout without changing the active profile',async()=>{
  const previousSchema = useSchema(SCHEMA_HASH);
  const f=await rpcFixture();await f.field('GAME','ticketGenerationStartBlock',1,1);f.answer('GAME','currentDayView',[121]);
  const roots = [f.contracts.VAULT, f.contracts.SDGNRS, f.contracts.GNRUS];
  f.answer('GAME', 'walletIdOf', ([address]) => [roots.indexOf(address.toLowerCase()) + 1]);
  f.answer('GAME_LENS', 'walletOfId', ([_game, id]) => [roots[Number(id) - 1]]);
  for (const name of ['COIN', 'WWXRP']) f.answer(name, 'decimals', [0]);
  for (const name of ['DGNRS', 'SDGNRS']) f.answer(name, 'decimals', [12]);
  let rateLimits = 0;
  let fault = null;
  const lens = new Interface((await import('../../chain/generated/game_lens.js')).abi);
  const server=createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;const job=JSON.parse(body);
    if (req.url === '/rpc' && job.method === 'eth_getCode' && rateLimits++ === 0) { res.statusCode=429;res.end('rate limited');return; }
    try{
      let result=req.url==='/wrong'&&job.method==='eth_chainId'?'0x2':await f.client.provider.send(job.method,job.params);
      if (fault === 'empty-link' && job.method === 'eth_getCode' && job.params[0] === '0x'+'11'.repeat(20)) result = '0x';
      if (fault === 'fallback-runtime' && req.url === '/fallback' && job.method === 'eth_getCode') result = '0x02';
      if (fault === 'empty-lens' && job.method === 'eth_call' && job.params[0].data.startsWith(lens.getFunction('findQueueEntry').selector)) result = '0x';
      res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:job.id,result}));
    }
    catch(error){res.end(JSON.stringify({jsonrpc:'2.0',id:job.id,error:{code:-32000,message:error.message}}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref();const base=`http://127.0.0.1:${server.address().port}`;
  const directory=await mkdtemp(join(tmpdir(),'chain-deployment-')),path=join(directory,'manifest.json');
  const original=await readFile(new URL('app/app/chain-config.js',root),'utf8');
  const originalProfile=await readFile(new URL('app/app/chain-config.next.js',root),'utf8');
  const originalHeaders=await readFile(new URL('_headers',root),'utf8');
  const manifest={chainId:f.client.chain.id,chainName:'Fixture',explorerUrl:'https://example.invalid',gameDeployBlock:1,readSchema:SCHEMA_HASH,contractRevision:CONTRACT_REVISION,crapsReplayEngineVersion:CRAPS_REPLAY_ENGINE_VERSION,contracts:{...f.contracts,LINK_TOKEN:'0x'+'11'.repeat(20)},publicRpcUrls:[base+'/rpc',base+'/fallback'],dayClock:f.client.clock,crapsSchedule:{daySeconds:1000,anchorSeconds:0,blockSeconds:12,periodCloseSeconds:[100,300,500,700,900]},ethDivisor:'1',ticketDivisor:'100'};
  const run=async(...args)=>{await writeFile(path,JSON.stringify(manifest));return exec(process.execPath,[fileURLToPath(new URL('db/prepare-chain-deployment.mjs',root)),'--manifest',path,...args]);};
  try{
    const result=await run('--verify');assert.match(result.stdout,/Active selector unchanged/);assert.match(result.stderr,/RPC HTTP 429; retrying/);
    await assert.rejects(run('--activate'),/requires --verify --write/);
    await assert.rejects(run('--write', '--out', fileURLToPath(new URL('app/app/chain-config.next.js',root))), /must not overwrite an active profile/);
    await assert.rejects(run('--write', '--out', fileURLToPath(new URL('app/app/chain-config.js',root))), /must not overwrite an active profile/);
    const staged = join(directory, 'staged.mjs');
    await run('--verify', '--write', '--out', staged);
    const candidate = await import(staged);
    assert.equal(candidate.CHAIN.readSchema, SCHEMA_HASH);
    assert.equal(candidate.CHAIN.contractRevision, CONTRACT_REVISION);
    assert.ok(candidate.CHAIN.codeHashes.LINK_TOKEN, 'donation token runtime is verified too');
    assert.equal(candidate.CONTRACTS.GAME, f.contracts.GAME);
    assert.equal(candidate.VOLUME_WINDOW.period, f.client.clock.period);
    assert.match(await readFile(staged, 'utf8'), /readMode/);

    // Exercise the launcher's actual --verify --write --activate invocation in an isolated
    // site. Neither this test nor a failed activation may change the real running profile.
    const isolated = join(directory, 'site');
    await mkdir(join(isolated, 'db'), {recursive:true});
    await mkdir(join(isolated, 'app/app'), {recursive:true});
    await mkdir(join(isolated, 'app/chain'), {recursive:true});
    for (const part of ['app/vendor', 'app/chain/generated', 'app/craps']) {
      await symlink(fileURLToPath(new URL(part,root)), join(isolated, part), 'dir');
    }
    await writeFile(join(isolated, 'package.json'), '{"type":"module"}');
    await writeFile(join(isolated, '_headers'), '/app/*\n  Content-Security-Policy: connect-src \'self\';\n');
    await writeFile(join(isolated, 'app/app/chain-config.js'), original);
    await writeFile(join(isolated, 'app/app/chain-config.next.js'), originalProfile);
    const entry = join(isolated, 'db/prepare-chain-deployment.mjs');
    await copyFile(new URL('db/prepare-chain-deployment.mjs',root), entry);
    const isolatedRun = (...args) => exec(process.execPath, [entry, '--manifest', path, ...args]);
    await isolatedRun('--verify', '--write');
    assert.equal(await readFile(join(isolated, 'app/app/chain-config.next.js'), 'utf8'), originalProfile);
    assert.match(await readFile(join(isolated, 'app/app/chain-config.staged.js'), 'utf8'), new RegExp(SCHEMA_HASH));
    await isolatedRun('--verify', '--write', '--activate');
    assert.match(await readFile(join(isolated, 'app/app/chain-config.js'), 'utf8'), /from '\.\/chain-config.next.js'/);
    assert.equal((await import(join(isolated, 'app/app/chain-config.next.js'))).CHAIN.readSchema, SCHEMA_HASH);
    assert.ok((await readFile(join(isolated, '_headers'), 'utf8')).includes(base), 'activation admits the verified public RPC origin');

    // An old layout's hardcoded slot 70 cannot accidentally certify the new deployment.
    await f.field('GAME', 'ticketGenerationStartBlock', 2, 1);
    await assert.rejects(run('--verify'), /bootstrap block/);
    await f.field('GAME', 'ticketGenerationStartBlock', 1, 1);
    f.answer('GAME', 'walletIdOf', [0]);
    await assert.rejects(run('--verify'), /VAULT protocol wallet ID mismatch/);
    f.answer('GAME', 'walletIdOf', ([address]) => [roots.indexOf(address.toLowerCase()) + 1]);
    f.answer('GAME_LENS', 'walletOfId', [f.contracts.GAME]);
    await assert.rejects(run('--verify'), /VAULT lens wallet owner mismatch/);
    f.answer('GAME_LENS', 'walletOfId', ([_game, id]) => [roots[Number(id) - 1]]);
    f.answer('SDGNRS', 'decimals', [18]);
    await assert.rejects(run('--verify'), /SDGNRS decimals mismatch; expected 12/);
    f.answer('SDGNRS', 'decimals', [12]);
    for (const [kind, message] of [['empty-link', /LINK_TOKEN has no deployed code/], ['fallback-runtime', /Fallback RPC deployment mismatch/], ['empty-lens', /GAME_LENS.findQueueEntry returned an invalid result/]]) {
      fault = kind;
      await assert.rejects(run('--verify'), message);
    }
    fault = null;
    manifest.contractRevision='0'.repeat(40);await assert.rejects(run(),/contractRevision does not match/);
    manifest.contractRevision=CONTRACT_REVISION;
    manifest.publicRpcUrls[1]=base+'/wrong';await assert.rejects(run('--verify'),/chain ID mismatch/);
    manifest.crapsReplayEngineVersion='craps-obsolete-v1';await assert.rejects(run(),/Pin crapsReplayEngineVersion/);
    manifest.crapsReplayEngineVersion=CRAPS_REPLAY_ENGINE_VERSION;
    manifest.readSchema='old';await assert.rejects(run(),/explicitly pin readSchema/);
    assert.equal(await readFile(new URL('app/app/chain-config.js',root),'utf8'),original);
    assert.equal(await readFile(new URL('app/app/chain-config.next.js',root),'utf8'),originalProfile);
    assert.equal(await readFile(new URL('_headers',root),'utf8'),originalHeaders);
  }finally{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});useSchema(previousSchema);}
});
