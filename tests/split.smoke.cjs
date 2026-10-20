'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {Video,resolveBinaries,execBinary}=require('../electron/video.cjs');
const {SplitService}=require('../electron/split.cjs');

test('real FFmpeg: size-capped video split retains intact original and produces playable pieces',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'xima-split-smoke-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const input=path.join(root,'测试 100% clip.mp4');
  const bins=await resolveBinaries();
  await execBinary(bins.ffmpeg,[
    '-hide_banner','-loglevel','error',
    '-f','lavfi','-i','testsrc2=size=192x108:rate=20:duration=8',
    '-c:v','mpeg4','-q:v','4','-g','10','-bf','0','-y',input
  ],null,60000);
  const bytes=await fs.readFile(input);
  const sha=crypto.createHash('sha256').update(bytes).digest('hex');
  const size=bytes.length;
  const threshold=Math.floor(size*0.48);
  const video=new Video(path.join(root,'app-data'));
  const service=new SplitService(path.join(root,'app-data'),video);
  const events=[];
  const result=await service.split({
    videoPath:input,maxSizeGb:threshold/1e9,outputParent:null
  },new AbortController().signal,event=>events.push(event));
  assert.equal(result.status,'completed',result.error||'split failed');
  assert(result.parts.length>=2,'expected at least two parts');
  assert(result.parts.every(p=>p.sizeBytes<=threshold),
    'each output must be no larger than the configured threshold');
  assert.equal(result.parts.reduce((total,part)=>total+part.sizeBytes,0)>0,true);
  for(const p of result.parts){
    assert.equal((await fs.stat(p.path)).size,p.sizeBytes);
    const probe=await video.probe(p.path,new AbortController().signal);
    assert(probe.durationSeconds>0,'all segments must be playable');
  }
  const intact=crypto.createHash('sha256').update(await fs.readFile(input)).digest('hex');
  assert.equal(intact,sha,'input file must remain unchanged');
  assert.equal((await service.list())[0].status,'completed');
  assert.equal(events[0].kind,'started');
  assert.equal(events.at(-1).kind,'completed');
  const temps=(await fs.readdir(result.outputDir)).filter(name=>name.startsWith('attempt-'));
  assert.deepEqual(temps,[],'successful attempts must not leave scratch folders');
  // A source below the threshold should not be copied or re-encoded.
  const below=await service.split({
    videoPath:input,maxSizeGb:(size+1)/1e9,outputParent:null
  },new AbortController().signal,()=>{});
  assert.equal(below.status,'skipped');
  assert.equal(below.outputDir,null);
  assert.equal(below.parts.length,0);
});
