'use client'

import { Bot, ChevronDown, Mic, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { haptic } from '@/lib/haptic'

// v25.12: AIAssistantSection — встроенный AI-чат "Зои" на главной.
// Как на IMG_3192: светло-бежевый фон, аватар Зои + статус online,
// speech bubble с приветствием, горизонтальные quick action pills.

interface AIAssistantSectionProps {
  onOpenAI?: () => void
  onQuickAction?: (action: string) => void
}

const QUICK_ACTIONS = [
  { id: 'gift-her', emoji: '🎁', text: 'Подарок для неё до 2000₽' },
  { id: 'armchair', emoji: '🪑', text: 'Кресло для гостиной' },
  { id: 'business-cards', emoji: '💳', text: 'Визитки Premium' },
  { id: 'merch', emoji: '👕', text: 'Мерч с логотипом' },
]

export function AIAssistantSection({ onOpenAI, onQuickAction }: AIAssistantSectionProps) {
  const [expanded, setExpanded] = useState(true)

  const handleAction = (action: string) => {
    haptic.tap()
    if (onQuickAction) onQuickAction(action)
    else if (onOpenAI) onOpenAI()
    else window.dispatchEvent(new CustomEvent('open-ai-assistant'))
  }

  return (
    <section className="px-4 pt-1.5">
      <div className="rounded-3xl bg-gradient-to-br from-[#FFFBEB] via-[#FEF3C7] to-[#FFF7E0] p-4 md:p-5">
        {/* Header */}
        <button
          onClick={() => { haptic.tap(); setExpanded(!expanded) }}
          className="w-full flex items-center gap-3 text-left"
        >
          <div className="relative h-11 w-11 rounded-2xl bg-gradient-to-br from-[#DB2777] to-[#9333EA] grid place-items-center shrink-0">
            <Bot className="h-6 w-6 text-white" />
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-[#FFFBEB]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-[#1A1A1A] text-base">Зои · ИИ-гид</h3>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                online
              </span>
            </div>
            <p className="text-xs text-[#666666] truncate mt-0.5">
              Подберу товар голосом или текстом · RAG
            </p>
          </div>
          <ChevronDown className={`h-5 w-5 text-[#666666] transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`} />
        </button>

        {expanded && (
          <>
            {/* Speech bubble */}
            <div className="mt-4 bg-white rounded-2xl p-4 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.08)]">
              <p className="text-sm md:text-[15px] text-[#374151] leading-relaxed">
                Здравствуйте! Я Зои — ваш ИИ-гид по бутику TRI999 🌸
                <br /><br />
                Помогу подобрать рекламную продукцию, подарки или мебель. Напишите текстом или нажмите 🎤 и скажите голосом — что вы ищете?
              </p>
            </div>

            {/* Input row (mock — кликабельный, открывает AI) */}
            <button
              onClick={() => handleAction('open')}
              className="w-full mt-3 flex items-center gap-2 bg-white rounded-full px-4 py-3 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.08)] text-left"
            >
              <Sparkles className="h-4 w-4 text-[#A02070] shrink-0" />
              <span className="flex-1 text-sm text-[#9CA3AF] truncate">Спросите Зои…</span>
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[#EC4899] to-[#9333EA] grid place-items-center shrink-0">
                <Mic className="h-4 w-4 text-white" />
              </div>
            </button>

            {/* Quick actions */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 mt-3 pb-1">
              {QUICK_ACTIONS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => handleAction(a.id)}
                  className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-white border border-[#E5E7EB] text-xs md:text-sm text-[#4A4A4A] hover:border-[#A02070] hover:text-[#A02070] transition-colors"
                >
                  <span>{a.emoji}</span>
                  <span>{a.text}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
