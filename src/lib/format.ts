// Formatting helpers used across the UI.

// F-LOW-001 fix: cache Intl.NumberFormat at module level (was constructed
// per call — 96 constructions per catalog render). Format depends only on
// currency, so cache one formatter per currency.
const formatterCache = new Map<string, Intl.NumberFormat>()

function getCachedFormatter(currency: string): Intl.NumberFormat {
  let f = formatterCache.get(currency)
  if (!f) {
    f = new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    })
    formatterCache.set(currency, f)
  }
  return f
}

export function formatPrice(value: number, currency = 'RUB'): string {
  try {
    return getCachedFormatter(currency).format(value)
  } catch {
    return `${value} ${currency}`
  }
}

export function formatCompactNumber(value: number): string {
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`
  return `${(value / 1_000_000).toFixed(1)}M`
}

export function timeAgo(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = Date.now()
  const diff = Math.max(0, now - d.getTime())
  const sec = Math.floor(diff / 1000)
  if (sec < 5) return 'только что'
  if (sec < 60) return `${sec} с назад`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} мин назад`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ч назад`
  const days = Math.floor(hr / 24)
  if (days < 7) return `${days} дн назад`
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export function formatTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function initials(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// v12: format file size in human-readable form
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Б'
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ГБ`
}
