'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Video}=require('../electron/video.cjs');
test('corrupt or incomplete video records do not block other history items',async t=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'xima-video-list-'));
  t.after(()=>fs.rm(tmp,{force:true,recursive:true}));
  const video=new Video(tmp);await video.ensure();
  const id='d0a07b26-a0ef-41ce-a5a4-1da59512da21';
  await fs.writeFile(video.recordPath(id),JSON.stringify({
    id,startedAt:new Date().toISOString(),outputDir:tmp,status:'completed'}));
  const corrupt='a1a07b26-a0ef-41ce-a5a4-1da59512da21';
  await fs.writeFile(video.recordPath(corrupt),'{partial');
  const invalid='b1a07b26-a0ef-41ce-a5a4-1da59512da21';
  await fs.writeFile(video.recordPath(invalid),JSON.stringify({id:invalid}));
  const records=await video.list();
  assert.equal(records.length,1);
  assert.equal(records[0].id,id);
  assert.equal(video.warnings.length,2);
  assert.equal(await fs.readFile(video.recordPath(corrupt),'utf8'),'{partial');
  await video.recover();
  assert.equal((await video.list()).length,1);
});
