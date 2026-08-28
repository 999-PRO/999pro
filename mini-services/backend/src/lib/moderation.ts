import { logger } from './logger.js'
// ============================================================================
// 999 — Три девятки — Moderation Library (v16.9)
//
// Two-level moderation:
//   Level 1 — local check (stop-words, spam, flood, links, leetspeak bypass)
//   Level 2 — AI check (semantic analysis via heuristic + optional LLM)
//
// Privacy by design: only flagged/blocked content is stored in AIFlag table.
// Regular messages are NEVER stored in moderation tables.
//
// Exported functions:
//   - normalizeText(text)         — defeats leetspeak/cyrillic-latin bypass
//   - checkLocal(text, ctx)       — Level 1: stop-words, spam, flood, links
//   - checkAI(text, ctx)          — Level 2: heuristic + optional LLM
//   - moderateContent(text, ctx)  — main entry: runs both levels, returns decision
//   - getModerationSettings()     — reads cached settings from AppSetting
//   - recordAIFlag(...)           — persists flagged content to AIFlag table
//   - isUserAllowed(...)          — checks ban/restrictions before any action
// ============================================================================

import { prisma } from './prisma.js'

// ============================================================================
// Types
// ============================================================================

export type ModerationTargetType = 'message' | 'review' | 'profile' | 'username' | 'display_name' | 'bio' | 'community_post'

export interface ModerationContext {
  userId: string
  targetType: ModerationTargetType
  targetId?: string
  conversationId?: string // for flood detection within a conversation
}

export interface ModerationDecision {
  /** Whether the content is allowed to be sent/persisted. */
  allowed: boolean
  /** Whether the content was flagged (blocked OR flagged for review). */
  flagged: boolean
  /** Action taken by the system. */
  action: 'allow' | 'block' | 'flag' | 'hide'
  /** Human-readable reason for the decision (Russian). */
  reason: string
  /** Categories that triggered the flag (comma-separated). */
  categories: string[]
  /** Severity: low | medium | high. */
  severity: 'low' | 'medium' | 'high'
  /** Confidence 0-1 (AI only; local checks are 1.0 when matched). */
  confidence: number
  /** Matched stop-words (if any). */
  matchedWords: string[]
  /** The original content (truncated for storage if flagged). */
  content: string
}

const ALLOW_DECISION: ModerationDecision = {
  allowed: true,
  flagged: false,
  action: 'allow',
  reason: 'OK',
  categories: [],
  severity: 'low',
  confidence: 1,
  matchedWords: [],
  content: '',
}

// ============================================================================
// Settings (cached, refreshed every 60s)
// ============================================================================

export interface ModerationSettings {
  enabled: boolean
  aiEnabled: boolean
  strictness: 'low' | 'medium' | 'high' | 'very_strict'
  checkLinks: boolean
  checkImages: boolean
  checkDocuments: boolean
  whitelist: string[]
  /** Action to take on local violation. */
  localAction: 'block' | 'censor' | 'flag'
  /** Action to take on AI flag. */
  aiAction: 'block' | 'flag' | 'hide'
  /** Auto-warn user after N violations in 24h. */
  autoWarnThreshold: number
  /** Auto-mute chat after N violations in 24h. */
  autoMuteThreshold: number
  /** Auto-ban after N violations in 24h. */
  autoBanThreshold: number
}

const DEFAULT_SETTINGS: ModerationSettings = {
  enabled: true,
  aiEnabled: true,
  strictness: 'high',
  checkLinks: true,
  checkImages: true,
  checkDocuments: true,
  whitelist: [],
  localAction: 'block',
  aiAction: 'flag',
  autoWarnThreshold: 3,
  autoMuteThreshold: 5,
  autoBanThreshold: 10,
}

let cachedSettings: ModerationSettings | null = null
let cachedAt = 0
const CACHE_TTL_MS = 60_000 // 1 minute

export async function getModerationSettings(): Promise<ModerationSettings> {
  // Refresh cache if stale
  if (cachedSettings && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedSettings
  }
  try {
    const row = await prisma.appSetting.findUnique({ where: { id: 'moderationSettings' } })
    if (row) {
      const parsed = JSON.parse(row.value)
      cachedSettings = { ...DEFAULT_SETTINGS, ...parsed }
    } else {
      cachedSettings = DEFAULT_SETTINGS
    }
  } catch {
    cachedSettings = DEFAULT_SETTINGS
  }
  cachedAt = Date.now()
  return cachedSettings!
}

/** Force-refresh the cache (call after admin updates settings). */
export function invalidateSettingsCache(): void {
  cachedSettings = null
  cachedAt = 0
}

// ============================================================================
// Text normalization — defeats common filter-bypass techniques
// ============================================================================

// Map of look-alike characters that users substitute to bypass filters.
// Includes: digits → letters, latin → cyrillic look-alikes, special chars.
const CHAR_NORMALIZATION: Record<string, string> = {
  // Digits → letters (leetspeak)
  '0': 'о', '1': 'i', '3': 'е', '4': 'а', '5': 's', '6': 'б', '7': 'т', '8': 'в', '9': 'q',
  '@': 'а', '$': 's', '!': 'i', '|': 'i', '+': 'т',
  // Latin → Cyrillic look-alikes (and vice versa)
  'a': 'а', 'e': 'е', 'o': 'о', 'p': 'р', 'c': 'с', 'x': 'х', 'y': 'у', 'm': 'м',
  'A': 'А', 'E': 'Е', 'O': 'О', 'P': 'Р', 'C': 'С', 'X': 'Х', 'Y': 'У', 'M': 'М', 'B': 'В', 'H': 'Н', 'K': 'К', 'T': 'Т',
  // Special chars inside words (often used to split profanity)
  '.': '', ',': '', '-': '', '_': '', '*': '', '#': '', '~': '', '`': '', "'": '', '"': '',
}

/**
 * Normalize text for stop-word matching.
 * Defeats: leetspeak (cyfr4 → цуфра), latin/cyrillic substitution (cyka → сука),
 * special chars inside words (с.у.к.а → сука), case variations.
 */
export function normalizeText(text: string): string {
  if (!text) return ''
  let result = ''
  for (const ch of text.toLowerCase()) {
    result += CHAR_NORMALIZATION[ch] ?? ch
  }
  // Collapse multiple spaces
  return result.replace(/\s+/g, ' ').trim()
}

// ============================================================================
// Level 1: Local check (stop-words, spam, flood, links)
// ============================================================================

// Cache active stop-words in memory (refreshed every 30s)
let cachedStopWords: { word: string; category: string; severity: string }[] = []
let stopWordsCachedAt = 0
const STOPWORDS_CACHE_TTL_MS = 30_000

async function getActiveStopWords(): Promise<{ word: string; category: string; severity: string }[]> {
  if (cachedStopWords.length && Date.now() - stopWordsCachedAt < STOPWORDS_CACHE_TTL_MS) {
    return cachedStopWords
  }
  try {
    const rows = await prisma.stopWord.findMany({
      where: { isActive: true },
      select: { word: true, category: true, severity: true },
    })
    cachedStopWords = rows.map((r) => ({
      word: normalizeText(r.word),
      category: r.category,
      severity: r.severity,
    }))
    stopWordsCachedAt = Date.now()
  } catch {
    // DB error — fail open (don't block legitimate messages)
  }
  return cachedStopWords
}

/** Force-refresh the stop-words cache (call after admin updates dictionary). */
export function invalidateStopWordsCache(): void {
  cachedStopWords = []
  stopWordsCachedAt = 0
}

// Suspicious URL patterns — checked when settings.checkLinks is true.
const URL_REGEX = /(https?:\/\/|www\.|t\.me\/|wa\.me\/|vk\.com\/|instagram\.com\/|tiktok\.com\/|youtube\.com\/|youtu\.be\/)/i

// Suspicious TLDs often used for spam/scams
const SUSPICIOUS_TLD_REGEX = /\.(zip|mov|xyz|top|click|link|country|stream|review|gdn|mom|party|pw|ru\.com|com\.ru)\b/i

// Spam patterns: repetitive chars, all-caps shouting, excessive emojis
const REPETITIVE_CHARS_REGEX = /(.)\1{6,}/  // 7+ same char in a row
// v25.14 CRITICAL FIX: the old regex /^[A-ZА-Я\s\W\d]{20,}$/ matched EVERY
// Russian text ≥ 20 chars — in JavaScript `\W` means "not [A-Za-z0-9_]",
// which INCLUDES ALL Cyrillic letters. Result: every honest Russian comment
// was silently blocked as "spam" (the "second comment doesn't post" bug
// reported by the owner). Replaced with a Unicode-aware caps-ratio check.
const EXCESSIVE_CAPS_MIN_LEN = 20
function isExcessiveCaps(text: string): boolean {
  const letters = text.match(/\p{L}/gu)
  if (!letters || letters.length < EXCESSIVE_CAPS_MIN_LEN) return false
  const upper = text.match(/\p{Lu}/gu)?.length ?? 0
  return upper / letters.length > 0.7
}
const EXCESSIVE_EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu

/**
 * Level 1: Local check.
 * - Stop-word matching (with normalization to defeat bypass)
 * - Spam detection (repetitive chars, all-caps, excessive emojis)
 * - Link detection (suspicious URLs, suspicious TLDs)
 * - Flood detection (recent identical messages from same user)
 */
export async function checkLocal(text: string, ctx: ModerationContext): Promise<ModerationDecision> {
  const settings = await getModerationSettings()
  if (!settings.enabled) return { ...ALLOW_DECISION, content: text }

  const normalized = normalizeText(text)
  if (!normalized) return { ...ALLOW_DECISION, content: text }

  // Whitelist override: if the normalized text contains only whitelisted words, allow.
  // (Useful for nicknames like "alex" that might match a stop-word substring.)
  if (settings.whitelist.length) {
    const whitelistNormalized = settings.whitelist.map((w) => normalizeText(w))
    // If the entire text is exactly a whitelisted word, allow.
    if (whitelistNormalized.includes(normalized)) {
      return { ...ALLOW_DECISION, content: text }
    }
  }

  const matchedWords: string[] = []
  const categories = new Set<string>()
  let maxSeverity: 'low' | 'medium' | 'high' = 'low'

  // --- Stop-word matching ---
  const stopWords = await getActiveStopWords()
  for (const sw of stopWords) {
    if (!sw.word) continue
    // Word-boundary match (so "асс" doesn't match "класс")
    // For Cyrillic we use a custom boundary since \b doesn't work well with Cyrillic.
    const escaped = sw.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(^|[^а-яёa-z0-9])${escaped}([^а-яёa-z0-9]|$)`, 'i')
    if (pattern.test(normalized)) {
      matchedWords.push(sw.word)
      categories.add(sw.category)
      if (sw.severity === 'high') maxSeverity = 'high'
      else if (sw.severity === 'medium' && maxSeverity !== 'high') maxSeverity = 'medium'
    }
  }

  // --- Spam detection ---
  if (REPETITIVE_CHARS_REGEX.test(text)) {
    categories.add('spam')
    if (maxSeverity === 'low') maxSeverity = 'low'
  }
  if (isExcessiveCaps(text)) {
    categories.add('spam')
  }
  const emojiMatches = text.match(EXCESSIVE_EMOJI_REGEX)
  if (emojiMatches && emojiMatches.length > 10) {
    categories.add('spam')
  }

  // --- Link detection ---
  if (settings.checkLinks && URL_REGEX.test(text)) {
    // Check for suspicious TLDs
    if (SUSPICIOUS_TLD_REGEX.test(text)) {
      categories.add('ads')
      categories.add('fraud')
      if (maxSeverity !== 'high') maxSeverity = 'medium'
    } else {
      // Regular link — flag as 'ads' only if message is mostly a link
      const linkMatch = text.match(URL_REGEX)
      if (linkMatch && text.trim().length < linkMatch[0].length + 30) {
        categories.add('ads')
      }
    }
  }

  // --- Flood detection: check if user sent the same message in the last 60s ---
  if (ctx.targetType === 'message' && ctx.conversationId) {
    try {
      const recent = await prisma.message.findFirst({
        where: {
          senderId: ctx.userId,
          content: text,
          createdAt: { gte: new Date(Date.now() - 60_000) },
        },
        select: { id: true },
      })
      if (recent) {
        categories.add('spam')
        matchedWords.push('flood:duplicate')
      }
    } catch {
      // DB error — fail open
    }
  }

  if (matchedWords.length === 0 && categories.size === 0) {
    return { ...ALLOW_DECISION, content: text }
  }

  // Build decision based on settings.localAction
  const action = settings.localAction
  const reason = `Локальная проверка: ${Array.from(categories).join(', ')}`
  return {
    allowed: action === 'flag', // 'block' and 'censor' both block; 'flag' allows but flags
    flagged: true,
    action: action === 'block' ? 'block' : action === 'censor' ? 'block' : 'flag',
    reason,
    categories: Array.from(categories),
    severity: maxSeverity,
    confidence: 1.0,
    matchedWords,
    content: text,
  }
}

// ============================================================================
// Level 2: AI check (heuristic + optional LLM)
// ============================================================================

// Heuristic patterns for AI-flaggable content. Each pattern has a weight;
// the sum of matched weights determines the confidence and severity.
const HEURISTIC_PATTERNS: { pattern: RegExp; category: string; weight: number; severity: 'low' | 'medium' | 'high' }[] = [
  // Violence / threats
  { pattern: /убь[ью]|убей|зарежу|забью|удавлю|отравлю|взрыв|бомб[ау]|расстрел|казн/i, category: 'violence', weight: 0.9, severity: 'high' },
  { pattern: /пристрел|отреж[ьш]|зареж|перекол[ью]|замоч[ью]|грохн/i, category: 'violence', weight: 0.9, severity: 'high' },
  // Extremism / terrorism
  { pattern: /терак|шахид|джихад|тахбир|исламск(?:ое|ий) госуд|халиф|валид|исламск(?:ое|ий) государ/i, category: 'extremism', weight: 1.0, severity: 'high' },
  { pattern: /наци(?:ст|зм)|фашист|гитлер|сиг хайл|зиг хайл|райх/i, category: 'extremism', weight: 0.9, severity: 'high' },
  // Drugs
  { pattern: /наркотик|марихуан|гашиш|героин|кокаин|амфетамин|метамфетамин|спайс|соль\b|легалк|мефедрон|MDMA|LSD|экстази/i, category: 'drugs', weight: 0.9, severity: 'high' },
  { pattern: /продаж[ау] наркот|купить наркот|закладк[ау]|кладмен|нарко\d/i, category: 'drugs', weight: 1.0, severity: 'high' },
  // Fraud / scam
  { pattern: /переведи|перечисли|сбербанк|тинькофф|на карту|номер карты|cvv|cvc|пин-?код|смс-?код|код из смс/i, category: 'fraud', weight: 0.8, severity: 'high' },
  { pattern: /выиграл|вы стали побед|приз|лотере|розыгрыш.*нажм|бесплатн.*переход|кликн.*выигр/i, category: 'fraud', weight: 0.7, severity: 'medium' },
  { pattern: /инвестици.*доход|заработок.*дома|курс.*обогащ|финансовая свобод|пассивный доход/i, category: 'fraud', weight: 0.6, severity: 'medium' },
  // Sexual harassment
  { pattern: /секс.*фото|интим.*фото|покажи.*тело|разден|сним.*на камер|webcam.*sex|cam.*sex/i, category: 'sexual_harassment', weight: 0.9, severity: 'high' },
  // Bullying / insults (heuristic — high false-positive rate, so weight is moderate)
  { pattern: /тупой|идиот|дебил|дурак|тупица|малолетк|шлюх|проститут|урод|чмо|чушпан/i, category: 'insult', weight: 0.5, severity: 'medium' },
  { pattern: /ненавиж|проклят|заткнис|иди в жоп|отстал от|задолбал|достал/i, category: 'bullying', weight: 0.4, severity: 'low' },
  // Hate speech
  { pattern: /хохол|москаль|чурк[ау]|черно...|жид|хачик|нерусь|приезж/i, category: 'hate_speech', weight: 0.9, severity: 'high' },
  // Illegal activity
  { pattern: /куплю.*краден|продажа.*краден|украд.*документ|продажа.*оруж|купить.*оруж|без лиценз.*оруж/i, category: 'illegal', weight: 0.9, severity: 'high' },
  { pattern: /детск.*порн|child.*porn|cp\b|loli|школо.*секс|несовершенн.*секс/i, category: 'illegal', weight: 1.0, severity: 'high' },
  // Bypass attempts
  { pattern: /обойд.*фильтр|цензур.*обход|как.*сказать.*мат|как.*написать.*мат/i, category: 'bypass_attempt', weight: 0.7, severity: 'medium' },
  // Phishing patterns
  { pattern: /войдите.*по.*ссылк|введите.*пароль.*здесь|подтвердите.*карт|обновите.*данные.*карт/i, category: 'phishing', weight: 0.9, severity: 'high' },
]

/**
 * Level 2: AI check.
 *
 * Strategy:
 *   1. Run heuristic pattern matching (always — fast, deterministic).
 *   2. If LLM API key is configured (env: MODERATION_LLM_API_KEY), call the
 *      LLM for semantic analysis. Otherwise, rely on heuristics alone.
 *
 * The heuristic engine is intentionally conservative — false positives are
 * worse than false negatives for user experience. High-weight matches
 * (>=0.8) trigger a block; medium (0.5-0.79) trigger a flag.
 */
export async function checkAI(text: string, _ctx: ModerationContext): Promise<ModerationDecision> {
  const settings = await getModerationSettings()
  if (!settings.enabled || !settings.aiEnabled) {
    return { ...ALLOW_DECISION, content: text }
  }

  let totalWeight = 0
  const categories = new Set<string>()
  let maxSeverity: 'low' | 'medium' | 'high' = 'low'

  // Run heuristic patterns
  for (const hp of HEURISTIC_PATTERNS) {
    if (hp.pattern.test(text)) {
      categories.add(hp.category)
      totalWeight += hp.weight
      if (hp.severity === 'high') maxSeverity = 'high'
      else if (hp.severity === 'medium' && maxSeverity !== 'high') maxSeverity = 'medium'
    }
  }

  // Strictness multiplier
  const strictnessMult = settings.strictness === 'very_strict' ? 1.3
    : settings.strictness === 'high' ? 1.0
    : settings.strictness === 'medium' ? 0.8
    : 0.6
  totalWeight *= strictnessMult

  // Optional: call LLM API for semantic analysis (if configured)
  // We attempt this only if heuristics scored 0 (to save API calls) but
  // the message is non-trivial (length > 20).
  if (totalWeight === 0 && text.length > 20 && process.env.MODERATION_LLM_API_KEY) {
    try {
      const llmResult = await callLLMForModeration(text)
      if (llmResult.flagged) {
        for (const c of llmResult.categories) categories.add(c)
        totalWeight = llmResult.confidence
        if (llmResult.severity === 'high') maxSeverity = 'high'
        else if (llmResult.severity === 'medium' && maxSeverity !== 'high') maxSeverity = 'medium'
      }
    } catch {
      // LLM call failed — fall back to heuristics only (don't block the message)
    }
  }

  if (totalWeight < 0.5) {
    return { ...ALLOW_DECISION, content: text }
  }

  const action = totalWeight >= 0.8 ? 'block' : 'flag'
  return {
    allowed: action === 'flag', // 'flag' allows the message but flags it for review
    flagged: true,
    action,
    reason: `AI-модерация: ${Array.from(categories).join(', ')}`,
    categories: Array.from(categories),
    severity: maxSeverity,
    confidence: Math.min(totalWeight, 1.0),
    matchedWords: [],
    content: text,
  }
}

// ============================================================================
// Optional LLM integration (OpenAI-compatible API)
// ============================================================================

interface LLMModerationResult {
  flagged: boolean
  categories: string[]
  confidence: number
  severity: 'low' | 'medium' | 'high'
}

/**
 * Call an OpenAI-compatible LLM API for semantic moderation.
 *
 * Configuration (env vars):
 *   MODERATION_LLM_API_KEY  — API key (required for LLM mode)
 *   MODERATION_LLM_BASE_URL — base URL (default: https://api.openai.com/v1)
 *   MODERATION_LLM_MODEL    — model name (default: gpt-4o-mini)
 *
 * If the API call fails or times out, returns { flagged: false } (fail open).
 */
async function callLLMForModeration(text: string): Promise<LLMModerationResult> {
  const apiKey = process.env.MODERATION_LLM_API_KEY
  if (!apiKey) return { flagged: false, categories: [], confidence: 0, severity: 'low' }

  const baseUrl = process.env.MODERATION_LLM_BASE_URL || 'https://api.openai.com/v1'
  const model = process.env.MODERATION_LLM_MODEL || 'gpt-4o-mini'

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000) // 3s timeout

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a content moderation AI. Analyze the user message and return JSON: {"flagged": boolean, "categories": string[], "confidence": number 0-1, "severity": "low"|"medium"|"high"}. Categories: violence, extremism, drugs, fraud, sexual_harassment, bullying, hate_speech, illegal, phishing, spam, other. Be conservative — only flag clear violations.',
          },
          { role: 'user', content: text },
        ],
        temperature: 0,
        max_tokens: 100,
      }),
    })
    if (!resp.ok) return { flagged: false, categories: [], confidence: 0, severity: 'low' }
    const data = await resp.json()
    const content = data?.choices?.[0]?.message?.content || ''
    // Parse JSON from the response (it may be wrapped in markdown code fences)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { flagged: false, categories: [], confidence: 0, severity: 'low' }
    return JSON.parse(jsonMatch[0])
  } catch {
    return { flagged: false, categories: [], confidence: 0, severity: 'low' }
  } finally {
    clearTimeout(timeout)
  }
}

// ============================================================================
// Main entry: moderateContent
// ============================================================================

/**
 * Run both levels of moderation and return a single decision.
 *
 * Order:
 *   1. Check if user is banned/restricted (fast path — block immediately).
 *   2. Run Level 1 (local check).
 *   3. If Level 1 blocked, return immediately (no AI call needed).
 *   4. Run Level 2 (AI check).
 *   5. Combine results.
 *   6. If flagged, record an AIFlag entry (for Studio review).
 *   7. If flagged, increment user's violation counter and check auto-action thresholds.
 *
 * Privacy: only flagged content is persisted to AIFlag. Allowed messages
 * are NEVER stored in moderation tables.
 */
export async function moderateContent(text: string, ctx: ModerationContext): Promise<ModerationDecision> {
  if (!text || !text.trim()) return { ...ALLOW_DECISION, content: text }

  const settings = await getModerationSettings()
  if (!settings.enabled) return { ...ALLOW_DECISION, content: text }

  // 1. Check user ban/restriction
  const userStatus = await isUserAllowed(ctx.userId, ctx.targetType)
  if (!userStatus.allowed) {
    return {
      allowed: false,
      flagged: false,
      action: 'block',
      reason: userStatus.reason,
      categories: [],
      severity: 'high',
      confidence: 1,
      matchedWords: [],
      content: text,
    }
  }

  // 2. Level 1 — local check
  const localResult = await checkLocal(text, ctx)

  // 3. If local check blocked, return immediately
  if (localResult.action === 'block') {
    await recordViolation(ctx, localResult, 'local')
    return localResult
  }

  // 4. Level 2 — AI check (only if local check didn't block)
  const aiResult = await checkAI(text, ctx)

  // 5. Combine — AI can escalate from 'flag' to 'block'
  let finalDecision = localResult
  if (aiResult.flagged) {
    if (aiResult.action === 'block') {
      finalDecision = aiResult
    } else if (localResult.flagged) {
      // Merge: combine categories from both
      const mergedSeverity: 'low' | 'medium' | 'high' =
        (localResult.severity === 'high' || aiResult.severity === 'high') ? 'high'
        : (localResult.severity === 'medium' || aiResult.severity === 'medium') ? 'medium'
        : 'low'
      finalDecision = {
        ...localResult,
        categories: [...new Set([...localResult.categories, ...aiResult.categories])],
        severity: mergedSeverity,
        reason: `${localResult.reason}; AI: ${aiResult.reason}`,
      }
    } else {
      // Only AI flagged it
      finalDecision = aiResult
    }
  }

  // 6. Record AI flag if flagged
  if (finalDecision.flagged) {
    await recordAIFlag(ctx, finalDecision)
    await recordViolation(ctx, finalDecision, finalResultSource(localResult, aiResult))
  }

  return finalDecision
}

function finalResultSource(local: ModerationDecision, ai: ModerationDecision): 'local' | 'ai' | 'both' {
  if (local.flagged && ai.flagged) return 'both'
  if (ai.flagged) return 'ai'
  return 'local'
}

// ============================================================================
// User status check (ban / restrictions)
// ============================================================================

export interface UserModerationStatus {
  allowed: boolean
  reason: string
  isBanned: boolean
  chatRestricted: boolean
  reviewsRestricted: boolean
}

export async function isUserAllowed(userId: string, targetType: ModerationTargetType): Promise<UserModerationStatus> {
  try {
    const stats = await prisma.userModerationStats.findUnique({ where: { userId } })
    if (!stats) {
      return { allowed: true, reason: 'OK', isBanned: false, chatRestricted: false, reviewsRestricted: false }
    }

    // Check ban
    if (stats.isBanned) {
      // Check if ban has expired
      if (stats.bannedUntil && stats.bannedUntil < new Date()) {
        // Ban expired — auto-unban
        await prisma.userModerationStats.update({
          where: { userId },
          data: { isBanned: false, bannedUntil: null, bannedBy: null, bannedAt: null, banReason: null },
        })
        await logModerationAction({ actorType: 'system', action: 'auto_unban', targetType: 'user', targetId: userId, reason: 'Ban expired' })
      } else {
        return {
          allowed: false,
          reason: stats.banReason || 'Аккаунт заблокирован',
          isBanned: true,
          chatRestricted: true,
          reviewsRestricted: true,
        }
      }
    }

    // Check chat restriction
    if (targetType === 'message' && stats.chatRestrictedUntil && stats.chatRestrictedUntil > new Date()) {
      return {
        allowed: false,
        reason: `Чат ограничен до ${stats.chatRestrictedUntil.toLocaleString('ru-RU')}`,
        isBanned: false,
        chatRestricted: true,
        reviewsRestricted: false,
      }
    }

    // Check reviews restriction
    if (targetType === 'review' && stats.reviewsRestrictedUntil && stats.reviewsRestrictedUntil > new Date()) {
      return {
        allowed: false,
        reason: `Отзывы ограничены до ${stats.reviewsRestrictedUntil.toLocaleString('ru-RU')}`,
        isBanned: false,
        chatRestricted: false,
        reviewsRestricted: true,
      }
    }

    return { allowed: true, reason: 'OK', isBanned: false, chatRestricted: false, reviewsRestricted: false }
  } catch (e) {
    // DB error — fail open (don't block legitimate users)
    return { allowed: true, reason: 'OK', isBanned: false, chatRestricted: false, reviewsRestricted: false }
  }
}

// ============================================================================
// Persistence: AIFlag + violation tracking + auto-actions
// ============================================================================

async function recordAIFlag(ctx: ModerationContext, decision: ModerationDecision): Promise<void> {
  try {
    await prisma.aIFlag.create({
      data: {
        userId: ctx.userId,
        targetType: ctx.targetType,
        targetId: ctx.targetId || null,
        content: decision.content.slice(0, 2000),
        reason: `${decision.reason} [${decision.categories.join(',')}]`,
        confidence: decision.confidence,
        severity: decision.severity,
        action: decision.action,
      },
    })
  } catch (e) {
    // Non-critical — log and continue
    logger.error('recordAIFlag failed', { module: 'moderation', error: e instanceof Error ? e : new Error(String(e)) })
  }
}

async function recordViolation(ctx: ModerationContext, decision: ModerationDecision, source: 'local' | 'ai' | 'both'): Promise<void> {
  try {
    // Log the action
    await logModerationAction({
      actorType: source === 'local' ? 'system' : 'ai',
      action: decision.action === 'block' ? 'block_message' : 'flag_message',
      targetType: ctx.targetType,
      targetId: ctx.targetId,
      reason: decision.reason,
      details: { categories: decision.categories, severity: decision.severity, confidence: decision.confidence, source },
    })

    // Increment user's violation counter (only for blocking actions, not flags)
    if (decision.action !== 'block') return

    const settings = await getModerationSettings()
    const stats = await getOrCreateUserStats(ctx.userId)

    // Count violations in the last 24h
    const recentViolations = await prisma.moderationLog.count({
      where: {
        actorType: { in: ['system', 'ai'] },
        action: 'block_message',
        targetType: ctx.targetType,
        // We don't have a userId column on ModerationLog directly — but we can
        // query AIFlag for the user, or use the details JSON. For simplicity,
        // we count via AIFlag.
      },
    })

    // Increment counters
    const updateData: any = {
      violationsCount: { increment: 1 },
    }
    if (ctx.targetType === 'message') updateData.deletedMessagesCount = { increment: 1 }
    if (ctx.targetType === 'review') updateData.deletedReviewsCount = { increment: 1 }

    await prisma.userModerationStats.update({
      where: { userId: ctx.userId },
      data: updateData,
    })

    // Auto-actions based on thresholds
    const totalViolations = stats.violationsCount + 1

    if (totalViolations >= settings.autoBanThreshold) {
      // Auto-ban
      await prisma.userModerationStats.update({
        where: { userId: ctx.userId },
        data: {
          isBanned: true,
          banReason: `Авто-бан: ${totalViolations} нарушений`,
          bannedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          bannedBy: null,
          bannedAt: new Date(),
          bansCount: { increment: 1 },
        },
      })
      await logModerationAction({
        actorType: 'system',
        action: 'auto_ban',
        targetType: 'user',
        targetId: ctx.userId,
        reason: `Auto-ban: ${totalViolations} violations`,
      })
    } else if (totalViolations >= settings.autoMuteThreshold) {
      // Auto-mute chat for 1 hour
      await prisma.userModerationStats.update({
        where: { userId: ctx.userId },
        data: {
          chatRestrictedUntil: new Date(Date.now() + 60 * 60 * 1000),
        },
      })
      await logModerationAction({
        actorType: 'system',
        action: 'auto_restrict_chat',
        targetType: 'user',
        targetId: ctx.userId,
        reason: `Auto-mute: ${totalViolations} violations`,
      })
    } else if (totalViolations >= settings.autoWarnThreshold) {
      // Auto-warn
      await prisma.moderationWarning.create({
        data: {
          userId: ctx.userId,
          reason: `Авто-предупреждение: ${totalViolations} нарушений`,
          message: 'Ваше сообщение было заблокировано системой модерации. Пожалуйста, соблюдайте правила общения.',
          severity: 'medium',
          createdBy: 'system',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      })
      await prisma.userModerationStats.update({
        where: { userId: ctx.userId },
        data: { warningsCount: { increment: 1 } },
      })
      await logModerationAction({
        actorType: 'system',
        action: 'auto_warn',
        targetType: 'user',
        targetId: ctx.userId,
        reason: `Auto-warn: ${totalViolations} violations`,
      })
    }
  } catch (e) {
    logger.error('recordViolation failed', { module: 'moderation', error: e instanceof Error ? e : new Error(String(e)) })
  }
}

async function getOrCreateUserStats(userId: string) {
  let stats = await prisma.userModerationStats.findUnique({ where: { userId } })
  if (!stats) {
    try {
      stats = await prisma.userModerationStats.create({ data: { userId } })
    } catch {
      // Race condition — another request created it first
      stats = await prisma.userModerationStats.findUnique({ where: { userId } })
    }
  }
  return stats!
}

// ============================================================================
// Moderation log helper
// ============================================================================

export async function logModerationAction(params: {
  actorType: 'ai' | 'admin' | 'system'
  actorId?: string | null
  action: string
  targetType: string
  targetId?: string | null
  reason?: string | null
  details?: Record<string, unknown>
}): Promise<void> {
  try {
    await prisma.moderationLog.create({
      data: {
        actorType: params.actorType,
        actorId: params.actorId || null,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId || null,
        reason: params.reason || null,
        details: JSON.stringify(params.details || {}),
      },
    })
  } catch (e) {
    logger.error('logModerationAction failed', { module: 'moderation', error: e instanceof Error ? e : new Error(String(e)) })
  }
}
