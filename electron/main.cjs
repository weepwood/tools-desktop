'use strict';
const {app,BrowserWindow,ipcMain,dialog,Tray,Menu,nativeImage,Notification,protocol,shell}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {pathToFileURL}=require('node:url');
const {scan,findDuplicates,wash,restore}=require('./engine.cjs');
const {History}=require('./history.cjs');
const {Video}=require('./video.cjs');
const {SplitService}=require('./split.cjs');
const {validateCommand}=require('./ipc-validation.cjs');
const logger=require('./logger.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'halo',privileges:{secure:true,standard:true,supportFetchAPI:true,stream:true}}]);
app.setName('HALO');
// Before anything else: a crash on startup is exactly what we need on disk.
logger.init({directory:app.getPath('userData')});
if(process.platform==='win32')app.setAppUserModelId('com.weepwood.halo.electron');
const hasInstanceLock=app.requestSingleInstanceLock();
if(!hasInstanceLock)app.quit();
let win,tray,exiting=false,active=null,history,video,split;
let trayVisible=true,launchHidden=false,shutdownPlan=null;
const execFileAsync=promisify(execFile);
const shutdownSchedulePath=()=>path.join(app.getPath('userData'),'shutdown-schedule.json');
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
  const holder={kind,controller,promise:null,progress:null,lastProgressBroadcast:0};
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
  // A 32px tray asset stays crisp at 200% scaling; icon.png (512) is the
  // fallback so a missing tray file never leaves an empty tray slot.
  let icon=nativeImage.createFromPath(path.join(__dirname,'..','assets','tray.png'));
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
app.on('second-instance',()=>{if(hasInstanceLock&&win&&!win.isDestroyed()){if(win.isMinimized())win.restore();show();}});
function createWindow(){
  const mac=process.platform==='darwin';
  const development=devAddress();
  const expected=development||pathToFileURL(path.join(__dirname,'..','dist','index.html')).toString();
  win=new BrowserWindow({width:1180,height:780,minWidth:820,minHeight:560,show:false,
    backgroundColor:'#15181e',frame:mac,titleBarStyle:mac?'hiddenInset':undefined,
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
      }
      if(typeof requestId==='string'&&/^[\da-f-]{36}$/i.test(requestId))broadcast('request:'+requestId,payload);
    };
    switch(command){
      case 'frontend_ready':if(!launchHidden)show();return;
      case 'window_minimize':return win.minimize();
      case 'window_toggle_maximize':return win.isMaximized()?win.unmaximize():win.maximize();
      case 'window_close':return win.close();
      case 'notify':if(Notification.isSupported()){new Notification({title:String(args.title||'HALO'),body:String(args.body||'')}).show();return true;}return false;
      case 'is_autostart_enabled':return app.getLoginItemSettings().openAtLogin;
      case 'set_autostart':if(!app.isPackaged)throw Error('开机启动仅在安装后的应用中可配置');app.setLoginItemSettings({openAtLogin:Boolean(args.enabled),openAsHidden:Boolean(args.minimized)});return;
      case 'set_menu_bar_visible':trayVisible=Boolean(args.visible);if(trayVisible)createTray();else destroyTray();return;
      case 'settings_get':return await settings();
      case 'settings_set':return await saveSettings(args.settings);
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
  history=new History(app.getPath('userData'));
  video=new Video(app.getPath('userData'));
  split=new SplitService(app.getPath('userData'),video);
  // Recovery must never block startup: the reported runs are a bonus, not a gate.
  try{await history.recoverRestoreRuns();}catch(error){logger.error('恢复日志回收失败',error);}
  await video.recover();
  await split.recover();
  protocol.handle('halo',async request=>{
    try{
      const url=new URL(request.url);
      if(url.host!=='image')return new Response('Not found',{status:404});
      const file=decodeURIComponent(url.pathname.slice(1));
      if(!await video.imageAllowed(file))return new Response('Forbidden',{status:403});
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
