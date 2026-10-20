'use strict';
/*
 * SMTP mail notifications.
 *
 * The renderer never touches the socket or the password: it hands a subject
 * and a body to the main process, which owns the SMTP dialogue and keeps the
 * secret at rest. The client is intentionally dependency-free — HALO ships a
 * hand-rolled EHLO / STARTTLS / AUTH LOGIN+PLAIN / DATA sequence instead of
 * pulling a mail library into the bundle.
 */
const fs=require('node:fs/promises');
const path=require('node:path');
const net=require('node:net');
const tls=require('node:tls');
const crypto=require('node:crypto');

const SECURITIES=new Set(['tls','starttls','none']);
const DEFAULT_CONFIG={
  enabled:false,
  notifyOnTaskEnd:true,
  host:'',
  port:465,
  security:'tls',
  username:'',
  from:'',
  to:[],
};
const EMAIL=/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;
const HOST=/^[a-z0-9](?:[a-z0-9.\-_]*[a-z0-9])?$/i;
const MAX_RECIPIENTS=20;

const text=(value,max)=>typeof value==='string'&&value.length<=max;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{const error=Error(message);error.expected=true;throw error;};

/* ---- Config ---- */

function parseRecipients(value){
  const list=Array.isArray(value)?value:typeof value==='string'?value.split(/[,;\s]+/):[];
  const recipients=[];
  for(const entry of list){
    const address=String(entry??'').trim();
    if(!address)continue;
    if(!EMAIL.test(address))fail(`收件人地址无效：${address.slice(0,120)}`);
    if(!recipients.includes(address))recipients.push(address);
  }
  if(recipients.length>MAX_RECIPIENTS)fail(`收件人不能超过 ${MAX_RECIPIENTS} 个。`);
  return recipients;
}

function normalizeConfig(input){
  if(!object(input))fail('邮件配置无效。');
  const host=String(input.host??'').trim();
  if(host&&(host.length>255||!HOST.test(host)))
    fail('SMTP 服务器地址格式无效，请填写域名或 IP。');
  const port=Number(input.port??DEFAULT_CONFIG.port);
  if(!Number.isSafeInteger(port)||port<1||port>65535)fail('SMTP 端口必须在 1-65535 之间。');
  const security=SECURITIES.has(input.security)?input.security:(port===465?'tls':'starttls');
  const username=String(input.username??'').trim();
  if(username.length>320)fail('SMTP 用户名过长。');
  const from=String(input.from??'').trim();
  if(from&&!EMAIL.test(from))fail('发件人地址无效。');
  const fromName=String(input.fromName??'').replace(/[\r\n]/g,'').trim().slice(0,100);
  return {
    enabled:Boolean(input.enabled),
    notifyOnTaskEnd:input.notifyOnTaskEnd===undefined?DEFAULT_CONFIG.notifyOnTaskEnd:Boolean(input.notifyOnTaskEnd),
    host,
    port,
    security,
    username,
    from,
    fromName,
    to:parseRecipients(input.to),
  };
}

/** Fields that must be present before any mail can leave the machine. */
function assertReady(config){
  if(!config.host)fail('请先填写 SMTP 服务器地址。');
  if(!config.from)fail('请先填写发件人地址。');
  if(!config.to.length)fail('请先填写至少一个收件人地址。');
  if(config.security==='starttls'&&config.port===465)
    fail('465 端口通常使用 SSL/TLS 直连，请改用对应加密方式。');
}

/* ---- Message ---- */

function wrapBase64(buffer){
  return buffer.toString('base64').replace(/(.{76})/g,'$1\r\n');
}

/** RFC 2047 keeps non-ASCII subjects readable in every mail client. */
function encodeHeader(value){
  const clean=String(value??'').replace(/[\r\n]+/g,' ').trim();
  return /^[\x20-\x7e]*$/.test(clean)
    ? clean
    : '=?UTF-8?B?'+Buffer.from(clean,'utf8').toString('base64')+'?=';
}

function formatAddress(address,display){
  const email=String(address??'').trim();
  if(!EMAIL.test(email))fail('邮件地址无效。');
  const name=String(display??'').replace(/[\r\n"<>]/g,'').trim();
  return name?encodeHeader(name)+' <'+email+'>':email;
}

function buildMessage({from,fromName,to,subject,body,date=new Date(),messageId}){
  const recipients=parseRecipients(to);
  if(!recipients.length)fail('缺少收件人。');
  const id=messageId||`<${crypto.randomUUID()}@halo.local>`;
  const headers=[
    'From: '+formatAddress(from,fromName),
    'To: '+recipients.map(address=>formatAddress(address)).join(', '),
    'Subject: '+encodeHeader(subject),
    'Date: '+date.toUTCString().replace('GMT','+0000'),
    'Message-ID: '+id,
    'MIME-Version: 1.0',
    'X-Mailer: HALO',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  // Dot-stuffing is unnecessary because the body is base64, but the
  // normalize step keeps a stray CRLF-only payload from ending DATA early.
  const payload=wrapBase64(Buffer.from(String(body??'').replace(/\r\n/g,'\n').replace(/\n/g,'\r\n'),'utf8'));
  return headers.join('\r\n')+'\r\n\r\n'+payload+'\r\n';
}

/* ---- SMTP channel ---- */

class SmtpChannel{
  constructor(socket,timeoutMs=30000){
    this.socket=socket;
    this.timeoutMs=timeoutMs;
    this.buffer='';
    this.lines=[];
    this.pending=null;
    this.closed=false;
    this.failure=null;
    this.attach(socket);
  }
  attach(socket){
    socket.setEncoding('utf8');
    socket.setTimeout(this.timeoutMs,()=>this.destroy(Error('SMTP 连接超时，请检查服务器地址与网络。')));
    this.onData=chunk=>{
      this.buffer+=chunk;
      let index;
      while((index=this.buffer.indexOf('\n'))>=0){
        this.lines.push(this.buffer.slice(0,index).replace(/\r$/,''));
        this.buffer=this.buffer.slice(index+1);
      }
      this.pump();
    };
    this.onError=error=>this.destroy(error);
    this.onClose=()=>this.destroy(Error('SMTP 服务器关闭了连接。'));
    socket.on('data',this.onData);
    socket.on('error',this.onError);
    socket.on('close',this.onClose);
  }
  detach(){
    const socket=this.socket;
    socket.pause();
    socket.removeListener('data',this.onData);
    socket.removeListener('error',this.onError);
    socket.removeListener('close',this.onClose);
    socket.setTimeout(0);
    return socket;
  }
  pump(){
    if(!this.pending||this.closed)return;
    if(!this.lines.length)return;
    const {resolve,reject}=this.pending;
    this.pending=null;
    try{resolve(this.readLineNow());}
    catch(error){reject(error);}
  }
  readLineNow(){
    if(this.failure)throw this.failure;
    const line=this.lines.shift();
    if(line===undefined)throw Error('SMTP 数据读取失败。');
    return line;
  }
  readLine(){
    if(this.lines.length)return Promise.resolve().then(()=>this.readLineNow());
    if(this.failure)return Promise.reject(this.failure);
    if(this.closed)return Promise.reject(Error('SMTP 连接已关闭。'));
    // The queue is drained by pump(), so the resolver only carries the line
    // it already shifted — wrapping readLineNow() here would consume twice.
    return new Promise((resolve,reject)=>{this.pending={resolve,reject};});
  }
  async readResponse(){
    const lines=[];
    for(;;){
      const line=await this.readLine();
      lines.push(line);
      const match=/^(\d{3})([ -])(.*)$/.exec(line);
      if(!match)fail('SMTP 响应无法解析：'+line.slice(0,160));
      if(match[2]===' ')return {code:Number(match[1]),text:lines.join(' | ')};
    }
  }
  writeRaw(data){
    if(this.closed)return Promise.reject(Error('SMTP 连接已关闭。'));
    return new Promise((resolve,reject)=>{
      this.socket.write(data,'utf8',error=>error?reject(error):resolve());
    });
  }
  write(line){
    return this.writeRaw(line+'\r\n');
  }
  async command(line,expected){
    await this.write(line);
    const response=await this.readResponse();
    if(!expected.includes(response.code))fail(describeFailure(line,response));
    return response;
  }
  async ehlo(){
    const name='HALO';
    await this.write('EHLO '+name);
    const response=await this.readResponse();
    if(response.code!==250)fail(describeFailure('EHLO',response));
    return response.text;
  }
  async auth(username,password){
    // PLAIN is preferred; LOGIN is the fallback every provider still accepts.
    const plain='\u0000'+username+'\u0000'+password;
    await this.write('AUTH PLAIN '+Buffer.from(plain,'utf8').toString('base64'));
    const response=await this.readResponse();
    if(response.code===235)return;
    if(response.code!==504&&response.code!==500&&response.code!==334)
      fail(describeFailure('AUTH PLAIN',response));
    await this.command('AUTH LOGIN',[334]);
    await this.command(Buffer.from(username,'utf8').toString('base64'),[334]);
    await this.command(Buffer.from(password,'utf8').toString('base64'),[235]);
  }
  async upgrade(host){
    const socket=this.detach();
    const secured=tls.connect({socket,servername:host,rejectUnauthorized:true});
    await new Promise((resolve,reject)=>{
      secured.once('secureConnect',resolve);
      secured.once('error',reject);
    });
    const next=new SmtpChannel(secured,this.timeoutMs);
    this.closed=true;
    return next;
  }
  async quit(){
    if(this.closed)return;
    try{await this.command('QUIT',[221]);}catch{}
    this.close();
  }
  close(){
    this.closed=true;
    try{this.socket.destroy();}catch{}
  }
  destroy(error){
    if(this.closed&&!this.failure)this.closed=true;
    this.failure=this.failure||error;
    this.closed=true;
    const pending=this.pending;
    this.pending=null;
    if(pending)pending.reject(this.failure);
    try{this.socket.destroy();}catch{}
  }
}

function describeFailure(command,response){
  const detail=response.text.replace(/^\d{3}[ -]/,'').slice(0,200);
  if(command.startsWith('AUTH')||response.code===535)
    return `SMTP 认证失败（${response.code}）：${detail}。请检查账号、密码（部分邮箱需使用授权码）与加密方式。`;
  return `SMTP 命令被拒绝（${command}）：${response.code} ${detail}`;
}

/* ---- Delivery ---- */

function connectSocket({host,port,security,timeoutMs}){
  if(security==='tls'){
    const socket=tls.connect({host,port,servername:host,rejectUnauthorized:true});
    socket.setTimeout(timeoutMs);
    return socket;
  }
  const socket=net.connect({host,port});
  socket.setTimeout(timeoutMs);
  return socket;
}

async function deliver({config,password,subject,body,timeoutMs=30000}){
  assertReady(config);
  let channel=null;
  const socket=connectSocket({host:config.host,port:config.port,security:config.security,timeoutMs});
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('SMTP 连接超时。')),timeoutMs);
      const done=error=>{clearTimeout(timer);socket.removeListener('connect',onConnect);socket.removeListener('error',onError);error?reject(error):resolve();};
      const onConnect=()=>done();
      const onError=error=>done(new Error(explainNetworkError(error)));
      socket.once(config.security==='tls'?'secureConnect':'connect',onConnect);
      socket.once('error',onError);
    });
    channel=new SmtpChannel(socket,timeoutMs);
    const greeting=await channel.readResponse();
    if(greeting.code!==220)fail('SMTP 服务器拒绝连接：'+greeting.text.slice(0,160));
    let capabilities=await channel.ehlo();
    if(config.security==='starttls'){
      if(!/STARTTLS/i.test(capabilities))
        fail('服务器未提供 STARTTLS，请改用 SSL/TLS（通常为 465 端口）。');
      await channel.command('STARTTLS',[220]);
      channel=await channel.upgrade(config.host);
      capabilities=await channel.ehlo();
    }
    if(config.username&&password){
      const advertised=/AUTH[= ]([A-Z0-9 ]+)/i.exec(capabilities);
      if(!advertised)fail('服务器未提供认证方式，请确认端口与加密设置。');
      await channel.auth(config.username,password);
    }
    const envelopeFrom=config.from;
    await channel.command('MAIL FROM:<'+envelopeFrom+'>',[250]);
    for(const recipient of config.to)await channel.command('RCPT TO:<'+recipient+'>',[250,251]);
    await channel.command('DATA',[354]);
    // The message carries its own CRLFs, so it goes out raw with the
    // terminating dot on its own line.
    await channel.writeRaw(buildMessage({
      from:config.from,
      fromName:config.fromName,
      to:config.to,
      subject,
      body,
    })+'.\r\n');
    const accepted=await channel.readResponse();
    if(accepted.code!==250)fail(describeFailure('DATA',accepted));
    await channel.quit();
    return {ok:true};
  }catch(error){
    if(channel)channel.close();
    else socket.destroy();
    throw Error(friendly(error));
  }
}

function explainNetworkError(error){
  const code=error?.code;
  if(code==='ENOTFOUND'||code==='EAI_AGAIN')return '无法解析 SMTP 服务器地址，请检查域名。';
  if(code==='ECONNREFUSED')return 'SMTP 服务器拒绝连接，请检查地址与端口。';
  if(code==='ETIMEDOUT'||code==='ESOCKETTIMEDOUT')return '连接 SMTP 服务器超时。';
  if(code==='CERT_HAS_EXPIRED')return 'SMTP 服务器证书已过期。';
  if(code==='UNABLE_TO_VERIFY_LEAF_SIGNATURE'||code==='SELF_SIGNED_CERT_IN_CHAIN')
    return 'SMTP 服务器证书无法验证，出于安全考虑已中止。';
  return 'SMTP 连接失败：'+(error?.message||String(error));
}

function friendly(error){
  if(error?.expected)return error.message;
  if(error?.code)return explainNetworkError(error);
  return error?.message||String(error);
}

/* ---- Mailer ---- */

const blankResult=()=>({at:null,ok:null,error:null});

class Mailer{
  constructor({directory,secureStorage=null,version='',hostName=''}){
    this.directory=directory;
    this.file=path.join(directory,'mail.json');
    this.secureStorage=secureStorage;
    this.version=version;
    this.hostName=hostName;
    this.cache=null;
    this.write=Promise.resolve();
    this.queue=Promise.resolve();
    this.lastResult=blankResult();
  }
  get encrypted(){
    try{return Boolean(this.secureStorage?.isEncryptionAvailable?.());}catch{return false;}
  }
  encodeSecret(plain){
    const buffer=Buffer.from(plain,'utf8');
    if(this.encrypted){
      try{return {mode:'safeStorage',data:this.secureStorage.encryptString(plain).toString('base64')};}
      catch{}
    }
    return {mode:'plain',data:buffer.toString('base64')};
  }
  decodeSecret(secret){
    if(!object(secret)||typeof secret.data!=='string'||!secret.data)return '';
    try{
      const buffer=Buffer.from(secret.data,'base64');
      if(secret.mode==='safeStorage'){
        if(!this.encrypted)return '';
        return this.secureStorage.decryptString(buffer);
      }
      return buffer.toString('utf8');
    }catch{return '';}
  }
  async load(){
    if(this.cache)return this.cache;
    let raw=null;
    try{raw=JSON.parse(await fs.readFile(this.file,'utf8'));}
    catch(error){if(error.code!=='ENOENT')raw=null;}
    let config;
    try{config=normalizeConfig(raw?.config||DEFAULT_CONFIG);}
    catch{config={...DEFAULT_CONFIG,to:[]};}
    this.cache={config,secret:object(raw?.secret)?raw.secret:null};
    return this.cache;
  }
  async persist(next){
    this.write=this.write.catch(()=>{}).then(async()=>{
      await fs.mkdir(this.directory,{recursive:true});
      const file=this.file+'.'+crypto.randomUUID()+'.tmp';
      // Keep fallback (base64 encoded) credentials private on POSIX systems.
      // Windows applies the current user's profile ACL to this app data path.
      const handle=await fs.open(file,'wx',0o600);
      try{
        await handle.writeFile(JSON.stringify({version:1,config:next.config,secret:next.secret},null,2));
        await handle.sync();
      }finally{await handle.close();}
      try{await fs.rename(file,this.file);}
      catch(error){await fs.rm(file,{force:true});throw error;}
    });
    return this.write;
  }
  async view(){
    const {config,secret}=await this.load();
    return {
      ...config,
      hasPassword:Boolean(this.decodeSecret(secret)),
      secretProtected:this.encrypted,
      lastResult:this.lastResult,
    };
  }
  async save(patch){
    if(!object(patch))fail('邮件配置无效。');
    const current=await this.load();
    // An empty password field means "keep the stored secret", so the UI can
    // highlight a configured account without ever reading the plaintext.
    const config=normalizeConfig({...current.config,...patch});
    let secret=current.secret;
    if(typeof patch.password==='string'&&patch.password.length){
      if(patch.password.length>1024)fail('SMTP 密码过长。');
      secret=this.encodeSecret(patch.password);
    }
    if(patch.clearPassword===true)secret=null;
    this.cache={config,secret};
    await this.persist(this.cache);
    return this.view();
  }
  async send({subject,body}){
    const {config,secret}=await this.load();
    const password=this.decodeSecret(secret);
    if(config.username&&!password)fail('尚未保存 SMTP 密码，请先在设置中填写。');
    const run=this.queue.catch(()=>{}).then(async()=>{
      try{
        await deliver({config,password,subject,body});
        this.lastResult={at:new Date().toISOString(),ok:true,error:null};
        return {ok:true,at:this.lastResult.at,error:null};
      }catch(error){
        this.lastResult={at:new Date().toISOString(),ok:false,error:error.message};
        return {ok:false,at:this.lastResult.at,error:error.message,rejected:true};
      }
    });
    this.queue=run;
    return run;
  }
  async test(){
    const {config}=await this.load();
    assertReady(config);
    const result=await this.send({
      subject:'HALO 测试邮件',
      body:[
        '这是一封来自 HALO 的测试邮件。',
        '',
        '如果你看到了这封邮件，说明 SMTP 配置可用，任务结束通知将发送到这个地址。',
        '',
        this.signature(),
      ].join('\n'),
    });
    if(!result.ok)fail(result.error||'测试邮件发送失败。');
    return result;
  }
  async notifyTaskEnd(input){
    const title=String(input?.title??'').trim().slice(0,200)||'HALO 任务通知';
    const body=String(input?.body??'').trim().slice(0,4000);
    const {config}=await this.load();
    if(!config.enabled||!config.notifyOnTaskEnd)return {ok:false,skipped:true,error:null};
    if(!config.host||!config.to.length)return {ok:false,skipped:true,error:'邮箱尚未配置完整。'};
    const result=await this.send({
      subject:title,
      body:[body||'（无详细信息）','',this.signature()].join('\n'),
    });
    if(!result.ok)return result;
    return result;
  }
  signature(){
    const pad=value=>String(value).padStart(2,'0');
    const now=new Date();
    const stamp=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} `+
      `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    return [
      '—',
      `时间：${stamp}`,
      this.hostName?`主机：${this.hostName}`:null,
      this.version?`版本：HALO ${this.version}`:null,
    ].filter(Boolean).join('\n');
  }
}

module.exports={Mailer,normalizeConfig,buildMessage,encodeHeader,deliver,assertReady};
