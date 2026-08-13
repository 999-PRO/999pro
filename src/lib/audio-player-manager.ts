'use client'

// ============================================================================
// AudioPlayerManager — единый менеджер воспроизведения для ВСЕГО приложения.
// ----------------------------------------------------------------------------
// Гарантирует инвариант: одновременно играет ТОЛЬКО ОДИН аудиофайл.
//
// Архитектура:
//   • Один HTMLAudioElement (singleton, создаётся lazily при первом play()).
//   • Zustand store для reactive состояния (currentTrack, isPlaying, progress).
//   • Любой компонент (AudioMessage, MusicPlayer, MiniPlayer) вызывает
//     useAudioPlayer() и читает состояние. Любой может вызвать play()/pause().
//
// Когда вызывается play(track):
//   1. Если уже играет этот же url → toggle (pause/resume).
//   2. Если играет другой url → останавливаем предыдущий, загружаем новый.
//   3. Обновляем currentTrack в store, запускаем воспроизведение.
//
// События audio (timeupdate, ended, etc.) обновляют store — все подписчики
// перерисовываются с актуальным progress/duration.
//
// Фоновое воспроизведение: HTMLAudioElement живёт в модуле (не в React),
// поэтому переживает unmount любого компонента. Музыка продолжает играть
// при переходах между страницами и закрытии чата.
//
// Repeat / Shuffle / Queue:
//   • queue — массив треков (плейлист).
//   • queueIndex — текущий индекс.
//   • next()/prev() — навигация по очереди (с учётом shuffle).
//   • repeat: 'off' | 'all' | 'one'.
//   • При ended: auto-next (или repeat-one перезапускает трек).
//
// v16.15: YouTube IFrame Player полностью удалён. Все треки проигрываются
// через HTMLAudioElement + backend /stream прокси. Источники:
// hitmos.fm, muzjam.org, Audius, archive.org, RadioBrowser, alquran.cloud.
// ============================================================================

import { create } from 'zustand'

// ---- Types ----

export type AudioTrackKind = 'voice' | 'music'

export interface AudioTrack {
  /** Уникальный id (message id или составной). */
  id: string
  /** Полный URL аудиофайла. */
  url: string
  /** Тип трека — влияет на UI (voice = compact, music = full player). */
  kind: AudioTrackKind
  /** Отображаемое название (для музыки — название трека, для voice — sender). */
  title: string
  /** Подзаголовок (исполнитель для музыки, длительность для voice). */
  subtitle?: string
  /** URL обложки (для музыки — album art, для voice — avatar). */
  coverUrl?: string
  /** Длительность в секундах (если известна заранее). */
  duration?: number
  /** ID разговора, к которому принадлежит трек (для контекста). */
  conversationId?: string
  /** Отправитель (для отображения в списке). */
  senderName?: string
  /** Sender avatar URL. */
  senderAvatar?: string
  /** ISO timestamp создания (для сортировки). */
  createdAt?: string
  /** v16.14: Source identifier — for the SourceBadge UI component.
   *  Matches AudioHubTrack['source']: 'hitmos' | 'muzjam' | 'audius' | 'archive' | 'jamendo' | 'radio' | 'quran'. */
  source?: string
}

export type RepeatMode = 'off' | 'all' | 'one'
export type PlaybackRate = 1 | 1.25 | 1.5 | 2

interface AudioPlayerState {
  // ---- Current playback ----
  currentTrack: AudioTrack | null
  isPlaying: boolean
  /** Прогресс 0..1. */
  progress: number
  /** Текущая позиция в секундах. */
  currentTime: number
  /** Длительность в секундах (из метаданных). */
  duration: number
  /** Скорость воспроизведения. */
  playbackRate: PlaybackRate
  /** Загружается ли трек (между play() и canplay). */
  isLoading: boolean
  /** v25.10: True while the browser is seeking to a new position
   *  (set on `seeking` event, cleared on `seeked`). Used by the UI to
   *  show a "seeking…" state and freeze the time display so it doesn't
   *  flicker between the old and new positions. */
  isSeeking: boolean

  // ---- Queue (playlist) ----
  queue: AudioTrack[]
  queueIndex: number

  // ---- Modes ----
  repeat: RepeatMode
  shuffle: boolean

  // ---- Favorites (по track.id) ----
  favorites: Set<string>

  // ---- Actions ----
  play: (track: AudioTrack, queue?: AudioTrack[]) => void
  togglePlay: () => void
  pause: () => void
  resume: () => void
  stop: () => void
  seek: (fraction: number) => void
  seekTo: (seconds: number) => void
  next: () => void
  prev: () => void
  setRepeat: (mode: RepeatMode) => void
  toggleShuffle: () => void
  setPlaybackRate: (rate: PlaybackRate) => void
  toggleFavorite: (trackId: string) => void
  isFavorite: (trackId: string) => boolean
  /** Внутреннее — обновление прогресса из RAF loop. */
  _tick: () => void
}

// ---- Singleton audio element ----
// Создаётся lazily при первом play() — чтобы не блокировать SSR.
let audioEl: HTMLAudioElement | null = null
let rafId: number | null = null
// v25.10: tracks whether we've already bound the mediaSession action
// handlers (they're idempotent — re-binding the same handler overwrites
// the previous one, but we skip the work to avoid console noise).
let mediaSessionHandlersBound = false

function getAudioEl(): HTMLAudioElement {
  if (typeof window === 'undefined') {
    // SSR guard — never reached in practice (play is client-only).
    throw new Error('AudioPlayerManager used during SSR')
  }
  if (!audioEl) {
    audioEl = new Audio()
    audioEl.preload = 'metadata'
    // По умолчанию браузеры могут блокировать автоплей со звуком без
    // user gesture. Все вызовы play() идут из click handler'ов — жест
    // пользователя есть.
    audioEl.crossOrigin = 'anonymous'
  }
  return audioEl
}

// ---- Helpers ----

/** Shuffle array (Fisher-Yates), возвращает новую копию. */
function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---- Store ----

export const useAudioPlayer = create<AudioPlayerState>((set, get) => {
  // ---- Wire audio element events (once) ----
  // Мы делаем это внутри create() — он вызывается один раз (singleton store).
  if (typeof window !== 'undefined') {
    const el = getAudioEl()

    el.addEventListener('loadedmetadata', () => {
      set({ duration: el.duration && isFinite(el.duration) ? el.duration : 0 })
    })

    el.addEventListener('timeupdate', () => {
      const d = el.duration
      if (!d || !isFinite(d)) return
      // v25.10: don't update currentTime/progress while the browser is
      // mid-seek — the value flickers between the old and new positions
      // and causes the "1-2s loop / stutter" the user reported.
      if (get().isSeeking) return
      set({
        currentTime: el.currentTime,
        progress: el.currentTime / d,
      })
    })

    el.addEventListener('play', () => {
      set({ isPlaying: true, isLoading: false })
      try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing' } catch {}
    })
    el.addEventListener('pause', () => {
      set({ isPlaying: false })
      try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused' } catch {}
    })

    el.addEventListener('waiting', () => set({ isLoading: true }))
    el.addEventListener('canplay', () => set({ isLoading: false }))

    // v25.10: seeking / seeked events — these fire when the browser issues
    // a Range request to fetch a new playback position. Seeking is async
    // (browser fetches the byte range from the server). Without tracking
    // this state, the timeupdate handler above races with the seek and the
    // displayed position "jumps" between old/new — exactly the user-visible
    // bug where the music "loops 1-2 seconds" while seeking.
    el.addEventListener('seeking', () => set({ isSeeking: true }))
    el.addEventListener('seeked', () => {
      const d = el.duration
      set({
        isSeeking: false,
        currentTime: el.currentTime,
        progress: d && isFinite(d) ? el.currentTime / d : 0,
      })
    })

    el.addEventListener('ended', () => {
      const st = get()
      // Repeat one — перезапускаем тот же трек.
      if (st.repeat === 'one') {
        el.currentTime = 0
        void el.play()
        return
      }
      // Иначе — auto-next.
      get().next()
    })

    el.addEventListener('error', () => {
      set({ isPlaying: false, isLoading: false })
    })
  }

  return {
    // ---- State ----
    currentTrack: null,
    isPlaying: false,
    progress: 0,
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
    isLoading: false,
    isSeeking: false,
    queue: [],
    queueIndex: -1,
    repeat: 'off',
    shuffle: false,
    favorites: new Set<string>(),

    // ---- Actions ----

    play: (track, queue) => {
      const el = getAudioEl()
      const st = get()

      // Если уже играет этот же трек — toggle pause/resume.
      // v16.17: BUT only if not currently loading. If isLoading, the first
      // click is still in progress — ignore the second click instead of
      // toggling to pause (which was causing the "need to click twice" bug).
      if (st.currentTrack?.id === track.id) {
        if (st.isLoading) {
          // First click is still loading the track — ignore this click.
          // The track will start playing once loading completes.
          return
        }
        if (el.paused) {
          void el.play().catch(() => {})
        } else {
          el.pause()
        }
        return
      }

      // Новый трек — загружаем.
      // Если передана очередь — устанавливаем её и находим индекс трека.
      if (queue && queue.length > 0) {
        const idx = queue.findIndex((t) => t.id === track.id)
        set({
          queue,
          queueIndex: idx >= 0 ? idx : 0,
        })
      } else if (st.queue.length === 0 || !st.queue.some((t) => t.id === track.id)) {
        // Нет очереди — создаём синглтон-очередь из этого трека.
        set({ queue: [track], queueIndex: 0 })
      } else {
        // Очередь есть, трек в ней — обновляем индекс.
        const idx = st.queue.findIndex((t) => t.id === track.id)
        if (idx >= 0) set({ queueIndex: idx })
      }

      // v16.10: Resolve URL through backend proxy for CORS safety.
      // All tracks go through the same /api/audio-hub/stream proxy which adds
      // CORS headers + caches the response in IndexedDB for offline playback.
      // v18.7: EXCLUDE /uploads/* (voice messages + uploaded files) — they
      // are served by our own backend with CORS already configured and don't
      // need the stream proxy (which would break with relative URLs).
      let resolvedUrl = track.url
      if (
        resolvedUrl &&
        !resolvedUrl.startsWith('blob:') &&
        !resolvedUrl.startsWith('/api/') &&
        !resolvedUrl.startsWith('/uploads/') &&
        !resolvedUrl.startsWith(window.location.origin)
      ) {
        resolvedUrl = `/api/audio-hub/stream?url=${encodeURIComponent(resolvedUrl)}`
      }
      el.src = resolvedUrl
      el.playbackRate = st.playbackRate
      set({
        currentTrack: track,
        isPlaying: false,
        isLoading: true,
        progress: 0,
        currentTime: 0,
        duration: track.duration || 0,
      })

      // Запускаем RAF loop для плавного прогресса (store обновляется через
      // timeupdate ~4 раза/сек, RAF даёт 60fps для smoother UI).
      if (rafId === null) {
        const tick = () => {
          get()._tick()
          rafId = requestAnimationFrame(tick)
        }
        rafId = requestAnimationFrame(tick)
      }

      // v25.10: Media Session API — register track metadata + action handlers
      // so the OS lock-screen / Control Center / Bluetooth buttons / hardware
      // media keys all work. Without this:
      //   - iOS Safari pauses background audio when the screen locks (no
      //     mediaSession.metadata = the OS doesn't know it's "media").
      //   - Android Chrome shows a generic "999 PRO" notification with no
      //     title/artist/artwork — no play/pause/seek buttons.
      //   - Bluetooth next/prev buttons do nothing.
      // We register metadata on every play() (cheap), and action handlers
      // only once (they're global — re-registering would leak listeners).
      try {
        if ('mediaSession' in navigator) {
          const artworkSizes = [96, 128, 192, 256, 384, 512]
          const artwork = track.coverUrl
            ? artworkSizes.map((s) => ({
                src: track.coverUrl!,
                sizes: `${s}x${s}`,
                type: 'image/jpeg',
              }))
            : []
          navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title || 'Трек',
            artist: track.subtitle || track.senderName || '999PRO',
            album: '999PRO AudioHub',
            artwork,
          })
          navigator.mediaSession.playbackState = 'playing'

          // Register action handlers ONCE — they don't depend on the current
          // track, only on the store's get() which always reads live state.
          if (!(mediaSessionHandlersBound as boolean)) {
            mediaSessionHandlersBound = true
            const ms = navigator.mediaSession
            try { ms.setActionHandler('play', () => { get().resume() }) } catch {}
            try { ms.setActionHandler('pause', () => { get().pause() }) } catch {}
            try { ms.setActionHandler('seekbackward', (e: any) => {
              const skip = e?.seekOffset || 10
              const newTime = Math.max(0, get().currentTime - skip)
              get().seekTo(newTime)
            }) } catch {}
            try { ms.setActionHandler('seekforward', (e: any) => {
              const skip = e?.seekOffset || 10
              const newTime = Math.min(get().duration, get().currentTime + skip)
              get().seekTo(newTime)
            }) } catch {}
            try { ms.setActionHandler('seekto', (e: any) => {
              if (typeof e?.seekTime === 'number') get().seekTo(e.seekTime)
            }) } catch {}
            try { ms.setActionHandler('previoustrack', () => { get().prev() }) } catch {}
            try { ms.setActionHandler('nexttrack', () => { get().next() }) } catch {}
          }
        }
      } catch {
        // Media Session API not available (older browsers) — silently skip.
        // Background playback will fall back to whatever the browser allows
        // by default (typically: pause on screen lock, no lock-screen controls).
      }

      // v16.17: CRITICAL FIX for "need to click twice" and "no autoplay on next".
      // The old code called el.play() immediately after setting el.src, but the
      // audio element hasn't loaded the new source yet — el.play() returns a
      // Promise that rejects with AbortError. We now wait for 'canplay' before
      // calling play(). This also fixes autoplay when switching tracks via
      // next()/prev() (which call play() with a new track).
      const attemptPlay = () => {
        void el.play().then(() => {
          set({ isPlaying: true, isLoading: false })
        }).catch((err: any) => {
          // AbortError is expected if the user quickly switches tracks — the
          // previous play() was interrupted. Don't reset state in that case.
          if (err?.name === 'AbortError') return
          set({ isPlaying: false, isLoading: false })
        })
      }

      // If the audio is already ready (cached / blob URL), play immediately.
      // Otherwise wait for canplay. Use once: true so the listener auto-removes.
      if (el.readyState >= 2) {
        // HAVE_CURRENT_DATA or higher — enough to start playing.
        attemptPlay()
      } else {
        el.addEventListener('canplay', attemptPlay, { once: true })
        // Safety: if canplay never fires within 8s, try playing anyway.
        setTimeout(() => {
          if (get().currentTrack?.id === track.id && get().isLoading) {
            attemptPlay()
          }
        }, 8000)
      }
    },

    togglePlay: () => {
      const st = get()
      if (!st.currentTrack) return
      const el = getAudioEl()
      if (el.paused) {
        void el.play().catch(() => {})
      } else {
        el.pause()
      }
    },

    pause: () => {
      const st = get()
      if (!st.currentTrack) return
      getAudioEl().pause()
    },

    resume: () => {
      const st = get()
      if (!st.currentTrack) return
      void getAudioEl().play().catch(() => {})
    },

    stop: () => {
      const el = getAudioEl()
      el.pause()
      el.currentTime = 0
      el.src = ''
      set({
        currentTrack: null,
        isPlaying: false,
        progress: 0,
        currentTime: 0,
        duration: 0,
        queue: [],
        queueIndex: -1,
        isLoading: false,
        isSeeking: false,
      })
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      // v25.10: clear Media Session metadata so the lock-screen / Control
      // Center widget stops showing the stopped track.
      try {
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = null
          navigator.mediaSession.playbackState = 'none'
        }
      } catch {}
    },

    seek: (fraction) => {
      const el = getAudioEl()
      const st = get()
      if (!st.currentTrack || !el.duration || !isFinite(el.duration)) return
      const clamped = Math.max(0, Math.min(1, fraction))
      el.currentTime = clamped * el.duration
      set({ progress: clamped, currentTime: el.currentTime })
    },

    seekTo: (seconds) => {
      const el = getAudioEl()
      const st = get()
      if (!st.currentTrack) return
      el.currentTime = seconds
      set({ currentTime: seconds })
    },

    next: () => {
      const st = get()
      if (st.queue.length === 0) return

      let nextIdx: number
      if (st.shuffle) {
        // Случайный трек, отличный от текущего.
        if (st.queue.length === 1) {
          nextIdx = 0
        } else {
          do {
            nextIdx = Math.floor(Math.random() * st.queue.length)
          } while (nextIdx === st.queueIndex)
        }
      } else {
        nextIdx = st.queueIndex + 1
        if (nextIdx >= st.queue.length) {
          // Конец очереди.
          if (st.repeat === 'all') {
            nextIdx = 0
          } else {
            // Не повторяем — останавливаем.
            getAudioEl().pause()
            set({ isPlaying: false, progress: 1 })
            return
          }
        }
      }

      const nextTrack = st.queue[nextIdx]
      if (!nextTrack) return
      set({ queueIndex: nextIdx })
      get().play(nextTrack)
    },

    prev: () => {
      const st = get()
      if (st.queue.length === 0) return
      // Если проиграли больше 3 секунд — перезапускаем текущий трек.
      const el = getAudioEl()
      if (el.currentTime > 3) {
        el.currentTime = 0
        set({ progress: 0, currentTime: 0 })
        return
      }
      let prevIdx = st.queueIndex - 1
      if (prevIdx < 0) {
        if (st.repeat === 'all') {
          prevIdx = st.queue.length - 1
        } else {
          prevIdx = 0
        }
      }
      const prevTrack = st.queue[prevIdx]
      if (!prevTrack) return
      set({ queueIndex: prevIdx })
      get().play(prevTrack)
    },

    setRepeat: (mode) => set({ repeat: mode }),

    toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),

    setPlaybackRate: (rate) => {
      getAudioEl().playbackRate = rate
      set({ playbackRate: rate })
    },

    toggleFavorite: (trackId) => {
      set((s) => {
        const favorites = new Set(s.favorites)
        if (favorites.has(trackId)) {
          favorites.delete(trackId)
        } else {
          favorites.add(trackId)
        }
        return { favorites }
      })
    },

    isFavorite: (trackId) => get().favorites.has(trackId),

    _tick: () => {
      const el = audioEl
      if (!el) return
      const d = el.duration
      if (!d || !isFinite(d)) return
      // Только если playing — иначе лишние ре-рендеры.
      if (!el.paused) {
        set({
          currentTime: el.currentTime,
          progress: el.currentTime / d,
        })
      }
    },
  }
})

// ---- Convenience hooks ----

/** Хук для компонента, которому нужно только знать "играет ли сейчас этот url". */
export function useIsPlaying(url: string | null | undefined): boolean {
  return useAudioPlayer((s) => s.isPlaying && s.currentTrack?.url === url)
}

/** Хук для компонента, которому нужен прогресс конкретного url (0..1). */
export function useTrackProgress(url: string | null | undefined): number {
  return useAudioPlayer((s) =>
    s.currentTrack?.url === url ? s.progress : 0,
  )
}

/** Доступ к singleton audio element (для AnalyserNode в AudioMessage). */
;(useAudioPlayer as any)._getAudioEl = (): HTMLAudioElement | null => {
  if (typeof window === 'undefined') return null
  return audioEl
}

// ---- SSR-safe init guard ----
// На сервере audio element не создаётся — store возвращается с начальным
// состоянием. Первый вызов play() на клиенте инициализирует элемент.
