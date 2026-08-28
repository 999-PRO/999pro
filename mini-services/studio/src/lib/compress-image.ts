// Image compression utility — reduces file size before upload.
// Used by the Studio image uploader so product images don't end up as
// 5MB+ files that slow down the mobile app.
//
// Behaviour:
//   - Images smaller than 300KB are passed through unchanged
//   - GIFs are passed through unchanged (would break animation)
//   - Non-image files are passed through unchanged
//   - Images larger than maxWidth are resized down to maxWidth
//   - JPEG/WebP quality is set to 0.8 (good balance of quality/size)
//   - PNG with transparency is kept as PNG; PNG without alpha is converted to JPEG
//   - If compression somehow makes the file BIGGER, the original is returned
//
// v13.1 (audit P2-4 fix): actually detect alpha channel by reading pixel data.
//   Previously all PNGs were flattened to JPEG with a white background —
//   destroying transparency for hero/banner logos that need it. Now we
//   sample the corner pixel (and a few interior points) to detect alpha,
//   and keep PNG format when transparency is present.
export async function compressImage(file: File, maxWidth = 1280, quality = 0.8): Promise<File> {
  // v25.16: HEIC/HEIF (iPhone-фото) — всегда прогоняем через canvas и
  // отдаём JPEG: Студия работает чаще всего в Chrome, а он HEIC не
  // показывает. Декодирование доступно только в Safari — при неудаче
  // возвращаем оригинал (бэкенд теперь принимает HEIC напрямую).
  const isHeic =
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.hei[cf]$/i.test(file.name)
  if (!file.type.startsWith('image/') && !isHeic) return file
  if (file.type === 'image/gif') return file
  // Skip already-small files — no point compressing a 100KB thumbnail
  // (кроме HEIC — его всё равно нужно конвертировать в понятный формат)
  if (!isHeic && file.size < 300 * 1024) return file

  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width)
          width = maxWidth
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(file)
          return
        }

        // Draw the image to canvas first so we can inspect pixels.
        ctx.drawImage(img, 0, 0, width, height)

        // v13.1 (audit P2-4 fix): detect alpha channel by sampling pixels.
        // We sample the 4 corners + center of the canvas. If ANY sampled
        // pixel has alpha < 255, the image has transparency and we must
        // keep PNG format. Otherwise we can safely convert to JPEG (much
        // smaller for photographic content).
        let hasAlpha = false
        if (file.type === 'image/png') {
          try {
            const samplePoints = [
              [0, 0],
              [width - 1, 0],
              [0, height - 1],
              [width - 1, height - 1],
              [Math.floor(width / 2), Math.floor(height / 2)],
            ]
            for (const [px, py] of samplePoints) {
              const pixel = ctx.getImageData(px, py, 1, 1).data
              if (pixel[3] < 255) {
                hasAlpha = true
                break
              }
            }
            // If corners have alpha but we didn't catch it with 5 points,
            // do a more thorough scan (every 10th pixel) — only if the
            // image is small enough to make this cheap.
            if (!hasAlpha && width * height < 1_000_000) {
              const data = ctx.getImageData(0, 0, width, height).data
              for (let i = 3; i < data.length; i += 40) {
                if (data[i] < 255) {
                  hasAlpha = true
                  break
                }
              }
            }
          } catch {
            // getImageData can throw if the canvas is tainted (cross-origin
            // image). Assume no alpha in that case — the original PNG is
            // preserved anyway if compression doesn't help.
            hasAlpha = false
          }
        }

        // For PNGs WITHOUT alpha: clear canvas, fill white background,
        // redraw. This gives JPEG a clean opaque canvas to compress.
        if ((file.type === 'image/png' || isHeic) && !hasAlpha) {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, width, height)
          ctx.drawImage(img, 0, 0, width, height)
        }

        // Output format:
        //   - PNG with alpha → keep as PNG (transparency preserved)
        //   - PNG without alpha / HEIC → JPEG (much smaller for photos,
        //     и единый формат для всех браузеров вместо HEIC)
        //   - JPEG/WebP → keep original format
        const outputType = file.type === 'image/png' && hasAlpha ? 'image/png' : file.type === 'image/png' || isHeic ? 'image/jpeg' : file.type
        const outputExt = outputType === 'image/jpeg' ? '.jpg' : outputType === 'image/webp' ? '.webp' : '.png'

        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= file.size) {
              // Compressed version is bigger or failed — return original
              resolve(file)
            } else {
              const baseName = file.name.replace(/\.\w+$/, '')
              resolve(
                new File([blob], baseName + outputExt, { type: outputType }),
              )
            }
          },
          outputType,
          // PNG ignores the quality parameter (lossless)
          outputType === 'image/png' ? undefined : quality,
        )
      }
      img.onerror = () => resolve(file)
      img.src = e.target?.result as string
    }
    reader.onerror = () => resolve(file)
    reader.readAsDataURL(file)
  })
}
