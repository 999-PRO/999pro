// ============================================================================
// DashAdapter — воспроизведение MPEG-DASH (.mpd) через dash.js
// ============================================================================

import type { StreamType, StreamSource, QualityLevel } from '../types'
import { BaseVideoAdapter } from './base-video-adapter'

export class DashAdapter extends BaseVideoAdapter {
  readonly name = 'dash'
  readonly supportedTypes: StreamType[] = ['dash']
  private player: any = null

  canHandle(url: string, type: StreamType): boolean {
    return type === 'dash' || url.toLowerCase().endsWith('.mpd')
  }

  async init(video: HTMLVideoElement | HTMLIFrameElement, source: StreamSource): Promise<boolean> {
    if (!(video instanceof HTMLVideoElement)) return false
    this.video = video
    this.source = source
    this.setState('loading')

    try {
      const mod = await import('dashjs')
      const dashjs: any = (mod as any).default || mod
      this.player = dashjs.MediaPlayer().create()

      this.player.updateSettings({
        streaming: {
          // Fast start
          lowLatencyEnabled: false,
          abr: {
            autoSwitchBitrate: { video: true, audio: true },
          },
          buffer: {
            fastSwitchEnabled: true,
            bufferTimeAtTopQuality: 30,
            bufferTimeAtTopQualityLongForm: 60,
          },
        },
        debug: { logLevel: 0 },
      })

      this.player.initialize(video, source.url, false)

      // Quality levels
      this.player.on('streamInitialized', () => {
        const bitrates = this.player.getBitrateInfoListFor('video') || []
        const levels: QualityLevel[] = bitrates.map((b: any) => ({
          height: b.height || 0,
          bitrate: b.bitrate,
          label: b.height ? `${b.height}p` : `${Math.round((b.bitrate || 0) / 1000)}kbps`,
        }))
        this.levels = levels
        this.currentLevel = -1
        this.emit({ type: 'levelsChange', levels, currentLevel: -1 })
      })

      this.player.on('error', (e: any) => {
        // dashjs error — try to recover
        if (this.player) {
          try { this.player.reset() } catch {}
        }
        this.emit({
          type: 'error',
          message: 'DASH поток недоступен',
          recoverable: true,
        })
        this.setState('error')
      })

      this.attachVideoListeners()
      return true
    } catch {
      return false
    }
  }

  setLevel(index: number): void {
    this.currentLevel = index
    if (this.player) {
      if (index === -1) {
        this.player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } })
      } else if (this.levels[index]) {
        this.player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } })
        this.player.setRepresentationForTypeById('video', index)
      }
    }
  }

  protected cleanupMedia(): void {
    if (this.player) {
      try { this.player.reset() } catch {}
      try { this.player.destroy() } catch {}
      this.player = null
    }
    if (this.video) {
      try { this.video.removeAttribute('src') } catch {}
      try { this.video.load() } catch {}
    }
  }
}
