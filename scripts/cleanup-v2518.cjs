// v25.18 cleanup: find client's feed test comments and delete them
const BASE = 'http://localhost:4000'
async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'client', password: 'Client999!' }),
  }).then(r => r.json())
  const token = login.token
  if (!token) { console.log('no token'); return }
  // product id: 'Персонализированный ежедневник A5' — find by search
  const prods = await fetch(`${BASE}/api/products?q=%D0%B5%D0%B6%D0%B5%D0%B4%D0%BD%D0%B5%D0%B2%D0%BD%D0%B8%D0%BA&limit=5`).then(r => r.json())
  const p = prods.items?.[0]
  if (!p) { console.log('no product'); return }
  const revs = await fetch(`${BASE}/api/reviews?productId=${p.id}&limit=50`).then(r => r.json())
  const mine = (revs.items || []).filter(r => r.content && r.content.includes('Проверка редактирования'))
  for (const m of mine) {
    const d = await fetch(`${BASE}/api/reviews/${m.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    console.log('delete', m.id, d.status)
  }
  console.log('done, removed:', mine.length)
}
main().catch(e => { console.error(e.message); process.exit(1) })
