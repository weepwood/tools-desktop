'use strict';
const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('xima',{
  invoke:(command,args={},requestId='')=>ipcRenderer.invoke('xima:invoke',command,args,requestId),
  on:(name,callback)=>{
    const handler=(_event,message)=>{if(message?.name===name)callback(message.payload);};
    ipcRenderer.on('xima:event',handler);
    return ()=>ipcRenderer.removeListener('xima:event',handler);
  },
});
window.addEventListener('dragenter',event=>{event.preventDefault();ipcRenderer.send('xima:drag',{type:'enter',paths:[]});});
window.addEventListener('dragover',event=>{event.preventDefault();});
window.addEventListener('dragleave',event=>{event.preventDefault();ipcRenderer.send('xima:drag',{type:'leave',paths:[]});});
window.addEventListener('drop',event=>{
  event.preventDefault();
  const paths=Array.from(event.dataTransfer?.files||[]).map(file=>webUtils.getPathForFile(file)).filter(Boolean);
  ipcRenderer.send('xima:drag',{type:'drop',paths});
});
