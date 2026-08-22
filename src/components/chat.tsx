'use client'

// ============================================================================
// H7 fix (staged): chat.tsx — 2029 строк, god-component.
//
// Это staging-файл для будущего рефакторинга. План:
//   1. Извлечь useChatState() — все useState в один custom hook (~150 строк).
//   2. Извлечь useChatSocket() — уже подготовлено в chat/hooks/use-chat-socket.ts,
//      но ещё не подключено (см. F-ARCH-005 backlog).
//   3. Извлечь ChatMessageList — компонент списка сообщений (~400 строк).
//   4. Извлечь ChatInput — нижняя панель ввода + voice recorder (~300 строк).
//   5. Извлечь ChatConversationList — список Conversations слева (~300 строк).
//
// После всех шагов ChatView должен быть ~400 строк (orchestrator only).
// Пока — оставлено как есть, чтобы не сломать рабочую функциональность чата.
// ============================================================================

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { api, assetUrl } from '@/lib/api'
import type { Conversation, Message, User, ChatUser } from '@/lib/types'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Search, Send, Mic, ArrowLeft, ArrowUp, Phone, Video as VideoIcon,
  Trash2, Paperclip, MoreVertical, Trash, ShieldAlert,
  Headphones, Smile, ShoppingBag,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/lib/auth-store'
import { initials, timeAgo, formatTime, formatDuration } from '@/lib/format'
import { useSocket } from '@/lib/use-socket'
import { compressImage } from '@/lib/compress-image'
import { getChatCardPalette } from '@/lib/gradients'
import { useMessageSound } from '@/lib/use-message-sound'
import { haptic } from '@/lib/haptic'
import { saveDraft, loadDraft, clearDraft } from '@/lib/draft-autosave'
import { useScrollLock } from '@/lib/use-scroll-lock'
import { toast } from '@/lib/notifications'
import { AnimatePresence, motion } from 'framer-motion'
// F-MED-007: code-split rarely-used chat features. ForwardDialog, ImageLightbox,
// MessageContextMenu, and CallHistory are only opened on explicit user action
// (forward-tap, image-tap, message long-press, call-history toggle). Loading
// them lazily via next/dynamic shrinks the initial ChatView bundle by their
// combined size and defers parsing until first use.
import dynamic from 'next/dynamic'
const MessageContextMenu = dynamic(
  () => import('./message-context-menu').then(m => ({ default: m.MessageContextMenu })),
  { ssr: false },
)
const ForwardDialog = dynamic(
  () => import('./forward-dialog').then(m => ({ default: m.ForwardDialog })),
  { ssr: false },
)
// v16.9: moderation report dialog (lazy-loaded)
const ReportMessageDialog = dynamic(
  () => import('./report-message-dialog').then(m => ({ default: m.ReportMessageDialog })),
  { ssr: false },
)
const ImageLightbox = dynamic(
  () => import('./image-lightbox').then(m => ({ default: m.ImageLightbox })),
  { ssr: false },
)
import { ReplyPreview } from './reply-preview'
import { ChatBackground } from './chat-background'
import { linkify, isImageUrl, isVideoUrl, isAudioUrl, getFilenameFromUrl } from '@/lib/message-utils'
import { useNotificationsStore } from '@/lib/use-notifications'
import { getPendingOpenConversation } from '@/lib/pending-chat-open'
// F-HIGH-012: subscribe to unread.byConversation with shallow equality so
// sibling-state changes (e.g. `inAppToast`) don't trigger a re-render here.
import { useShallow } from 'zustand/react/shallow'
// Extracted sub-components (refactor: these used to be defined inline at the
// bottom of this file. Moved to src/components/chat/ for maintainability.)
import { MessageBubble } from './chat/message-bubble'
import { useVoiceRecorder } from './chat/use-voice-recorder'
import { ChatListItem } from './chat/chat-list-item'
const CallHistory = dynamic(
  () => import('./chat/call-history').then(m => ({ default: m.CallHistory })),
  { ssr: false },
)
import { startOutgoingCall } from './call-manager'
import { Clock } from 'lucide-react'
// v9-voice: new living voice / typing system.
import { useMicAmplitude } from './chat/use-mic-amplitude'
import { VoiceRecordPanel } from './chat/voice-record-panel'
import { AmbientGlow } from './chat/ambient-glow'
import { TypingIndicator } from './chat/typing-indicator'
import { SmartScrollButton } from './smart-scroll-button'
// v16.8-attachments: центр вложений чата (медиа-центр).
import { AttachmentsCenter, type CategoryId } from './chat/attachments-center'
// v16.8.3: Bottom Sheet для выбора типа вложения + Product Picker + Favorites.
// v16.9-final: AttachmentsBottomSheet удалён — 📎 теперь открывает системный
// picker напрямую. Product Picker остаётся (открывается через постоянную
// кнопку 🛍 в нижней панели).
import { ProductPickerSearch } from './chat/product-picker-search'
import { EmojiPicker } from './chat/emoji-picker'
// v16.9.2: Audio Hub — поиск + отправка аудио в чат.
import { MediaHubOverlay } from '@/modules/media-hub/components/media-hub-overlay'
import { AudioDraftPreview } from '@/modules/audio-hub/components/audio-draft-preview'
import { MediaHubIcon } from '@/components/icons/media-hub-icon'
import type { AudioHubTrack } from '@/modules/audio-hub/types'
import type { FilmDetails, FilmChatCardData } from '@/modules/films/types'
import { useFavorites } from './chat/hooks/use-favorites'
import { useChatAttachments } from './chat/hooks/use-chat-attachments'
// v16.8.4: User Profile Sheet + Avatar Viewer + Chat List Context Menu.
import { UserProfileSheet } from './chat/user-profile-sheet'
import { AvatarViewer } from './chat/avatar-viewer'
import { ChatListContextMenu } from './chat/chat-list-context-menu'

export function ChatView() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  // v25.4: keep a ref in sync so stable callbacks (handleConvClick etc.) can
  // read the latest conversations without being recreated on every state change.
  const conversationsRef = useRef<Conversation[]>([])
  useEffect(() => { conversationsRef.current = conversations }, [conversations])
  const [activeConv, setActiveConv] = useState<Conversation | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<User[]>([])
  const [showSearch, setShowSearch] = useState(false)
  // chatUsers — list of ALL registered users (excluding the current user),
  // fetched from GET /api/chat/users. This is the unified source of truth
  // for the chat list — the same on desktop, Android PWA, and iPhone PWA.
  // We merge this with the user's existing conversations so the list shows:
  //   1. Pinned support chat (type='support') — always first
  //   2. Users with whom we already have a conversation — sorted by last message
  //   3. Other registered users — available to start a new chat with
  const [chatUsers, setChatUsers] = useState<ChatUser[]>([])
  const [chatUsersLoading, setChatUsersLoading] = useState(false)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)
  const isInitialized = useAuthStore((s) => s.isInitialized)
  const token = useAuthStore((s) => s.token)
  // v25.4 (TZ-2 task #2): consider setupToken as "authenticated" too —
  // the admin is mid-2FA-setup but the session IS valid (the setup token
  // is a short-lived JWT issued by /api/auth/login after password check).
  // Without this, opening Chat during the 2FA-setup flow would show the
  // "log in" screen even though the user just successfully entered their
  // password.
  const setupToken = useAuthStore((s) => s.setupToken)
  const authed = isAuthenticated || (!!token && !!user) || (!!setupToken && !!user)
  const messageSound = useMessageSound()
  const [messages, setMessages] = useState<Message[]>([])
  // F-HIGH-006: memoize the reversed message list so we don't allocate a new
  // array on every render. The flex-col-reverse container expects DOM order
  // to be reversed (newest last), so we reverse the source array once and
  // reuse it across renders until `messages` actually changes.
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages])
  const [text, setText] = useState('')
  const [typing, setTyping] = useState<{ userId: string; username: string } | null>(null)
  // v9-voice-final: peer voice recording indicator. When the peer is recording
  // a voice message, we show a calm glass panel under the header + a soft
  // milky/silver/pale-blue ambient glow around the screen edges. The state
  // is driven by a CustomEvent ('peer:voice-recording') so any future socket
  // integration can dispatch it without touching this component's props.
  const [peerVoiceRecording, setPeerVoiceRecording] = useState<{ userId: string; username: string } | null>(null)
  // C-MED-006: aria-live announcement for screen readers. When a new incoming
  // message arrives, we set this to a short human-readable preview so the
  // screen reader announces it (the visual message bubble itself is added to
  // the DOM in a flex-col-reverse container, which most screen readers don't
  // announce automatically). Cleared/overwritten on each new message.
  const [lastMessageAnnouncement, setLastMessageAnnouncement] = useState('')
  // C-MED-013: clear stale typing indicator when the user switches
  // conversations. Without this, the previous conversation's "печатает…"
  // status leaks into the new one (the server-side `typing:stop` may not
  // have arrived yet, or may arrive AFTER the switch and re-arm the new
  // conversation with the old typing state). Reset on every activeConv
  // change; the new conversation's typing events will repopulate as needed.
  // v13.2 (audit P1-6 fix): also reset peerVoiceRecording — otherwise the
  // previous peer's "записывает голосовое…" indicator persists briefly.
  useEffect(() => {
    setTyping(null)
    setPeerVoiceRecording(null)
  }, [activeConv?.id])
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  // C-HIGH-006 fix: O(1) dedup via Set<messageId> alongside the messages array.
  // Previously: `cur.some(x => x.id === m.id)` ran on every incoming message,
  // which is O(N) per message and O(N²) overall for a long conversation.
  // We track both `id` and `tempId` so the sender's optimistic stub can be
  // reconciled when the server-confirmed message arrives (the confirmed id
  // differs from the optimistic tempId).
  const messageIdsRef = useRef<Set<string>>(new Set())
  // v18.6: holds the replyTo id while a voice message is uploading, since
  // the replyTo state is cleared in onSend but the socket emit happens later
  // in onUploaded (after upload completes).
  const pendingVoiceReplyRef = useRef<string | null>(null)
  // C-HIGH-002 fix: infinite scroll refs. `loadingOlderRef` prevents stacking
  // concurrent fetches when the user keeps scrolling during an in-flight load.
  // `hasMoreRef` is set to false when a cursor fetch returns an empty page —
  // once cleared, no further scroll events trigger a fetch until the
  // conversation changes (which resets it to true in the fetch effect below).
  const loadingOlderRef = useRef(false)
  const hasMoreRef = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTypingSentRef = useRef(0)
  // Voice recorder refs (mediaRecorderRef, recordTimerRef, recordingCancelledRef,
  // chunksRef, recordSecondsRef) have been moved into the useVoiceRecorder
  // hook — see src/components/chat/use-voice-recorder.ts.

  // Reply / forward / context menu state
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null)
  const [forwardOpen, setForwardOpen] = useState(false)
  // v16.8-final: voice message self-destruct timer. Persists across multiple
  // recordings (sticky — the last chosen value is the default for the next).
  // 0 = no auto-delete. Allowed: 0, 60, 720, 1440, 10080 minutes.
  const [selfDestructMinutes, setSelfDestructMinutes] = useState<0 | 60 | 720 | 1440 | 10080>(0)
  // v16.8.3: активная категория-фильтр чата. 'all' = показать весь чат.
  const [activeCategory, setActiveCategory] = useState<CategoryId>('all')
  // v16.9-final: Product Picker Search — компактный поиск товаров для отправки.
  // Открывается постоянной кнопкой 🛍 в нижней панели (бывший пункт меню «Товар»).
  const [productPickerOpen, setProductPickerOpen] = useState(false)
  // v16.9.2: Audio Hub Search Overlay — компактное стеклянное окно поиска аудио.
  // Открывается кнопкой 🎵 в нижней панели чата.
  const [audioHubPickerOpen, setAudioHubPickerOpen] = useState(false)
  // v16.9.4: Audio Hub draft track — трек выбранный для отправки, но ещё не
  // отправленный. Показывается как карточка над полем ввода (как ReplyPreview).
  // Пользователь может прослушать, отправить или убрать черновик.
  const [audioDraftTrack, setAudioDraftTrack] = useState<AudioHubTrack | null>(null)
  // v16.9-final: Emoji Picker — стеклянная панель эмодзи над полем ввода.
  // Открывается кнопкой 😊 в нижней панели. Не Bottom Sheet, не отдельная
  // страница — именно inline-панель с glassmorphism.
  const [emojiPanelOpen, setEmojiPanelOpen] = useState(false)
  // v16.8.4: User Profile Sheet — открывается при нажатии на имя в Header.
  const [profileOpen, setProfileOpen] = useState(false)
  // v16.8.4: Avatar Viewer — полноэкранный просмотр аватара.
  const [avatarViewerOpen, setAvatarViewerOpen] = useState(false)
  // v16.8.4: Chat List Context Menu — long-press на чат в списке диалогов.
  const [chatListMenu, setChatListMenu] = useState<{ open: boolean; conv: Conversation | null }>({ open: false, conv: null })
  // v25.4 (perf audit P-1): stable callbacks for ChatListItem so React.memo works.
  // Previously inline arrows `() => setActiveConv(c)` were recreated every render,
  // defeating memoization and causing all 50-200 list items to re-render on every
  // keystroke. Now we pass the conversation id and look it up inside the callback
  // via conversationsRef (declared above, kept in sync via useEffect).
  const handleConvClick = useCallback((convId: string) => {
    const found = conversationsRef.current.find((c) => c.id === convId)
    if (found) setActiveConv(found)
  }, [])
  const handleConvLongPress = useCallback((convId: string) => {
    const found = conversationsRef.current.find((c) => c.id === convId)
    if (found) setChatListMenu({ open: true, conv: found })
  }, [])
  // v16.8.3: Система избранного.
  const favorites = useFavorites()
  // v16.8.3: отдельные refs для каждого типа системного input (Медиа, Камера,
  // Аудио, Документы, Контакт). Каждый имеет свой accept/capture.
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const audioRecordInputRef = useRef<HTMLInputElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const contactInputRef = useRef<HTMLInputElement>(null)
  // v16.9: moderation report target — opens ReportMessageDialog
  const [reportTarget, setReportTarget] = useState<{ open: boolean; messageId: string }>({ open: false, messageId: '' })
  const [contextMenu, setContextMenu] = useState<{
    open: boolean
    x: number
    y: number
    message: Message | null
  }>({ open: false, x: 0, y: 0, message: null })
  // v25.9: editing message — when set, the composer switches to edit mode
  // for the referenced message. The user can save (PATCH) or cancel.
  const [editingMessage, setEditingMessage] = useState<Message | null>(null)
  // When edit mode is entered, pre-fill the textarea with the message content
  // and focus it so the user can immediately start editing.
  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.content || '')
      setTimeout(() => {
        textareaRef.current?.focus()
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
        }
      }, 50)
    }
  }, [editingMessage])

  // Call state lives in the global CallManager (mounted in AppShell) so that
  // calls work from any view, not just chat. ChatView only triggers outgoing
  // calls via startOutgoingCall() — incoming call UI is rendered globally.

  // Image lightbox state
  const [lightbox, setLightbox] = useState<{ open: boolean; images: string[]; index: number }>({
    open: false,
    images: [],
    index: 0,
  })

  // Conversation menu (для удаления чата)
  const [convMenuOpen, setConvMenuOpen] = useState(false)
  // Phase 10: custom confirm dialog for delete conversation
  const [deleteConvOpen, setDeleteConvOpen] = useState(false)
  // Admin delete (hard-delete for everyone) — separate dialog with stronger
  // warning because it removes the chat for ALL participants.
  const [adminDeleteConvOpen, setAdminDeleteConvOpen] = useState(false)
  // Call history panel (collapsible, shown above messages)
  const [showCallHistory, setShowCallHistory] = useState(false)

  // Visual viewport tracking — keeps the chat container pinned to the
  // visible viewport (between status bar and keyboard) so the input field
  // stays glued above the keyboard, Telegram / WhatsApp style.
  //
  // WHY: On iOS Safari, when the soft keyboard opens, `window.innerHeight`
  // and `100dvh` do NOT shrink — the page stays the same height and the
  // keyboard overlays the bottom. `window.visualViewport.height` DOES shrink
  // to the visible area, and `visualViewport.offsetTop` reflects how far
  // down the visible viewport starts (0 when keyboard is closed; may shift
  // if the user scrolls while keyboard is open).
  //
  // BUG FIXED (previous implementation):
  //   Old code used `position: fixed; top: 0` + `height: visualViewport.height`.
  //   When the keyboard opened, height shrank but `top: 0` stayed — so the
  //   bottom of the container (the input bar) was lifted UP into the middle
  //   of the screen instead of staying just above the keyboard.
  //
  // NEW BEHAVIOR:
  //   `position: fixed; top: visualViewport.offsetTop; height: visualViewport.height`
  //   The container exactly covers the visible area. Input bar is the last
  //   flex child → it sits at the bottom of the visible area = directly
  //   above the keyboard. No jumping, no extra padding.
  //
  // KEYBOARD-OPEN DETECTION:
  //   When the soft keyboard opens, visualViewport.height shrinks by ~the
  //   keyboard height (usually 250-400px). We detect this by comparing
  //   visualViewport.height to window.innerHeight; if the difference is
  //   > 100px, the keyboard is considered open. This is used to disable
  //   `env(safe-area-inset-bottom)` padding on the input bar — when the
  //   keyboard is up, the Home Indicator area is already covered by the
  //   keyboard, so adding safe-area padding would create a visible gap
  //   between the input and the keyboard.
  const [viewport, setViewport] = useState<{ height: number | null; offsetTop: number }>({
    height: null,
    offsetTop: 0,
  })
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return
    const vv = window.visualViewport
    // DEBOUNCE: visualViewport fires `resize` and `scroll` events continuously
    // while the keyboard animates open/closed (~300ms, dozens of frames).
    // Without debouncing, every frame triggers setViewport + setKeyboardOpen
    // which re-renders the entire ChatView (including the messages list).
    // 100ms debounce is short enough to feel instant, long enough to skip
    // the in-between frames during the keyboard animation.
    let rafId = 0
    const update = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const h = vv.height
        const innerH = window.innerHeight
        setViewport({ height: h, offsetTop: vv.offsetTop })
        // Keyboard is open if the visible viewport is significantly smaller
        // than the layout viewport. 100px threshold filters out minor
        // fluctuations (URL bar show/hide in mobile Safari).
        setKeyboardOpen(innerH - h > 100)
      })
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [activeConv])

  // Lock body scroll while the active conversation is open on mobile.
  // Without this, iOS Safari will let the user drag the page underneath
  // v8-audit-fix: use useScrollLock instead of direct body.style manipulation.
  // Previously this bypassed the refcount in useScrollLock, causing conflicts
  // when CartSheet was open simultaneously.
  useScrollLock(!!activeConv)

  // v9-voice-final: listen for peer voice-recording CustomEvents. Any
  // future socket integration can dispatch these without touching this
  // component's props. The 'peer:voice-recording' event carries
  // { active: boolean, userId: string, username: string }.
  useEffect(() => {
    const onPeerVoice = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        active: boolean
        userId: string
        username: string
      }
      if (detail.active) {
        setPeerVoiceRecording({ userId: detail.userId, username: detail.username })
      } else {
        setPeerVoiceRecording(null)
      }
    }
    window.addEventListener('peer:voice-recording', onPeerVoice as EventListener)
    return () => window.removeEventListener('peer:voice-recording', onPeerVoice as EventListener)
  }, [])

  // v16.9: moderation — listen for 'message:blocked' events (when the system
  // blocks the user's outgoing message). Show a toast explaining why.
  useEffect(() => {
    const onMessageBlocked = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        tempId?: string
        reason: string
        severity: string
        categories: string[]
      }
      toast.error('Сообщение заблокировано модерацией', {
        description: detail.reason,
        duration: 6000,
      })
    }
    window.addEventListener('999pro:message-blocked', onMessageBlocked as EventListener)
    return () => window.removeEventListener('999pro:message-blocked', onMessageBlocked as EventListener)
  }, [toast])

  // Cleanup timers on unmount.
  // Voice recorder cleanup is handled by the useVoiceRecorder hook itself
  // (it has its own useEffect cleanup that stops MediaRecorder + clears
  // the interval timer).
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    }
  }, [])

  // Read unread counts from the global notifications store so the chat
  // list card badges update in real-time whenever a new message arrives
  // (even from another tab/view), and clear immediately when the user
  // opens the conversation.
  // SELECTOR OPTIMIZATION: previously subscribed to the entire
  // `s.unread.byConversation` object, which is rebuilt on EVERY message
  // arrival (the incrementUnread action spreads it into a new object).
  // That caused ChatView to re-render whenever ANY conversation received
  // a message — even if the user was in a different conversation and the
  // unread count for THEIR conversation didn't change.
  //
  // Now we subscribe only to the unread count for the ACTIVE conversation.
  // When the user opens a conversation, only changes to THAT conversation's
  // unread count trigger a re-render. The chat list cards (which DO need
  // all unread counts) are rendered by a separate child component that
  // subscribes to its own slice.
  //
  // v25.4 (perf audit P-2): kept the `useShallow` subscription but mitigated
  // the re-render cost by memoizing `ChatListItem` (P-1 fix). The subscription
  // is still needed because the chat list cards read per-conversation unread
  // counts from here. With `React.memo` on `ChatListItem` + stable callbacks,
  // only the cards whose props actually changed will re-render.
  const unreadForActive = useNotificationsStore((s) =>
    activeConv ? s.unread.byConversation[activeConv.id] ?? 0 : 0
  )
  const totalUnread = useNotificationsStore((s) => s.unread.total)
  void unreadForActive // subscribe-only
  void totalUnread // subscribe-only
  // unreadByConv is the map used by ChatListItem to render per-conversation badges.
  // F-HIGH-012: useShallow compares the map by reference equality of its
  // top-level keys — only re-renders this component when an unread count
  // actually changes, not on every unrelated store update (e.g. inAppToast
  // toggling). Without this, Zustand's default Object.is check on a freshly
  // returned `unread` object would re-render ChatView on every notification.
  const unreadByConv = useNotificationsStore(useShallow((s) => s.unread.byConversation))
  const clearUnread = useNotificationsStore((s) => s.clearUnread)
  const setUnread = useNotificationsStore((s) => s.setUnread)

  // Load conversations
  const refreshConversations = useCallback(() => {
    if (!authed) {
      setLoading(false)
      return
    }
    api
      .get<{ items: Conversation[] }>('/api/chat/conversations', { auth: true })
      .then((d) => setConversations(d.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [authed])

  useEffect(() => {
    refreshConversations()
    // v11-fix: drain any pending open-conversation request set by SmartShareSheet.
    // This fires when the user just sent a product to chat — SmartShareSheet sets
    // the pending ID BEFORE navigating to the chat view, so by the time ChatView
    // mounts, the ID is waiting here. We dispatch the open-conversation event
    // after a short delay so `conversations` state has time to populate first
    // (the refreshConversations call above is async).
    const pendingId = getPendingOpenConversation()
    if (pendingId) {
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('chat:open-conversation', { detail: { conversationId: pendingId } }),
        )
      }, 0)
    }
  }, [refreshConversations])

  // v10-badge: fetch unread counts from the backend on mount. This syncs
  // badges across devices and restores them after app reload (the local
  // notification store is NOT persisted, so without this fetch, badges
  // would reset to 0 on every page reload — even if the user has unread
  // messages from while they were offline).
  useEffect(() => {
    if (!authed) return
    api
      .get<{ byConversation: Record<string, number>; total: number }>('/api/chat/unread-counts', { auth: true })
      .then((d) => {
        setUnread(d.total, d.byConversation)
      })
      .catch(() => {})
  }, [authed, setUnread])

  // Load ALL users for the chat list (the unified source of truth — same on
  // desktop, Android PWA, iPhone PWA). This is what makes every registered
  // user discoverable in the chat list, not just those we already have a
  // conversation with.
  const refreshChatUsers = useCallback(() => {
    if (!authed) return
    setChatUsersLoading(true)
    api
      .get<{ users: any[] }>('/api/chat/users', { auth: true, query: { limit: 200 } })
      .then((d) => setChatUsers(d.users || []))
      .catch(() => setChatUsers([]))
      .finally(() => setChatUsersLoading(false))
  }, [authed])

  useEffect(() => {
    refreshChatUsers()
  }, [refreshChatUsers])

  // Search users — uses the SAME /api/chat/users endpoint (with ?q=) so the
  // search behaviour is identical to the chat list. No more separate
  // /api/users/search that could return different results.
  useEffect(() => {
    if (!search.trim()) {
      setSearchResults([])
      return
    }
    const t = setTimeout(() => {
      api
        .get<{ users: User[] }>('/api/chat/users', { query: { q: search.trim(), limit: 50 }, auth: true })
        .then((d) => setSearchResults(d.users || []))
        .catch(() => setSearchResults([]))
    }, 200)
    return () => clearTimeout(t)
  }, [search])

  // Load messages when active conversation changes (with alive flag for race safety)
  useEffect(() => {
    if (!activeConv) return
    let alive = true
    api
      .get<{ items: Message[] }>(`/api/chat/conversations/${activeConv.id}/messages`, {
        auth: true,
        query: { limit: 100 },
      })
      .then((d) => {
        if (alive) {
          // C-HIGH-006: rebuild dedup Set from the freshly-fetched page.
          // Replacing the Set wholesale (rather than `.clear()` + `.add()` in
          // a loop) avoids interim states where a late socket event could
          // see an empty Set and append a duplicate of a message that is
          // about to be rendered from the fetch response.
          messageIdsRef.current = new Set(d.items.map((m) => m.id))
          setMessages(d.items)
          // C-HIGH-002: reset the "has more" flag on conversation switch —
          // a fresh conversation may have older pages to load.
          hasMoreRef.current = true
          loadingOlderRef.current = false
          // При flex-col-reverse: scroll to top = показ последних сообщений
          requestAnimationFrame(() => {
            if (messagesContainerRef.current) {
              messagesContainerRef.current.scrollTop = 0
            }
          })
        }
      })
      .catch(() => {
        if (alive) {
          // C-HIGH-006: clear dedup Set alongside the messages array so the
          // next incoming socket event doesn't think a stale id is present.
          messageIdsRef.current.clear()
          setMessages([])
        }
      })
    // v10-stability: load saved draft for this conversation (crash recovery).
    // If the user was typing, crashed, and reopened the conversation, their
    // unsent text is restored.
    if (activeConv) {
      const draft = loadDraft(activeConv.id)
      if (draft) setText(draft)
      else setText('')
    }
    return () => {
      alive = false
    }
  }, [activeConv])

  // Socket.IO — message handlers (call events are handled globally by CallManager)
  const {
    isConnected, send, startTyping, stopTyping, startVoiceRecording, stopVoiceRecording, markRead,
    deleteMessage, editMessage, forwardMessage: socketForward,
  } = useSocket({
    conversationId: activeConv?.id,
    // v25.4 (chat audit GAP-1): always enable socket when authed so the
    // chat list updates in real-time even when no conversation is open.
    // Previously `enabled: !!activeConv && authed` caused the chat list to
    // go stale whenever the user was on the list view or in another section,
    // forcing a page refresh to see new messages.
    enabled: authed,
    onMessage: (m) => {
      if (activeConv && m.conversationId === activeConv.id) {
        // C-HIGH-006: O(1) dedup via the Set. We track both `id` and
        // `tempId` so the sender's optimistic stub (keyed by tempId) is
        // reconciled when the server-confirmed message arrives.
        const mTempId = m.tempId
        const hasId = messageIdsRef.current.has(m.id)
        const hasTemp = !!(mTempId && messageIdsRef.current.has(mTempId))
        // Always record both keys (idempotent on Set) so a later replay of
        // the same message (e.g. server-side re-broadcast) is still deduped.
        messageIdsRef.current.add(m.id)
        if (mTempId) messageIdsRef.current.add(mTempId)
        if (hasId || hasTemp) {
          setMessages((cur) =>
            cur.map((x) =>
              x.id === m.id || (mTempId && x.tempId === mTempId) ? { ...x, ...m } : x,
            ),
          )
        } else {
          setMessages((cur) => [...cur, m])
        }
        // Smooth scroll to bottom on new message
        requestAnimationFrame(() => {
          if (messagesContainerRef.current) { messagesContainerRef.current.scrollTop = 0; }
        })
        // Mark as read if it's from the other user and the chat is open
        if (m.senderId !== user?.id) {
          markRead(activeConv.id)
          // C-MED-006: announce the new message to screen readers via the
          // visually-hidden aria-live region near the message list.
          const senderName = m.sender?.displayName || m.sender?.username || 'Пользователь'
          const preview = m.content
            || (m.mediaType === 'image' ? 'Фото'
              : m.mediaType === 'audio' ? 'Голосовое сообщение'
              : m.mediaType === 'video' ? 'Видео'
              : m.mediaType === 'product' ? 'Товар'
              : m.mediaType ? 'Вложение'
              : '')
          setLastMessageAnnouncement(`Новое сообщение от ${senderName}: ${preview.slice(0, 100)}`)
        }
      } else {
        // New message in another conversation — update the conversation
        // list locally so the last message preview + sort order update
        // immediately, without waiting for the next refreshConervations call.
        setConversations((cur) => {
          const idx = cur.findIndex((c) => c.id === m.conversationId)
          if (idx === -1) {
            // Conversation not in the local list — refresh to fetch it
            refreshConversations()
            return cur
          }
          const updated = { ...cur[idx], lastMessage: {
            id: m.id,
            content: m.content,
            mediaUrl: m.mediaUrl,
            mediaType: m.mediaType,
            createdAt: m.createdAt,
            senderId: m.senderId,
            deletedForAll: false,
          }, updatedAt: m.createdAt }
          // Move to top
          const next = [updated, ...cur.filter((c) => c.id !== m.conversationId)]
          return next
        })
      }
    },
    onMessageDeleted: (payload) => {
      if (payload.deletedForMe) {
        // Removed for me only — filter it out from my view
        setMessages((cur) => cur.filter((m) => m.id !== payload.messageId))
      } else if (payload.deletedForAll) {
        // Removed for everyone — keep the bubble but mark as deleted
        setMessages((cur) =>
          cur.map((m) =>
            m.id === payload.messageId
              ? { ...m, deletedForAll: true, content: null, mediaUrl: null, mediaType: null, duration: null }
              : m,
          ),
        )
      }
    },
    // v25.9: edit support — when another participant (or our other tab) edits
    // a message, update it in place. The editedAt timestamp is included so the
    // message bubble can show an "изменено" indicator.
    onMessageEdited: (m) => {
      setMessages((cur) =>
        cur.map((x) =>
          x.id === m.id
            ? { ...x, ...m, editedAt: m.editedAt ?? new Date().toISOString() }
            : x,
        ),
      )
      // Also update the conversation list preview if this was the last message.
      setConversations((cur) =>
        cur.map((c) =>
          c.id === m.conversationId && c.lastMessage?.id === m.id
            ? { ...c, lastMessage: { ...c.lastMessage, content: m.content } }
            : c,
        ),
      )
    },
    onMessageForwarded: (payload) => {
      toast.success(`Переслано в ${payload.count} чат(ов)`)
      refreshConversations()
    },
    onTypingStart: (data) => {
      if (activeConv && data.conversationId === activeConv.id && data.userId !== user?.id) {
        setTyping({ userId: data.userId, username: data.username })
      }
    },
    onTypingStop: (data) => {
      if (activeConv && data.conversationId === activeConv.id) {
        setTyping(null)
      }
    },
    // v9-voice: peer voice recording indicators — when the peer starts/stop
    // recording, show/hide the prominent blue bar + ambient glow.
    onVoiceRecordingStart: (data) => {
      if (activeConv && data.conversationId === activeConv.id && data.userId !== user?.id) {
        setPeerVoiceRecording({ userId: data.userId, username: data.username })
      }
    },
    onVoiceRecordingStop: (data) => {
      if (activeConv && data.conversationId === activeConv.id) {
        setPeerVoiceRecording(null)
      }
    },
    onRead: (data) => {
      // v25.4 (chat audit GAP-3): only apply read receipts to the conversation
      // that was actually read. The backend broadcasts `message:read` to every
      // participant of the conversation, and the socket is auto-joined to ALL
      // the user's conversation rooms — so without this guard, opening
      // conversation Y would mark my messages in conversation X as read too.
      if (!data || !activeConv || data.conversationId !== activeConv.id) return
      setMessages((cur) => cur.map((m) => (m.senderId === user?.id ? { ...m, isRead: true } : m)))
    },
    // v25.4 (chat audit GAP-2): wire presence events so the online dot in
    // chat-list-item.tsx (c.participant?.isOnline) updates in real-time.
    // Previously these handlers were not passed, so presence only updated on
    // the next REST fetch.
    onUserOnline: (data) => {
      setConversations((cur) =>
        cur.map((c) =>
          c.participant?.id === data.userId
            ? { ...c, participant: { ...c.participant!, isOnline: true, lastSeen: new Date().toISOString() } }
            : c,
        ),
      )
      setChatUsers((cur) =>
        cur.map((u) => (u.id === data.userId ? { ...u, isOnline: true, lastSeen: new Date().toISOString() } : u)),
      )
    },
    onUserOffline: (data) => {
      setConversations((cur) =>
        cur.map((c) =>
          c.participant?.id === data.userId
            ? { ...c, participant: { ...c.participant!, isOnline: false, lastSeen: new Date().toISOString() } }
            : c,
        ),
      )
      setChatUsers((cur) =>
        cur.map((u) => (u.id === data.userId ? { ...u, isOnline: false, lastSeen: new Date().toISOString() } : u)),
      )
    },
    // v25.6 (chat sync): when someone creates a conversation WITH us, add it
    // to our chat list immediately so we can receive their messages without
    // a page refresh.
    onConversationCreated: (payload) => {
      if (!payload?.conversation) return
      const newConv = payload.conversation
      setConversations((cur) => {
        // Avoid duplicates — if we already have this conversation, skip.
        if (cur.some((c) => c.id === newConv.id)) return cur
        return [newConv, ...cur]
      })
    },
    // v25.9: when a conversation is hard-deleted (admin deleted it, or both
    // participants soft-deleted), remove it from the chat list immediately.
    onConversationDeleted: (payload) => {
      if (!payload?.conversationId) return
      setConversations((cur) => cur.filter((c) => c.id !== payload.conversationId))
      // If the deleted conversation was active, close it.
      if (activeConv?.id === payload.conversationId) {
        setActiveConv(null)
      }
    },
  })

  // Mark messages as read when opening a conversation
  useEffect(() => {
    if (activeConv && isConnected) {
      markRead(activeConv.id)
      // v10-fix: clear the local unread badge for this conversation.
      // Previously, markRead only updated the backend (isRead=true) but
      // never cleared the local notification store — so the badge stayed
      // even after the user read all messages.
      clearUnread(activeConv.id)
    }
  }, [activeConv, isConnected, markRead, clearUnread])

  // Broadcast the active conversation id to the rest of the app so the
  // notifications hook knows when the user is "inside" a conversation
  // (in which case new messages in that conversation should be silent —
  // no badge, no sound, no toast, no push). When the user leaves the
  // conversation (activeConv === null), we emit null so notifications
  // resume normally.
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent('chat:active-conversation', {
        detail: { conversationId: activeConv?.id || null },
      }),
    )
    return () => {
      // On unmount, clear the active conversation so notifications resume.
      window.dispatchEvent(
        new CustomEvent('chat:active-conversation', {
          detail: { conversationId: null },
        }),
      )
    }
  }, [activeConv])

  // Listen for chat:open-conversation events (fired when the user sends a
  // product to chat, clicks a push notification, or any other deep-link
  // source) — open the right conversation automatically.
  // v10.3-fix: if the conversation isn't in the local state yet (e.g. just
  // created), refresh the conversations list and try again. Previously,
  // newly-created conversations were silently ignored — the user stayed on
  // the chat list instead of seeing the conversation they just opened.
  useEffect(() => {
    const onOpen = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { conversationId?: string }
      if (!detail?.conversationId) return
      const targetId = detail.conversationId
      // Try to find in current conversations
      let conv = conversations.find((c) => c.id === targetId)
      if (conv) {
        setActiveConv(conv)
        return
      }
      // Not found — refresh conversations and try again. This handles the
      // case where the conversation was just created (e.g. product send to
      // a new recipient) and hasn't been fetched yet.
      try {
        const d = await api.get<{ items: Conversation[] }>('/api/chat/conversations', { auth: true })
        setConversations(d.items || [])
        conv = (d.items || []).find((c) => c.id === targetId)
        if (conv) {
          setActiveConv(conv)
        }
      } catch {
        // Refresh failed — can't open the conversation. The user stays on
        // the chat list, which is better than a blank screen.
      }
    }
    window.addEventListener('chat:open-conversation', onOpen as EventListener)
    return () => window.removeEventListener('chat:open-conversation', onOpen as EventListener)
     
  }, [conversations])

  // ====== Actions ======

  const handleStartConversation = async (participantId: string) => {
    try {
      const data = await api.post<{ conversation: Conversation }>('/api/chat/conversations', {
        json: { participantId },
        auth: true,
      })
      const exists = conversations.find((c) => c.id === data.conversation.id)
      if (!exists) {
        setConversations((cur) => [data.conversation, ...cur])
      }
      setActiveConv(data.conversation)
      setSearch('')
      setShowSearch(false)
      // Refresh the chat users list so the user we just started a conversation
      // with moves to the "Диалоги" section (and disappears from "Все
      // пользователи" to avoid duplication).
      refreshChatUsers()
    } catch (e: any) {
      toast.error(e.message || 'Не удалось начать диалог')
    }
  }

  const sendText = () => {
    if (!activeConv || !text.trim()) return
    const content = text.trim()

    // v25.9: edit mode — if editingMessage is set, call editMessage instead
    // of send. The backend validates ownership + 48h window + moderation,
    // then broadcasts `message:edited` to all participants. The local state
    // is updated via the onMessageEdited handler.
    if (editingMessage) {
      if (content === (editingMessage.content || '')) {
        // No change — just cancel.
        setEditingMessage(null)
        setText('')
        return
      }
      // Optimistic local update so the user sees the change immediately.
      setMessages((cur) =>
        cur.map((m) =>
          m.id === editingMessage.id
            ? { ...m, content, editedAt: new Date().toISOString() }
            : m,
        ),
      )
      editMessage(editingMessage.id, activeConv.id, content)
      setEditingMessage(null)
      setText('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      haptic.tap()
      return
    }

    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    // v16.2: Capture replyTo BEFORE clearing, then clear IMMEDIATELY so any
    // early-return or throw between here and the end of the function cannot
    // leave the reply panel open. The optimistic message + socket payload
    // use the captured value.
    const replyContext = replyTo
    setReplyTo(null)
    setText('')
    // Reset textarea height — without this the textarea stays expanded
    // after sending because onChange never fires when text is set to ''
    // programmatically. The height was set inline via style.height in onChange.
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    stopTyping(activeConv.id)

    const optimistic: Message = {
      id: tempId,
      conversationId: activeConv.id,
      senderId: user!.id,
      content,
      mediaType: 'text',
      isRead: false,
      createdAt: new Date().toISOString(),
      tempId,
      replyTo: replyContext
        ? {
            id: replyContext.id,
            content: replyContext.content,
            mediaUrl: replyContext.mediaUrl,
            mediaType: replyContext.mediaType,
            senderId: replyContext.senderId,
            sender: replyContext.sender,
          }
        : null,
      sender: {
        id: user!.id,
        username: user!.username,
        displayName: user!.displayName,
        avatar: user!.avatar,
      },
    }
    setMessages((cur) => [...cur, optimistic])
    // C-HIGH-006: track optimistic message's tempId so the server-confirmed
    // message (with a different real id) can reconcile this stub via tempId.
    messageIdsRef.current.add(tempId)
    requestAnimationFrame(() => {
      if (messagesContainerRef.current) { messagesContainerRef.current.scrollTop = 0; }
    })

    send({
      conversationId: activeConv.id,
      content,
      mediaType: 'text',
      tempId,
      replyToId: replyContext?.id,
    })
    messageSound.play()
    haptic.success() // v10-native: haptic on message send
    clearDraft(activeConv.id) // v10-stability: clear draft on successful send
  }

  const onTextChange = (v: string) => {
    setText(v)
    if (!activeConv) return
    // v10-stability: autosave draft for crash recovery.
    saveDraft(activeConv.id, v)
    const now = Date.now()
    if (now - lastTypingSentRef.current > 1500 && v.length > 0) {
      startTyping(activeConv.id)
      lastTypingSentRef.current = now
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => {
      stopTyping(activeConv.id)
    }, 1500)
  }

  // v16.9-final: insertEmoji — вставляет выбранный эмодзи в текущую позицию
  // курсора в textarea (или в конец, если курсор не активен). После вставки
  // возвращает фокус в textarea и пересчитывает высоту.
  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current
    if (!ta) {
      // Fallback: просто добавляем в конец
      onTextChange(text + emoji)
      return
    }
    const start = ta.selectionStart ?? text.length
    const end = ta.selectionEnd ?? text.length
    const next = text.slice(0, start) + emoji + text.slice(end)
    onTextChange(next)
    // Восстанавливаем курсор сразу после вставленного эмодзи
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const pos = start + emoji.length
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(pos, pos)
        // Пересчитываем высоту (эмодзи не вызывают onChange автоматически)
        textareaRef.current.style.height = 'auto'
        textareaRef.current.style.height =
          Math.min(textareaRef.current.scrollHeight, 120) + 'px'
      }
    })
  }

  // File upload input ref — shared between the hidden file input and the
  // paperclip button. The actual upload logic is in handleFileSelect below.
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Voice recording — extracted to useVoiceRecorder hook (stage 12 refactor).
  // All MediaRecorder logic, mime-type negotiation, upload, and cleanup now
  // live in src/components/chat/use-voice-recorder.ts. This file just calls
  // start/stop/cancel and renders the UI.
  const voiceRecorder = useVoiceRecorder({
    conversationId: activeConv?.id ?? null,
    user,
    replyToId: replyTo?.id ?? null,
    // v16.8-final: pass the current self-destruct timer so the recorder
    // stamps both the optimistic message and the socket payload.
    selfDestructMinutes,
    onSend: ({ tempId, mediaUrl, duration, selfDestructMinutes: sd, optimisticMessage }) => {
      setMessages((cur) => [...cur, optimisticMessage])
      // C-HIGH-006: track optimistic voice message's tempId for O(1) dedup.
      messageIdsRef.current.add(tempId)
      requestAnimationFrame(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = 0
        }
      })
      // v18.6: do NOT emit socket message:send here — the local blob: URL
      // is not reachable by the recipient. We wait for `onUploaded` to fire
      // with the real CDN URL, THEN emit the socket event. This means the
      // recipient sees the voice message ~1-3s later (after upload) instead
      // of getting a broken audio player pointing at a blob: URL they can't
      // access. The sender still sees their message instantly (optimistic).
      // Capture replyTo id BEFORE clearing — needed in onUploaded closure.
      pendingVoiceReplyRef.current = replyTo?.id ?? null
      void sd
      void mediaUrl
      void duration
      messageSound.play()
      setReplyTo(null)
    },
    onUploaded: (tempId, realUrl) => {
      // Upload finished — swap the local blob: URL for the real CDN URL on
      // the optimistic message, THEN emit the socket event so the recipient
      // gets a playable URL.
      setMessages((cur) =>
        cur.map((m) =>
          m.id === tempId
            ? { ...m, mediaUrl: realUrl, isUploading: undefined as any }
            : m,
        ),
      )
      const convId = activeConv?.id
      if (!convId) return
      // Look up the duration from the optimistic message we stored.
      setMessages((cur) => {
        const m = cur.find((x) => x.id === tempId)
        if (m) {
          send({
            conversationId: convId,
            mediaUrl: realUrl,
            mediaType: 'audio',
            duration: m.duration ?? undefined,
            tempId,
            // v18.6: pull the replyTo id from the ref we captured in onSend
            // (since replyTo state was cleared in onSend).
            replyToId: pendingVoiceReplyRef.current ?? undefined,
            selfDestructMinutes: selfDestructMinutes,
          })
          // Clear the ref AFTER we've used it.
          pendingVoiceReplyRef.current = null
        }
        return cur
      })
    },
    onUploadError: (tempId) => {
      // Mark the optimistic message as failed so the UI can show a retry button.
      setMessages((cur) =>
        cur.map((m) =>
          m.id === tempId
            ? { ...m, isUploading: undefined as any, uploadFailed: true as any }
            : m,
        ),
      )
    },
    onScrollToBottom: () => {
      requestAnimationFrame(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = 0
        }
      })
    },
  })
  const isRecording = voiceRecorder.isRecording
  const recordSeconds = voiceRecorder.recordSeconds
  // v9-voice: wrap recording start/stop/cancel to emit socket events so the
  // peer sees the "записывает голосовое сообщение…" indicator + ambient glow.
  const startRecording = useCallback(() => {
    voiceRecorder.start()
    if (activeConv) startVoiceRecording(activeConv.id)
  }, [voiceRecorder, activeConv, startVoiceRecording])
  const stopRecording = useCallback(() => {
    voiceRecorder.stop()
    if (activeConv) stopVoiceRecording(activeConv.id)
  }, [voiceRecorder, activeConv, stopVoiceRecording])
  const cancelRecording = useCallback(() => {
    voiceRecorder.cancel()
    if (activeConv) stopVoiceRecording(activeConv.id)
  }, [voiceRecorder, activeConv, stopVoiceRecording])

  // v9-voice: real-time mic amplitude — drives the organic waveform in the
  // recording panel + the ambient screen glow. Reads `voiceRecorder.stream`
  // (a MediaStream) and attaches an AnalyserNode. Returns a ref-backed
  // amplitude value (no per-frame re-renders).
  const micAmplitude = useMicAmplitude(voiceRecorder.stream)

  // C-HIGH-002 fix: infinite scroll — when the user scrolls close to the
  // top (oldest messages) of the flex-col-reverse container, fetch the
  // previous page of messages using cursor pagination (`?before=<oldestId>`).
  //
  // SCROLL MODEL: this container uses `flex flex-col-reverse`, which inverts
  // the scroll axis — `scrollTop=0` corresponds to the visual BOTTOM (latest
  // messages, the default open-chat view), and `scrollTop` increases as the
  // user scrolls UP towards older messages. `max scrollTop = scrollHeight -
  // clientHeight` corresponds to the visual TOP (oldest visible message).
  //
  // We trigger a fetch when the user is within ~1.5 viewports of the top.
  // After the fetch resolves, we prepend the older messages to the array
  // and restore the scroll position so the user's reading anchor doesn't
  // jump. The restoration math: in flex-col-reverse, prepending extends
  // the visual TOP of the content. The same visual position (looking at
  // the same message M) requires `scrollTop` to INCREASE by the added
  // content height (we move further "up" the inverted axis to reach M).
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el || loadingOlderRef.current || !hasMoreRef.current) return
    if (!activeConv) return
    const maxScrollTop = el.scrollHeight - el.clientHeight
    if (maxScrollTop <= 0) return
    const distanceFromTop = maxScrollTop - el.scrollTop
    if (distanceFromTop > el.clientHeight * 1.5) return

    const oldestId = messages[0]?.id
    if (!oldestId) return

    loadingOlderRef.current = true
    const prevScrollHeight = el.scrollHeight
    const prevScrollTop = el.scrollTop

    api
      .get<{ items: Message[]; hasMore?: boolean }>(
        `/api/chat/conversations/${activeConv.id}/messages`,
        { auth: true, query: { limit: 100, before: oldestId } },
      )
      .then((d) => {
        if (d.items.length === 0) {
          // No older messages — disable further fetches until conv switch.
          hasMoreRef.current = false
          return
        }
        // C-HIGH-006: register the older ids in the dedup Set so a late
        // socket replay doesn't re-append them.
        for (const m of d.items) messageIdsRef.current.add(m.id)
        // Prepend older messages (array is ascending — oldest first).
        setMessages((cur) => [...d.items, ...cur])
        // If backend reported hasMore=false, propagate it.
        if (d.hasMore === false) hasMoreRef.current = false
        // Restore scroll position: compensate for the added content height
        // so the user's visual anchor (the previously-oldest message) stays
        // in the same spot. requestAnimationFrame waits for the DOM to
        // reflect the prepended items before we measure the new height.
        requestAnimationFrame(() => {
          const el2 = messagesContainerRef.current
          if (!el2) return
          const addedHeight = el2.scrollHeight - prevScrollHeight
          el2.scrollTop = prevScrollTop + addedHeight
        })
      })
      .catch(() => {
        // Network error — leave hasMoreRef true so the user can retry by
        // scrolling again. Just clear the loading flag.
      })
      .finally(() => {
        loadingOlderRef.current = false
      })
  }, [activeConv, messages])

  // ====== Context menu actions ======
  // Phase 11.1: memoized with useCallback so React.memo on MessageBubble
  // works — without this, every chat.tsx re-render creates a new function
  // reference, causing all 100+ bubbles to re-render.
  const openContextMenu = useCallback((e: React.MouseEvent | React.TouchEvent, message: Message) => {
    e.preventDefault()
    let x: number, y: number
    if ('touches' in e && e.touches.length > 0) {
      x = e.touches[0].clientX
      y = e.touches[0].clientY
    } else if ('clientX' in e) {
      x = e.clientX
      y = e.clientY
    } else {
      x = 100
      y = 100
    }
    setContextMenu({ open: true, x, y, message })
  }, [])

  const handleReply = () => {
    if (contextMenu.message) {
      const msg = contextMenu.message
      setContextMenu((c) => ({ ...c, open: false }))
      setTimeout(() => setReplyTo(msg), 50)
    }
  }

  const handleForward = () => {
    if (contextMenu.message) {
      const msg = contextMenu.message
      // Close context menu FIRST, then open dialog on next tick.
      // Without this, Radix Dialog (z-50) opens behind the context menu
      // backdrop (z-99), which blocks all interaction — the UI "freezes".
      setContextMenu((c) => ({ ...c, open: false }))
      setTimeout(() => {
        setForwardMessage(msg)
        setForwardOpen(true)
      }, 50)
    }
  }

  const handleCopy = () => {
    if (contextMenu.message?.content) {
      const text = contextMenu.message.content
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          toast.success('✓ Текст скопирован', { duration: 2000 })
        }).catch(() => fallbackCopy(text))
      } else {
        fallbackCopy(text)
      }
    }
  }

  const fallbackCopy = (text: string) => {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      toast.success('✓ Текст скопирован', { duration: 2000 })
    } catch {
      toast.error('Не удалось скопировать')
    }
  }

  // v9-audit-fix: removed fake handleFavorite() — it showed a success toast
  // "Добавлено в избранное" but never called any API. The favorite was not
  // persisted anywhere, making this misleading UX. The "В избранное" item
  // is also removed from the MessageContextMenu below.

  const handleDeleteForMe = () => {
    if (!contextMenu.message || !activeConv) return
    deleteMessage(contextMenu.message.id, activeConv.id, false)
    setMessages((cur) => cur.filter((m) => m.id !== contextMenu.message!.id))
  }

  const handleDeleteForEveryone = () => {
    if (!contextMenu.message || !activeConv) return
    deleteMessage(contextMenu.message.id, activeConv.id, true)
    setMessages((cur) =>
      cur.map((m) =>
        m.id === contextMenu.message!.id
          ? { ...m, deletedForAll: true, content: null, mediaUrl: null, mediaType: null, duration: null }
          : m,
      ),
    )
  }

  const handleInfo = () => {
    if (contextMenu.message) {
      toast.info(`Отправлено: ${formatTime(contextMenu.message.createdAt)} · ${timeAgo(contextMenu.message.createdAt)}`)
    }
  }

  // Forward confirmed — emit via socket
  const handleForwardSubmit = (targetIds: string[]) => {
    if (!forwardMessage) return
    socketForward(forwardMessage.id, targetIds)
  }

  // Scroll to a specific message (used when clicking a reply target).
  // v16.8 final: красивая highlight-анимация вместо простого ring.
  // Добавляет CSS-класс `message-highlight-pulse` на 2 секунды —
  // браузер анимирует мягкое свечение + scale pulse. Анимация
  // определяется в globals.css через @keyframes.
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const scrollToMessage = useCallback((id: string) => {
    const el = messageRefs.current.get(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // Снимаем предыдущий highlight если был
      el.classList.remove('message-highlight-pulse')
      // Принудительно trigger reflow чтобы анимация перезапустилась
      // (иначе повторный click на тот же reply-target не воспроизведёт анимацию)
      void el.offsetWidth
      el.classList.add('message-highlight-pulse')
      setTimeout(() => {
        el.classList.remove('message-highlight-pulse')
      }, 2000)
    } else {
      toast.info('Сообщение вне загруженного диапазона')
    }
  }, [])

  // ====== Call actions ======
  // Запускает исходящий звонок через глобальный CallManager (см. app-shell.tsx).
  // CallManager монтирован глобально — он поймает событие call:start-outgoing
  // и инициализирует WebRTC + socket-сигналинг.
  const handleStartCall = (type: 'audio' | 'video') => {
    if (!activeConv || !activeConv.participant) {
      toast.error('Не удалось начать звонок — собеседник не найден')
      return
    }
    startOutgoingCall(activeConv, type)
  }

  // ====== Delete conversation ======
  // Support conversations cannot be deleted — they are the pinned admin ↔
  // user channel. The backend also enforces this (returns 400), but we
  // block it client-side too so the user never sees an error toast.
  const handleDeleteConversation = async () => {
    if (!activeConv) return
    if (activeConv.type === 'support') {
      toast.error('Нельзя удалить чат с поддержкой — это основной канал связи с командой 999PRO.')
      return
    }
    // Phase 10: use custom confirm dialog instead of native confirm()
    setDeleteConvOpen(true)
  }

  const confirmDeleteConversation = async () => {
    if (!activeConv) return
    setDeleteConvOpen(false)
    try {
      await api.delete(`/api/chat/conversations/${activeConv.id}`, { auth: true })
      setConversations((cur) => cur.filter((c) => c.id !== activeConv.id))
      setActiveConv(null)
      setMessages([])
      toast.success('Диалог удалён')
    } catch (e: any) {
      toast.error('Не удалось удалить диалог: ' + (e.message || ''))
    }
  }

  // ====== Admin delete conversation (hard-delete for everyone) ======
  // Admins can completely delete ANY conversation (including support chats)
  // via DELETE /api/chat/admin/conversations/:id. This removes the chat for
  // ALL participants, not just the admin. Use with caution.
  const handleAdminDeleteConversation = async () => {
    if (!activeConv) return
    if (!user || user.role !== 'admin') {
      toast.error('Только администратор может полностью удалить чат')
      return
    }
    // Use the custom confirm dialog — same as user delete, but calls
    // the admin endpoint.
    setAdminDeleteConvOpen(true)
  }

  const confirmAdminDeleteConversation = async () => {
    if (!activeConv) return
    setAdminDeleteConvOpen(false)
    try {
      await api.delete(`/api/chat/admin/conversations/${activeConv.id}`, { auth: true })
      setConversations((cur) => cur.filter((c) => c.id !== activeConv.id))
      setActiveConv(null)
      setMessages([])
      toast.success('Чат полностью удалён для всех участников')
    } catch (e: any) {
      toast.error('Не удалось удалить чат: ' + (e.message || ''))
    }
  }

  // ====== Open image in lightbox ======
  // v12: collect images from BOTH single-image messages (mediaType='image')
  // AND attachment groups (attachments with type='image'). This gives a
  // unified gallery across all photos in the conversation — the user can
  // swipe freely between photos from different messages.
  const openLightbox = useCallback((imageUrl: string) => {
    const allImages: string[] = []
    messages.forEach((m) => {
      // Single-image message
      if (m.mediaType === 'image' && m.mediaUrl) {
        allImages.push(m.mediaUrl)
      }
      // Attachment group — extract all image-type attachments
      if (m.attachments && m.attachments.length > 0) {
        m.attachments.forEach((a) => {
          if (a.type === 'image' && a.url) allImages.push(a.url)
        })
      }
    })
    const idx = allImages.indexOf(imageUrl)
    setLightbox({
      open: true,
      images: allImages.length > 0 ? allImages : [imageUrl],
      index: idx >= 0 ? idx : 0,
    })
  }, [messages])

  // ====== File upload (images + documents) — v12: multi-file support ======
  // When the user selects multiple files, they are uploaded in parallel and
  // sent as a SINGLE message with an `attachments` array. This creates a
  // beautiful grouped card (e.g. "📷 12 фотографий") instead of 12 separate
  // messages. The recipient sees one card and can open the full gallery.
  //
  // Single-file selection still uses the legacy mediaUrl/mediaType path for
  // backward compatibility (existing messages don't have attachments).
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0 || !activeConv) return
    const fileArray = Array.from(files)

    // v25.10 (chat video): re-enabled video uploads in chat.
    // Previously (v20) video was blocked with a "temporary" toast. The
    // backend has always supported video — the upload route accepts
    // video/* MIME types, and the message schema accepts
    // mediaType:'video' / attachments[].type:'video'. The chat attachment
    // extraction hooks (use-chat-attachments.ts) + the videos-list
    // full-screen player (videos-list.tsx) were already shipped and
    // working for any historical video message — only the SEND path was
    // blocked. We now send video with a 50MB per-file guard.
    const CHAT_VIDEO_MAX_BYTES = 50 * 1024 * 1024 // 50MB
    const isVideoFile = (f: File) =>
      f.type.startsWith('video/') ||
      /\.(mp4|mov|avi|mkv|webm|m4v|3gp|flv|wmv|mpeg|mpg|m2ts|ts)$/i.test(f.name)
    const oversizedVideo = fileArray.find((f) => isVideoFile(f) && f.size > CHAT_VIDEO_MAX_BYTES)
    if (oversizedVideo) {
      toast.error(`Видео слишком большое (макс. 50 МБ): ${oversizedVideo.name}`)
      if (e.target) e.target.value = ''
      return
    }

    // SINGLE FILE — use the legacy path (mediaUrl + mediaType) for backward compat
    if (fileArray.length === 1) {
      const file = fileArray[0]
      const formData = new FormData()
      let fileToUpload: File = file
      if (file.type.startsWith('image/') && !file.type.includes('gif')) {
        try {
          fileToUpload = await compressImage(file)
        } catch {
          fileToUpload = file
        }
      }
      formData.append('file', fileToUpload)
      try {
        const data = await api.post<{ url: string }>('/api/upload', { form: formData, auth: true })
        const tempId = `tmp_${Date.now()}`
        let mediaType: 'image' | 'video' | 'audio' | 'file' = 'file'
        if (file.type.startsWith('image/')) mediaType = 'image'
        else if (file.type.startsWith('video/')) mediaType = 'video'
        else if (file.type.startsWith('audio/')) mediaType = 'audio'
        // v16.8.9: fallback по расширению — iOS часто возвращает пустой
        // file.type для аудио из Files/Voice Memos. Без этого аудио
        // отправлялось как 'file' (документ) и не попадало в категорию "Музыка".
        else if (/\.(mp3|m4a|aac|wav|ogg|flac|opus|wma)$/i.test(file.name)) mediaType = 'audio'
        else if (/\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(file.name)) mediaType = 'video'
        else if (/\.(jpg|jpeg|png|gif|webp|avif|heic|heif)$/i.test(file.name)) mediaType = 'image'

        setMessages((cur) => [
          ...cur,
          {
            id: tempId,
            conversationId: activeConv.id,
            senderId: user!.id,
            content: null,
            mediaUrl: data.url,
            mediaType,
            isRead: false,
            createdAt: new Date().toISOString(),
            tempId,
            sender: {
              id: user!.id,
              username: user!.username,
              displayName: user!.displayName,
              avatar: user!.avatar,
            },
          },
        ])
        messageIdsRef.current.add(tempId)
        requestAnimationFrame(() => {
          if (messagesContainerRef.current) { messagesContainerRef.current.scrollTop = 0; }
        })
        send({
          conversationId: activeConv.id,
          mediaUrl: data.url,
          mediaType,
          tempId,
          replyToId: replyTo?.id,
        })
        messageSound.play()
        setReplyTo(null)
      } catch {
        toast.error('Не удалось загрузить файл')
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
      return
    }

    // MULTIPLE FILES — upload all in parallel, then send as ONE message with attachments
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    try {
      // Upload all files in parallel (max 30 files per message)
      const filesToUpload = fileArray.slice(0, 30)
      const uploadResults = await Promise.all(
        filesToUpload.map(async (file) => {
          let fileToUpload: File = file
          if (file.type.startsWith('image/') && !file.type.includes('gif')) {
            try {
              fileToUpload = await compressImage(file)
            } catch {
              fileToUpload = file
            }
          }
          const formData = new FormData()
          formData.append('file', fileToUpload)
          const data = await api.post<{ url: string }>('/api/upload', { form: formData, auth: true })

          // Determine type — v16.8.9: fallback по расширению для iOS
          let type: 'image' | 'video' | 'audio' | 'file' = 'file'
          if (file.type.startsWith('image/')) type = 'image'
          else if (file.type.startsWith('video/')) type = 'video'
          else if (file.type.startsWith('audio/')) type = 'audio'
          else if (/\.(mp3|m4a|aac|wav|ogg|flac|opus|wma)$/i.test(file.name)) type = 'audio'
          else if (/\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(file.name)) type = 'video'
          else if (/\.(jpg|jpeg|png|gif|webp|avif|heic|heif)$/i.test(file.name)) type = 'image'

          return {
            url: data.url,
            type,
            name: file.name,
            size: file.size,
          }
        }),
      )

      // Add optimistic message with attachments
      setMessages((cur) => [
        ...cur,
        {
          id: tempId,
          conversationId: activeConv.id,
          senderId: user!.id,
          content: null,
          mediaUrl: null,
          mediaType: null,
          attachments: uploadResults,
          isRead: false,
          createdAt: new Date().toISOString(),
          tempId,
          sender: {
            id: user!.id,
            username: user!.username,
            displayName: user!.displayName,
            avatar: user!.avatar,
          },
        },
      ])
      messageIdsRef.current.add(tempId)
      requestAnimationFrame(() => {
        if (messagesContainerRef.current) { messagesContainerRef.current.scrollTop = 0; }
      })

      // Send via socket — includes attachments array
      // v13.2 (audit P1-7 fix): removed `as any` cast — the send() type
      // signature already supports attachments. The cast was bypassing
      // type-checking and could hide bugs if the payload shape drifted.
      send({
        conversationId: activeConv.id,
        attachments: uploadResults,
        tempId,
        replyToId: replyTo?.id,
      })
      messageSound.play()
      setReplyTo(null)

      // Toast feedback
      const counts: Record<string, number> = {}
      uploadResults.forEach((a) => { counts[a.type] = (counts[a.type] || 0) + 1 })
      const parts: string[] = []
      if (counts.image) parts.push(`${counts.image} фото`)
      if (counts.video) parts.push(`${counts.video} видео`)
      if (counts.file) parts.push(`${counts.file} документ(ов)`)
      if (counts.audio) parts.push(`${counts.audio} аудио`)
      toast.success(`Отправлено: ${parts.join(', ')}`)
    } catch {
      toast.error('Не удалось загрузить файлы')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // v16.8.3: generic handler — reuses handleFileSelect for any input ref.
  // Each system picker (Медиа/Камера/Аудио/Документы/Контакт) calls this.
  const handleTypedFileSelect = (ref: React.RefObject<HTMLInputElement | null>) => {
    return async (e: React.ChangeEvent<HTMLInputElement>) => {
      await handleFileSelect(e)
      if (ref.current) ref.current.value = ''
    }
  }

  // v16.8.3: отправка товара в чат (как product-сообщение).
  const handleSendProduct = (product: { id: string; title?: string }) => {
    if (!activeConv) return
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    setMessages((cur) => [
      ...cur,
      {
        id: tempId,
        conversationId: activeConv.id,
        senderId: user!.id,
        content: null,
        mediaUrl: product.id, // product id is stored in mediaUrl for product messages
        mediaType: 'product',
        isRead: false,
        createdAt: new Date().toISOString(),
        tempId,
        sender: {
          id: user!.id,
          username: user!.username,
          displayName: user!.displayName,
          avatar: user!.avatar,
        },
      },
    ])
    messageIdsRef.current.add(tempId)
    requestAnimationFrame(() => {
      if (messagesContainerRef.current) { messagesContainerRef.current.scrollTop = 0; }
    })
    send({
      conversationId: activeConv.id,
      mediaUrl: product.id,
      mediaType: 'product',
      tempId,
      replyToId: replyTo?.id,
    })
    messageSound.play()
    setReplyTo(null)
  }

  // v16.9.2: отправка аудио-трека Audio Hub в чат (как audio-hub сообщение).
  // v16.19: mediaUrl хранит ПОЛНЫЙ track объект как JSON (а не только ID).
  // Это позволяет AudioChatCard сразу отображать метаданные без запроса на
  // backend. Старые сообщения (с ID) продолжат работать через /track/:id fallback.
  const handleSendAudioHubTrack = (track: AudioHubTrack) => {
    if (!activeConv) return
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    // Сериализуем полный track объект в JSON строку.
    const trackJson = JSON.stringify(track)
    setMessages((cur) => [
      ...cur,
      {
        id: tempId,
        conversationId: activeConv.id,
        senderId: user!.id,
        content: null,
        mediaUrl: trackJson,
        mediaType: 'audio-hub',
        isRead: false,
        createdAt: new Date().toISOString(),
        tempId,
        sender: {
          id: user!.id,
          username: user!.username,
          displayName: user!.displayName,
          avatar: user!.avatar,
        },
      },
    ])
    messageIdsRef.current.add(tempId)
    requestAnimationFrame(() => {
      if (messagesContainerRef.current) { messagesContainerRef.current.scrollTop = 0; }
    })
    send({
      conversationId: activeConv.id,
      mediaUrl: trackJson,
      mediaType: 'audio-hub',
      tempId,
      replyToId: replyTo?.id,
    })
    messageSound.play()
    setReplyTo(null)
  }

  // v17: отправка фильма Video Hub в чат (как film сообщение).
  // mediaUrl хранит полный FilmChatCardData объект как JSON — карточка в чате
  // отображает постер/название/длительность без запроса на backend.
  // Клик по карточке открывает встроенный Video Hub screen.
  // v18.12: admin-only — non-admins can't send films (Video Hub is locked).
  const handleSendFilm = (film: FilmDetails) => {
    if (!activeConv) return
    // v18.12: check role — only admins can send films.
    const role = useAuthStore.getState().user?.role
    if (role !== 'admin') {
      toast.info('Video Hub скоро будет доступен. Раздел в разработке.')
      return
    }
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const cardData: FilmChatCardData = {
      id: film.id,
      title: film.title,
      year: film.year,
      posterUrl: film.posterUrl,
      duration: null,
      description: film.description,
      isSeries: film.isSeries,
      sourceId: film.sourceId,
      sourceName: film.sourceName,
    }
    const filmJson = JSON.stringify(cardData)
    setMessages((cur) => [
      ...cur,
      {
        id: tempId,
        conversationId: activeConv.id,
        senderId: user!.id,
        content: null,
        mediaUrl: filmJson,
        mediaType: 'film',
        isRead: false,
        createdAt: new Date().toISOString(),
        tempId,
        sender: {
          id: user!.id,
          username: user!.username,
          displayName: user!.displayName,
          avatar: user!.avatar,
        },
      },
    ])
    messageIdsRef.current.add(tempId)
    requestAnimationFrame(() => {
      if (messagesContainerRef.current) { messagesContainerRef.current.scrollTop = 0; }
    })
    send({
      conversationId: activeConv.id,
      mediaUrl: filmJson,
      mediaType: 'film',
      tempId,
      replyToId: replyTo?.id,
    })
    messageSound.play()
    setReplyTo(null)
  }

  // v16.8.3: отфильтрованные сообщения по активной категории.
  // memoized — ре-вычисление только при изменении messages / activeCategory / favorites.
  const chatAttachments = useChatAttachments(messages)
  const filteredMessages = useMemo(() => {
    if (activeCategory === 'all') return messages
    if (activeCategory === 'favorites') {
      return messages.filter((m) => favorites.isFavorite(m.id))
    }
    // Для остальных категорий — фильтруем по типу контента.
    const idsByCat: Record<string, Set<string>> = {
      photos: new Set(chatAttachments.photos.map((p) => p.messageId)),
      videos: new Set(chatAttachments.videos.map((v) => v.messageId)),
      music: new Set(chatAttachments.music.map((m) => m.messageId)),
      voices: new Set(chatAttachments.voices.map((v) => v.messageId)),
      documents: new Set(chatAttachments.documents.map((d) => d.messageId)),
      links: new Set(chatAttachments.links.map((l) => l.messageId)),
      products: new Set(chatAttachments.products.map((p) => p.messageId)),
      'audio-hub': new Set(chatAttachments.audioHub.map((a) => a.messageId)),
    }
    const idSet = idsByCat[activeCategory]
    if (!idSet || idSet.size === 0) return []
    return messages.filter((m) => idSet.has(m.id))
  }, [messages, activeCategory, chatAttachments, favorites])
  const reversedFilteredMessages = useMemo(() => [...filteredMessages].reverse(), [filteredMessages])

  // ====== Render ======

  if (!isInitialized) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  // v25.9.3: REMOVE the hard "login required" gate. The chat UI now renders
  // for everyone. If the user is not authenticated, we show a soft inline
  // login prompt at the top of the chat list instead of blocking the whole
  // view. This fixes the user's complaint: "I can't even open chat without
  // registering!" — now they can open it, browse the support info, and
  // choose to log in when they're ready to send a message.
  // The backend still requires auth for actual message send/receive, so
  // anonymous users can't spam — they just see the UI shell.

  return (
    <div className={cn(
      'relative',
      // На мобильном в активном чате: fixed overlay, приклеенный к видимой
      // области (visualViewport). На десктопе — обычный static контейнер.
      // Top + height задаются inline через visualViewport, см. комментарий выше.
      // overscroll-behavior: contain — критично: без этого при прокрутке
      // чата до границы вся страница под ним начинает двигаться. С этим
      // свойством scroll "съедается" внутри контейнера и не передаётся
      // родителю. Также блокируем touch-action на body когда чат открыт,
      // чтобы iPhone не пытался прокрутить страницу под fixed overlay.
      activeConv
        ? 'fixed left-0 right-0 z-[60] bg-background overflow-hidden md:static md:z-auto md:overflow-visible md:page-top-padding'
        : 'pb-28 md:pb-0 page-top-padding'
    )}
    style={
      activeConv
        ? {
            top: `${viewport.offsetTop}px`,
            height: viewport.height ? `${viewport.height}px` : '100dvh',
            overscrollBehavior: 'contain',
            // v16.8.7: ИСПРАВЛЕНИЕ горизонтального скролла категорий.
            // Раньше было touchAction: 'none' — это блокировало ВСЕ touch-
            // жесты на wrapper, и CSS touch-action на детях (categories pan-x,
            // messages pan-y) НЕ работали, т.к. touch-action — это ПЕРЕСЕЧЕНИЕ
            // всех родительских значений. none ∩ pan-x = none.
            // Теперь pan-x pan-y: разрешает оба направления. Messages container
            // ниже имеет pan-y (только вертикаль), categories — pan-x pan-y.
            // overscrollBehavior: 'contain' предотвращает rubber-band на iOS.
            touchAction: 'pan-x pan-y',
          }
        : undefined
    }
    >
      {/* Animated decorative background — floating SVG shapes, "999PRO" text,
          soft coloured circles. pointer-events:none, z-0. */}
      <ChatBackground />
      {/* v25.12: chat uses full viewport height on mobile (h-[100dvh]) to
          bypass the .app-main padding-top. The chat manages its own internal
          layout (header + search + message list + input bar). On desktop,
          h-[calc(100vh-6rem)] leaves room for the TopBar. */}
      <div className="relative z-10 flex flex-col md:flex-row gap-0 md:gap-4 px-0 md:px-6 py-0 md:py-4 h-[100dvh] md:h-[calc(100vh-6rem)] overflow-hidden">
        {/* Sidebar: conversation list — min-h-0 для скролла списка */}
        <div className={cn(
          'md:w-80 shrink-0 flex flex-col gap-3 px-4 md:px-0 pt-4 md:pt-0 min-h-0',
          activeConv && 'hidden md:flex'
        )}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setShowSearch(true)}
              placeholder="Поиск пользователей…"
              className="pl-10 rounded-2xl"
            />
          </div>

          {showSearch && search.trim().length >= 1 ? (
            <div className="flex-1 overflow-y-auto space-y-1">
              <div className="text-xs text-muted-foreground px-2 py-1">Результаты поиска</div>
              {searchResults.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8">Ничего не найдено</div>
              ) : (
                searchResults.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => handleStartConversation(u.id)}
                    className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-accent/40 transition-colors text-left"
                  >
                    <Avatar>
                      <AvatarImage src={assetUrl(u.avatar)} />
                      <AvatarFallback>{initials(u.displayName || u.username)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{u.displayName || u.username}</div>
                      <div className="text-xs text-muted-foreground truncate">@{u.username}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-3 scrollbar-premium pb-4">
              <div className="text-xs font-semibold text-muted-foreground px-2 py-1 uppercase tracking-wider">Диалоги</div>
              {/* v25.9.9: REMOVED the "Войдите, чтобы общаться" login prompt.
                  The user explicitly complained about seeing this even when
                  logged in as admin. Now the chat list is shown to everyone.
                  If the user is not authenticated, the chat list will simply
                  be empty (backend returns 401 for /api/chat/conversations
                  without auth, which is handled silently). The user can open
                  the auth dialog from the Profile button in the nav. */}
              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-20 rounded-[28px] skeleton" />
                  ))}
                </div>
              ) : conversations.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <div className="text-4xl mb-2">💬</div>
                  <p className="text-sm text-muted-foreground mb-1">У вас пока нет диалогов.</p>
                  <p className="text-xs text-muted-foreground/70">Выберите пользователя ниже, чтобы начать чат.</p>
                </div>
              ) : (
                conversations.map((c) => {
                  // Unread = max(server-provided count, local notification store count).
                  const serverUnread = c.unreadCount && c.unreadCount > 0 ? c.unreadCount : 0
                  const localUnread = unreadByConv[c.id] || 0
                  const unread = Math.max(serverUnread, localUnread)
                  const isActive = activeConv?.id === c.id
                  return (
                    <ChatListItem
                      key={c.id}
                      conversation={c}
                      unread={unread}
                      isActive={isActive}
                      onClick={handleConvClick}
                      onLongPress={handleConvLongPress}
                      convId={c.id}
                    />
                  )
                })
              )}

              {/* ====== All registered users (unified source of truth) ======
                  Backend now applies privacy:
                    - Admin caller sees ALL users.
                    - Regular caller sees ONLY admins + existing 1-on-1
                      conversation partners (so they can reach support and
                      their existing contacts — NOT strangers).
                  Users we already have a conversation with are hidden here
                  (they appear in the "Диалоги" section above) to avoid
                  duplication. The admin is ALWAYS pinned first with a
                  distinct gradient card + "Поддержка" badge. */}
              {(() => {
                // Build a set of user IDs that already have a conversation in
                // the list above, so we don't show them twice.
                const conversationUserIds = new Set(
                  conversations
                    .filter((c) => c.type !== 'support')
                    .map((c) => c.participant?.id)
                    .filter(Boolean) as string[],
                )
                const otherUsers = chatUsers.filter((u) => !conversationUserIds.has(u.id))

                if (chatUsersLoading && chatUsers.length === 0) {
                  return (
                    <div className="pt-4">
                      <div className="text-xs font-semibold text-muted-foreground px-2 py-1 uppercase tracking-wider">
                        Контакты
                      </div>
                      <div className="space-y-2">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <div key={i} className="h-14 rounded-2xl skeleton" />
                        ))}
                      </div>
                    </div>
                  )
                }

                if (otherUsers.length === 0) return null

                // Split: support (admins) first, then regular users.
                // Backend already sorts admins first, but we re-sort here
                // to be defensive against future ordering changes.
                const supportUsers = otherUsers.filter((u) => u.isSupport)
                const regularUsers = otherUsers.filter((u) => !u.isSupport)

                return (
                  <div className="pt-4">
                    <div className="text-xs font-semibold px-2 py-1 uppercase tracking-wider flex items-center justify-between text-muted-foreground">
                      <span>Контакты</span>
                      <span className="text-[10px] font-normal opacity-70">{otherUsers.length}</span>
                    </div>
                    <div className="space-y-1">
                      {/* ===== Support / Admin cards — голубой pastel glass ===== */}
                      {supportUsers.map((u, idx) => (
                        <button
                          key={u.id}
                          onClick={() => handleStartConversation(u.id)}
                          className="animate-card-in w-full text-left rounded-2xl p-3 transition-transform duration-200 hover:scale-[1.01]"
                          style={{
                            animationDelay: `${idx * 30}ms`,
                            background: 'linear-gradient(135deg, rgba(96, 165, 250, 0.12) 0%, rgba(59, 130, 246, 0.06) 100%)',
                            backdropFilter: 'blur(12px)',
                            WebkitBackdropFilter: 'blur(12px)',
                            border: '1px solid rgba(96, 165, 250, 0.2)',
                            boxShadow: '0 2px 8px -2px rgba(96, 165, 250, 0.12)',
                          }}
                        >
                          <div className="relative flex items-center gap-3">
                            <div className="relative shrink-0">
                              <Avatar className="h-10 w-10" style={{ boxShadow: '0 0 0 2px rgba(96, 165, 250, 0.3)' }}>
                                <AvatarImage src={assetUrl(u.avatar)} />
                                <AvatarFallback
                                  className="text-white font-bold text-sm"
                                  style={{ background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)' }}
                                >
                                  {initials(u.displayName || u.username)}
                                </AvatarFallback>
                              </Avatar>
                              {u.isOnline && (
                                <div
                                  className="absolute bottom-0 right-0 h-2 w-2 rounded-full border-2 bg-emerald-500"
                                  style={{ borderColor: 'var(--background)', boxShadow: '0 0 6px rgba(16, 185, 129, 0.6)' }}
                                />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-bold truncate text-foreground">
                                  {u.displayName || u.username}
                                </span>
                                <span
                                  className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider text-white"
                                  style={{ background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)' }}
                                >
                                  <Headphones className="h-2.5 w-2.5" />
                                  Поддержка
                                </span>
                              </div>
                              <div className="text-xs truncate text-muted-foreground">
                                @{u.username}
                                {u.isOnline ? ' · онлайн' : u.lastSeen ? ` · ${timeAgo(new Date(u.lastSeen))}` : ''}
                              </div>
                            </div>
                            <div className="shrink-0 text-[10px] font-semibold px-2 py-1 rounded-full text-blue-500" style={{ background: 'rgba(59, 130, 246, 0.12)' }}>
                              Написать
                            </div>
                          </div>
                        </button>
                      ))}

                      {/* ===== Regular users — pastel glass per user ===== */}
                      {regularUsers.map((u, idx) => {
                        const palette = getChatCardPalette(u.id)
                        return (
                          <button
                            key={u.id}
                            onClick={() => handleStartConversation(u.id)}
                            className="animate-card-in w-full text-left rounded-2xl p-3 transition-transform duration-200 hover:scale-[1.01]"
                            style={{
                              animationDelay: `${(idx + supportUsers.length) * 30}ms`,
                              background: palette.bg,
                              backdropFilter: 'blur(12px)',
                              WebkitBackdropFilter: 'blur(12px)',
                              border: `1px solid ${palette.solid}1a`,
                              boxShadow: `0 2px 8px -2px rgba(0,0,0,0.06)`,
                            }}
                          >
                            <div className="relative flex items-center gap-3">
                              <div className="relative shrink-0">
                                <Avatar className="h-10 w-10" style={{ boxShadow: `0 0 0 2px ${palette.ring}44` }}>
                                  <AvatarImage src={assetUrl(u.avatar)} />
                                  <AvatarFallback
                                    className="text-white font-bold text-sm"
                                    style={{ background: `linear-gradient(135deg, ${palette.ring} 0%, ${palette.solid} 100%)` }}
                                  >
                                    {initials(u.displayName || u.username)}
                                  </AvatarFallback>
                                </Avatar>
                                {u.isOnline && (
                                  <div
                                    className="absolute bottom-0 right-0 h-2 w-2 rounded-full border-2 bg-emerald-500"
                                    style={{ borderColor: 'var(--background)', boxShadow: '0 0 6px rgba(16, 185, 129, 0.6)' }}
                                  />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-bold truncate text-foreground">
                                  {u.displayName || u.username}
                                </div>
                                <div className="text-xs truncate text-muted-foreground">
                                  @{u.username}
                                  {u.isOnline ? ' · онлайн' : u.lastSeen ? ` · ${timeAgo(new Date(u.lastSeen))}` : ''}
                                </div>
                              </div>
                              <div className="shrink-0 text-[10px] font-semibold px-2 py-1 rounded-full text-muted-foreground" style={{ background: `${palette.solid}1a` }}>
                                Написать
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}
        </div>

        {/* Main: active conversation */}
        {activeConv ? (
          // min-h-0 — КРИТИЧНО для flex children: без этого flex-1 ребёнок
          // не может сжаться меньше своего контента, и overflow-y-auto не работает.
          // overflow-hidden — чтобы контейнер обрезал сообщения, а не рос вниз.
          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden md:rounded-3xl md:overflow-hidden">
            {/* v16.8.5: Header — back слева, имя+статус по центру, аватар справа.
                Имя — центральный элемент. Аватар в правом верхнем углу. */}
            <div
              className="shrink-0 relative z-50 px-3 pb-2"
              style={{
                paddingTop: 'max(env(safe-area-inset-top), 16px)',
              }}
            >
              <div className="flex items-center gap-2.5">
                {/* Слева — кнопка "Назад" */}
                <button
                  onClick={() => setActiveConv(null)}
                  className="md:hidden shrink-0 h-10 w-10 rounded-full grid place-items-center active:scale-90 transition-all text-foreground"
                  style={{
                    background: 'color-mix(in oklch, var(--card) 65%, transparent)',
                    backdropFilter: 'blur(16px) saturate(140%)',
                    WebkitBackdropFilter: 'blur(16px) saturate(140%)',
                    border: '1px solid color-mix(in oklch, var(--border) 45%, transparent)',
                    boxShadow: '0 2px 8px -2px rgba(15,23,42,0.08)',
                  }}
                  aria-label="Назад"
                >
                  <ArrowLeft className="h-[18px] w-[18px]" />
                </button>

                {/* По центру — имя + статус (клик → профиль) */}
                <button
                  onClick={() => setProfileOpen(true)}
                  className="flex-1 min-w-0 text-center active:scale-[0.98] transition-transform px-2 py-1"
                  aria-label="Открыть профиль"
                >
                  <div className="text-sm font-semibold truncate leading-tight">
                    {activeConv.participant?.displayName || activeConv.participant?.username}
                  </div>
                  <div
                    className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5"
                    aria-live="polite"
                  >
                    {typing ? 'печатает…' : activeConv.participant?.isOnline ? (
                      <span className="inline-flex items-center gap-1 justify-center">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                        в сети
                      </span>
                    ) : `был(а) ${timeAgo(activeConv.participant?.lastSeen || '')}`}
                  </div>
                </button>

                {/* Справа — аватар (клик → полноэкранный просмотр) */}
                <button
                  onClick={() => setAvatarViewerOpen(true)}
                  className="shrink-0 rounded-full p-0.5 active:scale-90 transition-all"
                  style={{
                    background: 'color-mix(in oklch, var(--card) 65%, transparent)',
                    backdropFilter: 'blur(16px) saturate(140%)',
                    WebkitBackdropFilter: 'blur(16px) saturate(140%)',
                    border: '1px solid color-mix(in oklch, var(--border) 45%, transparent)',
                    boxShadow: '0 2px 8px -2px rgba(15,23,42,0.08)',
                  }}
                  aria-label="Просмотреть аватар"
                >
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={assetUrl(activeConv.participant?.avatar)} />
                    <AvatarFallback>{initials(activeConv.participant?.displayName || activeConv.participant?.username || '?')}</AvatarFallback>
                  </Avatar>
                </button>
              </div>
            </div>

            {/* v9-voice: TypingIndicator — living panel that replaces the
                legacy "печатает…" text under the header. Two modes:
                  • typing (peer is typing) — pencil icon, "печатает…"
                  • voice  (peer is recording) — mic icon, "записывает голосовое…"
                Both use the soft peer palette (milky/silver/pale-blue) so the
                user instantly knows it's the OTHER person, not themselves. */}
            <div className="relative">
              <TypingIndicator
                active={!!typing}
                username={typing?.username || ''}
                mode="typing"
                variant="peer"
              />
              <TypingIndicator
                active={!!peerVoiceRecording}
                username={peerVoiceRecording?.username || ''}
                mode="voice"
                variant="peer"
              />
            </div>

            {/* v16.8.3: панель категорий-фильтров. Каждая категория — отдельная
                стеклянная кнопка. При выборе фильтрует сообщения в текущем чате
                (НЕ открывает новый экран). "Все" = полный чат. */}
            <AttachmentsCenter
              messages={messages}
              activeCategory={activeCategory}
              onCategoryChange={setActiveCategory}
              favoriteIds={favorites.favoriteIds}
            />

            {/* Messages — flex-direction column-reverse чтобы новые сообщения
                были внизу, и контейнер прилипал к низу (как в мессенджерах).
                min-h-0 — КРИТИЧНО: без этого flex-1 ребёнок занимает всю высоту
                контента, и overflow-y-auto не срабатывает → чат растёт вниз.
                overscroll-behavior: contain — КРИТИЧНО для мобильных: блокирует
                "chain scrolling", чтобы при достижении границы списка чата
                прокрутка НЕ передавалась родительской странице. Без этого на
                iPhone вся страница двигалась под чатом. */}
            {/* Call history panel — collapsible, shown when user taps the clock icon */}
            <AnimatePresence>
              {showCallHistory && activeConv && (
                <CallHistory
                  conversationId={activeConv.id}
                  onCallBack={(peerId, type) => {
                    // Reuse the same handleStartCall logic for callback.
                    // peerId is the peer's user ID — handleStartCall uses
                    // activeConv.participant.id which is the same.
                    handleStartCall(type)
                    setShowCallHistory(false)
                  }}
                  onClose={() => setShowCallHistory(false)}
                />
              )}
            </AnimatePresence>
            <div
              ref={messagesContainerRef}
              // data-scroll-lock-ignore — КРИТИЧНО: без этого атрибута
              // useScrollLock (активен когда activeConv открыт) блокирует
              // touch scrolling внутри этого контейнера через document-level
              // touchmove listener. С этим атрибутом touch внутри контейнера
              // разрешён, и пользователь может листать сообщения.
              data-scroll-lock-ignore
              onScroll={handleScroll}
              className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col-reverse gap-2"
              style={{
                overscrollBehavior: 'contain',
                WebkitOverflowScrolling: 'touch',
                touchAction: 'pan-y',
                // v16.8.6: правильная маска исчезновения.
                // Сообщения полностью непрозрачны в рабочей области.
                // Плавное растворение ТОЛЬКО когда сообщение физически
                // заходит под Header (сверху) или под панель ввода (снизу).
                // mask-image с linear-gradient: прозрачность только в крайних
                // 32px (8% от высоты ~400px контейнера, но не менее 24px).
                // Никакого glow / белого градиента — только opacity через mask.
                WebkitMaskImage: 'linear-gradient(180deg, transparent 0px, black 32px, black calc(100% - 32px), transparent 100%)',
                maskImage: 'linear-gradient(180deg, transparent 0px, black 32px, black calc(100% - 32px), transparent 100%)',
              }}
              aria-label="Лента сообщений"
            >
              <div className="sr-only" aria-live="polite" aria-atomic="false">
                {lastMessageAnnouncement}
              </div>
              {filteredMessages.length === 0 ? (
                <div className="h-full grid place-items-center text-center text-sm text-muted-foreground">
                  <div>
                    <div className="text-4xl mb-2">{activeCategory === 'all' ? '👋' : '📭'}</div>
                    <p>{activeCategory === 'all' ? 'Начните диалог — отправьте первое сообщение' : 'В этой категории пока пусто'}</p>
                  </div>
                </div>
              ) : (
                // v16.8.3: используем reversedFilteredMessages — учитывает
                // активную категорию-фильтр. AnimatePresence для плавного
                // появления/исчезновения при переключении фильтра.
                <AnimatePresence mode="popLayout" initial={false}>
                  {reversedFilteredMessages.map((m) => (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <MessageBubble
                        message={m}
                        isOwn={m.senderId === user?.id}
                        isFavorite={favorites.isFavorite(m.id)}
                        onToggleFavorite={() => favorites.toggleFavorite(m.id)}
                        onContextMenu={(e) => openContextMenu(e, m)}
                        onScrollToMessage={scrollToMessage}
                        onImageClick={openLightbox}
                        onReply={(msg) => setReplyTo(msg)}
                        // v25.4 (TZ-2 task #3): pass openProduct so products
                        // opened from chat use the SAME ProductPage as the
                        // catalog (full-screen page, not a separate modal).
                        // This dispatches the `999pro:open-product` event
                        // which page.tsx catches and opens ProductPage.
                        onOpenProduct={(productId: string) => {
                          if (typeof window !== 'undefined') {
                            window.dispatchEvent(
                              new CustomEvent('999pro:open-product', {
                                detail: { productId },
                              }),
                            )
                          }
                        }}
                        registerRef={(el) => {
                          if (el) messageRefs.current.set(m.id, el)
                          else messageRefs.current.delete(m.id)
                        }}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>

            {/* Reply preview */}
            {replyTo && (
              <ReplyPreview message={replyTo} onClose={() => setReplyTo(null)} />
            )}

            {/* v25.9: Edit preview — when editingMessage is set, the composer
                switches to edit mode. Shows the message being edited with a
                Save/Cancel UI. The textarea below is pre-filled with the
                message content; submitting calls editMessage instead of send. */}
            {editingMessage && (
              <div className="px-3 pt-2">
                <div className="rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 flex items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground min-w-0 flex-1">
                    <span className="font-medium text-foreground">Редактирование:</span>{' '}
                    <span className="truncate">{(editingMessage.content || '').slice(0, 80)}</span>
                  </div>
                  <button
                    onClick={() => setEditingMessage(null)}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}

            {/* v16.9.4: Audio Hub draft preview — карточка выбранного трека
                над полем ввода. Не отправляется автоматически. */}
            {audioDraftTrack && (
              <AudioDraftPreview
                track={audioDraftTrack}
                onSend={() => {
                  handleSendAudioHubTrack(audioDraftTrack)
                  setAudioDraftTrack(null)
                }}
                onClose={() => setAudioDraftTrack(null)}
              />
            )}

            {/* v16.8.3: Панель ввода — отдельные парящие стеклянные элементы.
                Больше НЕТ общего контейнера-карточки. Каждый элемент (📎, поле
                ввода, 🎤/➡️) — самостоятельный стеклянный объект с воздухом
                между. Кнопка отправки плавно морфит из Mic → ArrowUp при вводе. */}
            <div
              className="shrink-0 px-3 pt-2 transition-opacity duration-300"
              style={{
                paddingBottom: `calc(0.5rem + ${keyboardOpen ? '0px' : 'env(safe-area-inset-bottom)'})`,
                opacity: isRecording ? 0.45 : 1,
                pointerEvents: isRecording ? 'none' : 'auto',
              }}
            >
              {/* Скрытые системные input'ы — каждый со своим accept/capture.
                  v16.9-final: fileInputRef теперь открывается напрямую из
                  кнопки 📎 (бывшее меню «Прикрепить» удалено). accept убран —
                  системный picker теперь позволяет выбрать ЛЮБОЙ файл
                  (фото, видео, аудио, документы, файлы любого типа). */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              <input
                ref={mediaInputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={handleTypedFileSelect(mediaInputRef)}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleTypedFileSelect(cameraInputRef)}
              />
              <input
                ref={audioInputRef}
                type="file"
                // v16.8.9: расширенный accept — iOS Safari часто игнорирует
                // голое "audio/*". Явно перечисляем расширения + MIME типы,
                // чтобы picker показывал и Files, и Voice Memos, и Music.
                accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus,audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/ogg,audio/x-m4a"
                className="hidden"
                onChange={handleTypedFileSelect(audioInputRef)}
              />
              <input
                ref={audioRecordInputRef}
                type="file"
                // v16.8.10: capture — открывает микрофон для записи звука.
                // На iOS это даёт возможность записать аудио с микрофона
                // (когда Music app недоступен из-за DRM).
                accept="audio/*"
                capture
                className="hidden"
                onChange={handleTypedFileSelect(audioRecordInputRef)}
              />
              <input
                ref={documentInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,.7z,.csv,.rtf,.odt,.ods,.odp"
                className="hidden"
                onChange={handleTypedFileSelect(documentInputRef)}
              />
              <input
                ref={contactInputRef}
                type="file"
                accept=".vcf,text/vcard"
                className="hidden"
                onChange={handleTypedFileSelect(contactInputRef)}
              />

              {/* v16.9-final: Стеклянная панель эмодзи — появляется над полем
                  ввода при нажатии кнопки 😊. Не Bottom Sheet, не отдельная
                  страница — именно inline glass panel с blur. Закрывается по
                  клику вне панели или после выбора эмодзи. */}
              <EmojiPicker
                open={emojiPanelOpen}
                onClose={() => setEmojiPanelOpen(false)}
                onPick={insertEmoji}
              />

              <div className="flex items-end gap-2">
                {/* 📎 Кнопка вложений — премиальная стеклянная капсула. */}
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.88 }}
                  whileHover={{ scale: 1.06 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                  onClick={() => {
                    haptic.tap()
                    fileInputRef.current?.click()
                  }}
                  className="shrink-0 h-11 w-11 rounded-full grid place-items-center transition-colors chat-input-btn"
                  aria-label="Прикрепить файл"
                  title="Фото, видео, документ, любой файл"
                >
                  <Paperclip className="h-[18px] w-[18px]" strokeWidth={2.2} />
                </motion.button>

                {/* Поле ввода со встроенными кнопками 😊 и 🛍 */}
                <div
                  className="flex-1 min-w-0 rounded-3xl flex items-end"
                  style={{
                    background: 'color-mix(in oklch, var(--card) 65%, transparent)',
                    backdropFilter: 'blur(16px) saturate(140%)',
                    WebkitBackdropFilter: 'blur(16px) saturate(140%)',
                    border: '1px solid color-mix(in oklch, var(--border) 45%, transparent)',
                    boxShadow: '0 2px 8px -2px rgba(15,23,42,0.08)',
                  }}
                >
                  {/* 😊 Кнопка эмодзи — встроена внутрь поля ввода (слева) */}
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.88 }}
                    whileHover={{ scale: 1.06 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                    onClick={() => {
                      haptic.tap()
                      setEmojiPanelOpen((v) => !v)
                    }}
                    className="shrink-0 h-11 w-11 rounded-full grid place-items-center transition-all mb-0.5 ml-1"
                    style={{
                      background: emojiPanelOpen
                        ? 'var(--gradient-brand)'
                        : 'transparent',
                      border: emojiPanelOpen
                        ? '1px solid rgba(255,255,255,0.18)'
                        : '1px solid transparent',
                      color: emojiPanelOpen ? '#fff' : 'var(--muted-foreground)',
                    }}
                    aria-label={emojiPanelOpen ? 'Закрыть эмодзи' : 'Открыть эмодзи'}
                    aria-expanded={emojiPanelOpen}
                    title="Эмодзи"
                  >
                    <Smile className="h-[19px] w-[19px]" strokeWidth={2.2} />
                  </motion.button>

                  <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={(e) => {
                      onTextChange(e.target.value)
                      e.target.style.height = 'auto'
                      e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        sendText()
                      }
                    }}
                    placeholder="Сообщение…"
                    rows={1}
                    className="flex-1 min-w-0 resize-none bg-transparent border-0 outline-none text-base py-2.5 px-2 max-h-[120px] leading-relaxed placeholder:text-muted-foreground/60"
                    style={{ scrollbarWidth: 'thin' }}
                  />

                  {/* 🛍 Кнопка «Товар» — встроена внутрь поля ввода (справа) */}
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.88 }}
                    whileHover={{ scale: 1.06 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                    onClick={() => {
                      haptic.tap()
                      setProductPickerOpen(true)
                    }}
                    className="shrink-0 h-11 w-11 rounded-full grid place-items-center transition-colors mb-0.5 mr-1"
                    style={{
                      background: 'transparent',
                      color: 'var(--muted-foreground)',
                    }}
                    aria-label="Отправить товар"
                    title="Выбрать товар для отправки"
                  >
                    <ShoppingBag className="h-[18px] w-[18px]" strokeWidth={2.2} />
                  </motion.button>
                </div>

                {/* v17: Кнопка «Media Hub» — единая фирменная иконка (glass, music+video).
                    Открывает компактное стеклянное меню выбора Audio/Video Hub.
                    Пользователь НЕ покидает переписку. */}
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.88 }}
                  whileHover={{ scale: 1.06 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                  onClick={() => {
                    haptic.tap()
                    // v16.9.4: Close the global overlay to prevent both being open.
                    window.dispatchEvent(new CustomEvent('close-media-hub'))
                    setAudioHubPickerOpen(true)
                  }}
                  className="shrink-0 h-11 w-11 rounded-full grid place-items-center transition-colors"
                  style={{
                    background: 'color-mix(in oklch, var(--card) 65%, transparent)',
                    backdropFilter: 'blur(16px) saturate(140%)',
                    WebkitBackdropFilter: 'blur(16px) saturate(140%)',
                    border: '1px solid color-mix(in oklch, var(--border) 45%, transparent)',
                    boxShadow: '0 2px 8px -2px rgba(15,23,42,0.08)',
                  }}
                  aria-label="Media Hub — музыка и фильмы"
                  title="Найти и отправить музыку или фильм"
                >
                  <MediaHubIcon size={22} />
                </motion.button>

                {/* Кнопка отправки/записи — плавный morph Mic → ArrowUp.
                    Пока поле пустое — Mic (запись голосового).
                    При вводе текста — ArrowUp (отправка).
                    AnimatePresence + scale/rotate для красивого перехода. */}
                <button
                  onClick={text.trim() ? sendText : startRecording}
                  className="shrink-0 h-11 w-11 rounded-full grid place-items-center text-white active:scale-90 transition-transform"
                  style={{
                    background: 'var(--gradient-brand)',
                    border: '1px solid rgba(255,255,255,0.18)',
                    boxShadow: '0 4px 16px -4px rgba(37,99,235,0.45)',
                  }}
                  aria-label={text.trim() ? 'Отправить' : 'Записать голосовое'}
                  title={text.trim() ? 'Отправить' : 'Записать голосовое сообщение'}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {text.trim() ? (
                      <motion.span
                        key="send"
                        initial={{ scale: 0, rotate: -90, opacity: 0 }}
                        animate={{ scale: 1, rotate: 0, opacity: 1 }}
                        exit={{ scale: 0, rotate: 90, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        className="grid place-items-center"
                      >
                        <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.6} />
                      </motion.span>
                    ) : (
                      <motion.span
                        key="mic"
                        initial={{ scale: 0, rotate: 90, opacity: 0 }}
                        animate={{ scale: 1, rotate: 0, opacity: 1 }}
                        exit={{ scale: 0, rotate: -90, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        className="grid place-items-center"
                      >
                        <Mic className="h-[18px] w-[18px]" strokeWidth={2.2} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="hidden md:flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="h-20 w-20 rounded-3xl gradient-brand mx-auto mb-4 grid place-items-center shadow-glow">
                <Send className="h-10 w-10 text-white" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Чат</h2>
              <p className="text-muted-foreground">Выберите диалог или начните новый</p>
            </div>
          </div>
        )}
      </div>

      {/* v9-voice: VoiceRecordPanel — premium iOS-style recording bottom sheet.
          Slides up with spring physics when isRecording flips to true. Reads
          micAmplitude.ref for the organic waveform. */}
      <VoiceRecordPanel
        open={isRecording}
        amplitudeRef={micAmplitude.ref}
        recordSeconds={recordSeconds}
        onStop={stopRecording}
        onCancel={cancelRecording}
        // v16.8-final: self-destruct timer state + setter.
        selfDestructMinutes={selfDestructMinutes}
        onChangeSelfDestruct={setSelfDestructMinutes}
      />

      {/* v16.9-final: AttachmentsBottomSheet ПОЛНОСТЬЮ УДАЛЕН.
          Ранее здесь открывалось фирменное меню «Прикрепить» с пунктами
          (Медиа/Камера/Аудио/Документы/Контакт/Товар). Теперь 📎 открывает
          системный picker напрямую (см. строку ~2082 в JSX нижней панели),
          а 🛍 «Товар» вынесена в постоянную кнопку нижней панели. */}

      {/* v16.8.3: ProductPickerSearch — компактный поиск товаров для отправки.
          Открывается постоянной кнопкой 🛍 в нижней панели. */}
      <ProductPickerSearch
        open={productPickerOpen}
        onClose={() => setProductPickerOpen(false)}
        onSelect={handleSendProduct}
      />

      {/* v16.20: Media Hub overlay — объединённый поиск Audio + Films.
          Открывается кнопкой 🎵 в нижней панели чата.
          v16.21: Заменил AudioSearchOverlay на MediaHubOverlay. */}
      <MediaHubOverlay
        open={audioHubPickerOpen}
        onClose={() => setAudioHubPickerOpen(false)}
        onSelectAudio={(track: AudioHubTrack) => {
          handleSendAudioHubTrack(track)
          setAudioHubPickerOpen(false)
        }}
        onPlayAudio={(track: AudioHubTrack) => {
          setAudioDraftTrack(track)
        }}
        onSendFilm={(film: FilmDetails) => {
          handleSendFilm(film)
          setAudioHubPickerOpen(false)
        }}
        showSendButton
      />

      {/* v16.8.4: UserProfileSheet — профиль пользователя (имя, ник, статус,
          звонки, история, общие медиа/документы/ссылки). Открывается при
          нажатии на имя в Header. */}
      <UserProfileSheet
        open={profileOpen}
        conversation={activeConv}
        messages={messages}
        onClose={() => setProfileOpen(false)}
        onAudioCall={() => { setProfileOpen(false); handleStartCall('audio') }}
        onVideoCall={() => { setProfileOpen(false); handleStartCall('video') }}
        onShowCallHistory={() => { setProfileOpen(false); setShowCallHistory(true) }}
        onAvatarClick={() => { setProfileOpen(false); setAvatarViewerOpen(true) }}
      />

      {/* v16.8.4: AvatarViewer — полноэкранный просмотр аватара. */}
      <AvatarViewer
        open={avatarViewerOpen}
        avatarUrl={activeConv?.participant?.avatar}
        displayName={activeConv?.participant?.displayName || activeConv?.participant?.username}
        onClose={() => setAvatarViewerOpen(false)}
      />

      {/* v16.8.4: ChatListContextMenu — long-press на чат в списке диалогов.
          Удаление/Очистка/Архивирование/Закрепление. */}
      <ChatListContextMenu
        open={chatListMenu.open}
        conversationTitle={
          chatListMenu.conv?.type === 'support'
            ? 'Поддержка'
            : chatListMenu.conv?.participant?.displayName || chatListMenu.conv?.participant?.username || 'Чат'
        }
        isPinned={chatListMenu.conv?.type === 'support'}
        onClose={() => setChatListMenu({ open: false, conv: null })}
        onDelete={() => {
          if (!chatListMenu.conv) return
          if (chatListMenu.conv.type === 'support') {
            toast.info('Чат с поддержкой нельзя удалить')
            return
          }
          // Delete conversation for current user
          void (async () => {
            try {
              await api.delete(`/api/chat/conversations/${chatListMenu.conv!.id}`, { auth: true })
              setConversations((cur) => cur.filter((c) => c.id !== chatListMenu.conv!.id))
              toast.success('Чат удалён')
            } catch {
              toast.error('Не удалось удалить чат')
            }
          })()
        }}
        onClearHistory={() => {
          if (!chatListMenu.conv) return
          void (async () => {
            try {
              await api.delete(`/api/chat/conversations/${chatListMenu.conv!.id}/messages`, { auth: true })
              setMessages([])
              toast.success('История очищена')
            } catch {
              toast.error('Не удалось очистить историю')
            }
          })()
        }}
        onArchive={() => toast.info('Архивация скоро будет доступна')}
        onTogglePin={() => toast.info(chatListMenu.conv?.type === 'support' ? 'Чат поддержки уже закреплён' : 'Закрепление скоро будет доступно')}
      />

      {/* v9-voice: AmbientGlow — soft breathing light around the screen edges.
          Two variants:
            • 'record' (my recording) — brand sky/blue/violet, bright, syncs
              with my mic amplitude. The screen breathes WITH my voice.
            • 'peer' (peer recording) — milky/silver/pale-blue, calm, gentle
              base pulse only (no amplitude sync — we don't have the peer's
              mic data). Tells the user "the other person is speaking". */}
      <AmbientGlow active={isRecording} amplitudeRef={micAmplitude.ref} variant="record" />
      {peerVoiceRecording && (
        <AmbientGlow
          active={!!peerVoiceRecording}
          amplitudeRef={{ current: 0.25 }}
          variant="peer"
        />
      )}

      {/* Context menu */}
      <MessageContextMenu
        open={contextMenu.open}
        x={contextMenu.x}
        y={contextMenu.y}
        isOwn={contextMenu.message?.senderId === user?.id}
        hasText={!!contextMenu.message?.content}
        hasMedia={!!contextMenu.message?.mediaUrl}
        mediaType={contextMenu.message?.mediaType as any}
        onReply={handleReply}
        onForward={handleForward}
        onCopy={handleCopy}
        // v16.8.3: Избранное — toggle через useFavorites hook.
        onFavorite={() => {
          if (contextMenu.message) {
            favorites.toggleFavorite(contextMenu.message.id)
            toast.success(favorites.isFavorite(contextMenu.message.id) ? '⭐ Удалено из избранного' : '⭐ Добавлено в избранное')
          }
        }}
        isFavorite={contextMenu.message ? favorites.isFavorite(contextMenu.message.id) : false}
        onPin={() => toast.info('📌 Закрепление сообщений скоро будет доступно')}
        onEdit={() => {
          if (contextMenu.message) {
            // Only allow editing own text messages within 48h (backend will
            // re-validate, but we skip the menu entry for non-own messages
            // via canEdit in MessageContextMenu).
            setEditingMessage(contextMenu.message)
            setContextMenu((c) => ({ ...c, open: false }))
          }
        }}
        onDownload={() => {
          if (contextMenu.message?.mediaUrl) {
            const a = document.createElement('a')
            a.href = assetUrl(contextMenu.message.mediaUrl)
            a.download = ''
            a.target = '_blank'
            a.click()
          }
        }}
        onShare={async () => {
          if (contextMenu.message?.mediaUrl && navigator.share) {
            try {
              await navigator.share({
                title: '999PRO',
                url: assetUrl(contextMenu.message.mediaUrl),
              })
            } catch {}
          }
        }}
        onDeleteForMe={handleDeleteForMe}
        onDeleteForEveryone={handleDeleteForEveryone}
        onInfo={handleInfo}
        onReport={() => {
          if (contextMenu.message) {
            setReportTarget({ open: true, messageId: contextMenu.message.id })
          }
        }}
        onClose={() => setContextMenu((c) => ({ ...c, open: false }))}
      />

      {/* v16.9: Moderation report dialog */}
      {reportTarget.open && (
        <ReportMessageDialog
          messageId={reportTarget.messageId}
          onClose={() => setReportTarget({ open: false, messageId: '' })}
        />
      )}

      {/* Forward dialog */}
      <ForwardDialog
        open={forwardOpen}
        message={forwardMessage}
        onForward={handleForwardSubmit}
        onClose={() => {
          setForwardOpen(false)
          setForwardMessage(null)
        }}
      />

      {/* Call screen is rendered globally by CallManager (in AppShell) so
          calls work from any view, not just chat. */}

      {/* Image lightbox — полноэкранный просмотр картинок */}
      <ImageLightbox
        images={lightbox.images}
        initialIndex={lightbox.index}
        open={lightbox.open}
        onClose={() => setLightbox((l) => ({ ...l, open: false }))}
      />

      {/* Phase 10: custom confirm dialog for delete conversation */}
      <ConfirmDialog
        open={deleteConvOpen}
        title="Удалить диалог?"
        message={`Все сообщения с ${activeConv?.participant?.displayName || activeConv?.participant?.username || 'собеседником'} будут удалены безвозвратно.`}
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        variant="danger"
        onConfirm={confirmDeleteConversation}
        onCancel={() => setDeleteConvOpen(false)}
      />

      {/* Admin delete — hard-delete for ALL participants. Stronger warning. */}
      <ConfirmDialog
        open={adminDeleteConvOpen}
        title="Удалить чат для всех?"
        message={`Это действие удалит чат полностью для ВСЕХ участников (включая собеседника). Все сообщения будут безвозвратно стёрты с сервера. Действие необратимо.`}
        confirmLabel="Удалить для всех"
        cancelLabel="Отмена"
        variant="danger"
        onConfirm={confirmAdminDeleteConversation}
        onCancel={() => setAdminDeleteConvOpen(false)}
      />

      {/* v12.6.6: Smart scroll button for chat — works on the messages
          container (flex-col-reverse). ↑ = go to beginning of history
          (oldest messages, max scrollTop). ↓ = return to saved position.
          Only rendered when a conversation is active. */}
      {activeConv && (
        <SmartScrollButton scrollContainerRef={messagesContainerRef} reverse />
      )}
    </div>
  )
}
