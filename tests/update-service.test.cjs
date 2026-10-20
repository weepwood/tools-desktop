'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {parseLatestRelease,resolveUpdateMode,createUpdateService}=require('../electron/update-service.cjs');

test('parses a newer stable GitHub release and preserves its release details',()=>{
  const result=parseLatestRelease({
    tag_name:'v0.3.0',
    html_url:'https://github.com/weepwood/tools-desktop/releases/tag/v0.3.0',
    body:'Fixes and improvements',
    draft:false,
    prerelease:false,
  },'0.2.0');
  assert.deepEqual(result,{
    latestVersion:'0.3.0',
    updateAvailable:true,
    releaseNotes:'Fixes and improvements',
    releaseUrl:'https://github.com/weepwood/tools-desktop/releases/tag/v0.3.0',
  });
});

test('reports current version when the latest stable release is not newer',()=>{
  assert.equal(parseLatestRelease({tag_name:'v0.2.0',html_url:'https://github.com/weepwood/tools-desktop/releases/tag/v0.2.0'},'0.2.0').updateAvailable,false);
  assert.equal(parseLatestRelease({tag_name:'v0.1.9',html_url:'https://github.com/weepwood/tools-desktop/releases/tag/v0.1.9'},'0.2.0').updateAvailable,false);
});

test('rejects drafts, prereleases, malformed tags and untrusted release URLs',()=>{
  assert.throws(()=>parseLatestRelease({tag_name:'v1.0.0',draft:true,html_url:'https://github.com/weepwood/tools-desktop/releases/tag/v1.0.0'},'0.2.0'),/正式版/);
  assert.throws(()=>parseLatestRelease({tag_name:'v1.0.0-beta.1',html_url:'https://github.com/weepwood/tools-desktop/releases/tag/v1.0.0-beta.1'},'0.2.0'),/版本号/);
  assert.throws(()=>parseLatestRelease({tag_name:'v1.0.0',html_url:'https://example.com/release'},'0.2.0'),/Release 链接/);
});

test('offers automatic installation only for packaged Windows NSIS builds',()=>{
  assert.deepEqual(resolveUpdateMode({platform:'win32',isPackaged:true,env:{}}),{mode:'windows-installer',canInstall:true});
  assert.deepEqual(resolveUpdateMode({platform:'win32',isPackaged:true,env:{PORTABLE_EXECUTABLE_FILE:'C:\\HALO.exe'}}),{mode:'release-page',canInstall:false});
  assert.deepEqual(resolveUpdateMode({platform:'darwin',isPackaged:true,env:{}}),{mode:'release-page',canInstall:false});
  assert.deepEqual(resolveUpdateMode({platform:'win32',isPackaged:false,env:{}}),{mode:'release-page',canInstall:false});
});

test('checks GitHub and updater metadata before offering a Windows installer update',async()=>{
  const updater=new EventEmitter();
  updater.checkForUpdates=async()=>({isUpdateAvailable:true});
  updater.downloadUpdate=async()=>{};
  updater.quitAndInstall=()=>{};
  const service=createUpdateService({
    app:{isPackaged:true,getVersion:()=> '0.2.0'},
    autoUpdater:updater,
    shell:{openExternal:async()=>{}},
    platform:'win32',env:{},
    fetchImpl:async()=>({ok:true,json:async()=>({tag_name:'v0.3.0',html_url:'https://github.com/weepwood/tools-desktop/releases/tag/v0.3.0',body:'Release notes'})}),
  });
  const result=await service.check();
  assert.equal(result.status,'available');
  assert.equal(result.mode,'windows-installer');
  assert.equal(result.latestVersion,'0.3.0');
  assert.equal(updater.autoDownload,false);
});

test('downloads an available Windows update but installs only after explicit confirmation',async()=>{
  const updater=new EventEmitter();
  let downloadCalls=0,installCalls=0;
  updater.checkForUpdates=async()=>({isUpdateAvailable:true});
  updater.downloadUpdate=async()=>{downloadCalls++;updater.emit('update-downloaded',{version:'0.3.0'});};
  updater.quitAndInstall=()=>{installCalls++;};
  const service=createUpdateService({
    app:{isPackaged:true,getVersion:()=> '0.2.0'},autoUpdater:updater,shell:{openExternal:async()=>{}},
    platform:'win32',env:{},fetchImpl:async()=>({ok:true,json:async()=>({tag_name:'v0.3.0',html_url:'https://github.com/weepwood/tools-desktop/releases/tag/v0.3.0'})}),
  });
  await service.check();
  await service.download();
  assert.equal(downloadCalls,1);
  assert.equal(service.getSnapshot().status,'downloaded');
  assert.equal(installCalls,0);
  service.install();
  assert.equal(installCalls,1);
});

test('does not install an update while an application task is running',async()=>{
  const updater=new EventEmitter();
  let installCalls=0;
  updater.checkForUpdates=async()=>({isUpdateAvailable:true});
  updater.downloadUpdate=async()=>{updater.emit('update-downloaded',{version:'0.3.0'});};
  updater.quitAndInstall=()=>{installCalls++;};
  const service=createUpdateService({
    app:{isPackaged:true,getVersion:()=> '0.2.0'},autoUpdater:updater,shell:{openExternal:async()=>{}},
    platform:'win32',env:{},isTaskRunning:()=>true,
    fetchImpl:async()=>({ok:true,json:async()=>({tag_name:'v0.3.0',html_url:'https://github.com/weepwood/tools-desktop/releases/tag/v0.3.0'})}),
  });
  await service.check();
  await service.download();
  assert.throws(()=>service.install(),/任务运行期间/);
  assert.equal(installCalls,0);
});

test('uses the release page for macOS and portable builds',async()=>{
  const opened=[];
  const service=createUpdateService({
    app:{isPackaged:true,getVersion:()=> '0.2.0'},autoUpdater:null,
    shell:{openExternal:async url=>opened.push(url)},platform:'darwin',env:{},
    fetchImpl:async()=>({ok:true,json:async()=>({tag_name:'v0.3.0',html_url:'https://github.com/weepwood/tools-desktop/releases/tag/v0.3.0'})}),
  });
  const result=await service.check();
  assert.equal(result.mode,'release-page');
  assert.equal(result.canInstall,false);
  assert.equal(await service.openRelease(),result.releaseUrl);
  assert.deepEqual(opened,[result.releaseUrl]);
  await assert.rejects(service.download(),/不支持应用内更新/);
});

test('reports GitHub HTTP failures',async()=>{
  const service=createUpdateService({
    app:{isPackaged:true,getVersion:()=> '0.2.0'},autoUpdater:null,shell:{openExternal:async()=>{}},
    platform:'darwin',env:{},fetchImpl:async()=>({ok:false,status:503}),
  });
  await assert.rejects(service.check(),/HTTP 503/);
  assert.equal(service.getSnapshot().status,'error');
});

test('reports a GitHub network error',async()=>{
  const service=createUpdateService({
    app:{isPackaged:true,getVersion:()=> '0.2.0'},autoUpdater:null,shell:{openExternal:async()=>{}},
    platform:'darwin',env:{},fetchImpl:async()=>{throw Error('offline');},
  });
  await assert.rejects(service.check(),/offline/);
  assert.equal(service.getSnapshot().status,'error');
});
