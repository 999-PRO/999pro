'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import DOMPurify from 'dompurify'
import {
  ChevronLeft, FileText, Info, Shield, Cookie, UserCheck, Mail,
  HelpCircle, Building2, Phone, Lock, BookOpen, AlertCircle,
  ExternalLink, RefreshCw,
} from 'lucide-react'
import { api, assetUrl } from '@/lib/api'

// ============================================================================
// InfoPageView — universal renderer for any DB-backed info page.
//
// Fetches a page by slug from /api/info-pages/:slug and renders it.
// Used for all standard info pages (about, privacy, terms, cookies, rights,
// contacts, help, company) AND any custom pages created via Studio.
//
// Live-refresh: listens for 'info-pages:changed' window event (forwarded from
// socket 'info-pages:changed' broadcast) and refetches automatically when
// an admin edits the page in Studio.
// ============================================================================

// Lucide icon name → component mapping (subset; admin can pick from this list).
const ICON_MAP: Record<string, typeof FileText> = {
  FileText, Info, Shield, Cookie, UserCheck, Mail,
  HelpCircle, Building2, Phone, Lock, BookOpen, AlertCircle,
}

interface InfoPageData {
  id: string
  slug: string
  title: string
  subtitle?: string | null
  content: string
  images: string[]
  icon: string
  order: number
  isPublished: boolean
  showInMenu: boolean
  metaDescription?: string | null
  createdAt: string
  updatedAt: string
}

interface InfoPageViewProps {
  slug: string
  onNavigate: (v: string) => void
  onBack?: string
  /** Optional override for the back button label (defaults to "Назад"). */
  backLabel?: string
}

export function InfoPageView({ slug, onNavigate, onBack = 'settings', backLabel }: InfoPageViewProps) {
  const [page, setPage] = useState<InfoPageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const fetchPage = useCallback(() => {
    setLoading(true)
    setError(null)
    api.get<InfoPageData>(`/api/info-pages/${slug}`)
      .then((data) => setPage(data))
      .catch((e) => {
        console.error(`[info-page-view] failed to load slug="${slug}":`, e)
        setError('Не удалось загрузить страницу')
      })
      .finally(() => setLoading(false))
  }, [slug])

  useEffect(() => { fetchPage() }, [fetchPage, refreshKey])

  // Live-refresh: when Studio saves (any info page change), refetch our page
  // in case it was the one edited.
  useEffect(() => {
    const onInfoPagesChanged = () => {
      // Refetch on any change — backend emits a single event for all pages.
      // The HTTP cache (5min, stale-while-revalidate) ensures this is cheap.
      fetchPage()
    }
    window.addEventListener('999pro:info-pages-changed', onInfoPagesChanged as EventListener)
    return () => window.removeEventListener('999pro:info-pages-changed', onInfoPagesChanged as EventListener)
  }, [fetchPage])

  const Icon = (page?.icon && ICON_MAP[page.icon]) || FileText

  // Loading skeleton
  if (loading) {
    return (
      <div className="page-top-padding pb-28 md:pb-6">
        <div className="px-4 md:px-6 max-w-3xl mx-auto">
          <div className="h-4 w-24 rounded-full skeleton mb-3" />
          <div className="flex items-center gap-3 mb-5">
            <div className="h-11 w-11 rounded-2xl skeleton" />
            <div className="space-y-2">
              <div className="h-6 w-48 rounded-full skeleton" />
              <div className="h-3 w-32 rounded-full skeleton" />
            </div>
          </div>
          <div className="glass rounded-3xl p-5 md:p-6 space-y-3">
            <div className="h-5 w-3/4 rounded-full skeleton" />
            <div className="h-4 w-full rounded-full skeleton" />
            <div className="h-4 w-5/6 rounded-full skeleton" />
            <div className="h-4 w-full rounded-full skeleton" />
            <div className="h-4 w-2/3 rounded-full skeleton" />
            <div className="h-5 w-1/2 rounded-full skeleton mt-4" />
            <div className="h-4 w-full rounded-full skeleton" />
            <div className="h-4 w-4/5 rounded-full skeleton" />
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (error || !page) {
    return (
      <div className="page-top-padding pb-28 md:pb-6">
        <div className="px-4 md:px-6 max-w-3xl mx-auto">
          <button
            onClick={() => onNavigate(onBack)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
          >
            <ChevronLeft className="h-4 w-4" /> {backLabel || 'Назад'}
          </button>
          <div className="glass rounded-3xl p-8 text-center">
            <AlertCircle className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h2 className="text-xl font-bold mb-2">Страница не найдена</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {error || 'Запрошенная страница не существует или не опубликована.'}
            </p>
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              className="inline-flex items-center gap-1.5 text-sm text-primary font-semibold hover:underline"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Повторить
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Sanitise HTML content client-side as defence-in-depth (server already
  // sanitises via sanitize-html in routes/info-pages.ts). DOMPurify also
  // strips anything that might have slipped through if a future regression
  // weakens the server pipeline, or if an admin account is compromised.
  const sanitisedContent = useMemo(
    () => (typeof window !== 'undefined' && page.content
      ? DOMPurify.sanitize(page.content, {
          // Use DOMPurify's built-in default allowlist (HTML + SVG safe tags)
          // and explicitly forbid script-execution vectors and inline styles
          // even if a future regression re-enables them globally.
          FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'script', 'form', 'input', 'button'],
          FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onmouseenter', 'onmouseleave', 'onsubmit', 'onchange', 'oninput', 'onfocus', 'onblur', 'style'],
          ALLOW_DATA_ATTR: false,
        })
      : page.content || ''),
    [page.content]
  )

  // Render the page
  return (
    <div className="page-top-padding pb-28 md:pb-6">
      <div className="px-4 md:px-6 max-w-3xl mx-auto">
        {/* Back button */}
        <button
          onClick={() => onNavigate(onBack)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ChevronLeft className="h-4 w-4" /> {backLabel || 'Назад'}
        </button>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex items-center gap-3 mb-5"
        >
          <div className="h-11 w-11 rounded-2xl gradient-brand grid place-items-center shadow-glow shrink-0">
            <Icon className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">{page.title}</h1>
            {page.subtitle && (
              <p className="text-sm text-muted-foreground">{page.subtitle}</p>
            )}
          </div>
        </motion.div>

        {/* Images (optional, displayed before content) */}
        {page.images && page.images.length > 0 && (
          <div className="space-y-3 mb-5">
            {page.images.map((img, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: idx * 0.05 }}
                className="rounded-2xl overflow-hidden glass"
              >
                <img
                  src={assetUrl(img)}
                  alt=""
                  className="w-full h-auto object-cover"
                  loading="lazy"
                />
              </motion.div>
            ))}
          </div>
        )}

        {/* Content (HTML) — sanitised client-side via DOMPurify as defence-in-depth
            on top of the server-side sanitize-html pipeline (routes/info-pages.ts). */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.05 }}
          className="glass rounded-3xl p-5 md:p-6 prose prose-sm dark:prose-invert max-w-none
                     prose-headings:font-bold prose-headings:tracking-tight
                     prose-h2:text-xl prose-h2:mt-0 prose-h2:mb-2
                     prose-h3:text-base prose-h3:mt-4 prose-h3:mb-1.5
                     prose-p:text-muted-foreground prose-p:leading-relaxed
                     prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5
                     prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                     prose-strong:text-foreground
                     prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none"
          dangerouslySetInnerHTML={{ __html: sanitisedContent }}
        />

        {/* Footer: last updated */}
        <div className="mt-6 text-center text-xs text-muted-foreground">
          Обновлено: {new Date(page.updatedAt).toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </div>
      </div>
    </div>
  )
}
