// ============================================================================
// BaseVideoAdapter — общая логика для адаптеров на HTMLVideoElement
// ----------------------------------------------------------------------------
// HLS, DASH, Native адаптеры работают поверх <video>. Этот базовый класс
// содержит общую логику работы с video element, чтобы не дублировать код.
// ============================================================================

import type { PlayerAdapter, PlayerEvent, AdapterState, StreamSource, QualityLevel } from '../types'

export abstract class BaseVideoAdapter implements PlayerAdapter {
  abstract readonly name: string
  abstract readonly supportedTypes: any[]

  protected video: HTMLVideoElement | null = null
  protected source: StreamSource | null = null
  protected state: AdapterState = 'idle'
  protected levels: QualityLevel[] = []
  protected currentLevel = -1
  protected eventHandler: ((event: PlayerEvent) => void) | null = null

  abstract canHandle(url: string, type: any): boolean
  abstract init(video: HTMLVideoElement | HTMLIFrameElement, source: StreamSource): Promise<boolean>
  protected abstract cleanupMedia(): void

  setEventHandler(handler: (event: PlayerEvent) => void) {
    this.eventHandler = handler
  }

  protected emit(event: PlayerEvent) {
    if (this.eventHandler) this.eventHandler(event)
  }

  protected setState(state: AdapterState) {
    if (this.state === state) return
    this.state = state
    this.emit({ type: 'stateChange', state })
  }

  protected attachVideoListeners() {
    if (!this.video) return
    const v = this.video

    this._onLoaded = () => {
      this.setState('ready')
      this.emit({ type: 'durationChange', duration: v.duration || 0 })
    }
    this._onTimeUpdate = () => {
      this.emit({ type: 'timeUpdate', currentTime: v.currentTime, duration: v.duration || 0 })
    }
    this._onProgress = () => {
      if (v.buffered.length > 0) {
        this.emit({ type: 'progress', buffered: v.buffered.end(v.buffered.length - 1) })
      }
    }
    this._onPlay = () => this.setState('playing')
    this._onPause = () => this.setState('paused')
    this._onWaiting = () => this.setState('loading')
    this._onPlaying = () => this.setState('playing')
    this._onEnded = () => {
      this.setState('ended')
      this.emit({ type: 'ended' })
    }
    this._onError = () => {
      this.emit({
        type: 'error',
        message: 'Ошибка воспроизведения видео',
        recoverable: true,
      })
      this.setState('error')
    }

    v.addEventListener('loadedmetadata', this._onLoaded)
    v.addEventListener('timeupdate', this._onTimeUpdate)
    v.addEventListener('progress', this._onProgress)
    v.addEventListener('play', this._onPlay)
    v.addEventListener('pause', this._onPause)
    v.addEventListener('waiting', this._onWaiting)
    v.addEventListener('playing', this._onPlaying)
    v.addEventListener('ended', this._onEnded)
    v.addEventListener('error', this._onError)
  }

  protected detachVideoListeners() {
    if (!this.video || !this._onLoaded) return
    const v = this.video
    v.removeEventListener('loadedmetadata', this._onLoaded)
    v.removeEventListener('timeupdate', this._onTimeUpdate as EventListener)
    v.removeEventListener('progress', this._onProgress as EventListener)
    v.removeEventListener('play', this._onPlay as EventListener)
    v.removeEventListener('pause', this._onPause as EventListener)
    v.removeEventListener('waiting', this._onWaiting as EventListener)
    v.removeEventListener('playing', this._onPlaying as EventListener)
    v.removeEventListener('ended', this._onEnded as EventListener)
    v.removeEventListener('error', this._onError as EventListener)
  }

  private _onLoaded: (() => void) | null = null
  private _onTimeUpdate: (() => void) | null = null
  private _onProgress: (() => void) | null = null
  private _onPlay: (() => void) | null = null
  private _onPause: (() => void) | null = null
  private _onWaiting: (() => void) | null = null
  private _onPlaying: (() => void) | null = null
  private _onEnded: (() => void) | null = null
  private _onError: (() => void) | null = null

  async play(): Promise<void> {
    if (this.video) {
      try { await this.video.play() } catch {/* user gesture required */}
    }
  }

  pause(): void {
    if (this.video) this.video.pause()
  }

  seek(time: number): void {
    if (this.video) this.video.currentTime = time
  }

  setVolume(volume: number): void {
    if (this.video) {
      this.video.volume = volume
      this.video.muted = volume === 0
    }
  }

  setRate(rate: number): void {
    if (this.video) this.video.playbackRate = rate
  }

  setLevel(index: number): void {
    this.currentLevel = index
    // override in subclasses
  }

  getState(): AdapterState { return this.state }
  getCurrentTime(): number { return this.video?.currentTime || 0 }
  getDuration(): number { return this.video?.duration || 0 }
  getLevels(): QualityLevel[] { return this.levels }

  destroy() {
    this.detachVideoListeners()
    this.cleanupMedia()
    this.video = null
    this.source = null
    this.state = 'idle'
    this.eventHandler = null
  }
}
