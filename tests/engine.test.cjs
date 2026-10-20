'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {marker,scan,wash,restore,MAGIC}=require('../electron/engine.cjs');
const {History}=require('../electron/history.cjs');
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'xima-electron-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const input=path.join(root,'in');await fs.mkdir(input);
  const data=Buffer.from('video-header--XIMA test content--00000000000000');
  const file=path.join(input,'sample.mp4');await fs.writeFile(file,data);
  const history=new History(path.join(root,'data'));
  const request={rootPath:input,recursive:true,skipHidden:true,skipSmall:false,minSizeBytes:0,extensions:['mp4']};
  return {root,file,data,history,request};
}
test('recoverable marker matches original Rust XIMA magic/size',()=>{
  const value=marker('recoverable');
  assert.equal(value.length,32);
  assert.deepEqual(value.subarray(0,8),MAGIC);
  assert.equal(marker('legacy').length,5);
});
test('scan respects extension, recursion, hidden files',async t=>{
  const {request,file}=await fixture(t);
  await fs.writeFile(path.join(request.rootPath,'.hidden.mp4'),'hidden');
  await fs.writeFile(path.join(request.rootPath,'ignored.txt'),'text');
  const result=await scan(request,new AbortController().signal);
  assert.equal(result.summary.totalFiles,1);
  assert.equal(result.files[0].path,file);
  assert.equal(result.summary.hiddenSkipped,1);
  assert.equal(result.summary.extensionSkipped,1);
  assert.equal(result.summary.preview.length,1);
  assert.match(result.summary.fingerprint,/^[a-f0-9]{64}$/);
});
test('recoverable wash and full-hash restore round trip',async t=>{
  const {request,file,data,history}=await fixture(t);
  const signal=new AbortController().signal;
  const scanned=await scan(request,signal);
  const events=[];
  const washed=await wash({...request,expectedScanFingerprint:scanned.summary.fingerprint,mode:'recoverable',verificationMode:'full',skipAlreadyWashed:true},signal,x=>events.push(x),history);
  assert.equal(washed.success,1);
  assert.equal(washed.failed,0);
  assert.equal((await fs.readFile(file)).length,data.length+32);
  assert.equal(washed.files[0].appendedHex.length,64);
  assert.equal((await history.summaries())[0].files.length,0);
  assert.equal((await history.getSession(washed.id)).files.length,1);
  const restored=await restore({sessionId:washed.id,paths:[],pathOverrides:{}},signal,x=>events.push(x),history);
  assert.equal(restored.success,1);
  assert.deepEqual(await fs.readFile(file),data);
  assert(events.some(x=>x.kind==='started'));
  assert(events.some(x=>x.kind==='completed'));
});
test('sampled verification refuses altered content',async t=>{
  const {request,file,history}=await fixture(t);
  const signal=new AbortController().signal;
  const washed=await wash({...request,mode:'recoverable',verificationMode:'sampled',skipAlreadyWashed:false},signal,()=>{},history);
  assert.equal(washed.success,1);
  const f=await fs.open(file,'r+');
  await f.write(Buffer.from('X'),0,1,0);await f.close();
  const before=(await fs.stat(file)).size;
  const restored=await restore({sessionId:washed.id,paths:[],pathOverrides:{}},signal,()=>{},history);
  assert.equal(restored.failed,1);
  assert.equal((await fs.stat(file)).size,before);
});
test('stale prescan prevents mutation',async t=>{
  const {request,file,history}=await fixture(t);
  const scanned=await scan(request,new AbortController().signal);
  await fs.appendFile(file,'changed');
  await assert.rejects(wash({...request,mode:'recoverable',verificationMode:'fast',skipAlreadyWashed:true,expectedScanFingerprint:scanned.summary.fingerprint},new AbortController().signal,()=>{},history),/重新扫描/);
});
test('journal keeps pending item following unexpected interruption',async t=>{
  const {history,file}=await fixture(t);
  const id='b2fd0c5e-8955-4986-b594-edba447259b6';
  const session={id,startedAt:new Date().toISOString(),files:[],restoreRuns:[],total:1,success:0,failed:0,skipped:0,rootPath:'/',mode:'recoverable'};
  const log=await history.startJournal(session);
  await log({type:'prepared',file:{path:file,pending:true,status:'success',relativePath:'sample.mp4',appendedHex:'58'}});
  const list=await history.load();
  assert.equal(list[0].interrupted,true);
  assert.equal(list[0].files[0].pending,true);
});
