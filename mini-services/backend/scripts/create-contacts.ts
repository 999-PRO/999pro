import { prisma } from '../src/lib/prisma.js'

async function main() {
  await prisma.appSetting.upsert({
    where: { id: 'phone' },
    update: { value: JSON.stringify('+79991234567') },
    create: { id: 'phone', value: JSON.stringify('+79991234567') },
  })
  await prisma.appSetting.upsert({
    where: { id: 'whatsapp' },
    update: { value: JSON.stringify('+79991234567') },
    create: { id: 'whatsapp', value: JSON.stringify('+79991234567') },
  })
  await prisma.appSetting.upsert({
    where: { id: 'telegram' },
    update: { value: JSON.stringify('tri999pro') },
    create: { id: 'telegram', value: JSON.stringify('tri999pro') },
  })
  await prisma.appSetting.upsert({
    where: { id: 'email' },
    update: { value: JSON.stringify('info@999.pro') },
    create: { id: 'email', value: JSON.stringify('info@999.pro') },
  })
  console.log('Contacts created')
}

main().then(() => process.exit(0)).catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
