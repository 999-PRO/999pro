// ============================================================================
// IframeAdapter — fallback: embed плеер сайта через iframe
// ----------------------------------------------------------------------------
// Используется когда прямой поток извлечь не удалось. Мы НЕ можем контролировать
// воспроизведение внутри iframe (cross-origin), но видео будет играть.
// Этот адаптер реализует интерфейс PlayerAdapter, но методы play/pause/seek —
// no-op (они не могут управлять iframe через cross-origin boundary).
// ============================================================================

import type { PlayerAdapter, PlayerEvent, AdapterState, StreamSource, StreamType, QualityLevel } from '../types'

export class IframeAdapter implements PlayerAdapter {
  readonly name = 'iframe'
  readonly supportedTypes: StreamType[] = ['iframe', 'unknown']

  private iframe: HTMLIFrameElement | null = null
  private source: StreamSource | null = null
  private state: AdapterState = 'idle'
  private eventHandler: ((event: PlayerEvent) => void) | null = null

  canHandle(url: string, type: StreamType): boolean {
    // iframe adapter is the universal fallback
    return type === 'iframe' || type === 'unknown' || true
  }

  setEventHandler(handler: (event: PlayerEvent) => void) {
    this.eventHandler = handler
  }

  private emit(event: PlayerEvent) {
    if (this.eventHandler) this.eventHandler(event)
  }

  private setState(state: AdapterState) {
    if (this.state === state) return
    this.state = state
    this.emit({ type: 'stateChange', state })
  }

  async init(video: HTMLVideoElement | HTMLIFrameElement, source: StreamSource): Promise<boolean> {
    if (!(video instanceof HTMLIFrameElement)) return false
    this.iframe = video
    this.source = source
    this.setState('loading')

    // Build the iframe URL
    let src = source.url
    // Some embed URLs need params for autoplay
    if (!/[?&]autoplay=/.test(src)) {
      src += (src.includes('?') ? '&' : '?') + 'autoplay=1'
    }

    this.iframe.src = src
    this.iframe.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture'

    // iframe fires load event when loaded (we can't detect playing state)
    this.iframe.onload = () => {
      this.setState('playing') // assume playing — we can't check
    }

    return true
  }

  // Iframe adapter can't control playback — methods are no-op
  async play(): Promise<void> {/* no-op for iframe */}
  pause(): void {/* no-op for iframe */}
  seek(_time: number): void {/* no-op for iframe */}
  setVolume(_volume: number): void {/* no-op for iframe */}
  setRate(_rate: number): void {/* no-op for iframe */}
  setLevel(_index: number): void {/* no-op for iframe */}

  getState(): AdapterState { return this.state }
  getCurrentTime(): number { return 0 } // unknown for iframe
  getDuration(): number { return 0 } // unknown for iframe

  destroy() {
    if (this.iframe) {
      this.iframe.onload = null
      this.iframe.removeAttribute('src')
      this.iframe = null
    }
    this.source = null
    this.state = 'idle'
    this.eventHandler = null
  }
}
