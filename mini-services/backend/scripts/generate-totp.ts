// Generate a TOTP code from a base32 secret (for testing).
import crypto from 'node:crypto'

const PERIOD = 30
const DIGITS = 6
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/, '').toUpperCase()
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of cleaned) {
    const idx = BASE32_CHARS.indexOf(char)
    if (idx === -1) throw new Error('Invalid Base32 character: ' + char)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

function generateTotp(secret: string, timeOffset = 0): string {
  const counter = Math.floor(Date.now() / 1000 / PERIOD) + timeOffset
  const buffer = Buffer.alloc(8)
  buffer.writeBigInt64BE(BigInt(counter))
  const hmac = crypto.createHmac('sha1', base32Decode(secret))
  hmac.update(buffer)
  const digest = hmac.digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, '0')
}

const secret = process.argv[2]
if (!secret) {
  console.error('Usage: bunx tsx generate-totp.ts <base32-secret>')
  process.exit(1)
}
console.log(generateTotp(secret))
