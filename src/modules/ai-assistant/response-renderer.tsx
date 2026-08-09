'use client'

// ============================================================================
//  AI Response Renderer — v18.14 PREMIUM
// ----------------------------------------------------------------------------
//  Transforms AI text responses into beautiful structured UI.
//  - Strips ALL Markdown (*, #, -, `, etc.) — user never sees raw syntax.
//  - Detects prices (₽, руб, RUB) and renders them as large gradient text.
//  - Detects lists (- item, • item, 1. item) and renders as styled lists.
//  - Detects headings (# Title, ## Subtitle) and renders as gradient headers.
//  - Detects status keywords (в наличии, акция, новинка, премиум) and
//    converts them to colored badges.
//  - Detects key-value pairs (Цена: 890 ₽) and renders as structured rows.
//  - Wraps paragraphs in glass containers with dividers.
// ============================================================================

import { motion, AnimatePresence } from 'framer-motion'
import {
  Check, X, AlertCircle, Info, ShoppingBag, Tag, Sparkles, TrendingUp, Clock,
} from 'lucide-react'

interface RenderedBlock {
  type: 'heading' | 'paragraph' | 'list' | 'price-highlight' | 'key-value' | 'divider' | 'status-badge'
  content?: string
  items?: string[]
  level?: 1 | 2 | 3
  price?: number
  currency?: string
  label?: string
  value?: string
  badgeType?: 'in-stock' | 'sale' | 'new' | 'premium' | 'info' | 'warning'
}

// Parse a text response into structured blocks.
function parseResponse(text: string): RenderedBlock[] {
  const blocks: RenderedBlock[] = []
  const lines = text.split('\n')

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    // Strip Markdown markers but keep content.
    // **bold** → bold (we'll style it)
    // # heading → heading
    // - item / • item / * item → list item
    // 1. item → numbered list item
    // `code` → code (strip backticks)

    // Heading detection: # or ## or ###
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3
      const content = stripMarkdown(headingMatch[2])
      blocks.push({ type: 'heading', content, level })
      continue
    }

    // List item detection: - • * or numbered
    const listMatch = line.match(/^[-•*]\s+(.+)$/) || line.match(/^\d+\.\s+(.+)$/)
    if (listMatch) {
      const item = stripMarkdown(listMatch[1])
      // If the previous block is a list, append to it.
      const lastBlock = blocks[blocks.length - 1]
      if (lastBlock && lastBlock.type === 'list') {
        lastBlock.items!.push(item)
      } else {
        blocks.push({ type: 'list', items: [item] })
      }
      continue
    }

    // Key-value detection: "Label: value" or "Label — value"
    const kvMatch = line.match(/^([А-Яа-яA-Za-z\s]{2,30}):\s*(.+)$/) || line.match(/^([А-Яа-яA-Za-z\s]{2,30})\s+—\s+(.+)$/)
    if (kvMatch) {
      const label = kvMatch[1].trim()
      const value = stripMarkdown(kvMatch[2].trim())
      // Check if value contains a price
      const priceMatch = value.match(/(\d[\d\s]*)\s*(₽|руб|RUB)/i)
      if (priceMatch) {
        const price = parseInt(priceMatch[1].replace(/\s/g, ''), 10)
        blocks.push({ type: 'key-value', label, value, price })
      } else {
        blocks.push({ type: 'key-value', label, value })
      }
      continue
    }

    // Status badge detection: "В наличии", "Акция", "Новинка", "Премиум"
    const statusLower = line.toLowerCase()
    if (/^(в наличии|есть в наличии|в наличии|акция|новинка|премиум|premium|new|sale)/i.test(line) && line.length < 50) {
      let badgeType: RenderedBlock['badgeType'] = 'info'
      if (/в наличии|есть/i.test(statusLower)) badgeType = 'in-stock'
      else if (/акция|sale/i.test(statusLower)) badgeType = 'sale'
      else if (/новинк|new/i.test(statusLower)) badgeType = 'new'
      else if (/премиум|premium/i.test(statusLower)) badgeType = 'premium'
      blocks.push({ type: 'status-badge', badgeType, content: stripMarkdown(line) })
      continue
    }

    // Price-only line: "890 ₽" or "от 890 рублей"
    const priceOnlyMatch = line.match(/^(от\s*)?(\d[\d\s]*)\s*(₽|руб|RUB)/i)
    if (priceOnlyMatch && line.length < 30) {
      const price = parseInt(priceOnlyMatch[2].replace(/\s/g, ''), 10)
      blocks.push({ type: 'price-highlight', price, content: line })
      continue
    }

    // Divider detection: --- or ___ or ***
    if (/^[-_*]{3,}$/.test(line)) {
      blocks.push({ type: 'divider' })
      continue
    }

    // Regular paragraph — strip inline markdown
    const cleanText = stripMarkdown(line)
    if (cleanText) {
      blocks.push({ type: 'paragraph', content: cleanText })
    }
  }

  return blocks
}

// Strip inline Markdown: **bold**, *italic*, `code`, ~~strike~~
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')  // **bold** → bold
    .replace(/\*(.+?)\*/g, '$1')       // *italic* → italic
    .replace(/`(.+?)`/g, '$1')         // `code` → code
    .replace(/~~(.+?)~~/g, '$1')       // ~~strike~~ → strike
    .replace(/#{1,6}\s/g, '')          // # heading → heading
    .trim()
}

// Render a single block as beautiful UI.
function renderBlock(block: RenderedBlock, index: number) {
  const delay = index * 0.08

  switch (block.type) {
    case 'heading':
      return (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="mt-3 first:mt-0"
        >
          <h3
            className="font-bold leading-tight"
            style={{
              fontSize: block.level === 1 ? '1.25rem' : block.level === 2 ? '1.1rem' : '1rem',
              background: 'linear-gradient(135deg, #818cf8 0%, #c4b5fd 50%, #a78bfa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {block.content}
          </h3>
        </motion.div>
      )

    case 'paragraph':
      return (
        <motion.p
          key={index}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="text-foreground/85 leading-relaxed text-sm sm:text-base mt-2 first:mt-0"
        >
          {renderInlineContent(block.content!)}
        </motion.p>
      )

    case 'list':
      return (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="mt-2 space-y-1.5"
        >
          {block.items!.map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <div
                className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0"
                style={{ background: 'linear-gradient(135deg, #818cf8, #a78bfa)' }}
              />
              <span className="text-foreground/80 text-sm leading-relaxed">
                {renderInlineContent(item)}
              </span>
            </div>
          ))}
        </motion.div>
      )

    case 'price-highlight':
      return (
        <motion.div
          key={index}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay, type: 'spring', stiffness: 260, damping: 20 }}
          className="my-3 inline-flex items-baseline gap-2 px-4 py-2 rounded-2xl"
          style={{
            background: 'rgba(139, 92, 246, 0.08)',
            border: '1px solid rgba(139, 92, 246, 0.2)',
          }}
        >
          <span
            className="text-3xl font-extrabold"
            style={{
              background: 'linear-gradient(135deg, #818cf8 0%, #c4b5fd 50%, #a78bfa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {block.price?.toLocaleString('ru-RU')} ₽
          </span>
        </motion.div>
      )

    case 'key-value':
      return (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay, duration: 0.4 }}
          className="flex items-center justify-between gap-3 py-1.5 border-b border-border/40 last:border-0"
        >
          <span className="text-muted-foreground text-xs uppercase tracking-wide">{block.label}</span>
          {block.price ? (
            <span
              className="text-lg font-bold"
              style={{
                background: 'linear-gradient(135deg, #818cf8, #a78bfa)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {block.price.toLocaleString('ru-RU')} ₽
            </span>
          ) : (
            <span className="text-foreground/90 text-sm font-medium">{block.value}</span>
          )}
        </motion.div>
      )

    case 'status-badge':
      return (
        <motion.div
          key={index}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay, type: 'spring', stiffness: 300, damping: 18 }}
          className="my-1"
        >
          {renderBadge(block.badgeType!, block.content!)}
        </motion.div>
      )

    case 'divider':
      return (
        <motion.div
          key={index}
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ delay, duration: 0.5 }}
          className="my-3 h-px"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(139,92,246,0.3) 50%, transparent 100%)',
          }}
        />
      )

    default:
      return null
  }
}

// Render a status badge with appropriate color.
function renderBadge(type: NonNullable<RenderedBlock['badgeType']>, text: string) {
  const config = {
    'in-stock': { bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.3)', color: '#34d399', icon: Check },
    'sale': { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.3)', color: '#f87171', icon: Tag },
    'new': { bg: 'rgba(139,92,246,0.15)', border: 'rgba(139,92,246,0.3)', color: '#a78bfa', icon: Sparkles },
    'premium': { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.3)', color: '#fbbf24', icon: TrendingUp },
    'info': { bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.3)', color: '#60a5fa', icon: Info },
    'warning': { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.3)', color: '#fbbf24', icon: AlertCircle },
  }
  const c = config[type]
  const Icon = c.icon
  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold"
      style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.color }}
    >
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {text}
    </span>
  )
}

// Render inline content — detects prices within text and highlights them.
function renderInlineContent(text: string) {
  // Split by price patterns and render prices as gradient spans.
  const parts: Array<{ type: 'text' | 'price'; content: string; price?: number }> = []
  const priceRegex = /(\d[\d\s]*)\s*(₽|руб|RUB)/gi
  let lastIndex = 0
  let match

  while ((match = priceRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }
    const price = parseInt(match[1].replace(/\s/g, ''), 10)
    parts.push({ type: 'price', content: match[0], price })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) })
  }

  return parts.map((part, i) => {
    if (part.type === 'price') {
      return (
        <span
          key={i}
          className="font-bold"
          style={{
            background: 'linear-gradient(135deg, #818cf8, #a78bfa)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          {part.content}
        </span>
      )
    }
    return <span key={i}>{part.content}</span>
  })
}

// Main export — renders the full AI response as structured UI.
export function AIResponseRenderer({ text }: { text: string }) {
  const blocks = parseResponse(text)

  return (
    <div className="w-full">
      {blocks.map((block, i) => renderBlock(block, i))}
    </div>
  )
}
