/**
 * 999 CLUB — Phase 3 seed script.
 *
 * Populates all 7 CLUB entity tables with beautiful demo data so the module
 * looks alive on first open. Run after `prisma migrate deploy`:
 *
 *   bunx tsx scripts/seed-club.ts
 *
 * Idempotent: checks if data already exists before inserting.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding 999 CLUB demo data...')

  // Get the admin user (created by create-admin.ts)
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } })
  if (!admin) {
    console.error('❌ No admin user found. Run create-admin.ts first.')
    process.exit(1)
  }
  const adminId = admin.id

  // Get a demo user for story attribution
  const demoUser = await prisma.user.findFirst({ where: { email: 'maria@999.pro' } })
  const demoUserId = demoUser?.id || adminId

  // ===== 🎁 GIFTS =====
  const giftCount = await prisma.clubGift.count()
  if (giftCount === 0) {
    const gifts = [
      {
        title: 'Приветственный бонус',
        description: 'Специальный подарок для новых участников клуба — скидка 500₽ на первый заказ',
        image: 'https://images.unsplash.com/photo-1513885535751-8b9238bd345a?w=400',
        pointsCost: 0,
        quantity: 1000,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        active: true,
        order: 0,
      },
      {
        title: 'Премиум-доступ на месяц',
        description: 'Откройте все возможности 999 CLUB: эксклюзивные акции, двойные баллы и приоритетная поддержка',
        image: 'https://images.unsplash.com/photo-1607344645866-009c320c5ab8?w=400',
        pointsCost: 500,
        quantity: 50,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        active: true,
        order: 1,
      },
      {
        title: 'Бесплатная доставка',
        description: 'Бесплатная доставка на все заказы в течение 7 дней — без минимальной суммы заказа',
        image: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=400',
        pointsCost: 200,
        quantity: 200,
        startsAt: new Date(),
        active: true,
        order: 2,
      },
      {
        title: 'Подарок на день рождения',
        description: 'Наш подарок вам — скидка 1000₽ на любой заказ в вашем праздничном месяце',
        image: 'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=400',
        pointsCost: 0,
        quantity: null,
        active: true,
        order: 3,
      },
    ]
    for (const g of gifts) {
      await prisma.clubGift.create({ data: g })
    }
    console.log(`  ✅ ${gifts.length} gifts`)
  }

  // ===== 🔥 PROMOS =====
  const promoCount = await prisma.clubPromo.count()
  if (promoCount === 0) {
    const promos = [
      {
        title: 'Чёрная пятница — до 70% скидка',
        description: 'Самая большая распродажа года! Скидки на весь каталог. Только 3 дня.',
        image: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=600',
        promoCode: 'BLACK70',
        discountPercent: 70,
        ctaText: 'В каталог',
        ctaUrl: '/?view=catalog',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        active: true,
        order: 0,
      },
      {
        title: 'Летняя распродажа',
        description: 'Скидки до 50% на летнюю коллекцию. Успейте, пока товары есть в наличии!',
        image: 'https://images.unsplash.com/photo-1554147090-e1221a04a025?w=600',
        promoCode: 'SUMMER50',
        discountPercent: 50,
        ctaText: 'Смотреть акции',
        ctaUrl: '/?view=catalog',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        active: true,
        order: 1,
      },
      {
        title: 'Скидка 30% на рекламные услуги',
        description: 'Закажите настройку контекстной рекламы со скидкой 30%. Промокод действует до конца месяца.',
        image: 'https://images.unsplash.com/photo-1611926653458-09294b3142bf?w=600',
        promoCode: 'ADS30',
        discountPercent: 30,
        ctaText: 'Подробнее',
        ctaUrl: '/?view=catalog',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
        active: true,
        order: 2,
      },
    ]
    for (const p of promos) {
      await prisma.clubPromo.create({ data: p })
    }
    console.log(`  ✅ ${promos.length} promos`)
  }

  // ===== 🏆 GIVEAWAYS =====
  const giveawayCount = await prisma.clubGiveaway.count()
  if (giveawayCount === 0) {
    const giveaways = [
      {
        title: 'iPhone 16 Pro — главный приз!',
        description: 'Участвуйте бесплатно — один пользователь = одна заявка. Победитель будет выбран случайно через 7 дней. Чем больше участников — тем круче розыгрыш!',
        image: 'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=600',
        winnersCount: 1,
        drawAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        active: true,
        order: 0,
      },
      {
        title: '5 × подарочных карт на 5000₽',
        description: 'Пять победителей получат подарочные карты номиналом 5000₽. Участвуйте бесплатно — шансы равны для всех!',
        image: 'https://images.unsplash.com/photo-1607344645866-009c320c5ab8?w=600',
        winnersCount: 5,
        drawAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        active: true,
        order: 1,
      },
    ]
    for (const g of giveaways) {
      await prisma.clubGiveaway.create({ data: g })
    }
    console.log(`  ✅ ${giveaways.length} giveaways`)
  }

  // ===== ⭐ BONUSES =====
  const bonusCount = await prisma.clubBonus.count()
  if (bonusCount === 0) {
    const bonuses = [
      {
        title: 'Добро пожаловать в клуб!',
        description: 'Получите 100 баллов за присоединение к 999 CLUB. Баллы можно тратить на подарки и купоны.',
        pointsReward: 100,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        active: true,
        order: 0,
      },
      {
        title: 'Следите за нами в соцсетях',
        description: 'Подпишитесь на наши социальные сети и получите 50 баллов. Ссылки будут доступны после нажатия «Получить».',
        pointsReward: 50,
        startsAt: new Date(),
        active: true,
        order: 1,
      },
      {
        title: 'Заполните профиль',
        description: 'Добавьте аватар и заполните информацию о себе — получите 30 баллов.',
        pointsReward: 30,
        startsAt: new Date(),
        active: true,
        order: 2,
      },
    ]
    for (const b of bonuses) {
      await prisma.clubBonus.create({ data: b })
    }
    console.log(`  ✅ ${bonuses.length} bonuses`)
  }

  // ===== 🎯 TASKS =====
  const taskCount = await prisma.clubTask.count()
  if (taskCount === 0) {
    const tasks = [
      {
        title: 'Ежедневный визит',
        description: 'Заходите в 999 CLUB каждый день и получайте баллы. Задание обновляется каждые 24 часа.',
        taskType: 'daily',
        pointsReward: 10,
        actionKey: 'daily_visit',
        active: true,
        order: 0,
      },
      {
        title: 'Просмотр каталога',
        description: 'Откройте каталог товаров — это поможет нам подобрать для вас лучшие предложения.',
        taskType: 'daily',
        pointsReward: 5,
        actionKey: 'view_catalog',
        active: true,
        order: 1,
      },
      {
        title: 'Первый заказ',
        description: 'Сделайте свой первый заказ в 999 PRO и получите 200 баллов на счёт.',
        taskType: 'one-time',
        pointsReward: 200,
        actionKey: 'first_order',
        active: true,
        order: 2,
      },
      {
        title: 'Оставьте отзыв',
        description: 'Поделитесь впечатлениями о товаре — помогите другим покупателям и получите 25 баллов.',
        taskType: 'one-time',
        pointsReward: 25,
        actionKey: 'leave_review',
        active: true,
        order: 3,
      },
      {
        title: 'Добавьте аватар',
        description: 'Загрузите фото профиля — это делает общение в чате приятнее. Награда: 15 баллов.',
        taskType: 'one-time',
        pointsReward: 15,
        actionKey: 'add_avatar',
        active: true,
        order: 4,
      },
    ]
    for (const t of tasks) {
      await prisma.clubTask.create({ data: t })
    }
    console.log(`  ✅ ${tasks.length} tasks`)
  }

  // ===== 🎟 COUPONS =====
  const couponCount = await prisma.clubCoupon.count()
  if (couponCount === 0) {
    const coupons = [
      {
        title: 'WELCOME — 15% на первый заказ',
        description: 'Скидка 15% на любой заказ. Только для новых клиентов. Код действует 30 дней.',
        code: 'WELCOME15',
        discountType: 'percent',
        discountValue: 15,
        quantity: 500,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        active: true,
        order: 0,
      },
      {
        title: '500₽ на заказ от 3000₽',
        description: 'Фиксированная скидка 500 рублей при заказе от 3000 рублей.',
        code: 'SAVE500',
        discountType: 'fixed',
        discountValue: 500,
        quantity: 200,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        active: true,
        order: 1,
      },
      {
        title: 'FREEDEL — бесплатная доставка',
        description: 'Бесплатная доставка на любой заказ. Без минимальной суммы.',
        code: 'FREEDEL',
        discountType: 'fixed',
        discountValue: 300,
        quantity: 1000,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        active: true,
        order: 2,
      },
    ]
    for (const c of coupons) {
      await prisma.clubCoupon.create({ data: c })
    }
    console.log(`  ✅ ${coupons.length} coupons`)
  }

  // ===== 📅 EVENTS =====
  const eventCount = await prisma.clubEvent.count()
  if (eventCount === 0) {
    const events = [
      {
        title: 'Рамадан — особые предложения',
        description: 'Весь месяц Рамадан — специальные цены на продукты, подарки и благотворительные наборы. Эксклюзивно для участников 999 CLUB.',
        image: 'https://images.unsplash.com/photo-1592595896551-12b371d546d5?w=600',
        location: 'По всей сети',
        startsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 35 * 24 * 60 * 60 * 1000),
        maxAttendees: null,
        active: true,
        order: 0,
      },
      {
        title: 'День рождения 999 PRO',
        description: 'Празднуем вместе! Скидки до 50%, бесплатные подарки и розыгрыш призов в течение всего дня.',
        image: 'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=600',
        location: 'Онлайн + офлайн',
        startsAt: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 13 * 24 * 60 * 60 * 1000),
        maxAttendees: null,
        active: true,
        order: 1,
      },
      {
        title: 'Мастер-класс по рекламе',
        description: 'Бесплатный онлайн-мастер-класс: «Как настроить Яндекс.Директ за 1 час». Запишитесь заранее — количество мест ограничено.',
        image: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=600',
        location: 'Онлайн (Zoom)',
        startsAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
        maxAttendees: 100,
        active: true,
        order: 2,
      },
    ]
    for (const e of events) {
      await prisma.clubEvent.create({ data: e })
    }
    console.log(`  ✅ ${events.length} events`)
  }

  // ===== Award welcome bonus to admin if not already claimed =====
  const welcomeBonus = await prisma.clubBonus.findFirst({ where: { order: 0 } })
  if (welcomeBonus) {
    const existingClaim = await prisma.clubBonusClaim.findUnique({
      where: { bonusId_userId: { bonusId: welcomeBonus.id, userId: adminId } },
    })
    if (!existingClaim) {
      await prisma.$transaction([
        prisma.clubBonusClaim.create({ data: { bonusId: welcomeBonus.id, userId: adminId } }),
        prisma.user.update({
          where: { id: adminId },
          data: {
            points: { increment: welcomeBonus.pointsReward },
            pointsEarnedTotal: { increment: welcomeBonus.pointsReward },
          },
        }),
        prisma.pointsTransaction.create({
          data: {
            userId: adminId,
            delta: welcomeBonus.pointsReward,
            reason: 'bonus',
            entityId: welcomeBonus.id,
            entityType: 'club_bonus',
          },
        }),
      ])
      console.log(`  ✅ Welcome bonus (${welcomeBonus.pointsReward} points) awarded to admin`)
    }
  }

  console.log('\n✅ 999 CLUB seed complete!')
  console.log('   Open the app → 999 CLUB → all cards now have demo content.')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
