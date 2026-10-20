'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAGIC = Buffer.from([88, 73, 77, 65, 1, 0, 0, 0]);
const SAMPLE_BYTES = 1024 * 1024;
const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const statId = stat => String(stat.dev) + ':' + String(stat.ino);
const snap = stat => ({ size: Number(stat.size), fileId: statId(stat), modifiedNs: String(stat.mtimeNs ?? BigInt(Math.round(Number(stat.mtimeMs) * 1e6))) });
const unchanged = (a,b) => a.size === b.size && a.fileId === b.fileId && a.modifiedNs === b.modifiedNs;
const validSize = n => Number.isSafeInteger(n) && n >= 0;
const validHash = n => typeof n === 'string' && /^[a-f0-9]{64}$/i.test(n);
const checkAbort = signal => { if (signal?.aborted) throw Error('任务已停止。'); };

function marker(mode) {
  if (mode === 'legacy') return crypto.randomBytes(5);
  if (mode !== 'recoverable') throw Error('无效的洗码模式');
  const result = Buffer.alloc(32);
  MAGIC.copy(result);
  result.writeBigUInt64LE(BigInt(Date.now()), 8);
  crypto.randomFillSync(result, 16);
  return result;
}
async function readRange(handle, offset, len, signal) {
  const buffer = Buffer.alloc(len);
  let read = 0;
  while (read < len) {
    checkAbort(signal);
    const result = await handle.read(buffer, read, len - read, offset + read);
    if (!result.bytesRead) throw Error('文件读取提前结束');
    read += result.bytesRead;
  }
  return buffer;
}
async function tail(handle, size, n) {
  return size < n ? Buffer.alloc(0) : readRange(handle, size-n, n);
}
async function digestFile(handle, count, signal, extra) {
  const h = crypto.createHash('sha256');
  let offset = 0;
  const buffer = Buffer.alloc(1024*1024);
  while (offset < count) {
    checkAbort(signal);
    const {bytesRead} = await handle.read(buffer,0,Math.min(buffer.length,count-offset),offset);
    if (!bytesRead) throw Error('读取文件时遇到意外结尾');
    h.update(buffer.subarray(0,bytesRead));
    offset += bytesRead;
  }
  const before = h.copy().digest('hex');
  if(extra) h.update(extra);
  return [before,h.digest('hex')];
}
async function samplesFor(handle, size, signal) {
  if (size === 0) return [];
  const max = Math.max(0,size-SAMPLE_BYTES);
  const offsets = new Set([0,max]);
  for (let i=1;i<=8;i++) offsets.add(Math.min(max,Math.floor(max * i/9)));
  const out=[];
  for(const offset of [...offsets].sort((a,b)=>a-b)) {
    const length = Math.min(SAMPLE_BYTES,size-offset);
    out.push({ offset,length,sha256:hash(await readRange(handle,offset,length,signal)) });
  }
  return out;
}
async function verifySamples(handle, samples, signal) {
  for(const sample of samples) {
    const actual=hash(await readRange(handle,sample.offset,sample.length,signal));
    if(actual !== sample.sha256) throw Error('抽样校验不一致，拒绝恢复');
  }
}
async function sampleSignature(handle,size,signal){
  // Bounded content check that also detects quick same-size overwrites on
  // Windows filesystems with coarse or cached metadata timestamps.
  const length=Math.min(4096,size);
  const max=size-length;
  const positions=[...new Set([0,Math.floor(max/2),max])];
  const h=crypto.createHash('sha256');
  for(const offset of positions){
    const marker=Buffer.alloc(8);marker.writeBigUInt64LE(BigInt(offset));
    h.update(marker);h.update(await readRange(handle,offset,length,signal));
  }
  return h.digest('hex');
}
async function scan(request, signal) {
  if(!request || typeof request.rootPath!=='string'||!request.rootPath) throw Error('请指定有效文件夹');
  const root=path.resolve(request.rootPath);
  const rootInfo=await fs.lstat(root);
  if(!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw Error('扫描路径必须是普通文件夹');
  const ext=new Set((request.extensions||[]).map(x=>String(x).toLowerCase().replace(/^\./,'')).filter(Boolean));
  const result={fingerprint:'',unreadable:0,warnings:[],totalFiles:0,totalBytes:0,preview:[],hiddenSkipped:0,smallSkipped:0,extensionSkipped:0};
  const files=[];
  const visit=async (folder, depth) => {
    checkAbort(signal);
    let items;
    try { items=await fs.readdir(folder,{withFileTypes:true}); }
    catch(error){ result.unreadable++; if(result.warnings.length<20)result.warnings.push(folder+': '+error.message);return; }
    items.sort((a,b)=>a.name.localeCompare(b.name));
    for (const item of items) {
      checkAbort(signal);
      if (request.skipHidden && item.name.startsWith('.')) {result.hiddenSkipped++;continue;}
      if(item.isSymbolicLink()) continue;
      const full=path.join(folder,item.name);
      if(item.isDirectory()) { if(request.recursive) await visit(full,depth+1);continue; }
      if(!item.isFile()) continue;
      try {
        const s=await fs.lstat(full);
        if(!s.isFile()||s.isSymbolicLink())continue;
        const stat=snap(await fs.lstat(full,{bigint:true}));
        if(!validSize(stat.size))throw Error('文件大小超过允许范围');
        if(request.skipSmall && s.size <= Number(request.minSizeBytes||0)) {result.smallSkipped++;continue;}
        if(ext.size && !ext.has(path.extname(item.name).slice(1).toLowerCase())){result.extensionSkipped++;continue;}
        const handle=await fs.open(full,constants.O_RDONLY | (constants.O_NOFOLLOW||0));
        let sampleSha256;
        try{
          const opened=snap(await handle.stat({bigint:true}));
          if(opened.size!==stat.size||opened.fileId!==stat.fileId||opened.modifiedNs!==stat.modifiedNs)
            throw Error('文件在预扫描中发生变化');
          sampleSha256=await sampleSignature(handle,stat.size,signal);
          if(!unchanged(opened,snap(await handle.stat({bigint:true}))))
            throw Error('内容采样期间文件发生变化');
        }finally{await handle.close();}
        files.push({path:full,relativePath:path.relative(root,full),size:s.size,
          fileId:stat.fileId,modifiedNs:stat.modifiedNs,sampleSha256});
        result.totalBytes+=s.size;
      }catch(error){result.unreadable++;if(result.warnings.length<20)result.warnings.push(full+': '+error.message);}
    }
  };
  await visit(root,0);
  files.sort((a,b)=>a.relativePath<b.relativePath?-1:a.relativePath>b.relativePath?1:0);
  const h=crypto.createHash('sha256'),u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
  for(const file of files){const p=Buffer.from(file.path);h.update(u64(p.length));h.update(p);h.update(u64(file.size));
    for(const item of [file.fileId,file.modifiedNs,file.sampleSha256]){const value=Buffer.from(item);h.update(u64(value.length));h.update(value);}
  }
  result.fingerprint=h.digest('hex');result.totalFiles=files.length;result.preview=files.slice(0,200);
  return {summary:result,files};
}
function fileRecord(file,mode) {
  return {pending:false,path:file.path,relativePath:file.relativePath,status:'failed',error:null,
    beforeSize:file.size,afterSize:file.size,beforeSha256:'',afterSha256:'',appendedHex:'',
    durationMs:0,verificationMode:mode,samples:[],beforeFileId:null,afterFileId:null,
    beforeModifiedNs:null,afterModifiedNs:null};
}
async function washOne(file,request,signal,journal) {
  const start=Date.now(),record=fileRecord(file,request.verificationMode||'sampled');
  let handle, writeAttempted=false;
  try{
    checkAbort(signal);
    const st=await fs.lstat(file.path);
    if(!st.isFile()||st.isSymbolicLink())throw Error('不是普通文件，拒绝修改');
    handle=await fs.open(file.path,constants.O_RDWR | (constants.O_NOFOLLOW||0));
    const before=snap(await handle.stat({bigint:true}));
    // Compare the path and the open handle in the SAME representation.
    // A non-bigint stat returns ino as a Number, and on Windows an NTFS file
    // index routinely exceeds Number.MAX_SAFE_INTEGER — the rounded value then
    // never equals the bigint string and every file is rejected as "changed".
    const openedPath=await fs.lstat(file.path,{bigint:true});
    if(!openedPath.isFile()||openedPath.isSymbolicLink()||statId(openedPath)!==before.fileId)
      throw Error('扫描后文件身份变化，拒绝修改');
    if(before.size!==file.size || (file.fileId && before.fileId!==file.fileId) ||
       (file.modifiedNs && before.modifiedNs!==file.modifiedNs))
      throw Error('扫描后文件的大小、身份或修改时间已变化');
    if(file.sampleSha256 && await sampleSignature(handle,before.size,signal)!==file.sampleSha256)
      throw Error('扫描后文件采样内容已变化，拒绝写入');
    record.beforeSize=before.size;record.beforeFileId=before.fileId;record.beforeModifiedNs=before.modifiedNs;
    if(request.mode==='recoverable' && request.skipAlreadyWashed && (await tail(handle,before.size,32)).subarray(0,8).equals(MAGIC)){
      record.status='skipped';record.error='文件尾部已有 HALO 标记。';return record;
    }
    const bytes=marker(request.mode);record.appendedHex=bytes.toString('hex');
    record.afterSize=before.size+bytes.length;record.afterFileId=before.fileId;
    if(record.verificationMode==='sampled')record.samples=await samplesFor(handle,before.size,signal);
    else if(record.verificationMode==='full') [record.beforeSha256,record.afterSha256]=await digestFile(handle,before.size,signal,bytes);
    else if(record.verificationMode!=='fast') throw Error('无效的校验方式');
    if(!unchanged(before,snap(await handle.stat({bigint:true}))))throw Error('文件在校验时发生改变，已拒绝写入');
    checkAbort(signal);
    record.pending=true;
    await journal({type:'prepared',file:{...record,error:'写入结果尚未确认'}});
    writeAttempted=true; // a write may modify some bytes before throwing
    const {bytesWritten}=await handle.write(bytes,0,bytes.length,before.size);
    if(bytesWritten!==bytes.length)throw Error('尾部写入不完整');
    await handle.sync();
    const after=snap(await handle.stat({bigint:true}));
    if(after.size!==before.size+bytes.length||after.fileId!==before.fileId)throw Error('写入后的大小或身份异常');
    if(!(await tail(handle,after.size,bytes.length)).equals(bytes))throw Error('写入的尾部内容不一致');
    record.afterModifiedNs=after.modifiedNs;
    record.status='success';record.pending=false;record.error=null;
    return record;
  }catch(error){
    if(writeAttempted && handle) {
      // Never blindly truncate a file modified by another process. Keep the
      // write-ahead journal and require manual inspection in ambiguous cases.
      try {
        const state=snap(await handle.stat({bigint:true}));
        const extra=state.size-record.beforeSize;
        const bytes=Buffer.from(record.appendedHex,'hex');
        const tailMatches=extra>=0 && extra<=bytes.length &&
          (await tail(handle,state.size,extra)).equals(bytes.subarray(0,extra));
        if(state.fileId!==record.beforeFileId || !tailMatches)
          throw Error('文件状态已变化，无法安全回滚');
        if(extra) {await handle.truncate(record.beforeSize);await handle.sync();}
        writeAttempted=false;
      }catch(e){record.error='自动回滚未完成：'+e.message+'；原错误：'+error.message;}
    }
    record.status='failed';
    if(!record.error)record.error=error.message;
    record.pending=writeAttempted;
    return record;
  }finally{if(handle)await handle.close().catch(()=>{});record.durationMs=Date.now()-start;}
}
async function wash(request,signal,send,history) {
  const {summary,files}=await scan(request,signal);
  if(request.expectedScanFingerprint && request.expectedScanFingerprint!==summary.fingerprint)throw Error('文件范围或大小已变化，请重新扫描。');
  const session={id:uuid(),startedAt:now(),finishedAt:'',rootPath:request.rootPath,mode:request.mode,
    verificationMode:request.verificationMode||'sampled',total:files.length,success:0,failed:0,skipped:0,bytesAppended:0,cancelled:false,historyError:null,restoreRuns:[],files:[],interrupted:false,taskError:null};
  const journal=await history.startJournal(session);
  send({kind:'started',completed:0,total:files.length,currentFile:null,result:null,message:'共找到 '+files.length+' 个候选文件。'});
  for(const [index,file] of files.entries()){
    if(signal.aborted){session.cancelled=true;break;}
    send({kind:'progress',completed:index,total:files.length,currentFile:file.relativePath,result:null,message:null});
    const record=await washOne(file,request,signal,journal);
    session.files.push(record);
    session[record.status]++;
    if(record.status==='success')session.bytesAppended+=record.afterSize-record.beforeSize;
    try {await journal({type:'completed',file:record});}
    catch(error){session.taskError='任务日志写入失败：'+error.message;session.interrupted=true;session.cancelled=true;break;}
    send({kind:'progress',completed:index+1,total:files.length,currentFile:file.relativePath,result:record,message:null});
  }
  session.finishedAt=now();session.cancelled ||= signal.aborted;
  send({kind:session.cancelled?'cancelled':'completed',completed:session.files.length,total:files.length,currentFile:null,result:null,message:null});
  try{await history.saveSession(session);}catch(error){session.historyError=error.message;session.interrupted=true;}
  return session;
}
async function restoreOne(file,override,signal){
  const start=Date.now();
  const resolvedPath=override && override!==file.path?override:null;
  const target=resolvedPath||file.path;
  const out={path:file.path,resolvedPath,relativePath:file.relativePath,status:'failed',error:null,washedSize:file.afterSize,restoredSize:0,
    washedSha256:file.afterSha256||'',restoredSha256:'',removedHex:file.appendedHex,durationMs:0};
  let handle;
  try{
    checkAbort(signal);
    if(!validSize(file.beforeSize)||!validSize(file.afterSize)||file.afterSize<=file.beforeSize)
      throw Error('恢复记录中的原始大小无效');
    if(typeof file.appendedHex!=='string'||!/^(?:[a-f0-9]{2})+$/i.test(file.appendedHex))
      throw Error('恢复记录中的尾部标记不是有效十六进制');
    const markerBytes=Buffer.from(file.appendedHex,'hex');
    if(!markerBytes.length||markerBytes.length!==file.afterSize-file.beforeSize)
      throw Error('恢复记录中的尾部标记长度无效');
    const st=await fs.lstat(target);
    if(!st.isFile()||st.isSymbolicLink())throw Error('恢复目标不是普通文件');
    handle=await fs.open(target,constants.O_RDWR | (constants.O_NOFOLLOW||0));
    const current=snap(await handle.stat({bigint:true}));
    const openedPath=await fs.lstat(target,{bigint:true}); // same precision as above
    if(!openedPath.isFile()||openedPath.isSymbolicLink()||statId(openedPath)!==current.fileId)
      throw Error('恢复目标文件身份变化，拒绝修改');
    out.restoredSize=current.size;
    if(!resolvedPath && file.afterFileId && current.fileId!==file.afterFileId)throw Error('文件身份发生变化，拒绝恢复');
    if(current.size!==file.afterSize && current.size!==file.beforeSize)throw Error('文件大小不符，拒绝恢复');
    const already=current.size===file.beforeSize;
    if(!already && !(await tail(handle,current.size,markerBytes.length)).equals(markerBytes))throw Error('尾部标记不同，拒绝截断');
    if(file.verificationMode==='full') {
      if(!validHash(file.beforeSha256))throw Error('完整校验记录缺少有效 SHA-256，拒绝恢复');
      const [original]=await digestFile(handle,file.beforeSize,signal);
      if(original.toLowerCase()!==file.beforeSha256.toLowerCase())
        throw Error('完整 SHA-256 校验不匹配');
      out.restoredSha256=original;
    }else if(file.verificationMode==='sampled'){
      const samples=file.samples;
      if(!Array.isArray(samples)||(!samples.length && file.beforeSize>0))
        throw Error('抽样校验记录缺少校验样本，拒绝恢复');
      for(const sample of samples){
        if(!validSize(sample.offset)||!validSize(sample.length)||sample.length<1 ||
          sample.offset+sample.length>file.beforeSize||!validHash(sample.sha256))
          throw Error('抽样校验记录损坏，拒绝恢复');
      }
      await verifySamples(handle,samples,signal);
    }else if(file.verificationMode==='fast'){
      if(resolvedPath)throw Error('快速校验记录无法安全验证移动后的文件');
      if(file.afterModifiedNs && current.modifiedNs!==file.afterModifiedNs)
        throw Error('文件修改时间已改变，快速校验拒绝恢复');
    }else throw Error('未知的文件校验方式，拒绝恢复');
    if(already){out.status='skipped';out.error='文件已经处于洗码前状态。';return out;}
    checkAbort(signal);
    // Recheck the opened file descriptor immediately before truncation.
    if(!unchanged(current,snap(await handle.stat({bigint:true}))))
      throw Error('恢复校验期间文件发生变化，拒绝截断');
    if(!(await tail(handle,current.size,markerBytes.length)).equals(markerBytes))
      throw Error('尾部标记在校验期间发生变化，拒绝截断');
    checkAbort(signal);
    await handle.truncate(file.beforeSize);await handle.sync();
    out.restoredSize=file.beforeSize;out.status='success';
    return out;
  }catch(error){out.error=error.message;return out;}
  finally{if(handle)await handle.close().catch(()=>{});out.durationMs=Date.now()-start;}
}
async function restore(request,signal,send,history){
  const session=await history.getSession(request.sessionId);
  const selected=new Set(request.paths||[]);
  const candidates=session.files.filter(f=>(f.status==='success'||f.pending)&&(!selected.size||selected.has(f.path)));
  const record={id:uuid(),startedAt:now(),finishedAt:'',total:candidates.length,success:0,failed:0,skipped:0,cancelled:false,historyError:null,files:[]};
  send({kind:'started',completed:0,total:candidates.length,currentFile:null,result:null,message:'准备恢复 '+candidates.length+' 个文件。'});
  for(const [i,file] of candidates.entries()){
    if(signal.aborted){record.cancelled=true;break;}
    send({kind:'progress',completed:i,total:candidates.length,currentFile:file.relativePath,result:null,message:null});
    const result=await restoreOne(file,(request.pathOverrides||{})[file.path],signal);
    record.files.push(result);record[result.status]++;
    send({kind:'progress',completed:i+1,total:candidates.length,currentFile:file.relativePath,result,message:null});
  }
  record.finishedAt=now();record.cancelled ||= signal.aborted;
  send({kind:record.cancelled?'cancelled':'completed',completed:record.files.length,total:candidates.length,currentFile:null,result:null,message:null});
  session.restoreRuns=session.restoreRuns||[];session.restoreRuns.push(record);
  try{await history.saveSession(session);}catch(error){record.historyError=error.message;}
  return record;
}
module.exports={marker,scan,wash,restore,digestFile,samplesFor,restoreOne,readRange,MAGIC};
