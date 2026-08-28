'use client'

// ============================================================================
// NeuroReveal — v25.19 (owner): «при скролле товаров сделай красивую
// анимацию, как будто всё генерируется нейросетью».
// ----------------------------------------------------------------------------
// Обёртка для карточек товара в сетках (главная, каталог). При входе в
// вьюпорт карточка «материализуется»: blur → резкость, scale 0.9 → 1,
// подъём, плюс ОДНОКРАТНЫЙ световой «скан» — полоска, пробегающая по
// карточке сверху вниз, как строка прогресса генерации в нейросетях.
//
// Производительность: только transform/opacity/filter, viewport once,
// prefers-reduced-motion уважается (motion не анимирует, скан скрыт).
// ============================================================================

import { useState } from 'react'
import { motion } from 'framer-motion'

interface NeuroRevealProps {
  children: React.ReactNode
  /** Задержка каскада (сек) — по индексу карточки в сетке. */
  delay?: number
  className?: string
}

export function NeuroReveal({ children, delay = 0, className }: NeuroRevealProps) {
  const [scan, setScan] = useState(false)

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 26, scale: 0.92, filter: 'blur(10px) saturate(0.6)' }}
      whileInView={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px) saturate(1)' }}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      transition={{
        duration: 0.55,
        delay: Math.min(delay, 0.4),
        ease: [0.22, 1, 0.36, 1],
      }}
      onViewportEnter={() => setScan(true)}
    >
      <div className="relative">
        {children}
        {/* Световой «скан генерации» — пробегает один раз при появлении */}
        {scan && (
          <span
            aria-hidden
            className="neuro-scan pointer-events-none absolute inset-0 rounded-2xl overflow-hidden"
          />
        )}
      </div>
    </motion.div>
  )
}
