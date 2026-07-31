// Seed the database with demo catalog, stories and posts.
// Run with: npm run db:seed
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const PRODUCT_IMAGES = {
  sneakers: [
    'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800',
    'https://images.unsplash.com/photo-1551107696-a4b0c5a0d9a2?w=800',
    'https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=800',
  ],
  watch: [
    'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800',
    'https://images.unsplash.com/photo-1524805444758-089113d48a6d?w=800',
    'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=800',
  ],
  headphones: [
    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800',
    'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=800',
    'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=800',
  ],
  backpack: [
    'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800',
    'https://images.unsplash.com/photo-1547949003-9792a18a2601?w=800',
    'https://images.unsplash.com/photo-1577733966973-dff800f1ef5b?w=800',
  ],
  phone: [
    'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800',
    'https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?w=800',
    'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=800',
  ],
  sunglasses: [
    'https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=800',
    'https://images.unsplash.com/photo-1577803645773-f96470509666?w=800',
    'https://images.unsplash.com/photo-1473496169904-658ba7c44d8a?w=800',
  ],
  coffee: [
    'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=800',
    'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800',
    'https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=800',
  ],
  camera: [
    'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=800',
    'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=800',
    'https://images.unsplash.com/photo-1606983340126-99ab4feaa64a?w=800',
  ],
}

const AVATARS = [
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200',
  'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200',
  'https://images.unsplash.com/photo-1547425260-76bcadfb4f2c?w=200',
]

async function main() {
  // D-HIGH-011 fix: refuse to seed in production. Previously an operator
  // could run `bun run db:seed` on prod and silently overwrite real product
  // data (title/price/category/oldPrice/isPopular) with demo values via upsert.
  // v9-audit-fix: fixed broken boolean logic — `!process.env.SEED_FORCE === '1'`
  // was always false (boolean !== string), so the guard never triggered.
  if (process.env.NODE_ENV === 'production' && process.env.SEED_FORCE !== '1') {
    console.error('REFUSING to seed in production. Set SEED_FORCE=1 to override.')
    process.exit(1)
  }
  console.log('Seeding «Три девятки» database...')

  // --- Users ---
  // NOTE: No admin is seeded. The first admin must be created via Studio's
  // first-run setup wizard (POST /api/auth/setup-admin). This enforces that
  // the admin credentials are chosen by the operator, not hardcoded.
  //
  // SECURITY (Phase 3): Demo password is now read from SEED_USER_PASSWORD
  // env var. Default 'demo12345' is still weak but no longer in top-1000
  // brute-force list like '123456' was. For production-like environments,
  // always set SEED_USER_PASSWORD to a strong value.
  const seedPassword = process.env.SEED_USER_PASSWORD || 'demo12345'
  if (seedPassword.length < 8) {
    console.warn(`WARNING: SEED_USER_PASSWORD is only ${seedPassword.length} chars (recommend 12+).`)
  }
  const password = await bcrypt.hash(seedPassword, 12)
  console.log(`Using seed password from SEED_USER_PASSWORD env (length: ${seedPassword.length})`)
  const users = [
    { username: 'maria_k', email: 'maria@999.pro', displayName: 'Maria K.', phone: '+79992345678', role: 'user' },
    { username: 'denis_dev', email: 'denis@999.pro', displayName: 'Denis Dev', phone: '+79993456789', role: 'user' },
    { username: 'kate_shop', email: 'kate@999.pro', displayName: 'Kate Shop', phone: '+79994567890', role: 'user' },
    { username: 'ivan_brand', email: 'ivan@999.pro', displayName: 'Ivan Brand', phone: '+79995678901', role: 'user' },
  ]

  const createdUsers = []
  for (let i = 0; i < users.length; i++) {
    const u = await prisma.user.upsert({
      where: { email: users[i].email },
      update: {},
      create: { ...users[i], password, avatar: AVATARS[i % AVATARS.length] },
    })
    createdUsers.push(u)
  }

  // --- Products ---
  const productSeed = [
    { title: 'Кроссовки Air Runner Pro', category: 'Подарки', price: 8990, oldPrice: 12990, popular: true, images: PRODUCT_IMAGES.sneakers, description: 'Лёгкие беговые кроссовки с амортизирующей подошвой и дышащим верхом. Идеальный подарок для активных людей.' },
    { title: 'Смарт-часы Pulse X2', category: 'Дизайн', price: 15490, oldPrice: 19990, popular: true, images: PRODUCT_IMAGES.watch, description: 'Смарт-часы с пульсометром, GPS и алюминиевым корпусом. Минималистичный дизайн от итальянской студии.' },
    { title: 'Беспроводные наушники AuraBuds 3', category: 'Подарки', price: 6490, popular: true, images: PRODUCT_IMAGES.headphones, description: 'TWS наушники с активным шумоподавлением и 30 часами автономности. Отличный подарок меломану.' },
    { title: 'Городской рюкзак Urban Pack', category: 'Дизайн', price: 4290, oldPrice: 5990, popular: false, images: PRODUCT_IMAGES.backpack, description: 'Водонепроницаемый рюкзак с отделением для ноутбука 16 дюймов. Дизайн разработан в студии «Три девятки».' },
    { title: 'Смартфон Vision 12 Pro', category: 'Дизайн', price: 79990, oldPrice: 89990, popular: true, images: PRODUCT_IMAGES.phone, description: '6.7" AMOLED дисплей, тройная камера 50 Мп, 256 ГБ памяти. Премиальный дизайн с титановой рамкой.' },
    { title: 'Солнцезащитные очки Polar', category: 'Подарки', price: 3290, popular: false, images: PRODUCT_IMAGES.sunglasses, description: 'Поляризационные линзы, лёгкая титановая оправа. Стильный подарок к летнему сезону.' },
    { title: 'Кофемашина Brew Master', category: 'Интерьер', price: 18990, popular: false, images: PRODUCT_IMAGES.coffee, description: 'Автоматическая кофемашина с капучинатором и Wi-Fi. Идеально впишется в современный интерьер кухни.' },
    { title: 'Беззеркальная камера Lumix 30', category: 'Печать', price: 64990, oldPrice: 74990, popular: true, images: PRODUCT_IMAGES.camera, description: 'Камера с матрицей 24 Мп, 4K видео 60fps и поворотным экраном. Подходит для съёмки полиграфии и рекламы.' },
    { title: 'Баннерная ткань Premium 510 г/м²', category: 'Наружная реклама', price: 890, popular: true, images: PRODUCT_IMAGES.camera, description: 'Плотная баннерная ткань для наружной рекламы. Устойчива к УФ-излучению и осадкам, срок службы 3+ года.' },
    { title: 'Визитки Premium 350 г/м²', category: 'Полиграфия', price: 1490, oldPrice: 1990, popular: true, images: PRODUCT_IMAGES.watch, description: 'Плотные матовые визитки с софт-тач покрытием. Печать офсетом, тираж от 100 штук.' },
    { title: 'Дизайн логотипа «Бренд»', category: 'Дизайн', price: 9990, popular: true, images: PRODUCT_IMAGES.sunglasses, description: 'Разработка логотипа: 3 концепта, правки, исходники в SVG/AI/PNG. Дизайнеры студии «Три девятки».', isAction: true, isNew: false, isRecommended: true },
    { title: 'Кресло офисное Ergo Pro', category: 'Мебель', price: 24990, oldPrice: 29990, popular: false, images: PRODUCT_IMAGES.backpack, description: 'Эргономичное офисное кресло с поясничной поддержкой, регулировкой высоты и наклона. Сетка премиум.' },
    { title: 'Листовки А5, плотность 200 г/м²', category: 'Полиграфия', price: 690, popular: false, images: PRODUCT_IMAGES.sneakers, description: 'Цветная печать листовок А5 офсетом. Бумага 200 г/м², тираж от 500 штук, лакировка.' },
    { title: 'Лайтбокс LED 60×90', category: 'Наружная реклама', price: 12490, popular: true, images: PRODUCT_IMAGES.headphones, description: 'Световой лайтбокс с LED-подсветкой 60×90 см. Алюминиевый профиль, двусторонняя печать.' },
    { title: 'Шкаф-стеллаж Loft 4 секции', category: 'Мебель', price: 38990, popular: false, images: PRODUCT_IMAGES.coffee, description: 'Стеллаж в стиле лофт из массива дуба и металла. 4 секции, выдерживает до 80 кг на полку.' },
    { title: 'Рекламная кампания в Instagram', category: 'Реклама', price: 49990, popular: true, images: PRODUCT_IMAGES.phone, description: 'Комплексное ведение рекламы: таргет, креативы, аналитика. Стратегия от маркетингового агентства «Три девятки».' },
    { title: 'Подарочный набор «Аромат дома»', category: 'Подарки', price: 4990, popular: true, images: PRODUCT_IMAGES.sunglasses, description: 'Свечи, диффузор и ароматические саше в деревянной шкатулке. Готовый подарок для ценителей уюта.' },
    { title: 'Постер интерьерный «Абстракция»', category: 'Интерьер', price: 2490, popular: false, images: PRODUCT_IMAGES.backpack, description: 'Интерьерный постер А2 на холсте, рамка в комплекте. Авторская работа, лимитированная серия.' },
    { title: 'Печать фотокниги 30×30, 30 стр.', category: 'Печать', price: 3490, popular: false, images: PRODUCT_IMAGES.camera, description: 'Фотокнига 30×30 см, 30 разворотов. Ламинированная бумага, твёрдый переплёт, тиснение фольгой.' },
    { title: 'Контекстная реклама Яндекс.Директ', category: 'Реклама', price: 29990, popular: true, images: PRODUCT_IMAGES.headphones, description: 'Настройка и ведение контекстной рекламы в Яндекс.Директ. 5 кампаний, A/B-тесты, еженедельные отчёты.' },
  ]

  for (const p of productSeed) {
    // v11: assign a random quantity between 0 and 50. Popular products
    // get higher stock (15-50), others get 0-15 (some out of stock, some low).
    const stockQty = p.popular
      ? Math.floor(Math.random() * 36) + 15  // 15-50
      : Math.floor(Math.random() * 16)        // 0-15 (some will be 0 = "Нет в наличии")
    await prisma.product.upsert({
      where: { id: p.title.replace(/\s+/g, '-').toLowerCase() },
      update: {
        description: p.description,
        category: p.category,
        price: p.price,
        oldPrice: p.oldPrice,
        isPopular: p.popular,
        quantity: stockQty,
      },
      create: {
        id: p.title.replace(/\s+/g, '-').toLowerCase(),
        title: p.title,
        description: p.description,
        price: p.price,
        oldPrice: p.oldPrice,
        category: p.category,
        images: JSON.stringify(p.images),
        rating: 4 + Math.random(),
        reviewsCount: Math.floor(Math.random() * 200) + 10,
        isPopular: p.popular,
        inStock: true,
        quantity: stockQty,
      },
    })
  }

  // --- Stories ---
  // v12.3: Stories + Posts + Comments + Likes seed blocks removed with
  // the Feed module. The corresponding Prisma models have been deleted.

  console.log('✅ Seed completed')
  console.log(`   Users: ${createdUsers.length} (password from SEED_USER_PASSWORD env)`)
  console.log(`   ⚠ No admin seeded. Use Studio's first-run wizard to create one.`)
  console.log(`   Products: ${productSeed.length}`)
  // v12.3: Stories / Posts counts removed with the Feed module.
}

// Seed default banners if none exist
async function seedBanners() {
  const count = await prisma.banner.count()
  if (count > 0) {
    console.log(`   Banners: ${count} (already exist)`)
    return
  }
  const banners = [
    {
      title: 'Лето до -40%',
      subtitle: 'Стильная коллекция для ярких дней',
      cta: 'Смотреть',
      image: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1200',
      gradient: 'from-sky-400 via-blue-500 to-indigo-600',
      order: 0,
      isActive: true,
    },
    {
      title: 'Гаджеты недели',
      subtitle: 'Смартфоны, наушники и часы со скидкой',
      cta: 'В каталог',
      image: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=1200',
      gradient: 'from-fuchsia-500 via-purple-500 to-indigo-600',
      order: 1,
      isActive: true,
    },
    {
      title: 'Бесплатная доставка',
      subtitle: 'При заказе от 5 000 ₽ по всей России',
      cta: 'Подробнее',
      image: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=1200',
      gradient: 'from-emerald-400 via-teal-500 to-cyan-600',
      order: 2,
      isActive: true,
    },
  ]
  for (const b of banners) {
    await prisma.banner.create({ data: b })
  }
  console.log(`   Banners: ${banners.length} (created)`)
}

main()
  .then(() => seedBanners())
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
