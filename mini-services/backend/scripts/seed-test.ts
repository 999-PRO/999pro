import { prisma } from '../src/lib/prisma.js'
import bcrypt from 'bcryptjs'

async function main() {
  const hash = await bcrypt.hash('admin123456', 12)
  
  // Delete existing admin if any
  await prisma.user.deleteMany({ where: { email: 'admin@999.pro' } })
  
  const u = await prisma.user.create({
    data: {
      email: 'admin@999.pro',
      username: 'admin',
      displayName: 'Admin',
      password: hash,
      role: 'admin',
      phone: '+79990000000',
      emailVerified: new Date(),
    }
  })
  console.log('Created admin:', u.id, u.email)

  // Create test products
  const products = [
    { title: 'Баннер 3×6', price: 2500, category: 'Реклама', images: '[]' },
    { title: 'Вывеска с подсветкой', price: 8900, category: 'Реклама', images: '[]' },
    { title: 'Печать на футболках', price: 990, category: 'Подарки', images: '[]' },
    { title: 'Дизайн логотипа', price: 3500, category: 'Дизайн', images: '[]' },
    { title: 'Визитки 500 шт', price: 1500, category: 'Печать', images: '[]' },
    { title: 'Буклет А4', price: 800, category: 'Печать', images: '[]' },
  ]
  
  for (const p of products) {
    await prisma.product.create({ data: p })
  }
  console.log(`Created ${products.length} products`)

  // Also create a regular test user
  const userHash = await bcrypt.hash('user123456', 12)
  await prisma.user.deleteMany({ where: { email: 'user@999.pro' } })
  const user = await prisma.user.create({
    data: {
      email: 'user@999.pro',
      username: 'testuser',
      displayName: 'Test User',
      password: userHash,
      role: 'user',
      phone: '+79990000001',
      emailVerified: new Date(),
    }
  })
  console.log('Created user:', user.id, user.email)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
