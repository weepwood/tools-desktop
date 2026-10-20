'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {ScreenCapture,isValidDate,validateCaptureRequest}=require('../electron/screen-capture.cjs');

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8rXFoAAAAASUVORK5CYII=','base64');
async function temp(){return fs.mkdtemp(path.join(os.tmpdir(),'halo-screen-'));}
function service(root,overrides={}){
  return new ScreenCapture(root,{platform:'darwin',desktopCapturer:{getSources:async()=>[]},
    screen:{getAllDisplays:()=>[]},powerMonitor:{on(){},removeListener(){}},
    resolveBinaries:async()=>({ffmpeg:'/fake/ffmpeg'}),execBinary:async()=>({output:''}),...overrides});
}

test('screen capture validates selected display, interval and output path',()=>{
  assert.doesNotThrow(()=>validateCaptureRequest({displayId:'screen:1',intervalSeconds:1,outputRoot:'/tmp/captures'}));
  assert.throws(()=>validateCaptureRequest({displayId:'',intervalSeconds:1,outputRoot:'/tmp/captures'}),/显示器/);
  assert.throws(()=>validateCaptureRequest({displayId:'screen:1',intervalSeconds:86401,outputRoot:'/tmp/captures'}),/间隔/);
  assert.throws(()=>validateCaptureRequest({displayId:'screen:1',intervalSeconds:1,outputRoot:'relative'}),/保存目录/);
});

test('date gallery lists valid PNGs in local calendar-day folders only',async t=>{
  const root=await temp();t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const dayDir=path.join(root,'2026-10-21');await fs.mkdir(dayDir);
  await fs.writeFile(path.join(dayDir,'screen_20261021_101500_000_a1b2c3d4.png'),png);
  await fs.writeFile(path.join(dayDir,'screen_20261021_101600_000_b1b2c3d4.png'),png);
  await fs.writeFile(path.join(dayDir,'screen_20261021_101700_000_badbad00.png'),'bad');
  await fs.mkdir(path.join(root,'not-a-day'));
  const capture=service(root);
  await capture.rememberRoot(root);
  assert.equal(isValidDate('2026-10-21'),true);
  assert.equal(isValidDate('2026-02-30'),false);
  assert.deepEqual(await capture.listDays(root),[{date:'2026-10-21',frameCount:2,
    firstCapturedAt:'10:15:00',lastCapturedAt:'10:16:00'}]);
  const page=await capture.getFrames(root,'2026-10-21',0,24);
  assert.equal(page.total,2);assert.equal(page.frames[0].name,'screen_20261021_101500_000_a1b2c3d4.png');
});

test('daily export encodes valid frames at requested rate and keeps source images',async t=>{
  const root=await temp();t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const dayDir=path.join(root,'2026-10-21');await fs.mkdir(dayDir);
  const first=path.join(dayDir,'screen_20261021_101500_000_a1b2c3d4.png');
  const second=path.join(dayDir,'screen_20261021_101600_000_b1b2c3d4.png');
  await fs.writeFile(first,png);await fs.writeFile(second,png);
  let argsSeen,concatText='';
  const capture=service(root,{execBinary:async(_bin,args,_signal,_timeout,onLine)=>{
    if(args[0]==='-version')return {output:'ffmpeg version test'};
    argsSeen=args;concatText=await fs.readFile(args[args.indexOf('-i')+1],'utf8');onLine?.('frame=2');
    await fs.writeFile(args.at(-1),Buffer.alloc(128,1));return {output:''};
  }});
  await capture.rememberRoot(root);
  const result=await capture.exportDay(root,'2026-10-21',10,null,()=>{});
  assert.equal(result.frames,2);assert.equal(result.fps,10);
  assert.equal(path.basename(result.path),'HALO-屏幕记录-2026-10-21.mp4');
  assert.ok(argsSeen.includes('libx264'));
  assert.equal(argsSeen[argsSeen.indexOf('-fps_mode')+1],'cfr');
  assert.equal(argsSeen[argsSeen.indexOf('-r')+1],'10');
  assert.equal((concatText.match(/^file /gm)||[]).length,2);
  assert.equal((await fs.readFile(first)).equals(png),true);
  assert.equal((await fs.readFile(second)).equals(png),true);
  const storedFrame=(await capture.getFrames(root,'2026-10-21',0,24)).frames[0];
  assert.equal(await capture.imageAllowed(storedFrame.path),true);
  const otherRoot=await temp();t.after(()=>fs.rm(otherRoot,{recursive:true,force:true}));
  const outside=path.join(otherRoot,'2026-10-21','screen_20261021_101500_000_a1b2c3d4.png');
  assert.equal(await capture.imageAllowed(outside),false);
});

test('daily export falls back to a runnable local FFmpeg when the bundled binary cannot start',async t=>{
  const root=await temp();t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const dayDir=path.join(root,'2026-10-21');await fs.mkdir(dayDir);
  await fs.writeFile(path.join(dayDir,'screen_20261021_101500_000_a1b2c3d4.png'),png);
  let usedBinary=null;
  const bundledBinary=path.join('/broken','ffmpeg');
  const systemBinary=path.join('/system/bin',process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
  const capture=service(root,{platform:process.platform,resolveBinaries:async()=>({ffmpeg:bundledBinary}),ffmpegSearchPath:['/system/bin'],
    execBinary:async(file,args)=>{
      if(args[0]==='-version'){if(file===bundledBinary)throw Error('binary cannot start');return {output:'ffmpeg'};}
      usedBinary=file;await fs.writeFile(args.at(-1),Buffer.alloc(128,1));return {output:''};
    }});
  await capture.rememberRoot(root);
  const result=await capture.exportDay(root,'2026-10-21',5,null);
  assert.equal(usedBinary,systemBinary);assert.equal(result.frames,1);
});

test('capture platform support is limited to Windows and macOS',()=>{
  assert.equal(service('/tmp',{platform:'win32'}).supported(),true);
  assert.equal(service('/tmp',{platform:'darwin'}).supported(),true);
  assert.equal(service('/tmp',{platform:'linux'}).supported(),false);
});

test('macOS permission denial is reported before the window is hidden',async()=>{
  let sourceReads=0;
  const capture=service('/tmp',{systemPreferences:{getMediaAccessStatus:()=> 'denied'},
    screen:{getAllDisplays:()=>[{id:'display-1',bounds:{width:1,height:1},scaleFactor:1}],getPrimaryDisplay:()=>({id:'display-1'})},
    desktopCapturer:{getSources:async()=>{sourceReads++;return [];}}});
  await assert.rejects(capture.checkAccess('display-1'),/系统设置.*屏幕录制/);
  assert.equal(sourceReads,0);
});

test('capture pauses while locked, then preserves its dated PNG when stopped',async t=>{
  const userData=await temp(),root=await temp();t.after(()=>Promise.all([
    fs.rm(userData,{recursive:true,force:true}),fs.rm(root,{recursive:true,force:true})]));
  const powerMonitor=new EventEmitter();powerMonitor.getSystemIdleState=()=> 'locked';
  let captured=0;
  const source={display_id:'display-1',thumbnail:{isEmpty:()=>false,toPNG:()=>{captured++;return png;}}};
  const capture=service(userData,{powerMonitor,screen:{getAllDisplays:()=>[{id:'display-1',bounds:{width:1,height:1},scaleFactor:1}],
    getPrimaryDisplay:()=>({id:'display-1'})},desktopCapturer:{getSources:async()=>[source]}});
  const controller=new AbortController();
  setTimeout(()=>powerMonitor.emit('unlock-screen'),50);
  setTimeout(()=>controller.abort(),300);
  const record=await capture.capture({displayId:'display-1',intervalSeconds:60,outputRoot:root},controller.signal);
  assert.equal(record.status,'cancelled');assert.equal(record.framesWritten,1);assert.equal(captured,1);
  const now=new Date(),localDate=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const days=await capture.listDays(root);assert.equal(days[0].date,localDate);
});

test('an interrupted active capture is marked interrupted on next startup',async t=>{
  const root=await temp();t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const capture=service(root);
  await capture.writeSession({schemaVersion:1,id:'a',status:'running',startedAt:new Date().toISOString()});
  const recovered=await capture.recover();
  assert.equal(recovered.status,'interrupted');assert.match(recovered.error,/未正常退出/);
});
