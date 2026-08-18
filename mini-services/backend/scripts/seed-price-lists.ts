// Create test price lists (PDF placeholder + image placeholder).
// Uses publicly available sample files.
// Usage: npx tsx scripts/seed-price-lists.ts

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const TEST_ITEMS = [
  {
    title: 'Прайс на рекламную продукцию',
    description: 'Актуальные цены на брендирование, визитки, листовки. Обновлён в августе 2026.',
    fileUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    fileType: 'pdf',
    category: 'Реклама',
    visible: true,
    sortOrder: 0,
  },
  {
    title: 'Каталог подарочной продукции',
    description: 'Подарочные наборы, сувениры, корпоративные подарки. Полный каталог с фото.',
    fileUrl: 'https://images.unsplash.com/photo-1513885535751-8b9238bd345a?w=1200',
    fileType: 'image',
    category: 'Подарки',
    visible: true,
    sortOrder: 1,
  },
  {
    title: 'Прайс на мебель',
    description: 'Мягкая и корпусная мебель. Цены указаны за базовую комплектацию.',
    fileUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    fileType: 'pdf',
    category: 'Мебель',
    visible: true,
    sortOrder: 2,
  },
]

async function main() {
  let created = 0
  let skipped = 0
  for (const item of TEST_ITEMS) {
    const existing = await prisma.priceList.findFirst({ where: { title: item.title } })
    if (existing) {
      skipped++
      continue
    }
    await prisma.priceList.create({ data: item })
    created++
  }
  console.log(`Created: ${created}, skipped: ${skipped}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
