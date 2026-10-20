'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {SplitService,limitBytes,outputFormat,planDuration}=require('../electron/split.cjs');
const {validateCommand}=require('../electron/ipc-validation.cjs');

test('GB means decimal gigabytes (4.5 GB is exactly 4,500,000,000 bytes)',()=>{
  assert.equal(limitBytes(4.5),4500000000);
  assert.equal(limitBytes(0.0001),100000);
  for(const invalid of [NaN,Infinity,-1,0,0.000001,10001,'4.5'])
    assert.throws(()=>limitBytes(invalid));
});
test('stream copy container selection maintains common video extensions',()=>{
  assert.deepEqual(outputFormat('video.MP4'),{extension:'mp4',muxer:'mp4'});
  assert.deepEqual(outputFormat('video.mkv'),{extension:'mkv',muxer:'matroska'});
  assert.deepEqual(outputFormat('video.webm'),{extension:'webm',muxer:'webm'});
  assert.deepEqual(outputFormat('video.avi'),{extension:'mkv',muxer:'matroska'});
  assert(planDuration(100,1000,100)>0);
  assert.throws(()=>planDuration(0,1000,100));
});
test('new IPC routes enforce bounds and absolute paths',()=>{
  const videoPath=process.platform==='win32'?'C:\\video\\test.mp4':'/tmp/video.mp4';
  assert.doesNotThrow(()=>validateCommand('split_video',{
    request:{videoPath,maxSizeGb:4.5,outputParent:null}
  }));
  assert.doesNotThrow(()=>validateCommand('list_split_tasks',{}));
  for(const req of [
    {videoPath:'../unsafe.mp4',maxSizeGb:4.5,outputParent:null},
    {videoPath,maxSizeGb:0,outputParent:null},
    {videoPath,maxSizeGb:4.5,outputParent:'relative/output'},
  ])assert.throws(()=>validateCommand('split_video',{request:req}),/视频分片参数/);
  assert.throws(()=>validateCommand('open_split_output',{taskId:'invalid'}),/分片任务编号/);
});
test('corrupt split history is isolated from valid tasks',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xima-split-history-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const service=new SplitService(dir,null);
  const id='f4932154-45d0-46ea-9093-f82376e431a2';
  const item={id,videoPath:path.join(dir,'input.mp4'),videoName:'input.mp4',
    startedAt:new Date().toISOString(),status:'skipped',parts:[],outputDir:null};
  await service.save(item);
  await fs.writeFile(path.join(service.directory,'corrupt.json'),'{');
  const all=await service.list();
  assert.equal(all.length,1);
  assert.equal(all[0].id,id);
  assert.equal(await fs.readFile(path.join(service.directory,'corrupt.json'),'utf8'),'{');
});
