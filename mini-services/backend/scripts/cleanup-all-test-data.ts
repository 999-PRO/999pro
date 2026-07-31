import { prisma } from '../src/lib/prisma.js'

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║  Удаление всех тестовых данных перед релизом                ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')
  console.log('')

  // Delete in dependency order (children first, parents last)
  const results: { table: string; deleted: number }[] = []

  // Reviews
  const reviews = await prisma.review.deleteMany({})
  results.push({ table: 'Review', deleted: reviews.count })

  // Order status history
  const orderStatus = await prisma.orderStatusHistory.deleteMany({})
  results.push({ table: 'OrderStatusHistory', deleted: orderStatus.count })

  // Orders
  const orders = await prisma.order.deleteMany({})
  results.push({ table: 'Order', deleted: orders.count })

  // Cart items
  const cartItems = await prisma.cartItem.deleteMany({})
  results.push({ table: 'CartItem', deleted: cartItems.count })

  // Favorites
  const favorites = await prisma.favorite.deleteMany({})
  results.push({ table: 'Favorite', deleted: favorites.count })

  // Leads
  const leads = await prisma.lead.deleteMany({})
  results.push({ table: 'Lead', deleted: leads.count })

  // Stories
  const stories = await prisma.story.deleteMany({})
  results.push({ table: 'Story', deleted: stories.count })

  // Banners
  const banners = await prisma.banner.deleteMany({})
  results.push({ table: 'Banner', deleted: banners.count })

  // Products
  const products = await prisma.product.deleteMany({})
  results.push({ table: 'Product', deleted: products.count })

  // Push subscriptions
  const pushSubs = await prisma.pushSubscription.deleteMany({})
  results.push({ table: 'PushSubscription', deleted: pushSubs.count })

  // Calls
  const calls = await prisma.call.deleteMany({})
  results.push({ table: 'Call', deleted: calls.count })

  // Messages
  const messages = await prisma.message.deleteMany({})
  results.push({ table: 'Message', deleted: messages.count })

  // Conversations
  const conversations = await prisma.conversation.deleteMany({})
  results.push({ table: 'Conversation', deleted: conversations.count })

  // AI conversations
  const aiConvs = await prisma.aIKB_Conversation.deleteMany({})
  results.push({ table: 'AIKB_Conversation', deleted: aiConvs.count })

  // Audit log
  const audit = await prisma.auditLog.deleteMany({})
  results.push({ table: 'AuditLog', deleted: audit.count })

  // Users (delete ALL demo users, KEEP admin)
  const users = await prisma.user.deleteMany({
    where: { role: 'user' }
  })
  results.push({ table: 'User (demo users only, admin kept)', deleted: users.count })

  console.log('Результаты удаления:')
  console.log('─'.repeat(50))
  for (const r of results) {
    console.log(`  ${r.table.padEnd(40)} ${r.deleted} удалено`)
  }
  console.log('─'.repeat(50))

  const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0)
  console.log(`  ${'ИТОГО'.padEnd(40)} ${totalDeleted} записей`)
  console.log('')

  // Verify what remains
  console.log('Осталось в БД:')
  const remainingUsers = await prisma.user.count()
  const remainingAdmins = await prisma.user.count({ where: { role: 'admin' } })
  console.log(`  Users: ${remainingUsers} (из них админы: ${remainingAdmins})`)
  console.log(`  Products: ${await prisma.product.count()}`)
  console.log(`  Banners: ${await prisma.banner.count()}`)
  console.log(`  Stories: ${await prisma.story.count()}`)
  console.log(`  AI Providers: ${await prisma.aIProvider.count()} (сохранён)`)
  console.log('')

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('Ошибка:', e)
  process.exit(1)
})
