'use strict';
const path=require('node:path');
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const check=(ok,message)=>{if(!ok)throw Error('IPC 参数无效：'+message);};
const uuid=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/i.test(x);
const absolute=x=>typeof x==='string'&&x.length>0&&x.length<=32768&&
  (path.isAbsolute(x)||path.win32.isAbsolute(x));
const flag=x=>typeof x==='boolean';
function scan(r){
  check(object(r)&&absolute(r.rootPath),'扫描目录');
  check(flag(r.recursive)&&flag(r.skipHidden)&&flag(r.skipSmall),'扫描选项');
  check(Number.isSafeInteger(r.minSizeBytes)&&r.minSizeBytes>=0,'最小大小');
  check(Array.isArray(r.extensions)&&r.extensions.length<=256&&
    r.extensions.every(x=>typeof x==='string'&&/^[a-z0-9]{1,20}$/i.test(x)),'扩展名');
}
function wash(r){
  scan(r);
  check(['recoverable','legacy'].includes(r.mode),'洗码模式');
  check(['fast','sampled','full'].includes(r.verificationMode),'校验模式');
  check(flag(r.skipAlreadyWashed),'重复文件设置');
  check(typeof r.expectedScanFingerprint==='string'&&/^[a-f0-9]{64}$/i.test(r.expectedScanFingerprint),
    '需要有效的预扫描指纹');
}
const emptyCommands=new Set(['window_minimize','window_toggle_maximize','window_close',
  'is_autostart_enabled','task_running','task_status','cancel_task',
  'list_history','clear_history','storage_diagnostics','video_tool_status','list_video_tasks']);
function validateCommand(command,args={}){
  check(typeof command==='string'&&command.length<=80,'命令');
  check(object(args),'参数对象');
  const encoded=JSON.stringify(args);
  check(typeof encoded==='string'&&encoded.length<=1024*1024,'参数容量');
  if(emptyCommands.has(command))return;
  switch(command){
    case 'frontend_ready':
      check(args.theme===undefined||['light','dark'].includes(args.theme),'主题');return;
    case 'notify':
      check(typeof args.title==='string'&&args.title.length<=200&&
        typeof args.body==='string'&&args.body.length<=2000,'通知');return;
    case 'set_autostart':
      check(flag(args.enabled)&&flag(args.minimized),'自启动');return;
    case 'set_menu_bar_visible':
      check(flag(args.visible),'托盘');return;
    case 'settings_get':return;
    case 'settings_set':
      check(object(args.settings)&&flag(args.settings.showInMenuBar)&&
        object(args.settings.ui),'设置');return;
    case 'dialog_open':
    case 'dialog_save':{
      const opts=args.options??{};
      check(object(opts),'对话框');
      if(opts.title!==undefined)check(typeof opts.title==='string'&&opts.title.length<=500,'标题');
      if(opts.directory!==undefined)check(flag(opts.directory),'文件夹选项');
      if(opts.multiple!==undefined)check(flag(opts.multiple),'多选选项');
      if(opts.defaultPath!==undefined)check(absolute(opts.defaultPath),'保存目录');
      if(opts.filters!==undefined)check(Array.isArray(opts.filters)&&opts.filters.length<=20&&
        opts.filters.every(f=>object(f)&&typeof f.name==='string'&&f.name.length<=100&&
          Array.isArray(f.extensions)&&f.extensions.length<=100&&
          f.extensions.every(x=>typeof x==='string'&&/^(?:\*|[a-z0-9]{1,20})$/i.test(x))),
        '类型过滤器');
      return;
    }
    case 'dialog_confirm':
      check(typeof args.message==='string'&&args.message.length<=8192,'确认内容');return;
    case 'scan_files':scan(args.request);return;
    case 'wash_files':wash(args.request);return;
    case 'restore_session':{
      const r=args.request;
      check(object(r)&&uuid(r.sessionId),'恢复会话');
      check(Array.isArray(r.paths)&&r.paths.length<=10000&&r.paths.every(absolute),'恢复文件');
      check(object(r.pathOverrides)&&Object.keys(r.pathOverrides).length<=10000&&
        Object.entries(r.pathOverrides).every(([from,to])=>absolute(from)&&absolute(to)),'恢复路径');
      return;
    }
    case 'get_history_session':check(uuid(args.sessionId),'历史编号');return;
    case 'export_session_csv':
      check(uuid(args.sessionId)&&absolute(args.outputPath),'导出请求');return;
    case 'probe_video':check(absolute(args.videoPath),'视频路径');return;
    case 'video_output_suggestion':
      check(absolute(args.videoPath)&&(args.outputParent==null||absolute(args.outputParent)),'建议目录');return;
    case 'extract_video_frames':{
      const r=args.request;
      check(object(r)&&absolute(r.videoPath)&&Number.isSafeInteger(r.intervalSeconds)&&
        r.intervalSeconds>=1&&r.intervalSeconds<=86400&&
        (r.outputParent===null||absolute(r.outputParent)),'截图请求');return;
    }
    case 'get_video_task_frames':
      check(uuid(args.taskId)&&Number.isSafeInteger(args.page)&&args.page>=0&&
        Number.isSafeInteger(args.pageSize)&&args.pageSize>=1&&args.pageSize<=24,'截图分页');return;
    case 'open_video_output':check(uuid(args.taskId),'截图任务编号');return;
    default:throw Error('未知 IPC 命令');
  }
}
module.exports={validateCommand};