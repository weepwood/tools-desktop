export type WashMode = 'recoverable' | 'legacy'
export interface TaskStatus {
  running: boolean
  kind: string | null
  cancelling: boolean
}

export interface VideoTools {
  ffmpegPath: string
  ffprobePath: string
  ffmpegVersion: string
  ffprobeVersion: string
  source: string
}

export interface VideoInfo {
  path: string
  name: string
  durationSeconds: number | null
  width: number
  height: number
}

export interface VideoRequest {
  videoPath: string
  intervalSeconds: number
  outputParent: string | null
}

export type VideoStatus = 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted'
export interface VideoTask {
  schemaVersion: number
  id: string
  video: VideoInfo
  intervalSeconds: number
  outputDir: string
  startedAt: string
  finishedAt: string | null
  status: VideoStatus
  framesWritten: number
  elapsedMs: number
  ffmpegVersion: string
  error: string | null
  log: string
  historyError: string | null
}

export interface VideoEvent {
  taskId: string
  kind: 'started' | 'progress' | 'stopping' | 'completed' | 'cancelled' | 'failed'
  framesWritten: number
  progressPercent: number | null
  elapsedMs: number
  message: string | null
  outputDir: string
}

export interface VideoFrame {
  number: number
  name: string
  path: string
  thumbnailPath: string
}

export interface VideoFramePage {
  frames: VideoFrame[]
  total: number
  page: number
  pageSize: number
}
export type VerificationMode = 'fast' | 'sampled' | 'full'
export type FileStatus = 'success' | 'failed' | 'skipped'
export type RestoreStatus = 'success' | 'failed' | 'skipped'

export interface ScanRequest {
  rootPath: string
  recursive: boolean
  skipHidden: boolean
  skipSmall: boolean
  minSizeBytes: number
  extensions: string[]
}

export interface FileCandidate {
  path: string
  relativePath: string
  size: number
}

export interface ScanSummary {
  fingerprint: string
  unreadable: number
  warnings: string[]
  totalFiles: number
  totalBytes: number
  preview: FileCandidate[]
  hiddenSkipped: number
  smallSkipped: number
  extensionSkipped: number
}

export interface WashRequest extends ScanRequest {
  expectedScanFingerprint?: string
  mode: WashMode
  verificationMode: VerificationMode
  skipAlreadyWashed: boolean
}

export interface FileSample {
  offset: number
  length: number
  sha256: string
}

export interface FileRecord {
  pending?: boolean
  path: string
  relativePath: string
  status: FileStatus
  error: string | null
  beforeSize: number
  afterSize: number
  beforeSha256: string
  afterSha256: string
  appendedHex: string
  durationMs: number
  verificationMode: VerificationMode
  samples: FileSample[]
  beforeFileId: string | null
  afterFileId: string | null
  beforeModifiedNs: string | null
  afterModifiedNs: string | null
}

export interface RestoreFileRecord {
  path: string
  resolvedPath: string | null
  relativePath: string
  status: RestoreStatus
  error: string | null
  washedSize: number
  restoredSize: number
  washedSha256: string
  restoredSha256: string
  removedHex: string
  durationMs: number
}

export interface RestoreRecord {
  historyError?: string | null
  id: string
  startedAt: string
  finishedAt: string
  total: number
  success: number
  failed: number
  skipped: number
  cancelled: boolean
  files: RestoreFileRecord[]
}

export interface SessionRecord {
  taskError?: string | null
  interrupted?: boolean
  id: string
  startedAt: string
  finishedAt: string
  rootPath: string
  mode: WashMode
  verificationMode: VerificationMode
  total: number
  success: number
  failed: number
  skipped: number
  bytesAppended: number
  cancelled: boolean
  historyError: string | null
  restoreRuns: RestoreRecord[]
  files: FileRecord[]
}

export interface WashEvent {
  kind: 'started' | 'progress' | 'completed' | 'cancelled' | 'message'
  completed: number
  total: number
  currentFile: string | null
  result: FileRecord | null
  message: string | null
}

export interface RestoreEvent {
  kind: 'started' | 'progress' | 'completed' | 'cancelled' | 'message'
  completed: number
  total: number
  currentFile: string | null
  result: RestoreFileRecord | null
  message: string | null
}
