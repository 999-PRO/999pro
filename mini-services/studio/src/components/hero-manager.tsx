'use client'

import { useEffect, useState, useCallback } from 'react'
import { Sparkles, Eye, EyeOff, Save, Loader2 } from 'lucide-react'
import { api, assetUrl } from '@/lib/api'
import type { HeroBlockSetting } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ImageUploader } from './image-uploader'
import { StudioAIAssistant } from './studio-ai-assistant'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/notifications'

// Same gradient presets as the Banners manager — kept in sync so the admin
// sees the same colour picker everywhere.
const GRADIENTS = [
  { id: 'from-sky-400 via-blue-500 to-indigo-600', label: 'Голубой', class: 'from-sky-400 via-blue-500 to-indigo-600' },
  { id: 'from-fuchsia-500 via-purple-500 to-indigo-600', label: 'Фиолетовый', class: 'from-fuchsia-500 via-purple-500 to-indigo-600' },
  { id: 'from-emerald-400 via-teal-500 to-cyan-600', label: 'Зелёный', class: 'from-emerald-400 via-teal-500 to-cyan-600' },
  { id: 'from-amber-400 via-orange-500 to-red-600', label: 'Оранжевый', class: 'from-amber-400 via-orange-500 to-red-600' },
  { id: 'from-pink-400 via-rose-500 to-red-600', label: 'Розовый', class: 'from-pink-400 via-rose-500 to-red-600' },
]

// Internal view options for the CTA buttons.
const VIEW_OPTIONS = [
  { id: '', label: '— не выбрано —' },
  { id: 'home', label: 'Главная' },
  { id: 'catalog', label: 'Каталог' },
  // v12.3: 'feed' option removed — Feed module deleted, replaced by 999 CLUB.
  { id: 'club', label: '999 CLUB' },
  { id: 'chat', label: 'Чат' },
  { id: 'profile', label: 'Профиль' },
  { id: 'orders', label: 'Мои заказы' },
  { id: 'support', label: 'Поддержка' },
  { id: 'reviews', label: 'Отзывы' },
  { id: 'settings', label: 'Настройки' },
]

const DEFAULT_HERO: HeroBlockSetting = {
  enabled: true,
  useGradient: true,
  image: null,
  gradient: GRADIENTS[0].id,
  badge: null,
  title: '999 Store',
  description: null,
  primaryButton: { text: 'В каталог', view: 'catalog', link: null },
  // v12.3: secondary CTA now points to 999 CLUB (was 'feed').
  secondaryButton: { text: 'Открыть CLUB', view: 'club', link: null },
  // v12.6.4: new fields — default to legacy behaviour
  objectFit: 'cover',
  mode: 'image-text',
}

export function HeroManager() {
  const [hero, setHero] = useState<HeroBlockSetting>(DEFAULT_HERO)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
useEffect(() => {
    api
      .get<{ value: HeroBlockSetting | null }>('/api/settings/heroBlock', { auth: true })
      .then((d) => {
        if (d.value && typeof d.value === 'object') {
          // Merge with defaults so any missing fields (e.g. from older saves)
          // get sensible values.
          setHero({ ...DEFAULT_HERO, ...d.value })
        }
      })
      .catch((e) => {
        // S-LOW-008: was `.catch(() => {})` — silent failure swallowed
        // network/backend errors, leaving the manager stuck on defaults.
        console.error('[hero-manager] load failed:', e)
      })
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    // v12.6.4: title is no longer required. Hero can be image-only.
    setSaving(true)
    try {
      await api.put('/api/settings/heroBlock', { json: hero, auth: true })
      toast.success('Hero блок сохранён')
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="px-4 md:px-6 py-6 page-top-padding">
        <div className="h-64 rounded-2xl skeleton" />
      </div>
    )
  }

  // v24.3: AI assistant handlers for Hero Block
  const getHeroAIData = useCallback(() => ({
    badge: hero.badge,
    title: hero.title,
    description: hero.description,
    primaryButton: hero.primaryButton,
    secondaryButton: hero.secondaryButton,
    primaryButtonText: hero.primaryButton?.text,
    secondaryButtonText: hero.secondaryButton?.text,
    image: hero.image,
  }), [hero])

  const handleHeroAIApply = useCallback((field: string, value: string) => {
    switch (field) {
      case 'badge':
        setHero((h) => ({ ...h, badge: value }))
        break
      case 'title':
        setHero((h) => ({ ...h, title: value }))
        break
      case 'description':
        setHero((h) => ({ ...h, description: value }))
        break
      case 'primaryButtonText':
        setHero((h) => ({ ...h, primaryButton: { ...h.primaryButton, text: value } }))
        break
      case 'secondaryButtonText':
        setHero((h) => ({ ...h, secondaryButton: { ...h.secondaryButton, text: value } }))
        break
    }
  }, [])

  return (
    <div className="px-4 md:px-6 py-6 pb-28 page-top-padding max-w-3xl">
      <div className="mb-5">
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Hero блок</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Главный верхний блок на десктопной версии главной страницы.
        </p>
      </div>

      {/* Live preview */}
      <div className="mb-5">
        <Label className="mb-2 block">Предпросмотр</Label>
        <HeroPreview hero={hero} />
      </div>

      <div className="space-y-5">
        {/* Enable / disable the whole block */}
        <div className="glass rounded-2xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl gradient-brand grid place-items-center text-white shrink-0">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">Показывать Hero блок</div>
              <div className="text-xs text-muted-foreground">
                Если выключено, на десктопе Hero не отображается
              </div>
            </div>
          </div>
          <Switch
            checked={hero.enabled}
            onCheckedChange={(v) => setHero((h) => ({ ...h, enabled: v }))}
          />
        </div>

        {/* Gradient vs original image */}
        <div className="glass rounded-2xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl gradient-soft grid place-items-center shrink-0">
              {hero.useGradient ? <Eye className="h-5 w-5 text-primary" /> : <EyeOff className="h-5 w-5 text-primary" />}
            </div>
            <div>
              <div className="text-sm font-semibold">Использовать градиент</div>
              <div className="text-xs text-muted-foreground">
                {hero.useGradient
                  ? 'Градиент + изображение с наложением (как раньше)'
                  : 'Оригинальное изображение без наложений и затемнений'}
              </div>
            </div>
          </div>
          <Switch
            checked={hero.useGradient}
            onCheckedChange={(v) => setHero((h) => ({ ...h, useGradient: v }))}
          />
        </div>

        {/* v12.6.4: Mode toggle — image-only vs image+text */}
        <div className="glass rounded-2xl p-4 space-y-2">
          <div className="text-sm font-semibold">Режим Hero блока</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setHero((h) => ({ ...h, mode: 'image-text' }))}
              className={cn(
                'rounded-xl px-3 py-2.5 text-sm font-medium border-2 transition-all',
                (hero.mode || 'image-text') === 'image-text'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/40 text-muted-foreground hover:bg-accent/40',
              )}
            >
              Изображение + текст
            </button>
            <button
              type="button"
              onClick={() => setHero((h) => ({ ...h, mode: 'image-only' }))}
              className={cn(
                'rounded-xl px-3 py-2.5 text-sm font-medium border-2 transition-all',
                hero.mode === 'image-only'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/40 text-muted-foreground hover:bg-accent/40',
              )}
            >
              Только изображение
            </button>
          </div>
          {hero.mode === 'image-only' && (
            <div className="text-xs text-muted-foreground">
              Все текстовые поля и кнопки скрыты. Изображение занимает всю область Hero.
            </div>
          )}
        </div>

        {/* v12.6.4: Object-fit selector — cover vs contain */}
        <div className="glass rounded-2xl p-4 space-y-2">
          <div className="text-sm font-semibold">Режим отображения изображения</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setHero((h) => ({ ...h, objectFit: 'cover' }))}
              className={cn(
                'rounded-xl px-3 py-2.5 text-sm font-medium border-2 transition-all',
                (hero.objectFit || 'cover') === 'cover'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/40 text-muted-foreground hover:bg-accent/40',
              )}
            >
              Cover (обрезать)
            </button>
            <button
              type="button"
              onClick={() => setHero((h) => ({ ...h, objectFit: 'contain' }))}
              className={cn(
                'rounded-xl px-3 py-2.5 text-sm font-medium border-2 transition-all',
                hero.objectFit === 'contain'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/40 text-muted-foreground hover:bg-accent/40',
              )}
            >
              Contain (полностью)
            </button>
          </div>
          <div className="text-xs text-muted-foreground">
            {(hero.objectFit || 'cover') === 'cover'
              ? 'Изображение обрезается, чтобы заполнить всю область (сохраняются пропорции).'
              : 'Изображение показывается полностью без искажений (могут быть поля).'}
          </div>
        </div>

        {/* Image uploader */}
        <div>
          <ImageUploader
            value={hero.image ? [hero.image] : []}
            onChange={(urls) =>
              setHero((h) => ({ ...h, image: urls[0] || null }))
            }
            aspect="banner"
            label="Фоновое изображение (опционально)"
          />
        </div>

        {/* Gradient picker — only meaningful when useGradient=true AND image-text mode */}
        {hero.useGradient && hero.mode !== 'image-only' && (
          <div className="space-y-1.5">
            <Label>Градиент</Label>
            <div className="flex flex-wrap gap-2">
              {GRADIENTS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setHero((h) => ({ ...h, gradient: g.id }))}
                  className={cn(
                    'h-10 w-14 rounded-xl bg-gradient-to-br border-2 transition-all',
                    g.class,
                    hero.gradient === g.id
                      ? 'border-foreground scale-105'
                      : 'border-transparent',
                  )}
                  aria-label={g.label}
                  title={g.label}
                />
              ))}
            </div>
          </div>
        )}

        {/* Text content — v12.6.4: only shown in image-text mode */}
        {hero.mode !== 'image-only' && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="badge">Бейдж (маленький текст сверху)</Label>
              <Input
                id="badge"
                value={hero.badge || ''}
                onChange={(e) => setHero((h) => ({ ...h, badge: e.target.value || null }))}
                className="rounded-2xl"
                placeholder="Новый дроп уже здесь"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="title">Заголовок</Label>
              <Input
                id="title"
                value={hero.title || ''}
                onChange={(e) => setHero((h) => ({ ...h, title: e.target.value || null }))}
                className="rounded-2xl"
                placeholder="999 Store"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Описание</Label>
              <textarea
                id="description"
                value={hero.description ?? ''}
                onChange={(e) => setHero((h) => ({ ...h, description: e.target.value || null }))}
                rows={3}
                className="w-full rounded-2xl bg-accent/30 border border-border/40 px-4 py-3 text-sm outline-none focus:border-primary resize-none"
                placeholder="Оставьте пустым, чтобы скрыть описание"
              />
            </div>
          </>
        )}

        {/* Buttons — v12.6.4: only shown in image-text mode */}
        {hero.mode !== 'image-only' && (
          <>
            {/* Primary button */}
            <ButtonEditor
              title="Основная кнопка"
              button={hero.primaryButton}
              onChange={(b) => setHero((h) => ({ ...h, primaryButton: b }))}
            />

            {/* Secondary button */}
            <ButtonEditor
              title="Дополнительная кнопка"
              button={hero.secondaryButton}
              onChange={(b) => setHero((h) => ({ ...h, secondaryButton: b }))}
            />
          </>
        )}

        {/* v24.3: AI Assistant for Hero Block — helps with badge, title, description, button texts */}
        <StudioAIAssistant
          type="hero"
          getData={getHeroAIData}
          onApply={handleHeroAIApply}
          title={hero.title || 'Hero блок'}
        />

        {/* Save */}
        <div className="flex gap-2 pt-2 sticky bottom-4 z-10">
          <Button
            className="flex-1 rounded-full gradient-brand text-white shadow-glow h-12"
            onClick={save}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Сохранение…
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" /> Сохранить
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
//  ButtonEditor — editor for a single CTA button (primary or secondary).
// ============================================================================
function ButtonEditor({
  title,
  button,
  onChange,
}: {
  title: string
  button: HeroBlockSetting['primaryButton']
  onChange: (b: HeroBlockSetting['primaryButton']) => void
}) {
  // When null, the button is hidden. We use a local "enabled" toggle so the
  // admin can temporarily disable a button without losing its config.
  const enabled = button !== null
  const text = button?.text || ''
  const view = button?.view || ''
  const link = button?.link || ''

  return (
    <div className="glass rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-sm font-semibold">{title}</Label>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => {
            if (v) {
              onChange({ text: text || 'Кнопка', view: null, link: null })
            } else {
              onChange(null)
            }
          }}
        />
      </div>
      {enabled && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Текст кнопки</Label>
            <Input
              value={text}
              onChange={(e) =>
                onChange({ text: e.target.value, view: view || null, link: link || null })
              }
              className="rounded-xl"
              placeholder="В каталог"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Внутренний раздел (навигация в приложении)</Label>
            <select
              value={view}
              onChange={(e) =>
                onChange({
                  text,
                  view: e.target.value || null,
                  link: link || null,
                })
              }
              className="w-full rounded-xl bg-accent/30 border border-border/40 px-3 py-2 text-sm outline-none focus:border-primary"
            >
              {VIEW_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              Или внешняя ссылка (используется, если раздел не выбран)
            </Label>
            <Input
              value={link}
              onChange={(e) =>
                onChange({
                  text,
                  view: view || null,
                  link: e.target.value || null,
                })
              }
              className="rounded-xl"
              placeholder="https://example.com/promo"
            />
          </div>
        </>
      )}
    </div>
  )
}

// ============================================================================
//  HeroPreview — visual live preview that mirrors the desktop hero rendering.
//  Same gradient map as the frontend's promo-banner.tsx for visual parity.
// ============================================================================
const GRADIENT_CSS: Record<string, string> = {
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

function HeroPreview({ hero }: { hero: HeroBlockSetting }) {
  const gradientCss = GRADIENT_CSS[hero.gradient] || GRADIENT_CSS[GRADIENTS[0].id]
  const showImage = !!hero.image

  return (
    <div
      className={cn(
        'relative w-full h-48 md:h-56 rounded-3xl overflow-hidden shadow-soft',
        !hero.useGradient && !showImage && 'gradient-brand',
      )}
      style={
        hero.useGradient
          ? { backgroundImage: gradientCss }
          : showImage
            ? {} // raw image — no overlay
            : undefined
      }
    >
      {/* Background image */}
      {showImage && (
        <img
          src={assetUrl(hero.image!)}
          alt=""
          className={cn(
            'absolute inset-0 h-full w-full object-cover',
            hero.useGradient
              ? 'opacity-40 mix-blend-overlay'
              : 'opacity-100',
          )}
        />
      )}

      {/* Decorative blobs (only when gradient is on) */}
      {hero.useGradient && (
        <>
          <div className="absolute -top-12 -right-12 h-48 w-48 rounded-full bg-white/20 blur-3xl" />
          <div className="absolute -bottom-12 -left-12 h-48 w-48 rounded-full bg-black/10 blur-3xl" />
        </>
      )}

      {/* Dark overlay for text legibility on raw images */}
      {!hero.useGradient && showImage && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
      )}

      {/* Content */}
      <div className="relative h-full p-6 md:p-8 flex flex-col justify-center text-white max-w-2xl">
        {hero.badge && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-xs font-medium mb-3 w-fit backdrop-blur-sm">
            <Sparkles className="h-3 w-3" /> {hero.badge}
          </div>
        )}
        <h2 className="text-2xl md:text-3xl font-extrabold leading-tight mb-2 drop-shadow-sm">
          {hero.title || 'Заголовок'}
        </h2>
        <p className="text-white/90 text-sm md:text-base mb-4 max-w-xl line-clamp-2">
          {hero.description || 'Описание'}
        </p>
        <div className="flex flex-wrap gap-2">
          {hero.primaryButton && (
            <span className="px-5 py-2 rounded-full bg-white text-slate-900 text-sm font-semibold shadow-lg">
              {hero.primaryButton.text || 'Кнопка'}
            </span>
          )}
          {hero.secondaryButton && (
            <span className="px-5 py-2 rounded-full border border-white/40 text-white text-sm font-semibold backdrop-blur-sm">
              {hero.secondaryButton.text || 'Кнопка'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
