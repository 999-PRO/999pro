'use client'

// ============================================================================
// Media Hub Overlay — selector menu (v17)
// ----------------------------------------------------------------------------
// When the user taps the 🎵 Music2 button in chat (or anywhere else that
// opens the media hub), this small glass selector menu appears:
//
//   ┌──────────────────────────┐
//   │  🎵 Audio Hub            │  ← opens AudioSearchOverlay
//   ├──────────────────────────┤
//   │  🎬 Video Hub            │  ← opens FilmSearchOverlay
//   └──────────────────────────┘
//
// Once a section is picked, this menu closes and the corresponding overlay
// opens. Both Audio Hub and Video Hub are fully native app modules —
// no websites, no iframes (except for HTML5 video for streaming, which is
// native to the browser, not a third-party site).
// ============================================================================

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Music2, Film as FilmIcon, X, Lock } from 'lucide-react'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { useAuthStore } from '@/lib/auth-store'
import { toast } from '@/lib/notifications'
import { AudioSearchOverlay } from '@/modules/audio-hub/components/audio-search-overlay'
import { FilmSearchOverlay } from '@/modules/films/components/film-search-overlay'
import { MediaHubIcon } from '@/components/icons/media-hub-icon'
import type { AudioHubTrack } from '@/modules/audio-hub/types'
import type { FilmDetails } from '@/modules/films/types'

type Section = 'audio' | 'films' | null

interface MediaHubOverlayProps {
  open: boolean
  onClose: () => void
  // Audio callbacks (kept for backwards compat)
  onSelectAudio?: (track: AudioHubTrack) => void
  onPlayAudio?: (track: AudioHubTrack) => void
  // Films callback — when invoked from chat, "send to chat" is wired up.
  onSendFilm?: (film: FilmDetails) => void
  // When true, shows the Send button on cards (chat context only)
  showSendButton?: boolean
  // Open a specific film directly (e.g. user clicked a FilmChatCard)
  initialFilmId?: string | null
  // Initial section to open (skip the selector)
  initialSection?: Section
}

export function MediaHubOverlay({
  open,
  onClose,
  onSelectAudio,
  onPlayAudio,
  onSendFilm,
  showSendButton = true,
  initialFilmId,
  initialSection,
}: MediaHubOverlayProps) {
  useScrollLock(open)
  const [section, setSection] = useState<Section>(null)
  const [showSelector, setShowSelector] = useState(true)

  // v18.11: Video Hub is admin-only. Non-admin users see a "coming soon"
  // toast and the Video Hub button shows a lock icon + "скоро" label.
  const userRole = useAuthStore((s) => s.user?.role)
  const isAdmin = userRole === 'admin'

  // ---- If initialSection is set, open that section directly ----
  // (used by global overlay when user wants to skip the selector)
  const openSection = useCallback((s: Section) => {
    setSection(s)
    setShowSelector(false)
  }, [])

  // v18.11: Video Hub access check — non-admins get a toast instead of the overlay.
  const handleVideoHubClick = () => {
    if (isAdmin) {
      openSection('films')
    } else {
      toast.info('Video Hub скоро будет доступен. Раздел в разработке.')
    }
  }

  // ---- If initialFilmId is set, jump straight to films section ----
  // We don't open the selector in that case.
  if (initialFilmId && open && section !== 'films') {
    setSection('films')
    setShowSelector(false)
  }
  if (initialSection && open && section === null) {
    setSection(initialSection)
    setShowSelector(false)
  }

  // ---- Close handler — closes everything ----
  const handleClose = useCallback(() => {
    setSection(null)
    setShowSelector(true)
    onClose()
  }, [onClose])

  // ---- Back to selector (from inside a section) ----
  const handleBackToSelector = useCallback(() => {
    setSection(null)
    setShowSelector(true)
  }, [])

  return (
    <>
      {/* Selector menu */}
      <AnimatePresence>
        {open && showSelector && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[97] bg-black/40"
              style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
              onClick={handleClose}
            />
            <motion.div
              initial={{ y: 30, opacity: 0, scale: 0.96 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 30, opacity: 0, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 360, damping: 28, mass: 0.8 }}
              className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[98] w-[calc(100%-2rem)] max-w-sm"
            >
              <div
                className="rounded-3xl overflow-hidden"
                style={{
                  background: 'linear-gradient(180deg, rgba(15,15,30,0.92) 0%, rgba(10,10,20,0.95) 100%)',
                  backdropFilter: 'blur(28px) saturate(160%)',
                  WebkitBackdropFilter: 'blur(28px) saturate(160%)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  boxShadow: '0 20px 60px -10px rgba(0,0,0,0.5)',
                }}
              >
                {/* Header */}
                <div className="flex items-center gap-2 px-5 pt-4 pb-3">
                  <MediaHubIcon size={32} />
                  <div className="text-base font-semibold text-white flex-1">Media Hub</div>
                  <button
                    onClick={handleClose}
                    className="grid place-items-center h-8 w-8 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                    aria-label="Закрыть"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Subtitle */}
                <div className="px-5 pb-3 text-xs text-white/50">
                  Выберите раздел, чтобы продолжить
                </div>

                {/* Audio Hub button */}
                <div className="px-3 pb-2">
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => openSection('audio')}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-colors hover:bg-white/5"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div
                      className="grid place-items-center h-11 w-11 rounded-xl shrink-0"
                      style={{
                        background: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
                        boxShadow: '0 6px 20px -4px rgba(245,158,11,0.5)',
                      }}
                    >
                      <Music2 className="h-5 w-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white">Audio Hub</div>
                      <div className="text-[11px] text-white/55 mt-0.5 truncate">
                        Музыка — поиск по hitmos + muzce
                      </div>
                    </div>
                  </motion.button>
                </div>

                {/* Video Hub button — v18.11: admin-only. Non-admins see a
                    lock icon + "скоро" label and get a toast on click. */}
                <div className="px-3 pb-4">
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={handleVideoHubClick}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-colors hover:bg-white/5"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div
                      className="relative grid place-items-center h-11 w-11 rounded-xl shrink-0"
                      style={{
                        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)',
                        boxShadow: '0 6px 20px -4px rgba(99,102,241,0.5)',
                        opacity: isAdmin ? 1 : 0.6,
                      }}
                    >
                      <FilmIcon className="h-5 w-5 text-white" />
                      {!isAdmin && (
                        <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-amber-500 grid place-items-center ring-2 ring-slate-900">
                          <Lock className="h-2.5 w-2.5 text-white" strokeWidth={2.5} />
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">Video Hub</span>
                        {!isAdmin && (
                          <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[9px] font-bold uppercase tracking-wide">
                            Скоро
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-white/55 mt-0.5 truncate">
                        {isAdmin ? 'Фильмы и сериалы в открытом архиве' : 'Раздел в разработке'}
                      </div>
                    </div>
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Audio section */}
      <AudioSearchOverlay
        open={open && section === 'audio'}
        onClose={handleBackToSelector}
        onSelect={(t) => {
          if (onSelectAudio) {
            onSelectAudio(t)
          }
          // After send, close everything
          handleClose()
        }}
        onPlay={onPlayAudio}
        showSendButton={showSendButton}
      />

      {/* Films section */}
      <FilmSearchOverlay
        open={open && section === 'films'}
        onClose={handleBackToSelector}
        onSendToChat={onSendFilm}
        initialFilmId={initialFilmId || null}
      />
    </>
  )
}
