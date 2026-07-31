'use client'

import { Reply, X } from 'lucide-react'
import { assetUrl } from '@/lib/api'
import type { Message } from '@/lib/types'

interface ReplyPreviewProps {
  message: Message
  onClose: () => void
}

export function ReplyPreview({ message, onClose }: ReplyPreviewProps) {
  const sender = message.sender || message.replyTo?.sender
  const name = sender?.displayName || sender?.username || 'Пользователь'

  let preview = ''
  if (message.deletedForAll) preview = 'Сообщение удалено'
  else if (message.content) preview = message.content
  else if (message.mediaType === 'image') preview = '📷 Фото'
  else if (message.mediaType === 'video') preview = '🎥 Видео'
  else if (message.mediaType === 'audio') preview = '🎤 Голосовое сообщение'
  else preview = 'Вложение'

  return (
    <div className="flex items-start gap-2 px-3 py-2 border-t border-border/40 bg-accent/30 rounded-t-2xl">
      <Reply className="h-4 w-4 mt-1 text-primary shrink-0" />
      <div className="flex-1 min-w-0 border-l-2 border-primary pl-2">
        <div className="text-xs font-semibold text-primary truncate">{name}</div>
        <div className="text-xs text-muted-foreground truncate">{preview}</div>
      </div>
      <button
        onClick={onClose}
        className="shrink-0 p-1 rounded-full hover:bg-white/10 transition-colors"
        aria-label="Отменить ответ"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
