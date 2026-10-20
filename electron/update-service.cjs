'use strict';

const OWNER='weepwood';
const REPOSITORY='tools-desktop';
const RELEASE_API=`https://api.github.com/repos/${OWNER}/${REPOSITORY}/releases/latest`;
const RELEASE_PAGE=`https://github.com/${OWNER}/${REPOSITORY}/releases/latest`;

function versionParts(version){
  const match=/^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if(!match)throw Error('版本号格式无效');
  return match.slice(1).map(Number);
}

function compareVersions(left,right){
  const a=versionParts(left),b=versionParts(right);
  for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]>b[i]?1:-1;
  return 0;
}

function parseLatestRelease(release,currentVersion){
  if(!release||typeof release!=='object'||Array.isArray(release)||release.draft===true||release.prerelease===true)
    throw Error('GitHub 未返回可用的正式版');
  const match=typeof release.tag_name==='string'&&/^v?(\d+\.\d+\.\d+)$/.exec(release.tag_name);
  if(!match)throw Error('GitHub Release 版本号无效');
  const latestVersion=match[1];
  versionParts(currentVersion);
  let releaseUrl;
  try{releaseUrl=new URL(release.html_url);}catch{throw Error('GitHub Release 链接无效');}
  if(releaseUrl.protocol!=='https:'||releaseUrl.hostname!=='github.com'||
    releaseUrl.pathname!==`/${OWNER}/${REPOSITORY}/releases/tag/${release.tag_name}`)
    throw Error('GitHub Release 链接无效');
  return {
    latestVersion,
    updateAvailable:compareVersions(latestVersion,currentVersion)>0,
    releaseNotes:typeof release.body==='string'?release.body.slice(0,20000):'',
    releaseUrl:releaseUrl.toString(),
  };
}

function resolveUpdateMode({platform,isPackaged,env={}}){
  const canInstall=platform==='win32'&&isPackaged&&!env.PORTABLE_EXECUTABLE_FILE;
  return {mode:canInstall?'windows-installer':'release-page',canInstall};
}

function createUpdateService({app,autoUpdater,shell,fetchImpl=globalThis.fetch,platform=process.platform,
  env=process.env,emit=()=>{},releaseApi=RELEASE_API,isTaskRunning=()=>false}){
  const updateMode=resolveUpdateMode({platform,isPackaged:app.isPackaged,env});
  let lastCheck=null;
  let downloaded=false;
  let busy=false;
  let snapshot={status:'idle',currentVersion:app.getVersion(),...updateMode};
  const publish=(next)=>{
    snapshot={...snapshot,...next};
    emit('update-status',snapshot);
    return snapshot;
  };

  if(updateMode.canInstall&&autoUpdater){
    autoUpdater.autoDownload=false;
    autoUpdater.autoInstallOnAppQuit=false;
    autoUpdater.on('download-progress',progress=>publish({
      status:'downloading',progress:{percent:progress.percent,transferred:progress.transferred,total:progress.total,bytesPerSecond:progress.bytesPerSecond},
    }));
    autoUpdater.on('update-downloaded',info=>{
      downloaded=true;
      publish({status:'downloaded',progress:null,latestVersion:info?.version||lastCheck?.latestVersion});
    });
    autoUpdater.on('error',error=>publish({status:'error',progress:null,error:error?.message||String(error)}));
  }

  async function check(){
    if(busy)throw Error('更新操作正在进行');
    busy=true;
    const currentVersion=app.getVersion();
    publish({status:'checking',currentVersion,error:null,progress:null});
    try{
      const response=await fetchImpl(releaseApi,{
        headers:{Accept:'application/vnd.github+json','User-Agent':'HALO-Desktop-Updater'},
        signal:AbortSignal.timeout(15000),
      });
      if(!response.ok)throw Error(response.status===403||response.status===429
        ? 'GitHub 更新服务请求过于频繁，请稍后再试'
        : `检查更新失败（HTTP ${response.status}）`);
      let release;
      try{release=await response.json();}catch{throw Error('GitHub 更新信息无法读取');}
      const parsed=parseLatestRelease(release,currentVersion);
      lastCheck={...parsed,currentVersion,...updateMode};
      if(parsed.updateAvailable&&updateMode.canInstall){
        if(!autoUpdater)throw Error('Windows 更新组件未加载');
        const result=await autoUpdater.checkForUpdates();
        if(!result?.isUpdateAvailable)
          throw Error('新版本已发布，但 Windows 更新文件尚未就绪');
      }
      return publish({
        ...lastCheck,
        status:parsed.updateAvailable?'available':'up-to-date',
        progress:null,
        error:null,
      });
    }catch(error){
      lastCheck=null;
      publish({status:'error',error:error?.message||String(error),progress:null});
      throw error;
    }finally{busy=false;}
  }

  async function download(){
    if(!updateMode.canInstall||!lastCheck?.updateAvailable)
      throw Error('当前安装方式不支持应用内更新');
    if(busy)throw Error('更新操作正在进行');
    busy=true;
    downloaded=false;
    publish({status:'downloading',progress:{percent:0,transferred:0,total:0,bytesPerSecond:0},error:null});
    try{
      await autoUpdater.downloadUpdate();
      return snapshot;
    }catch(error){
      publish({status:'error',error:error?.message||String(error),progress:null});
      throw error;
    }finally{busy=false;}
  }

  function install(){
    if(!updateMode.canInstall||!downloaded)throw Error('更新尚未下载完成');
    if(isTaskRunning())throw Error('任务运行期间不能安装更新，请等待任务结束后再试');
    publish({status:'installing',progress:null,error:null});
    autoUpdater.quitAndInstall(false,true);
    return snapshot;
  }

  async function openRelease(){
    const url=lastCheck?.releaseUrl||RELEASE_PAGE;
    await shell.openExternal(url);
    return url;
  }

  return {check,download,install,openRelease,getSnapshot:()=>({...snapshot})};
}

module.exports={compareVersions,parseLatestRelease,resolveUpdateMode,createUpdateService};
