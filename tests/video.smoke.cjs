'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const os=require('node:os');
const path=require('node:path');
const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const {Video,resolveBinaries,execBinary}=require('../electron/video.cjs');

test('real FFmpeg extraction: unicode path, pixel dimensions, immutable source, recorded frames',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'halo-smoke-'));
  t.after(()=>fs.rm(root,{force:true,recursive:true}));
  const source=path.join(root,'示例 视频 100%.mp4');
  const binary=await resolveBinaries();
  await execBinary(binary.ffmpeg,[
    '-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x64:r=1',
    '-frames:v','3','-an','-c:v','mpeg4','-y',source
  ],new AbortController().signal,60000);
  const original=crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex');
  const service=new Video(path.join(root,'data'));
  const signals=[];
  const task=await service.extract({videoPath:source,intervalSeconds:1,outputParent:null},
    new AbortController().signal,e=>signals.push(e));
  assert.equal(task.status,'completed',task.error||'FFmpeg failed');
  assert.equal(task.framesWritten,3);
  const page=await service.page(task.id,0,24);
  assert.equal(page.total,3);
  assert.equal(page.frames.length,3);
  assert.equal(page.frames[0].name,'keyframes_001.png');
  assert.equal(await service.imageAllowed(page.frames[0].path),true);
  assert.equal(await service.imageAllowed(source),false);
  assert.equal(crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex'),original);
  assert.equal(signals[0].kind,'started');
  assert.equal(signals.at(-1).kind,'completed');
});
