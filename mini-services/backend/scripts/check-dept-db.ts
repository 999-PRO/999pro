import { prisma } from '../src/lib/prisma.js'

async function main() {
  const count = await prisma.department.count()
  console.log('Departments in DB:', count)
  if (count > 0) {
    const depts = await prisma.department.findMany()
    console.log(JSON.stringify(depts.map(d => ({ id: d.id, name: d.name })), null, 2))
  }
  // Check if products have departmentId field
  const products = await prisma.product.findMany({ take: 1, select: { id: true, departmentId: true } })
  console.log('Product sample:', JSON.stringify(products, null, 2))
  await prisma.$disconnect()
}
main()
