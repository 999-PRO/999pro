// Gender-based gradient palettes with VIVID, saturated colors.
// Each gender gets a set of juicy gradients. A deterministic hash of the
// user ID picks one gradient per user so the same user always gets the same
// gradient (no flicker on re-render).

export type Gender = 'male' | 'female' | 'other' | null | undefined

// v9-audit-fix: dead code removal — the per-gender palettes
// (MALE_PALETTES / FEMALE_PALETTES / OTHER_PALETTES) and the
// `getGradientForUser(userId, gender)` selector were exported but never
// imported anywhere in the codebase. The `Gender` type IS still imported
// by other modules, so it stays. If a future feature needs per-gender
// gradients, restore from git history at this commit.

// Deterministic hash — same input always produces the same index.
// Used by getChatCardPalette() below.
function hashString(s: string): number {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return Math.abs(hash)
}

// ============================================================
//  CHAT CARD PASTEL PALETTES — мягкие пастельные градиенты
//  для списка диалогов. Каждая карточка — glassmorphism с очень
//  мягким цветным фоном (5-12% opacity), читается как calm pastel.
//  Палитры: голубой / сиреневый / светло-зелёный / розовый /
//  песочный / мятный — как просил пользователь.
// ============================================================

export interface ChatCardPalette {
  name: string
  /** Пастельный фон карточки — очень мягкий градиент (5-12% opacity) */
  bg: string
  /** Цветная "halo" рамка вокруг аватара */
  ring: string
  /** Solid accent (для индикатора онлайн, бейджа непрочитанных) */
  solid: string
  /** Glow тень под карточкой */
  glow: string
}

const CHAT_CARD_PALETTES: ChatCardPalette[] = [
  {
    name: 'sky-mist',
    // Голубой
    bg: 'linear-gradient(135deg, rgba(56, 189, 248, 0.10) 0%, rgba(14, 165, 233, 0.06) 100%)',
    ring: '#38bdf8',
    solid: '#0ea5e9',
    glow: 'rgba(56, 189, 248, 0.18)',
  },
  {
    name: 'lilac-haze',
    // Сиреневый
    bg: 'linear-gradient(135deg, rgba(167, 139, 250, 0.10) 0%, rgba(139, 92, 246, 0.06) 100%)',
    ring: '#a78bfa',
    solid: '#8b5cf6',
    glow: 'rgba(167, 139, 250, 0.18)',
  },
  {
    name: 'mint-fresh',
    // Мятный
    bg: 'linear-gradient(135deg, rgba(94, 234, 212, 0.10) 0%, rgba(45, 212, 191, 0.06) 100%)',
    ring: '#5eead4',
    solid: '#14b8a6',
    glow: 'rgba(94, 234, 212, 0.18)',
  },
  {
    name: 'soft-rose',
    // Розовый
    bg: 'linear-gradient(135deg, rgba(251, 113, 133, 0.10) 0%, rgba(244, 114, 182, 0.06) 100%)',
    ring: '#fb7185',
    solid: '#f43f5e',
    glow: 'rgba(251, 113, 133, 0.18)',
  },
  {
    name: 'sandy-warm',
    // Песочный
    bg: 'linear-gradient(135deg, rgba(253, 224, 71, 0.10) 0%, rgba(251, 191, 36, 0.06) 100%)',
    ring: '#fcd34d',
    solid: '#f59e0b',
    glow: 'rgba(253, 224, 71, 0.18)',
  },
  {
    name: 'leaf-green',
    // Светло-зелёный
    bg: 'linear-gradient(135deg, rgba(134, 239, 172, 0.10) 0%, rgba(74, 222, 128, 0.06) 100%)',
    ring: '#86efac',
    solid: '#22c55e',
    glow: 'rgba(134, 239, 172, 0.18)',
  },
]

/**
 * Возвращает пастельную палитру для карточки чата по ID пользователя.
 * Детерминированно — один и тот же пользователь всегда получает один и тот
 * же цвет. Не зависит от пола: цвета распределяются равномерно по всем
 * участникам, чтобы список был разнообразным.
 */
export function getChatCardPalette(userId: string): ChatCardPalette {
  const idx = hashString(userId || 'default') % CHAT_CARD_PALETTES.length
  return CHAT_CARD_PALETTES[idx]
}

// Outgoing message — soft brand blue→indigo→violet gradient (calm, premium).
// Slightly translucent so the surface behind it (chat glass panel) shows
// through subtly. White text reads cleanly on top.
export const OUTGOING_GRADIENT = {
  bg: 'linear-gradient(135deg, #38bdf8 0%, #6366f1 55%, #7c3aed 100%)',
  glow: 'rgba(99,102,241,0.35)',
  accent: '#6366f1',
}

// Incoming message — light glassmorphism surface (frosted, translucent,
// reads as a soft pastel card). Uses CSS variables via the .glass-message-incoming
// class in globals.css; this object is only used for backward-compatible
// inline-style fallbacks (kept for isBubbleless media cards).
export const INCOMING_GRADIENT = {
  bg: undefined,
  glow: 'rgba(255,255,255,0.10)',
  accent: '#64748b',
}

// ============================================================
//  STORY CATEGORY PALETTES — soft pastel gradients
// ============================================================
// Each category gets a unique soft gradient. Unknown categories fall back
// to a deterministic pastel picked from the pool (so custom categories
// still get a stable, beautiful colour).

export interface StoryPalette {
  name: string
  ring: string       // gradient ring around the avatar thumbnail
  glow: string       // rgba glow shadow
  solid: string      // single solid accent colour
  cardBg: string     // gradient used inside the story viewer's nickname card
  cardText: string   // text colour on the nickname card (white recommended)
  chipBg: string     // background for the small count chip
}

const CATEGORY_PALETTES: Record<string, StoryPalette> = {
  'Акция': {
    name: 'sunset-coral',
    ring: 'linear-gradient(135deg, #fb7185 0%, #f97316 50%, #fbbf24 100%)',
    glow: 'rgba(251,113,133,0.45)',
    solid: '#fb7185',
    cardBg: 'linear-gradient(135deg, rgba(251,113,133,0.92) 0%, rgba(249,115,22,0.92) 100%)',
    cardText: '#ffffff',
    chipBg: 'linear-gradient(135deg, #fb7185 0%, #f97316 100%)',
  },
  'Новости': {
    name: 'sky-breeze',
    ring: 'linear-gradient(135deg, #38bdf8 0%, #3b82f6 50%, #6366f1 100%)',
    glow: 'rgba(56,189,248,0.45)',
    solid: '#3b82f6',
    cardBg: 'linear-gradient(135deg, rgba(56,189,248,0.92) 0%, rgba(99,102,241,0.92) 100%)',
    cardText: '#ffffff',
    chipBg: 'linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)',
  },
  'Лето': {
    name: 'summer-mango',
    ring: 'linear-gradient(135deg, #fde047 0%, #fb923c 50%, #f43f5e 100%)',
    glow: 'rgba(251,146,60,0.45)',
    solid: '#fb923c',
    cardBg: 'linear-gradient(135deg, rgba(253,224,71,0.92) 0%, rgba(244,63,94,0.92) 100%)',
    cardText: '#ffffff',
    chipBg: 'linear-gradient(135deg, #fde047 0%, #fb923c 100%)',
  },
  'Зима': {
    name: 'winter-ice',
    ring: 'linear-gradient(135deg, #a5f3fc 0%, #67e8f9 50%, #38bdf8 100%)',
    glow: 'rgba(165,243,252,0.5)',
    solid: '#22d3ee',
    cardBg: 'linear-gradient(135deg, rgba(165,243,252,0.92) 0%, rgba(56,189,248,0.92) 100%)',
    cardText: '#0f172a',
    chipBg: 'linear-gradient(135deg, #a5f3fc 0%, #38bdf8 100%)',
  },
  'Весна': {
    name: 'spring-bloom',
    ring: 'linear-gradient(135deg, #f9a8d4 0%, #c4b5fd 50%, #a5f3fc 100%)',
    glow: 'rgba(249,168,212,0.5)',
    solid: '#f472b6',
    cardBg: 'linear-gradient(135deg, rgba(249,168,212,0.92) 0%, rgba(196,181,253,0.92) 100%)',
    cardText: '#ffffff',
    chipBg: 'linear-gradient(135deg, #f9a8d4 0%, #c4b5fd 100%)',
  },
  'Осень': {
    name: 'autumn-amber',
    ring: 'linear-gradient(135deg, #fdba74 0%, #f97316 50%, #b45309 100%)',
    glow: 'rgba(253,186,116,0.45)',
    solid: '#f97316',
    cardBg: 'linear-gradient(135deg, rgba(253,186,116,0.92) 0%, rgba(180,83,9,0.92) 100%)',
    cardText: '#ffffff',
    chipBg: 'linear-gradient(135deg, #fdba74 0%, #f97316 100%)',
  },
  'Все': {
    name: 'default-aurora',
    ring: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #c084fc 100%)',
    glow: 'rgba(99,102,241,0.45)',
    solid: '#6366f1',
    cardBg: 'linear-gradient(135deg, rgba(56,189,248,0.92) 0%, rgba(192,132,252,0.92) 100%)',
    cardText: '#ffffff',
    chipBg: 'linear-gradient(135deg, #38bdf8 0%, #c084fc 100%)',
  },
}

// Pool of pastel gradients for unknown categories — picked deterministically.
const PASTEL_POOL: StoryPalette[] = [
  {
    name: 'mint-breeze',
    ring: 'linear-gradient(135deg, #6ee7b7 0%, #34d399 50%, #10b981 100%)',
    glow: 'rgba(52,211,153,0.45)',
    solid: '#10b981',
    cardBg: 'linear-gradient(135deg, rgba(110,231,183,0.92) 0%, rgba(16,185,129,0.92) 100%)',
    cardText: '#ffffff',
    chipBg: 'linear-gradient(135deg, #6ee7b7 0%, #10b981 100%)',
  },
  {
    name: 'lavender-soft',
    ring: 'linear-gradient(135deg, #ddd6fe 0%, #c4b5fd 50%, #a78bfa 100%)',
    glow: 'rgba(167,139,250,0.45)',
    solid: '#8b5cf6',
    cardBg: 'linear-gradient(135deg, rgba(221,214,254,0.92) 0%, rgba(167,139,250,0.92) 100%)',
    cardText: '#ffffff',
    chipBg: 'linear-gradient(135deg, #ddd6fe 0%, #a78bfa 100%)',
  },
  {
    name: 'peach-warm',
    ring: 'linear-gradient(135deg, #fed7aa 0%, #fdba74 50%, #fb923c 100%)',
    glow: 'rgba(251,146,60,0.45)',
    solid: '#fb923c',
    cardBg: 'linear-gradient(135deg, rgba(254,215,170,0.92) 0%, rgba(251,146,60,0.92) 100%)',
    cardText: '#ffffff',
    chipBg: 'linear-gradient(135deg, #fed7aa 0%, #fb923c 100%)',
  },
  {
    name: 'rose-soft',
    ring: 'linear-gradient(135deg, #fda4af 0%, #fb7185 50%, #f43f5e 100%)',
    glow: 'rgba(251,113,133,0.45)',
    solid: '#f43f5e',
    cardBg: 'linear-gradient(135deg, rgba(253,164,175,0.92) 0%, rgba(244,63,94,0.92) 100%)',
    cardText: '#ffffff',
    chipBg: 'linear-gradient(135deg, #fda4af 0%, #f43f5e 100%)',
  },
  {
    name: 'sky-soft',
    ring: 'linear-gradient(135deg, #bae6fd 0%, #7dd3fc 50%, #38bdf8 100%)',
    glow: 'rgba(56,189,248,0.45)',
    solid: '#0ea5e9',
    cardBg: 'linear-gradient(135deg, rgba(186,230,253,0.92) 0%, rgba(56,189,248,0.92) 100%)',
    cardText: '#ffffff',
    chipBg: 'linear-gradient(135deg, #bae6fd 0%, #38bdf8 100%)',
  },
  {
    name: 'butter-soft',
    ring: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 50%, #fbbf24 100%)',
    glow: 'rgba(251,191,36,0.45)',
    solid: '#f59e0b',
    cardBg: 'linear-gradient(135deg, rgba(254,243,199,0.92) 0%, rgba(251,191,36,0.92) 100%)',
    cardText: '#1f2937',
    chipBg: 'linear-gradient(135deg, #fef3c7 0%, #fbbf24 100%)',
  },
  {
    name: 'orchid-soft',
    ring: 'linear-gradient(135deg, #f5d0fe 0%, #e879f9 50%, #c026d3 100%)',
    glow: 'rgba(232,121,249,0.45)',
    solid: '#c026d3',
    cardBg: 'linear-gradient(135deg, rgba(245,208,254,0.92) 0%, rgba(192,38,211,0.92) 100%)',
    cardText: '#ffffff',
    chipBg: 'linear-gradient(135deg, #f5d0fe 0%, #c026d3 100%)',
  },
  {
    name: 'sage-soft',
    ring: 'linear-gradient(135deg, #d9f99d 0%, #bef264 50%, #84cc16 100%)',
    glow: 'rgba(190,242,100,0.45)',
    solid: '#65a30d',
    cardBg: 'linear-gradient(135deg, rgba(217,249,157,0.92) 0%, rgba(132,204,22,0.92) 100%)',
    cardText: '#1f2937',
    chipBg: 'linear-gradient(135deg, #d9f99d 0%, #84cc16 100%)',
  },
]

export function getStoryPaletteForCategory(category: string | null | undefined): StoryPalette {
  if (category && CATEGORY_PALETTES[category]) {
    return CATEGORY_PALETTES[category]
  }
  // Unknown category — pick a stable pastel from the pool
  const key = (category || 'default').toLowerCase()
  const idx = hashString(key) % PASTEL_POOL.length
  return PASTEL_POOL[idx]
}
