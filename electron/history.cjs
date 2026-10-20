'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
class History {
  constructor(directory){this.directory=directory;this.historyPath=path.join(directory,'history.json');this.journals=path.join(directory,'journals');}
  async ensure(){await fs.mkdir(this.directory,{recursive:true});await fs.mkdir(this.journals,{recursive:true});}
  async atomicWrite(location,content){
    await this.ensure();
    const temp=location+'.'+crypto.randomUUID()+'.tmp';
    const file=await fs.open(temp,'wx');
    try{await file.writeFile(content);await file.sync();}finally{await file.close();}
    try{await fs.rename(temp,location);}catch(error){await fs.rm(temp,{force:true});throw error;}
  }
  async base(){
    let data;
    try{data=await fs.readFile(this.historyPath,'utf8');}catch(e){if(e.code==='ENOENT')return [];throw e;}
    if(!data.trim())throw Error('历史记录为空，已保留原文件。');
    const parsed=JSON.parse(data);
    if(!Array.isArray(parsed))throw Error('历史记录格式无效，已保留原文件。');
    return parsed;
  }
  async load(){
    const sessions=await this.base();await this.ensure();
    for(const item of await fs.readdir(this.journals,{withFileTypes:true})){
      if(!item.isFile()||!item.name.endsWith('.jsonl'))continue;
      const id=item.name.slice(0,-6);
      if(sessions.some(x=>x.id===id))continue;
      const data=await fs.readFile(path.join(this.journals,item.name),'utf8');
      let session=null,files=new Map(),complete=false;
      for(const line of data.split('\n').filter(Boolean)){
        const event=JSON.parse(line);
        if(event.type==='start')session=event.session;
        if(event.type==='prepared'||event.type==='completed')files.set(event.file.path,event.file);
        if(event.type==='end') {session=event.session;complete=true;}
      }
      if(session){session.files=[...files.values()];session.interrupted=!complete;session.taskError=complete?null:'任务异常中断，待校验条目可能需要恢复';sessions.push(session);}
    }
    return sessions.sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  }
  async getSession(id){const session=(await this.load()).find(x=>x.id===id);if(!session)throw Error('未找到对应的历史记录');return session;}
  async summaries(){return (await this.load()).map(x=>({...x,files:[],restoreRuns:(x.restoreRuns||[]).map(r=>({...r,files:[]}))}));}
  async startJournal(session){
    await this.ensure();
    const name=path.join(this.journals,session.id+'.jsonl');
    const handle=await fs.open(name,'wx');
    const write=async event=>{await handle.writeFile(JSON.stringify(event)+'\n');await handle.sync();};
    try{await write({type:'start',session});}finally{await handle.close();}
    return async event=>{
      const file=await fs.open(name,'a');
      try{await file.writeFile(JSON.stringify(event)+'\n');await file.sync();}finally{await file.close();}
    };
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
