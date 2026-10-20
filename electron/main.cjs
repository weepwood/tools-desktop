'use strict';
const {app,BrowserWindow,ipcMain,dialog,Tray,Menu,nativeImage,Notification,protocol,shell}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {scan,wash,restore}=require('./engine.cjs');
const {History}=require('./history.cjs');
const {Video}=require('./video.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'xima',privileges:{secure:true,standard:true,supportFetchAPI:true,stream:true}}]);
app.setAppUserModelId('com.weepwood.xima.electron');
let win,tray,exiting=false,active=null,history,video;
let trayVisible=true,launchHidden=false;
const status=()=>({running:Boolean(active),kind:active?.kind||null,cancelling:Boolean(active?.controller.signal.aborted)});
function broadcast(name,payload){if(win&&!win.isDestroyed())win.webContents.send('xima:event',{name,payload});}
function statusChanged(){broadcast('task-status',status());}
async function task(kind,fn){
  if(active)throw Error('已有任务正在执行：'+active.kind);
  const controller=new AbortController();
  const holder={kind,controller,promise:null};
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
function createTray(){
  if(tray||!trayVisible)return;
  const file=path.join(__dirname,'..','assets','icon.png');
  let icon=nativeImage.createFromPath(file);
  if(icon.isEmpty())icon=nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8rXFoAAAAASUVORK5CYII=');
  tray=new Tray(icon);
  tray.setToolTip('XIMA Tools');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'显示 XIMA',click:()=>show()},
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
  if(app.isPackaged||!process.env.XIMA_DEV_URL)return null;
  const url=new URL(process.env.XIMA_DEV_URL);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.port!=='1420')
    throw Error('开发服务器必须使用 http://127.0.0.1:1420');
  return url.toString();
}
function createWindow(){
  const mac=process.platform==='darwin';
  const development=devAddress();
  const expected=development||pathToFileURL(path.join(__dirname,'..','dist','index.html')).toString();
  win=new BrowserWindow({width:1180,height:780,minWidth:820,minHeight:560,show:false,
    backgroundColor:'#15181e',frame:mac,titleBarStyle:mac?'hiddenInset':undefined,
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
  ipcMain.on('xima:drag',(e,payload)=>{if(e.sender!==win?.webContents)return;const {type,paths}=payload||{};broadcast('drag-drop',{type,paths:Array.isArray(paths)?paths.filter(x=>typeof x==='string').slice(0,20):[]});});
  ipcMain.handle('xima:invoke',async(e,command,args={},requestId='')=>{
    if(e.sender!==win?.webContents||e.senderFrame!==win?.webContents.mainFrame)
      throw Error('未经授权的渲染进程');
    if(typeof command!=='string'||!args||typeof args!=='object')throw Error('参数无效');
    const send=payload=>{if(typeof requestId==='string'&&/^[\da-f-]{36}$/i.test(requestId))broadcast('request:'+requestId,payload);};
    switch(command){
      case 'frontend_ready':if(!launchHidden)show();return;
      case 'window_minimize':return win.minimize();
      case 'window_toggle_maximize':return win.isMaximized()?win.unmaximize():win.maximize();
      case 'window_close':return win.close();
      case 'notify':if(Notification.isSupported()){new Notification({title:String(args.title||'XIMA'),body:String(args.body||'')}).show();return true;}return false;
      case 'is_autostart_enabled':return app.getLoginItemSettings().openAtLogin;
      case 'set_autostart':if(!app.isPackaged)throw Error('开机启动仅在安装后的应用中可配置');app.setLoginItemSettings({openAtLogin:Boolean(args.enabled),openAsHidden:Boolean(args.minimized)});return;
      case 'set_menu_bar_visible':trayVisible=Boolean(args.visible);if(trayVisible)createTray();else destroyTray();return;
      case 'settings_get':return await settings();
      case 'settings_set':return await saveSettings(args.settings);
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
      case 'wash_files':return task('wash',signal=>wash(args.request,signal,send,history));
      case 'restore_session':return task('restore',signal=>restore(args.request,signal,send,history));
      case 'list_history':return history.summaries();
      case 'get_history_session':return history.getSession(args.sessionId);
      case 'clear_history':return task('history',()=>history.clear());
      case 'export_session_csv':return history.exportCsv(args.sessionId,args.outputPath);
      case 'video_tool_status':return task('video-probe',signal=>video.toolStatus(signal));
      case 'probe_video':return task('video-probe',signal=>video.probe(args.videoPath,signal));
      case 'video_output_suggestion':return video.suggest(args.videoPath,args.outputParent);
      case 'extract_video_frames':return task('video',signal=>video.extract(args.request,signal,send));
      case 'list_video_tasks':return video.list();
      case 'get_video_task_frames':return video.page(args.taskId,args.page,args.pageSize);
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
  history=new History(app.getPath('userData'));
  video=new Video(app.getPath('userData'));
  await video.recover();
  protocol.handle('xima',async request=>{
    try{
      const url=new URL(request.url);
      if(url.host!=='image')return new Response('Not found',{status:404});
      const file=decodeURIComponent(url.pathname.slice(1));
      if(!await video.imageAllowed(file))return new Response('Forbidden',{status:403});
      return new Response(await fs.readFile(file),{headers:{'Content-Type':'image/png','Cache-Control':'private, max-age=3600'}});
    }catch{return new Response('Not found',{status:404});}
  });
  const saved=await settings();
  trayVisible=saved?.showInMenuBar!==false;
  launchHidden=Boolean(saved?.startMinimized && app.getLoginItemSettings().wasOpenedAtLogin && trayVisible);
  wire();createTray();createWindow();
}).catch(e=>{dialog.showErrorBox('XIMA 启动失败',e.stack||String(e));app.quit();});
app.on('window-all-closed',()=>{if(process.platform!=='darwin'&&!trayVisible)quitSafely();});
app.on('activate',()=>{if(win)show();else createWindow();});
