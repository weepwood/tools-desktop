'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {resolveBinaries,execBinary}=require('./video.cjs');

const FPS_VALUES=[1,2,5,10,15,24,30];
const DAY_RE=/^\d{4}-\d{2}-\d{2}$/;
const FRAME_RE=/^screen_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(\d{3})_([a-f0-9]{8})\.png$/i;
const PNG_START=Buffer.from('89504e470d0a1a0a','hex');
const PNG_END=Buffer.from('0000000049454e44ae426082','hex');

function isValidDate(value){
  if(typeof value!=='string'||!DAY_RE.test(value))return false;
  const [year,month,day]=value.split('-').map(Number);
  const date=new Date(year,month-1,day);
  return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day;
}
function validateCaptureRequest(request){
  if(!request||typeof request!=='object'||Array.isArray(request))throw Error('屏幕截图请求无效。');
  if(typeof request.displayId!=='string'||!request.displayId||request.displayId.length>256)throw Error('请选择一个有效显示器。');
  if(!Number.isSafeInteger(request.intervalSeconds)||request.intervalSeconds<1||request.intervalSeconds>86400)throw Error('截图间隔必须为 1–86400 秒整数。');
  if(typeof request.outputRoot!=='string'||!request.outputRoot||request.outputRoot.length>32768||
    !(path.isAbsolute(request.outputRoot)||path.win32.isAbsolute(request.outputRoot)))throw Error('请选择有效的本地保存目录。');
}
function dateKey(time){
  const d=new Date(time),pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function frameName(time,id){
  const d=new Date(time),pad=n=>String(n).padStart(2,'0'),ms=String(d.getMilliseconds()).padStart(3,'0');
  return `screen_${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_${ms}_${id.slice(0,8)}.png`;
}
function captureTime(name){
  const m=FRAME_RE.exec(name);if(!m)return null;
  return new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5]),Number(m[6]),Number(m[7]));
}
async function validPng(file){
  try{
    const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<45)return null;
    const handle=await fs.open(file,'r');
    try{
      const head=Buffer.alloc(24),ending=Buffer.alloc(12);
      await handle.read(head,0,24,0);await handle.read(ending,0,12,stat.size-12);
      if(!head.subarray(0,8).equals(PNG_START)||!ending.equals(PNG_END))return null;
      const width=head.readUInt32BE(16),height=head.readUInt32BE(20);
      if(!width||!height||width>32768||height>32768)return null;
      return {width,height,size:stat.size};
    }finally{await handle.close();}
  }catch{return null;}
}
async function realDirectory(value){
  const resolved=path.resolve(value),stat=await fs.lstat(resolved).catch(()=>null);
  if(!stat?.isDirectory()||stat.isSymbolicLink())throw Error('目录不存在或不是普通文件夹。');
  return fs.realpath(resolved);
}
function abortableDelay(ms,signal){
  return new Promise(resolve=>{
    if(signal?.aborted)return resolve();
    const timer=setTimeout(done,ms);
    function done(){clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();}
    signal?.addEventListener('abort',done,{once:true});
  });
}

class ScreenCapture{
  constructor(userData,dependencies={}){
    this.userData=userData;
    this.platform=dependencies.platform||process.platform;
    if(dependencies.desktopCapturer&&dependencies.screen){
      this.desktopCapturer=dependencies.desktopCapturer;this.screen=dependencies.screen;
      this.powerMonitor=dependencies.powerMonitor;
      this.systemPreferences=dependencies.systemPreferences;
    }else{
      const electron=require('electron');
      this.desktopCapturer=electron.desktopCapturer;this.screen=electron.screen;
      this.powerMonitor=electron.powerMonitor;this.systemPreferences=electron.systemPreferences;
    }
    this.resolveBinaries=dependencies.resolveBinaries||resolveBinaries;
    this.execBinary=dependencies.execBinary||execBinary;
    this.ffmpegSearchPath=dependencies.ffmpegSearchPath||process.env.PATH?.split(path.delimiter)||[];
    this.now=dependencies.now||(()=>Date.now());
    this._rootsCache=null;
    this.sessionPath=path.join(userData,'screen-capture-session.json');
    this.rootsPath=path.join(userData,'screen-capture-roots.json');
    this.pausedReasons=new Set();
  }
  supported(){return this.platform==='win32'||this.platform==='darwin';}
  async displays(){
    if(!this.supported())return [];
    const displays=this.screen.getAllDisplays(),primary=this.screen.getPrimaryDisplay();
    return displays.map((display,index)=>{
      return {id:String(display.id),name:`显示器 ${index+1}`,
        width:Math.round(display.bounds.width*display.scaleFactor),
        height:Math.round(display.bounds.height*display.scaleFactor),primary:Boolean(display.id===primary.id)};
    });
  }
  async writeSession(session){
    await fs.mkdir(this.userData,{recursive:true});
    const temporary=this.sessionPath+'.'+crypto.randomUUID()+'.tmp';
    const handle=await fs.open(temporary,'wx');
    try{await handle.writeFile(JSON.stringify(session,null,2));await handle.sync();}finally{await handle.close();}
    try{await fs.rename(temporary,this.sessionPath);}catch(error){await fs.rm(temporary,{force:true});throw error;}
  }
  async recover(){
    let session;
    try{session=JSON.parse(await fs.readFile(this.sessionPath,'utf8'));}
    catch(error){if(error.code==='ENOENT')return null;throw Error('屏幕截图会话记录无法读取：'+error.message);}
    if(session?.status!=='running')return session;
    session.status='interrupted';session.finishedAt=new Date(this.now()).toISOString();
    session.error='HALO 上次未正常退出，已保存的截图仍可浏览。';
    await this.writeSession(session);return session;
  }
  async lastSession(){
    try{return JSON.parse(await fs.readFile(this.sessionPath,'utf8'));}
    catch(error){if(error.code==='ENOENT')return null;throw Error('屏幕截图会话记录无法读取：'+error.message);}
  }
  async registeredRoots(){
    // imageAllowed() reads this once per thumbnail; cache the parsed list so a
    // gallery page does not re-read the small roots file 24 times. rememberRoot
    // clears the cache after writing.
    if(this._rootsCache)return this._rootsCache;
    let roots=[];
    try{
      const parsed=JSON.parse(await fs.readFile(this.rootsPath,'utf8'));
      if(Array.isArray(parsed))roots=parsed.filter(value=>typeof value==='string'&&path.isAbsolute(value));
    }catch(error){if(error.code!=='ENOENT')roots=[];}
    this._rootsCache=roots;
    return roots;
  }
  async rememberRoot(value){
    const root=await this.root(value),roots=await this.registeredRoots();
    if(roots.includes(root))return root;
    roots.push(root);await fs.mkdir(this.userData,{recursive:true});
    const temporary=this.rootsPath+'.'+crypto.randomUUID()+'.tmp';
    try{await fs.writeFile(temporary,JSON.stringify(roots,null,2),{flag:'wx'});await fs.rename(temporary,this.rootsPath);}
    catch(error){await fs.rm(temporary,{force:true});throw error;}
    this._rootsCache=null;
    return root;
  }
  async rootRegistered(value){
    const root=await this.root(value);
    return (await this.registeredRoots()).includes(root);
  }
  async root(value){return realDirectory(value);}
  async checkAccess(displayId){
    if(!this.supported())throw Error('屏幕截图目前仅支持 Windows 和 macOS。');
    const display=(await this.displays()).find(item=>item.id===displayId);
    if(!display)throw Error('所选显示器已不可用，请刷新显示器列表后重试。');
    if(this.platform==='darwin'&&this.systemPreferences?.getMediaAccessStatus){
      const access=this.systemPreferences.getMediaAccessStatus('screen');
      if(access==='denied'||access==='restricted')
        throw Error('HALO 没有屏幕录制权限。请在“系统设置 → 隐私与安全性 → 屏幕录制”中允许 HALO，然后重新开始。');
    }
    let sources;
    try{sources=await this.desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:display.width,height:display.height}});}
    catch(error){
      if(this.platform==='darwin')throw Error('读取屏幕失败。请检查 HALO 的系统录屏权限后重试：'+error.message);
      throw error;
    }
    const source=sources.find(item=>String(item.display_id)===display.id);
    if(!source||!source.thumbnail||source.thumbnail.isEmpty())
      throw Error('无法读取所选显示器画面。请检查系统录屏权限并重试。');
    return true;
  }
  async frameFiles(directory,date){
    const dayDir=path.join(directory,date),stat=await fs.lstat(dayDir).catch(()=>null);
    if(!stat)return [];
    if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(dayDir)!==dayDir)return [];
    const result=[];
    for(const entry of await fs.readdir(dayDir,{withFileTypes:true})){
      if(!entry.isFile()||!FRAME_RE.test(entry.name))continue;
      const time=captureTime(entry.name);if(!time||dateKey(time.getTime())!==date)continue;
      const file=path.join(dayDir,entry.name),image=await validPng(file);if(!image)continue;
      result.push({name:entry.name,path:file,thumbnailPath:file,capturedAt:time.toISOString(),width:image.width,height:image.height});
    }
    return result.sort((a,b)=>a.name.localeCompare(b.name));
  }
  async encoder(signal){
    const candidates=[];let lastError=null;
    try{const tools=await this.resolveBinaries();if(tools?.ffmpeg)candidates.push(tools.ffmpeg);}
    catch(error){lastError=error;}
    const directories=[process.env.HALO_VIDEO_TOOLS,...this.ffmpegSearchPath].filter(Boolean);
    const executable=this.platform==='win32'?'ffmpeg.exe':'ffmpeg';
    for(const directory of directories)candidates.push(path.join(directory,executable));
    for(const candidate of [...new Set(candidates)]){
      try{await this.execBinary(candidate,['-version'],signal,30000);return candidate;}
      catch(error){lastError=error;}
    }
    throw Error('无法启动本地 FFmpeg。请检查 HALO_VIDEO_TOOLS 配置或安装可用的 FFmpeg。'+
      (lastError?.message?` ${lastError.message}`:''));
  }
  async listDays(outputRoot){
    const root=await this.root(outputRoot),result=[];
    if(!(await this.registeredRoots()).includes(root))return result;
    for(const entry of await fs.readdir(root,{withFileTypes:true})){
      if(!entry.isDirectory()||entry.isSymbolicLink()||!isValidDate(entry.name))continue;
      const frames=await this.frameFiles(root,entry.name);if(!frames.length)continue;
      const time=value=>{
        const d=new Date(value);return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
      };
      result.push({date:entry.name,frameCount:frames.length,firstCapturedAt:time(frames[0].capturedAt),lastCapturedAt:time(frames.at(-1).capturedAt)});
    }
    return result.sort((a,b)=>b.date.localeCompare(a.date));
  }
  async getFrames(outputRoot,date,page=0,pageSize=24){
    if(!isValidDate(date))throw Error('截图日期无效。');
    const root=await this.root(outputRoot);
    if(!(await this.registeredRoots()).includes(root))throw Error('此目录尚未登记为 HALO 屏幕截图目录。');
    const all=await this.frameFiles(root,date);
    const size=Math.min(24,Math.max(1,Number(pageSize)||24)),last=Math.max(0,Math.ceil(all.length/size)-1);
    const index=Math.min(Math.max(0,Number(page)||0),last);
    return {frames:all.slice(index*size,(index+1)*size),total:all.length,page:index,pageSize:size};
  }
  async capture(request,signal,send=()=>{}){
    validateCaptureRequest(request);
    if(!this.supported())throw Error('屏幕截图目前仅支持 Windows 和 macOS。');
    const outputRoot=await this.rememberRoot(request.outputRoot),displays=await this.displays();
    const display=displays.find(item=>item.id===request.displayId);
    if(!display)throw Error('所选显示器已不可用，请刷新显示器列表后重试。');
    if(this.platform==='darwin'&&this.systemPreferences?.getMediaAccessStatus){
      const access=this.systemPreferences.getMediaAccessStatus('screen');
      if(access==='denied'||access==='restricted')
        throw Error('HALO 没有屏幕录制权限。请在“系统设置 → 隐私与安全性 → 屏幕录制”中允许 HALO，然后重新开始。');
    }
    const id=crypto.randomUUID(),startedAt=new Date(this.now()).toISOString();
    const session={schemaVersion:1,id,displayId:display.id,displayName:display.name,intervalSeconds:request.intervalSeconds,
      outputRoot,startedAt,finishedAt:null,status:'running',framesWritten:0,error:null};
    await this.writeSession(session);
    const events=[];
    const pause=reason=>{if(this.pausedReasons.has(reason))return;this.pausedReasons.add(reason);send({kind:'paused',framesWritten:session.framesWritten,message:'屏幕已锁定或进入睡眠，采集已暂停。'});};
    const resume=reason=>{if(!this.pausedReasons.delete(reason))return;if(!this.pausedReasons.size)send({kind:'resumed',framesWritten:session.framesWritten,message:'采集已恢复。'});};
    const add=(name,fn)=>{if(this.powerMonitor?.on){this.powerMonitor.on(name,fn);events.push([name,fn]);}};
    if(this.platform==='darwin'||this.platform==='win32'){
      try{if(this.powerMonitor?.getSystemIdleState(1)==='locked')this.pausedReasons.add('locked');}catch{}
      add('lock-screen',()=>pause('locked'));add('unlock-screen',()=>resume('locked'));
    }
    add('suspend',()=>pause('suspended'));add('resume',()=>resume('suspended'));
    const notify=(kind,message)=>send({kind,sessionId:id,framesWritten:session.framesWritten,
      progressPercent:null,elapsedMs:this.now()-Date.parse(startedAt),message,outputRoot});
    notify('started','定时截图已开始。');
    let failure=null;
    try{
      while(!signal?.aborted){
        if(this.pausedReasons.size){await abortableDelay(250,signal);continue;}
        let sources;
        try{sources=await this.desktopCapturer.getSources({types:['screen'],thumbnailSize:{
          width:Math.max(1,display.width),height:Math.max(1,display.height)}});}
        catch(error){
          if(this.platform==='darwin')throw Error('读取屏幕失败。请检查 HALO 的系统录屏权限后重试：'+error.message);
          throw error;
        }
        const source=sources.find(item=>String(item.display_id)===display.id);
        if(!source||!source.thumbnail||source.thumbnail.isEmpty())throw Error('无法读取所选显示器画面。请检查系统录屏权限并重试。');
        const image=source.thumbnail.toPNG();
        if(!image.subarray(0,8).equals(PNG_START)||!image.subarray(-12).equals(PNG_END))throw Error('系统返回的屏幕图像无效。');
        const capturedAt=this.now(),date=dateKey(capturedAt),dayDir=path.join(outputRoot,date);
        await fs.mkdir(dayDir,{recursive:true});
        const dayStat=await fs.lstat(dayDir);
        if(!dayStat.isDirectory()||dayStat.isSymbolicLink()||await fs.realpath(dayDir)!==dayDir)
          throw Error('当日截图目录路径无效，请检查保存位置。');
        const file=path.join(dayDir,frameName(capturedAt,id));
        await fs.writeFile(file,image,{flag:'wx'});
        session.framesWritten++;session.lastCapturedAt=new Date(capturedAt).toISOString();
        await this.writeSession(session);
        notify('progress',`已保存 ${session.framesWritten} 张截图。`);
        await abortableDelay(request.intervalSeconds*1000,signal);
      }
    }catch(error){if(!signal?.aborted)failure=error;}
    finally{
      for(const [name,fn] of events)this.powerMonitor?.removeListener?.(name,fn);
      this.pausedReasons.clear();
      session.finishedAt=new Date(this.now()).toISOString();
      session.status=signal?.aborted?'cancelled':failure?'failed':'completed';
      session.error=failure?.message||null;
      try{await this.writeSession(session);}catch(error){session.historyError=error.message;}
      notify(session.status,failure?`采集失败：${failure.message}`:session.status==='cancelled'?'采集已停止。':'采集已结束。');
    }
    return session;
  }
  async imageAllowed(filePath){
    const candidate=await fs.realpath(filePath).catch(()=>null);if(!candidate||candidate!==path.resolve(filePath))return false;
    const name=path.basename(candidate),match=FRAME_RE.exec(name);if(!match)return false;
    const date=`${match[1]}-${match[2]}-${match[3]}`,dayDir=path.dirname(candidate),root=path.dirname(dayDir);
    if(!isValidDate(date)||path.basename(dayDir)!==date||!(await this.registeredRoots()).includes(root))return false;
    return Boolean(await validPng(candidate));
  }
  async exportDay(outputRoot,date,fps,signal,send=()=>{}){
    if(!isValidDate(date))throw Error('截图日期无效。');
    if(!FPS_VALUES.includes(fps))throw Error('视频帧率无效。');
    const root=await this.root(outputRoot);
    if(!(await this.registeredRoots()).includes(root))throw Error('此目录尚未登记为 HALO 屏幕截图目录。');
    const dayDir=path.join(root,date),frames=await this.frameFiles(root,date);
    if(!frames.length)throw Error('此日期没有可导出的视频截图。');
    const ffmpeg=await this.encoder(signal),listPath=path.join(dayDir,'.halo-'+crypto.randomUUID()+'.ffconcat');
    let outputPath=null;
    for(let i=0;i<1000;i++){
      const name=`HALO-屏幕记录-${date}${i?'_'+String(i+1).padStart(3,'0'):''}.mp4`,candidate=path.join(dayDir,name);
      try{await fs.lstat(candidate);}catch(error){if(error.code==='ENOENT'){outputPath=candidate;break;}throw error;}
    }
    if(!outputPath)throw Error('同名视频文件过多，无法导出。');
    const quote=value=>"'"+value.replace(/\\/g,'/').replace(/'/g,"'\\''")+"'";
    const duration=(1/fps).toFixed(6);
    const lines=frames.map(frame=>`file ${quote(frame.path)}\nduration ${duration}\n`).join('');
    const first=frames[0],width=first.width+(first.width%2),height=first.height+(first.height%2);
    const filter=`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`;
    let last=0;
    try{
      await fs.writeFile(listPath,'ffconcat version 1.0\n'+lines,{flag:'wx'});
      send({kind:'progress',framesWritten:0,progressPercent:0,message:'正在编码每日截图视频。'});
      await this.execBinary(ffmpeg,['-hide_banner','-nostdin','-n','-v','warning','-f','concat','-safe','0','-i',listPath,
        '-vf',filter,'-fps_mode','cfr','-r',String(fps),'-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p',
        '-movflags','+faststart','-progress','pipe:1','-nostats',outputPath],signal,0,line=>{
        if(line.startsWith('frame=')){
          const done=Number(line.slice(6));if(Number.isFinite(done)){
            const now=this.now();if(now-last>200){last=now;send({kind:'progress',framesWritten:done,
              progressPercent:Math.min(99,Math.round(done/frames.length*100)),message:`正在导出 ${done}/${frames.length} 张截图。`});}
          }
        }
      });
      const stat=await fs.lstat(outputPath);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size<64)throw Error('FFmpeg 未生成有效 MP4 视频。');
      send({kind:'completed',framesWritten:frames.length,progressPercent:100,message:'每日视频已导出。'});
      return {path:outputPath,frames:frames.length,fps};
    }catch(error){if(outputPath)await fs.rm(outputPath,{force:true}).catch(()=>{});throw error;}
    finally{await fs.rm(listPath,{force:true}).catch(()=>{});}
  }
}
module.exports={ScreenCapture,isValidDate,validateCaptureRequest,FPS_VALUES};
