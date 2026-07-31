'use client'
import { useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'

export function StudioView({ onBack }: { onBack: () => void }) {
  const [loading, setLoading] = useState(true)
  return (<div className="fixed inset-0 z-[60] bg-background flex flex-col">
    <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-background/95 backdrop-blur" style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}><button onClick={onBack} className="p-2 rounded-full hover:bg-accent transition-colors shrink-0"><ArrowLeft className="h-5 w-5" /></button><div className="flex-1 min-w-0"><div className="text-sm font-bold">Студия</div><div className="text-xs text-muted-foreground">Панель администратора</div></div>{loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}</div>
    <iframe src="/studio" className="flex-1 w-full border-0" onLoad={() => setLoading(false)} title="Studio «Три девятки»" style={{ minHeight: 0 }} />
  </div>)
}
