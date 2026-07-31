'use client'

import { create } from 'zustand'

// ============================================================================
// Video PiP Store — глобальное состояние для мини-плеера
// ============================================================================

export interface VideoPipState {
  title: string
  subtitle?: string
  posterUrl?: string | null
  streamUrl: string
  streamType: 'hls' | 'dash' | 'mp4' | 'webm' | 'iframe'
  position: number  // seconds
  duration: number  // seconds
  players: any[]    // FilmPlayerOption[] for re-opening full player
  filmId?: string
  episodeId?: string
}

interface VideoPipStore {
  pip: VideoPipState | null
  isExpanded: boolean  // when true, full player is shown over the mini player
  skipPipOnClose: boolean  // when true, FilmPlayer won't create new PiP on close

  setPip: (state: VideoPipState) => void
  clearPip: () => void
  updatePosition: (pos: number, dur: number) => void
  setExpanded: (expanded: boolean) => void
  setSkipPipOnClose: (skip: boolean) => void
}

export const useVideoPipStore = create<VideoPipStore>()((set) => ({
  pip: null,
  isExpanded: false,
  skipPipOnClose: false,

  setPip: (state) => set({ pip: state, isExpanded: false, skipPipOnClose: false }),
  clearPip: () => set({ pip: null, isExpanded: false, skipPipOnClose: false }),
  updatePosition: (pos, dur) =>
    set((s) => (s.pip ? { pip: { ...s.pip, position: pos, duration: dur } } : s)),
  setExpanded: (expanded) => set({ isExpanded: expanded }),
  setSkipPipOnClose: (skip) => set({ skipPipOnClose: skip }),
}))
