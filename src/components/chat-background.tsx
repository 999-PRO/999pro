'use client'

// ChatBackground — decorative animated SVG wallpaper for chat views.
// Renders soft floating shapes, "TRI999" text snippets, and small icons
// (chat bubbles, megaphone, shopping bag) at very low opacity so they
// don't compete with content but add visual life to the background.
//
// Fixed position, pointer-events: none, z-0 — sits behind everything.

const SHAPES = [
  // Top-left cluster — chat bubble + TRI999 text
  { type: 'bubble', x: '5%', y: '8%', size: 80, rotation: -15, delay: 0 },
  { type: 'text', x: '12%', y: '15%', text: 'TRI999', size: 24, delay: 1.5 },
  { type: 'bubble', x: '85%', y: '12%', size: 60, rotation: 20, delay: 0.8 },
  { type: 'text', x: '78%', y: '22%', text: 'TRI999', size: 18, delay: 2.2 },
  // Mid-section — megaphone + shopping bag
  { type: 'megaphone', x: '8%', y: '45%', size: 50, rotation: -10, delay: 1.2 },
  { type: 'bag', x: '88%', y: '50%', size: 45, rotation: 15, delay: 0.5 },
  { type: 'bubble', x: '15%', y: '70%', size: 70, rotation: 10, delay: 1.8 },
  { type: 'text', x: '82%', y: '75%', text: 'TRI999', size: 20, delay: 0.3 },
  // Bottom scattered
  { type: 'bubble', x: '45%', y: '85%', size: 55, rotation: -5, delay: 2.5 },
  { type: 'megaphone', x: '92%', y: '88%', size: 40, rotation: 25, delay: 1.0 },
  { type: 'text', x: '3%', y: '90%', text: 'TRI999', size: 16, delay: 1.7 },
  // Floating soft circles
  { type: 'circle', x: '30%', y: '25%', size: 120, color: 'rgba(96,165,250,0.04)', delay: 0 },
  { type: 'circle', x: '70%', y: '60%', size: 90, color: 'rgba(167,139,250,0.04)', delay: 1.0 },
  { type: 'circle', x: '50%', y: '50%', size: 150, color: 'rgba(94,234,212,0.03)', delay: 2.0 },
  { type: 'circle', x: '20%', y: '55%', size: 70, color: 'rgba(251,113,133,0.03)', delay: 0.5 },
  { type: 'circle', x: '85%', y: '35%', size: 100, color: 'rgba(253,224,71,0.03)', delay: 1.5 },
]

export function ChatBackground() {
  return (
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    >
      {SHAPES.map((shape, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: shape.x,
            top: shape.y,
            transform: `rotate(${shape.rotation || 0}deg)`,
          }}
        >
          {shape.type === 'bubble' && <BubbleIcon size={shape.size} />}
          {shape.type === 'megaphone' && <MegaphoneIcon size={shape.size} />}
          {shape.type === 'bag' && <BagIcon size={shape.size} />}
          {shape.type === 'circle' && (
            <div
              style={{
                width: shape.size,
                height: shape.size,
                borderRadius: '50%',
                background: shape.color,
                filter: 'blur(20px)',
              }}
            />
          )}
          {shape.type === 'text' && (
            <span
              style={{
                fontSize: shape.size,
                fontWeight: 800,
                color: 'rgba(96, 165, 250, 0.06)',
                letterSpacing: '0.05em',
                whiteSpace: 'nowrap',
              }}
            >
              {shape.text}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function BubbleIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ color: 'rgba(96, 165, 250, 0.07)' }}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}

function MegaphoneIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ color: 'rgba(251, 113, 133, 0.06)' }}>
      <path d="m3 11 18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </svg>
  )
}

function BagIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ color: 'rgba(94, 234, 212, 0.06)' }}>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  )
}
