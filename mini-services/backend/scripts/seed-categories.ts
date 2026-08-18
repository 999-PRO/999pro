// Seed default categories + auto-link products
// Usage: npx tsx scripts/seed-categories.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const DEFAULT_CATEGORIES = [
  { name: 'Реклама', slug: 'reklama', icon: 'Megaphone' },
  { name: 'Подарки', slug: 'podarki', icon: 'Gift' },
  { name: 'Мебель', slug: 'mebel', icon: 'Armchair' },
  { name: 'Печать', slug: 'pechat', icon: 'Printer' },
  { name: 'Дизайн', slug: 'dizayn', icon: 'Palette' },
  { name: 'Интерьер', slug: 'interer', icon: 'Home' },
  { name: 'Наружная реклама', slug: 'naruzhnaya-reklama', icon: 'Billboard' },
  { name: 'Полиграфия', slug: 'poligrafiya', icon: 'FileText' },
]

async function main() {
  let created = 0
  let skipped = 0
  for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
    const def = DEFAULT_CATEGORIES[i]
    const existing = await prisma.category.findUnique({ where: { slug: def.slug } })
    if (existing) {
      skipped++
      continue
    }
    await prisma.category.create({
      data: {
        name: def.name,
        slug: def.slug,
        icon: def.icon,
        sortOrder: i,
        visible: true,
      },
    })
    created++
  }

  // Auto-link products
  const allCats = await prisma.category.findMany()
  const byName = new Map(allCats.map((c) => [c.name.toLowerCase(), c]))
  const products = await prisma.product.findMany({
    where: { categoryId: null, category: { not: null } },
    select: { id: true, category: true },
  })
  let linked = 0
  for (const p of products) {
    if (!p.category) continue
    const cat = byName.get(p.category.toLowerCase())
    if (cat) {
      await prisma.product.update({ where: { id: p.id }, data: { categoryId: cat.id } })
      linked++
    }
  }

  console.log(`Created: ${created}, skipped: ${skipped}, linked: ${linked}, total: ${allCats.length}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
