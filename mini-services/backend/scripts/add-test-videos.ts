// Add test video URLs to some products (for demo of feed + product page video).
// Uses royalty-free sample videos from Google's public sample bucket.
// Usage: npx tsx scripts/add-test-videos.ts

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Public sample videos (Google's sample bucket — widely used for testing)
const SAMPLE_VIDEOS = [
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
]

async function main() {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    take: 6,
    orderBy: { createdAt: 'desc' },
  })

  let updated = 0
  for (let i = 0; i < products.length; i++) {
    const p = products[i]
    const videoUrl = SAMPLE_VIDEOS[i % SAMPLE_VIDEOS.length]
    // Use first image as poster
    let poster: string | null = null
    try {
      const imgs = JSON.parse(p.images || '[]')
      if (Array.isArray(imgs) && imgs.length > 0) poster = String(imgs[0])
    } catch {}

    await prisma.product.update({
      where: { id: p.id },
      data: { videoUrl, videoPoster: poster },
    })
    updated++
  }

  console.log(`Updated ${updated} products with test videos`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
