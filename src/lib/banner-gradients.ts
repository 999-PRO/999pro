// QW10 (F-DUP-001): Extracted from hero.tsx + promo-banner.tsx to avoid drift.
//
// Map the gradient string stored on the banner/hero (e.g.
// "from-sky-400 via-blue-500 to-indigo-600") to an actual CSS gradient.
// We do this instead of using Tailwind classes dynamically because Tailwind
// purges classes that don't appear literally in the source.

export const GRADIENT_MAP: Record<string, string> = {
  'from-sky-400 via-blue-500 to-indigo-600':
    'linear-gradient(135deg, #38bdf8 0%, #3b82f6 50%, #4f46e5 100%)',
  'from-fuchsia-500 via-purple-500 to-indigo-600':
    'linear-gradient(135deg, #d946ef 0%, #a855f7 50%, #4f46e5 100%)',
  'from-emerald-400 via-teal-500 to-cyan-600':
    'linear-gradient(135deg, #34d399 0%, #14b8a6 50%, #0891b2 100%)',
  'from-amber-400 via-orange-500 to-red-600':
    'linear-gradient(135deg, #fbbf24 0%, #f97316 50%, #dc2626 100%)',
  'from-pink-400 via-rose-500 to-red-600':
    'linear-gradient(135deg, #f472b6 0%, #f43f5e 50%, #dc2626 100%)',
}

export const DEFAULT_GRADIENT_KEY = 'from-sky-400 via-blue-500 to-indigo-600'

export function gradientCss(gradient: string): string {
  return GRADIENT_MAP[gradient] || GRADIENT_MAP[DEFAULT_GRADIENT_KEY]
}
