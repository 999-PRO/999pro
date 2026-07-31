'use client'

import { Download } from 'lucide-react'
import { assetUrl } from '@/lib/api'
import { getDocumentIcon, getFilenameFromUrl } from '@/lib/message-utils'

interface DocumentAttachmentProps {
  url: string
  filename?: string
  size?: number | null
  isOwn?: boolean
}

/**
 * Compact glass file attachment.
 *
 * Дизайн-принципы:
 *  - Нет внешнего "пузыря" — только компактная стеклянная карточка.
 *  - Цветная иконка слева (по типу файла: PDF — красный, DOC — синий и т.д.).
 *  - Имя файла + тип/размер справа, кнопка download — самая правая.
 *  - Лёгкий glassmorphism, без перегруза тенями.
 *  - Единый стиль с голосовыми сообщениями (см. AudioMessage в chat.tsx).
 */
export function DocumentAttachment({ url, filename, size, isOwn }: DocumentAttachmentProps) {
  const name = filename || getFilenameFromUrl(url)
  const docInfo = getDocumentIcon(name)

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    const link = document.createElement('a')
    link.href = assetUrl(url)
    link.download = name
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const formatSize = (bytes: number): string => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <button
      onClick={handleDownload}
      className="media-compact-card flex items-center gap-3 px-3 py-2.5 w-full min-w-[220px] max-w-[300px] text-left"
    >
      {/* Compact colored icon */}
      <div
        className="h-10 w-10 rounded-xl grid place-items-center shrink-0 text-white text-[10px] font-bold tracking-tight"
        style={{
          background: docInfo.color,
          boxShadow: `0 4px 12px -3px ${docInfo.color}80`,
        }}
      >
        {docInfo.label.slice(0, 4)}
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0">
        <div className="media-compact-title text-sm font-semibold truncate">
          {name}
        </div>
        <div className="media-compact-meta text-[11px] flex items-center gap-1.5 mt-0.5">
          <span
            className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide"
            style={{ background: `${docInfo.color}22`, color: docInfo.color }}
          >
            {docInfo.label}
          </span>
          {size ? <span>{formatSize(size)}</span> : null}
        </div>
      </div>

      <Download className="media-compact-action h-4 w-4 shrink-0" />
    </button>
  )
}
