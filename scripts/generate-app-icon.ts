// ============================================================================
//  999 PRO — App icon generator
//  ----------------------------------------------------------------------------
//  Generates a premium mobile app icon for the 999 PRO marketplace.
//  Brand: gradient sky-blue → blue → violet, "9" logo, premium minimalist.
//
//  Output: /home/z/my-project/download/999pro-app-icon.png (1024×1024)
// ============================================================================

import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

const OUTPUT_PATH = '/home/z/my-project/download/999pro-app-icon.png'

// Detailed prompt — app icon for a premium marketplace.
// We describe the visual precisely so the model produces a clean,
// app-store-ready icon (not a generic illustration).
const PROMPT = [
  // Subject
  'Mobile app icon for a premium marketplace called "999 PRO"',
  // Composition — large centered "9" numeral on a rounded-square background
  'large bold white numeral "9" centered on a rounded-square app icon background',
  // Brand gradient — matches the existing 999 PRO brand colors
  'background is a smooth diagonal gradient from sky blue (#38bdf8) through royal blue (#2563eb) to deep violet (#7c3aed)',
  // Style — premium, modern, minimalist (Apple/Google app icon aesthetic)
  'premium modern minimalist design, Apple App Store icon style, clean geometric shapes, flat design with subtle depth',
  // Lighting — soft inner glow on the "9", no harsh shadows
  'soft inner glow on the numeral, subtle frosted glass texture on the background, no harsh shadows, no text other than the 9',
  // Quality
  'high quality, 4k, sharp, professional, suitable for App Store and Google Play',
  // Format
  'square 1:1 composition, centered, balanced, generous padding around the numeral',
].join(', ')

async function main() {
  console.log('Generating 999 PRO app icon...')
  console.log('Prompt:', PROMPT.slice(0, 120) + '...')
  console.log('Output:', OUTPUT_PATH)
  console.log('')

  const zai = await ZAI.create()

  const response = await zai.images.generations.create({
    prompt: PROMPT,
    size: '1024x1024', // Square — standard app icon size
  })

  if (!response.data || !response.data[0] || !response.data[0].base64) {
    throw new Error('Invalid response from image generation API')
  }

  const imageBase64 = response.data[0].base64
  const buffer = Buffer.from(imageBase64, 'base64')
  fs.writeFileSync(OUTPUT_PATH, buffer)

  console.log(`✓ Icon saved to ${OUTPUT_PATH}`)
  console.log(`  Size: ${(buffer.length / 1024).toFixed(1)} KB`)
  console.log(`  Dimensions: 1024×1024`)
}

main().catch((err) => {
  console.error('✗ Generation failed:', err)
  process.exit(1)
})
