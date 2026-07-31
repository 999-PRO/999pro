// Smart Share — platform-specific URL builders.
//
// Each platform gets a properly-encoded share URL that opens the official
// app / web intent with the product's title, share URL, and an optional
// marketing description.
//
// All URLs use the platform's official share intent format:
//   • WhatsApp:   https://wa.me/?text=...
//   • Telegram:   https://t.me/share/url?url=...&text=...
//   • Instagram:  no web share intent — uses Web Share API or clipboard
//   • Facebook:   https://www.facebook.com/sharer/sharer.php?u=...
//   • VK:         https://vk.com/share.php?url=...&title=...&description=...
//   • Messenger:  https://www.facebook.com/dialog/send?app_id=...&link=...&redirect_uri=...
//   • X:          https://twitter.com/intent/tweet?url=...&text=...
//   • Email:      mailto:?subject=...&body=...
//
// Note on Instagram: Instagram does NOT support web share intents. The
// only way to share to Instagram is via the native Web Share API
// (navigator.share with files), or by copying the link and asking the
// user to paste it. We do the latter (clipboard + toast) because
// navigator.share cannot reliably target Instagram specifically.

import type { SharePlatform } from '@999pro/shared'

interface SharePayload {
  title: string
  description?: string | null
  url: string
  // v24.3: price + currency for WhatsApp share (user requested product name +
  // price + description + link, not just the link).
  price?: number | null
  currency?: string
  // Optional: app install / marketing tagline appended to the share text
  appTagline?: string
}

const DEFAULT_TAGLINE = 'Маркетплейс нового поколения — 999 — Три девятки'

/** Format a price with currency symbol. */
function formatPrice(price: number, currency?: string): string {
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₽'
  return `${price.toLocaleString('ru-RU')} ${symbol}`
}

/** Build the platform-specific share URL for the given payload. */
export function buildShareUrl(platform: SharePlatform, payload: SharePayload): string | null {
  const { title, description, url, price, currency, appTagline = DEFAULT_TAGLINE } = payload

  // v24.3: WhatsApp share text includes product name + price + description + link.
  // Previously only the link was effectively visible because WhatsApp's link
  // preview would "absorb" the surrounding text visually. Now we put the
  // price prominently on its own line so it's clearly visible even with
  // the link preview card.
  const priceLine = price != null && price > 0 ? `💰 ${formatPrice(price, currency)}` : ''
  const text = [
    title,
    priceLine,
    description?.slice(0, 280),
    `👉 ${url}`,
    '',
    appTagline,
  ]
    .filter(Boolean)
    .join('\n')

  switch (platform) {
    case 'whatsapp':
      // wa.me uses `text` query param — WhatsApp URL-encodes it itself.
      // v24.3: text now includes title + price + description + link + tagline.
      return `https://wa.me/?text=${encodeURIComponent(text)}`

    case 'telegram':
      // Telegram share URL supports both url and text.
      return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title + (description ? '\n\n' + description.slice(0, 280) : ''))}`

    case 'facebook':
      // Facebook sharer only uses the `u` param; OG tags on the share page
      // determine the title/description/image.
      return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(title)}`

    case 'vk':
      // VK share supports url, title, description, image.
      const vkParams = new URLSearchParams({
        url,
        title,
        description: (description || appTagline).slice(0, 280),
      })
      return `https://vk.com/share.php?${vkParams.toString()}`

    case 'messenger':
      // Messenger uses the send dialog. App ID is required; we use a generic
      // ID — operators should replace with their own Facebook App ID.
      const appId = '999pro' // placeholder, replace with real FB App ID
      return `https://www.facebook.com/dialog/send?app_id=${appId}&link=${encodeURIComponent(url)}&redirect_uri=${encodeURIComponent(url)}`

    case 'x':
      // X (Twitter) intent: url + text. The share page's twitter:card meta
      // determines the preview.
      return `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`

    case 'email':
      const subject = title
      const body = text
      return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

    case 'instagram':
      // Instagram doesn't support web share intents. Return null — the
      // caller should copy the link to clipboard and show a toast telling
      // the user to paste it in Instagram.
      return null

    case 'copy':
    case 'qrcode':
    case 'web':
    case 'in-app':
    case 'unknown':
      return null

    default:
      return null
  }
}

/** Build the canonical share text (used for clipboard + Web Share API). */
export function buildShareText(payload: SharePayload): string {
  const { title, description, url, price, currency, appTagline = DEFAULT_TAGLINE } = payload
  const priceLine = price != null && price > 0 ? `💰 ${formatPrice(price, currency)}` : ''
  return [title, priceLine, description?.slice(0, 280), `👉 ${url}`, '', appTagline]
    .filter(Boolean)
    .join('\n')
}

/** Detect if the current UA is iOS Safari (used for Web Share API quirks). */
export function isIOSSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  const isWebkit = /WebKit/.test(ua)
  const isNotChrome = !/CriOS/.test(ua)
  return isIOS && isWebkit && isNotChrome
}

/** Detect if Web Share API is available with files (needed for Instagram stories). */
export function canWebShareFiles(): boolean {
  if (typeof navigator === 'undefined') return false
  if (!navigator.share) return false
  if (!navigator.canShare) return false
  try {
    return navigator.canShare({ files: [new File([], 'test.png', { type: 'image/png' })] })
  } catch {
    return false
  }
}
