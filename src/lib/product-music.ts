'use client'

// ============================================================================
// ProductMusic — v25.20 (owner, «как в Инстаграме»): лёгкая фоновая музыка
// товара. Играет при просмотре ФОТО товара (страница товара и лента);
// при видео не звучит (у видео свой звук).
// ----------------------------------------------------------------------------
// ОТДЕЛЬНЫЙ аудио-элемент (не глобальный AudioPlayerManager!): музыка
// товара — атмосферный слой, она не должна выталкивать музыку, которую
// слушает пользователь в Media Hub, и не должна появляться в шапке-плеере.
// Громкость фиксированная (тихая), loop. Есть mute-переключатель.
// Автоплей разрешён, если воспроизведение запущено из обработчика жеста
// (открытие товара — это тап) — иначе браузер тихо отклонит (catch).
// ============================================================================

import { create } from 'zustand'

export interface ProductMusicTrack {
  id: string
  title: string
  artist?: string | null
  url: string
}

interface ProductMusicState {
  track: ProductMusicTrack | null
  playing: boolean
  muted: boolean
  _play: (track: ProductMusicTrack) => void
  _stop: () => void
  _setPlaying: (v: boolean) => void
  toggleMute: () => void
}

let el: HTMLAudioElement | null = null
let currentUrl: string | null = null

function getEl(): HTMLAudioElement {
  if (!el) {
    el = new Audio()
    el.loop = true
    el.volume = 0.32 // лёгкий фон — не громкая музыка
    el.setAttribute('playsinline', 'true')
  }
  return el
}

export const useProductMusic = create<ProductMusicState>((set, get) => ({
  track: null,
  playing: false,
  muted: false,

  _play: (track) => {
    const e = getEl()
    // Тот же трек — ничего не перезапускаем
    if (currentUrl === track.url) {
      if (e.paused) void e.play().catch(() => {})
      set({ track, playing: true })
      return
    }
    currentUrl = track.url
    e.src = track.url.startsWith('http') ? track.url : track.url // URL уже полный (прокси audio-hub)
    e.volume = get().muted ? 0 : 0.32
    e.currentTime = 0
    set({ track, playing: true })
    void e.play().catch(() => {
      // Автоплей заблокирован — музыка начнёт играть при первом касании
      // (toggle в UI) или на следующем слайде.
      set({ playing: false })
    })
  },

  _stop: () => {
    if (!el) return
    try { el.pause() } catch {}
    set({ playing: false })
  },

  _setPlaying: (v) => set({ playing: v }),

  toggleMute: () => {
    const muted = !get().muted
    set({ muted })
    if (el) el.volume = muted ? 0 : 0.32
    if (muted) {
      get()._stop()
    } else if (get().track) {
      get()._play(get().track!)
    }
  },
}))

/** Запустить фоновую музыку товара (если URL валиден). */
export function playProductMusic(track: ProductMusicTrack | null | undefined) {
  if (!track?.url) return
  useProductMusic.getState()._play(track)
}

/** Остановить фоновую музыку товара. */
export function stopProductMusic() {
  useProductMusic.getState()._stop()
}
