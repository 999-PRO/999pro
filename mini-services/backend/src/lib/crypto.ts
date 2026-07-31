/**
 * v19.0 — AES-256-GCM encryption for sensitive secrets (AI API keys, etc.)
 *
 * The encryption key is derived deterministically from JWT_SECRET via
 * HKDF-like PBKDF2 (100k iterations, 32-byte output). This means:
 *   - The key never touches the DB or filesystem.
 *   - Rotating JWT_SECRET automatically invalidates all stored secrets
 *     (admin must re-enter API keys — by design).
 *
 * Output format: "<ivHex>:<authTagHex>:<ciphertextHex>"
 *                (all hex-encoded, no base64 to keep it URL-safe).
 */

import crypto from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12 // 96-bit IV — recommended for GCM
const KEY_LEN = 32 // 256-bit key
const PBKDF2_ITERS = 100_000

function getEncryptionKey(): Buffer {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET must be set and at least 32 chars long to encrypt secrets.',
    )
  }
  // Derive a 32-byte key from JWT_SECRET using PBKDF2 with a fixed salt.
  // The salt is constant — its purpose is domain separation, not preventing
  // rainbow tables (the secret itself is already high-entropy).
  return crypto.pbkdf2Sync(secret, '999pro-ai-keys-v1', PBKDF2_ITERS, KEY_LEN, 'sha256')
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return ''
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`
}

export function decryptSecret(payload: string): string {
  if (!payload) return ''
  const parts = payload.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted secret format')
  }
  const [ivHex, tagHex, ctHex] = parts
  const key = getEncryptionKey()
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const ct = Buffer.from(ctHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
}

/** Mask a secret for display: show only the last 4 chars. */
export function maskSecret(secret: string): string {
  if (!secret) return ''
  if (secret.length <= 8) return '••••'
  return `••••${secret.slice(-4)}`
}

/** Test whether decryption works for a stored payload (used in health checks). */
export function canDecryptSecret(payload: string): boolean {
  try {
    decryptSecret(payload)
    return true
  } catch {
    return false
  }
}
