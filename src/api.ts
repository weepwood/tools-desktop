import { Channel, invoke } from '@tauri-apps/api/core'
import type {
  RestoreEvent,
  RestoreRecord,
  ScanRequest,
  ScanSummary,
  SessionRecord,
  WashEvent,
  WashRequest,
  TaskStatus, VideoTools, VideoInfo, VideoRequest, VideoEvent, VideoTask, VideoFramePage,
} from './types'

export async function scanFiles(request: ScanRequest): Promise<ScanSummary> {
  return invoke<ScanSummary>('scan_files', { request })
}

export async function washFiles(
  request: WashRequest,
  onMessage: (event: WashEvent) => void,
): Promise<SessionRecord> {
  const channel = new Channel<WashEvent>()
  channel.onmessage = onMessage
  return invoke<SessionRecord>('wash_files', { request, onEvent: channel })
}

export async function restoreSession(
  sessionId: string,
  paths: string[],
  pathOverrides: Record<string, string>,
  onMessage: (event: RestoreEvent) => void,
): Promise<RestoreRecord> {
  const channel = new Channel<RestoreEvent>()
  channel.onmessage = onMessage
  return invoke<RestoreRecord>('restore_session', {
    request: { sessionId, paths, pathOverrides },
    onEvent: channel,
  })
}

export async function cancelTask(): Promise<boolean> {
  return invoke<boolean>('cancel_task')
}

export async function taskRunning(): Promise<boolean> {
  return invoke<boolean>('task_running')
}

export function getTaskStatus(): Promise<TaskStatus> {
  return invoke<TaskStatus>('task_status')
}

export function videoToolStatus(): Promise<VideoTools> {
  return invoke<VideoTools>('video_tool_status')
}

export function probeVideo(videoPath: string): Promise<VideoInfo> {
  return invoke<VideoInfo>('probe_video', { videoPath })
}

export function extractVideoFrames(request: VideoRequest, onMessage: (event: VideoEvent) => void): Promise<VideoTask> {
  const channel = new Channel<VideoEvent>()
  channel.onmessage = onMessage
  return invoke<VideoTask>('extract_video_frames', { request, onEvent: channel })
}

export function listVideoTasks(): Promise<VideoTask[]> {
  return invoke<VideoTask[]>('list_video_tasks')
}

export function getVideoTaskFrames(taskId: string, page: number): Promise<VideoFramePage> {
  return invoke<VideoFramePage>('get_video_task_frames', { taskId, page, pageSize: 24 })
}

export function openVideoOutput(taskId: string): Promise<void> {
  return invoke<void>('open_video_output', { taskId })
}

export function videoOutputSuggestion(videoPath: string, outputParent: string | null): Promise<string> {
  return invoke<string>('video_output_suggestion', { videoPath, outputParent })
}

export async function listHistory(): Promise<SessionRecord[]> {
  return invoke<SessionRecord[]>('list_history')
}

export async function getHistorySession(sessionId: string): Promise<SessionRecord> {
  return invoke<SessionRecord>('get_history_session', { sessionId })
}

export async function clearHistory(): Promise<void> {
  return invoke<void>('clear_history')
}

export async function exportSessionCsv(sessionId: string, outputPath: string): Promise<void> {
  return invoke<void>('export_session_csv', { sessionId, outputPath })
}
