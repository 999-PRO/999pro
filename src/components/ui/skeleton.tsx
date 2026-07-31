'use client'

import { cn } from '@/lib/utils'

// ============================================================================
// Skeleton — placeholder shapes shown while real content loads.
// Mimics the layout of the real content so there's no visual jump when
// data arrives. Uses a subtle shimmer animation (no spinner — spinners feel
// slow and cheap, skeletons feel native).
//
// Usage:
//   {loading ? <Skeleton className="h-4 w-32" /> : <h1>{title}</h1>}
// ============================================================================

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        // v9-audit-fix: previously had BOTH `animate-pulse` (opacity pulse)
        // AND `animate-[shimmer_2s_ease-in-out_infinite]` (background sweep).
        // They fought each other visually. Keep only the shimmer sweep.
        'rounded-md bg-muted',
        'bg-gradient-to-r from-muted via-muted/50 to-muted',
        'bg-[length:200%_100%]',
        'animate-[shimmer_2s_ease-in-out_infinite]',
        className,
      )}
      aria-hidden
    />
  )
}

// v9-audit-fix: dead code removal — SkeletonRows, SkeletonProductCard,
// SkeletonProductGrid, SkeletonChatList were exported but never imported.
// The single `Skeleton` primitive is composable enough for callers to
// build their own layouts inline. Restore from git history if a generic
// composite skeleton is needed again.
