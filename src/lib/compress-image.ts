export async function compressImage(file: File, maxWidth = 1280, quality = 0.75): Promise<File> {
  // v25.16: HEIC/HEIF (фото с iPhone) конвертируем в JPEG ЧЕРЕЗ canvas.
  // Раньше HEIC уходил на сервер как есть и Chrome-клиенты не видели фото;
  // Safari умеет декодировать HEIC в <img>, поэтому тянем его через canvas.
  // Если декодировать не получилось — вернём оригинал (сервер теперь
  // принимает HEIC благодаря magic-byte подписи).
  const isHeic =
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.hei[cf]$/i.test(file.name)
  if (!file.type.startsWith('image/') && !isHeic) return file
  if (!isHeic && file.type === 'image/gif') return file
  if (!isHeic && file.size < 300 * 1024) return file
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth }
        const canvas = document.createElement('canvas')
        canvas.width = width; canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(file); return }
        ctx.drawImage(img, 0, 0, width, height)
        const outputType = file.type === 'image/png' && !isHeic ? 'image/png' : 'image/jpeg'
        canvas.toBlob((blob) => {
          if (!blob || blob.size >= file.size) { resolve(file) } else {
            const ext = outputType === 'image/png' ? 'png' : 'jpg'
            resolve(new File([blob], file.name.replace(/\.\w+$/, '') + '.' + ext, { type: outputType }))
          }
        }, outputType, quality)
      }
      img.onerror = () => resolve(file)
      img.src = e.target?.result as string
    }
    reader.onerror = () => resolve(file)
    reader.readAsDataURL(file)
  })
}
