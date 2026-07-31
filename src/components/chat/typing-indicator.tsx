'use client'

import { motion, AnimatePresence } from 'framer-motion'

// ============================================================================
// TypingIndicator — living panel under the chat header.
//
// v9-voice-v2: completely rewritten for visibility.
//   • 'typing' mode: calm glass pill with pencil icon + animated dots
//   • 'voice'  mode: PROMINENT blue gradient bar with mic icon + pulsing glow
//     (matches the reference design's "salah_95 записывает голосовое сообщение…")
//
// The voice-recording variant is intentionally BOLD — a full-width blue
// gradient bar that's impossible to miss. It tells the user "the other
// person is recording" at a glance, even in peripheral vision.
// ============================================================================

interface TypingIndicatorProps {
  active: boolean
  username: string
  mode?: 'typing' | 'voice'
  variant?: 'me' | 'peer'
}

export function TypingIndicator({
  active,
  username,
  mode = 'typing',
  variant = 'peer',
}: TypingIndicatorProps) {
  const isVoice = mode === 'voice'

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="px-3 pt-1.5 overflow-hidden"
          // v10-perf: animate opacity + y ONLY (no height animation).
          // Animating height: 'auto' triggers layout recalculation on every
          // frame (expensive). Opacity + transform are compositor-only
          // (GPU-accelerated, 60fps). The element still appears/disappears
          // smoothly; the only difference is it doesn't "collapse" the
          // vertical space — but since the typing indicator is at a fixed
          // position under the header, this is invisible to the user.
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          aria-live="polite"
          style={{ willChange: 'transform, opacity' }}
        >
          {isVoice ? (
            // ─── Voice recording bar — PROMINENT blue gradient ───
            // Full-width bar with electric blue gradient, pulsing glow,
            // mic icon, and "username записывает голосовое сообщение…"
            <motion.div
              className="flex items-center gap-2.5 rounded-2xl px-4 py-2.5"
              style={{
                // v13.3 (audit T-2): use CSS variable for theme-aware brand gradient.
                background: 'var(--gradient-brand)',
                boxShadow: '0 4px 20px -4px rgba(37,99,235,0.5), 0 0 0 1px rgba(255,255,255,0.1) inset',
              }}
              animate={{
                boxShadow: [
                  '0 4px 20px -4px rgba(37,99,235,0.5), 0 0 0 1px rgba(255,255,255,0.1) inset',
                  '0 4px 30px -2px rgba(37,99,235,0.7), 0 0 0 1px rgba(255,255,255,0.15) inset',
                  '0 4px 20px -4px rgba(37,99,235,0.5), 0 0 0 1px rgba(255,255,255,0.1) inset',
                ],
              }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            >
              {/* Mic icon with pulsing glow */}
              <motion.span
                className="shrink-0 h-7 w-7 rounded-full grid place-items-center"
                style={{ background: 'rgba(255,255,255,0.2)' }}
                animate={{ scale: [1, 1.08, 1] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="white"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              </motion.span>
              <span className="text-sm font-medium text-white truncate">
                <span className="font-semibold">{username}</span> записывает голосовое сообщение…
              </span>
              {/* Animated wave dots */}
              <span className="flex items-center gap-1 ml-auto shrink-0" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <motion.span
                    key={i}
                    className="block rounded-full bg-white/80"
                    style={{ width: 4, height: 4 }}
                    animate={{
                      scaleY: [0.5, 1.5, 0.5],
                      opacity: [0.3, 1, 0.3],
                    }}
                    transition={{
                      duration: 1,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: i * 0.15,
                    }}
                  />
                ))}
              </span>
            </motion.div>
          ) : (
            // ─── Typing indicator — calm glass pill ───
            <motion.div
              className="flex items-center gap-2.5 rounded-2xl px-3.5 py-2 max-w-[280px]"
              style={{
                background: variant === 'peer'
                  ? 'rgba(226, 232, 240, 0.6)'
                  : 'rgba(96, 165, 250, 0.25)',
                backdropFilter: 'blur(18px) saturate(160%)',
                WebkitBackdropFilter: 'blur(18px) saturate(160%)',
                border: variant === 'peer'
                  ? '1px solid rgba(186, 230, 253, 0.5)'
                  : '1px solid rgba(96, 165, 250, 0.35)',
              }}
            >
              <span className="shrink-0 text-base" aria-hidden>✍️</span>
              <span className={`text-xs font-medium truncate ${variant === 'peer' ? 'text-foreground/80' : 'text-blue-600 dark:text-blue-300'}`}>
                <span className="font-semibold">{username}</span> печатает…
              </span>
              <span className="flex items-center gap-1 ml-auto shrink-0" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="block rounded-full"
                    style={{
                      width: 4,
                      height: 4,
                      background: variant === 'peer' ? '#7dd3fc' : '#60a5fa',
                    }}
                    animate={{
                      scaleY: [0.6, 1.4, 0.6],
                      opacity: [0.4, 1, 0.4],
                    }}
                    transition={{
                      duration: 1.2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: i * 0.18,
                    }}
                  />
                ))}
              </span>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
