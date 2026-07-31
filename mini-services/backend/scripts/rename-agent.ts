import { prisma } from '../src/lib/prisma.js'

async function main() {
  const updated = await prisma.aIKB_Settings.update({
    where: { id: 'default' },
    data: {
      assistantName: 'Агент 999',
      greeting: 'Здравствуйте! Я Агент 999. Чем могу помочь?',
    },
  })
  console.log('Updated:', JSON.stringify({
    assistantName: updated.assistantName,
    greeting: updated.greeting,
  }, null, 2))
  await prisma.$disconnect()
}
main()
