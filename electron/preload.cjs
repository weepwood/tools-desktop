'use strict';
const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('halo',{
  invoke:(command,args={},requestId='')=>ipcRenderer.invoke('halo:invoke',command,args,requestId),
  on:(name,callback)=>{
    const handler=(_event,message)=>{if(message?.name===name)callback(message.payload);};
    ipcRenderer.on('halo:event',handler);
    return ()=>ipcRenderer.removeListener('halo:event',handler);
  },
});
window.addEventListener('dragenter',event=>{event.preventDefault();ipcRenderer.send('halo:drag',{type:'enter',paths:[]});});
window.addEventListener('dragover',event=>{event.preventDefault();});
window.addEventListener('dragleave',event=>{event.preventDefault();ipcRenderer.send('halo:drag',{type:'leave',paths:[]});});
window.addEventListener('drop',event=>{
  event.preventDefault();
  const paths=Array.from(event.dataTransfer?.files||[]).map(file=>webUtils.getPathForFile(file)).filter(Boolean);
  ipcRenderer.send('halo:drag',{type:'drop',paths});
});
