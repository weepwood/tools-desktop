'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {resolveBinaries,execBinary}=require('./video.cjs');

const GB=1000**3;
const MAX_ATTEMPTS=9;
function limitBytes(gb){
  if(typeof gb!=='number'||!Number.isFinite(gb)||gb<0.00001||gb>10000)
    throw Error('分片上限必须介于 0.00001 GB 与 10000 GB 之间');
  const bytes=Math.floor(gb*GB);
  if(!Number.isSafeInteger(bytes))throw Error('分片上限超过安全整数范围');
  return bytes;
}
function outputFormat(source){
  switch(path.extname(source).toLowerCase()){
    case '.mp4':case '.m4v':return {extension:'mp4',muxer:'mp4'};
    case '.mkv':return {extension:'mkv',muxer:'matroska'};
    case '.mov':return {extension:'mov',muxer:'mov'};
    case '.webm':return {extension:'webm',muxer:'webm'};
    default:return {extension:'mkv',muxer:'matroska'};
  }
}
function planDuration(duration,sourceBytes,maxBytes){
  if(!Number.isFinite(duration)||duration<=0)throw Error('无法读取视频时长，不能安全按大小切分');
  return Math.max(0.1,duration*maxBytes/sourceBytes*0.72);
}
class SplitService {
  constructor(userData,video){
    this.directory=path.join(userData,'split-tasks');
    this.video=video;
  }
  recordPath(id){
    if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('分片任务编号无效');
    return path.join(this.directory,id+'.json');
  }
  async save(record){
    await fs.mkdir(this.directory,{recursive:true});
    const target=this.recordPath(record.id),tmp=target+'.'+crypto.randomUUID()+'.tmp';
    const handle=await fs.open(tmp,'wx');
    try{await handle.writeFile(JSON.stringify(record,null,2));await handle.sync();}
    finally{await handle.close();}
    try{await fs.rename(tmp,target);}
    catch(error){await fs.rm(tmp,{force:true});throw error;}
  }
  async get(id){return JSON.parse(await fs.readFile(this.recordPath(id),'utf8'));}
  async list(){
    await fs.mkdir(this.directory,{recursive:true});
    const rows=[];
    for(const item of await fs.readdir(this.directory,{withFileTypes:true})){
      if(!item.isFile()||!item.name.endsWith('.json'))continue;
      try{
        const data=await this.get(item.name.slice(0,-5));
        if(data?.id && data?.videoPath && data?.status)rows.push(data);
      }catch(error){console.warn('损坏的切分记录已保留：',item.name,error.message);}
    }
    return rows.sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  }
  async recover(){
    for(const row of await this.list()){
      if(row.status==='running'){
        row.status='interrupted';row.finishedAt=new Date().toISOString();
        row.error='程序上次意外退出。临时文件保留在输出目录的 attempt-* 文件夹内，请确认后手动清理。';
        await this.save(row);
      }
    }
  }
  async allocate(videoPath,outputParent){
    const parent=outputParent?path.resolve(outputParent):path.dirname(videoPath);
    const info=await fs.lstat(parent);
    if(!info.isDirectory()||info.isSymbolicLink())throw Error('分片输出位置必须是普通文件夹');
    const original=path.parse(videoPath).name;
    for(let n=1;n<=1000;n++){
      const name=original+'_分片'+(n===1?'':'_'+String(n).padStart(3,'0'));
      const dir=path.join(parent,name);
      try{await fs.mkdir(dir);return await fs.realpath(dir);}
      catch(error){if(error.code!=='EEXIST')throw error;}
    }
    throw Error('同名分片目录数量过多');
  }
  async split(request,signal,send){
    const maxSizeBytes=limitBytes(request.maxSizeGb);
    if(typeof request.videoPath!=='string'||!path.isAbsolute(request.videoPath))
      throw Error('请选择有效的绝对视频路径');
    const input=path.resolve(request.videoPath);
    const info=await fs.lstat(input);
    if(!info.isFile()||info.isSymbolicLink())throw Error('输入必须是普通视频文件，不能是符号链接');
    const original={size:info.size,mtimeMs:info.mtimeMs};
    const video=await this.video.probe(input,signal);
    const startedAt=new Date().toISOString(),id=crypto.randomUUID();
    const skipped=info.size<=maxSizeBytes;
    const record={schemaVersion:1,id,videoPath:input,videoName:path.basename(input),
      maxSizeGb:request.maxSizeGb,maxSizeBytes,sourceBytes:info.size,
      outputDir:null,status:skipped?'skipped':'running',parts:[],attempts:0,
      startedAt,finishedAt:skipped?startedAt:null,error:null,historyError:null};
    if(skipped){
      await this.save(record);
      send({kind:'skipped',progressPercent:100,attempt:0,partsWritten:0,message:'源视频未超过切分阈值'});
      return record;
    }
    if(!video.durationSeconds)throw Error('无法读取视频时长，不能安全按大小切分');
    if(info.size/maxSizeBytes>10000)
      throw Error('预计分片超过 10000 个，请调大分片阈值');
    if(signal?.aborted)throw Error('任务已停止。');
    const tools=await resolveBinaries();
    const dir=await this.allocate(input,request.outputParent);
    record.outputDir=dir;
    try{await this.save(record);}
    catch(error){await fs.rmdir(dir).catch(()=>{});throw error;}
    const format=outputFormat(input);
    let segmentSeconds=planDuration(video.durationSeconds,info.size,maxSizeBytes);
    let lastProgress=0;
    send({kind:'started',progressPercent:0,attempt:0,partsWritten:0,message:'开始无损分片'});
    try{
      for(let attempt=1;attempt<=MAX_ATTEMPTS;attempt++){
        if(signal?.aborted)throw Error('任务已停止。');
        record.attempts=attempt;
        const attemptDir=path.join(dir,'attempt-'+String(attempt).padStart(2,'0'));
        await fs.mkdir(attemptDir);
        // Escape percent signs in the *directory* only. Replacing the first
        // "%%04d" in a joined string would corrupt a directory named "%04d".
        const pattern=path.join(attemptDir.replace(/%/g,'%%'),'part_%04d.'+format.extension);
        const args=['-hide_banner','-nostdin','-y','-v','warning','-stats_period','0.25',
          '-progress','pipe:1','-i',input,'-map','0','-c','copy',
          '-f','segment','-segment_format',format.muxer,
          '-segment_time',String(segmentSeconds),'-reset_timestamps','1',pattern];
        let pendingLog='',clock=0;
        try{
          await execBinary(tools.ffmpeg,args,signal,0,line=>{
            const match=/^out_time_(?:us|ms)=(\d+)$/.exec(line);
            if(match){
              clock=Number(match[1])/1e6;
              const percent=Math.min(98,Math.max(0,clock/video.durationSeconds*100));
              if(percent-lastProgress>=1){
                lastProgress=percent;
                send({kind:'progress',progressPercent:percent,attempt,partsWritten:0,
                  message:'第 '+attempt+' 次切分（正在校验实际大小）'});
              }
            }
          },chunk=>{pendingLog=(pendingLog+chunk).slice(-3000);});
          if(signal?.aborted)throw Error('任务已停止。');
          const entries=(await fs.readdir(attemptDir)).filter(name=>
            /^part_\d{4,}\./.test(name)&&name.endsWith('.'+format.extension)).sort();
          if(!entries.length)throw Error('FFmpeg 未生成任何分片');
          if(entries.length>10000)throw Error('分片数量超过 10000 个');
          const parts=[];
          for(const name of entries){
            const partPath=path.join(attemptDir,name);
            const stat=await fs.lstat(partPath);
            if(!stat.isFile()||stat.isSymbolicLink()||stat.size===0)
              throw Error('分片文件损坏：'+name);
            parts.push({name,path:path.join(dir,name),sizeBytes:stat.size});
          }
          const tooLarge=parts.some(x=>x.sizeBytes>maxSizeBytes)||parts.length<2;
          if(tooLarge){
            await fs.rm(attemptDir,{recursive:true,force:true});
            if(attempt===MAX_ATTEMPTS||segmentSeconds<0.2)
              throw Error('关键帧间隔过长，无法在不重新编码的情况下生成至少两个且每个均不超限的分片。原始视频未修改。');
            segmentSeconds/=2;
            lastProgress=0;
            send({kind:'retry',progressPercent:0,attempt,partsWritten:0,
              message:'分片超限或仅生成一个文件，正在缩短切分时间重试'});
            continue;
          }
          const before=await fs.stat(input);
          if(before.size!==original.size||before.mtimeMs!==original.mtimeMs)
            throw Error('切分期间源文件发生变化，已拒绝确认结果');
          const finalized=[];
          try{
            for(let index=0;index<parts.length;index++){
              if(signal?.aborted)throw Error('任务已停止。');
              await fs.rename(path.join(attemptDir,parts[index].name),parts[index].path);
              finalized.push(parts[index].path);
            }
          }catch(error){
            // The output directory was exclusively created for this job.
            // Roll back any names already moved into the final directory
            // if the remaining moves fail or the user cancels during commit.
            const removal=await Promise.allSettled(finalized.map(name=>fs.rm(name,{force:true})));
            if(removal.some(item=>item.status==='rejected'))
              throw Error('部分已完成分片清理失败，请检查输出目录。原错误：'+error.message);
            throw error;
          }
          await fs.rmdir(attemptDir);
          record.parts=parts;record.status='completed';
          send({kind:'completed',progressPercent:100,attempt,
            partsWritten:parts.length,message:'已校验全部分片均不超过上限'});
          break;
        }catch(error){
          // Leave only positively confirmed output files in the final folder.
          // If cancellation or a normal process error occurs, delete scratch
          // attempts only (the source is never modified).
          await fs.rm(attemptDir,{recursive:true,force:true}).catch(()=>{});
          throw error;
        }
      }
    }catch(error){
      record.status=signal?.aborted?'cancelled':'failed';
      record.error=error.message;
      send({kind:record.status,progressPercent:0,attempt:record.attempts,
        partsWritten:record.parts.length,message:error.message});
    }finally{
      record.finishedAt=new Date().toISOString();
      try{await this.save(record);}
      catch(error){record.historyError=error.message;}
    }
    return record;
  }
}
module.exports={SplitService,limitBytes,outputFormat,planDuration,GB};
