'use client'

/**
 * TaskSheet — 🎯 bespoke task/quest experience.
 *
 * Visual identity: quest-board layout. Daily tasks at top in a horizontal
 * scroll (progress rings). One-time tasks below as a vertical list. Each
 * completion triggers a checkmark-draw animation + coin burst. Streak
 * counter at top.
 */

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Target, Check, Flame, Calendar, Zap } from 'lucide-react'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { clubApi } from '../../api'
import type { ClubTask, ClubCardMeta } from '../../types'
import { taskComplete, confettiBurst } from '../../animations'
import { ClubSheetWrapper } from './club-sheet-wrapper'

interface TaskSheetProps {
  tasks: ClubTask[]
  meta: ClubCardMeta
  onClose: () => void
  onChanged: () => Promise<void>
}

export function TaskSheet({ tasks, meta, onClose, onChanged }: TaskSheetProps) {
  const [completing, setCompleting] = useState<string | null>(null)
  const [completeBurst, setCompleteBurst] = useState<string | null>(null)

  const dailyTasks = tasks.filter((t) => t.taskType === 'daily')
  const oneTimeTasks = tasks.filter((t) => t.taskType === 'one-time')
  const completedCount = tasks.filter((t) => t.isCompleted).length

  const handleComplete = useCallback(async (task: ClubTask) => {
    if (task.isCompleted) return
    haptic.heavy()
    setCompleting(task.id)
    try {
      const res = await clubApi.completeTask(task.id)
      setCompleteBurst(task.id)
      haptic.success()
      setTimeout(() => setCompleteBurst(null), 800)
      toast.success(
        res.pointsAwarded > 0 ? `⭐ +${res.pointsAwarded} баллов!` : '✓ Выполнено!',
        { description: task.title, sound: 'club' },
      )
      await onChanged()
    } catch (e: any) {
      haptic.error()
      toast.error(e?.message || 'Не удалось выполнить задание')
    } finally {
      setCompleting(null)
    }
  }, [onChanged])

  return (
    <ClubSheetWrapper
      meta={meta}
      onClose={onClose}
      subtitle="Выполняйте задания и зарабатывайте баллы"
      headerExtra={
        <div className="flex items-center gap-3">
          <div className="flex-1 rounded-2xl glass border border-border/40 p-3 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-orange-500/15 grid place-items-center shrink-0">
              <Flame className="h-5 w-5 text-orange-500" fill="currentColor" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Прогресс дня</div>
              <div className="font-bold text-sm">{completedCount} / {tasks.length} выполнено</div>
            </div>
          </div>
          <div className="rounded-2xl glass border border-border/40 p-3 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-sky-500/15 grid place-items-center shrink-0">
              <Zap className="h-5 w-5 text-sky-500" fill="currentColor" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Всего баллов</div>
              <div className="font-bold text-sm">{tasks.reduce((s, t) => s + t.pointsReward, 0)} ⭐</div>
            </div>
          </div>
        </div>
      }
    >
      <div className="p-4 space-y-5">
        {/* Daily tasks */}
        {dailyTasks.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2 px-1">
              <Calendar className="h-4 w-4 text-sky-500" />
              <h3 className="text-sm font-bold">Ежедневные</h3>
              <span className="text-[10px] text-muted-foreground">обновляются в 00:00</span>
            </div>
            <div className="space-y-2">
              {dailyTasks.map((task, i) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  index={i}
                  completing={completing === task.id}
                  bursting={completeBurst === task.id}
                  onComplete={() => handleComplete(task)}
                />
              ))}
            </div>
          </div>
        )}

        {/* One-time tasks */}
        {oneTimeTasks.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2 px-1">
              <Target className="h-4 w-4 text-violet-500" />
              <h3 className="text-sm font-bold">Разовые задания</h3>
            </div>
            <div className="space-y-2">
              {oneTimeTasks.map((task, i) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  index={i}
                  completing={completing === task.id}
                  bursting={completeBurst === task.id}
                  onComplete={() => handleComplete(task)}
                />
              ))}
            </div>
          </div>
        )}

        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Target className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground text-center px-4">
              Задания скоро появятся. Зарабатывайте баллы за активность!
            </p>
          </div>
        )}
      </div>
    </ClubSheetWrapper>
  )
}

function TaskRow({
  task,
  index,
  completing,
  bursting,
  onComplete,
}: {
  task: ClubTask
  index: number
  completing: boolean
  bursting: boolean
  onComplete: () => void
}) {
  const isCompleted = task.isCompleted

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3 }}
      className={cn(
        'relative rounded-2xl overflow-hidden border p-3',
        isCompleted ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-border/40 glass',
      )}
    >
      <div className="flex items-center gap-3">
        {/* Checkmark circle */}
        <motion.button
          onClick={onComplete}
          disabled={isCompleted || completing}
          variants={taskComplete}
          initial="idle"
          animate={bursting ? 'complete' : 'idle'}
          className={cn(
            'relative h-11 w-11 rounded-full grid place-items-center shrink-0 transition-all',
            isCompleted
              ? 'bg-emerald-500'
              : completing
                ? 'bg-sky-500/20'
                : 'bg-foreground/5 active:scale-90',
          )}
        >
          {isCompleted ? (
            <motion.div
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 15 }}
            >
              <Check className="h-6 w-6 text-white" strokeWidth={3} />
            </motion.div>
          ) : completing ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            >
              <Target className="h-5 w-5 text-sky-500" />
            </motion.div>
          ) : (
            <div className="h-6 w-6 rounded-full border-2 border-muted-foreground/40" />
          )}
        </motion.button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h4 className={cn('font-semibold text-sm leading-tight', isCompleted && 'line-through text-muted-foreground')}>
            {task.title}
          </h4>
          <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{task.description}</p>
        </div>

        {/* Reward */}
        <div className="shrink-0 text-right">
          <div className="flex items-center gap-0.5 justify-end">
            <span className="text-xs">⭐</span>
            <span className="font-bold text-sm text-amber-500">+{task.pointsReward}</span>
          </div>
        </div>
      </div>

      {/* Burst on complete */}
      <AnimatePresence>
        {bursting && (
          <>
            {[...Array(6)].map((_, j) => (
              <motion.div
                key={j}
                variants={confettiBurst}
                initial="idle"
                animate="burst"
                className="absolute w-2 h-2 rounded-full pointer-events-none"
                style={{
                  background: ['#8b5cf6', '#ec4899', '#f59e0b', '#10b981'][j % 4],
                  top: '50%', left: '30px',
                  x: Math.cos((j / 6) * Math.PI * 2) * 50,
                  y: Math.sin((j / 6) * Math.PI * 2) * 50,
                }}
              />
            ))}
          </>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
