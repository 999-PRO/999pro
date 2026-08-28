// v25.17 smoke: grouped story creation + comment edit PATCH (admin 2FA via local TOTP)
const BASE = 'http://localhost:4000'
const crypto = require('node:crypto')

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function totp(secret) {
  const clean = secret.replace(/=+$/, '').toUpperCase()
  let bits = 0, value = 0
  const bytes = []
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) bytes.push((value >>> (bits - 8)) & 0xff), (bits -= 8)
  }
  const counter = Math.floor(Date.now() / 30000)
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const h = crypto.createHmac('sha1', Buffer.from(bytes)).update(buf).digest()
  const off = h[19] & 0x0f
  const code = ((h.readUInt32BE(off) & 0x7fffffff) % 1e6).toString().padStart(6, '0')
  return code
}

async function main() {
  // 1. login (2FA: totpCode уходит в том же запросе — см. auth.ts v25.9)
  const secret = process.env.TOTP_SECRET || ''
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'Admin999!', totpCode: totp(secret) }),
  })
  const login = await loginRes.json()
  const token = login.token
  if (!token) { console.log('NO TOKEN — login said:', Object.keys(login)); return }
  console.log('token ok')

  // 3. grouped story
  const s = await fetch(`${BASE}/api/stories`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      media: ['https://example.com/a.jpg', 'https://example.com/b.jpg', 'https://example.com/c.mp4'],
      mediaType: 'image', caption: 'Смоук v25.17', durationHours: 1, grouped: true,
    }),
  })
  const sj = await s.json()
  console.log('story create:', s.status, 'items:', sj.items?.length, 'media in one:', sj.items?.[0]?.media?.length, sj.items?.[0]?.mediaType)
  const storyId = sj.items?.[0]?.id

  // 4. comment on own post? Instead: PATCH community comment — use a post owned by admin. Find communities:
  const cs = await fetch(`${BASE}/api/communities`).then(r => r.json())
  const com = cs.items?.[0]
  if (com) {
    const posts = await fetch(`${BASE}/api/communities/${com.id}/posts`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())
    const post = posts.items?.[0]
    if (post) {
      const cc = await fetch(`${BASE}/api/communities/posts/${post.id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: 'Смоук-коммент v25.17' }),
      })
      const ccj = await cc.json()
      console.log('comment create:', cc.status, ccj.id)
      const pe = await fetch(`${BASE}/api/communities/comments/${ccj.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: 'Смоук-коммент v25.17 (обновлён)' }),
      })
      const pej = await pe.json()
      console.log('comment patch:', pe.status, 'edited:', pej.edited, 'content:', pej.content)
      // cleanup comment
      await fetch(`${BASE}/api/communities/comments/${ccj.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    }
  }

  // cleanup story
  if (storyId) {
    const d = await fetch(`${BASE}/api/stories/${storyId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    console.log('story cleanup:', d.status)
  }
}

main().catch(e => { console.error('SMOKE FAIL:', e.message); process.exit(1) })
