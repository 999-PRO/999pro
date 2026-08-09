import { prisma } from '../src/lib/prisma.js'

async function main() {
  const products = await prisma.product.findMany({ take: 1 })
  const p = products[0]
  const user = await prisma.user.findFirst({ where: { role: 'user' } })
  if (!p || !user) {
    console.log('no product/user')
    return
  }
  console.log('Product:', p.id, p.title, 'User:', user.id)
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      total: 5000,
      status: 'new',
      name: 'Test Client',
      phone: '+79990000000',
      items: {
        create: [{ productId: p.id, quantity: 2, price: 2500 }]
      }
    }
  })
  console.log('Created order:', order.id, 'total:', order.total)
}

main().then(() => process.exit(0)).catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
