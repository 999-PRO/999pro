'use client'

// ============================================================================
//  v25.9 — AI Session Store (Zustand + localStorage)
//  Keeps the AI assistant's state alive across navigation. The user can open
//  AI, start a conversation, navigate to another section, come back — the
//  conversation continues. Previously the AI was a popup with `useState`,
//  which lost everything on reload and didn't persist across tabs.
//
//  This store is the single source of truth for:
//    - `open` — is the AI panel visible?
//    - `conversationId` — current persistent conversation (or null for ephemeral)
//    - `messages` — the message list (loaded from server when conversationId changes)
//    - `mode` — 'text' | 'voice'
//    - `enabled` — master on/off toggle (when false, AI does not interfere)
//    - `lastContext` — the app view the user was in when they last opened AI
// ============================================================================

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface AIMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  cards?: any[]
  actions?: any[]
  calculation?: any
  images?: string[]
  ts: number
}

interface AISessionState {
  // Master on/off toggle. When false, AI does not auto-open, does not show
  // proactive suggestions, does not run voice mode in the background.
  enabled: boolean
  // Is the AI panel currently visible?
  open: boolean
  // Current conversation ID (null = ephemeral / no persistence).
  conversationId: string | null
  // Messages in the current conversation. Persisted to localStorage so the
  // user can close the tab and come back to the same conversation.
  messages: AIMessage[]
  // 'text' or 'voice' — the user can switch at any time.
  mode: 'text' | 'voice'
  // Auto-speak AI replies when in voice mode.
  autoSpeak: boolean
  // The last app view the user was in when they interacted with AI.
  lastContext: string | null
  // Has the user dismissed the proactive greeting for this session?
  greetingShown: boolean

  // Actions
  setEnabled: (enabled: boolean) => void
  setOpen: (open: boolean) => void
  toggleOpen: () => void
  setConversationId: (id: string | null) => void
  setMessages: (messages: AIMessage[]) => void
  addMessage: (msg: AIMessage) => void
  updateLastAssistantMessage: (patch: Partial<AIMessage>) => void
  clearMessages: () => void
  setMode: (mode: 'text' | 'voice') => void
  setAutoSpeak: (autoSpeak: boolean) => void
  setLastContext: (ctx: string) => void
  setGreetingShown: (shown: boolean) => void
  reset: () => void
}

export const useAISession = create<AISessionState>()(
  persist(
    (set) => ({
      enabled: true,
      open: false,
      conversationId: null,
      messages: [],
      mode: 'text',
      autoSpeak: false,
      lastContext: null,
      greetingShown: false,

      setEnabled: (enabled) => set({ enabled }),
      setOpen: (open) => set({ open }),
      toggleOpen: () => set((s) => ({ open: !s.open })),
      setConversationId: (conversationId) => set({ conversationId }),
      setMessages: (messages) => set({ messages }),
      addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
      updateLastAssistantMessage: (patch) =>
        set((s) => {
          const msgs = [...s.messages]
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant') {
              msgs[i] = { ...msgs[i], ...patch }
              break
            }
          }
          return { messages: msgs }
        }),
      clearMessages: () => set({ messages: [], conversationId: null, greetingShown: false }),
      setMode: (mode) => set({ mode }),
      setAutoSpeak: (autoSpeak) => set({ autoSpeak }),
      setLastContext: (lastContext) => set({ lastContext }),
      setGreetingShown: (greetingShown) => set({ greetingShown }),
      reset: () =>
        set({
          open: false,
          conversationId: null,
          messages: [],
          greetingShown: false,
        }),
    }),
    {
      name: '999pro-ai-session',
      storage: createJSONStorage(() => (typeof window !== 'undefined' ? window.localStorage : (undefined as any))),
      // Only persist the user-facing prefs + conversationId + messages.
      // `open` defaults to false on every reload so AI doesn't auto-popup.
      partialize: (s) => ({
        enabled: s.enabled,
        conversationId: s.conversationId,
        messages: s.messages.slice(-50), // cap at last 50 messages
        mode: s.mode,
        autoSpeak: s.autoSpeak,
        lastContext: s.lastContext,
      }),
    },
  ),
)
