import { prisma } from '../src/lib/prisma.js'
import webpush from 'web-push'

// Configure VAPID
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@999.pro'

console.log('VAPID_PUBLIC_KEY:', VAPID_PUBLIC_KEY ? `${VAPID_PUBLIC_KEY.slice(0, 20)}...` : 'MISSING')
console.log('VAPID_PRIVATE_KEY:', VAPID_PRIVATE_KEY ? `${VAPID_PRIVATE_KEY.slice(0, 10)}...` : 'MISSING')
console.log('VAPID_SUBJECT:', VAPID_SUBJECT)
console.log('')

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

async function main() {
  // Get all push subscriptions
  const subs = await prisma.pushSubscription.findMany()
  console.log(`Found ${subs.length} push subscriptions in DB`)
  console.log('')

  if (subs.length === 0) {
    console.log('❌ No subscriptions — push cannot be delivered')
    console.log('   The user must login + grant notification permission first')
    await prisma.$disconnect()
    return
  }

  // Try sending a test push to EACH subscription
  const testPayload = JSON.stringify({
    title: '🧪 Тест Push',
    body: 'Проверка доставки push-уведомлений',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192-maskable.png',
    tag: 'test-push-' + Date.now(),
    data: { url: '/' },
    vibrate: [120, 60, 120],
    requireInteraction: false,
    renotify: true,
    actions: [],
  })

  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i]
    console.log(`--- Subscription ${i + 1}/${subs.length} ---`)
    console.log(`  User: ${sub.userId}`)
    console.log(`  Endpoint: ${sub.endpoint.slice(0, 80)}...`)
    console.log(`  Scope: ${sub.scope}`)
    console.log(`  UA: ${sub.userAgent?.slice(0, 60) || '(null)'}`)

    try {
      const keys = JSON.parse(sub.keys)
      const result = await webpush.sendNotification(
        { endpoint: sub.endpoint, keys },
        testPayload,
        { TTL: 60, urgency: 'high' },
      )
      console.log(`  ✅ SUCCESS — status ${result.statusCode}`)
    } catch (err: any) {
      console.log(`  ❌ FAILED — ${err.statusCode || 'no-status'}: ${err.message || err.body || err}`)
      if (err.statusCode === 404 || err.statusCode === 410) {
        console.log(`  → Subscription expired, should be deleted`)
      }
    }
    console.log('')
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('Fatal error:', e)
  process.exit(1)
})
