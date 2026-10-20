'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const net=require('node:net');
const os=require('node:os');
const fs=require('node:fs/promises');
const path=require('node:path');
const {Mailer,normalizeConfig,buildMessage,deliver}=require('../electron/mailer.cjs');

/** A tiny SMTP server: enough dialogue to verify what HALO actually sends. */
function fakeServer({authFail=false}={}){
  const state={commands:[],data:'',auth:null,recipients:[]};
  const sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);
    socket.on('close',()=>sockets.delete(socket));
    socket.setEncoding('utf8');
    socket.write('220 fake.local ESMTP\r\n');
    let buffer='',inData=false;
    socket.on('data',chunk=>{
      buffer+=chunk;
      let index;
      while((index=buffer.indexOf('\r\n'))>=0){
        const line=buffer.slice(0,index);
        buffer=buffer.slice(index+2);
        if(inData){
          if(line==='.'){inData=false;socket.write('250 2.0.0 queued\r\n');}
          else state.data+=line+'\r\n';
          continue;
        }
        const command=line.split(' ')[0].toUpperCase();
        state.commands.push(line);
        if(command==='EHLO')socket.write('250-fake.local\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 1000000\r\n');
        else if(command==='AUTH'){
          const mechanism=line.split(' ')[1]?.toUpperCase();
          if(mechanism==='PLAIN'){
            const decoded=Buffer.from(line.split(' ')[2]||'','base64').toString('utf8').split('\u0000');
            state.auth={mechanism,user:decoded[1],password:decoded[2]};
            socket.write(authFail?'535 5.7.8 bad credentials\r\n':'235 2.7.0 accepted\r\n');
          }else socket.write('334 VXNlcm5hbWU6\r\n');
        }else if(/^[A-Za-z0-9+/=]+$/.test(line)&&state.pendingLogin){
          // LOGIN continuation: username then password.
          if(state.pendingLogin==='user'){state.pendingLogin='pass';state.auth={mechanism:'LOGIN',user:Buffer.from(line,'base64').toString('utf8')};socket.write('334 UGFzc3dvcmQ6\r\n');}
          else {state.auth.password=Buffer.from(line,'base64').toString('utf8');state.pendingLogin=null;socket.write(authFail?'535 5.7.8 bad credentials\r\n':'235 2.7.0 accepted\r\n');}
        }else if(command==='MAIL')socket.write('250 2.1.0 ok\r\n');
        else if(command==='RCPT'){state.recipients.push(line);socket.write('250 2.1.5 ok\r\n');}
        else if(command==='DATA'){inData=true;socket.write('354 end with <CRLF>.<CRLF>\r\n');}
        else if(command==='QUIT'){socket.write('221 2.0.0 bye\r\n');socket.end();}
        else socket.write('250 ok\r\n');
      }
    });
    socket.on('error',()=>{});
  });
  // LOGIN flow: remember that the server asked for the username.
  server.on('connection',socket=>socket.on('data',chunk=>{
    if(String(chunk).includes('AUTH LOGIN'))state.pendingLogin='user';
  }));
  return {
    state,
    async listen(){
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      return server.address().port;
    },
    async close(){
      for(const socket of sockets)socket.destroy();
      await new Promise(resolve=>server.close(resolve));
    },
  };
}

const baseConfig={enabled:true,notifyOnTaskEnd:true,host:'127.0.0.1',port:2525,
  security:'none',username:'robot@halo.test',from:'robot@halo.test',to:['ops@halo.test']};

test('config normalization bounds host, port and recipients',()=>{
  assert.throws(()=>normalizeConfig({host:'smtp host'}),/服务器地址/);
  assert.throws(()=>normalizeConfig({port:70000}),/端口/);
  assert.throws(()=>normalizeConfig({to:['not-an-email']}),/收件人地址无效/);
  const parsed=normalizeConfig({host:'smtp.qq.com',port:'587',to:'a@b.com, c@d.com; a@b.com'});
  assert.deepEqual(parsed.to,['a@b.com','c@d.com']);
  assert.equal(parsed.security,'starttls');
});

test('message keeps a non-ASCII subject readable and body round-trips',()=>{
  const message=buildMessage({from:'robot@halo.test',fromName:'HALO 助手',to:['ops@halo.test'],
    subject:'洗码完成 · 128 个文件',body:'第一行\n第二行'});
  assert.match(message,/\r\nSubject: =\?UTF-8\?B\?/);
  const subjectLine=message.split('\r\n').find(line=>line.startsWith('Subject: '));
  const encoded=subjectLine.replace('Subject: =?UTF-8?B?','').replace('?=','');
  assert.equal(Buffer.from(encoded,'base64').toString('utf8'),'洗码完成 · 128 个文件');
  const payload=message.split('\r\n\r\n')[1].replace(/\r\n/g,'');
  assert.equal(Buffer.from(payload,'base64').toString('utf8'),'第一行\r\n第二行');
  assert.match(message,/^From: =\?UTF-8\?B\?.* <robot@halo\.test>$/m);
});

test('deliver performs EHLO, AUTH PLAIN, envelope and DATA',async()=>{
  const server=fakeServer();
  const port=await server.listen();
  try{
    await deliver({config:{...baseConfig,port},password:'app-password',subject:'HALO 测试邮件',body:'任务完成'});
    const commands=server.state.commands.map(line=>line.split(' ')[0].toUpperCase());
    assert.ok(commands.includes('EHLO'));
    assert.ok(commands.includes('MAIL'));
    assert.ok(commands.includes('RCPT'));
    assert.ok(commands.includes('DATA'));
    assert.deepEqual(server.state.auth,{mechanism:'PLAIN',user:'robot@halo.test',password:'app-password'});
    assert.equal(server.state.recipients.length,1);
    assert.match(server.state.recipients[0],/ops@halo\.test/);
    const payload=server.state.data.split('\r\n\r\n')[1].replace(/\r\n/g,'');
    assert.equal(Buffer.from(payload,'base64').toString('utf8'),'任务完成');
    assert.ok(!server.state.data.includes('app-password'),'password must stay out of the message body');
  }finally{await server.close();}
});

test('a rejected login surfaces an actionable error',async()=>{
  const server=fakeServer({authFail:true});
  const port=await server.listen();
  try{
    await assert.rejects(
      deliver({config:{...baseConfig,port},password:'wrong',subject:'x',body:'y'}),
      /SMTP 认证失败/);
  }finally{await server.close();}
});

test('unreachable server reports a friendly network error',async()=>{
  await assert.rejects(
    deliver({config:{...baseConfig,port:1},password:'x',subject:'x',body:'y',timeoutMs:2000}),
    /拒绝连接|连接失败|超时/);
});

test('mailer stores the secret encrypted and never returns it',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'halo-mail-'));
  const secureStorage={
    isEncryptionAvailable:()=>true,
    // A reversible stand-in for the OS keyring: the point is that HALO hands
    // the plaintext to safeStorage instead of writing it into mail.json.
    encryptString:value=>Buffer.from(value,'utf8').map(byte=>byte^0x5a),
    decryptString:buffer=>Buffer.from(buffer).map(byte=>byte^0x5a).toString('utf8'),
  };
  const mailer=new Mailer({directory,secureStorage,version:'0.1.0',hostName:'test-host'});
  const view=await mailer.save({...baseConfig,password:'s3cret'});
  assert.equal(view.hasPassword,true);
  assert.equal(view.password,undefined);
  assert.equal(view.secretProtected,true);
  const stored=JSON.parse(await fs.readFile(path.join(directory,'mail.json'),'utf8'));
  assert.equal(stored.secret.mode,'safeStorage');
  assert.ok(!Buffer.from(stored.secret.data,'base64').toString('utf8').includes('s3cret'));
  // Saving without a password keeps the existing secret.
  await mailer.save({...baseConfig,to:['ops@halo.test','second@halo.test']});
  const reloaded=new Mailer({directory,secureStorage});
  assert.equal((await reloaded.view()).hasPassword,true);
  await fs.rm(directory,{recursive:true,force:true});
});

test('fallback mail config file is private to the current user on POSIX',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'halo-mail-'));
  try{
    const mailer=new Mailer({directory});
    await mailer.save({...baseConfig,password:'local-secret'});
    const stats=await fs.stat(path.join(directory,'mail.json'));
    if(process.platform!=='win32')assert.equal(stats.mode&0o777,0o600);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('notifications stay silent until mail is enabled',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'halo-mail-'));
  const mailer=new Mailer({directory,version:'0.1.0'});
  assert.deepEqual(await mailer.notifyTaskEnd({title:'HALO',body:'完成'}),{ok:false,skipped:true,error:null});
  await mailer.save({...baseConfig,enabled:true,notifyOnTaskEnd:false});
  assert.equal((await mailer.notifyTaskEnd({title:'HALO',body:'完成'})).skipped,true);
  await fs.rm(directory,{recursive:true,force:true});
});
