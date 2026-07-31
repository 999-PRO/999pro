'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Flag, X, MessageSquareWarning, AlertCircle, ShieldAlert, BadgeDollarSign, Ban, HelpCircle,
  CheckCircle2, Send,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/lib/notifications'

// ============================================================================
// ReportMessageDialog — moderation report dialog for chat messages.
//
// Opens when user taps "Пожаловаться" in the message context menu.
// Reasons: spam, insult, threat, fraud, forbidden, other.
// Submits to POST /api/moderation/report.
// ============================================================================

const REASONS = [
  { id: 'spam', label: 'Спам', icon: MessageSquareWarning, color: 'text-amber-500' },
  { id: 'insult', label: 'Оскорбление', icon: AlertCircle, color: 'text-orange-500' },
  { id: 'threat', label: 'Угроза', icon: ShieldAlert, color: 'text-red-500' },
  { id: 'fraud', label: 'Мошенничество', icon: BadgeDollarSign, color: 'text-pink-500' },
  { id: 'forbidden', label: 'Запрещённый контент', icon: Ban, color: 'text-purple-500' },
  { id: 'other', label: 'Другое', icon: HelpCircle, color: 'text-blue-500' },
] as const

interface ReportMessageDialogProps {
  messageId: string
  onClose: () => void
}

export function ReportMessageDialog({ messageId, onClose }: ReportMessageDialogProps) {
  const [reason, setReason] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const submit = async () => {
    if (!reason) return
    setSubmitting(true)
    try {
      await api.post('/api/moderation/report', {
        json: {
          targetType: 'message',
          targetId: messageId,
          reason,
          comment: comment.trim() || undefined,
        },
        auth: true,
      })
      setSubmitted(true)
      setTimeout(() => onClose(), 1800)
    } catch (e: unknown) {
      toast.error('Не удалось отправить жалобу', {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%', opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: '100%', opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          className="bg-background rounded-3xl shadow-2xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {submitted ? (
            <div className="text-center py-6">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', damping: 15 }}
                className="h-16 w-16 rounded-full bg-emerald-500/15 grid place-items-center mx-auto mb-3"
              >
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              </motion.div>
              <h3 className="font-bold text-lg mb-1">Жалоба отправлена</h3>
              <p className="text-sm text-muted-foreground">
                Спасибо за обращение. Модераторы рассмотрят жалобу в ближайшее время.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-2xl bg-red-500/10 grid place-items-center">
                    <Flag className="h-5 w-5 text-red-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg leading-tight">Пожаловаться</h3>
                    <p className="text-xs text-muted-foreground">Выберите причину нарушения</p>
                  </div>
                </div>
                <button onClick={onClose} className="h-8 w-8 rounded-full grid place-items-center hover:bg-accent" aria-label="Закрыть">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                {REASONS.map((r) => {
                  const Icon = r.icon
                  const active = reason === r.id
                  return (
                    <button
                      key={r.id}
                      onClick={() => setReason(r.id)}
                      className={`flex items-center gap-2 p-3 rounded-2xl border-2 text-left transition-all ${
                        active
                          ? 'border-primary bg-primary/10'
                          : 'border-border/40 hover:bg-accent/40'
                      }`}
                    >
                      <Icon className={`h-5 w-5 shrink-0 ${active ? 'text-primary' : r.color}`} />
                      <span className="text-sm font-medium">{r.label}</span>
                    </button>
                  )
                })}
              </div>

              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Комментарий (необязательно) — добавьте детали, которые помогут модераторам..."
                className="rounded-2xl min-h-[80px] text-sm mb-3"
                maxLength={1000}
              />

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 rounded-full h-11" onClick={onClose}>
                  Отмена
                </Button>
                <Button
                  className="flex-1 rounded-full h-11"
                  onClick={submit}
                  disabled={!reason || submitting}
                >
                  <Send className="h-4 w-4 mr-1" />
                  {submitting ? 'Отправка…' : 'Отправить'}
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
