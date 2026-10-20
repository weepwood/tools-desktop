'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateCommand}=require('../electron/ipc-validation.cjs');
const validScan={rootPath:process.platform==='win32'?'C:\\Videos':'/tmp/videos',
  recursive:true,skipHidden:true,skipSmall:false,minSizeBytes:0,extensions:['mp4','png']};
test('known no-argument IPC commands are accepted',()=>{
  for(const command of ['task_status','list_history','cancel_task','window_close'])
    assert.doesNotThrow(()=>validateCommand(command,{}));
});
test('only an expected command can cross the bridge',()=>{
  assert.throws(()=>validateCommand('shell_exec',{}),/未知 IPC/);
  assert.throws(()=>validateCommand('__proto__',{}),/未知 IPC/);
  assert.throws(()=>validateCommand('scan_files',[]),/参数对象/);
});
test('scan and wash require validated absolute paths and fingerprint',()=>{
  assert.doesNotThrow(()=>validateCommand('scan_files',{request:validScan}));
  assert.throws(()=>validateCommand('scan_files',{request:{...validScan,rootPath:'../media'}}),/扫描目录/);
  assert.throws(()=>validateCommand('scan_files',{request:{...validScan,extensions:['; rm -rf']}}),/扩展名/);
  assert.throws(()=>validateCommand('wash_files',{request:{...validScan,mode:'recoverable',
    verificationMode:'full',skipAlreadyWashed:true}}),/预扫描指纹/);
  assert.doesNotThrow(()=>validateCommand('wash_files',{request:{...validScan,
    mode:'recoverable',verificationMode:'full',skipAlreadyWashed:true,
    expectedScanFingerprint:'a'.repeat(64)}}));
});
test('restore refuses relative paths and invalid session IDs',()=>{
  assert.throws(()=>validateCommand('restore_session',{request:{sessionId:'x',paths:[],pathOverrides:{}}}),/恢复会话/);
  assert.throws(()=>validateCommand('restore_session',{request:{sessionId:'a'.repeat(36),
    paths:['../video'],pathOverrides:{}}}),/恢复文件/);
});
test('video inputs are bounded and validated',()=>{
  assert.throws(()=>validateCommand('extract_video_frames',{request:{
    videoPath:validScan.rootPath,intervalSeconds:-1,outputParent:null}}),/截图请求/);
  assert.throws(()=>validateCommand('notify',{title:'x'.repeat(1000),body:'hi'}),/通知/);
});
