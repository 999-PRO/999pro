'use client'

// ============================================================================
// MediaHubIcon — единая фирменная иконка Media Hub
// ----------------------------------------------------------------------------
// Современная минималистичная glass-иконка, ассоциирующаяся одновременно с
// музыкой и видео. Состоит из:
//   • Скруглённого квадрата с brand-градиентом (indigo → purple → pink)
//   • Символа Play (треугольник) — видео
//   • Звуковых волн / эквалайзера — музыка
// Используется везде: в чате, в мобильном хедере, в сайдбаре, внутри Media Hub.
// ============================================================================

import { motion } from 'framer-motion'

interface MediaHubIconProps {
  size?: number
  className?: string
  /** Когда true — эквалайзер плавно "играет" (для использования в активных кнопках) */
  animated?: boolean
  /** Когда true — рисует только внутренний контент (без gradient-фона),
   *  для использования внутри уже стилизованной кнопки */
  bare?: boolean
  /** Стиль фоновой плитки */
  tileStyle?: React.CSSProperties
}

export function MediaHubIcon({
  size = 24,
  className,
  animated = false,
  bare = false,
  tileStyle,
}: MediaHubIconProps) {
  const pad = size * 0.18
  const innerSize = size - pad * 2
  const barW = innerSize * 0.10
  const gap = innerSize * 0.06
  const playSize = innerSize * 0.42

  const bars = [0.55, 0.95, 0.70, 0.40]
  const barsStart = pad + playSize + gap * 2
  const centerY = size / 2

  const tile = bare ? null : (
    <rect
      x={0}
      y={0}
      width={size}
      height={size}
      rx={size * 0.28}
      ry={size * 0.28}
      fill="url(#mh-grad)"
      style={tileStyle}
    />
  )

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="mh-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
      </defs>

      {tile}

      {/* Play triangle — video */}
      <path
        d={`M ${pad + playSize * 0.15} ${centerY - playSize / 2}
            L ${pad + playSize * 0.85} ${centerY}
            L ${pad + playSize * 0.15} ${centerY + playSize / 2}
            Z`}
        fill="white"
        opacity={0.95}
      />

      {/* Equalizer bars — music */}
      {bars.map((h, i) => {
        const x = barsStart + i * (barW + gap)
        const barH = innerSize * h
        const y = centerY - barH / 2
        if (animated) {
          return (
            <motion.rect
              key={i}
              x={x}
              y={y}
              width={barW}
              height={barH}
              rx={barW / 2}
              fill="white"
              opacity={0.9}
              animate={{
                height: [barH, barH * 0.4, barH * 0.85, barH * 0.55, barH],
                y: [y, centerY - (barH * 0.4) / 2, centerY - (barH * 0.85) / 2, centerY - (barH * 0.55) / 2, y],
              }}
              transition={{
                duration: 0.9 + i * 0.18,
                repeat: Infinity,
                repeatType: 'mirror',
                ease: 'easeInOut',
              }}
            />
          )
        }
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={barH}
            rx={barW / 2}
            fill="white"
            opacity={0.9}
          />
        )
      })}
    </svg>
  )
}
