// ============================================================================
// TRI999 — rebrand-tri999.ts (v25.27)
// ----------------------------------------------------------------------------
// Ребрендинг «999PRO» → «TRI999» в пользовательских данных БД:
//   • AppSetting (appTitle и любые значения, содержащие старое имя)
//   • InfoPage (текстовые страницы — политика, о нас и т.д.)
//   • Banner (title/subtitle/cta)
// Технические ключи (email/логины вида @999.pro, storage-префиксы) НЕ трогаем.
// Запуск: cd mini-services/backend && DATABASE_URL="file:/home/z/my-project/db/custom.db" npx tsx scripts/rebrand-tri999.ts
// Идемпотентно: повторный запуск — no-op.
// ============================================================================

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function rebrand(text: string | null | undefined): string | null {
  if (!text) return null
  return text
    // Порядок важен: сначала составные формы, потом одиночные.
    .replace(/999\s?PRO/g, 'TRI999')
    .replace(/999pro(?=[\s.,!?)("(»«:;]|$)/gi, 'TRI999') // отдельное слово, не домены/ключи
}

async function main() {
  let total = 0

  // ── AppSetting ──────────────────────────────────────────────────────────
  const settings = await prisma.appSetting.findMany()
  for (const s of settings) {
    const next = rebrand(s.value)
    if (next && next !== s.value) {
      await prisma.appSetting.update({ where: { id: s.id }, data: { value: next } })
      total += 1
      console.log(`  AppSetting[${s.id}] "${s.value.slice(0, 60)}" → "${next.slice(0, 60)}"`)
    }
  }

  // ── InfoPage ────────────────────────────────────────────────────────────
  const pages = await prisma.infoPage.findMany()
  for (const p of pages) {
    const title = rebrand(p.title)
    const content = rebrand(p.content)
    if (title !== p.title || (content !== null && content !== p.content)) {
      await prisma.infoPage.update({
        where: { id: p.id },
        data: { ...(title !== p.title ? { title: title! } : {}), ...(content !== null && content !== p.content ? { content: content! } : {}) },
      })
      total += 1
      console.log(`  InfoPage[${p.id}] "${p.title}" обновлена`)
    }
  }

  // ── Banner ──────────────────────────────────────────────────────────────
  const banners = await prisma.banner.findMany()
  for (const b of banners) {
    const title = rebrand(b.title)
    const subtitle = rebrand(b.subtitle)
    const cta = rebrand(b.cta)
    const data: Record<string, string> = {}
    if (title !== null && title !== b.title) data.title = title
    if (subtitle !== null && subtitle !== b.subtitle) data.subtitle = subtitle
    if (cta !== null && cta !== b.cta) data.cta = cta
    if (Object.keys(data).length) {
      await prisma.banner.update({ where: { id: b.id }, data })
      total += 1
      console.log(`  Banner[${b.id}] "${b.title}" обновлён`)
    }
  }

  console.log(total === 0 ? '✓ Изменений не требуется (уже TRI999)' : `✓ Обновлено записей: ${total}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
