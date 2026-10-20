'use strict';

const ACTIONS=new Set(['open','reveal','run','url']);
const ENV_TOKEN=/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)|%([A-Za-z_][A-Za-z0-9_]*)%/g;
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');

function expandEnvironment(value,env=process.env){
  return String(value).replace(ENV_TOKEN,(_match,braced,dollar,windows)=>{
    const key=braced||dollar||windows;
    return Object.prototype.hasOwnProperty.call(env,key)?env[key]:_match;
  });
}

function decodeTarget(value){
  const tokens=[];
  const protectedValue=value.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g,match=>{
    const index=tokens.push(match)-1;
    return `__OPENHALO_ENV_${index}__`;
  });
  let decoded;
  try{decoded=decodeURIComponent(protectedValue);}
  catch{throw Error('URI 中包含无效的百分号编码');}
  return decoded.replace(/__OPENHALO_ENV_(\d+)__/g,(_match,index)=>tokens[Number(index)]);
}

function parseOpenHaloUri(raw){
  if(typeof raw!=='string')throw Error('URI 格式无效');
  const value=raw.trim().replace(/^["'`“”‘’]+|["'`“”‘’]+$/g,'');
  const match=value.match(/^openhalo:(.*)$/i);
  if(!match)throw Error('不支持的协议；需要 openhalo:');
  let rest=decodeTarget(match[1]).trim();
  let action='open';

  if(rest.startsWith('//')){
    rest=rest.slice(2);
    // Keep the documented compatibility form openhalo://C:\path.
    if(!/^[a-z]:[\\/]/i.test(rest)){
      const separator=rest.search(/[\\/]/);
      if(separator>=0){
        const candidate=rest.slice(0,separator).toLowerCase();
        if(!ACTIONS.has(candidate))throw Error(`不支持的 URL Scheme 动作「${candidate}」`);
        action=candidate;
        rest=rest.slice(separator+1);
      }
    }
  }else{
    const explicit=rest.match(/^(open|reveal|run|url)[\\/](.*)$/i);
    if(explicit){action=explicit[1].toLowerCase();rest=explicit[2];}
  }

  rest=rest.trim();
  if(!rest)throw Error('URI 缺少目标');
  return {action,target:rest};
}

function resolveAlias(target,aliases={},env=process.env){
  const key=String(target).trim();
  const value=aliases&&Object.prototype.hasOwnProperty.call(aliases,key)?aliases[key]:key;
  if(typeof value!=='string')throw Error(`别名「${key}」的目标无效`);
  return expandEnvironment(value,env);
}

function validateExternalUrl(value){
  const text=String(value).trim();
  let parsed;
  try{parsed=new URL(text);}catch{throw Error('网址格式无效');}
  if(!['http:','https:'].includes(parsed.protocol))throw Error('url 动作仅支持 HTTP 和 HTTPS');
  return text;
}

function splitCommand(value){
  const result=[];
  let current='',quote='';
  const chars=[...String(value)];
  for(let index=0;index<chars.length;index++){
    const char=chars[index];
    if(char==='\\'&&quote==='"'&&chars[index+1]==='"'){
      current+='"';index++;continue;
    }
    if(quote){if(char===quote)quote='';else current+=char;continue;}
    if(char==='"'||char==="'"){quote=char;continue;}
    if(/\s/.test(char)){if(current){result.push(current);current='';}continue;}
    current+=char;
  }
  if(quote)throw Error('run 命令中有未闭合的引号');
  if(current)result.push(current);
  return result;
}

function buildGatewayLink(gateway,nativeUri){
  const base=String(gateway||'').trim();
  let parsed;
  try{parsed=new URL(base);}catch{throw Error('网关网址格式无效');}
  if(!['http:','https:'].includes(parsed.protocol))throw Error('网关只支持 HTTP 和 HTTPS');
  const route=parsed.pathname.endsWith('/')?parsed.pathname:parsed.pathname+'/';
  const prefix=parsed.origin+route+parsed.search+'#';
  const uri=String(nativeUri);
  const scheme=uri.match(/^(openhalo:)(.*)$/i);
  return prefix+(scheme?scheme[1]+encodeURIComponent(scheme[2]):encodeURIComponent(uri));
}

function normalizeLocalPath(value,platform=process.platform){
  const text=expandEnvironment(String(value).trim().replace(/^["'`]+|["'`]+$/g,''));
  const pathApi=platform==='win32'?path.win32:path.posix;
  if(!pathApi.isAbsolute(text))throw Error('目标路径必须是绝对路径');
  return pathApi.normalize(text);
}

async function executeOpenHaloUri(raw,deps={}){
  const parsed=parseOpenHaloUri(raw);
  const target=resolveAlias(parsed.target,deps.aliases||{},deps.env||process.env);
  const exists=deps.pathExists||(async value=>{
    try{await fs.access(value);return true;}catch{return false;}
  });
  if(parsed.action==='url'){
    const url=validateExternalUrl(target);
    if(typeof deps.openUrl!=='function')throw Error('网址打开功能不可用');
    await deps.openUrl(url);
    return {status:'ok',action:parsed.action,target:url};
  }
  if(parsed.action==='run'){
    const fields=splitCommand(target);
    if(!fields.length)throw Error('run 缺少程序');
    let executable=expandEnvironment(fields[0],deps.env||process.env);
    const args=fields.slice(1);
    const pathApi=process.platform==='win32'?path.win32:path.posix;
    if(pathApi.isAbsolute(executable)){
      if(!await exists(executable))throw Error(`找不到可执行文件：${executable}`);
    }else if(/[\\/]/.test(executable)){
      throw Error('程序路径必须是绝对路径');
    }else if(typeof deps.findExecutable==='function'){
      const resolved=await deps.findExecutable(executable);
      if(!resolved)throw Error(`找不到可执行文件：${executable}`);
      executable=resolved;
    }
    if(typeof deps.confirmRun!=='function'||!await deps.confirmRun({executable,args}))
      return {status:'cancelled',action:parsed.action,target};
    if(typeof deps.runCommand!=='function')throw Error('程序启动功能不可用');
    await deps.runCommand(executable,args);
    return {status:'ok',action:parsed.action,target};
  }
  const normalized=normalizeLocalPath(target);
  if(!await exists(normalized))throw Error(`路径不存在：${normalized}`);
  if(parsed.action==='open'){
    if(typeof deps.openPath!=='function')throw Error('文件打开功能不可用');
    await deps.openPath(normalized);
  }else{
    if(typeof deps.revealPath!=='function')throw Error('文件定位功能不可用');
    await deps.revealPath(normalized);
  }
  return {status:'ok',action:parsed.action,target:normalized};
}

const DEFAULT_GATEWAY_URL='https://s2u2.netlify.app/';
const PREVIOUS_DEFAULT_GATEWAY_URL='https://url.halo.wang';

function normalizeConfig(value){
  const aliases={};
  if(value&&value.aliases&&typeof value.aliases==='object'&&!Array.isArray(value.aliases)){
    for(const [key,target] of Object.entries(value.aliases).slice(0,200)){
      if(/^[\w.-]{1,80}$/u.test(key)&&typeof target==='string'&&target.length<=32768)aliases[key]=target;
    }
  }
  let gatewayUrl=DEFAULT_GATEWAY_URL;
  if(typeof value?.gatewayUrl==='string'){
    const candidate=value.gatewayUrl.trim();
    if(candidate===PREVIOUS_DEFAULT_GATEWAY_URL){
      gatewayUrl=DEFAULT_GATEWAY_URL;
    }else{
      try{const url=new URL(candidate);if(['http:','https:'].includes(url.protocol))gatewayUrl=candidate;}catch{}
    }
  }
  return {aliases,logging:value?.logging!==false,gatewayUrl,enabled:value?.enabled===true};
}

function createOpenHaloStore(directory){
  const configFile=path.join(directory,'openhalo-config.json');
  const callsFile=path.join(directory,'openhalo-calls.json');
  let queue=Promise.resolve();
  const serialize=operation=>{
    queue=queue.catch(()=>{}).then(operation);
    return queue;
  };
  const readJson=async(file,fallback)=>{
    try{return JSON.parse(await fs.readFile(file,'utf8'));}
    catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return fallback;throw error;}
  };
  const atomicWrite=async(file,value)=>{
    await fs.mkdir(directory,{recursive:true});
    const temporary=file+'.'+crypto.randomUUID()+'.tmp';
    try{
      await fs.writeFile(temporary,JSON.stringify(value,null,2),'utf8');
      await fs.rename(temporary,file);
    }catch(error){await fs.rm(temporary,{force:true}).catch(()=>{});throw error;}
  };
  return {
    getConfig:async()=>normalizeConfig(await readJson(configFile,{})),
    setConfig:value=>serialize(async()=>{
      const config=normalizeConfig(value);
      await atomicWrite(configFile,config);
      return config;
    }),
    setEnabled:enabled=>serialize(async()=>{
      const config=normalizeConfig(await readJson(configFile,{}));
      config.enabled=enabled===true;
      await atomicWrite(configFile,config);
      return config.enabled;
    }),
    readCalls:async()=>{
      const rows=await readJson(callsFile,[]);
      return Array.isArray(rows)?rows.slice(-200):[];
    },
    recordCall:entry=>serialize(async()=>{
      const config=normalizeConfig(await readJson(configFile,{}));
      if(!config.logging)return false;
      const rows=await readJson(callsFile,[]);
      const next=(Array.isArray(rows)?rows:[]).slice(-199);
      next.push({time:new Date().toISOString(),...entry});
      await atomicWrite(callsFile,next);
      return true;
    }),
  };
}

module.exports={parseOpenHaloUri,resolveAlias,expandEnvironment,validateExternalUrl,splitCommand,
  buildGatewayLink,normalizeLocalPath,executeOpenHaloUri,createOpenHaloStore};
