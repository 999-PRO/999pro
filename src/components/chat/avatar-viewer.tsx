'use client'

// ============================================================================
// AvatarViewer — полноэкранный просмотр аватара с плавной анимацией.
// ----------------------------------------------------------------------------
// Открывается при нажатии на аватар в Header или в Profile.
// НЕ открывает профиль — именно просмотр фотографии.
// ============================================================================

import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { assetUrl } from '@/lib/api'

interface AvatarViewerProps {
  open: boolean
  avatarUrl: string | null | undefined
  displayName?: string
  onClose: () => void
}

export function AvatarViewer({ open, avatarUrl, displayName, onClose }: AvatarViewerProps) {
  return (
    <AnimatePresence>
      {open && avatarUrl && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[130] bg-black/95 grid place-items-center"
          onClick={onClose}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-0 right-0 z-10 h-12 w-12 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 text-white active:scale-90 transition-all"
            style={{ top: 'max(env(safe-area-inset-top), 16px)', right: '16px' }}
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Avatar image with zoom-in animation */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 28 }}
            className="relative"
            onClick={(e) => e.stopPropagation()}
          >
            { }
            <img
              src={assetUrl(avatarUrl)}
              alt={displayName || 'Аватар'}
              className="max-w-[90vw] max-h-[80vh] rounded-full object-cover"
              style={{
                boxShadow: '0 20px 60px -15px rgba(0,0,0,0.6)',
              }}
            />
          </motion.div>

          {/* Name caption */}
          {displayName && (
            <div
              className="absolute bottom-0 left-0 right-0 p-6 text-center text-white"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-lg font-semibold">{displayName}</div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
