'use client'

// ============================================================================
// PlayerEngine — ядро модульной системы воспроизведения
// ----------------------------------------------------------------------------
// Engine управляет:
//   • Регистрацией адаптеров (HLS, DASH, Native, Iframe)
//   • Автоопределением типа потока
//   • Автовыбором подходящего адаптера
//   • Fallback-цепочкой: если первый адаптер не работает — пробуем следующий
//   • Fallback по источникам: если все адаптеры для одного player не сработали —
//     переходим к следующему player
//   • Событиями для UI
//   • Управлением качеством (auto + manual)
//   • Продолжением просмотра с последней позиции
//
// Жизненный цикл:
//   1. engine.setSources(players) — передаём список источников
//   2. engine.start(videoEl, iframeEl) — запускаем воспроизведение
//   3. Engine пробует каждый источник, для каждого — каждый подходящий адаптер
//   4. Первый успешно инициализированный адаптер становится активным
//   5. UI получает события через engine.onEvent(callback)
// ============================================================================

import type {
  PlayerAdapter,
  PlayerEvent,
  AdapterState,
  StreamSource,
  StreamType,
  QualityLevel,
} from './types'
import { detectStreamType, ADAPTER_PRIORITY } from './types'
import { HlsAdapter } from './adapters/hls-adapter'
import { DashAdapter } from './adapters/dash-adapter'
import { NativeAdapter } from './adapters/native-adapter'
import { IframeAdapter } from './adapters/iframe-adapter'

export interface PlayerEngineOptions {
  /** Максимальное время ожидания инициализации адаптера (мс) */
  initTimeout?: number
  /** Авто-возобновление с позиции (секунды) */
  resumeFrom?: number
  /** Авто-play после инициализации */
  autoPlay?: boolean
  /** Callback для логирования (debug) */
  onLog?: (msg: string) => void
}

export class PlayerEngine {
  private adapters: PlayerAdapter[] = []
  private activeAdapter: PlayerAdapter | null = null
  private sources: StreamSource[][] = [] // [playerIndex][streamIndex]
  private currentSourceIndex = 0
  private currentStreamIndex = 0
  private videoEl: HTMLVideoElement | null = null
  private iframeEl: HTMLIFrameElement | null = null
  private eventHandler: ((event: PlayerEvent) => void) | null = null
  private options: PlayerEngineOptions
  private destroyed = false
  private tryingNextTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(options: PlayerEngineOptions = {}) {
    this.options = {
      initTimeout: 12000,
      autoPlay: true,
      ...options,
    }
    // Register built-in adapters in priority order
    this.registerAdapter(new HlsAdapter())
    this.registerAdapter(new DashAdapter())
    this.registerAdapter(new NativeAdapter())
    this.registerAdapter(new IframeAdapter()) // always last (fallback)
  }

  /** Регистрирует новый адаптер (для расширяемости) */
  registerAdapter(adapter: PlayerAdapter) {
    this.adapters.push(adapter)
  }

  /** Устанавливает callback для событий */
  onEvent(handler: (event: PlayerEvent) => void) {
    this.eventHandler = handler
  }

  private emit(event: PlayerEvent) {
    if (this.eventHandler) this.eventHandler(event)
  }

  private log(msg: string) {
    if (this.options.onLog) this.options.onLog(`[PlayerEngine] ${msg}`)
  }

  /**
   * Устанавливает источники для воспроизведения.
   * sources — массив "игроков", каждый игрок — массив потоков.
   * Engine попробует первый поток первого игрока, потом второй поток первого
   * игрока, и т.д. Если все потоки первого игрока не сработали — переходит
   * ко второму игроку.
   */
  setSources(sources: StreamSource[][]) {
    this.sources = sources
    this.currentSourceIndex = 0
    this.currentStreamIndex = 0
  }

  /**
   * Запускает воспроизведение.
   * Engine автоматически перебирает источники и адаптеры, пока не найдёт рабочий.
   */
  async start(videoEl: HTMLVideoElement, iframeEl: HTMLIFrameElement): Promise<void> {
    if (this.destroyed) return
    this.videoEl = videoEl
    this.iframeEl = iframeEl

    if (this.sources.length === 0) {
      this.log('No sources provided')
      this.emit({ type: 'error', message: 'Нет источников для воспроизведения', recoverable: false })
      return
    }

    this.log(`Starting with ${this.sources.length} source(s)`)
    await this.tryCurrentSource()
  }

  /** Пробует текущий источник (currentSourceIndex / currentStreamIndex) */
  private async tryCurrentSource(): Promise<void> {
    if (this.destroyed) return

    const player = this.sources[this.currentSourceIndex]
    if (!player || this.currentStreamIndex >= player.length) {
      // No more streams for this player — try next player
      this.log(`No more streams for player ${this.currentSourceIndex}, trying next`)
      this.currentSourceIndex++
      this.currentStreamIndex = 0
      if (this.currentSourceIndex >= this.sources.length) {
        // All sources exhausted
        this.log('All sources exhausted')
        this.emit({
          type: 'error',
          message: 'Не удалось воспроизвести видео ни из одного источника',
          recoverable: false,
        })
        return
      }
      return this.tryCurrentSource()
    }

    const stream = player[this.currentStreamIndex]
    this.log(`Trying source ${this.currentSourceIndex}.${this.currentStreamIndex}: ${stream.url.slice(0, 80)}... (type: ${stream.type})`)

    // Find suitable adapter
    const adapter = this.findAdapter(stream.url, stream.type)
    if (!adapter) {
      this.log(`No adapter for type ${stream.type}, skipping`)
      this.currentStreamIndex++
      return this.tryCurrentSource()
    }

    // Destroy previous adapter
    if (this.activeAdapter) {
      try { this.activeAdapter.destroy() } catch {}
      this.activeAdapter = null
    }

    // Set up event handler for this adapter
    adapter.setEventHandler((event) => this.handleAdapterEvent(event, adapter, stream))

    // Choose the right element
    const el = adapter.name === 'iframe' ? this.iframeEl! : this.videoEl!

    // Try to init with timeout
    const success = await this.initWithTimeout(adapter, el, stream)
    if (!success) {
      this.log(`Adapter ${adapter.name} init failed for stream ${this.currentStreamIndex}`)
      this.currentStreamIndex++
      return this.tryCurrentSource()
    }

    this.activeAdapter = adapter
    this.log(`Adapter ${adapter.name} initialized successfully`)

    // Resume from position if specified
    if (this.options.resumeFrom && this.options.resumeFrom > 5 && adapter.name !== 'iframe') {
      try {
        adapter.seek(this.options.resumeFrom)
        this.log(`Resumed from ${this.options.resumeFrom}s`)
      } catch {}
    }

    // Auto-play
    if (this.options.autoPlay) {
      try { await adapter.play() } catch {}
    }
  }

  /** Инициализация адаптера с timeout */
  private async initWithTimeout(
    adapter: PlayerAdapter,
    el: HTMLVideoElement | HTMLIFrameElement,
    stream: StreamSource
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let resolved = false
      const finish = (val: boolean) => {
        if (resolved) return
        resolved = true
        if (this.tryingNextTimeout) {
          clearTimeout(this.tryingNextTimeout)
          this.tryingNextTimeout = null
        }
        resolve(val)
      }

      // Timeout — if init doesn't resolve in time, treat as failure
      // For iframe, give much more time (iframe can take 15+ seconds to load)
      const timeout = adapter.name === 'iframe' ? 20000 : this.options.initTimeout!
      this.tryingNextTimeout = setTimeout(() => {
        this.log(`Adapter ${adapter.name} init timed out (${timeout}ms)`)
        finish(false)
      }, timeout)

      // For video adapters, we consider init successful if 'ready' or 'playing'
      // fires within a reasonable time. For iframe, just init returning true is enough.
      adapter.init(el, stream)
        .then((ok) => {
          if (!ok) {
            finish(false)
            return
          }
          // For iframe, success immediately — don't wait for 'ready' state
          // (iframe fires load event asynchronously, and we can't detect
          // playing state inside cross-origin iframe)
          if (adapter.name === 'iframe') {
            finish(true)
            return
          }
          // For video adapters, wait for 'ready'/'playing' state or error
          // Give 15 seconds — some HLS streams take a while to start, especially
          // from sources that are geographically distant
          const readyTimeout = setTimeout(() => {
            // If we're still in 'loading' after 15s, but no error, consider it working
            // (some streams take long to start but will eventually play)
            const state = adapter.getState()
            if (state === 'loading' || state === 'playing' || state === 'ready') {
              this.log(`Adapter ${adapter.name} still ${state} after 15s — considering working`)
              finish(true)
            } else if (state === 'error') {
              finish(false)
            } else {
              finish(true)
            }
          }, 8000)

          // Override setEventHandler to catch state changes
          const origHandler = (event: PlayerEvent) => {
            this.handleAdapterEvent(event, adapter, stream)
            if (event.type === 'stateChange') {
              if (event.state === 'ready' || event.state === 'playing') {
                clearTimeout(readyTimeout)
                finish(true)
              } else if (event.state === 'error') {
                clearTimeout(readyTimeout)
                finish(false)
              }
            } else if (event.type === 'error' && !event.recoverable) {
              clearTimeout(readyTimeout)
              finish(false)
            }
          }
          adapter.setEventHandler(origHandler)
        })
        .catch(() => finish(false))
    })
  }

  /** Находит подходящий адаптер для URL/типа */
  private findAdapter(url: string, type: StreamType): PlayerAdapter | null {
    // If type is unknown, detect it
    const detectedType = type === 'unknown' ? detectStreamType(url) : type

    // Try adapters in priority order
    for (const adapterType of ADAPTER_PRIORITY) {
      const adapter = this.adapters.find(a => a.supportedTypes.includes(adapterType))
      if (adapter && adapter.canHandle(url, detectedType)) {
        return adapter
      }
    }
    // If nothing matched, return iframe as ultimate fallback
    return this.adapters.find(a => a.name === 'iframe') || null
  }

  /** Обрабатывает события от адаптера */
  private handleAdapterEvent(
    event: PlayerEvent,
    adapter: PlayerAdapter,
    _stream: StreamSource
  ) {
    if (this.destroyed) return
    if (this.activeAdapter !== adapter) return // stale adapter

    // Forward event to UI — BUT suppress error events if we can still try
    // another source. Only show the error to the UI if ALL sources are exhausted.
    if (event.type === 'error') {
      // Try next source silently
      this.log(`Error from ${adapter.name}: ${event.message} (recoverable=${event.recoverable})`)
      // Always try next source on any error (recoverable or not)
      this.currentStreamIndex++
      // Small delay before retry
      setTimeout(() => this.tryCurrentSource(), 300)
      return // Don't forward error to UI yet
    }

    this.emit(event)
  }

  // ---- Public control methods ----

  play() { this.activeAdapter?.play() }
  pause() { this.activeAdapter?.pause() }
  seek(time: number) { this.activeAdapter?.seek(time) }
  setVolume(vol: number) { this.activeAdapter?.setVolume(vol) }
  setRate(rate: number) { this.activeAdapter?.setRate(rate) }
  setLevel(index: number) { this.activeAdapter?.setLevel(index) }

  getState(): AdapterState { return this.activeAdapter?.getState() || 'idle' }
  getCurrentTime(): number { return this.activeAdapter?.getCurrentTime() || 0 }
  getDuration(): number { return this.activeAdapter?.getDuration() || 0 }

  /** Возвращает текущий активный адаптер (для UI) */
  getActiveAdapterName(): string { return this.activeAdapter?.name || 'none' }

  /** Принудительно переключиться на следующий источник */
  forceNextSource() {
    this.currentStreamIndex++
    this.tryCurrentSource()
  }

  /** Принудительно переключиться на конкретный источник */
  switchToSource(playerIndex: number, streamIndex: number = 0) {
    if (playerIndex < 0 || playerIndex >= this.sources.length) return
    this.currentSourceIndex = playerIndex
    this.currentStreamIndex = streamIndex
    this.tryCurrentSource()
  }

  /** Уничтожает engine и освобождает ресурсы */
  destroy() {
    this.destroyed = true
    if (this.tryingNextTimeout) {
      clearTimeout(this.tryingNextTimeout)
      this.tryingNextTimeout = null
    }
    if (this.activeAdapter) {
      try { this.activeAdapter.destroy() } catch {}
      this.activeAdapter = null
    }
    this.eventHandler = null
    this.videoEl = null
    this.iframeEl = null
  }
}
