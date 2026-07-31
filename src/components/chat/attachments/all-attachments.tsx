'use client'

// ============================================================================
// AllAttachments — объединённое представление всех вложений.
// ----------------------------------------------------------------------------
// Показывает превью всех категорий в одном scroll-списке.
// Каждая категория — секция с заголовком и горизонтальным скроллом (preview).
// ============================================================================

import {
  Image as ImageIcon, Video, Music, Mic, FileText, Link2, ShoppingBag, ChevronRight,
} from 'lucide-react'
import { assetUrl } from '@/lib/api'
import { formatDuration, formatTime } from '@/lib/format'
import type { ChatAttachments } from '../hooks/use-chat-attachments'

interface AllAttachmentsProps {
  attachments: ChatAttachments
  onOpenProduct?: (productId: string) => void
  onScrollToMessage?: (id: string) => void
}

interface SectionDef {
  id: string
  label: string
  icon: typeof ImageIcon
  count: number
}

export function AllAttachments({ attachments }: AllAttachmentsProps) {
  const sections: SectionDef[] = [
    { id: 'photos', label: 'Фото', icon: ImageIcon, count: attachments.photos.length },
    { id: 'videos', label: 'Видео', icon: Video, count: attachments.videos.length },
    { id: 'music', label: 'Музыка', icon: Music, count: attachments.music.length },
    { id: 'voices', label: 'Голосовые', icon: Mic, count: attachments.voices.length },
    { id: 'documents', label: 'Документы', icon: FileText, count: attachments.documents.length },
    { id: 'links', label: 'Ссылки', icon: Link2, count: attachments.links.length },
    { id: 'products', label: 'Товары', icon: ShoppingBag, count: attachments.products.length },
  ].filter((s) => s.count > 0)

  return (
    <div className="px-3 py-3 space-y-5">
      {sections.map((section) => {
        const Icon = section.icon
        return (
          <div key={section.id}>
            <div className="flex items-center gap-2 mb-2 px-1">
              <div className="grid place-items-center h-7 w-7 rounded-lg" style={{ background: 'var(--gradient-brand)' }}>
                <Icon className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">{section.label}</div>
                <div className="text-xs text-muted-foreground">{section.count} элементов</div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>

            {/* Horizontal preview scroll */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {section.id === 'photos' && attachments.photos.slice(0, 12).map((p) => (
                <div key={p.id} className="shrink-0 h-20 w-20 rounded-lg overflow-hidden bg-foreground/5">
                  { }
                  <img src={assetUrl(p.url)} alt="" className="h-full w-full object-cover" loading="lazy" />
                </div>
              ))}
              {section.id === 'videos' && attachments.videos.slice(0, 12).map((v) => (
                <div key={v.id} className="relative shrink-0 h-20 w-32 rounded-lg overflow-hidden bg-black">
                  <video src={assetUrl(v.url)} preload="metadata" muted className="h-full w-full object-cover" />
                  <div className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/70 text-white text-[9px] font-mono">
                    {formatDuration(v.duration || 0)}
                  </div>
                </div>
              ))}
              {section.id === 'music' && attachments.music.slice(0, 12).map((m) => (
                <div key={m.id} className="shrink-0 w-40 p-2 rounded-xl bg-card/50 border border-border/30">
                  <div className="flex items-center gap-2">
                    <div className="h-9 w-9 rounded-lg overflow-hidden grid place-items-center" style={{ background: 'var(--gradient-brand)' }}>
                      <Music className="h-4 w-4 text-white/70" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{m.title}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{m.senderName}</div>
                    </div>
                  </div>
                </div>
              ))}
              {section.id === 'voices' && attachments.voices.slice(0, 12).map((v) => (
                <div key={v.id} className="shrink-0 w-40 p-2 rounded-xl bg-card/50 border border-border/30">
                  <div className="flex items-center gap-2">
                    <div className="h-9 w-9 rounded-full grid place-items-center" style={{ background: 'var(--gradient-brand)' }}>
                      <Mic className="h-4 w-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{v.senderName}</div>
                      <div className="text-[10px] text-muted-foreground">{formatDuration(v.duration || 0)}</div>
                    </div>
                  </div>
                </div>
              ))}
              {section.id === 'documents' && attachments.documents.slice(0, 12).map((d) => (
                <div key={d.id} className="shrink-0 w-40 p-2 rounded-xl bg-card/50 border border-border/30">
                  <div className="flex items-center gap-2">
                    <div className="h-9 w-9 rounded-lg grid place-items-center" style={{ background: 'var(--gradient-brand)' }}>
                      <FileText className="h-4 w-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{d.name}</div>
                      <div className="text-[10px] text-muted-foreground">{formatTime(d.createdAt)}</div>
                    </div>
                  </div>
                </div>
              ))}
              {section.id === 'links' && attachments.links.slice(0, 12).map((l) => (
                <div key={l.id} className="shrink-0 w-44 p-2 rounded-xl bg-card/50 border border-border/30">
                  <div className="flex items-center gap-2">
                    <div className="h-9 w-9 rounded-lg grid place-items-center bg-foreground/5">
                      <Link2 className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{l.domain}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{l.senderName}</div>
                    </div>
                  </div>
                </div>
              ))}
              {section.id === 'products' && attachments.products.slice(0, 12).map((p) => (
                <div key={p.id} className="shrink-0 w-32 p-2 rounded-xl bg-card/50 border border-border/30">
                  <div className="flex items-center gap-2">
                    <div className="h-9 w-9 rounded-lg grid place-items-center" style={{ background: 'var(--gradient-brand)' }}>
                      <ShoppingBag className="h-4 w-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{p.senderName}</div>
                      <div className="text-[10px] text-muted-foreground">{formatTime(p.createdAt)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
