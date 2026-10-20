'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
function availableBinary(name){
  const suffix=process.platform==='win32'?'.exe':'';
  const candidates=[];
  if(process.env.XIMA_VIDEO_TOOLS)candidates.push(path.join(process.env.XIMA_VIDEO_TOOLS,name+suffix));
  try {const moduleName=name==='ffmpeg'?'ffmpeg-static':'ffprobe-static';const resolved=require(moduleName);candidates.push(typeof resolved==='string'?resolved:resolved.path);} catch {}
  const search=process.env.PATH?.split(path.delimiter)||[];
  for(const directory of search)candidates.push(path.join(directory,name+suffix));
  return candidates.filter(Boolean).map(p=>p.replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep));
}
async function ordinaryFile(p) {try{const st=await fs.lstat(p);return st.isFile()&&!st.isSymbolicLink();}catch{return false;}}
async function resolveBinaries(){
  const chosen={};
  for (const key of ['ffmpeg','ffprobe']){
    const candidates=availableBinary(key);
    chosen[key]=null;
    for(const candidate of candidates){if(await ordinaryFile(candidate)){chosen[key]=candidate;break;}}
    if(!chosen[key])throw Error('未找到 '+key+'，请通过 XIMA_VIDEO_TOOLS 配置目录或安装完整视频工具。');
  }
  return chosen;
}
function execBinary(file,args,signal,timeout=60000,onLine=()=>{},onLog=()=>{}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(Error('任务已停止。'));
    const child=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});
    let output='',err='',pending='',timedOut=false,settled=false;
    const limit=(s,max)=>s.length>max?s.slice(-max):s;
    const abort=()=>child.kill();
    const timer=timeout?setTimeout(()=>{timedOut=true;child.kill();},timeout):null;
    const cleanup=()=>{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    const finish=(error,result)=>{
      if(settled)return;
      settled=true;cleanup();
      if(error)reject(error);else resolve(result);
    };
    signal?.addEventListener('abort',abort,{once:true});
    child.on('error',error=>finish(error));
    child.stdout.on('data',chunk=>{
      const value=chunk.toString('utf8');
      output=limit(output+value,1024*1024);
      pending=limit(pending+value,1024*1024);
      const lines=pending.split(/\r?\n/);pending=lines.pop()||'';
      for(const line of lines)onLine(line);
    });
    child.stderr.on('data',chunk=>{err=limit(err+chunk.toString('utf8'),16384);onLog(chunk.toString('utf8'));});
    child.on('close',code=>{
      if(pending)onLine(pending);
      if(signal?.aborted)return finish(Error('任务已停止。'));
      if(timedOut)return finish(Error('视频工具执行超时，子进程已停止。'));
      if(code!==0)return finish(Error('视频工具退出代码 '+code+': '+err.slice(-2000)));
      finish(null,{output,err});
    });
  });
}
class Video {
  constructor(userData){this.directory=path.join(userData,'video-tasks');this.userData=userData;}
  async ensure(){await fs.mkdir(this.directory,{recursive:true});}
  recordPath(id){if(!/^[\da-f-]{36}$/i.test(id))throw Error('任务编号无效');return path.join(this.directory,id+'.json');}
  async save(task){
    await this.ensure();const output=this.recordPath(task.id);
    const temp=output+'.'+crypto.randomUUID()+'.tmp';
    const handle=await fs.open(temp,'wx');
    try{await handle.writeFile(JSON.stringify(task,null,2));await handle.sync();}finally{await handle.close();}
    try{await fs.rename(temp,output);}catch(e){await fs.rm(temp,{force:true});throw e;}
  }
  async get(id){return JSON.parse(await fs.readFile(this.recordPath(id),'utf8'));}
  async list(){
    await this.ensure();const tasks=[];
    for(const entry of await fs.readdir(this.directory,{withFileTypes:true})){
      if(!entry.isFile()||!entry.name.endsWith('.json'))continue;
      tasks.push(await this.get(entry.name.slice(0,-5)));
    }
    return tasks.sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  }
  async recover(){
    for(const task of await this.list()){
      if(task.status==='running'){task.status='interrupted';task.finishedAt=new Date().toISOString();task.error='程序意外退出，任务已中断';await this.save(task);}
    }
  }
  async toolStatus(signal){
    const {ffmpeg,ffprobe}=await resolveBinaries();
    const a=await execBinary(ffmpeg,['-version'],signal,60000);
    const b=await execBinary(ffprobe,['-version'],signal,60000);
    return {ffmpegPath:ffmpeg,ffprobePath:ffprobe,ffmpegVersion:a.output.split('\n')[0],ffprobeVersion:b.output.split('\n')[0],source:'本地 FFmpeg'};
  }
  async probe(videoPath,signal){
    if(typeof videoPath!=='string'||!videoPath)throw Error('请输入视频路径');
    const source=path.resolve(videoPath);
    if(!await ordinaryFile(source))throw Error('视频文件不存在或不是普通文件');
    const tools=await resolveBinaries();
    const data=await execBinary(tools.ffprobe,['-v','error','-select_streams','v:0','-show_format','-show_streams','-of','json',source],signal,60000);
    const parsed=JSON.parse(data.output);
    const stream=parsed.streams?.[0];
    if(!stream?.width||!stream?.height)throw Error('无法读取视频画面或分辨率');
    let width=Number(stream.width),height=Number(stream.height);
    const rotation=Number(stream.side_data_list?.find(x=>x.rotation!==undefined)?.rotation??stream.tags?.rotate??0);
    if(Math.abs(rotation)%180===90)[width,height]=[height,width];
    const d=Number(parsed.format?.duration??stream.duration);
    return {path:source,name:path.basename(source),durationSeconds:Number.isFinite(d)&&d>0?d:null,width,height};
  }
  async suggest(videoPath,outputParent){
    const directory=outputParent?path.resolve(outputParent):path.dirname(path.resolve(videoPath));
    const info=await fs.lstat(directory);
    if(!info.isDirectory()||info.isSymbolicLink())throw Error('保存位置不是普通文件夹');
    const basename=path.parse(videoPath).name;
    if(!basename)throw Error('视频名称无效');
    for(let i=1;i<100000;i++){
      const name=i===1?basename:basename+'_截图_'+String(i).padStart(3,'0');
      const target=path.join(directory,name);
      try{await fs.lstat(target);}catch(e){if(e.code==='ENOENT')return target;throw e;}
    }
    throw Error('同名截图文件夹过多');
  }
  async allocate(videoPath,outputParent){
    for(let i=0;i<1000;i++){const dest=await this.suggest(videoPath,outputParent);
      try{await fs.mkdir(dest);return await fs.realpath(dest);}catch(e){if(e.code!=='EEXIST')throw e;}
    }
    throw Error('无法创建新的截图目录');
  }
  async frameFiles(dir){
    const result=[];
    for(const item of await fs.readdir(dir,{withFileTypes:true})){
      const match=/^keyframes_(\d{3,})\.png$/.exec(item.name);
      if(!item.isFile()||!match)continue;
      const p=path.join(dir,item.name);
      const info=await fs.lstat(p);
      if(info.size<45||info.isSymbolicLink())continue;
      const fh=await fs.open(p,'r');
      try {
        const head=Buffer.alloc(8),end=Buffer.alloc(12);
        await fh.read(head,0,8,0);await fh.read(end,0,12,info.size-12);
        if(!head.equals(Buffer.from('89504e470d0a1a0a','hex'))||!end.equals(Buffer.from('0000000049454e44ae426082','hex')))continue;
      }finally{await fh.close();}
      result.push({number:Number(match[1]),name:item.name,path:p,thumbnailPath:p});
    }
    result.sort((a,b)=>a.number-b.number);return result;
  }
  async page(id,page,pageSize){
    const task=await this.get(id);
    const dir=await fs.realpath(task.outputDir);
    if(dir!==task.outputDir||!(await fs.lstat(dir)).isDirectory())throw Error('截图输出目录已更改');
    const frames=await this.frameFiles(dir),size=Math.min(24,Math.max(1,Number(pageSize)||24));
    const index=Math.min(Math.max(0,Number(page)||0),Math.max(0,Math.ceil(frames.length/size)-1));
    return {frames:frames.slice(index*size,(index+1)*size),total:frames.length,page:index,pageSize:size};
  }
  async imageAllowed(filePath){
    if(!/^keyframes_\d{3,}\.png$/.test(path.basename(filePath)))return false;
    const candidate=await fs.realpath(filePath).catch(()=>null);
    if(!candidate||candidate!==path.resolve(filePath))return false;
    for(const task of await this.list()){
      if(path.dirname(candidate)!==task.outputDir)continue;
      const stat=await fs.lstat(candidate).catch(()=>null);
      if(!stat?.isFile()||stat.isSymbolicLink()||stat.size<45)return false;
      const handle=await fs.open(candidate,'r');
      try{
        const signature=Buffer.alloc(8),ending=Buffer.alloc(12);
        await handle.read(signature,0,8,0);
        await handle.read(ending,0,12,stat.size-12);
        return signature.equals(Buffer.from('89504e470d0a1a0a','hex')) &&
          ending.equals(Buffer.from('0000000049454e44ae426082','hex'));
      }finally{await handle.close();}
    }
    return false;
  }
  async extract(request,signal,send){
    const interval=Number(request.intervalSeconds);
    if(!Number.isInteger(interval)||interval<1||interval>86400)throw Error('截图间隔必须为 1–86400 整数秒');
    const tools=await this.toolStatus(signal),video=await this.probe(request.videoPath,signal);
    if(signal.aborted)throw Error('任务已停止');
    const outputDir=await this.allocate(video.path,request.outputParent);
    const task={schemaVersion:1,id:crypto.randomUUID(),video,intervalSeconds:interval,outputDir,startedAt:new Date().toISOString(),finishedAt:null,status:'running',framesWritten:0,elapsedMs:0,ffmpegVersion:tools.ffmpegVersion,error:null,log:'',historyError:null};
    try{await this.save(task);}catch(e){await fs.rmdir(outputDir).catch(()=>{});throw e;}
    const started=Date.now();let frame=0,seconds=null,log='';
    const event=kind=>send({taskId:task.id,kind,framesWritten:frame,progressPercent:seconds!==null&&video.durationSeconds?Math.max(0,Math.min(99,100*seconds/video.durationSeconds)):null,elapsedMs:Date.now()-started,message:null,outputDir});
    event('started');
    const pattern=path.join(outputDir,'keyframes_%03d.png').replace(/%/g,'%%').replace('%%03d','%03d');
    try {
      let last=0;
      await execBinary(tools.ffmpeg,['-hide_banner','-nostdin','-n','-nostats','-progress','pipe:1','-i',video.path,'-map','0:v:0','-an','-vf','fps=1/'+interval,'-start_number','1','-atomic_writing','1',pattern],signal,0,line=>{
        const [key,value]=line.split('=');
        if(key==='frame')frame=Number(value)||frame;
        if(key==='out_time_us')seconds=Number(value)/1000000;
        if(Date.now()-last>250){event('progress');last=Date.now();}
      },text=>{log=(log+text).slice(-16384)});
      task.status='completed';
    } catch(e){
      task.status=signal.aborted?'cancelled':'failed';
      task.error=signal.aborted?null:e.message;
      if(signal.aborted)event('stopping');
    }
    task.log=log;task.elapsedMs=Date.now()-started;task.finishedAt=new Date().toISOString();
    try{task.framesWritten=(await this.frameFiles(outputDir)).length;}catch(e){task.status='failed';task.error=e.message;}
    if(task.status==='completed'&&!task.framesWritten){task.status='failed';task.error='未生成截图，请尝试缩短间隔';}
    try{await this.save(task);}catch(e){task.historyError=e.message;}
    event(task.status==='completed'?'completed':task.status==='cancelled'?'cancelled':'failed');
    return task;
  }
}
module.exports={Video,resolveBinaries,execBinary};
