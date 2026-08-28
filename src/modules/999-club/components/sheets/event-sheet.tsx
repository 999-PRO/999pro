'use client'

/**
 * EventSheet — 📅 bespoke event experience.
 *
 * Visual identity: vertical timeline with date badges. Each event is a
 * card with a big date (day + month) on the left, content on the right.
 * Countdown to next event. "Add to calendar" generates an ICS file.
 * Featured (first) event has a hero image.
 */

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, MapPin, Users, Clock, Download, Check } from 'lucide-react'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { assetUrl } from '@/lib/api'
import { clubApi } from '../../api'
import type { ClubEvent, ClubCardMeta } from '../../types'
import { eventTimeline } from '../../animations'
import { ClubSheetWrapper } from './club-sheet-wrapper'

interface EventSheetProps {
  events: ClubEvent[]
  meta: ClubCardMeta
  onClose: () => void
  onChanged: () => Promise<void>
}

function formatDateParts(dateStr: string) {
  const d = new Date(dateStr)
  return {
    day: d.getDate(),
    month: d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', ''),
    weekday: d.toLocaleDateString('ru-RU', { weekday: 'short' }),
    time: d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  }
}

function useCountdown(startsAt: string) {
  const [remaining, setRemaining] = useState(() => {
    const target = new Date(startsAt).getTime()
    return Math.max(0, target - Date.now())
  })
  useEffect(() => {
    const target = new Date(startsAt).getTime()
    const interval = setInterval(() => {
      setRemaining(Math.max(0, target - Date.now()))
    }, 1000)
    return () => clearInterval(interval)
  }, [startsAt])
  if (remaining <= 0) return null
  const days = Math.floor(remaining / (1000 * 60 * 60 * 24))
  const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const mins = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))
  const secs = Math.floor((remaining % (1000 * 60)) / 1000)
  if (days > 0) return `${days}д ${hours}ч ${mins}м`
  if (hours > 0) return `${hours}ч ${mins}м ${secs}с`
  return `${mins}м ${secs}с`
}

/** Generate an ICS calendar file and trigger download. */
function downloadIcs(event: ClubEvent) {
  const dt = new Date(event.startsAt)
  const dtEnd = event.endsAt ? new Date(event.endsAt) : new Date(dt.getTime() + 60 * 60 * 1000)
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TRI999//CLUB//RU',
    'BEGIN:VEVENT',
    `UID:${event.id}@999pro`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(dt)}`,
    `DTEND:${fmt(dtEnd)}`,
    `SUMMARY:${event.title}`,
    `DESCRIPTION:${event.description || ''}`,
    `LOCATION:${event.location || ''}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  const blob = new Blob([ics], { type: 'text/calendar' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${event.title.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')}.ics`
  a.click()
  URL.revokeObjectURL(url)
}

export function EventSheet({ events, meta, onClose, onChanged }: EventSheetProps) {
  const [registering, setRegistering] = useState<string | null>(null)

  const handleRegister = useCallback(async (event: ClubEvent) => {
    haptic.heavy()
    setRegistering(event.id)
    try {
      await clubApi.registerForEvent(event.id)
      haptic.success()
      toast.success('✓ Вы зарегистрированы!', { description: event.title })
      await onChanged()
    } catch (e: any) {
      haptic.error()
      toast.error(e?.message || 'Не удалось зарегистрироваться')
    } finally {
      setRegistering(null)
    }
  }, [onChanged])

  return (
    <ClubSheetWrapper meta={meta} onClose={onClose} subtitle="Эксклюзивные мероприятия для участников">
      <div className="p-4">
        {/* Timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gradient-to-b from-violet-500/40 via-violet-500/20 to-transparent" />

          <div className="space-y-4">
            {events.map((event, i) => {
              const date = formatDateParts(event.startsAt)
              const isFeatured = i === 0
              const isRegistered = event.isRegistered
              const isRegistering = registering === event.id
              const isFull = event.maxAttendees != null && event.attendeesCount != null && event.attendeesCount >= event.maxAttendees

              return (
                <motion.div
                  key={event.id}
                  variants={eventTimeline}
                  initial="hidden"
                  animate="visible"
                  transition={{ delay: i * 0.1 }}
                  className="relative pl-16"
                >
                  {/* Date badge */}
                  <div
                    className={cn(
                      'absolute left-0 top-0 w-12 rounded-2xl overflow-hidden text-center shadow-glow',
                      isFeatured ? 'ring-2 ring-violet-500/40' : '',
                    )}
                    style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)' }}
                  >
                    <div className="bg-violet-500/20 py-0.5">
                      <span className="text-[9px] font-bold text-white uppercase">{date.month}</span>
                    </div>
                    <div className="py-1">
                      <span className="text-xl font-extrabold text-white block leading-none">{date.day}</span>
                      <span className="text-[8px] text-white/70">{date.time}</span>
                    </div>
                  </div>

                  {/* Event card */}
                  <div
                    className={cn(
                      'rounded-2xl overflow-hidden border',
                      isFeatured ? 'border-violet-500/30 shadow-glow' : 'border-border/40',
                    )}
                    style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.06), rgba(99,102,241,0.03))' }}
                  >
                    {/* Hero image (featured only) */}
                    {isFeatured && event.image && (
                      <div className="relative h-28 overflow-hidden">
                        <img src={assetUrl(event.image)} alt="" className="w-full h-full object-cover" loading="lazy" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                        <div className="absolute bottom-2 left-3">
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-violet-500/90 text-white backdrop-blur-sm">
                            ⭐ ОСОБОЕ СОБЫТИЕ
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="p-3">
                      <h3 className="font-bold text-sm leading-tight">{event.title}</h3>
                      <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{event.description}</p>

                      {/* Meta row */}
                      <div className="flex flex-wrap items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                        {event.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {event.location}
                          </span>
                        )}
                        {event.attendeesCount != null && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {event.attendeesCount}{event.maxAttendees ? `/${event.maxAttendees}` : ''} участников
                          </span>
                        )}
                        <EventCountdownDisplay startsAt={event.startsAt} />
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={() => handleRegister(event)}
                          disabled={isRegistered || isRegistering || isFull}
                          className={cn(
                            'flex-1 h-9 rounded-xl text-xs font-bold transition-all',
                            isRegistered
                              ? 'bg-emerald-500/20 text-emerald-500'
                              : isFull
                                ? 'bg-foreground/5 text-muted-foreground'
                                : 'text-white active:scale-95',
                          )}
                          style={!isRegistered && !isFull ? { background: 'linear-gradient(135deg, #8b5cf6, #6366f1)' } : undefined}
                        >
                          {isRegistering ? '...' : isRegistered ? '✓ Зарегистрированы' : isFull ? 'Мест нет' : 'Зарегистрироваться'}
                        </button>
                        <button
                          onClick={() => { haptic.tap(); downloadIcs(event); toast.success('Добавлено в календарь') }}
                          className="h-9 w-9 rounded-xl bg-foreground/5 grid place-items-center hover:bg-foreground/10 transition-colors shrink-0"
                          aria-label="Добавить в календарь"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>

        {events.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <CalendarDays className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground text-center px-4">
              События скоро появятся. Следите за эксклюзивными мероприятиями!
            </p>
          </div>
        )}
      </div>
    </ClubSheetWrapper>
  )
}

/** Event countdown display — shows "через Xд Yч" or nothing if passed. */
function EventCountdownDisplay({ startsAt }: { startsAt: string }) {
  const countdown = useCountdown(startsAt)
  if (!countdown) return null
  return (
    <span className="flex items-center gap-1 text-violet-500 font-semibold">
      <Clock className="h-3 w-3" />
      через {countdown}
    </span>
  )
}
