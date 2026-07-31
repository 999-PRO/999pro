// Seed default stop-words for the moderation system.
//
// Run: bunx tsx prisma/seed-stop-words.ts
// Run with --force: bunx tsx prisma/seed-stop-words.ts --force (overwrite existing)
//
// Categories: profanity, insult, extremism, terrorism, violence, drugs, fraud, spam, ads, custom

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface SeedWord {
  word: string
  category: string
  severity: 'low' | 'medium' | 'high'
}

// Default stop-words — base Russian profanity + common scam/spam patterns.
// This is intentionally a SHORT list (admin can import a full dictionary
// via Studio → Модерация → Стоп-слова → Импорт). The goal here is just to
// have a working baseline out of the box.
const DEFAULT_WORDS: SeedWord[] = [
  // === Profanity (мат) ===
  { word: 'хуй', category: 'profanity', severity: 'high' },
  { word: 'хуёв', category: 'profanity', severity: 'high' },
  { word: 'хуя', category: 'profanity', severity: 'high' },
  { word: 'хуе', category: 'profanity', severity: 'high' },
  { word: 'хуи', category: 'profanity', severity: 'high' },
  { word: 'пизда', category: 'profanity', severity: 'high' },
  { word: 'пизды', category: 'profanity', severity: 'high' },
  { word: 'пизде', category: 'profanity', severity: 'high' },
  { word: 'пизду', category: 'profanity', severity: 'high' },
  { word: 'пизди', category: 'profanity', severity: 'high' },
  { word: 'ебать', category: 'profanity', severity: 'high' },
  { word: 'ебёт', category: 'profanity', severity: 'high' },
  { word: 'ебан', category: 'profanity', severity: 'high' },
  { word: 'ёбан', category: 'profanity', severity: 'high' },
  { word: 'блять', category: 'profanity', severity: 'medium' },
  { word: 'бляд', category: 'profanity', severity: 'medium' },
  { word: 'блядь', category: 'profanity', severity: 'medium' },
  { word: 'сука', category: 'profanity', severity: 'medium' },
  { word: 'суки', category: 'profanity', severity: 'medium' },
  { word: 'ублюдок', category: 'profanity', severity: 'medium' },
  { word: 'мудак', category: 'profanity', severity: 'medium' },
  { word: 'мудил', category: 'profanity', severity: 'medium' },
  { word: 'долбоёб', category: 'profanity', severity: 'high' },
  { word: 'долбоеб', category: 'profanity', severity: 'high' },

  // === Insults (оскорбления) ===
  { word: 'тупой', category: 'insult', severity: 'low' },
  { word: 'идиот', category: 'insult', severity: 'low' },
  { word: 'дебил', category: 'insult', severity: 'low' },
  { word: 'дурак', category: 'insult', severity: 'low' },
  { word: 'тупица', category: 'insult', severity: 'low' },
  { word: 'шлюха', category: 'insult', severity: 'high' },
  { word: 'шлюхи', category: 'insult', severity: 'high' },
  { word: 'проститут', category: 'insult', severity: 'medium' },
  { word: 'урод', category: 'insult', severity: 'low' },
  { word: 'чмо', category: 'insult', severity: 'low' },
  { word: 'чушпан', category: 'insult', severity: 'low' },
  { word: 'мразь', category: 'insult', severity: 'medium' },
  { word: 'сволочь', category: 'insult', severity: 'medium' },
  { word: 'подонок', category: 'insult', severity: 'medium' },

  // === Hate speech / Extremism ===
  { word: 'хохол', category: 'extremism', severity: 'high' },
  { word: 'москаль', category: 'extremism', severity: 'high' },
  { word: 'чурка', category: 'extremism', severity: 'high' },
  { word: 'чурк', category: 'extremism', severity: 'high' },
  { word: 'хачик', category: 'extremism', severity: 'high' },
  { word: 'жид', category: 'extremism', severity: 'high' },
  { word: 'нерусь', category: 'extremism', severity: 'medium' },
  { word: 'нацист', category: 'extremism', severity: 'high' },
  { word: 'фашист', category: 'extremism', severity: 'high' },
  { word: 'гитлер', category: 'extremism', severity: 'medium' },
  { word: 'сигхайл', category: 'extremism', severity: 'high' },
  { word: 'зигхайл', category: 'extremism', severity: 'high' },

  // === Terrorism ===
  { word: 'теракт', category: 'terrorism', severity: 'high' },
  { word: 'шахид', category: 'terrorism', severity: 'high' },
  { word: 'джихад', category: 'terrorism', severity: 'high' },
  { word: 'исламское государство', category: 'terrorism', severity: 'high' },
  { word: 'халифат', category: 'terrorism', severity: 'high' },

  // === Violence ===
  { word: 'убью', category: 'violence', severity: 'high' },
  { word: 'убей', category: 'violence', severity: 'high' },
  { word: 'зарежу', category: 'violence', severity: 'high' },
  { word: 'забью', category: 'violence', severity: 'high' },
  { word: 'удавлю', category: 'violence', severity: 'high' },
  { word: 'отравлю', category: 'violence', severity: 'high' },
  { word: 'пристрелю', category: 'violence', severity: 'high' },
  { word: 'взрыв', category: 'violence', severity: 'high' },
  { word: 'бомба', category: 'violence', severity: 'high' },
  { word: 'расстрел', category: 'violence', severity: 'high' },

  // === Drugs ===
  { word: 'наркотик', category: 'drugs', severity: 'high' },
  { word: 'марихуана', category: 'drugs', severity: 'high' },
  { word: 'гашиш', category: 'drugs', severity: 'high' },
  { word: 'героин', category: 'drugs', severity: 'high' },
  { word: 'кокаин', category: 'drugs', severity: 'high' },
  { word: 'амфетамин', category: 'drugs', severity: 'high' },
  { word: 'метамфетамин', category: 'drugs', severity: 'high' },
  { word: 'спайс', category: 'drugs', severity: 'high' },
  { word: 'мефедрон', category: 'drugs', severity: 'high' },
  { word: 'закладка', category: 'drugs', severity: 'high' },
  { word: 'кладмен', category: 'drugs', severity: 'high' },
  { word: 'продажа наркот', category: 'drugs', severity: 'high' },
  { word: 'купить наркот', category: 'drugs', severity: 'high' },

  // === Fraud / Scam ===
  { word: 'переведи деньги', category: 'fraud', severity: 'high' },
  { word: 'сбербанк перевод', category: 'fraud', severity: 'medium' },
  { word: 'номер карты', category: 'fraud', severity: 'medium' },
  { word: 'cvv', category: 'fraud', severity: 'high' },
  { word: 'cvc', category: 'fraud', severity: 'high' },
  { word: 'пин-код', category: 'fraud', severity: 'high' },
  { word: 'смс-код', category: 'fraud', severity: 'high' },
  { word: 'код из смс', category: 'fraud', severity: 'high' },
  { word: 'вы выиграли', category: 'fraud', severity: 'medium' },
  { word: 'вы стали победителем', category: 'fraud', severity: 'medium' },
  { word: 'инвестиции доход', category: 'fraud', severity: 'medium' },
  { word: 'заработок дома', category: 'fraud', severity: 'medium' },
  { word: 'пассивный доход', category: 'fraud', severity: 'low' },

  // === Spam / Ads ===
  { word: 'подпишись на канал', category: 'spam', severity: 'low' },
  { word: 'репост за', category: 'spam', severity: 'low' },
  { word: 'бесплатно переходи', category: 'spam', severity: 'medium' },
  { word: 'кликни и получи', category: 'spam', severity: 'medium' },
  { word: 'раскрутка instagram', category: 'ads', severity: 'medium' },
  { word: 'накрутка подписчиков', category: 'ads', severity: 'medium' },
  { word: 'покупай дёшево', category: 'ads', severity: 'low' },
]

async function main() {
  console.log('999 — Три девятки — Seed moderation stop-words')
  console.log('====================================')
  console.log('')

  const force = process.argv.includes('--force')

  let created = 0
  let skipped = 0

  for (const w of DEFAULT_WORDS) {
    const existing = await prisma.stopWord.findFirst({ where: { word: w.word } })
    if (existing) {
      if (force) {
        await prisma.stopWord.update({
          where: { id: existing.id },
          data: { category: w.category, severity: w.severity, isActive: true },
        })
        created++
      } else {
        skipped++
      }
    } else {
      await prisma.stopWord.create({
        data: {
          word: w.word,
          category: w.category,
          severity: w.severity,
          isActive: true,
        },
      })
      created++
    }
  }

  console.log(`Created/updated: ${created}`)
  console.log(`Skipped (already exist): ${skipped}`)
  console.log(`Total stop-words in DB: ${await prisma.stopWord.count()}`)
  console.log('')

  // Also create default moderationSettings if not present
  const settings = await prisma.appSetting.findUnique({ where: { id: 'moderationSettings' } })
  if (!settings) {
    const defaultSettings = {
      enabled: true,
      aiEnabled: true,
      strictness: 'high',
      checkLinks: true,
      checkImages: true,
      checkDocuments: true,
      whitelist: [],
      localAction: 'block',
      aiAction: 'flag',
      autoWarnThreshold: 3,
      autoMuteThreshold: 5,
      autoBanThreshold: 10,
    }
    await prisma.appSetting.create({
      data: { id: 'moderationSettings', value: JSON.stringify(defaultSettings) },
    })
    console.log('✓ Created default moderationSettings')
  } else {
    console.log('→ moderationSettings already exist (skipped)')
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error('Seed failed:', e)
    prisma.$disconnect()
    process.exit(1)
  })
