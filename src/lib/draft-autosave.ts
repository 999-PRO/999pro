'use client'

// ============================================================================
//  Draft autosave — persists the user's unsent chat message per-conversation
//  so that a crash, accidental refresh, or app switch doesn't lose what they
//  were typing.
//
//  Storage: localStorage (small data, synchronous access OK for drafts).
//  Key format: `999pro-draft:<conversationId>` → string (the draft text).
//
//  Usage:
//    import { saveDraft, loadDraft, clearDraft } from '@/lib/draft-autosave'
//
//    // On text change (debounced):
//    saveDraft(conversationId, text)
//
//    // On conversation open:
//    const draft = loadDraft(conversationId)
//    if (draft) setText(draft)
//
//    // On successful send:
//    clearDraft(conversationId)
// ============================================================================

const DRAFT_PREFIX = '999pro-draft:'

/** Save a draft for a conversation. Empty string clears the draft. */
export function saveDraft(conversationId: string, text: string): void {
  if (typeof window === 'undefined') return
  try {
    if (!text.trim()) {
      clearDraft(conversationId)
      return
    }
    window.localStorage.setItem(DRAFT_PREFIX + conversationId, text)
  } catch {
    // localStorage full / disabled — silently ignore. The draft is best-effort.
  }
}

/** Load a draft for a conversation. Returns empty string if none. */
export function loadDraft(conversationId: string): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(DRAFT_PREFIX + conversationId) || ''
  } catch {
    return ''
  }
}

/** Clear a draft for a conversation (called after successful send). */
export function clearDraft(conversationId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(DRAFT_PREFIX + conversationId)
  } catch {}
}
