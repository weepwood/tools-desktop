'use strict';
const {app,BrowserWindow,ipcMain,dialog,Tray,Menu,nativeImage,Notification,protocol,shell,safeStorage}=require('electron');
const {autoUpdater}=require('electron-updater');
const fs=require('node:fs/promises');
const fsNative=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFile,spawn}=require('node:child_process');
const {promisify}=require('node:util');
const {pathToFileURL}=require('node:url');
const {scan,findDuplicates,wash,restore}=require('./engine.cjs');
const {History}=require('./history.cjs');
const {Video}=require('./video.cjs');
const {SplitService}=require('./split.cjs');
const {Mailer}=require('./mailer.cjs');
const {ScreenCapture}=require('./screen-capture.cjs');
const {validateCommand}=require('./ipc-validation.cjs');
const {executeOpenHaloUri,createOpenHaloStore}=require('./url-scheme.cjs');
const {createUpdateService}=require('./update-service.cjs');
const logger=require('./logger.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'halo',privileges:{secure:true,standard:true,supportFetchAPI:true,stream:true}}]);
app.setName('HALO');
// Before anything else: a crash on startup is exactly what we need on disk.
logger.init({directory:app.getPath('userData')});
if(process.platform==='win32')app.setAppUserModelId('com.weepwood.halo.electron');
const hasInstanceLock=app.requestSingleInstanceLock();
if(!hasInstanceLock)app.quit();
let win,tray,exiting=false,active=null,history,video,split,mailer,screenCapture,openHaloStore,updateService;
let trayVisible=true,launchHidden=false,shutdownPlan=null;
let windowReady=false,drainingOpenHaloUris=false;
const pendingOpenHaloUris=process.argv.slice(1).filter(value=>/^openhalo:/i.test(value));
const execFileAsync=promisify(execFile);
const shutdownSchedulePath=()=>path.join(app.getPath('userData'),'shutdown-schedule.json');
function receiveOpenHaloUri(raw){
  if(typeof raw!=='string'||!/^openhalo:/i.test(raw))return;
  pendingOpenHaloUris.push(raw);
  void drainOpenHaloUris();
}
function isOpenHaloUri(value){return typeof value==='string'&&/^openhalo:/i.test(value);}
function protocolClientArgs(){
  return process.defaultApp&&process.argv[1]
    ? {path:process.execPath,args:[path.resolve(process.argv[1])]}
    : {path:undefined,args:undefined};
}
async function registerOpenHaloProtocol(registered){
  if(!['win32','darwin'].includes(process.platform))throw Error('openhalo: 目前仅支持 Windows 和 macOS');
  const options=protocolClientArgs();
  const ok=registered
    ? app.setAsDefaultProtocolClient('openhalo',options.path,options.args)
    : app.removeAsDefaultProtocolClient('openhalo',options.path,options.args);
  if(!ok)throw Error(registered?'系统未能注册 openhalo: 协议':'系统未能取消 openhalo: 协议注册');
  return app.isDefaultProtocolClient('openhalo',options.path,options.args);
}
async function runDetached(executable,args){
  await new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{detached:true,stdio:'ignore',shell:false,windowsHide:true});
    child.once('error',reject);
    child.once('spawn',()=>{child.unref();resolve();});
  });
}
async function findExecutableOnPath(name){
  const pathApi=process.platform==='win32'?path.win32:path.posix;
  const extensions=process.platform==='win32'
    ? (pathApi.extname(name)?['']:String(process.env.PATHEXT||'.COM;.EXE;.BAT;.CMD').split(';'))
    : [''];
  for(const directory of String(process.env.PATH||'').split(path.delimiter).filter(Boolean)){
    for(const extension of extensions){
      const candidate=pathApi.join(directory,name+extension);
      try{
        const stat=await fs.stat(candidate);
        if(!stat.isFile())continue;
        await fs.access(candidate,process.platform==='win32'?fsNative.constants.F_OK:fsNative.constants.X_OK);
        return candidate;
      }catch{}
    }
  }
  return null;
}
async function handleOpenHaloUri(raw){
  if(!openHaloStore)return;
  const options=protocolClientArgs();
  let config;
  try{config=await openHaloStore.getConfig();}
  catch(error){logger.warn('读取 openhalo 配置失败',error);return;}
  if(!config.enabled||!app.isDefaultProtocolClient('openhalo',options.path,options.args)){
    await openHaloStore.recordCall({uri:raw,status:'ignored',error:'协议尚未注册或已取消注册'}).catch(error=>logger.warn('openhalo 调用日志写入失败',error));
    return;
  }
  show();
  try{
    const result=await executeOpenHaloUri(raw,{
      aliases:config.aliases,
      findExecutable:findExecutableOnPath,
      pathExists:async value=>{
        try{const stat=await fs.stat(value);return stat.isFile()||stat.isDirectory();}catch{return false;}
      },
      openPath:async value=>{const error=await shell.openPath(value);if(error)throw Error(error);},
      revealPath:value=>shell.showItemInFolder(value),
      openUrl:value=>shell.openExternal(value),
      confirmRun:async({executable,args})=>{
        const answer=await dialog.showMessageBox(win,{
          type:'warning',title:'确认运行外部程序',
          message:'此 openhalo: 链接请求启动本地程序。只运行来自可信来源的程序。',
          detail:[executable,...args].join(' '),
          buttons:['运行','取消'],defaultId:1,cancelId:1,noLink:true,
        });
        return answer.response===0;
      },
      runCommand:runDetached,
    });
    await openHaloStore.recordCall({uri:raw,status:result.status,action:result.action,target:result.target}).catch(error=>logger.warn('openhalo 调用日志写入失败',error));
  }catch(error){
    logger.warn('openhalo URI 处理失败',error);
    await openHaloStore.recordCall({uri:raw,status:'error',error:error.message}).catch(logError=>logger.warn('openhalo 调用日志写入失败',logError));
    if(win&&!win.isDestroyed())await dialog.showMessageBox(win,{
      type:'error',title:'无法处理 URL Scheme',message:error.message,buttons:['确定'],noLink:true,
    }).catch(dialogError=>logger.warn('显示 openhalo 错误提示失败',dialogError));
  }
}
async function drainOpenHaloUris(){
  if(drainingOpenHaloUris||!windowReady||!openHaloStore||!win||win.isDestroyed())return;
  drainingOpenHaloUris=true;
  try{while(pendingOpenHaloUris.length)await handleOpenHaloUri(pendingOpenHaloUris.shift());}
  finally{drainingOpenHaloUris=false;}
}
app.on('open-url',(event,url)=>{event.preventDefault();receiveOpenHaloUri(url);});
const status=()=>({running:Boolean(active),kind:active?.kind||null,cancelling:Boolean(active?.controller.signal.aborted),progress:active?.progress||null});
function broadcast(name,payload){if(win&&!win.isDestroyed())win.webContents.send('halo:event',{name,payload});}
function statusChanged(){broadcast('task-status',status());}
function errorMessage(value){return value instanceof Error?value.message:String(value??'未知错误');}
function fatal(kind,error){
  logger.error(kind,error);
  // An idle crash must not kill the user's window for nothing; a crash while a
  // task runs leaves files half written, so stop and ask for a history re-check.
  if(!active)return;
  try{dialog.showErrorBox('HALO 遇到错误','任务可能未完整结束，请重新打开后核验历史记录。\n\n'+errorMessage(error));}catch{}
  app.exit(1);
}
process.on('uncaughtException',error=>fatal('未捕获的异常',error));
process.on('unhandledRejection',error=>fatal('未处理的 Promise 拒绝',error));
app.on('render-process-gone',(event,contents,details)=>{
  logger.error('界面进程异常退出：'+String(details?.reason||'unknown')+'，退出码 '+String(details?.exitCode??'未知'));
  if(!win||win.isDestroyed())return;
  dialog.showMessageBox(win,{type:'error',title:'HALO 界面已停止',
    message:'界面进程异常退出：'+String(details?.reason||'未知原因')+'。可以重新加载界面，也可以退出应用。',
    buttons:['重新加载','退出'],defaultId:0,cancelId:1,noLink:true})
    .then(result=>{
      if(result.response===0){if(win&&!win.isDestroyed())win.reload();}
      else quitSafely();
    })
    .catch(error=>logger.error('重新加载界面失败',error));
});
// 'unresponsive' lives on webContents, not on app: watch every webContents.
app.on('web-contents-created',(event,contents)=>{
  contents.on('unresponsive',()=>logger.warn('HALO 界面暂时无响应'));
  contents.on('responsive',()=>logger.info('HALO 界面已恢复响应'));
});
// ffmpeg may legitimately die on a bad media file: log it, never interrupt the user.
app.on('child-process-gone',(event,details)=>{
  logger.warn('子进程退出：'+String(details?.type||'unknown')+' '+String(details?.serviceName||'')+' '+String(details?.reason||'unknown'));
});
async function task(kind,fn){
  if(active)throw Error('已有任务正在执行：'+active.kind);
  const controller=new AbortController();
  const holder={kind,controller,promise:null,progress:null,lastProgressBroadcast:0,lastRequestBroadcast:0};
  active=holder;statusChanged();
  try {const promise=fn(controller.signal);holder.promise=promise;return await promise;}
  finally{if(active===holder)active=null;statusChanged();}
}
async function settings(){
  try {const parsed=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'settings.json'),'utf8'));return parsed.settings||null;}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}
let settingsWrite=Promise.resolve();
function saveSettings(value){
  // Serialize rapid UI toggles. A unique temporary file also prevents
  // overlapping writes from corrupting settings.json on Windows.
  settingsWrite=settingsWrite.catch(()=>{}).then(async()=>{
    const file=path.join(app.getPath('userData'),'settings.json');
    await fs.mkdir(path.dirname(file),{recursive:true});
    const temporary=file+'.'+crypto.randomUUID()+'.tmp';
    const handle=await fs.open(temporary,'wx');
    try{await handle.writeFile(JSON.stringify({settings:value},null,2));await handle.sync();}
    finally{await handle.close();}
    try{await fs.rename(temporary,file);}
    catch(error){await fs.rm(temporary,{force:true});throw error;}
  });
  return settingsWrite;
}
async function readShutdownSchedule(){
  const file=shutdownSchedulePath();
  try{
    const parsed=JSON.parse(await fs.readFile(file,'utf8'));
    if(Number.isSafeInteger(parsed.scheduledAt)&&parsed.scheduledAt>Date.now()&&
      (!parsed.platform||parsed.platform===process.platform))
      return {scheduledAt:parsed.scheduledAt,action:parsed.action==='power-on'?'power-on':'shutdown'};
    await fs.rm(file,{force:true});
  }catch(error){
    if(error.code==='ENOENT')return null;
    // A damaged cache must not prevent the desktop app from starting.
    await fs.rm(file,{force:true}).catch(()=>{});
  }
  return null;
}
function macScheduleDate(scheduledAt){
  const date=new Date(scheduledAt);
  const pad=value=>String(value).padStart(2,'0');
  return `${pad(date.getMonth()+1)}/${pad(date.getDate())}/${pad(date.getFullYear()%100)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
async function runMacPowerCommand(args){
  const command=`pmset ${args.map(value=>`'${String(value).replace(/'/g,"'\\''")}'`).join(' ')}`;
  const script=`do shell script "${command.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}" with administrator privileges`;
  return execFileAsync('osascript',['-e',script],{windowsHide:true});
}
async function runLinuxPrivileged(program,args){
  return execFileAsync('pkexec',[program,...args],{windowsHide:true});
}
async function findLinuxCommand(name){
  const candidates=name==='shutdown'
    ? ['/usr/sbin/shutdown','/sbin/shutdown','/usr/bin/shutdown','/bin/shutdown']
    : ['/usr/sbin/rtcwake','/sbin/rtcwake','/usr/bin/rtcwake','/bin/rtcwake'];
  for(const candidate of candidates){try{await fs.access(candidate);return candidate;}catch{}}
  throw Error(`未找到系统命令 ${name}。`);
}
async function shutdownCapabilities(){
  if(process.platform==='win32')return {platform:'win32',canShutdown:true,canPowerOn:false};
  if(process.platform==='darwin')return {platform:'darwin',canShutdown:true,canPowerOn:true};
  if(process.platform==='linux'){
    let canShutdown=false,canPowerOn=false;
    try{await findLinuxCommand('shutdown');canShutdown=true;}catch{}
    try{
      const rtcwake=await findLinuxCommand('rtcwake');
      await execFileAsync(rtcwake,['--version'],{windowsHide:true});
      await fs.access('/dev/rtc0');
      canPowerOn=true;
    }catch{}
    return {platform:'linux',canShutdown,canPowerOn};
  }
  return {platform:process.platform,canShutdown:false,canPowerOn:false};
}
async function scheduleShutdown(scheduledAt,action='shutdown'){
  if(!['shutdown','power-on'].includes(action))throw Error('电源计划类型无效。');
  const capabilities=await shutdownCapabilities();
  if(action==='shutdown'&&!capabilities.canShutdown)throw Error('当前平台不支持定时关机。');
  if(action==='power-on'&&!capabilities.canPowerOn)throw Error('当前设备不支持定时开机或未检测到 RTC 闹钟。');
  if(!Number.isSafeInteger(scheduledAt))throw Error('关机时间无效。');
  let effectiveScheduledAt=scheduledAt;
  const seconds=Math.ceil((scheduledAt-Date.now())/1000);
  if(seconds<60)throw Error('计划时间至少需要在 1 分钟之后。');
  if(seconds>315360000)throw Error('电源计划不能超过 10 年。');
  if(shutdownPlan&&shutdownPlan.scheduledAt>Date.now())throw Error('已有一个电源计划，请先取消后再重新安排。');
  if(process.platform==='linux'&&action==='shutdown')
    effectiveScheduledAt=Date.now()+Math.max(1,Math.ceil(seconds/60))*60_000;
  const file=shutdownSchedulePath();
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,JSON.stringify({scheduledAt:effectiveScheduledAt,action,platform:process.platform}));
  try{
    if(process.platform==='win32'){
      if(action!=='shutdown')throw Error('Windows 无法通过通用系统接口从完全关机状态定时开机。');
      await execFileAsync('shutdown.exe',['/s','/t',String(seconds)],{windowsHide:true});
    }else if(process.platform==='darwin'){
      const type=action==='power-on'?'wakeorpoweron':'shutdown';
      await runMacPowerCommand(['schedule',type,macScheduleDate(scheduledAt),'HALO']);
    }else if(process.platform==='linux'){
      if(action==='shutdown'){
        const minutes=Math.max(1,Math.ceil(seconds/60));
          await runLinuxPrivileged(await findLinuxCommand('shutdown'),['--poweroff','--no-wall',`+${minutes}`]);
          effectiveScheduledAt=Date.now()+minutes*60_000;
      }else{
          const rtcwake=await findLinuxCommand('rtcwake');
          const {stdout}=await execFileAsync(rtcwake,['-m','show'],{windowsHide:true});
        if(!/alarm:\s*off/i.test(stdout))throw Error('RTC 闹钟当前已被占用，请先在系统中检查现有唤醒计划。');
          await runLinuxPrivileged(rtcwake,['-m','no','-t',String(Math.floor(scheduledAt/1000))]);
      }
    }else throw Error('当前平台暂不支持电源计划。');
    if(effectiveScheduledAt!==scheduledAt)
      await fs.writeFile(file,JSON.stringify({scheduledAt:effectiveScheduledAt,action,platform:process.platform})).catch(()=>{});
  }
  catch(error){await fs.rm(file,{force:true});throw Error('安排关机失败：'+error.message);}
  shutdownPlan={scheduledAt:effectiveScheduledAt,action};
  return shutdownPlan;
}
async function cancelShutdown(){
  if(!shutdownPlan)return false;
  const {scheduledAt,action}=shutdownPlan;
  if(process.platform==='win32')await execFileAsync('shutdown.exe',['/a'],{windowsHide:true});
  else if(process.platform==='darwin'){
    const type=action==='power-on'?'wakeorpoweron':'shutdown';
    await runMacPowerCommand(['schedule','cancel',type,macScheduleDate(scheduledAt),'HALO']);
  }else if(process.platform==='linux'){
    if(action==='shutdown')await runLinuxPrivileged(await findLinuxCommand('shutdown'),['-c']);
    else{
      const rtcwake=await findLinuxCommand('rtcwake');
      const {stdout}=await execFileAsync(rtcwake,['-m','show'],{windowsHide:true});
      const match=stdout.match(/alarm:\s*on\s+(.+)/i);
      const alarmAt=match?Date.parse(match[1]):NaN;
      if(!Number.isFinite(alarmAt)||Math.abs(alarmAt-scheduledAt)>5000)
        throw Error('RTC 闹钟已变化，为避免取消其他程序的闹钟，未执行清除。');
      await runLinuxPrivileged(rtcwake,['-m','disable']);
    }
  }
  shutdownPlan=null;
  await fs.rm(shutdownSchedulePath(),{force:true});
  return true;
}
function createTray(){
  if(tray||!trayVisible)return;
  // macOS menu bar icons are 16pt with a matching @2x asset. Keep the HALO
  // mark in color; template images are intentionally recolored by macOS.
  const trayAsset=process.platform==='darwin'?'tray-mac.png':'tray.png';
  let icon=nativeImage.createFromPath(path.join(__dirname,'..','assets',trayAsset));
  if(process.platform==='darwin'&&!icon.isEmpty())icon.setTemplateImage(false);
  if(icon.isEmpty())icon=nativeImage.createFromPath(path.join(__dirname,'..','assets','icon.png'));
  if(icon.isEmpty())icon=nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8rXFoAAAAASUVORK5CYII=');
  tray=new Tray(icon);
  tray.setToolTip('HALO Tools');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'显示 HALO',click:()=>show()},
    {label:'退出',click:()=>quitSafely()},
  ]));
  tray.on('double-click',()=>show());
}
function destroyTray(){if(tray){tray.destroy();tray=null;}}
function show(){if(!win||win.isDestroyed())return;launchHidden=false;win.show();win.focus();}
async function quitSafely(){
  if(exiting)return;exiting=true;
  if(active){active.controller.abort();statusChanged();try{await active.promise;}catch{}}
  app.quit();
}
function devAddress(){
  if(app.isPackaged||!process.env.HALO_DEV_URL)return null;
  const url=new URL(process.env.HALO_DEV_URL);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.port!=='1420')
    throw Error('开发服务器必须使用 http://127.0.0.1:1420');
  return url.toString();
}
app.on('second-instance',(event,commandLine=[])=>{
  if(!hasInstanceLock)return;
  const uris=commandLine.filter(isOpenHaloUri);
  if(uris.length){uris.forEach(receiveOpenHaloUri);return;}
  if(!win||win.isDestroyed())return;
  if(win.isMinimized())win.restore();show();
});
function createWindow(){
  const mac=process.platform==='darwin';
  const development=devAddress();
  const expected=development||pathToFileURL(path.join(__dirname,'..','dist','index.html')).toString();
  win=new BrowserWindow({width:1180,height:780,minWidth:820,minHeight:560,show:false,
    backgroundColor:'#15181e',frame:mac,titleBarStyle:mac?'hiddenInset':undefined,
    ...(mac?{trafficLightPosition:{x:12,y:12}}:{}),
    // Explicit icon: packaged builds take it from the exe, but in development
    // this is what puts the HALO mark in the title bar and the taskbar.
    icon:path.join(__dirname,'..','assets','icon.png'),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  win.on('close',event=>{if(!exiting&&trayVisible){event.preventDefault();win.hide();}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(e,url)=>{
    const allowed=development
      ? new URL(url).origin===new URL(expected).origin
      : url===expected||url.startsWith(expected+'#');
    if(!allowed)e.preventDefault();
  });
  if(development)win.loadURL(development);
  else win.loadFile(path.join(__dirname,'..','dist','index.html'));
  win.webContents.once('did-finish-load',()=>{windowReady=true;void drainOpenHaloUris();});
  win.once('ready-to-show',()=>{if(!launchHidden)win.show();});
}
function wire(){
  ipcMain.on('halo:drag',(e,payload)=>{if(e.sender!==win?.webContents||e.senderFrame!==win?.webContents.mainFrame)return;const {type,paths}=payload||{};broadcast('drag-drop',{type,paths:Array.isArray(paths)?paths.filter(x=>typeof x==='string').slice(0,20):[]});});
  ipcMain.handle('halo:invoke',async(e,command,args={},requestId='')=>{
    if(e.sender!==win?.webContents||e.senderFrame!==win?.webContents.mainFrame)
      throw Error('未经授权的渲染进程');
    validateCommand(command,args);
    const send=payload=>{
      if(active){
        active.progress=payload;
        const terminal=['completed','cancelled','failed','skipped'].includes(payload?.kind)||payload?.progressPercent===100;
        if(terminal||Date.now()-active.lastProgressBroadcast>=150){active.lastProgressBroadcast=Date.now();statusChanged();}
        // Per-file progress (e.g. wash/scan) used to fire a 'request:' IPC for
        // every item — tens of thousands of serialised broadcasts for a large
        // run. The renderer already coalesces these, so throttle the main-side
        // broadcast to the same 150ms window; terminal events always pass through.
        if(typeof requestId==='string'&&/^[\da-f-]{36}$/i.test(requestId)&&
          (terminal||Date.now()-active.lastRequestBroadcast>=150)){
          active.lastRequestBroadcast=Date.now();
          broadcast('request:'+requestId,payload);
        }
      } else if(typeof requestId==='string'&&/^[\da-f-]{36}$/i.test(requestId)){
        broadcast('request:'+requestId,payload);
      }
    };
    switch(command){
      case 'frontend_ready':if(!launchHidden)show();return;
      case 'window_minimize':return win.minimize();
      case 'window_toggle_maximize':return win.isMaximized()?win.unmaximize():win.maximize();
      case 'window_close':return win.close();
      case 'notify':{
        if(!Notification.isSupported())return false;
        return await new Promise(resolve=>{
          const notification=new Notification({title:String(args.title||'HALO'),body:String(args.body||'')});
          let settled=false;
          const finish=shown=>{if(settled)return;settled=true;resolve(shown);};
          notification.once('show',()=>finish(true));
          notification.once('failed',()=>finish(false));
          notification.show();
        });
      }
      case 'is_autostart_enabled':return app.getLoginItemSettings().openAtLogin;
      case 'set_autostart':if(!app.isPackaged)throw Error('开机启动仅在安装后的应用中可配置');app.setLoginItemSettings({openAtLogin:Boolean(args.enabled),openAsHidden:Boolean(args.minimized)});return;
      case 'set_menu_bar_visible':trayVisible=Boolean(args.visible);if(trayVisible)createTray();else destroyTray();return;
      case 'settings_get':return await settings();
      case 'settings_set':return await saveSettings(args.settings);
      case 'update_status':return updateService.getSnapshot();
      case 'update_check':return await updateService.check();
      case 'update_download':return await updateService.download();
      case 'update_install':return updateService.install();
      case 'update_open_release':return await updateService.openRelease();
      case 'openhalo_status':{
        const supported=['win32','darwin'].includes(process.platform),options=protocolClientArgs();
        const [config,osRegistered]=await Promise.all([
          openHaloStore.getConfig(),
          Promise.resolve(supported&&app.isDefaultProtocolClient('openhalo',options.path,options.args)),
        ]);
        return {supported,registered:supported&&config.enabled&&osRegistered,enabled:config.enabled,osRegistered,platform:process.platform};
      }
      case 'openhalo_register':{
        await registerOpenHaloProtocol(true);
        return await openHaloStore.setEnabled(true);
      }
      case 'openhalo_unregister':{
        await openHaloStore.setEnabled(false);
        await registerOpenHaloProtocol(false);
        return false;
      }
      case 'openhalo_config_get':return await openHaloStore.getConfig();
      case 'openhalo_config_set':return await openHaloStore.setConfig(args.config);
      case 'openhalo_calls':return await openHaloStore.readCalls();
      // The password never travels back to the renderer: view() reports only
      // whether a secret is stored and whether the OS keyring protects it.
      case 'mail_config_get':return await mailer.view();
      case 'mail_config_set':return await mailer.save(args.patch);
      case 'mail_test':return await mailer.test();
      case 'mail_notify':return await mailer.notifyTaskEnd({title:args.title,body:args.body});
      case 'get_shutdown_schedule':return {...await shutdownCapabilities(),plan:shutdownPlan};
      case 'schedule_shutdown':return await scheduleShutdown(args.scheduledAt,args.action);
      case 'cancel_shutdown':return await cancelShutdown();
      case 'task_running':return Boolean(active);
      case 'task_status':return status();
      case 'cancel_task':if(!active)return false;active.controller.abort();statusChanged();return true;
      case 'dialog_open':{
        const opts=args.options||{};
        const properties=[opts.directory?'openDirectory':'openFile'];
        if(opts.multiple)properties.push('multiSelections');
        const selection=await dialog.showOpenDialog(win,{title:opts.title||'选择文件',properties,filters:opts.directory?undefined:opts.filters});
        return selection.canceled?null:opts.multiple?selection.filePaths:selection.filePaths[0]||null;
      }
      case 'dialog_save':{
        const opts=args.options||{};
        const result=await dialog.showSaveDialog(win,{title:opts.title||'保存文件',defaultPath:opts.defaultPath,filters:opts.filters});
        return result.canceled?null:result.filePath||null;
      }
      case 'dialog_confirm':{
        const result=await dialog.showMessageBox(win,{type:args.options?.kind==='warning'?'warning':'question',title:args.options?.title||'请确认',message:String(args.message||''),buttons:['确定','取消'],defaultId:1,cancelId:1,noLink:true});
        return result.response===0;
      }
      case 'scan_files':return task('scan',async signal=>(await scan(args.request,signal)).summary);
      case 'find_duplicates':return task('duplicates',signal=>findDuplicates(args.request,signal,send));
      case 'wash_files':return task('wash',signal=>wash(args.request,signal,send,history));
      case 'restore_session':return task('restore',signal=>restore(args.request,signal,send,history));
      case 'list_history':return history.summaries();
      case 'storage_diagnostics':{
        const diagnostics=[];
        try{await history.load();diagnostics.push(...history.warnings);}catch(error){diagnostics.push('历史索引无法读取：'+error.message);}
        try{await video.list();diagnostics.push(...video.warnings);}catch(error){diagnostics.push('视频历史无法读取：'+error.message);}
        return diagnostics;
      }
      case 'get_history_session':return history.getSession(args.sessionId);
      case 'clear_history':return task('history',()=>history.clear());
      case 'export_session_csv':return history.exportCsv(args.sessionId,args.outputPath);
      case 'video_tool_status':return task('video-probe',signal=>video.toolStatus(signal));
      case 'probe_video':return task('video-probe',signal=>video.probe(args.videoPath,signal));
      case 'video_output_suggestion':return video.suggest(args.videoPath,args.outputParent);
      case 'extract_video_frames':return task('video',signal=>video.extract(args.request,signal,send));
      case 'list_video_tasks':return video.list();
      case 'screen_capture_supported':return screenCapture.supported();
      case 'screen_capture_displays':return screenCapture.displays();
      case 'screen_capture_last_session':return screenCapture.lastSession();
      case 'screen_capture':return task('screen-capture',async signal=>{
        await screenCapture.root(args.request.outputRoot);
        const displays=await screenCapture.displays();
        if(!displays.some(display=>display.id===args.request.displayId))
          throw Error('所选显示器已不可用，请刷新显示器列表后重试。');
        await screenCapture.checkAccess(args.request.displayId);
        return await screenCapture.capture(args.request,signal,send);
      });
      case 'list_screen_capture_days':return screenCapture.listDays(args.outputRoot);
      case 'get_screen_capture_frames':return screenCapture.getFrames(args.outputRoot,args.date,args.page,args.pageSize);
      case 'export_screen_capture_day':return task('screen-video',signal=>
        screenCapture.exportDay(args.outputRoot,args.date,args.fps,signal,send));
      case 'open_screen_capture_day':{
        if(!await screenCapture.rootRegistered(args.outputRoot))throw Error('此目录尚未登记为 HALO 屏幕截图目录。');
        const root=await screenCapture.root(args.outputRoot),dir=path.join(root,args.date);
        const stat=await fs.lstat(dir).catch(()=>null);
        if(!stat?.isDirectory()||stat.isSymbolicLink()||await fs.realpath(dir)!==dir)
          throw Error('此日期的截图目录不存在或路径已变化。');
        const error=await shell.openPath(dir);if(error)throw Error(error);return;
      }
      case 'split_video':return task('video-split',signal=>split.split(args.request,signal,send));
      case 'merge_split_task':return task('video-merge',signal=>split.merge(args.taskId,signal,send));
      case 'list_split_tasks':return split.list();
      case 'open_split_output':{
        const record=await split.get(args.taskId);
        if(!record.outputDir)throw Error('此任务没有可打开的分片目录');
        const dir=await fs.realpath(record.outputDir);
        if(dir!==record.outputDir)throw Error('分片目录位置发生变化');
        const error=await shell.openPath(dir);if(error)throw Error(error);return;
      }
      case 'get_video_task_frames':return video.page(args.taskId,args.page,args.pageSize);
      case 'export_contact_sheet':return task('contact-sheet',signal=>video.contactSheet(args.taskId,args.page,args.pageSize,signal,send));
      case 'open_video_output':{
        const record=await video.get(args.taskId);
        const dir=await fs.realpath(record.outputDir);
        if(dir!==record.outputDir)throw Error('输出目录位置发生变化');
        const error=await shell.openPath(dir);if(error)throw Error(error);return;
      }
      default:throw Error('未知的命令：'+command);
    }
  });
}
app.whenReady().then(async()=>{
  if(!hasInstanceLock)return;
  openHaloStore=createOpenHaloStore(app.getPath('userData'));
  updateService=createUpdateService({app,autoUpdater,shell,emit:broadcast,isTaskRunning:()=>Boolean(active)});
  if(process.platform==='darwin'){
    const appIcon=nativeImage.createFromPath(path.join(__dirname,'..','assets','icon.png'));
    if(!appIcon.isEmpty())app.dock?.setIcon(appIcon);
  }
  history=new History(app.getPath('userData'));
  video=new Video(app.getPath('userData'));
  screenCapture=new ScreenCapture(app.getPath('userData'));
  split=new SplitService(app.getPath('userData'),video);
  mailer=new Mailer({
    directory:app.getPath('userData'),
    secureStorage:safeStorage,
    version:app.getVersion(),
    hostName:os.hostname(),
  });
  // Recovery must never block startup: the reported runs are a bonus, not a gate.
  try{await history.recoverRestoreRuns();}catch(error){logger.error('恢复日志回收失败',error);}
  try{await screenCapture.recover();}catch(error){logger.error('屏幕截图会话恢复失败',error);}
  await video.recover();
  await split.recover();
  protocol.handle('halo',async request=>{
    try{
      const url=new URL(request.url);
      if(url.host!=='image')return new Response('Not found',{status:404});
      const file=decodeURIComponent(url.pathname.slice(1));
      if(!await video.imageAllowed(file)&&!await screenCapture.imageAllowed(file))return new Response('Forbidden',{status:403});
      return new Response(await fs.readFile(file),{headers:{'Content-Type':'image/png','Cache-Control':'private, max-age=3600'}});
    }catch{return new Response('Not found',{status:404});}
  });
  const saved=await settings();
  shutdownPlan=await readShutdownSchedule();
  trayVisible=saved?.showInMenuBar!==false;
  launchHidden=Boolean(saved?.startMinimized && app.getLoginItemSettings().wasOpenedAtLogin && trayVisible);
  wire();createTray();createWindow();
}).catch(e=>{dialog.showErrorBox('HALO 启动失败',e.stack||String(e));app.quit();});
app.on('window-all-closed',()=>{if(process.platform!=='darwin'&&!trayVisible)quitSafely();});
app.on('activate',()=>{if(!hasInstanceLock)return;if(win)show();else createWindow();});
