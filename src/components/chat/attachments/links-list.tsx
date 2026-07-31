'use client'

// ============================================================================
// LinksList — список ссылок из чата.
// ----------------------------------------------------------------------------
// Возможности:
//   • Красивое превью с favicon (через Google s2)
//   • Название сайта (домен)
//   • Дата отправки + отправитель
//   • Клик открывает ссылку в новой вкладке
// ============================================================================

import { Link2, ExternalLink, Globe } from 'lucide-react'
import { assetUrl } from '@/lib/api'
import { formatTime } from '@/lib/format'
import type { LinkItem } from '../hooks/use-chat-attachments'

interface LinksListProps {
  links: LinkItem[]
  onScrollToMessage?: (id: string) => void
}

function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
}

export function LinksList({ links, onScrollToMessage }: LinksListProps) {
  if (links.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <div className="h-16 w-16 rounded-2xl grid place-items-center mb-4 bg-foreground/5">
          <Link2 className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-lg font-semibold mb-1">Ссылок пока нет</div>
        <div className="text-sm text-muted-foreground">
          Ссылки из сообщений появятся здесь
        </div>
      </div>
    )
  }

  return (
    <div className="px-3 py-3 space-y-2">
      {links.map((link) => (
        <a
          key={link.id}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-2.5 rounded-xl bg-card/50 border border-border/30 hover:bg-card/80 transition-colors group"
        >
          <div className="relative shrink-0 h-11 w-11 rounded-xl overflow-hidden grid place-items-center bg-foreground/5">
            { }
            <img
              src={faviconUrl(link.domain)}
              alt=""
              className="h-6 w-6"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
                ;(e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden')
              }}
            />
            <Globe className="h-5 w-5 text-muted-foreground hidden" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">
              {link.domain}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {link.url}
            </div>
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
              <span>{link.senderName}</span>
              <span>·</span>
              <span>{formatTime(link.createdAt)}</span>
            </div>
          </div>
          <ExternalLink className="shrink-0 h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
        </a>
      ))}
    </div>
  )
}
