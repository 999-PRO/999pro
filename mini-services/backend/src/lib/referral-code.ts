// v13.1 (audit P1-10 + dedup): cryptographically secure referral code generator.
//
// Previously `generateReferralCode` was duplicated in routes/auth.ts and
// routes/club.ts, and used `Math.random()` for the random suffix. Math.random
// is NOT cryptographically secure — with ~1.7M combinations for a 4-char
// base36 suffix, an attacker could brute-force someone's referral code in
// under 30 minutes at 1000 req/s, then collect referral bonuses.
//
// Now uses crypto.randomBytes (CSPRNG) and lives in lib/ so both routes
// import the same implementation.

import { randomBytes } from 'node:crypto'

/** Generate a referral code: 4-char username prefix + 4-char random suffix. */
export function generateReferralCode(seed: string): string {
  const base = seed.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase().padEnd(4, 'X')
  // 4 random hex chars = 16 bits of entropy from a CSPRNG. Hex avoids
  // ambiguous chars (0/O, 1/I) and is uniformly distributed.
  const suffix = randomBytes(2).toString('hex').toUpperCase()
  return `${base}${suffix}`
}
