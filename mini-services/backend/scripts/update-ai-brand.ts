// Update AI AssistantSettings in DB to use new brand name
import { prisma } from '../src/lib/prisma.js'

async function main() {
  const settings = await prisma.aIKB_Settings.findFirst()
  if (settings) {
    console.log('Before:', JSON.stringify({ assistantName: (settings as any).assistantName, greeting: (settings as any).greeting }, null, 2))
    await prisma.aIKB_Settings.update({
      where: { id: settings.id },
      data: {
        assistantName: 'Агент 999',
        greeting: 'Здравствуйте! Я Агент 999. Чем могу помочь?',
      } as any,
    })
    console.log('✓ Updated AIKB_Settings to new brand')
  } else {
    console.log('No AIKB_Settings found — skipping')
  }
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
