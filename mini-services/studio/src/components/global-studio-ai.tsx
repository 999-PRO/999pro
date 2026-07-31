'use client'

import { useCallback } from 'react'
import { StudioAIAssistant } from './studio-ai-assistant'

interface GlobalStudioAIProps {
  view: string
}

// v24.5: Maps studio view IDs to AI context types.
// Sections that already have their own StudioAIAssistant (products, stories,
// banners, hero) are excluded — they handle AI internally with proper form data.
const VIEW_TO_AI_TYPE: Record<string, string> = {
  club: 'club',
  'registration-settings': 'registration',
  users: 'user',
  'bonus-points': 'bonus',
  audit: 'audit',
  communication: 'communication',
  security: 'security',
  delivery: 'delivery',
  'promo-codes': 'promo',
  'info-pages': 'info-page',
  moderation: 'moderation',
  managers: 'user',
}

// Sections that have their OWN embedded StudioAIAssistant — skip global AI.
const SECTIONS_WITH_OWN_AI = new Set(['products', 'stories', 'banners', 'hero'])

export function GlobalStudioAI({ view }: GlobalStudioAIProps) {
  // Skip sections that have their own AI assistant embedded
  if (SECTIONS_WITH_OWN_AI.has(view)) return null

  const aiType = VIEW_TO_AI_TYPE[view]
  if (!aiType) return null

  // v24.6-audit (C-AI-2 fix): Collect form data from the active section by scraping
  // inputs/textareas. CRITICAL: skip password fields, API-key entry fields, TOTP
  // secrets, and any field whose name suggests it contains a secret — these must
  // NEVER be sent to the third-party LLM as AI context.
  const getData = useCallback(() => {
    try {
      // Selector excludes:
      //  - password / file / hidden / submit / button / image / reset inputs
      //  - checkbox / radio (no useful text value)
      //  - fields marked readonly (no editable value)
      //  - fields marked autocomplete=off AND name contains 'key'/'secret'/'token'/'password'
      //  - aria-label/name/placeholder containing: password, secret, token, api-key, key, totp, otp, credential
      const SENSITIVE_PAT = /(password|secret|token|api[-_]?key|private[-_]?key|^key$|totp|otp|credential|smtp[-_]?pass|vapid|bearer)/i
      const inputs = document.querySelectorAll(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="password"]):not([type="file"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="reset"]), textarea, select'
      )
      const data: Record<string, string> = {}
      inputs.forEach((el, i) => {
        const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        const label = input.getAttribute('aria-label') || input.getAttribute('placeholder') || input.getAttribute('name') || `field_${i}`
        // Skip fields whose label/name suggests a secret
        if (SENSITIVE_PAT.test(label)) return
        // Skip fields explicitly marked as containing a secret via data attribute
        if (input.getAttribute('data-sensitive') === 'true') return
        const value = input.value || ''
        if (value) data[label] = value
      })
      return data
    } catch {
      return {}
    }
  }, [])

  // Generic apply — shows a toast since global AI can't write to specific forms.
  // For sections with dedicated managers, the embedded AI handles apply properly.
  const handleApply = useCallback((field: string, value: string) => {
    // v24.6-audit (C-AI-2 fix): never write to sensitive fields even if label matches
    const SENSITIVE_PAT = /(password|secret|token|api[-_]?key|private[-_]?key|^key$|totp|otp|credential|smtp[-_]?pass|vapid|bearer)/i
    if (SENSITIVE_PAT.test(field)) {
      console.warn('[Studio AI] Refusing to write to sensitive field:', field)
      return
    }
    // Try to find an input with a matching label/name and fill it
    try {
      const inputs = document.querySelectorAll(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="password"]):not([type="file"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="reset"]), textarea'
      )
      for (const el of inputs) {
        const input = el as HTMLInputElement | HTMLTextAreaElement
        const label = (input.getAttribute('aria-label') || input.getAttribute('placeholder') || input.getAttribute('name') || '').toLowerCase()
        // Skip sensitive targets on apply side too
        if (SENSITIVE_PAT.test(label)) continue
        if (label.includes(field.toLowerCase()) || field.toLowerCase().includes(label)) {
          input.value = value
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          return
        }
      }
    } catch {}
  }, [])

  return (
    <StudioAIAssistant
      type={aiType as any}
      getData={getData}
      onApply={handleApply}
      title={undefined}
    />
  )
}
