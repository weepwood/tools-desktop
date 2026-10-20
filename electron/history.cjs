'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const logger=require('./logger.cjs');
class History {
  constructor(directory){this.directory=directory;this.historyPath=path.join(directory,'history.json');this.journals=path.join(directory,'journals');this.restores=path.join(directory,'restores');this.warnings=[];}
  async ensure(){await fs.mkdir(this.directory,{recursive:true});await fs.mkdir(this.journals,{recursive:true});await fs.mkdir(this.restores,{recursive:true});}
  note(message,level='warn'){this.warnings.push(message);logger[level](message);}
  async atomicWrite(location,content){
    await this.ensure();
    const temp=location+'.'+crypto.randomUUID()+'.tmp';
    const file=await fs.open(temp,'wx');
    try{await file.writeFile(content);await file.sync();}finally{await file.close();}
    try{await fs.rename(temp,location);}catch(error){await fs.rm(temp,{force:true});throw error;}
  }
  async readBackup(){
    let data;
    try{data=await fs.readFile(this.historyPath+'.bak','utf8');}catch{return null;}
    try{
      const parsed=JSON.parse(data);
      // An empty backup is no recovery at all: prefer the "no backup" branch so
      // the damaged file is preserved for inspection instead of being dropped.
      return Array.isArray(parsed)&&parsed.length?parsed:null;
    }catch{return null;}
  }
  async preserveCorrupt(){
    const name='history.corrupt-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
    try{await fs.rename(this.historyPath,path.join(this.directory,name));return name;}
    catch{return null;}
  }
  async base(){
    let data;
    try{data=await fs.readFile(this.historyPath,'utf8');}catch(e){if(e.code==='ENOENT')return [];throw e;}
    try{
      if(data.trim()){
        const parsed=JSON.parse(data);
        if(Array.isArray(parsed))return parsed;
      }
    }catch{}
    const backup=await this.readBackup();
    if(backup){this.note('history.json 损坏，已从 history.json.bak 恢复','error');return backup;}
    // Never throw here: saveSession() reads through base() too, and a damaged
    // index used to lock the app out of both reading and writing history.
    const preserved=await this.preserveCorrupt();
    this.note(preserved
      ? 'history.json 损坏且没有可用备份，原文件已另存为 '+preserved+'，历史记录已重新建立'
      : 'history.json 损坏且无法另存，历史记录已重新建立','error');
    return [];
  }
  async load(){
    this.warnings=[];
    const sessions=await this.base();await this.ensure();
    for(const item of await fs.readdir(this.journals,{withFileTypes:true})){
      if(!item.isFile()||!item.name.endsWith('.jsonl'))continue;
      const id=item.name.slice(0,-6);
      if(sessions.some(x=>x.id===id))continue;
      try {
      const data=await fs.readFile(path.join(this.journals,item.name),'utf8');
      let session=null,files=new Map(),complete=false,truncated=false;
      const lines=data.split('\n');
      for(let index=0;index<lines.length;index++){
        const line=lines[index];
        if(!line)continue;
        let event;
        try{event=JSON.parse(line);}
        catch(error){
          // Power loss can leave the last JSONL record partially written.
          // Preserve all earlier synced entries; never silently ignore
          // corruption in the middle of a journal.
          if(index===lines.length-1&&!data.endsWith('\n')){truncated=true;break;}
          throw Error('任务日志 '+item.name+' 第 '+(index+1)+' 行损坏：'+error.message);
        }
        if(event.type==='start')session=event.session;
        if(event.type==='prepared'||event.type==='completed'){
          if(typeof event.file?.path!=='string')throw Error('任务日志条目缺少文件路径：'+item.name);
          files.set(event.file.path,event.file);
        }
        if(event.type==='end') {session=event.session;complete=true;}
      }
      if(session){
        session.files=[...files.values()];
        session.interrupted=!complete||truncated;
        session.taskError=session.interrupted
          ? '任务中断或日志最后一行未完整写入；记录已保留，恢复时会校验文件'
          : null;
        sessions.push(session);
      }
      }catch(error){
        const warning='恢复日志 '+item.name+' 格式异常，原始文件已保留：'+error.message;
        this.note(warning);
      }
    }
    return sessions.sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  }
  async getSession(id){const session=(await this.load()).find(x=>x.id===id);if(!session)throw Error('未找到对应的历史记录');return session;}
  async summaries(){return (await this.load()).map(x=>({...x,files:[],restoreRuns:(x.restoreRuns||[]).map(r=>({...r,files:[]}))}));}
  async openJournal(location,first){
    await this.ensure();
    const handle=await fs.open(location,'wx');
    try{await handle.writeFile(JSON.stringify(first)+'\n');await handle.sync();}finally{await handle.close();}
    return async event=>{
      const file=await fs.open(location,'a');
      try{await file.writeFile(JSON.stringify(event)+'\n');await file.sync();}finally{await file.close();}
    };
  }
  async startJournal(session){return this.openJournal(path.join(this.journals,session.id+'.jsonl'),{type:'start',session});}
  async startRestoreLog(runId,payload){
    return this.openJournal(path.join(this.restores,runId+'.jsonl'),
      {type:'start',runId,sessionId:payload.sessionId,record:payload.record});
  }
  async finishRestoreLog(runId){await fs.rm(path.join(this.restores,runId+'.jsonl'),{force:true});}
  async recoverRestoreRuns(){
    await this.ensure();
    const sessions=new Map((await this.load()).map(x=>[x.id,x]));
    const warnings=[],recovered=[];
    const report=message=>{warnings.push(message);logger.warn(message);};
    for(const item of await fs.readdir(this.restores,{withFileTypes:true})){
      if(!item.isFile()||!item.name.endsWith('.jsonl'))continue;
      const file=path.join(this.restores,item.name);
      let data;
      try{data=await fs.readFile(file,'utf8');}
      catch(error){report('恢复日志 '+item.name+' 无法读取，原始文件已保留：'+error.message);continue;}
      const lines=data.split('\n');
      const files=new Map();
      let start=null,broken=null;
      for(let index=0;index<lines.length;index++){
        const line=lines[index];
        if(!line)continue;
        let event;
        try{event=JSON.parse(line);}
        catch(error){
          // Same tolerance as load(): power loss only truncates the last line.
          if(index===lines.length-1&&!data.endsWith('\n'))break;
          broken=error.message;break;
        }
        if(event.type==='start'){start=event;continue;}
        if(event.type==='prepared'){
          if(typeof event.path!=='string'){broken='恢复日志条目缺少文件路径';break;}
          // Prepared means the truncate may have started but never reported back.
          if(!files.has(event.path))
            files.set(event.path,{path:event.path,relativePath:'',status:'failed',interrupted:true,
              error:'恢复任务中断，该文件可能已被截断，请在历史页重新核验'});
          continue;
        }
        if(event.type==='completed'){
          if(typeof event.file?.path!=='string'){broken='恢复日志条目缺少文件路径';break;}
          files.set(event.file.path,event.file);
        }
      }
      if(broken){report('恢复日志 '+item.name+' 格式异常，原始文件已保留：'+broken);continue;}
      if(!start||typeof start.sessionId!=='string'||!start.record||typeof start.record!=='object'){
        report('恢复日志 '+item.name+' 缺少起始记录，原始文件已保留');continue;
      }
      const session=sessions.get(start.sessionId);
      if(!session){report('恢复日志 '+item.name+' 找不到对应的历史会话，原始文件已保留');continue;}
      session.restoreRuns=session.restoreRuns||[];
      if(session.restoreRuns.some(x=>x&&x.id===start.record.id)){
        // The run was saved last time and only the log removal failed.
        await fs.rm(file,{force:true});continue;
      }
      const record={...start.record};
      record.files=[...files.values()];
      record.success=record.files.filter(x=>x.status==='success').length;
      record.failed=record.files.filter(x=>x.status==='failed').length;
      record.skipped=record.files.filter(x=>x.status==='skipped').length;
      record.total=record.files.length;
      record.interrupted=true;
      record.taskError='恢复任务中断：以下文件可能已被截断，请在历史页重新核验';
      record.finishedAt=record.finishedAt||new Date().toISOString();
      session.restoreRuns.push(record);
      try{await this.saveSession(session);}
      catch(error){report('恢复日志 '+item.name+' 无法写回历史记录：'+error.message);continue;}
      await fs.rm(file,{force:true});
      recovered.push(record.id);
    }
    this.warnings.push(...warnings);
    return recovered;
  }
  async saveSession(session){
    const current=(await this.load()).filter(x=>x.id!==session.id);
    current.unshift(session);
    try{await fs.copyFile(this.historyPath,this.historyPath+'.bak');}catch(e){if(e.code!=='ENOENT')throw e;}
    await this.atomicWrite(this.historyPath,JSON.stringify(current,null,2));
    await fs.rm(path.join(this.journals,session.id+'.jsonl'),{force:true});
  }
  async clear(){
    await this.ensure();await fs.rm(this.historyPath,{force:true});
    for(const name of await fs.readdir(this.journals)){if(name.endsWith('.jsonl'))await fs.rm(path.join(this.journals,name),{force:true});}
  }
  async exportCsv(id,destination){
    const session=await this.getSession(id);
    const cells=['path','relativePath','status','error','beforeSize','afterSize','beforeSha256','afterSha256','appendedHex','verificationMode'];
    const escape=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
    const csv='\ufeff'+cells.join(',')+'\r\n'+session.files.map(f=>cells.map(k=>escape(f[k])).join(',')).join('\r\n');
    await fs.writeFile(destination,csv,'utf8');
  }
}
module.exports={History};
