'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {
  parseOpenHaloUri,
  resolveAlias,
  expandEnvironment,
  validateExternalUrl,
  splitCommand,
  buildGatewayLink,
  normalizeLocalPath,
  executeOpenHaloUri,
  createOpenHaloStore,
}=require('../electron/url-scheme.cjs');

test('parses default open paths and decodes URI-escaped spaces',()=>{
  assert.deepEqual(parseOpenHaloUri('openhalo:C:\\Users\\A%20B\\file.txt'),{
    action:'open',target:'C:\\Users\\A B\\file.txt',
  });
});

test('parses explicit actions and preserves an encoded HTTP URL target',()=>{
  assert.deepEqual(parseOpenHaloUri('openhalo://url/https%3A%2F%2Fexample.com%2Fa%3Fx%3D1'),{
    action:'url',target:'https://example.com/a?x=1',
  });
  assert.deepEqual(parseOpenHaloUri('openhalo://reveal/%2FUsers%2Fme%2Fnotes.txt'),{
    action:'reveal',target:'/Users/me/notes.txt',
  });
});

test('supports Windows environment variables and quote-wrapped command line URIs',()=>{
  assert.deepEqual(parseOpenHaloUri('"openhalo:%USERPROFILE%\\Documents\\A%20B.txt"'),{
    action:'open',target:'%USERPROFILE%\\Documents\\A B.txt',
  });
});

test('rejects wrong schemes, missing targets, and unknown explicit actions',()=>{
  assert.throws(()=>parseOpenHaloUri('other:/tmp/file'),/协议/);
  assert.throws(()=>parseOpenHaloUri('openhalo:'),/目标/);
  assert.throws(()=>parseOpenHaloUri('openhalo://launch/notepad'),/动作/);
});

test('resolves configured aliases and expands environment variables',()=>{
  assert.equal(resolveAlias('hosts',{hosts:'%USERPROFILE%\\hosts'},{USERPROFILE:'/home/test'}),
    '/home/test\\hosts');
  assert.equal(resolveAlias('/tmp/file',{hosts:'/etc/hosts'}),'/tmp/file');
  assert.equal(expandEnvironment('$HOME/docs',{HOME:'/home/test'}),'/home/test/docs');
});

test('normalizes Windows absolute paths without relying on the host platform',()=>{
  assert.equal(normalizeLocalPath('C:\\Users\\A\\..\\B','win32'),'C:\\Users\\B');
  assert.throws(()=>normalizeLocalPath('relative\\file.txt','win32'),/绝对路径/);
});

test('only HTTP and HTTPS URLs are accepted',()=>{
  assert.equal(validateExternalUrl('https://example.com'), 'https://example.com');
  assert.equal(validateExternalUrl('http://localhost/path'), 'http://localhost/path');
  assert.throws(()=>validateExternalUrl('file:///etc/passwd'),/仅支持 HTTP/);
  assert.throws(()=>validateExternalUrl('javascript:alert(1)'),/仅支持 HTTP/);
});

test('splits run arguments without invoking a shell and preserves quoted spaces',()=>{
  assert.deepEqual(splitCommand('"/Applications/My Tool.app/Contents/MacOS/tool" --label "hello world"'),[
    '/Applications/My Tool.app/Contents/MacOS/tool','--label','hello world',
  ]);
  assert.deepEqual(splitCommand('"C:\\Program Files\\tool.exe" "--name=hello world"'),[
    'C:\\Program Files\\tool.exe','--name=hello world',
  ]);
});

test('gateway links encode the complete native URI as an HTTP fragment',()=>{
  assert.equal(buildGatewayLink('https://url.example/#','openhalo:C:\\A B\\x.txt'),
    'https://url.example/#openhalo:C%3A%5CA%20B%5Cx.txt');
  assert.equal(buildGatewayLink('https://url.example/gateway?ref=docs#old','openhalo:/tmp/file'),
    'https://url.example/gateway/?ref=docs#openhalo:%2Ftmp%2Ffile');
});

test('open and reveal require existing absolute paths and use injected OS actions',async()=>{
  const calls=[];
  const notesPath=process.platform==='win32'?path.join(os.tmpdir(),'notes.txt'):'/tmp/notes.txt';
  const deps={aliases:{notes:notesPath},pathExists:async value=>value===notesPath,
    openPath:async value=>calls.push(['open',value]),revealPath:value=>calls.push(['reveal',value])};
  await executeOpenHaloUri('openhalo:notes',deps);
  await executeOpenHaloUri(`openhalo://reveal/${encodeURIComponent(notesPath)}`,deps);
  assert.deepEqual(calls,[['open',notesPath],['reveal',notesPath]]);
  await assert.rejects(()=>executeOpenHaloUri('openhalo:relative.txt',deps),/绝对路径/);
  const missingPath=path.join(os.tmpdir(),'missing-openhalo-file.txt');
  await assert.rejects(()=>executeOpenHaloUri(`openhalo:${missingPath}`,{
    ...deps,pathExists:async()=>false,
  }),/路径不存在/);
});

test('run requires confirmation each time and never executes after cancellation',async()=>{
  let confirmCount=0,runCount=0;
  const deps={pathExists:async()=>true,
    confirmRun:async()=>{confirmCount++;return false;},
    runCommand:async()=>{runCount++;}};
  const command=process.platform==='win32'?'C:\\Windows\\System32\\where.exe':'/usr/bin/true';
  const result=await executeOpenHaloUri(`openhalo://run/${encodeURIComponent(command)}`,deps);
  assert.equal(result.status,'cancelled');
  assert.equal(confirmCount,1);
  assert.equal(runCount,0);
});

test('confirmed run starts the parsed executable and arguments',async()=>{
  let launched;
  const command=process.platform==='win32'?'C:\\HALO\\tool.exe':'/usr/bin/tool';
  const uri=`openhalo://run/${encodeURIComponent(`${command} --label "hello world"`)}`;
  await executeOpenHaloUri(uri,{
    pathExists:async()=>true,confirmRun:async()=>true,
    runCommand:async(executable,args)=>{launched={executable,args};},
  });
  assert.deepEqual(launched,{executable:command,args:['--label','hello world']});
});

test('run rejects executables that are missing or relative paths',async()=>{
  let prompted=false;
  await assert.rejects(()=>executeOpenHaloUri('openhalo://run/missing-tool',{
    findExecutable:async()=>null,confirmRun:async()=>{prompted=true;return true;},runCommand:async()=>{},
  }),/找不到可执行文件/);
  await assert.rejects(()=>executeOpenHaloUri('openhalo://run/tools\\missing-tool',{
    findExecutable:async()=>null,confirmRun:async()=>{prompted=true;return true;},runCommand:async()=>{},
  }),/绝对路径/);
  assert.equal(prompted,false);
});

test('config and call log persist with a 200-entry limit',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'openhalo-'));
  try{
    const store=createOpenHaloStore(directory);
    assert.deepEqual(await store.getConfig(),{
      aliases:{},logging:true,gatewayUrl:'https://s2u2.netlify.app/',enabled:false,
    });
    await store.setEnabled(true);
    await store.setConfig({aliases:{hosts:'/etc/hosts'},logging:false,gatewayUrl:'https://url.example',enabled:true});
    assert.deepEqual(await store.getConfig(),{
      aliases:{hosts:'/etc/hosts'},logging:false,gatewayUrl:'https://url.example',enabled:true,
    });
    await store.recordCall({uri:'openhalo:/tmp/ignored',status:'ok'});
    assert.deepEqual(await store.readCalls(),[]);
    await store.setConfig({aliases:{hosts:'/etc/hosts'},logging:true,gatewayUrl:'https://url.example'});
    for(let i=0;i<205;i++)await store.recordCall({uri:`openhalo:/tmp/${i}`,status:'ok'});
    const rows=await store.readCalls();
    assert.equal(rows.length,200);
    assert.equal(rows[0].uri,'openhalo:/tmp/5');
    assert.equal(rows.at(-1).uri,'openhalo:/tmp/204');
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('migrates the previous default gateway while preserving custom gateways',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'openhalo-gateway-'));
  try{
    const configFile=path.join(directory,'openhalo-config.json');
    await fs.writeFile(configFile,JSON.stringify({gatewayUrl:'https://url.halo.wang'}));
    const store=createOpenHaloStore(directory);
    assert.equal((await store.getConfig()).gatewayUrl,'https://s2u2.netlify.app/');
    await store.setConfig({aliases:{},logging:true,enabled:false,gatewayUrl:'https://custom.example/gateway'});
    assert.equal((await store.getConfig()).gatewayUrl,'https://custom.example/gateway');
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
