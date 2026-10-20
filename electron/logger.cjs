'use strict';
const fs=require('node:fs');
const path=require('node:path');
const MAX_BYTES=2*1024*1024;
const KEEP_FILES=5;
let folder=null,current=null,currentSize=0;
const pad=n=>String(n).padStart(2,'0');
const day=()=>{const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
const todayFile=()=>path.join(folder,'halo-'+day()+'.log');
const isLogName=name=>/^halo-\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/.test(name);
const measure=name=>{try{return fs.statSync(name).size;}catch{return 0;}};
const mtimeOf=name=>{try{return fs.statSync(name).mtimeMs;}catch{return 0;}};
function fallback(level,lines){
  // Logging must never take the process down: no disk, no problem.
  const sink=typeof console[level]==='function'?console[level]:console.log;
  for(const line of lines)if(line)sink(line);
}
function textOf(values){
  const parts=[],stacks=[];
  for(const value of values){
    if(value instanceof Error){parts.push(value.message||value.name||'Error');if(value.stack)stacks.push(value.stack);}
    else if(typeof value==='string')parts.push(value);
    else if(value===undefined||value===null)parts.push(String(value));
    else parts.push(typeof value==='object'?safeString(value):String(value));
  }
  return {text:parts.join(' '),stacks};
}
function safeString(value){
  try{return JSON.stringify(value);}catch{return String(value);}
}
function prune(){
  if(!folder)return;
  let names;
  try{names=fs.readdirSync(folder).filter(isLogName);}catch{return;}
  if(names.length<=KEEP_FILES)return;
  const keepName=current?path.basename(current):null;
  const rows=names.map(name=>({name,time:mtimeOf(path.join(folder,name))}));
  // The active file always survives, even when timestamps are too coarse to rank it.
  rows.sort((a,b)=>a.name===keepName?-1:b.name===keepName?1:b.time-a.time);
  for(const row of rows.slice(KEEP_FILES)){
    if(row.name===keepName)continue;
    try{fs.rmSync(path.join(folder,row.name),{force:true});}catch{}
  }
}
function rotate(){
  const target=current+'.1';
  try{fs.rmSync(target,{force:true});}catch{}
  fs.renameSync(current,target);
  currentSize=0;
  prune();
}
function write(level,values){
  const {text,stacks}=textOf(values);
  if(!folder){fallback(level,[text,...stacks]);return;}
  const line=new Date().toISOString()+' '+level.toUpperCase()+' '+text+(stacks.length?'\n'+stacks.join('\n'):'')+'\n';
  try{
    const target=todayFile();
    if(target!==current){current=target;currentSize=measure(target);}
    if(currentSize>0&&currentSize+Buffer.byteLength(line,'utf8')>MAX_BYTES)rotate();
    fs.appendFileSync(current,line,{encoding:'utf8'});
    currentSize+=Buffer.byteLength(line,'utf8');
  }catch(error){
    fallback(level,[text,...stacks,'（日志写入失败，已降级为控制台输出：'+error.message+'）']);
  }
}
function init(options){
  const base=options&&typeof options.directory==='string'&&options.directory?path.join(options.directory,'logs'):null;
  folder=null;current=null;currentSize=0;
  if(!base)return null;
  try{fs.mkdirSync(base,{recursive:true});}
  catch(error){fallback('error',['日志目录不可用，已降级为控制台输出：'+base+'（'+error.message+'）']);return null;}
  folder=base;current=todayFile();currentSize=measure(current);
  return folder;
}
function info(...values){write('info',values);}
function warn(...values){write('warn',values);}
function error(...values){write('error',values);}
function tail(n=200){
  const count=Number.isSafeInteger(n)&&n>0?n:200;
  const target=current||(folder?todayFile():null);
  if(!target)return [];
  try{
    const lines=fs.readFileSync(target,'utf8').split('\n');
    if(lines.length&&lines[lines.length-1]==='')lines.pop();
    return lines.slice(-count);
  }catch{return [];}
}
function logsDirectory(){return folder;}
module.exports={init,info,warn,error,tail,logsDirectory};
