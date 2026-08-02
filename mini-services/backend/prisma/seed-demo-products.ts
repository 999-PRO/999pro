// Seed marketplace demo products with real images (Unsplash).
// Run: cd mini-services/backend && ./node_modules/.bin/tsx prisma/seed-demo-products.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface DemoProduct {
  title: string
  description: string
  price: number
  oldPrice?: number
  category: string
  images: string[]
  isPopular?: boolean
  isNew?: boolean
  isAction?: boolean
  isRecommended?: boolean
  isTrending?: boolean
  isPremium?: boolean
  quantity?: number
  rating?: number
  reviewsCount?: number
}

const DEMO: DemoProduct[] = [
  // === Печать и баннеры ===
  {
    title: 'Баннер рекламный 3×2 м',
    description: 'Печать на ПВХ-ткани 440 г/м². Подходит для уличной рекламы, пресс-воллов, фотозон. Кромка с люверсами через 50 см.',
    price: 2700,
    oldPrice: 3500,
    category: 'Печать и баннеры',
    images: ['https://images.unsplash.com/photo-1559586770-2ecdf8e9b8a3?w=600&q=80'],
    isAction: true,
    isPopular: true,
    quantity: 100,
    rating: 4.8,
    reviewsCount: 124,
  },
  {
    title: 'Баннер mesh 5×3 м',
    description: 'Сетчатый баннер для ветреных мест. Плотность 270 г/м². Пропускает ветер, не рвётся.',
    price: 6750,
    category: 'Печать и баннеры',
    images: ['https://images.unsplash.com/photo-1598300283661-5f0d5b8c5a00?w=600&q=80'],
    isNew: true,
    quantity: 30,
    rating: 4.7,
    reviewsCount: 18,
  },
  // === Вывески ===
  {
    title: 'Объёмная вывеска с подсветкой',
    description: 'Объёмные буквы из акрила 3 мм с LED-подсветкой. Класс защиты IP65. Срок службы LED 50 000 часов.',
    price: 25000,
    oldPrice: 32000,
    category: 'Вывески',
    images: ['https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=600&q=80'],
    isPremium: true,
    isPopular: true,
    quantity: 15,
    rating: 4.9,
    reviewsCount: 67,
  },
  {
    title: 'Световой короб лайтбокс',
    description: 'Лайтбокс с подсветкой по периметру. Алюминиевый профиль, баннерная ткань с сублимацией.',
    price: 12000,
    category: 'Вывески',
    images: ['https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&q=80'],
    quantity: 25,
    rating: 4.6,
    reviewsCount: 34,
  },
  // === Сувениры ===
  {
    title: 'Кружка керамическая с принтом',
    description: 'Керамическая кружка 330 мл с сублимационной печатью. Стойкая к посудомоечной машине.',
    price: 450,
    oldPrice: 600,
    category: 'Сувениры',
    images: ['https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=600&q=80'],
    isAction: true,
    isPopular: true,
    quantity: 500,
    rating: 4.9,
    reviewsCount: 312,
  },
  {
    title: 'Фотокамень 20×30 см',
    description: 'Печать фотографии на натуральном мраморе. УФ-печать, не выцветает 25+ лет. Подходит для подарков и памятных дат.',
    price: 2500,
    category: 'Сувениры',
    images: ['https://images.unsplash.com/photo-1578321272176-b7bbc0679853?w=600&q=80'],
    isPremium: true,
    isRecommended: true,
    quantity: 50,
    rating: 5.0,
    reviewsCount: 89,
  },
  {
    title: 'Футболка с принтом',
    description: 'Хлопковая футболка 180 г/м² с прямой цифровой печатью. Не выцветает, не трескается.',
    price: 890,
    oldPrice: 1200,
    category: 'Сувениры',
    images: ['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&q=80'],
    isAction: true,
    isTrending: true,
    quantity: 200,
    rating: 4.7,
    reviewsCount: 156,
  },
  {
    title: 'Табличка на дверь акриловая',
    description: 'Акриловая табличка 3 мм с гравировкой. Размер 20×10 см. Крепления в комплекте.',
    price: 1200,
    category: 'Сувениры',
    images: ['https://images.unsplash.com/photo-1583912267550-d6c2ac3196c0?w=600&q=80'],
    quantity: 80,
    rating: 4.6,
    reviewsCount: 42,
  },
  // === Наклейки ===
  {
    title: 'Наклейки виниловые (комплект 50 шт)',
    description: 'Виниловые наклейки с ламинацией. Любые формы и размеры. Для упаковки, рекламы, декора.',
    price: 1500,
    oldPrice: 2000,
    category: 'Наклейки',
    images: ['https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=600&q=80'],
    isAction: true,
    quantity: 1000,
    rating: 4.8,
    reviewsCount: 198,
  },
  {
    title: 'Стикеры на ноутбук (набор)',
    description: 'Водостойкие стикеры для ноутбука, телефона, планшета. Набор из 10 штук.',
    price: 350,
    category: 'Наклейки',
    images: ['https://images.unsplash.com/photo-1622543935937-99d5e7f6e7c3?w=600&q=80'],
    isNew: true,
    quantity: 500,
    rating: 4.7,
    reviewsCount: 76,
  },
  // === Материалы ===
  {
    title: 'Лист акрила 3 мм 100×200 см',
    description: 'Прозрачный акрил 3 мм. Подходит для вывесок, табличек, интерьерных конструкций.',
    price: 3200,
    category: 'Материалы',
    images: ['https://images.unsplash.com/photo-1567789884554-0b844b597180?w=600&q=80'],
    quantity: 40,
    rating: 4.5,
    reviewsCount: 23,
  },
  {
    title: 'ПВХ-пластик 5 мм 100×200 см',
    description: 'ПВХ-лист 5 мм для вывесок и объёмных букв. Лёгкий, не боится влаги.',
    price: 2100,
    category: 'Материалы',
    images: ['https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=600&q=80'],
    quantity: 60,
    rating: 4.4,
    reviewsCount: 15,
  },
  // === Полиграфия ===
  {
    title: 'Визитки (500 шт, ламинация)',
    description: 'Визитки 90×50 мм, бумага 300 г/м², матовая ламинация. Дизайн в подарок.',
    price: 1800,
    oldPrice: 2400,
    category: 'Полиграфия',
    images: ['https://images.unsplash.com/photo-1606857521015-7f9fcf423740?w=600&q=80'],
    isAction: true,
    isPopular: true,
    quantity: 10000,
    rating: 4.9,
    reviewsCount: 423,
  },
  {
    title: 'Листовки А5 (1000 шт)',
    description: 'Листовки А5, бумага 200 г/м², цветная печать с двух сторон. Доставка по городу бесплатно.',
    price: 3500,
    category: 'Полиграфия',
    images: ['https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=600&q=80'],
    quantity: 5000,
    rating: 4.7,
    reviewsCount: 88,
  },
  // === Ислам ===
  // v25.3 (TZ task #8): test category for UI verification — covers Muslim
  // lifestyle products. Two products so the category card / catalog grid
  // render check has data to display.
  {
    title: 'Книга «Сорок хадисов» — подарочное издание',
    description:
      'Сборник сорока хадисов имама ан-Навави в подарочном оформлении. ' +
      'Твёрдый переплёт, золотое тиснение, бумага премиум 120 г/м². ' +
      'Подходит для подарка на праздники и памятные даты.',
    price: 1290,
    oldPrice: 1690,
    category: 'Ислам',
    images: [
      'https://images.unsplash.com/photo-1532012197267-da84d127e765?w=600&q=80',
      'https://images.unsplash.com/photo-1457369804613-52c61a468e7d?w=600&q=80',
    ],
    isPopular: true,
    isRecommended: true,
    quantity: 80,
    rating: 4.9,
    reviewsCount: 47,
  },
  {
    title: 'Мусульманские чётки из дерева (99 бусин)',
    description:
      'Чётки (тасбих) из натурального дерева, 99 бусин, ручная полировка. ' +
      'Удобная форма бусин, приятная на ощупь текстура. В комплекте ' +
      'бархатный мешочек для хранения.',
    price: 690,
    oldPrice: 990,
    category: 'Ислам',
    images: [
      'https://images.unsplash.com/photo-1606112219348-204d7d8b94ee?w=600&q=80',
      'https://images.unsplash.com/photo-1518452590338-2f3a2b5b1ec9?w=600&q=80',
    ],
    isNew: true,
    isAction: true,
    quantity: 120,
    rating: 4.8,
    reviewsCount: 23,
  },
]

async function main() {
  console.log('Seeding marketplace demo products...')

  // Check existing
  const existing = await prisma.product.count()
  if (existing > 0) {
    console.log(`Found ${existing} existing products. Skipping seed (already has data).`)
    console.log('To re-seed, run: bunx tsx prisma/seed-demo-products.ts --force')
    return
  }

  let created = 0
  for (const p of DEMO) {
    const product = await prisma.product.create({
      data: {
        title: p.title,
        description: p.description,
        price: p.price,
        oldPrice: p.oldPrice || null,
        currency: 'RUB',
        category: p.category,
        images: JSON.stringify(p.images),
        rating: p.rating || 0,
        reviewsCount: p.reviewsCount || 0,
        inStock: true,
        quantity: p.quantity || 0,
        isPopular: p.isPopular || false,
        isAction: p.isAction || false,
        isNew: p.isNew || false,
        isRecommended: p.isRecommended || false,
        isTrending: p.isTrending || false,
        isPremium: p.isPremium || false,
      },
    })
    created++
    console.log(`  ✓ ${product.title} (${product.id.slice(-8)})`)
  }

  // Link KB products to marketplace products where applicable.
  const kbBanner = await prisma.aIKB_Product.findUnique({ where: { slug: 'banner' } })
  if (kbBanner) {
    const mpBanner = await prisma.product.findFirst({ where: { title: { contains: 'Баннер рекламный' } } })
    if (mpBanner) {
      await prisma.aIKB_Product.update({ where: { id: kbBanner.id }, data: { marketplaceProductId: mpBanner.id } })
      console.log(`  🔗 Linked KB "Баннер" → marketplace "${mpBanner.title}"`)
    }
  }
  const kbMug = await prisma.aIKB_Product.findUnique({ where: { slug: 'kruzhka' } })
  if (kbMug) {
    const mpMug = await prisma.product.findFirst({ where: { title: { contains: 'Кружка' } } })
    if (mpMug) {
      await prisma.aIKB_Product.update({ where: { id: kbMug.id }, data: { marketplaceProductId: mpMug.id } })
      console.log(`  🔗 Linked KB "Кружка" → marketplace "${mpMug.title}"`)
    }
  }
  const kbPhoto = await prisma.aIKB_Product.findUnique({ where: { slug: 'fotokamen' } })
  if (kbPhoto) {
    const mpPhoto = await prisma.product.findFirst({ where: { title: { contains: 'Фотокамень' } } })
    if (mpPhoto) {
      await prisma.aIKB_Product.update({ where: { id: kbPhoto.id }, data: { marketplaceProductId: mpPhoto.id } })
      console.log(`  🔗 Linked KB "Фотокамень" → marketplace "${mpPhoto.title}"`)
    }
  }
  const kbSign = await prisma.aIKB_Product.findUnique({ where: { slug: 'vyveska' } })
  if (kbSign) {
    const mpSign = await prisma.product.findFirst({ where: { title: { contains: 'вывеска' } } })
    if (mpSign) {
      await prisma.aIKB_Product.update({ where: { id: kbSign.id }, data: { marketplaceProductId: mpSign.id } })
      console.log(`  🔗 Linked KB "Вывеска" → marketplace "${mpSign.title}"`)
    }
  }

  console.log(`\n✓ Created ${created} demo products in marketplace.`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
