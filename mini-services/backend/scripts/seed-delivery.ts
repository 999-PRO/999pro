// Seed default delivery zones + default delivery settings.
// Run: bunx tsx scripts/seed-delivery.ts
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const DELIVERY_SETTINGS_KEY = 'deliverySettings'

const DEFAULT_SETTINGS = {
  deliveryEnabled: true,
  pickupEnabled: true,
  storeAddress: null,
  storeLat: null,
  storeLng: null,
  storePhone: null,
  workingHours: null,
  defaultDeliveryCost: 0,
  deliveryTerms: 'Доставка осуществляется в течение 1–3 рабочих дней. Точную стоимость и срок менеджер уточнит по телефону.',
  pickupTerms: 'Самовывоз доступен по предварительной договорённости. Адрес и время уточняйте у менеджера.',
}

const DEFAULT_ZONES = [
  { name: 'По городу',     description: 'Доставка в пределах города',           cost: 0,   sortOrder: 0 },
  { name: 'По республике', description: 'Доставка по территории республики',    cost: 150, sortOrder: 1 },
  { name: 'По России',     description: 'Доставка в любой регион РФ',           cost: 300, sortOrder: 2 },
]

async function main() {
  // Settings
  const existing = await prisma.appSetting.findUnique({ where: { id: DELIVERY_SETTINGS_KEY } })
  if (!existing) {
    await prisma.appSetting.create({
      data: { id: DELIVERY_SETTINGS_KEY, value: JSON.stringify(DEFAULT_SETTINGS) },
    })
    console.log('✓ Created default delivery settings')
  } else {
    console.log('• Delivery settings already exist, skipping')
  }

  // Zones
  const zoneCount = await prisma.deliveryZone.count()
  if (zoneCount === 0) {
    await prisma.deliveryZone.createMany({ data: DEFAULT_ZONES })
    console.log(`✓ Created ${DEFAULT_ZONES.length} default delivery zones`)
  } else {
    console.log(`• ${zoneCount} zones already exist, skipping`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
