// 999 — Три девятки — AI Text-to-Speech
// ----------------------------------------------------------------------------
// Uses the Web Speech API on the CLIENT side (browser-native, no API key
// needed, no network calls). The backend just signals whether TTS is enabled
// and provides the voice preference.
//
// Why client-side TTS?
//  1. Zero latency — no round-trip to a TTS service.
//  2. No API key — works offline, no cost.
//  3. Native voices on iOS/macOS/Android sound natural (Siri, Google TTS).
//  4. Privacy — voice data never leaves the device.
//
// For premium cloud TTS (ElevenLabs, Yandex SpeechKit), the backend can
// proxy calls here in the future. For now, Web Speech API is the default.
// ----------------------------------------------------------------------------
import { Router } from 'express'

const router = Router()

// GET /api/ai/tts/voices — list available browser voices (proxied for diagnostics)
router.get('/voices', (_req, res) => {
  // Browser voices are client-side only — we just return a hint.
  res.json({
    engine: 'web-speech-api',
    note: 'Voices are determined by the browser/OS. Use speechSynthesis.getVoices() on the client.',
    preferredLang: 'ru-RU',
    fallbackVoice: 'Google русский',
  })
})

export default router
