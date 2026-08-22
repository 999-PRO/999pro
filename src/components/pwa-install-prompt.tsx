'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Download, X, Smartphone } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================================
// PWA Install Prompt — listens for the browser's `beforeinstallprompt` event
// and shows a custom "Install app" banner. The native browser prompt is
// unreliable (especially on iOS Safari which doesn't fire it at all), so we
// provide our own UI that:
//
//   1. Shows a dismissible banner at the bottom of the screen on desktop /
//      top on mobile when `beforeinstallprompt` fires.
//   2. Calls `prompt()` on the deferred event when user clicks Install.
//   3. Falls back to platform-specific instructions (iOS Add to Home Screen)
//      when running on iOS Safari (which doesn't support
//      `beforeinstallprompt`).
//   4. Doesn't show if the app is already installed (display-mode: standalone)
//      or if the user previously dismissed it (stored in localStorage).
// ============================================================================

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = '999pro-pwa-install-dismissed'
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  // iOS Safari
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS Safari (older syntax)
  if ((window.navigator as unknown as { standalone?: boolean }).standalone === true) return true
  // Android Chrome / Edge
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true
  // app-mode (some Android browsers)
  if (window.matchMedia('(display-mode: minimal-ui)').matches) return true
  return false
}

function isIOS(): boolean {
  if (typeof window === 'undefined') return false
  // iOS Safari detection — includes iPad (which reports as Mac)
  const ua = window.navigator.userAgent.toLowerCase()
  const isIPad = ua.includes('ipad') || (ua.includes('macintosh') && 'ontouchend' in document)
  const isIPhone = ua.includes('iphone') || ua.includes('ipod')
  return isIPad || isIPhone
}

function isDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const ts = Number(raw)
    if (!ts) return false
    return Date.now() - ts < DISMISS_DURATION_MS
  } catch {
    return false
  }
}

function markDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    // localStorage may be unavailable (private mode) — ignore
  }
}

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosHint, setShowIosHint] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Don't show if app is already installed
    if (isStandalone()) return
    // Don't show if dismissed recently
    if (isDismissedRecently()) return

    const onBeforeInstall = (e: Event) => {
      // Prevent the default browser prompt — we want to show our own UI
      e.preventDefault()
      const evt = e as BeforeInstallPromptEvent
      setDeferredPrompt(evt)
      setVisible(true)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    // Appinstalled event — hide the banner once installed
    const onInstalled = () => {
      setVisible(false)
      setDeferredPrompt(null)
      setShowIosHint(false)
    }
    window.addEventListener('appinstalled', onInstalled)

    // iOS Safari doesn't fire beforeinstallprompt. Show a hint banner
    // instead after a delay (so it doesn't immediately nag the user).
    let iosTimer: ReturnType<typeof setTimeout> | null = null
    if (isIOS() && !deferredPrompt) {
      iosTimer = setTimeout(() => {
        if (!isStandalone() && !isDismissedRecently()) {
          setShowIosHint(true)
          setVisible(true)
        }
      }, 30000) // 30 seconds — give the user time to look around first
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      if (iosTimer) clearTimeout(iosTimer)
    }
  }, [deferredPrompt])

  const handleInstall = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt()
        const choice = await deferredPrompt.userChoice
        if (choice.outcome === 'accepted') {
          // The app will be installed — hide the banner.
          setVisible(false)
        } else {
          // User dismissed — remember for 7 days so we don't nag them.
          markDismissed()
          setVisible(false)
        }
      } catch {
        // prompt() can throw if called twice — just hide.
        setVisible(false)
      }
      setDeferredPrompt(null)
    } else if (isIOS()) {
      // iOS — we can't trigger the install. Just hide the hint.
      markDismissed()
      setVisible(false)
    }
  }

  const handleDismiss = () => {
    markDismissed()
    setVisible(false)
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="fixed left-3 right-3 bottom-20 md:bottom-6 md:left-1/2 md:-translate-x-1/2 md:right-auto md:w-[480px] z-40"
        >
          <div className="rounded-3xl glass border border-white/30 dark:border-white/10 shadow-glow-lg overflow-hidden">
            <div className="flex items-start gap-3 p-4">
              <div className="shrink-0 w-11 h-11 rounded-2xl gradient-brand flex items-center justify-center text-white shadow-glow">
                <Smartphone className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm mb-0.5">
                  Установить 999PRO
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {showIosHint
                    ? 'Нажмите «Поделиться» → «На экран Домой» для работы офлайн и push-уведомлений.'
                    : 'Быстрый доступ с рабочего стола, push-уведомления и работа офлайн.'}
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    onClick={handleInstall}
                    size="sm"
                    className="rounded-full gradient-brand text-white font-semibold h-8 px-4 text-xs"
                  >
                    <Download className="w-3.5 h-3.5 mr-1" />
                    {showIosHint ? 'Понятно' : 'Установить'}
                  </Button>
                  <Button
                    onClick={handleDismiss}
                    size="sm"
                    variant="ghost"
                    className="rounded-full h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Не сейчас
                  </Button>
                </div>
              </div>
              <button
                onClick={handleDismiss}
                aria-label="Закрыть"
                className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
