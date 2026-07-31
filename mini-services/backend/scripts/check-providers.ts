import { prisma } from '../src/lib/prisma.js'

const providers = await prisma.aIProvider.findMany()
console.log(JSON.stringify(providers.map(p => ({
  id: p.id, name: p.name, type: p.type, enabled: p.enabled,
  isDefault: p.isDefault, hasApiKey: !!p.apiKeyEnc && p.apiKeyEnc.length > 0,
  apiKeyEncLen: p.apiKeyEnc?.length || 0,
  baseUrl: p.baseUrl, model: p.model
})), null, 2))
await prisma.$disconnect()
