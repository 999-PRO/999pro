'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Image from 'next/image'
import { X } from 'lucide-react'
import { useTheme } from 'next-themes'
import { api, assetUrl } from '@/lib/api'
import type { Story } from '@/lib/types'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { initials, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { getStoryPaletteForCategory, type StoryPalette } from '@/lib/gradients'
import { useScrollLock } from '@/lib/use-scroll-lock'

export function Stories() {
  const [stories, setStories] = useState<Story[]>([])
  const [loading, setLoading] = useState(true)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  const fetchStories = useCallback(() => {
    let alive = true
    setLoading(true)
    api
      .get<{ items: Story[] }>('/api/stories')
      .then((d) => alive && setStories(d.items))
      .catch(() => {})
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const cleanup = fetchStories()
    return cleanup
  }, [fetchStories])

  // v16.5: Instant refresh — when Studio saves stories, refetch immediately.
  useEffect(() => {
    const onStoriesChanged = () => fetchStories()
    window.addEventListener('999pro:stories-changed', onStoriesChanged as EventListener)
    return () => window.removeEventListener('999pro:stories-changed', onStoriesChanged as EventListener)
  }, [fetchStories])

  if (!loading && stories.length === 0) return null

  // v24.3: Each Story is its own group (1:1 mapping).
  // Previously stories were grouped by category — so creating multiple
  // stories with the same category merged them into one circle. Now every
  // new Story post (even with the same category) is a separate circle.
  // The category is only used for the palette/color, not for grouping.
  // Images selected TOGETHER in one creation action are already part of the
  // same Story's `media` array (handled by the backend), so they stay grouped.
  type Group = {
    category: string
    cover: Story
    coverImageUrl: string | null
    items: Story[]
    palette: StoryPalette
    totalMedia: number
  }
  const groups: Group[] = stories.map((s) => {
    const cat = s.category || 'Все'
    const palette = getStoryPaletteForCategory(cat)
    const coverImageUrl = s.media?.length ? s.media[s.media.length - 1] : null
    return {
      category: cat,
      cover: s,
      coverImageUrl,
      items: [s],
      palette,
      totalMedia: s.media.length,
    }
  })

  return (
    <section aria-label="Истории" className="pt-2 md:pt-4">
      <div
        ref={scrollerRef}
        className="no-scrollbar smooth-x flex gap-3 md:gap-4 overflow-x-auto px-4 md:px-6 pb-2 snap-edge"
      >
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="shrink-0 flex flex-col items-center gap-1.5 w-[84px] md:w-[108px]">
                <div className="h-[72px] w-[72px] md:h-24 md:w-24 rounded-full skeleton" />
                <div className="h-3 w-12 rounded skeleton" />
              </div>
            ))
          : groups.map((g, i) => (
              <button
                key={g.cover.id}
                onClick={() => setActiveIndex(i)}
                className="shrink-0 flex flex-col items-center gap-1.5 w-[84px] md:w-[108px] group"
              >
                <div className="relative">
                  <div
                    className="h-[72px] w-[72px] md:h-24 md:w-24 rounded-full p-[2.5px] group-active:scale-95 transition-transform"
                    style={{
                      background: g.palette.ring,
                      boxShadow: `0 6px 16px -4px ${g.palette.glow}, 0 0 0 1px rgba(255,255,255,0.3) inset`,
                    }}
                  >
                    <div className="relative h-full w-full rounded-full p-[2px] bg-background overflow-hidden">
                      {g.coverImageUrl ? (
                        g.cover.mediaType === 'video' ? (
                          <video
                            src={assetUrl(g.coverImageUrl)}
                            className="h-full w-full object-cover rounded-full"
                            muted
                            playsInline
                          />
                        ) : (
                          <Image
                            src={assetUrl(g.coverImageUrl)}
                            alt={g.category}
                            fill
                            sizes="96px"
                            className="object-cover rounded-full"
                            loading="lazy"
                          />
                        )
                      ) : (
                        <Avatar className="h-full w-full">
                          <AvatarImage src={g.cover.user.avatar || undefined} alt={g.cover.user.username} />
                          <AvatarFallback
                            className="text-white"
                            style={{ background: g.palette.ring }}
                          >
                            {initials(g.cover.user.displayName || g.cover.user.username)}
                          </AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  </div>

                  {g.totalMedia > 1 && (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 min-w-[22px] h-[22px] px-1.5 rounded-full grid place-items-center text-white text-[10px] font-bold ring-2 ring-background"
                      style={{
                        background: g.palette.chipBg,
                        boxShadow: `0 4px 10px -2px ${g.palette.glow}`,
                      }}
                    >
                      {g.totalMedia}
                    </span>
                  )}
                </div>
                <span
                  className="text-[11px] md:text-xs truncate w-full text-center font-medium"
                  style={{ color: g.palette.solid }}
                >
                  {g.category}
                </span>
              </button>
            ))}
      </div>

      {activeIndex !== null && groups[activeIndex] && (
        <StoriesViewer
          groups={groups}
          startGroupIndex={activeIndex}
          onClose={() => setActiveIndex(null)}
        />
      )}
    </section>
  )
}

// ============================================================================
// StoriesViewer — v12 FULL-SCREEN redesign.
//
// Changes from v11:
//   • Removed the 9:16 container (max-w-md aspect-[9/16] rounded-3xl) — the
//     story now fills the ENTIRE screen. No outer card, no outer rounded
//     corners, no outer padding. The image feels like it occupies the whole
//     display, like Instagram/Telegram/TikTok stories.
//   • Glass blur background fills the ENTIRE screen (not just the container).
//     A blurred copy of the current media is scaled up and covers the whole
//     viewport — fills the letterbox space around object-contain images.
//   • Hold-to-pause: pressing and holding the screen pauses the progress
//     timer. Releasing resumes. Works on both touch and mouse.
//   • Swipe-down to close: a vertical drag gesture closes the viewer with a
//     smooth spring animation (like Instagram). Replaces the "click backdrop
//     to close" behavior — now the entire screen is the story, so there's
//     no backdrop to click.
//   • Tap zones: left third = previous, right two-thirds = next. This
//     matches Instagram's behavior (larger next zone because users typically
//     go forward).
//   • Smooth crossfade transition between stories (150ms opacity ramp).
// ============================================================================
function StoriesViewer({
  groups,
  startGroupIndex,
  onClose,
}: {
  groups: {
    category: string
    cover: Story
    coverImageUrl: string | null
    items: Story[]
    palette: StoryPalette
    totalMedia: number
  }[]
  startGroupIndex: number
  onClose: () => void
}) {
  const [groupIndex, setGroupIndex] = useState(startGroupIndex)
  const [storyIndex, setStoryIndex] = useState(0)
  const [mediaIndex, setMediaIndex] = useState(0)
  const [mediaLoaded, setMediaLoaded] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [swipeDownOffset, setSwipeDownOffset] = useState(0)
  const [isClosing, setIsClosing] = useState(false)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  const group = groups[groupIndex]
  const story = group?.items[storyIndex]
  const totalMedia = story?.media.length ?? 0
  const currentMediaUrl = story?.media[mediaIndex]
  const palette = group?.palette

  const advance = useCallback(() => {
    if (!group) return onClose()
    if (mediaIndex + 1 < totalMedia) {
      setMediaIndex(mediaIndex + 1)
      return
    }
    if (storyIndex + 1 < group.items.length) {
      setStoryIndex(storyIndex + 1)
      setMediaIndex(0)
      return
    }
    if (groupIndex + 1 < groups.length) {
      setGroupIndex(groupIndex + 1)
      setStoryIndex(0)
      setMediaIndex(0)
      return
    }
    onClose()
  }, [group, groups.length, mediaIndex, onClose, storyIndex, totalMedia, groupIndex])

  const goBack = useCallback(() => {
    if (mediaIndex > 0) {
      setMediaIndex(mediaIndex - 1)
      return
    }
    if (storyIndex > 0) {
      const prevStoryInGroup = group.items[storyIndex - 1]
      setStoryIndex(storyIndex - 1)
      setMediaIndex(Math.max(0, prevStoryInGroup.media.length - 1))
      return
    }
    if (groupIndex > 0) {
      const prevGroup = groups[groupIndex - 1]
      const prevStory = prevGroup.items[prevGroup.items.length - 1]
      setGroupIndex(groupIndex - 1)
      setStoryIndex(Math.max(0, prevGroup.items.length - 1))
      setMediaIndex(Math.max(0, prevStory.media.length - 1))
    }
  }, [mediaIndex, storyIndex, group, groupIndex, groups])

  // Reset on every advance
  useEffect(() => {
    setMediaLoaded(false)
    setSwipeDownOffset(0)
    setIsPaused(false)
  }, [groupIndex, storyIndex, mediaIndex, story?.id])

  // v13.3: fallback timeout — if media doesn't fire onLoad/onError within
  // 3 seconds (e.g. slow CDN, broken next/image optimization, network
  // hiccup), force mediaLoaded=true so the progress timer starts anyway.
  // Without this, the story "hangs" forever on a blank screen with a
  // spinner, which the user perceives as "story not opening".
  useEffect(() => {
    if (mediaLoaded) return
    const id = setTimeout(() => setMediaLoaded(true), 3000)
    return () => clearTimeout(id)
  }, [mediaLoaded, story?.id, mediaIndex])

  // Progress timer — uses requestAnimationFrame + direct DOM mutation.
  // v12: respects isPaused — when paused, the timer freezes (we track elapsed
  // time excluding paused periods).
  const currentProgressBarRef = useRef<HTMLDivElement | null>(null)
  const pausedTimeRef = useRef<number>(0)
  const pauseStartRef = useRef<number | null>(null)

  // v13.2 (audit P1-10 fix): split the timer effect into two.
  //   1) Timer lifecycle effect — starts a fresh timer ONLY when story/media
  //      changes. Does NOT depend on isPaused, so pausing doesn't reset the
  //      elapsed time to 0. Tracks pause accumulation in refs.
  //   2) Pause sync effect — when isPaused changes, records the pause start
  //      or accumulates the pause duration. Doesn't restart the timer.
  const startRef = useRef<number>(0)
  useEffect(() => {
    if (!mediaLoaded || !story) return
    api.post(`/api/stories/${story.id}/view`, { auth: true }).catch(() => {})
    const DURATION = 5000
    startRef.current = Date.now()
    pausedTimeRef.current = 0
    pauseStartRef.current = null
    let rafId = 0

    const tick = () => {
      // If paused (read from a ref-like check via the latest isPaused),
      // we still need to keep the RAF loop alive but not advance progress.
      // The pause sync effect below manages pauseStartRef / pausedTimeRef.
      if (pauseStartRef.current !== null) {
        // Currently paused — just keep the loop alive, don't advance.
        rafId = requestAnimationFrame(tick)
        return
      }
      const elapsed = Date.now() - startRef.current - pausedTimeRef.current
      const p = Math.min(1, elapsed / DURATION)
      if (currentProgressBarRef.current) {
        currentProgressBarRef.current.style.width = `${p * 100}%`
      }
      if (p >= 1) {
        advance()
        return
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
    // NOTE: isPaused intentionally NOT in deps — pausing shouldn't restart.
  }, [mediaLoaded, story?.id, mediaIndex, advance, story])

  // Pause sync effect — runs when isPaused changes.
  useEffect(() => {
    if (isPaused) {
      if (pauseStartRef.current === null) {
        pauseStartRef.current = Date.now()
      }
    } else {
      if (pauseStartRef.current !== null) {
        pausedTimeRef.current += Date.now() - pauseStartRef.current
        pauseStartRef.current = null
      }
    }
  }, [isPaused])

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') advance()
      else if (e.key === 'ArrowLeft') goBack()
      else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault()
        setIsPaused((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, goBack, onClose])

  useScrollLock(true)

  // v13.3: suppress PullToRefresh while the StoriesViewer is open (including
  // the 200ms isClosing animation). Without this, a swipe-down-to-close
  // gesture can leak into the background PTR and trigger a page refresh.
  // ProductPage already does the same — StoriesViewer was missing it.
  useEffect(() => {
    const ptr = (window as unknown as { __ptr?: { suppress?: () => void; unsuppress?: () => void } }).__ptr
    ptr?.suppress?.()
    return () => {
      const ptr2 = (window as unknown as { __ptr?: { unsuppress?: () => void } }).__ptr
      ptr2?.unsuppress?.()
    }
  }, [])

  // ====== Swipe-down to close + hold-to-pause gesture handling ======
  const touchStateRef = useRef<{
    startY: number
    startX: number
    isDragging: boolean
    isHold: boolean
    holdTimer: ReturnType<typeof setTimeout> | null
  }>({
    startY: 0,
    startX: 0,
    isDragging: false,
    isHold: false,
    holdTimer: null,
  })

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touchStateRef.current = {
      startY: t.clientY,
      startX: t.clientX,
      isDragging: false,
      isHold: false,
      holdTimer: null,
    }
    // Hold-to-pause: if the finger stays in place for 250ms, pause.
    // Distinguished from a tap (quick release) or swipe (movement > 10px).
    touchStateRef.current.holdTimer = setTimeout(() => {
      // Only pause if finger hasn't moved much (otherwise it's a swipe)
      if (!touchStateRef.current.isDragging) {
        touchStateRef.current.isHold = true
        setIsPaused(true)
      }
    }, 250)
  }

  const onTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0]
    const dy = t.clientY - touchStateRef.current.startY
    const dx = t.clientX - touchStateRef.current.startX
    // If movement exceeds threshold, cancel the hold timer (it's a swipe, not a hold)
    if (Math.abs(dy) > 10 || Math.abs(dx) > 10) {
      if (touchStateRef.current.holdTimer) {
        clearTimeout(touchStateRef.current.holdTimer)
        touchStateRef.current.holdTimer = null
      }
      if (touchStateRef.current.isHold) {
        touchStateRef.current.isHold = false
        setIsPaused(false)
      }
    }
    // Vertical swipe-down → track offset for the close gesture
    if (dy > 0 && Math.abs(dy) > Math.abs(dx)) {
      touchStateRef.current.isDragging = true
      setSwipeDownOffset(dy)
    }
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStateRef.current.holdTimer) {
      clearTimeout(touchStateRef.current.holdTimer)
      touchStateRef.current.holdTimer = null
    }
    // If was holding, resume playback
    if (touchStateRef.current.isHold) {
      touchStateRef.current.isHold = false
      setIsPaused(false)
      return
    }
    const t = e.changedTouches[0]
    const dy = t.clientY - touchStateRef.current.startY
    const dx = t.clientX - touchStateRef.current.startX
    const elapsed = Date.now() // approx

    // Swipe-down close: if vertical drag exceeds 120px, close
    if (dy > 120 && Math.abs(dy) > Math.abs(dx)) {
      setIsClosing(true)
      setTimeout(onClose, 200)
      return
    }
    // If it was a drag (not a tap), reset offset and return
    if (touchStateRef.current.isDragging) {
      setSwipeDownOffset(0)
      return
    }
    // Otherwise it's a tap — the click zones handle prev/next.
    // But we need to reset swipeDownOffset in case there was a small drag.
    setSwipeDownOffset(0)
  }

  if (!story || !palette) return null

  // Build the flat list of all segments across this group's stories for the
  // top progress bar.
  const segments: { storyId: string; mediaIdx: number }[] = []
  group.items.forEach((s) => {
    s.media.forEach((_, mIdx) => {
      segments.push({ storyId: s.id, mediaIdx: mIdx })
    })
  })
  const currentSegmentIdx = segments.findIndex(
    (seg) => seg.storyId === story.id && seg.mediaIdx === mediaIndex,
  )

  // Close gesture: opacity fades as the user drags down
  const closeProgress = Math.min(1, swipeDownOffset / 300)
  const bgOpacity = isClosing ? 0 : 1 - closeProgress * 0.5
  const mediaOpacity = isClosing ? 0 : 1 - closeProgress * 0.3

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
      data-zoom-allowed
      style={{
        // v12: NO outer card/container. The story fills the entire screen.
        // Background is a blurred copy of the current media — fills the
        // letterbox space around object-contain images/videos. This replaces
        // the old `bg-black/90 backdrop-blur-md` which was a flat dark backdrop.
        background: isDark ? '#000000' : '#0f172a',
        opacity: bgOpacity,
        transition: isClosing ? 'opacity 0.2s ease' : 'opacity 0.15s ease',
        overscrollBehavior: 'contain',
        touchAction: 'none', // we handle all gestures manually
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* ====== Glass blur background — fills ENTIRE screen ======
          A blurred, scaled-up copy of the current media. This is the "glass
          blur" background that fills the letterbox space around object-contain
          images. No black bars, no white bars — the background is a natural
          extension of the image itself. */}
      <div
        aria-hidden
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `url(${assetUrl(currentMediaUrl)})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(60px) saturate(180%) brightness(0.8)',
          transform: 'scale(1.4)',
          opacity: 0.85,
        }}
      />
      {/* Dark overlay on top of the blur for text readability */}
      <div
        aria-hidden
        className="absolute inset-0 z-0"
        style={{
          background: isDark
            ? 'rgba(0, 0, 0, 0.4)'
            : 'rgba(15, 23, 42, 0.3)',
        }}
      />

      {/* ====== Top bar: progress bars + (nickname card ✕ close button) ======
          Wave 5 fix: ✕ button, avatar, username and time must sit on the
          SAME horizontal line. Previously the ✕ was at top: max(1rem, safe-area)
          and the nickname card was at top: max(1rem, safe-area) + 1.5rem —
          visually misaligned by ~24px. Now both share a flex container with
          items-center so they are vertically centered on the same line,
          below the progress bars. Safe-area is respected for notch / status
          bar on iPhone and Android. */}
      {/* Progress bars — topmost strip (2px tall) */}
      <div
        className="absolute left-4 right-4 flex gap-1 z-30"
        style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {segments.map((seg, i) => (
          <div
            key={i}
            className="flex-1 h-0.5 rounded-full overflow-hidden"
            style={{ background: 'rgba(255, 255, 255, 0.3)' }}
          >
            <div
              ref={i === currentSegmentIdx ? currentProgressBarRef : undefined}
              className="h-full"
              style={{
                background: '#ffffff',
                width: i < currentSegmentIdx ? '100%' : '0%',
              }}
            />
          </div>
        ))}
      </div>

      {/* Top bar row — nickname card (left) + close button (right), vertically
          centered on the same line. Sits below the progress bars strip. */}
      <div
        className="absolute z-30 flex items-center justify-between gap-2"
        style={{
          top: 'calc(max(1rem, env(safe-area-inset-top)) + 1.5rem)',
          left: '0.75rem',
          right: '0.75rem',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ====== Nickname card (top-left) ====== */}
        <div
          className="flex items-center gap-1.5"
          style={{
            maxWidth: 'calc(100% - 3rem)',
            padding: '0.3rem 0.55rem 0.3rem 0.3rem',
            borderRadius: '0.875rem',
            background: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(16px) saturate(160%)',
            WebkitBackdropFilter: 'blur(16px) saturate(160%)',
            color: '#ffffff',
            boxShadow: '0 6px 16px -4px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.12) inset',
          }}
        >
          <Avatar
            className="h-7 w-7 ring-2 shrink-0"
            style={{ '--tw-ring-color': 'rgba(255,255,255,0.55)' } as React.CSSProperties}
          >
            <AvatarImage src={story.user.avatar || undefined} alt={story.user.username} />
            <AvatarFallback style={{ background: palette.ring, color: '#ffffff' }}>
              {initials(story.user.displayName || story.user.username)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="text-xs font-bold truncate leading-tight">
              {story.user.displayName || story.user.username}
            </div>
            <div className="text-[10px] truncate leading-tight text-white/75">
              @{story.user.username} · {timeAgo(story.createdAt)}
            </div>
          </div>
          {group.category && group.category !== 'Все' && (
            <span
              className="shrink-0 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide text-white"
              style={{
                background: palette.chipBg,
                boxShadow: `0 3px 8px -2px ${palette.glow}`,
              }}
            >
              {group.category}
            </span>
          )}
        </div>

        {/* ====== Close button (top-right) ====== */}
        <button
          className="h-10 w-10 rounded-full grid place-items-center text-white shrink-0"
          style={{
            background: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(16px) saturate(160%)',
            WebkitBackdropFilter: 'blur(16px) saturate(160%)',
          }}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          aria-label="Закрыть"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* ====== Loading spinner ====== */}
      {!mediaLoaded && (
        <div className="absolute inset-0 grid place-items-center z-10">
          <div
            className="h-10 w-10 rounded-full border-4 animate-spin"
            style={{
              borderColor: 'rgba(255,255,255,0.25)',
              borderTopColor: palette.solid,
            }}
          />
        </div>
      )}

      {/* ====== Main media — object-contain, fills available space ======
          No container, no rounded corners. The image/video is centered in
          the viewport with object-contain, so any aspect ratio is preserved.
          The blurred background fills the letterbox space. */}
      <div
        className="relative w-full h-full flex items-center justify-center z-[5]"
        style={{
          transform: `translateY(${swipeDownOffset}px)`,
          opacity: mediaOpacity,
          transition: swipeDownOffset === 0 && !isClosing
            ? 'transform 0.2s ease, opacity 0.15s ease'
            : 'none',
        }}
      >
        {story.mediaType === 'video' ? (
          <video
            src={assetUrl(currentMediaUrl)}
            className="w-full h-full object-contain"
            autoPlay
            muted
            playsInline
            onLoadedData={() => setMediaLoaded(true)}
            onError={() => setMediaLoaded(true)}
          />
        ) : (
          <Image
            src={assetUrl(currentMediaUrl)}
            alt={story.caption || 'Story'}
            fill
            sizes="100vw"
            className="object-contain"
            onLoad={() => setMediaLoaded(true)}
            onError={() => setMediaLoaded(true)}
            priority
          />
        )}
      </div>

      {/* ====== Multi-image dots (bottom center) ====== */}
      {totalMedia > 1 && (
        <div
          className="absolute z-30 flex items-center gap-1.5"
          style={{
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)',
            left: '50%',
            transform: 'translateX(-50%)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {story.media.map((_, i) => (
            <span
              key={i}
              className="rounded-full transition-all"
              style={{
                width: i === mediaIndex ? '8px' : '6px',
                height: i === mediaIndex ? '8px' : '6px',
                background: i === mediaIndex ? '#ffffff' : 'rgba(255,255,255,0.45)',
                boxShadow: i === mediaIndex ? '0 0 8px rgba(255,255,255,0.6)' : 'none',
              }}
            />
          ))}
        </div>
      )}

      {/* ====== Caption (bottom) — only on last image of story ====== */}
      {story.caption && mediaIndex === totalMedia - 1 && (
        <div
          className="absolute bottom-0 inset-x-0 p-5 z-20"
          style={{
            background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-white text-sm leading-relaxed">{story.caption}</p>
        </div>
      )}

      {/* ====== Tap zones — left third = prev, right two-thirds = next ======
          These are invisible buttons that sit on top of the media. They
          handle tap navigation. The touch handlers above handle hold-to-pause
          and swipe-down-to-close; taps fall through to these buttons. */}
      <button
        className="absolute left-0 top-0 h-full w-1/3 z-20"
        aria-label="Предыдущая"
        onClick={(e) => {
          e.stopPropagation()
          goBack()
        }}
      />
      <button
        className="absolute right-0 top-0 h-full w-2/3 z-20"
        aria-label="Следующая"
        onClick={(e) => {
          e.stopPropagation()
          advance()
        }}
      />
    </div>
  )
}
