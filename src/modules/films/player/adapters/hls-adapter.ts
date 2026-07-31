// ============================================================================
// HlsAdapter — воспроизведение HLS (m3u8) через hls.js или нативно (Safari)
// ============================================================================

import type { PlayerAdapter, PlayerEvent, StreamSource, StreamType, QualityLevel } from '../types'
import { BaseVideoAdapter } from './base-video-adapter'

export class HlsAdapter extends BaseVideoAdapter {
  readonly name = 'hls'
  readonly supportedTypes: StreamType[] = ['hls']
  private hls: any = null

  canHandle(url: string, type: StreamType): boolean {
    return type === 'hls' || url.toLowerCase().includes('.m3u8')
  }

  async init(video: HTMLVideoElement | HTMLIFrameElement, source: StreamSource): Promise<boolean> {
    if (!(video instanceof HTMLVideoElement)) return false
    this.video = video
    this.source = source
    this.setState('loading')

    const url = source.url

    // Native HLS support (Safari, iOS)
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url
      this.attachVideoListeners()
      return true
    }

    // Use hls.js
    try {
      const mod = await import('hls.js')
      const Hls = mod.default
      if (!Hls.isSupported()) return false

      this.hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 60,
        // Don't send credentials — most CDNs don't support CORS with credentials
        xhrSetup: (xhr: XMLHttpRequest) => { xhr.withCredentials = false },
        // Be tolerant of errors
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 800,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 6,
        // Auto quality selection
        startLevel: -1,
        abrEwmaDefaultEstimate: 500000,
        // Buffer tuning for fast start
        maxBufferLength: 30,
        maxBufferSize: 60 * 1000 * 1000,
      })

      this.hls.loadSource(url)
      this.hls.attachMedia(video)

      // Expose quality levels
      this.hls.on(Hls.Events.MANIFEST_PARSED, (_event: any, data: any) => {
        const levels: QualityLevel[] = (data.levels || []).map((l: any, i: number) => ({
          height: l.height || 0,
          bitrate: l.bitrate,
          label: l.height ? `${l.height}p` : `Variant ${i + 1}`,
        }))
        this.levels = levels
        this.currentLevel = -1 // auto
        this.emit({ type: 'levelsChange', levels, currentLevel: -1 })
      })

      this.hls.on(Hls.Events.LEVEL_SWITCHED, (_event: any, data: any) => {
        this.currentLevel = data.level
        this.emit({ type: 'levelsChange', levels: this.levels, currentLevel: data.level })
      })

      // Auto-recovery from errors
      this.hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
        if (!data.fatal) return
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            this.hls.startLoad()
            break
          case Hls.ErrorTypes.MEDIA_ERROR:
            this.hls.recoverMediaError()
            break
          default:
            this.emit({
              type: 'error',
              message: 'HLS поток недоступен',
              recoverable: true,
            })
            this.setState('error')
            break
        }
      })

      this.attachVideoListeners()
      return true
    } catch {
      return false
    }
  }

  setLevel(index: number): void {
    this.currentLevel = index
    if (this.hls) {
      // -1 = auto (ABR), otherwise specific level
      this.hls.currentLevel = index
    }
  }

  protected cleanupMedia(): void {
    if (this.hls) {
      try { this.hls.destroy() } catch {}
      this.hls = null
    }
    if (this.video) {
      try { this.video.removeAttribute('src') } catch {}
      try { this.video.load() } catch {}
    }
  }
}
