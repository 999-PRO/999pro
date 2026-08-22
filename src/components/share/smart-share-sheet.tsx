'use client'

// ============================================================================
//  SmartShareSheet — premium share bottom sheet / modal.
//  ----------------------------------------------------------------------------
//  Features:
//    • 10 share targets: WhatsApp, Telegram, Instagram, Facebook, VK,
//      Messenger, X, Email, Copy Link, QR Code.
//    • Web Share API integration — on supported devices (mobile Chrome /
//      Safari) we use the native share sheet for a more native feel.
//    • Smart Story generator — generates a branded 1080×1440 (3:4) story image
//      (canvas) and shares it via Web Share API with files (Android Chrome)
//      or downloads it (iOS Safari).
//    • Analytics tracking — every tap on a platform records a `share` event
//      on the backend, with the platform name for attribution.
//    • Premium glass design with 999PRO branding.
// ============================================================================

import { useState, useEffect, useCallback } from 'react'
// v25.4 (TZ-2 task #1): render via portal so the share sheet is always on
// top of every other overlay (ProductPage z-[350], CheckoutSheet z-[450],
// etc.). Without a portal, the sheet inherits its parent's stacking context
// and gets clipped/hidden behind the product card.
import { createPortal } from 'react-dom'
// Wave 2 (F-BUG-003): shared scroll-lock hook (refcount-safe)
import { useScrollLock } from '@/lib/use-scroll-lock'
import { motion } from 'framer-motion'
import {
  X, Link2, QrCode, Mail, Check, Copy, MessageCircle,
  Send, Facebook, Instagram, Twitter, MessageSquare, Download, Sparkles, ShoppingBag,
} from 'lucide-react'
import type { SharePlatform } from '@999pro/shared'
import { buildShareUrl, buildShareText, canWebShareFiles } from '@/lib/share-platforms'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/notifications'
import { api } from '@/lib/api'
import { haptic } from '@/lib/haptic'
import { sounds } from '@/lib/sounds'
import { SmartStoryGenerator } from './smart-story-generator'
import { ChatRecipientPicker } from './chat-recipient-picker'
import { setPendingOpenConversation } from '@/lib/pending-chat-open'

interface ProductShare {
  id: string
  title: string
  description?: string | null
  price: number
  oldPrice?: number | null
  currency?: string
  images: string[]
  rating: number
  reviewsCount: number
}

interface Props {
  open: boolean
  onClose: () => void
  product: ProductShare
  shareUrl: string
  deepLinkUrl: string
  shortId: string
}

interface ShareTarget {
  platform: SharePlatform
  label: string
  icon: typeof MessageCircle
  color: string
  gradient: string
}

const TARGETS: ShareTarget[] = [
  {
    platform: 'whatsapp',
    label: 'WhatsApp',
    icon: MessageCircle,
    color: 'text-emerald-600',
    gradient: 'from-emerald-400 to-green-600',
  },
  {
    platform: 'telegram',
    label: 'Telegram',
    icon: Send,
    color: 'text-sky-500',
    gradient: 'from-[#EC4899] to-[#9333EA]',
  },
  {
    platform: 'instagram',
    label: 'Instagram',
    icon: Instagram,
    color: 'text-pink-500',
    gradient: 'from-[#EC4899] via-[#A855F7] to-[#9333EA]',
  },
  {
    platform: 'facebook',
    label: 'Facebook',
    icon: Facebook,
    color: 'text-blue-600',
    gradient: 'from-blue-500 to-blue-700',
  },
  {
    platform: 'vk',
    label: 'VK',
    icon: MessageSquare,
    color: 'text-blue-500',
    gradient: 'from-blue-400 to-indigo-600',
  },
  {
    platform: 'messenger',
    label: 'Messenger',
    icon: MessageCircle,
    color: 'text-violet-500',
    gradient: 'from-violet-400 to-fuchsia-600',
  },
  {
    platform: 'x',
    label: 'X',
    icon: Twitter,
    color: 'text-slate-900 dark:text-white',
    gradient: 'from-slate-700 to-slate-900',
  },
  {
    platform: 'email',
    label: 'Email',
    icon: Mail,
    color: 'text-slate-600',
    gradient: 'from-slate-400 to-slate-600',
  },
  {
    platform: 'copy',
    label: 'Копировать',
    icon: Link2,
    color: 'text-slate-600',
    gradient: 'from-slate-400 to-slate-600',
  },
  {
    platform: 'qrcode',
    label: 'QR-код',
    icon: QrCode,
    color: 'text-slate-900 dark:text-white',
    gradient: 'from-slate-700 to-slate-900',
  },
]

export function SmartShareSheet({ open, onClose, product, shareUrl, deepLinkUrl, shortId }: Props) {
  const [copied, setCopied] = useState(false)
  const [storyOpen, setStoryOpen] = useState(false)
  const [webShareAvailable, setWebShareAvailable] = useState(false)
  const [canShareFiles, setCanShareFiles] = useState(false)
  // Chat recipient picker — opened by "Отправить в чат" action.
  const [chatPickerOpen, setChatPickerOpen] = useState(false)
  const [sendingToChat, setSendingToChat] = useState(false)

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    setWebShareAvailable(!!navigator.share)
    setCanShareFiles(canWebShareFiles())
  }, [])

  // Lock body scroll when open
  // Wave 2 (F-BUG-003): delegate to shared useScrollLock (refcount-safe)
  useScrollLock(open)

  // Track share events — fire-and-forget.
  // Wave 6d: pass `ref` for platform attribution (which platform drove the share).
  const trackShare = useCallback(
    (platform: SharePlatform) => {
      api
        .post('/api/share/track', {
          json: { shortId, eventType: 'share', platform, ref: platform },
        })
        .catch(() => {})
    },
    [shortId],
  )

  // Open a share target. Some platforms (Instagram, Copy, QR) need special
  // handling — they don't have a URL intent.
  const handleShare = useCallback(
    async (target: ShareTarget) => {
      trackShare(target.platform)

      switch (target.platform) {
        case 'copy': {
          try {
            await navigator.clipboard?.writeText(shareUrl)
            setCopied(true)
            toast.success('Ссылка скопирована')
            setTimeout(() => setCopied(false), 2000)
          } catch {
            // Fallback for browsers without clipboard API
            const ta = document.createElement('textarea')
            ta.value = shareUrl
            ta.style.position = 'fixed'
            ta.style.opacity = '0'
            document.body.appendChild(ta)
            ta.select()
            try {
              document.execCommand('copy')
              setCopied(true)
              toast.success('Ссылка скопирована')
              setTimeout(() => setCopied(false), 2000)
            } catch {
              toast.error('Не удалось скопировать')
            }
            ta.remove()
          }
          return
        }

        case 'qrcode': {
          // Open the QR modal (handled by parent via a callback or local state).
          // We close this sheet and let the parent show the QR modal.
          onClose()
          // Dispatch a custom event so the parent page (SharePageClient) can
          // open the QR modal — cleaner than passing another prop.
          window.dispatchEvent(new CustomEvent('999pro:open-qr'))
          return
        }

        case 'instagram': {
          // Instagram doesn't support web share intents. Copy the link and
          // ask the user to paste it. On iOS we can try navigator.share with
          // files (image) which Instagram may pick up as a story share.
          if (canShareFiles) {
            // Trigger the story generator which will offer the option to
            // share to Instagram via files.
            setStoryOpen(true)
            return
          }
          try {
            await navigator.clipboard?.writeText(shareUrl)
            toast.info('Ссылка скопирована', {
              description: 'Откройте Instagram, нажмите «Поделиться» и вставьте ссылку.',
              duration: 6000,
            })
          } catch {
            toast.error('Не удалось скопировать ссылку')
          }
          return
        }

        default: {
          // For URL-based platforms (WhatsApp, Telegram, FB, VK, X, Email),
          // open the share intent in a new tab.
          // v24.3: pass price + currency so WhatsApp share includes the full
          // product info (name + price + description + link), not just the link.
          // v25.6 (Task #5): if window.open is blocked (popup blocker) or
          // returns null, fall back to copying the link to clipboard so the
          // user can still paste it manually into the target app.
          const url = buildShareUrl(target.platform, {
            title: product.title,
            description: product.description,
            url: shareUrl,
            price: product.price,
            currency: product.currency,
          })
          if (url) {
            // Try window.open first (works on desktop + most mobile browsers).
            const win = window.open(url, '_blank', 'noopener,noreferrer,width=600,height=600')
            // If the popup was blocked (win === null), copy the link instead
            // so the user still has a path forward.
            if (!win) {
              try {
                await navigator.clipboard?.writeText(url)
                toast.info('Ссылка скопирована', {
                  description: 'Откройте нужное приложение и вставьте ссылку вручную.',
                  duration: 6000,
                })
              } catch {
                // Last-resort: legacy execCommand fallback.
                try {
                  const ta = document.createElement('textarea')
                  ta.value = url
                  ta.style.position = 'fixed'
                  ta.style.opacity = '0'
                  document.body.appendChild(ta)
                  ta.select()
                  document.execCommand('copy')
                  ta.remove()
                  toast.info('Ссылка скопирована', {
                    description: 'Откройте нужное приложение и вставьте ссылку вручную.',
                    duration: 6000,
                  })
                } catch {
                  toast.error('Не удалось открыть приложение для шеринга')
                }
              }
            }
          }
          return
        }
      }
    },
    [product.title, product.description, shareUrl, canShareFiles, onClose, trackShare],
  )

  // Native Web Share API — try first if supported.
  const handleNativeShare = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.share) return
    trackShare('unknown')
    try {
      await navigator.share({
        title: product.title,
        text: buildShareText({
          title: product.title,
          description: product.description,
          url: shareUrl,
        }),
        url: shareUrl,
      })
      onClose()
    } catch {
      // User cancelled — do nothing.
    }
  }, [product.title, product.description, shareUrl, onClose, trackShare])

  // ---- "Отправить в чат" — sends a Product Message to a chosen recipient ----
  // The message uses mediaType='product' with mediaUrl=productId (NOT an image
  // URL). The recipient sees an interactive ProductMessageCard that lazy-
  // fetches the live product data via /api/products/batch. If the product is
  // deleted between send and view, the card gracefully shows "no longer
  // available" without breaking the conversation history.
  const handleSendToChat = useCallback(
    async (participantId: string, existingConversationId?: string) => {
      setSendingToChat(true)
      try {
        // 1. Get or create the conversation
        let conversationId = existingConversationId
        if (!conversationId) {
          const convRes = await api.post<{ conversation: { id: string } }>('/api/chat/conversations', {
            json: { participantId },
            auth: true,
          })
          conversationId = convRes.conversation.id
        }

        // 2. Send a product message via REST (the REST endpoint mirrors the
        //    socket message:send handler and broadcasts via Socket.IO to all
        //    participants, including the sender's other tabs). Using REST
        //    here (not the socket) because the SmartShareSheet is rendered
        //    outside the chat view, so the chat socket may not be connected.
        const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        await api.post(`/api/chat/conversations/${conversationId}/messages`, {
          json: {
            mediaType: 'product',
            mediaUrl: product.id, // productId — NOT an /uploads/ path
            clientMessageId: tempId,
          },
          auth: true,
        })

        toast.success('Товар отправлен в чат')
        haptic.success() // v10-native: haptic on product message sent
        sounds.send() // v10-native: sound on product message sent

        // Close the picker FIRST, then navigate.
        setChatPickerOpen(false)

        // v11-fix: navigate to chat view AND open the specific conversation
        // directly — NOT just the chat list.
        //
        // Previous approach (v10.3): dispatched two window CustomEvents with
        // 50ms + 100ms delays. This was fragile — ChatView is lazy-loaded
        // via next/dynamic and often hadn't mounted + registered its event
        // listener within 150ms. The `chat:open-conversation` event was
        // lost, and the user stayed on the chat list.
        //
        // New approach: set a module-level pending state BEFORE navigating.
        // ChatView reads it on mount (in its initial useEffect) and opens
        // the conversation directly. This is 100% reliable — no timing
        // dependencies. We still dispatch the window event as a fallback
        // for the case where ChatView is already mounted (e.g. user was
        // already on the chat view).
        if (typeof window !== 'undefined') {
          // Set pending FIRST — ChatView will read this on mount
          setPendingOpenConversation(conversationId)
          // Navigate to chat view
          window.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'chat' } }))
          // Also dispatch the window event — if ChatView is already mounted,
          // its listener will handle it immediately. If not, it will read
          // the pending state on mount.
          setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent('chat:open-conversation', { detail: { conversationId } }),
            )
          }, 300)
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Не удалось отправить товар'
        toast.error(msg)
        throw e // re-throw so the picker can show its own error state
      } finally {
        setSendingToChat(false)
      }
    },
    [product.id],
  )

  const handleClickSendToChat = useCallback(() => {
    // Always open the picker — if the user is not authenticated, the picker
    // will show an empty/error state (the /api/chat/users call will 401),
    // and the actual send will fail with a clear toast. This is better UX
    // than silently refusing to open the picker (the previous behaviour
    // caused "nothing happens" reports because the toast was easy to miss).
    setChatPickerOpen(true)
  }, [])

  if (!open) return null

  // v25.4 (TZ-2 task #1): render via portal at document.body so the share
  // sheet is always on top of every other overlay (ProductPage z-[350],
  // CheckoutSheet z-[450], etc.). Without a portal, the sheet inherits its
  // parent's stacking context and gets clipped/hidden behind the product card.
  // z-[9999] — higher than any other overlay in the app.
  return createPortal(
    <motion.div
      className="fixed inset-0 z-[9999] flex items-end md:items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Sheet */}
        <motion.div
          className="relative w-full md:max-w-md bg-white dark:bg-slate-950 rounded-t-[32px] md:rounded-[32px] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          {/* Drag handle (mobile) */}
          <div className="md:hidden pt-3 pb-2 flex justify-center shrink-0">
            <div className="h-1.5 w-12 rounded-full bg-slate-200 dark:bg-slate-700" />
          </div>

          {/* Header — v25.12: 999PRO gradient logo, no "9" */}
          <div className="px-5 pb-3 flex items-start justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-9 w-9 rounded-xl grid place-items-center text-white font-extrabold text-xs shrink-0" style={{ background: 'linear-gradient(135deg, #EC4899, #A855F7, #9333EA)' }}>
                T
              </div>
              <div className="min-w-0">
                <div className="font-bold text-base leading-tight">Поделиться товаром</div>
                <div className="text-xs text-slate-500 truncate">{product.title}</div>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Закрыть"
              className="h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 grid place-items-center hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Web Share API button (native) */}
          {webShareAvailable && (
            <div className="px-5 pb-3 shrink-0">
              <button
                onClick={handleNativeShare}
                className="w-full h-12 rounded-2xl bg-gradient-to-r from-[#EC4899] to-[#9333EA] text-white font-bold shadow-lg shadow-pink-500/30 hover:shadow-xl hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
              >
                <ShareIcon /> Поделиться через систему
              </button>
            </div>
          )}

          {/* Send-to-chat CTA — premium inline action above the share grid.
              Sends an interactive ProductMessageCard to the chosen recipient.
              Single-tap → opens ChatRecipientPicker → user picks → product
              message sent. Visible to all users (logged-out users get the
              AuthDialog prompt). */}
          <div className="px-5 pb-3 shrink-0">
            <button
              onClick={handleClickSendToChat}
              disabled={sendingToChat}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-[#10B981] to-[#059669] text-white font-bold shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:scale-[1.02] transition-all disabled:opacity-60 disabled:hover:scale-100 flex items-center justify-center gap-2"
            >
              {sendingToChat ? (
                <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              ) : (
                <ShoppingBag className="h-5 w-5" />
              )}
              Отправить в чат
            </button>
          </div>

          {/* Share targets grid */}
          <div className="px-5 pb-3 overflow-y-auto overscroll-contain flex-1">
            <div className="grid grid-cols-4 gap-3">
              {TARGETS.map((target) => {
                const Icon = target.icon
                return (
                  <button
                    key={target.platform}
                    onClick={() => handleShare(target)}
                    className="flex flex-col items-center gap-1.5 group"
                  >
                    <div
                      className={cn(
                        'h-14 w-14 rounded-2xl grid place-items-center text-white shadow-lg bg-gradient-to-br transition-transform group-hover:scale-105 group-active:scale-95',
                        target.gradient,
                      )}
                    >
                      {target.platform === 'copy' && copied ? (
                        <Check className="h-6 w-6" />
                      ) : (
                        <Icon className="h-6 w-6" />
                      )}
                    </div>
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {target.label}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Smart Story generator entry */}
            <div className="mt-4 rounded-2xl bg-gradient-to-br from-[#EC4899] via-[#A855F7] to-[#9333EA] p-4 text-white relative overflow-hidden">
              <div className="absolute inset-0 opacity-20 pointer-events-none">
                <Sparkles className="absolute -top-2 -right-2 h-20 w-20" />
              </div>
              <div className="relative flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-sm mb-0.5">Smart Story</div>
                  <div className="text-xs text-white/80 leading-tight">
                    Создать красивую историю 1080×1440 с логотипом 999PRO и QR-кодом
                  </div>
                </div>
                <button
                  onClick={() => setStoryOpen(true)}
                  className="shrink-0 h-9 px-4 rounded-full bg-white text-pink-600 text-xs font-bold hover:bg-white/90 transition-colors"
                >
                  Создать
                </button>
              </div>
            </div>

            {/* Link preview */}
            <div className="mt-4 rounded-2xl bg-slate-100 dark:bg-slate-800/60 p-3 flex items-center gap-2">
              <Link2 className="h-4 w-4 text-slate-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-500 mb-0.5">Ссылка на товар</div>
                <div className="text-xs font-mono truncate">{shareUrl}</div>
              </div>
              <button
                onClick={() => handleShare({ platform: 'copy', label: '', icon: Copy, color: '', gradient: '' })}
                className="shrink-0 h-8 px-3 rounded-full bg-white dark:bg-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
              >
                {copied ? '✓' : 'Копировать'}
              </button>
            </div>
          </div>

          {/* Footer branding — v25.12: only 999PRO, no "9" badge */}
          <div className="px-5 py-3 border-t border-slate-200/60 dark:border-slate-800/60 shrink-0">
            <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
              <span
                className="font-extrabold text-xs"
                style={{
                  backgroundImage: 'linear-gradient(135deg, #EC4899, #A855F7, #9333EA)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                999PRO
              </span>
            </div>
          </div>
        </motion.div>

      {/* Smart Story generator modal */}
      {storyOpen && (
        <SmartStoryGenerator
          open={storyOpen}
          onClose={() => setStoryOpen(false)}
          product={product}
          shareUrl={shareUrl}
          deepLinkUrl={deepLinkUrl}
          shortId={shortId}
        />
      )}

      {/* Chat recipient picker — opened by "Отправить в чат". Renders above
          the share sheet (z-index higher via InteractiveSheet). The picker
          closes itself on successful send (handleSendToChat calls
          setChatPickerOpen(false) + onClose() on the parent sheet). */}
      <ChatRecipientPicker
        open={chatPickerOpen}
        onClose={() => setChatPickerOpen(false)}
        onPick={handleSendToChat}
        title="Отправить товар в чат"
      />
    </motion.div>,
    document.body,
  )
}

function ShareIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  )
}
