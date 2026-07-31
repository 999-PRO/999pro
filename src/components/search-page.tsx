'use client'

import { motion } from 'framer-motion'
import { SearchContent } from '@/components/search/search-content'

interface SearchPageProps {
  onBack: () => void
  onOpenProduct: (id: string) => void
  onStartConversation?: (userId: string) => void
  initialQuery?: string
}

/**
 * Full-screen search page (replaces the old overlay).
 * Opened from the search icon in the header.
 *
 * v12.7: refactored — the inner search UI is now in `SearchContent` (shared
 * with `SearchOverlay`). This file is a thin wrapper that adds the page-level
 * motion transition (slide in from the right). No behavior change.
 */
export function SearchPage({
  onBack,
  onOpenProduct,
  onStartConversation,
  initialQuery = '',
}: SearchPageProps) {
  return (
    <motion.div
      className="min-h-screen flex flex-col page-top-padding"
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 30 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <SearchContent
        onBack={onBack}
        onOpenProduct={onOpenProduct}
        onStartConversation={onStartConversation}
        initialQuery={initialQuery}
        showBackButton
        autoFocus
      />
    </motion.div>
  )
}
