// Test the full admin 2FA setup flow end-to-end
const BACKEND = 'http://127.0.0.1:4000'

async function main() {
  console.log('=== Step 1: Login as admin (should return totpSetupRequired + setup token) ===')
  const loginResp = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'admin12345' }),
  })
  const loginData = await loginResp.json()
  console.log('Status:', loginResp.status)
  console.log('totpSetupRequired:', loginData.totpSetupRequired)
  console.log('Has token:', !!loginData.token)
  console.log('User role:', loginData.user?.role)
  console.log('Message:', loginData.message)
  if (!loginData.token) {
    console.log('❌ No setup token returned')
    process.exit(1)
  }
  const setupToken = loginData.token

  console.log('\n=== Step 2: /api/auth/me with setup token (should 403 with totpSetupRequired) ===')
  const meResp = await fetch(`${BACKEND}/api/auth/me`, {
    headers: { Authorization: `Bearer ${setupToken}` },
  })
  console.log('Status:', meResp.status)
  const meData = await meResp.json().catch(() => ({ error: 'no json' }))
  console.log('Body:', JSON.stringify(meData).slice(0, 200))

  console.log('\n=== Step 3: /api/auth/totp/setup with setup token (should return QR secret) ===')
  const setupResp = await fetch(`${BACKEND}/api/auth/totp/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${setupToken}` },
    body: JSON.stringify({}),
  })
  console.log('Status:', setupResp.status)
  const setupData = await setupResp.json().catch(() => ({ error: 'no json' }))
  console.log('Has secret:', !!setupData.secret)
  console.log('Has otpauthUrl:', !!setupData.otpauthUrl)
  console.log('Secret (first 20 chars):', setupData.secret?.slice(0, 20))
  console.log('otpauthUrl (first 100 chars):', setupData.otpauthUrl?.slice(0, 100))

  if (!setupData.secret) {
    console.log('❌ No secret returned — backend /totp/setup did not accept setup token')
    process.exit(1)
  }

  console.log('\n=== Step 4: Generate a TOTP code from the secret ===')
  // Use the backend's own TOTP library to generate a valid code
  const { authenticator } = await import('/home/z/my-project/999pro-v24.7-production/mini-services/backend/node_modules/otplib/index.js')
    .catch(() => import('otplib'))
  const code = authenticator.generate(setupData.secret)
  console.log('Generated code:', code)

  console.log('\n=== Step 5: /api/auth/totp/verify with the code (should enable TOTP + return fresh JWT) ===')
  const verifyResp = await fetch(`${BACKEND}/api/auth/totp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${setupToken}` },
    body: JSON.stringify({ code }),
  })
  console.log('Status:', verifyResp.status)
  const verifyData = await verifyResp.json().catch(() => ({ error: 'no json' }))
  console.log('Enabled:', verifyData.enabled)
  console.log('Has fresh token:', !!verifyData.token)
  console.log('User role:', verifyData.user?.role)

  if (!verifyData.token) {
    console.log('❌ No fresh token returned')
    process.exit(1)
  }

  console.log('\n=== Step 6: Use the fresh token to call /api/auth/me (should succeed) ===')
  const meResp2 = await fetch(`${BACKEND}/api/auth/me`, {
    headers: { Authorization: `Bearer ${verifyData.token}` },
  })
  console.log('Status:', meResp2.status)
  const meData2 = await meResp2.json().catch(() => ({ error: 'no json' }))
  console.log('User username:', meData2.user?.username)
  console.log('User role:', meData2.user?.role)

  console.log('\n✅ Full admin 2FA setup flow works end-to-end!')
}

main().catch(e => { console.error('Test failed:', e); process.exit(1) })
