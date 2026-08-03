'use client'

import { Button } from '@/components/ui/button'
import {
  Info, ChevronLeft, Share2, Code, Database, Cpu, Globe,
  Shield, Zap, Heart,
} from 'lucide-react'
import { toast } from '@/lib/notifications'

// ============================================================================
// AboutView — "About the app" page.
//
// Shows:
// - App name + version
// - Description
// - Build info (date, hash, environment)
// - Platform info (browser, OS — detected at runtime)
// - Tech stack
// - License
// - Share button (Web Share API with clipboard fallback)
// ============================================================================

// Build metadata — would be injected at build time in a real CI/CD pipeline.
// For now, hardcoded but easy to wire up to Next.js public runtime config.
const BUILD_INFO = {
  version: '1.0.0',
  buildDate: '2026-06-29',
  environment: process.env.NODE_ENV || 'development',
  commit: 'main',
}

export function AboutView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const handleShare = async () => {
    // v25.6 (Task #4): Web Share API with proper clipboard fallback.
    // Toast "Ссылка скопирована" only after successful copy.
    const shareData = {
      title: '999 — Три девятки',
      text: 'Современный маркетплейс нового поколения с голосовым AI-агентом',
      url: typeof window !== 'undefined' ? window.location.origin : 'https://999pro.app',
    }
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share(shareData)
      } catch {
        // User cancelled — non-critical, no toast.
      }
    } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(shareData.url)
        toast.success('Ссылка скопирована')
      } catch {
        toast.error('Не удалось скопировать ссылку')
      }
    } else {
      // Legacy fallback: execCommand on hidden textarea.
      try {
        const ta = document.createElement('textarea')
        ta.value = shareData.url
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        ta.remove()
        if (ok) toast.success('Ссылка скопирована')
        else toast.error('Не удалось скопировать ссылку')
      } catch {
        toast.error('Не удалось скопировать ссылку')
      }
    }
  }

  // Detect platform info at runtime (client-only).
  const platformInfo = typeof window !== 'undefined' ? detectPlatform() : null

  return (
    <div className="page-top-padding pb-28 md:pb-6">
      <div className="px-4 md:px-6 max-w-2xl mx-auto">
        <button
          onClick={() => onNavigate('settings')}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ChevronLeft className="h-4 w-4" /> Настройки
        </button>

        {/* Hero */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-24 w-24 rounded-3xl gradient-brand grid place-items-center shadow-glow-lg mb-4">
            <span className="text-3xl font-extrabold text-white">999</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight mb-0.5">999</h1>
          <p className="text-base font-light tracking-[0.2em] uppercase text-muted-foreground mb-2">
            Три девятки
          </p>
          <p className="text-sm text-muted-foreground mb-2">
            Маркетплейс нового поколения
          </p>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/15 text-primary text-xs font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Версия {BUILD_INFO.version}
          </div>
        </div>

        {/* Description */}
        <div className="glass rounded-3xl p-5 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <Info className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">О приложении</h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            «Три девятки» — это современный маркетплейс, объединяющий каталог товаров, ленту публикаций,
            живой чат с аудио- и видеозвонками, истории и систему отзывов. Приложение работает как
            PWA — устанавливается на рабочий стол, работает офлайн и отправляет push-уведомления.
          </p>
        </div>

        {/* Build info */}
        <div className="glass rounded-3xl p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Code className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Информация о сборке</h2>
          </div>
          <dl className="space-y-2 text-sm">
            <InfoRow label="Версия" value={BUILD_INFO.version} />
            <InfoRow label="Дата сборки" value={BUILD_INFO.buildDate} />
            <InfoRow label="Окружение" value={BUILD_INFO.environment} />
            <InfoRow label="Ветка" value={BUILD_INFO.commit} />
          </dl>
        </div>

        {/* Platform info (runtime-detected) */}
        {platformInfo && (
          <div className="glass rounded-3xl p-5 mb-5">
            <div className="flex items-center gap-2 mb-3">
              <Cpu className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Платформа</h2>
            </div>
            <dl className="space-y-2 text-sm">
              <InfoRow label="Браузер" value={platformInfo.browser} />
              <InfoRow label="ОС" value={platformInfo.os} />
              <InfoRow label="Устройство" value={platformInfo.device} />
              <InfoRow label="Экран" value={platformInfo.screen} />
              <InfoRow label="Язык" value={platformInfo.language} />
              <InfoRow label="Online" value={platformInfo.online ? '✓ Да' : '✗ Нет'} />
            </dl>
          </div>
        )}

        {/* Tech stack */}
        <div className="glass rounded-3xl p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Database className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Технологии</h2>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              'Next.js 16', 'React 19', 'TypeScript 5', 'Tailwind CSS 4',
              'Prisma 6', 'SQLite', 'Socket.IO 4', 'Express 4',
              'Zustand 5', 'shadcn/ui', 'Framer Motion', 'Web Push (VAPID)',
            ].map((tech) => (
              <div key={tech} className="px-3 py-2 rounded-xl bg-accent/30 font-medium">
                {tech}
              </div>
            ))}
          </div>
        </div>

        {/* Features */}
        <div className="glass rounded-3xl p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Возможности</h2>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              PWA — установка на рабочий стол, работа офлайн
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              Push-уведомления о новых сообщениях и заказах
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              Real-time чат с аудио- и видеозвонками (WebRTC)
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              {/* QW9 (F-DEAD-005): Feed module removed in v12.3, replaced by 999 CLUB */}
              999 CLUB — программа лояльности с подарками, бонусами и розыгрышами
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              Каталог товаров с фильтрами и живой ротацией
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              Истории (Stories) с категориями и просмотрами
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              Система отзывов с рейтингами и фотографиями
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              Заказы с отслеживанием статусов в реальном времени
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              Поддержка 24/7 через чат с командой «Три девятки»
            </li>
          </ul>
        </div>

        {/* License */}
        <div className="glass rounded-3xl p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Лицензия</h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            © 2026 «Три девятки». Все права защищены.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Приложение «Три девятки» распространяется на условиях проприетарной лицензии.
            Исходный код является коммерческой тайной. Любое использование, копирование или
            распространение без письменного разрешения правообладателя запрещено.
          </p>
        </div>

        {/* Credits */}
        <div className="glass rounded-3xl p-5 mb-5 text-center">
          <Heart className="h-5 w-5 text-rose-500 mx-auto mb-2" />
          <p className="text-sm font-medium mb-1">Сделано с любовью</p>
          <p className="text-xs text-muted-foreground">
            Командой «Три девятки» для наших пользователей
          </p>
        </div>

        {/* Share button */}
        <Button
          onClick={handleShare}
          className="w-full rounded-full gradient-brand text-white font-semibold h-12 shadow-glow"
        >
          <Share2 className="h-4 w-4 mr-2" />
          Поделиться приложением
        </Button>

        <div className="text-center text-xs text-muted-foreground pt-4 pb-2">
          999 · Три девятки · {BUILD_INFO.version} · {BUILD_INFO.buildDate}
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-right truncate">{value}</dd>
    </div>
  )
}

// ============================================================================
// detectPlatform — runtime browser/OS detection for the About page.
// ============================================================================

function detectPlatform(): {
  browser: string
  os: string
  device: string
  screen: string
  language: string
  online: boolean
} {
  const ua = navigator.userAgent
  let browser = 'Неизвестно'
  if (ua.includes('Firefox/')) browser = 'Firefox'
  else if (ua.includes('Edg/')) browser = 'Edge'
  else if (ua.includes('Chrome/')) browser = 'Chrome'
  else if (ua.includes('Safari/')) browser = 'Safari'

  let os = 'Неизвестно'
  if (ua.includes('Windows')) os = 'Windows'
  else if (ua.includes('Mac OS')) os = 'macOS' + (ua.includes('iPhone') || ua.includes('iPad') ? ' (iOS)' : '')
  else if (ua.includes('Android')) os = 'Android'
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'
  else if (ua.includes('Linux')) os = 'Linux'

  const device = /Mobi|Android|iPhone|iPad/.test(ua) ? 'Мобильное' : 'Десктоп'
  const screen = `${window.screen.width}×${window.screen.height}`
  const language = navigator.language || 'Неизвестно'
  const online = navigator.onLine

  return { browser, os, device, screen, language, online }
}
