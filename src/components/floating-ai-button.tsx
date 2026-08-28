'use client'

// ============================================================================
// FloatingAIButton — v25.18.
// ----------------------------------------------------------------------------
// Раньше ИИ-агент занимал ЦЕНТР нижней навигации (премиум-кнопка в тапбаре).
// Владелец: «кнопку ИИ-агент из навигации можно сделать… висящую, чтобы
// освободить место» (в навигацию переехали Сообщества).
//
// Теперь это плавающая кнопка (FAB) над правым краем bottom-nav:
//   • градиентный орб с Искрами + мягкое «дыхание» (pulse-ring);
//   • скрывается, когда оверлей агента уже открыт (нет смысла в кнопке);
//   • respects module toggle 'ai-assistant' (Студия → Модули);
//   • только мобильные (md:hidden) — на десктопе агент доступен из TopBar.
// ============================================================================

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { haptic } from '@/lib/haptic'
import { useModuleAccess, isModuleEnabled } from '@/lib/use-module-access'
import { useAISession } from '@/modules/ai-assistant/ai-session-store'

export function FloatingAIButton() {
  const modules = useModuleAccess()
  const enabled = isModuleEnabled(modules, 'ai-assistant')
  // session.open — оверлей агента открыт → кнопку прячем.
  const aiOpen = useAISession((s) => s.open)
  const [mounted, setMounted] = useState(false)

  // Маленькая задержка входа — кнопка «выплывает» после загрузки страницы.
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 450)
    return () => clearTimeout(t)
  }, [])

  if (!enabled || aiOpen) return null

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.6, y: 16 }}
      animate={mounted ? { opacity: 1, scale: 1, y: 0 } : {}}
      whileTap={{ scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
      onClick={() => {
        haptic.tap()
        window.dispatchEvent(new CustomEvent('open-ai-assistant'))
      }}
      aria-label="Открыть ИИ-агента"
      className="md:hidden fixed right-4 z-40 grid place-items-center"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 86px)' }}
    >
      {/* Мягкое пульсирующее кольцо */}
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background: 'linear-gradient(135deg, #EC4899 0%, #A855F7 50%, #9333EA 100%)',
          opacity: 0.35,
        }}
        animate={{ scale: [1, 1.45], opacity: [0.35, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
      />
      <span
        className="relative grid place-items-center h-13 w-13 rounded-full text-white"
        style={{
          width: 52,
          height: 52,
          background: 'linear-gradient(135deg, #EC4899 0%, #A855F7 50%, #9333EA 100%)',
          boxShadow: '0 10px 26px -8px rgba(160,32,112,0.65), inset 0 1px 0 rgba(255,255,255,0.35)',
        }}
      >
        <Sparkles className="h-6 w-6" strokeWidth={2.2} />
      </span>
    </motion.button>
  )
}
