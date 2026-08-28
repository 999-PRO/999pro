/**
 * Seeds (idempotent): 10 categories for the home page tiles + 4 demo stories.
 * Run: node scripts/seed-categories-stories.cjs
 */
const { PrismaClient } = require('../mini-services/backend/node_modules/@prisma/client')
const p = new PrismaClient()

const CATEGORIES = [
  { name: 'Реклама',          slug: 'reklama',           icon: 'Megaphone',    description: 'Рекламные кампании, таргет, контекст' },
  { name: 'Наружная реклама', slug: 'naruzhnaya-reklama', icon: 'Presentation', description: 'Баннеры, лайтбоксы, вывески' },
  { name: 'Полиграфия',       slug: 'poligrafiya',       icon: 'Newspaper',    description: 'Визитки, листовки, буклеты' },
  { name: 'Печать',           slug: 'pechat',            icon: 'Printer',      description: 'Печать фото, книг, сувенирка' },
  { name: 'Дизайн',           slug: 'dizayn',            icon: 'Palette',      description: 'Логотипы, фирменный стиль, креатив' },
  { name: 'Интерьер',         slug: 'interer',           icon: 'Home',         description: 'Постеры, декор, предметы интерьера' },
  { name: 'Мебель',           slug: 'mebel',             icon: 'Armchair',     description: 'Офисная и домашняя мебель' },
  { name: 'Подарки',          slug: 'podarki',           icon: 'Gift',         description: 'Подарочные наборы и гаджеты' },
  { name: 'Упаковка',         slug: 'upakovka',          icon: 'Box',          description: 'Коробки, пакеты, стикеры' },
  { name: 'Сувениры',         slug: 'suveniry',          icon: 'Gem',          description: 'Брендирование, мерч, сувенирка' },
]

async function main() {
  // ---- categories ----
  for (let i = 0; i < CATEGORIES.length; i++) {
    const c = CATEGORIES[i]
    await p.category.upsert({
      where: { name: c.name },
      update: { icon: c.icon, description: c.description, sortOrder: i, visible: true },
      create: { ...c, sortOrder: i, visible: true },
    })
  }
  const catCount = await p.category.count()
  console.log(`categories: ${catCount}`)

  // ---- stories (only if none exist) ----
  const existing = await p.story.count()
  if (existing === 0) {
    const users = await p.user.findMany({
      where: { username: { in: ['kate_shop', 'denis_dev', 'maria_k', 'ivan_brand'] } },
      select: { id: true, username: true },
    })
    const by = (u) => users.find((x) => x.username === u)?.id
    const in7d = () => new Date(Date.now() + 7 * 24 * 3600 * 1000)
    const rows = [
      { username: 'kate_shop',  media: JSON.stringify(['/uploads/stories/sale-40.jpg']),     category: 'Акция',  caption: 'Летняя распродажа — скидки до −40% на весь каталог!' },
      { username: 'denis_dev',  media: JSON.stringify(['/uploads/stories/new-catalog.jpg']), category: 'Новости', caption: 'Каждую неделю новые товары в каталоге 999PRO' },
      { username: 'maria_k',    media: JSON.stringify(['/uploads/stories/masterclass.jpg']), category: 'Лето',   caption: 'Мастер-класс по печати на футболках — суббота, 15:00' },
      { username: 'ivan_brand', media: JSON.stringify(['/uploads/stories/team.jpg']),        category: 'Все',    caption: 'Наша команда 999PRO: реклама · печать · дизайн · мебель' },
    ].filter((r) => by(r.username))
    for (const r of rows) {
      await p.story.create({
        data: { userId: by(r.username), media: r.media, mediaType: 'image', caption: r.caption, category: r.category, expiresAt: in7d() },
      })
    }
    console.log(`stories created: ${rows.length}`)
  } else {
    console.log(`stories already exist: ${existing} — skipped`)
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => p.$disconnect())
