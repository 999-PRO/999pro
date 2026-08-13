// ============================================================================
//  lib/video-compress.ts — server-side FFmpeg pipeline for product videos.
//  ----------------------------------------------------------------------------
//  v25.10 (Task #6 + #10):
//  Compresses uploaded product videos to a web-friendly format:
//    • Video: H.264 (libx264), CRF 23, preset medium, max 720x960 (3:4)
//    • Audio: AAC 128k
//    • Container: MP4 with +faststart (moov atom at the start for instant
//      playback / Range seek support)
//    • Poster: first frame extracted as JPEG
//
//  Design:
//    • Spawns ffmpeg as a child process (no native deps in Node).
//    • Streams input from disk → ffmpeg stdout → output file (zero buffering).
//    • If ffmpeg binary is missing, returns `compressed: false` and the
//      caller falls back to the original file (admin UI shows a warning).
//    • Original raw upload is deleted after successful compression.
//
//  Why not fluent-ffmpeg?
//    • One less dependency (FFmpeg is invoked ~5 times — direct spawn is fine).
//    • Better error messages (we capture stderr directly).
//    • No version drift between fluent-ffmpeg typings and the ffmpeg binary.
// ============================================================================

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { logger } from './logger.js'

/** Check whether ffmpeg is available on PATH. Cheap — runs `ffmpeg -version`. */
export async function isFfmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    proc.on('error', () => resolve(false)) // ENOENT — not installed
    proc.on('exit', (code) => resolve(code === 0))
    // Safety timeout — if ffmpeg hangs, treat as unavailable.
    setTimeout(() => {
      try { proc.kill() } catch {}
      resolve(false)
    }, 3000)
  })
}

export interface CompressVideoResult {
  /** Path to the compressed MP4 (relative to project root, e.g. /uploads/videos/abc.mp4). */
  url: string
  /** Path to the extracted poster JPEG (or null if extraction failed). */
  posterUrl: string | null
  /** True if FFmpeg compression succeeded; false if we fell back to the original. */
  compressed: boolean
  /** Warning message if compression was skipped (e.g. ffmpeg missing). */
  warning?: string
}

interface CompressOptions {
  /** Absolute path to the raw uploaded file. */
  inputPath: string
  /** Project root dir containing /uploads/. */
  uploadsDir: string
  /** Base name (no extension) for the output files, e.g. `1700000000-abcd1234ef56`. */
  basename: string
}

/**
 * Compress a video using FFmpeg. If FFmpeg is unavailable, returns the
 * original file path as the URL with `compressed: false` and a warning.
 *
 * Output paths are RELATIVE (start with /uploads/) so they can be stored
 * directly in the Product.videoUrl column and served by express.static.
 */
export async function compressProductVideo(opts: CompressOptions): Promise<CompressVideoResult> {
  const { inputPath, uploadsDir, basename } = opts
  const videosDir = path.join(uploadsDir, 'videos')
  if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true })

  const outputPathAbs = path.join(videosDir, `${basename}.mp4`)
  const posterPathAbs = path.join(videosDir, `${basename}-poster.jpg`)
  // Relative URLs for storage in DB + serving via express.static.
  const outputPathRel = `/uploads/videos/${basename}.mp4`
  const posterPathRel = `/uploads/videos/${basename}-poster.jpg`

  if (!(await isFfmpegAvailable())) {
    logger.warn('[video-compress] FFmpeg not installed — skipping compression.')
    // Fall back to the original file. Move it to /uploads/videos/ with the
    // expected name so the relative URL works.
    try {
      await fsPromises.copyFile(inputPath, outputPathAbs)
    } catch (err) {
      logger.error(`[video-compress] Fallback copy failed: ${err}`)
      throw new Error('FFmpeg not installed and fallback copy failed')
    }
    return {
      url: outputPathRel,
      posterUrl: null,
      compressed: false,
      warning: 'FFmpeg не установлен на сервере — видео загружено без сжатия. Установите ffmpeg для оптимизации.',
    }
  }

  // FFmpeg args — optimized for vertical product videos (3:4).
  //   -y: overwrite output
  //   -i: input
  //   -vf scale=720:960:force_original_aspect_ratio=decrease,pad=720:960:(ow-iw)/2:(oh-ih)/2
  //     → resize to fit within 720x960 (3:4) WITHOUT distortion, then pad with
  //       black bars. This preserves the original aspect ratio and ensures the
  //       output is exactly 3:4 (matches the card / viewer aspect).
  //   -c:v libx264 -profile:v high -level 4.0 -crf 23 -preset medium -pix_fmt yuv420p
  //     → H.264 High profile, CRF 23 (good balance), universally-compatible pixel format.
  //   -movflags +faststart
  //     → moves moov atom to start → instant playback + Range seek support.
  //   -c:a aac -b:a 128k -ac 2
  //     → AAC 128k stereo. If the source has no audio, ffmpeg errors — we
  //       handle that by retrying without audio args.
  //   -maxrate 2M -bufsize 4M
  //     → cap peak bitrate for smooth streaming on mobile.
  const args = [
    '-y',
    '-i', inputPath,
    '-vf', "scale=720:960:force_original_aspect_ratio=decrease,pad=720:960:(ow-iw)/2:(oh-ih)/2,setsar=1",
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level', '4.0',
    '-crf', '23',
    '-preset', 'medium',
    '-pix_fmt', 'yuv420p',
    '-maxrate', '2M',
    '-bufsize', '4M',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-movflags', '+faststart',
    outputPathAbs,
  ]

  try {
    await runFfmpeg(args)
  } catch (err: any) {
    // Retry without audio args — source might have no audio track.
    if (String(err?.message || err).includes('stream') || String(err?.stderr || '').includes('Audio')) {
      logger.warn('[video-compress] Retrying without audio (source may have no audio track).')
      const noAudioArgs = args.filter((_, i, arr) => {
        // Strip -c:a, -b:a, -ac, and their values.
        if (arr[i] === '-c:a' || arr[i] === '-b:a' || arr[i] === '-ac') return false
        if (i > 0 && (arr[i - 1] === '-c:a' || arr[i - 1] === '-b:a' || arr[i - 1] === '-ac')) return false
        return true
      })
      await runFfmpeg(noAudioArgs)
    } else {
      throw err
    }
  }

  // Extract first frame as poster.
  let posterOk = false
  try {
    await runFfmpeg([
      '-y',
      '-i', outputPathAbs,
      '-frames:v', '1',
      '-q:v', '3',
      posterPathAbs,
    ])
    posterOk = true
  } catch (err) {
    logger.warn(`[video-compress] Poster extraction failed: ${err}`)
    // Non-fatal — video still works, just no poster preview.
  }

  // Delete the raw original — we have the compressed version now.
  try {
    await fsPromises.unlink(inputPath)
  } catch {
    // Non-fatal — orphaned raw file is just disk waste, not a correctness issue.
  }

  return {
    url: outputPathRel,
    posterUrl: posterOk ? posterPathRel : null,
    compressed: true,
  }
}

/** Spawn ffmpeg with the given args, reject on non-zero exit. Captures stderr. */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      // FFmpeg writes a LOT of progress noise to stderr. Keep it trimmed.
      if (stderr.length > 8192) stderr = stderr.slice(-8192)
    })
    proc.on('error', (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)))
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else {
        const err = new Error(`ffmpeg exited with code ${code}`) as Error & { stderr?: string }
        err.stderr = stderr
        reject(err)
      }
    })
  })
}
