// ============================================================================
// Player Engine — типы и интерфейсы (v18.2)
// ============================================================================

export type StreamType = 'hls' | 'dash' | 'mp4' | 'webm' | 'iframe' | 'unknown'

export type AdapterState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error' | 'ended'

export interface StreamSource {
  url: string
  type: StreamType
  quality?: string
  levels?: QualityLevel[]
  translation?: string
  label?: string
}

export interface QualityLevel {
  height: number
  bitrate?: number
  label: string
}

export type PlayerEvent =
  | { type: 'stateChange'; state: AdapterState }
  | { type: 'timeUpdate'; currentTime: number; duration: number }
  | { type: 'progress'; buffered: number }
  | { type: 'durationChange'; duration: number }
  | { type: 'levelsChange'; levels: QualityLevel[]; currentLevel: number }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'ended' }

export interface PlayerAdapter {
  readonly name: string
  readonly supportedTypes: StreamType[]
  canHandle(url: string, type: StreamType): boolean
  init(videoElement: HTMLVideoElement | HTMLIFrameElement, source: StreamSource): Promise<boolean>
  play(): Promise<void>
  pause(): void
  seek(time: number): void
  setVolume(volume: number): void
  setRate(rate: number): void
  setLevel(index: number): void
  setEventHandler(handler: (event: PlayerEvent) => void): void
  getState(): AdapterState
  getCurrentTime(): number
  getDuration(): number
  destroy(): void
}

export function detectStreamType(url: string): StreamType {
  const lower = url.toLowerCase().split('?')[0].split('#')[0]
  if (lower.endsWith('.m3u8') || lower.includes('.m3u8')) return 'hls'
  if (lower.endsWith('.mpd') || lower.includes('.mpd')) return 'dash'
  if (lower.endsWith('.mp4') || lower.includes('.mp4')) return 'mp4'
  if (lower.endsWith('.webm')) return 'webm'
  if (lower.endsWith('.mkv')) return 'mp4'
  if (lower.endsWith('.mov') || lower.endsWith('.m4v')) return 'mp4'
  if (/kodikplayer|tuser\.online|videocdn|videoapi|hdgo|hdvb|voidboost|alloha|newplayjj|ortified|cdnvideohub|interkh/.test(lower)) return 'iframe'
  if (/\/embed\//.test(lower)) return 'iframe'
  return 'unknown'
}

export const ADAPTER_PRIORITY: StreamType[] = ['hls', 'dash', 'mp4', 'webm', 'iframe', 'unknown']
