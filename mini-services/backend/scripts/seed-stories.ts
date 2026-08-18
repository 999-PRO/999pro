// Seed 4 demo stories for testing.
// Usage: npx tsx scripts/seed-stories.ts

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const DEMO_STORIES = [
  {
    caption: 'Новая коллекция брендированной продукции 🎨',
    category: 'Реклама',
    media: JSON.stringify(['https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=800']),
    mediaType: 'image',
  },
  {
    caption: 'Подарочные наборы к Новому году 🎁',
    category: 'Подарки',
    media: JSON.stringify(['https://images.unsplash.com/photo-1513885535751-8b9238bd345a?w=800']),
    mediaType: 'image',
  },
  {
    caption: 'Мебель премиум-класса с 3D-просмотром 🪑',
    category: 'Мебель',
    media: JSON.stringify(['https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=800']),
    mediaType: 'image',
  },
  {
    caption: 'Скидки до 40% на полиграфию 📄',
    category: 'Печать',
    media: JSON.stringify(['https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=800']),
    mediaType: 'image',
  },
]

async function main() {
  // Find an admin user to attach stories to
  const admin = await prisma.user.findFirst({
    where: { role: 'admin', deletedAt: null },
  })

  if (!admin) {
    console.log('No admin user found — skipping stories seed')
    return
  }

  // Check if stories already exist
  const existing = await prisma.story.count()
  if (existing > 0) {
    console.log(`Stories already exist (${existing}) — skipping`)
    return
  }

  const expiresAt = new Date(Date.now() + 7 * 86400000) // 7 days from now

  for (const story of DEMO_STORIES) {
    await prisma.story.create({
      data: {
        userId: admin.id,
        media: story.media,
        mediaType: story.mediaType,
        caption: story.caption,
        category: story.category,
        expiresAt,
      },
    })
  }

  console.log(`Created ${DEMO_STORIES.length} demo stories`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
