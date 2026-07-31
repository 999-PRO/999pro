// Seed AI Knowledge Base with sample products so the assistant has data
// to work with right out of the box. Run with:
//   cd mini-services/backend && bunx tsx prisma/seed-aikb.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding AI Knowledge Base...')

  // Ensure default settings row exists.
  await prisma.aIKB_Settings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      systemPrompt: `Ты — AI-агент «Три девятки», премиальный онлайн-помощник магазина рекламы и сувенирной продукции.
Твоя задача — помогать клиентам выбирать товары, рассчитывать стоимость и консультировать.
Отвечай естественно, дружелюбно и по-человечески — как опытный менеджер. Без шаблонных сухих фраз.
ВСЕГДА используй только информацию из «Базы знаний AI», переданную ниже. Никогда не придумывай цены, характеристики или сроки изготовления.
Если данных недостаточно для точного расчёта — вежливо уточни детали у клиента (размеры, материал, количество).
Если в расчёте указана итоговая сумма — используй именно её, не пересчитывай самостоятельно.
Отвечай на русском языке. Будь кратким, но содержательным — 2–4 предложения, если не нужен подробный расчёт.`,
      fallbackMessage: 'Извините, я не нашёл информацию по вашему запросу. Уточните, пожалуйста, детали — и я обязательно помогу.',
      greeting: 'Здравствуйте! Я AI-агент «Три девятки». Чем могу помочь?',
      assistantName: 'Агент 999',
    },
    update: {},
  })

  // Categories
  const catPrint = await prisma.aIKB_Category.upsert({
    where: { slug: 'pechat' },
    create: { name: 'Печать и баннеры', slug: 'pechat', sortOrder: 1 },
    update: {},
  })
  const catSigns = await prisma.aIKB_Category.upsert({
    where: { slug: 'vyveski' },
    create: { name: 'Вывески', slug: 'vyveski', sortOrder: 2 },
    update: {},
  })
  const catGifts = await prisma.aIKB_Category.upsert({
    where: { slug: 'suveniry' },
    create: { name: 'Сувениры', slug: 'suveniry', sortOrder: 3 },
    update: {},
  })

  // ===== BANNER (per m²) =====
  const banner = await prisma.aIKB_Product.upsert({
    where: { slug: 'banner' },
    create: {
      name: 'Баннер',
      slug: 'banner',
      shortSummary: 'Печатная реклама на баннерной ткани для уличного и интерьерного использования.',
      description: 'Баннерная печать на ПВХ-ткани плотностью 440–510 г/м². Подходит для уличной рекламы, пресс-воллов, фотозон. Кромка с люверсами через каждые 50 см.',
      materials: JSON.stringify(['ПВХ 440 г/м²', 'ПВХ 510 г/м² (усиленный)', 'Сетка mesh 270 г/м²']),
      specs: JSON.stringify({
        'Ширина рулона': 'до 5 м',
        'Разрешение печати': '1440 dpi',
        'Срок службы': '2–3 года на улице',
        'Температура эксплуатации': 'от -30 до +70 °C',
      }),
      leadTime: '1–3 рабочих дня',
      warranty: '12 месяцев на материал и выцветание',
      pricingType: 'per_sq_meter',
      basePrice: 450,
      currency: 'RUB',
      minOrderValue: 1500,
      formula: 'Ширина × Высота × Цена_за_м² + Дизайн + Монтаж + Доставка',
      formulaSpec: JSON.stringify({
        dimensionUnit: 'm',
        round: 'up',
        roundStep: 100,
        defaultServices: [],
      }),
      aiInstruction: `Если клиент не указал размеры — сначала спросить ширину и высоту в метрах.
Потом предложить дизайн (если не указан).
Потом предложить монтаж (если баннер крупнее 2 м² — обязательно упомянуть).
Потом предложить доставку.
Минимальная сумма заказа — 1500 ₽.`,
      isActive: true,
      sortOrder: 1,
      categoryId: catPrint.id,
    },
    update: {},
  })

  // Banner services
  await prisma.aIKB_Service.upsert({
    where: { id: 'svc-banner-design' },
    create: {
      id: 'svc-banner-design',
      productId: banner.id,
      name: 'Дизайн',
      description: 'Разработка макета баннера дизайнером. До 3 правок включено.',
      pricingType: 'fixed',
      price: 1500,
      isDefault: false,
      sortOrder: 1,
    },
    update: {},
  })
  await prisma.aIKB_Service.upsert({
    where: { id: 'svc-banner-mount' },
    create: {
      id: 'svc-banner-mount',
      productId: banner.id,
      name: 'Монтаж',
      description: 'Установка баннера на объекте. Цена за м².',
      pricingType: 'per_sq_meter',
      price: 250,
      isDefault: false,
      sortOrder: 2,
    },
    update: {},
  })
  await prisma.aIKB_Service.upsert({
    where: { id: 'svc-banner-delivery' },
    create: {
      id: 'svc-banner-delivery',
      productId: banner.id,
      name: 'Доставка',
      description: 'Доставка по городу. Фиксированная стоимость.',
      pricingType: 'fixed',
      price: 600,
      isDefault: false,
      sortOrder: 3,
    },
    update: {},
  })
  await prisma.aIKB_Service.upsert({
    where: { id: 'svc-banner-urgent' },
    create: {
      id: 'svc-banner-urgent',
      productId: banner.id,
      name: 'Срочность',
      description: 'Изготовление в день заказа (+50% к стоимости).',
      pricingType: 'percent',
      price: 50,
      isDefault: false,
      sortOrder: 4,
    },
    update: {},
  })

  // ===== MUG (fixed) =====
  const mug = await prisma.aIKB_Product.upsert({
    where: { slug: 'kruzhka' },
    create: {
      name: 'Кружка с принтом',
      slug: 'kruzhka',
      shortSummary: 'Керамическая кружка с персонализированной печатью.',
      description: 'Кружка объёмом 330 мл из керамики премиум-класса. Печать сублимацией — стойкая к мытью в посудомоечной машине.',
      materials: JSON.stringify(['Керамика премиум', 'Стекло (опция)']),
      specs: JSON.stringify({
        'Объём': '330 мл',
        'Высота': '95 мм',
        'Диаметр': '80 мм',
        'Площадь печати': '200 × 90 мм',
        'Мытьё в посудомойке': 'да',
      }),
      leadTime: '1–2 рабочих дня',
      warranty: 'Печать не выцветает 12 месяцев при правильном уходе',
      pricingType: 'per_unit',
      basePrice: 450,
      currency: 'RUB',
      formula: 'Цена_за_штуку × Количество + Дизайн (опционально)',
      formulaSpec: JSON.stringify({ round: 'none' }),
      aiInstruction: `Если клиент не указал количество — обязательно спросить количество кружек.
Для заказа от 10 штук — скидка 10%, от 50 штук — 20%. Упомяни это, если количество ≥ 10.`,
      isActive: true,
      sortOrder: 2,
      categoryId: catGifts.id,
    },
    update: {},
  })
  await prisma.aIKB_Service.upsert({
    where: { id: 'svc-mug-design' },
    create: {
      id: 'svc-mug-design',
      productId: mug.id,
      name: 'Дизайн',
      description: 'Подготовка макета под печать.',
      pricingType: 'fixed',
      price: 500,
      isDefault: false,
    },
    update: {},
  })
  await prisma.aIKB_Service.upsert({
    where: { id: 'svc-mug-box' },
    create: {
      id: 'svc-mug-box',
      productId: mug.id,
      name: 'Подарочная упаковка',
      description: 'Индивидуальная коробочка под каждую кружку.',
      pricingType: 'per_unit',
      price: 120,
      isDefault: false,
    },
    update: {},
  })

  // ===== PHOTOSTONE (fixed) =====
  const photo = await prisma.aIKB_Product.upsert({
    where: { slug: 'fotokamen' },
    create: {
      name: 'Фотокамень',
      slug: 'fotokamen',
      shortSummary: 'Фотопечать на натуральном камне — уникальный сувенир.',
      description: 'Печать фотографий на натуральном мраморе или травертине. Подходит для памятных дат, подарков, интерьера.',
      materials: JSON.stringify(['Мрамор белый', 'Травертин', 'Гранит (опция)']),
      specs: JSON.stringify({
        'Форматы': '15×20, 20×30, 30×40 см',
        'Тип печати': 'УФ-печать',
        'Срок службы': '25+ лет без выцветания',
      }),
      leadTime: '3–5 рабочих дней',
      warranty: 'Гарантия 5 лет на печать',
      pricingType: 'fixed',
      basePrice: 2500,
      currency: 'RUB',
      formula: 'Фиксированная цена + дизайн (опционально)',
      aiInstruction: `Уточните формат (15×20, 20×30 или 30×40 см) и материал (мрамор / травертин / гранит).
Цена фиксированная и не зависит от размера в базовой комплектации.`,
      isActive: true,
      sortOrder: 3,
      categoryId: catGifts.id,
    },
    update: {},
  })
  await prisma.aIKB_Service.upsert({
    where: { id: 'svc-photo-design' },
    create: {
      id: 'svc-photo-design',
      productId: photo.id,
      name: 'Дизайн-обработка фото',
      description: 'Ретушь и подготовка фотографии под печать на камне.',
      pricingType: 'fixed',
      price: 800,
      isDefault: true,
    },
    update: {},
  })

  // ===== SIGN (range, custom formula) =====
  const sign = await prisma.aIKB_Product.upsert({
    where: { slug: 'vyveska' },
    create: {
      name: 'Вывеска',
      slug: 'vyveska',
      shortSummary: 'Объёмная вывеска с подсветкой для бизнеса.',
      description: 'Изготовление вывесок любого типа: объёмные буквы, световые короба, лазерная резка. Полный цикл от макета до монтажа.',
      materials: JSON.stringify(['Акрил 3 мм', 'ПВХ 5 мм', 'Композит 3 мм', 'Оцинкованная сталь']),
      specs: JSON.stringify({
        'Тип подсветки': 'LED (передняя / контражурная)',
        'Срок службы LED': '50 000 часов',
        'Класс защиты': 'IP65',
      }),
      leadTime: '5–10 рабочих дней',
      warranty: '24 месяца на материалы и монтаж',
      pricingType: 'range',
      basePrice: 8000,
      maxPrice: 80000,
      currency: 'RUB',
      formula: 'Базовая стоимость зависит от материала, размера и типа подсветки. Полный расчёт — после согласования макета.',
      aiInstruction: `Перед расчётом обязательно уточнить:
1. Материал (Акрил / ПВХ / Композит / Сталь).
2. Размеры (ширина × высота).
3. Тип подсветки (передняя / контражурная / без подсветки).
4. Количество букв (если объёмные).
Диапазон цен — от 8000 до 80000 ₽. Точную стоимость назовём после макета.`,
      isActive: true,
      sortOrder: 4,
      categoryId: catSigns.id,
    },
    update: {},
  })
  await prisma.aIKB_Service.upsert({
    where: { id: 'svc-sign-design' },
    create: {
      id: 'svc-sign-design',
      productId: sign.id,
      name: 'Дизайн-проект',
      description: 'Разработка макета вывески с визуализацией на объекте.',
      pricingType: 'fixed',
      price: 3500,
      isDefault: false,
    },
    update: {},
  })
  await prisma.aIKB_Service.upsert({
    where: { id: 'svc-sign-mount' },
    create: {
      id: 'svc-sign-mount',
      productId: sign.id,
      name: 'Монтаж',
      description: 'Установка вывески на объекте (свыше 5 м — выезд автовышки).',
      pricingType: 'range',
      price: 3000,
      isDefault: false,
    },
    update: {},
  })
  await prisma.aIKB_Service.upsert({
    where: { id: 'svc-sign-permit' },
    create: {
      id: 'svc-sign-permit',
      productId: sign.id,
      name: 'Согласование',
      description: 'Согласование вывески в администрации.',
      pricingType: 'fixed',
      price: 5000,
      isDefault: false,
    },
    update: {},
  })

  // ===== FAQ =====
  await prisma.aIKB_FAQ.upsert({
    where: { id: 'faq-1' },
    create: {
      id: 'faq-1',
      question: 'Как оформить заказ?',
      answer: 'Выберите товар, нажмите «В корзину» и оформите заказ. Либо напишите нам в чат — поможем подобрать оптимальный вариант.',
    },
    update: {},
  })
  await prisma.aIKB_FAQ.upsert({
    where: { id: 'faq-2' },
    create: {
      id: 'faq-2',
      question: 'Какие способы оплаты доступны?',
      answer: 'Принимаем оплату картой онлайн, по реквизитам (для юр. лиц — с НДС), наличными при самовывозе.',
    },
    update: {},
  })
  await prisma.aIKB_FAQ.upsert({
    where: { id: 'faq-3' },
    create: {
      id: 'faq-3',
      question: 'Делаете ли вы доставку?',
      answer: 'Да, доставка по городу от 600 ₽. По России — СДЭК / Boxberry. Самовывоз — бесплатно.',
    },
    update: {},
  })

  console.log('AI Knowledge Base seeded successfully.')
  console.log('Products: banner, kruzhka, fotokamen, vyveska')
  console.log('Categories: pechat, vyveski, suveniry')
  console.log('FAQs: 3 global entries')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
