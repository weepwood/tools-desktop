import type { RestoreEvent, RestoreRecord, ScanRequest, ScanSummary, SessionRecord, WashEvent, WashRequest, TaskStatus, VideoTools, VideoInfo, VideoRequest, VideoEvent, VideoTask, VideoFramePage, VideoSplitRequest, VideoSplitRecord, VideoSplitEvent, DuplicateResult, ScreenCaptureDay, ScreenCaptureDisplay, ScreenCaptureEvent, ScreenCaptureFramePage, ScreenCaptureRequest, ScreenCaptureSession } from './types'

async function call<T>(command: string, args: Record<string, unknown> = {}, onMessage?: (value: any) => void): Promise<T> {
  const bridge = window.halo
  if (!bridge) throw new Error('该操作只能在 Electron 桌面应用中执行。')
  const id = crypto.randomUUID()
  const unsubscribe = onMessage ? bridge.on('request:' + id, onMessage) : () => {}
  try { return await bridge.invoke<T>(command, args, id) }
  finally { unsubscribe() }
}

export const scanFiles = (request: ScanRequest) => call<ScanSummary>('scan_files', { request })
export const findDuplicateFiles = (request: ScanRequest, onMessage: (event: WashEvent) => void) => call<DuplicateResult>('find_duplicates', { request }, onMessage)
export const washFiles = (request: WashRequest, onMessage: (event: WashEvent) => void) => call<SessionRecord>('wash_files', { request }, onMessage)
export const restoreSession = (sessionId: string, paths: string[], pathOverrides: Record<string, string>, onMessage: (event: RestoreEvent) => void) => call<RestoreRecord>('restore_session', { request: { sessionId, paths, pathOverrides } }, onMessage)
export const cancelTask = () => call<boolean>('cancel_task')
export const taskRunning = () => call<boolean>('task_running')
export const getTaskStatus = () => call<TaskStatus>('task_status')
export const videoToolStatus = () => call<VideoTools>('video_tool_status')
export const probeVideo = (videoPath: string) => call<VideoInfo>('probe_video', { videoPath })
export const extractVideoFrames = (request: VideoRequest, onMessage: (event: VideoEvent) => void) => call<VideoTask>('extract_video_frames', { request }, onMessage)
export const listVideoTasks = () => call<VideoTask[]>('list_video_tasks')
export const getVideoTaskFrames = (taskId: string, page: number) => call<VideoFramePage>('get_video_task_frames', { taskId, page, pageSize: 24 })
export const exportContactSheet = (taskId: string, page: number) => call<{path:string;frames:number}>('export_contact_sheet', { taskId, page, pageSize: 24 })
export const openVideoOutput = (taskId: string) => call<void>('open_video_output', { taskId })
export const videoOutputSuggestion = (videoPath: string, outputParent: string | null) => call<string>('video_output_suggestion', { videoPath, outputParent })
export const screenCaptureSupported = () => call<boolean>('screen_capture_supported')
export const lastScreenCaptureSession = () => call<ScreenCaptureSession | null>('screen_capture_last_session')
export const screenCaptureDisplays = () => call<ScreenCaptureDisplay[]>('screen_capture_displays')
export const startScreenCapture = (request: ScreenCaptureRequest, onMessage: (event: ScreenCaptureEvent) => void) =>
  call<ScreenCaptureSession>('screen_capture', { request }, onMessage)
export const listScreenCaptureDays = (outputRoot: string) => call<ScreenCaptureDay[]>('list_screen_capture_days', { outputRoot })
export const getScreenCaptureFrames = (outputRoot: string, date: string, page: number) =>
  call<ScreenCaptureFramePage>('get_screen_capture_frames', { outputRoot, date, page, pageSize: 24 })
export const exportScreenCaptureDay = (outputRoot: string, date: string, fps: number, onMessage: (event: ScreenCaptureEvent) => void) =>
  call<{ path: string; frames: number; fps: number }>('export_screen_capture_day', { outputRoot, date, fps }, onMessage)
export const openScreenCaptureDay = (outputRoot: string, date: string) => call<void>('open_screen_capture_day', { outputRoot, date })
export const listHistory = () => call<SessionRecord[]>('list_history')
export const getHistorySession = (sessionId: string) => call<SessionRecord>('get_history_session', { sessionId })
export const clearHistory = () => call<void>('clear_history')
export const exportSessionCsv = (sessionId: string, outputPath: string) => call<void>('export_session_csv', { sessionId, outputPath })

export const splitVideoBySize = (request: VideoSplitRequest, onMessage: (event: VideoSplitEvent) => void) =>
  call<VideoSplitRecord>('split_video', { request }, onMessage)
export const listSplitTasks = () => call<VideoSplitRecord[]>('list_split_tasks')
export const mergeSplitTask = (taskId: string, onMessage: (event: VideoSplitEvent) => void) =>
  call<VideoSplitRecord>('merge_split_task', { taskId }, onMessage)
export const openSplitOutput = (taskId: string) => call<void>('open_split_output', { taskId })
