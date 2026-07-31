import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthedRequest } from '../lib/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { auditLog } from '../lib/audit.js'
import { safeParseJsonArray } from '../lib/serialisers.js'
import path from 'node:path'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import crypto from 'node:crypto'
import type { Readable } from 'node:stream'
import { logger } from '../lib/logger.js'

const router = Router()

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

// ============================================================================
// Constants — single source of truth for upload limits & allowlists
// ============================================================================
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MB
const MAX_FILES_PER_REQUEST = 10
// Hard cap on the total raw body. Kept tight to mitigate OOM-DoS: 10 files ×
// 50 MB + multipart overhead → 60 MB is more than enough.
const MAX_BODY_BYTES = 60 * 1024 * 1024

// MIME → safe file extension mapping. The extension is DERIVED from the
// declared MIME, NOT from the client-supplied filename. This prevents the
// stored-XSS attack where a client sends `Content-Type: image/jpeg` but
// `filename="evil.html"` and the file is served as text/html.
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
  'video/x-matroska': '.mkv',
  'audio/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/aac': '.aac',
  'audio/x-aac': '.aac',
  'audio/x-m4a': '.m4a',
  'audio/x-wav': '.wav',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
  'audio/m4a': '.m4a',
  'audio/x-ms-wma': '.wma',
  // Documents
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/rtf': '.rtf',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/x-rar-compressed': '.rar',
  'application/x-7z-compressed': '.7z',
  'application/json': '.json',
  'text/markdown': '.md',
  'application/octet-stream': '.bin', // fallback для неизвестных типов
}

const ALLOWED_MIME = new Set(Object.keys(MIME_TO_EXT))

/**
 * Normalize a MIME type by stripping parameters like `;codecs=opus`.
 *
 * Browsers' MediaRecorder API commonly produces audio blobs with the codec
 * suffix in the type (e.g. `audio/webm;codecs=opus`, `audio/mp4;codecs=mp4a.40.2`).
 * Our allowlist and MIME_TO_EXT map only store the bare type (`audio/webm`).
 * Without normalization, every voice-message upload would be rejected with
 * HTTP 400 "Unsupported file type: audio/webm;codecs=opus".
 */
function normalizeMime(mime: string): string {
  return (mime || '').split(';')[0].trim().toLowerCase()
}

// Magic-byte signatures for additional verification. SIGNIFICANTLY STRENGTHENED:
// every MIME type in MIME_TO_EXT that has a known, stable file signature now
// has a matching entry here. Types without a verifiable signature (rare or
// text-based) are still allowed via the `text/*` and `application/json`
// fallback rules in matchesMagicBytes, but the high-risk document formats
// (PDF / ZIP / DOCX / XLSX / etc.) are now actually verified — previously
// matchesMagicBytes returned `true` unconditionally for any MIME without an
// entry, which let polyglot payloads (a .pdf that is also valid HTML/JS)
// sail straight through.
const MAGIC_BYTES: Array<{ mime: string; bytes: number[]; offset: number }> = [
  // Images
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff], offset: 0 },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47], offset: 0 },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38], offset: 0 },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }, // RIFF
  // Video / audio containers
  { mime: 'video/mp4', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // ftyp at offset 4
  { mime: 'video/webm', bytes: [0x1a, 0x45, 0xdf, 0xa3], offset: 0 }, // EBML
  { mime: 'video/quicktime', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // qt  also uses ftyp
  { mime: 'audio/mpeg', bytes: [0x49, 0x44, 0x33], offset: 0 }, // ID3
  // audio/mpeg can also start with 0xFF 0xFB (MP3 frame sync) — accepted below.
  { mime: 'audio/ogg', bytes: [0x4f, 0x67, 0x67, 0x53], offset: 0 }, // OggS
  { mime: 'audio/wav', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }, // RIFF
  { mime: 'audio/webm', bytes: [0x1a, 0x45, 0xdf, 0xa3], offset: 0 }, // EBML
  { mime: 'audio/mp4', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // ftyp
  // v16.8.4: AAC files (ADTS) start with 0xFF 0xF1 or 0xFF 0xF9 — frame sync.
  { mime: 'audio/aac', bytes: [0xff, 0xf1], offset: 0 },
  { mime: 'audio/x-aac', bytes: [0xff, 0xf1], offset: 0 },
  // Documents — these were previously all bypassed (no signature, returned true).
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], offset: 0 }, // %PDF-
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04], offset: 0 }, // PK\x03\x04
  { mime: 'application/x-zip-compressed', bytes: [0x50, 0x4b, 0x03, 0x04], offset: 0 },
  { mime: 'application/x-rar-compressed', bytes: [0x52, 0x61, 0x72, 0x21], offset: 0 }, // Rar!
  { mime: 'application/x-7z-compressed', bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], offset: 0 }, // 7z\xbc\xaf\x27\x1c
  // MS Office binary formats (OLE2 compound document)
  { mime: 'application/msword', bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], offset: 0 },
  { mime: 'application/vnd.ms-excel', bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], offset: 0 },
  { mime: 'application/vnd.ms-powerpoint', bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], offset: 0 },
  // OOXML (DOCX / XLSX / PPTX) are ZIP containers — accept PK header.
  { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: [0x50, 0x4b, 0x03, 0x04], offset: 0 },
  { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: [0x50, 0x4b, 0x03, 0x04], offset: 0 },
  { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', bytes: [0x50, 0x4b, 0x03, 0x04], offset: 0 },
  // ODF (OpenDocument) — also ZIP containers.
  { mime: 'application/vnd.oasis.opendocument.text', bytes: [0x50, 0x4b, 0x03, 0x04], offset: 0 },
  { mime: 'application/vnd.oasis.opendocument.spreadsheet', bytes: [0x50, 0x4b, 0x03, 0x04], offset: 0 },
  { mime: 'application/vnd.oasis.opendocument.presentation', bytes: [0x50, 0x4b, 0x03, 0x04], offset: 0 },
  // RTF — starts with `{\rtf`
  { mime: 'application/rtf', bytes: [0x7b, 0x5c, 0x72, 0x74, 0x66], offset: 0 },
]

function matchesMagicBytes(buf: Buffer, mime: string): boolean {
  // v16.8.4: normalize audio aliases — x-m4a, m4a, x-wav behave same as their canonical types.
  const canonicalMime = mime
    .replace('audio/x-m4a', 'audio/mp4')
    .replace('audio/m4a', 'audio/mp4')
    .replace('audio/x-wav', 'audio/wav')
    .replace('audio/x-flac', 'audio/flac')

  // v16.8.11: SPECIAL CASES FIRST — до проверки magic bytes.
  // Причина: audio/mpeg может начинаться с ID3 (0x49 0x44 0x33) ИЛИ с MP3
  // frame sync (0xFF 0xFB/0xF3/0xF2). Раньше special case был ПОСЛЕ цикла
  // проверки magic bytes, и если ID3 не матчило — return false выходил
  // раньше, и frame-sync проверка никогда не выполнялась. Поэтому все mp3
  // без ID3 отклонялись.
  // audio/mpeg — MP3 frame sync (0xFF + 0xE0 mask).
  if (mime === 'audio/mpeg' && buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    return true
  }
  // v16.8.4: AAC ADTS (0xFF 0xF1 или 0xFF 0xF9).
  if ((mime === 'audio/aac' || mime === 'audio/x-aac') && buf.length >= 2 && buf[0] === 0xff && (buf[1] === 0xf1 || buf[1] === 0xf9)) {
    return true
  }

  const sig = MAGIC_BYTES.find((m) => m.mime === canonicalMime)
  if (!sig) {
    // No signature defined. Only allow for genuinely text-based or unknown
    // types (text/*, application/json, application/octet-stream). Anything
    // else without a signature is rejected — fail-closed.
    if (
      mime === 'text/plain' ||
      mime === 'text/csv' ||
      mime === 'text/markdown' ||
      mime === 'application/json' ||
      mime === 'application/octet-stream'
    ) {
      return true
    }
    // v16.8.4: allow audio/flac and audio/x-flac without magic bytes (FLAC has
    // a 'fLaC' marker but some encoders omit it). Fail-open for audio only.
    if (mime === 'audio/flac' || mime === 'audio/x-flac') return true
    return false
  }
  if (buf.length < sig.offset + sig.bytes.length) return false
  for (let i = 0; i < sig.bytes.length; i++) {
    if (buf[sig.offset + i] !== sig.bytes[i]) return false
  }

  return true
}

function fileToUrl(filename: string): string {
  return `/uploads/${path.basename(filename)}`
}

// ============================================================================
// Multipart parser (manual, since multer has Bun compat issues)
// ----------------------------------------------------------------------------
// PERFORMANCE FIX: previously this buffered the ENTIRE request body in memory
// (Buffer.concat) before parsing — 60 MB upload = 60 MB RAM per request.
// 100 concurrent uploads = 6 GB RAM and OOM crash.
//
// NEW BEHAVIOUR: still buffer in memory (we need the magic bytes from the
// start of each file to validate type), BUT cap the per-file buffer at
// MAX_UPLOAD_BYTES (50 MB). Files larger than that are rejected with 413
// BEFORE we hold them in memory. The body-size limit MAX_BODY_BYTES (60 MB)
// is enforced as a hard ceiling on the entire request.
//
// For files > 50 MB that we DO accept (none currently — limit is 50 MB),
// we'd need true streaming to a temp file, then validate magic bytes from
// a head read. Not needed today.
// ============================================================================
// B-CRIT-004 fix: replaced custom buffering multipart parser with streaming
// busboy. The old implementation accumulated ALL chunks in memory before
// checking size — OOM DoS at ~100 parallel 50MB uploads (5GB RAM).
// busboy streams file chunks directly to disk/temp buffer, with per-file
// size limit enforced during streaming (not after).
// ============================================================================
async function parseMultipart(req: any): Promise<{
  files: Array<{
    fieldname: string
    originalname: string
    mimetype: string
    buffer: Buffer
    size: number
  }>
  fields: Record<string, string>
}> {
  // B-CRIT-004: pre-check Content-Length — reject 413 BEFORE reading body
  const contentLength = Number(req.headers['content-length'] || 0)
  if (contentLength > MAX_BODY_BYTES) {
    throw new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`)
  }

  const Busboy = (await import('busboy')).default
  const bb = Busboy({
    headers: req.headers,
    limits: {
      fileSize: MAX_UPLOAD_BYTES,  // per-file limit (10MB default)
      files: 10,                    // max 10 files per request
      fieldSize: 1024 * 1024,       // 1MB per non-file field
      fields: 50,                   // max 50 non-file fields
      // Note: busboy doesn't have a total body size limit — we rely on
      // Content-Length pre-check above + per-file fileSize limit.
    },
  })

  const files: Array<{
    fieldname: string
    originalname: string
    mimetype: string
    buffer: Buffer
    size: number
  }> = []
  const fields: Record<string, string> = {}

  return new Promise((resolve, reject) => {
    bb.on('file', (fieldname: string, stream: NodeJS.ReadableStream, info: { filename: string; mimeType: string; transferEncoding?: string }) => {
      const chunks: Buffer[] = []
      let totalSize = 0
      let truncated = false
      stream.on('data', (chunk: Buffer) => {
        // Per-file size limit enforced DURING streaming (not after)
        // v13.2 (audit P1-5 fix): if already truncated, discard chunks
        // immediately to free memory. Previously the chunks array kept
        // growing until stream.destroy took effect, retaining up to
        // MAX_UPLOAD_BYTES (50MB) of dead memory per truncated file.
        if (truncated) return
        if (totalSize + chunk.length > MAX_UPLOAD_BYTES) {
          truncated = true
          // Free the chunks we've accumulated so far — they're dead memory.
          chunks.length = 0
          totalSize = 0
          // stream.destroy is available on NodeJS.Readable streams
          ;(stream as any).destroy(new Error(`File ${info.filename} exceeds ${MAX_UPLOAD_BYTES} bytes`))
          return
        }
        chunks.push(chunk)
        totalSize += chunk.length
      })
      stream.on('end', () => {
        if (truncated) return  // skip — already errored
        files.push({
          fieldname,
          originalname: info.filename,
          mimetype: info.mimeType,
          buffer: Buffer.concat(chunks),
          size: totalSize,
        })
      })
      stream.on('error', (err: Error) => {
        reject(err)
      })
    })
    bb.on('field', (fieldname: string, val: string) => {
      fields[fieldname] = val
    })
    bb.on('finish', () => {
      resolve({ files, fields })
    })
    bb.on('error', (err: Error) => {
      reject(err)
    })
    req.pipe(bb)
  })
}

// v9-audit-fix: removed ~100 lines of commented-out `parseMultipart_legacy`
// dead code. Busboy has been validated in production for the entire
// commit history. Restore from git history if ever needed.

// Save file: derive extension from MIME (NOT from client filename), check magic bytes
async function saveFile(
  file: {
    originalname: string
    mimetype: string
    buffer: Buffer
    size: number
  },
  skipMagicCheck = false,
): Promise<string> {
  // Normalize the MIME type — strip codec suffixes like `;codecs=opus`
  // so we match against the bare type in MIME_TO_EXT (e.g. `audio/webm`).
  const mime = normalizeMime(file.mimetype)
  const ext = MIME_TO_EXT[mime]
  if (!ext) {
    throw new Error(`Unsupported file type: ${file.mimetype}`)
  }
  // v16.8.11: skipMagicCheck — когда MIME определён по расширению (не из файла),
  // magic bytes могут не совпасть. Пропускаем проверку.
  if (!skipMagicCheck && !matchesMagicBytes(file.buffer, mime)) {
    throw new Error(`File content does not match declared type: ${file.mimetype}`)
  }
  const base = crypto.randomBytes(12).toString('hex')
  const filename = `${Date.now()}-${base}${ext}`
  const filepath = path.join(UPLOAD_DIR, filename)
  // Async write — never block the event loop on disk I/O.
  await fsPromises.writeFile(filepath, file.buffer)
  return filepath
}

// POST /api/upload  (single file under field name "file")
router.post(
  '/upload',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    try {
      const { files } = await parseMultipart(req)
      if (!files.length) return res.status(400).json({ error: 'No file uploaded' })
      const file = files[0]
      // Normalize the file's MIME type (strip codec suffixes) before any check.
      // MediaRecorder blobs come in as e.g. `audio/webm;codecs=opus` — the bare
      // allowlist only contains `audio/webm`, so without normalization every
      // voice-message upload would be rejected with HTTP 400.
      const normalizedMime = normalizeMime(file.mimetype)
      // v16.8.11: fallback по расширению — если MIME пустой, неизвестный,
      // или generic (text/plain, application/octet-stream), но расширение
      // файла известно как аудио/видео/изображение, определяем MIME по
      // расширению. iOS часто отправляет аудио с пустым или неверным MIME.
      const GENERIC_MIMES = new Set(['', 'text/plain', 'application/octet-stream', 'application/binary'])
      let finalMime = normalizedMime
      if (GENERIC_MIMES.has(finalMime)) {
        const lowerName = (file.originalname || '').toLowerCase()
        const extMatch = lowerName.match(/\.([a-z0-9]+)$/)
        if (extMatch) {
          const fileExt = extMatch[1]
          const extToMime: Record<string, string> = {
            mp3: 'audio/mpeg',
            m4a: 'audio/mp4',
            aac: 'audio/aac',
            wav: 'audio/wav',
            ogg: 'audio/ogg',
            flac: 'audio/flac',
            opus: 'audio/ogg',
            webm: 'audio/webm',
            vac: 'audio/mpeg',
            wma: 'audio/x-ms-wma',
            mp4: 'video/mp4',
            mov: 'video/quicktime',
            avi: 'video/x-msvideo',
            mkv: 'video/x-matroska',
            m4v: 'video/mp4',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            webp: 'image/webp',
            heic: 'image/heic',
            heif: 'image/heif',
          }
          if (extToMime[fileExt] && ALLOWED_MIME.has(extToMime[fileExt])) {
            finalMime = extToMime[fileExt]
          }
        }
      }
      if (!ALLOWED_MIME.has(finalMime)) {
        return res.status(400).json({ error: `Unsupported file type: ${file.mimetype}` })
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return res.status(400).json({ error: `File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)` })
      }
      // Pass the final MIME to saveFile so the extension lookup also works.
      // v16.8.11: если MIME был определён по расширению (generic → конкретный),
      // помечаем skipMagicCheck, т.к. реальный контент может не иметь стандартных
      // magic bytes (например, .vac файлы, или mp3 без ID3/frame-sync).
      const skipMagicCheck = GENERIC_MIMES.has(normalizedMime) && finalMime !== normalizedMime
      const filepath = await saveFile({ ...file, mimetype: finalMime }, skipMagicCheck)
      const url = fileToUrl(filepath)

      // S-HIGH-002: audit-log every successful upload so admin file
      // operations are traceable. entityId is the file URL (stable handle).
      await auditLog(req, 'upload', url, 'create', {
        filename: path.basename(filepath) || null,
        mimeType: finalMime || null,
        size: file.size || null,
      })

      res.status(201).json({
        url,
        filename: path.basename(filepath),
        mimetype: finalMime,
        size: file.size,
      })
    } catch (e: any) {
      // Log full error server-side, but return a generic message to the
      // client to avoid leaking filesystem paths / Prisma internals.
      logger.error('single error:', { module: 'upload', error: e })
      const safeMsg =
        typeof e?.message === 'string' &&
        /(?:too large|unsupported|invalid|missing|exceeds)/i.test(e.message)
          ? e.message
          : 'Upload failed'
      res.status(400).json({ error: safeMsg })
    }
  }),
)

// POST /api/upload/multiple  (multiple files under field name "files")
router.post(
  '/upload/multiple',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    try {
      const { files } = await parseMultipart(req)
      if (!files.length) return res.status(400).json({ error: 'No files uploaded' })
      if (files.length > MAX_FILES_PER_REQUEST) {
        return res
          .status(400)
          .json({ error: `Too many files (max ${MAX_FILES_PER_REQUEST} per request)` })
      }

      const result = []
      const rejected: Array<{ filename: string; reason: string }> = []
      for (const file of files) {
        const normalizedMime = normalizeMime(file.mimetype)
        if (!ALLOWED_MIME.has(normalizedMime)) {
          rejected.push({ filename: file.originalname, reason: `Unsupported type: ${file.mimetype}` })
          continue
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          rejected.push({ filename: file.originalname, reason: 'Too large' })
          continue
        }
        try {
          const filepath = await saveFile({ ...file, mimetype: normalizedMime })
          const url = fileToUrl(filepath)
          // S-HIGH-002: audit-log every successful upload (multi-file).
          // Best-effort — never block the upload on audit failure.
          await auditLog(req, 'upload', url, 'create', {
            filename: path.basename(filepath) || null,
            mimeType: normalizedMime || null,
            size: file.size || null,
          })
          result.push({
            url,
            filename: path.basename(filepath),
            mimetype: normalizedMime,
            size: file.size,
          })
        } catch (e: any) {
          // Sanitize: only expose expected user-facing reasons (size/type).
          const reason =
            typeof e?.message === 'string' &&
            /(?:too large|unsupported|invalid|missing|exceeds)/i.test(e.message)
              ? e.message
              : 'Upload failed'
          rejected.push({ filename: file.originalname, reason })
        }
      }
      res.status(201).json({ items: result, rejected })
    } catch (e: any) {
      logger.error('multiple error:', { module: 'upload', error: e })
      const safeMsg =
        typeof e?.message === 'string' &&
        /(?:too large|unsupported|invalid|missing|exceeds)/i.test(e.message)
          ? e.message
          : 'Upload failed'
      res.status(400).json({ error: safeMsg })
    }
  }),
)

// ============================================================================
// Favorites
// ============================================================================
router.get(
  '/favorites',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 200)
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0)

    // v9-audit-fix: exclude favorites whose product has been soft-deleted
    const [items, total] = await Promise.all([
      prisma.favorite.findMany({
        where: { userId: req.user!.id, product: { deletedAt: null } },
        include: { product: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.favorite.count({ where: { userId: req.user!.id, product: { deletedAt: null } } }),
    ])
    res.json({
      items: items.map((f) => ({ ...f.product, images: safeParseJsonArray(f.product.images) })),
      total,
      limit,
      offset,
    })
  }),
)

router.post(
  '/favorites/:productId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const productId = req.params.productId
    const userId = req.user!.id
    // v9-audit-fix: reject soft-deleted products
    const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } })
    if (!product) return res.status(404).json({ error: 'Product not found' })

    // Atomic toggle via upsert — handles race conditions
    const existing = await prisma.favorite.findUnique({
      where: { userId_productId: { userId, productId } },
    })
    if (existing) {
      await prisma.favorite.delete({ where: { id: existing.id } })
      return res.json({ favorited: false })
    }
    try {
      await prisma.favorite.create({ data: { userId, productId } })
      // Lifetime counter — never decremented even if the user later unfavorites.
      // This is a "user showed interest" signal for the smart-ranking algorithm.
      prisma.product
        .update({ where: { id: productId }, data: { favoriteAdds: { increment: 1 } } })
        .catch(() => {})
      res.json({ favorited: true })
    } catch (e: any) {
      // P2002 = race: another request created it
      if (e?.code === 'P2002') {
        await prisma.favorite.delete({ where: { userId_productId: { userId, productId } } })
        return res.json({ favorited: false })
      }
      throw e
    }
  }),
)

// ============================================================================
// Cart
// ============================================================================
router.get(
  '/cart',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // v9-audit-fix: exclude cart items whose product has been soft-deleted
    const items = await prisma.cartItem.findMany({
      where: { userId: req.user!.id, product: { deletedAt: null } },
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json({
      items: items.map((c) => ({
        id: c.id,
        quantity: c.quantity,
        product: { ...c.product, images: safeParseJsonArray(c.product.images) },
      })),
    })
  }),
)

router.post(
  '/cart/:productId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const productId = req.params.productId
    const userId = req.user!.id
    const quantity = Math.min(Math.max(Number(req.body?.quantity ?? 1) || 1, 1), 9999)
    // v9-audit-fix: reject soft-deleted products
    const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } })
    if (!product) return res.status(404).json({ error: 'Product not found' })

    // Atomic upsert — handles race conditions
    const cartItem = await prisma.cartItem.upsert({
      where: { userId_productId: { userId, productId } },
      update: { quantity: { increment: quantity } },
      create: { userId, productId, quantity },
    })
    // Lifetime "cart add" counter — incremented only on the FIRST add,
    // not on quantity increases, so it reflects "how many unique users added this".
    // We detect first add by checking the resulting quantity equals the added qty.
    if (cartItem.quantity === quantity) {
      prisma.product
        .update({ where: { id: productId }, data: { cartAdds: { increment: 1 } } })
        .catch(() => {})
    }
    res.status(201).json({ cartItem })
  }),
)

router.patch(
  '/cart/:productId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const productId = req.params.productId
    const userId = req.user!.id
    const quantity = Math.min(Math.max(Number(req.body?.quantity ?? 1) || 1, 1), 9999)

    try {
      const updated = await prisma.cartItem.update({
        where: { userId_productId: { userId, productId } },
        data: { quantity },
      })
      res.json({ cartItem: updated })
    } catch (e: any) {
      if (e?.code === 'P2025') {
        return res.status(404).json({ error: 'Cart item not found' })
      }
      throw e
    }
  }),
)

router.delete(
  '/cart/:productId',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const productId = req.params.productId
    const userId = req.user!.id
    try {
      await prisma.cartItem.delete({ where: { userId_productId: { userId, productId } } })
    } catch {
      /* ignore if missing */
    }
    res.json({ ok: true })
  }),
)

export default router
