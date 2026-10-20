'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateCommand}=require('../electron/ipc-validation.cjs');
const validScan={rootPath:process.platform==='win32'?'C:\\Videos':'/tmp/videos',
  recursive:true,skipHidden:true,skipSmall:false,minSizeBytes:0,extensions:['mp4','png']};
test('known no-argument IPC commands are accepted',()=>{
  for(const command of ['task_status','list_history','cancel_task','window_close',
    'update_check','update_download','update_install','update_open_release'])
    assert.doesNotThrow(()=>validateCommand(command,{}));
});
test('update IPC accepts no renderer-controlled arguments',()=>{
  assert.throws(()=>validateCommand('update_open_release',{url:'https://example.com'}),/更新/);
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
test('screen capture commands validate platform options and local paths',()=>{
  const root=process.platform==='win32'?'C:\\captures':'/tmp/captures';
  assert.doesNotThrow(()=>validateCommand('screen_capture_supported',{}));
  assert.doesNotThrow(()=>validateCommand('screen_capture_displays',{}));
  assert.doesNotThrow(()=>validateCommand('list_screen_capture_days',{outputRoot:root}));
  assert.doesNotThrow(()=>validateCommand('screen_capture',{request:{
    displayId:'display-1',intervalSeconds:1,outputRoot:root}}));
  assert.throws(()=>validateCommand('screen_capture',{request:{
    displayId:'',intervalSeconds:1,outputRoot:root}}),/屏幕截图请求/);
  assert.throws(()=>validateCommand('screen_capture',{request:{
    displayId:'display-1',intervalSeconds:86401,outputRoot:root}}),/屏幕截图请求/);
  assert.throws(()=>validateCommand('get_screen_capture_frames',{outputRoot:root,
    date:'2026-02-30',page:0,pageSize:24}),/日期图库/);
  assert.throws(()=>validateCommand('export_screen_capture_day',{outputRoot:root,
    date:'2026-10-21',fps:60}),/视频导出/);
  assert.throws(()=>validateCommand('open_screen_capture_day',{outputRoot:'relative',date:'2026-10-21'}),/日期目录/);
});
test('mail settings are bounded at the bridge',()=>{
  assert.doesNotThrow(()=>validateCommand('mail_config_get',{}));
  assert.doesNotThrow(()=>validateCommand('mail_test',{}));
  assert.doesNotThrow(()=>validateCommand('mail_config_set',{patch:{host:'smtp.qq.com',port:465,
    security:'tls',to:['a@b.com'],enabled:true,notifyOnTaskEnd:true,password:'x'}}));
  assert.throws(()=>validateCommand('mail_config_set',{patch:{port:70000}}),/邮件端口/);
  assert.throws(()=>validateCommand('mail_config_set',{patch:{security:'ssl'}}),/加密方式/);
  assert.throws(()=>validateCommand('mail_config_set',{patch:{to:new Array(30).fill('a@b.com')}}),/收件人/);
  assert.throws(()=>validateCommand('mail_notify',{title:'HALO',body:'y'.repeat(5000)}),/邮件通知内容/);
  assert.doesNotThrow(()=>validateCommand('mail_notify',{title:'HALO 任务结果',body:'完成'}));
});
test('URL Scheme IPC is explicit and config is bounded before crossing the bridge',()=>{
  for(const command of ['openhalo_status','openhalo_register','openhalo_unregister',
    'openhalo_config_get','openhalo_calls'])
    assert.doesNotThrow(()=>validateCommand(command,{}));
  assert.doesNotThrow(()=>validateCommand('openhalo_config_set',{config:{
    aliases:{hosts:'/etc/hosts'},logging:true,gatewayUrl:'https://url.example',enabled:false,
  }}));
  assert.throws(()=>validateCommand('openhalo_config_set',{config:{
    aliases:{hosts:42},logging:true,gatewayUrl:'https://url.example',enabled:false,
  }}),/别名/);
  assert.throws(()=>validateCommand('openhalo_config_set',{config:{
    aliases:{},logging:'yes',gatewayUrl:'https://url.example',enabled:false,
  }}),/调用日志/);
  assert.throws(()=>validateCommand('openhalo_config_set',{config:{
    aliases:{},logging:true,gatewayUrl:'file:///etc/passwd',enabled:false,
  }}),/网关/);
  assert.throws(()=>validateCommand('openhalo_config_set',{config:{
    aliases:{},logging:true,gatewayUrl:'https://',enabled:false,
  }}),/网关/);
});
