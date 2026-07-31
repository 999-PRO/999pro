'use client'

/**
 * ClubSkeleton — loading placeholder for the CLUB landing page.
 *
 * Mimics the shape of the real page (hero + card grid) with pulsing
 * placeholders. Much more premium than a spinner.
 */

import { motion } from 'framer-motion'

export function ClubSkeleton() {
  return (
    <div className="pb-28 md:pb-12 page-top-padding">
      {/* Hero skeleton */}
      <div className="px-4 md:px-6 pt-4 md:pt-8">
        <div
          className="rounded-[32px] p-6 md:p-10"
          style={{
            background: 'linear-gradient(135deg, rgba(245,158,11,0.10) 0%, rgba(236,72,153,0.08) 50%, rgba(139,92,246,0.10) 100%)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="h-12 w-12 rounded-2xl bg-foreground/10 animate-pulse" />
            <div className="h-5 w-20 rounded-full bg-foreground/10 animate-pulse" />
          </div>
          <div className="h-8 w-40 rounded-xl bg-foreground/10 animate-pulse mb-2" />
          <div className="h-4 w-64 rounded-lg bg-foreground/5 animate-pulse mb-5" />
          <div className="h-14 w-48 rounded-2xl bg-foreground/10 animate-pulse" />
        </div>
      </div>

      {/* Card grid skeleton */}
      <div className="px-4 md:px-6 pt-8">
        <div className="h-6 w-32 rounded-lg bg-foreground/10 animate-pulse mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {[...Array(8)].map((_, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="rounded-3xl p-4 glass border border-border/40"
            >
              <div className="h-12 w-12 rounded-2xl bg-foreground/10 animate-pulse mb-3" />
              <div className="h-4 w-20 rounded bg-foreground/10 animate-pulse mb-2" />
              <div className="h-3 w-full rounded bg-foreground/5 animate-pulse" />
              <div className="h-3 w-2/3 rounded bg-foreground/5 animate-pulse mt-1" />
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}
