'use client'

// ============================================================================
// useChatAttachments — извлекает вложения из сообщений чата по категориям.
// ----------------------------------------------------------------------------
// Принимает массив Message, возвращает структурированные списки:
//   • photos — все изображения (из mediaUrl + attachments)
//   • videos — все видео
//   • music — все аудио с длительностью > 60с (эвристика: "музыка" vs "voice")
//   • voices — все аудио с длительностью <= 60с (или без длительности)
//   • documents — все файлы
//   • links — все ссылки из текстовых сообщений
//   • products — все product-сообщения
//
// Эвристика music/voice: если duration > 60s — это музыка, иначе voice.
// Это простая эвристика, но работает для большинства случаев (голосовые
// обычно 5-60с, музыка 2-5 минут).
//
// Все списки memoized — ре-вычисление только при изменении messages.
// ============================================================================

import { useMemo } from 'react'
import type { Message, Attachment } from '@/lib/types'
import { assetUrl } from '@/lib/api'

export interface PhotoItem {
  id: string
  url: string
  messageId: string
  senderName: string
  senderAvatar?: string
  createdAt: string
}

export interface VideoItem {
  id: string
  url: string
  messageId: string
  senderName: string
  senderAvatar?: string
  createdAt: string
  duration?: number
}

export interface MusicItem {
  id: string
  url: string
  title: string
  artist: string
  duration?: number
  coverUrl?: string
  messageId: string
  senderName: string
  senderAvatar?: string
  createdAt: string
}

export interface VoiceItem {
  id: string
  url: string
  duration?: number
  messageId: string
  senderName: string
  senderAvatar?: string
  createdAt: string
  selfDestructAt?: string | null
}

export interface DocumentItem {
  id: string
  name: string
  url: string
  size?: number
  messageId: string
  senderName: string
  senderAvatar?: string
  createdAt: string
}

export interface LinkItem {
  id: string
  url: string
  domain: string
  messageId: string
  senderName: string
  createdAt: string
}

export interface ProductItem {
  id: string
  productId: string
  messageId: string
  senderName: string
  createdAt: string
}

export interface AudioHubItem {
  id: string
  trackId: string
  messageId: string
  senderName: string
  createdAt: string
}

export interface ChatAttachments {
  photos: PhotoItem[]
  videos: VideoItem[]
  music: MusicItem[]
  voices: VoiceItem[]
  documents: DocumentItem[]
  links: LinkItem[]
  products: ProductItem[]
  audioHub: AudioHubItem[]
  totalCount: number
}

// ---- Helpers ----

function extractDomain(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const URL_REGEX = /https?:\/\/[^\s<>"']+/gi

function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX)
  return matches ? matches.slice(0, 5) : [] // cap 5 per message
}

function senderDisplayName(msg: Message): string {
  return msg.sender?.displayName || msg.sender?.username || 'Пользователь'
}

// ---- Hook ----

export function useChatAttachments(messages: Message[]): ChatAttachments {
  return useMemo(() => {
    const photos: PhotoItem[] = []
    const videos: VideoItem[] = []
    const music: MusicItem[] = []
    const voices: VoiceItem[] = []
    const documents: DocumentItem[] = []
    const links: LinkItem[] = []
    const products: ProductItem[] = []
    const audioHub: AudioHubItem[] = []

    for (const msg of messages) {
      // Skip deleted messages
      if (msg.deletedForAll) continue

      const senderName = senderDisplayName(msg)
      const senderAvatar = msg.sender?.avatar || undefined

      // 1. Single-file media (mediaUrl + mediaType)
      if (msg.mediaType === 'image' && msg.mediaUrl) {
        photos.push({
          id: msg.id,
          url: msg.mediaUrl,
          messageId: msg.id,
          senderName,
          senderAvatar,
          createdAt: msg.createdAt,
        })
      } else if (msg.mediaType === 'video' && msg.mediaUrl) {
        videos.push({
          id: msg.id,
          url: msg.mediaUrl,
          messageId: msg.id,
          senderName,
          senderAvatar,
          createdAt: msg.createdAt,
          duration: msg.duration || undefined,
        })
      } else if (msg.mediaType === 'audio' && msg.mediaUrl) {
        // Эвристика music vs voice: duration > 60s → music.
        const dur = msg.duration || 0
        const isMusic = dur > 60
        if (isMusic) {
          music.push({
            id: msg.id,
            url: msg.mediaUrl,
            title: `Трек ${music.length + 1}`,
            artist: senderName,
            duration: dur,
            coverUrl: senderAvatar,
            messageId: msg.id,
            senderName,
            senderAvatar,
            createdAt: msg.createdAt,
          })
        } else {
          voices.push({
            id: msg.id,
            url: msg.mediaUrl,
            duration: dur,
            messageId: msg.id,
            senderName,
            senderAvatar,
            createdAt: msg.createdAt,
            selfDestructAt: msg.selfDestructAt,
          })
        }
      } else if (msg.mediaType === 'file' && msg.mediaUrl) {
        const name = msg.mediaUrl.split('/').pop() || 'document'
        documents.push({
          id: msg.id,
          name,
          url: msg.mediaUrl,
          messageId: msg.id,
          senderName,
          senderAvatar,
          createdAt: msg.createdAt,
        })
      } else if (msg.mediaType === 'product' && msg.mediaUrl) {
        products.push({
          id: msg.id,
          productId: msg.mediaUrl,
          messageId: msg.id,
          senderName,
          createdAt: msg.createdAt,
        })
      } else if (msg.mediaType === 'audio-hub' && msg.mediaUrl) {
        // v16.9.2: Audio Hub track — mediaUrl stores the track id (e.g. "archive-MLKDream").
        audioHub.push({
          id: msg.id,
          trackId: msg.mediaUrl,
          messageId: msg.id,
          senderName,
          createdAt: msg.createdAt,
        })
      }

      // 2. Attachments array (multi-file messages)
      if (msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments as Attachment[]) {
          const attId = `${msg.id}-${att.url}`
          if (att.type === 'image') {
            photos.push({
              id: attId,
              url: att.url,
              messageId: msg.id,
              senderName,
              senderAvatar,
              createdAt: msg.createdAt,
            })
          } else if (att.type === 'video') {
            videos.push({
              id: attId,
              url: att.url,
              messageId: msg.id,
              senderName,
              senderAvatar,
              createdAt: msg.createdAt,
              duration: att.duration,
            })
          } else if (att.type === 'audio') {
            const dur = att.duration || 0
            const isMusic = dur > 60
            if (isMusic) {
              music.push({
                id: attId,
                url: att.url,
                title: att.name || `Трек ${music.length + 1}`,
                artist: senderName,
                duration: dur,
                coverUrl: senderAvatar,
                messageId: msg.id,
                senderName,
                senderAvatar,
                createdAt: msg.createdAt,
              })
            } else {
              voices.push({
                id: attId,
                url: att.url,
                duration: dur,
                messageId: msg.id,
                senderName,
                senderAvatar,
                createdAt: msg.createdAt,
              })
            }
          } else if (att.type === 'file') {
            documents.push({
              id: attId,
              name: att.name || att.url.split('/').pop() || 'document',
              url: att.url,
              size: att.size,
              messageId: msg.id,
              senderName,
              senderAvatar,
              createdAt: msg.createdAt,
            })
          }
        }
      }

      // 3. Links from text content
      if (msg.content) {
        const urls = extractUrls(msg.content)
        for (const url of urls) {
          const domain = extractDomain(url)
          if (domain) {
            links.push({
              id: `${msg.id}-${url}`,
              url,
              domain,
              messageId: msg.id,
              senderName,
              createdAt: msg.createdAt,
            })
          }
        }
      }
    }

    return {
      photos,
      videos,
      music,
      voices,
      documents,
      links,
      products,
      audioHub,
      totalCount:
        photos.length +
        videos.length +
        music.length +
        voices.length +
        documents.length +
        links.length +
        products.length +
        audioHub.length,
    }
  }, [messages])
}
