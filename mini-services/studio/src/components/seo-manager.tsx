'use client'

// ============================================================================
// SEO Manager — v25.19 (owner):
// «чтобы моё приложение могли найти в Google, в Яндексе… я мог настроить
// теги, хештеги». Здесь владелец управляет тем, КАК приложение выглядит
// для поисковиков:
//   • siteTitle      — заголовок вкладки/поисковой выдачи
//   • siteDescription— описание в выдаче
//   • siteKeywords   — ключевые слова (через запятую)
//   • ogImage        — картинка для превью в соцсетях/мессенджерах
// Значения применяются на клиенте мгновенно (seo-head.tsx) и попадают в
// поисковую выдачу при следующем обходе роботом. Для верификации вебмастеров
// (Яндекс.Вебмастер / Google Search Console) используются переменные окружения
// YANDEX_VERIFICATION и GOOGLE_SITE_VERIFICATION на сервере.
// ============================================================================

import { useEffect, useState, useCallback } from 'react'
import { Search, Save, Globe } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/lib/notifications'

interface SeoSettings {
  siteTitle?: string | null
  siteDescription?: string | null
  siteKeywords?: string | null
  ogImage?: string | null
}

export function SeoManager() {
  const [siteTitle, setSiteTitle] = useState('')
  const [siteDescription, setSiteDescription] = useState('')
  const [siteKeywords, setSiteKeywords] = useState('')
  const [ogImage, setOgImage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ value: SeoSettings | null }>('/api/settings/seoSettings', { auth: true })
      .then((d) => {
        setSiteTitle(d.value?.siteTitle || '')
        setSiteDescription(d.value?.siteDescription || '')
        setSiteKeywords(d.value?.siteKeywords || '')
        setOgImage(d.value?.ogImage || '')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/api/settings/seoSettings', {
        json: {
          siteTitle: siteTitle.trim() || null,
          siteDescription: siteDescription.trim() || null,
          siteKeywords: siteKeywords.trim() || null,
          ogImage: ogImage.trim() || null,
        },
        auth: true,
      })
      toast.success('SEO-настройки сохранены', {
        description: 'Поисковики увидят изменения при следующем обходе сайта',
      })
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28 page-top-padding max-w-2xl">
      <div className="flex items-center gap-3 mb-5">
        <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-[#0EA5E9] to-[#6366F1] grid place-items-center shadow-lg shadow-sky-500/25">
          <Search className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">SEO и поиск</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Как приложение выглядит в Google и Яндексе</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="h-11 rounded-2xl skeleton" />
          <div className="h-24 rounded-2xl skeleton" />
          <div className="h-11 rounded-2xl skeleton" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border/50 bg-card p-4 space-y-1.5">
            <Label htmlFor="seo-title">Заголовок сайта (title)</Label>
            <Input
              id="seo-title"
              value={siteTitle}
              onChange={(e) => setSiteTitle(e.target.value)}
              maxLength={140}
              className="rounded-2xl"
              placeholder="TRI999 — реклама, мебель и подарки"
            />
            <p className="text-[11px] text-muted-foreground">Показывается во вкладке браузера и как синяя ссылка в поиске</p>
          </div>

          <div className="rounded-2xl border border-border/50 bg-card p-4 space-y-1.5">
            <Label htmlFor="seo-desc">Описание сайта (description)</Label>
            <textarea
              id="seo-desc"
              value={siteDescription}
              onChange={(e) => setSiteDescription(e.target.value)}
              rows={3}
              maxLength={400}
              className="w-full rounded-2xl bg-background border border-border/60 focus:border-primary/50 outline-none resize-none px-3.5 py-3 text-sm min-h-[84px]"
              placeholder="Каталог рекламной продукции, мебели и подарков с доставкой по России…"
            />
            <p className="text-[11px] text-muted-foreground">Сниппет под заголовком в результатах поиска (до ~160 символов)</p>
          </div>

          <div className="rounded-2xl border border-border/50 bg-card p-4 space-y-1.5">
            <Label htmlFor="seo-keywords">Ключевые слова (через запятую)</Label>
            <Input
              id="seo-keywords"
              value={siteKeywords}
              onChange={(e) => setSiteKeywords(e.target.value)}
              maxLength={800}
              className="rounded-2xl"
              placeholder="реклама, вывески, мебель, подарки, полиграфия, каталог"
            />
            <p className="text-[11px] text-muted-foreground">Слова и фразы, по которым вас должны находить</p>
          </div>

          <div className="rounded-2xl border border-border/50 bg-card p-4 space-y-1.5">
            <Label htmlFor="seo-og">Картинка для соцсетей (OG image, URL)</Label>
            <Input
              id="seo-og"
              value={ogImage}
              onChange={(e) => setOgImage(e.target.value)}
              maxLength={2048}
              className="rounded-2xl"
              placeholder="/og или https://…/banner.jpg"
            />
            <p className="text-[11px] text-muted-foreground">Превью при отправке ссылки в WhatsApp/Telegram (1200×630 рекомендуется)</p>
          </div>

          {/* Живой предпросмотр сниппета */}
          <div className="rounded-2xl border border-border/50 bg-card p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
              <Globe className="h-3.5 w-3.5" /> Как это увидят в поиске
            </div>
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">example.ru › каталог</div>
              <div className="text-[17px] text-sky-600 dark:text-sky-400 font-medium truncate">
                {siteTitle || 'TRI999'}
              </div>
              <div className="text-[13px] text-muted-foreground line-clamp-2">
                {siteDescription || 'TRI999 — рекламная продукция, мебель и подарки. Каталог, чат с продавцом, заявки и доставка по России.'}
              </div>
            </div>
          </div>

          <Button
            onClick={save}
            disabled={saving}
            className="w-full h-12 rounded-2xl gradient-brand text-white font-bold shadow-glow"
          >
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Сохранение…' : 'Сохранить SEO-настройки'}
          </Button>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Для подтверждения прав на сайт в Яндекс.Вебмастере и Google Search Console
            добавьте переменные окружения <code className="font-mono">YANDEX_VERIFICATION</code> и{' '}
            <code className="font-mono">GOOGLE_SITE_VERIFICATION</code> на сервере — мета-теги
            верификации появятся автоматически.
          </p>
        </div>
      )}
    </div>
  )
}
