import { prisma } from '../src/lib/prisma.js'

async function main() {
  const s = await prisma.aIKB_Settings.findUnique({ where: { id: 'default' } })
  console.log('record exists:', !!s)
  if (s) {
    console.log('assistantName:', s.assistantName)
    console.log('greeting:', s.greeting)
  }
  await prisma.$disconnect()
}
main()
