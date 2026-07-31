import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPrice(value: number, currency = 'RUB'): string {
  try {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
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

// v13.1 (audit code-health): shared Russian pluralization helper.
// Replaces 3 duplicate implementations in products-manager, leads-manager,
// stories-manager. Pass the count and the three forms:
//   pluralize(1, ['товар','товара','товаров']) → "товар"
//   pluralize(3, ['товар','товара','товаров']) → "товара"
//   pluralize(5, ['товар','товара','товаров']) → "товаров"
export function pluralize(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}
