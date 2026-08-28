'use client'

// ============================================================================
// SeoHead — v25.19 (owner): «чтобы моё приложение могли найти в Google,
// в Яндексе… чтобы я мог настроить теги/хештеги».
// ----------------------------------------------------------------------------
// Применяет SEO-настройки из Студии (seoSettings) к ДОКУМЕНТУ на клиенте:
//   • <title> и meta description / keywords
//   • OpenGraph (og:title, og:description, og:image)
//   • JSON-LD (Organization + WebSite) — структурированные данные для
//     поисковых роботов (Google/Yandex отлично их понимают)
// Статические метаданные в layout.tsx остаются (быстрая первая отрисовка),
// а этот слой ПЕРЕЗАПИСЫВАЕТ их значениями из Студии — владелец управляет
// SEO без пересборки. Роботы Google/Яндекса исполняют JS и видят финальные
// значения. Верификация вебмастеров — через env (см. layout metadata).
// ============================================================================

import { useEffect } from 'react'
import { api, assetUrl } from '@/lib/api'

interface SeoSettings {
  siteTitle?: string | null
  siteDescription?: string | null
  siteKeywords?: string | null
  ogImage?: string | null
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

export function SeoHead() {
  useEffect(() => {
    let alive = true
    api.get<{ value: SeoSettings | null }>('/api/settings/seoSettings')
      .then((d) => {
        if (!alive || !d.value) return
        const s = d.value

        if (s.siteTitle) {
          document.title = s.siteTitle
          upsertMeta('property', 'og:title', s.siteTitle)
        }
        if (s.siteDescription) {
          upsertMeta('name', 'description', s.siteDescription)
          upsertMeta('property', 'og:description', s.siteDescription)
        }
        if (s.siteKeywords) {
          upsertMeta('name', 'keywords', s.siteKeywords)
        }
        if (s.ogImage) {
          const img = s.ogImage.startsWith('http') ? s.ogImage : assetUrl(s.ogImage)
          upsertMeta('property', 'og:image', img)
        }

        // JSON-LD — структурированные данные для поисковиков
        const ldId = 'seo-jsonld-org'
        document.getElementById(ldId)?.remove()
        const ld = document.createElement('script')
        ld.id = ldId
        ld.type = 'application/ld+json'
        ld.textContent = JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: s.siteTitle || document.title || 'TRI999',
          description: s.siteDescription || undefined,
          url: window.location.origin,
          logo: s.ogImage
            ? (s.ogImage.startsWith('http') ? s.ogImage : assetUrl(s.ogImage))
            : `${window.location.origin}/icons/icon-512.png`,
        })
        document.head.appendChild(ld)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  return null
}
