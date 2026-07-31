// ============================================================================
// NativeAdapter — воспроизведение MP4, WebM, MOV напрямую через <video>
// ============================================================================

import type { StreamType, StreamSource } from '../types'
import { BaseVideoAdapter } from './base-video-adapter'

export class NativeAdapter extends BaseVideoAdapter {
  readonly name = 'native'
  readonly supportedTypes: StreamType[] = ['mp4', 'webm']

  canHandle(url: string, type: StreamType): boolean {
    if (type === 'mp4' || type === 'webm') return true
    const lower = url.toLowerCase().split('?')[0]
    return lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov') || lower.endsWith('.m4v') || lower.endsWith('.mkv')
  }

  async init(video: HTMLVideoElement | HTMLIFrameElement, source: StreamSource): Promise<boolean> {
    if (!(video instanceof HTMLVideoElement)) return false
    this.video = video
    this.source = source
    this.setState('loading')

    // Set the source directly
    video.src = source.url
    video.load()

    this.attachVideoListeners()
    return true
  }

  protected cleanupMedia(): void {
    if (this.video) {
      try { this.video.removeAttribute('src') } catch {}
      try { this.video.load() } catch {}
    }
  }
}
