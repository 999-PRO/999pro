export async function compressImage(file: File, maxWidth = 1280, quality = 0.75): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (file.type === 'image/gif') return file
  if (file.size < 300 * 1024) return file
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
        if (file.type === 'image/png') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height) }
        ctx.drawImage(img, 0, 0, width, height)
        const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
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
