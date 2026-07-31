/**
 * Утилиты для рендера сообщений чата:
 *  - linkify: делает URL в тексте кликабельными
 *  - getDocumentIcon: возвращает информацию об иконке для файла по его расширению
 */

// Регулярка для поиска URL в тексте.
// Совпадает с http(s)://... и www.... (без пробелов и кириллицы в домене)
const URL_REGEX = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi

/**
 * Разбивает текст на части: обычный текст и ссылки.
 * Возвращает массив сегментов, которые можно рендерить в React.
 *
 * Пример:
 *   linkify("Привет, смотри https://example.com тут")
 *   → [{ type: 'text', text: 'Привет, смотри ' },
 *      { type: 'link', url: 'https://example.com', text: 'https://example.com' },
 *      { type: 'text', text: ' тут' }]
 */
export interface TextSegment {
  type: 'text' | 'link'
  text: string
  url?: string
}

export function linkify(text: string): TextSegment[] {
  if (!text) return [{ type: 'text', text: '' }]
  const segments: TextSegment[] = []
  let lastIndex = 0
  const regex = new RegExp(URL_REGEX.source, 'gi')
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const matchStart = match.index
    const matchText = match[0]
    let url = matchText
    // Если начинается с www — добавляем https://
    if (url.startsWith('www.')) {
      url = 'https://' + url
    }
    // Добавляем текст до ссылки
    if (matchStart > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, matchStart) })
    }
    segments.push({ type: 'link', text: matchText, url })
    lastIndex = matchStart + matchText.length
  }
  // Добавляем оставшийся текст
  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) })
  }
  return segments.length > 0 ? segments : [{ type: 'text', text }]
}

// ============================================================================
// Иконки для документов — возвращаем цвет + emoji/буквы для популярных форматов
// ============================================================================

export interface DocIconInfo {
  /** Короткая подпись (например: "PDF", "DOCX", "XLSX") */
  label: string
  /** Цвет фона для иконки (Tailwind-совместимый hex) */
  color: string
  /** Имя файла-иконки (без расширения) — для будущего SVG */
  icon: 'pdf' | 'word' | 'excel' | 'powerpoint' | 'image' | 'video' | 'audio' | 'archive' | 'code' | 'text' | 'file'
}

/**
 * Определяет тип документа по имени файла или URL.
 * Возвращает инфо об иконке для рендера.
 */
export function getDocumentIcon(filename: string): DocIconInfo {
  const ext = (filename.split('.').pop() || '').toLowerCase()

  // PDF
  if (ext === 'pdf') return { label: 'PDF', color: '#ef4444', icon: 'pdf' }

  // Word
  if (['doc', 'docx', 'rtf', 'odt'].includes(ext))
    return { label: 'DOC', color: '#2563eb', icon: 'word' }

  // Excel
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext))
    return { label: 'XLS', color: '#10b981', icon: 'excel' }

  // PowerPoint
  if (['ppt', 'pptx', 'odp'].includes(ext))
    return { label: 'PPT', color: '#f59e0b', icon: 'powerpoint' }

  // Архивы
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext))
    return { label: 'ZIP', color: '#8b5cf6', icon: 'archive' }

  // Код
  if (['js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'py', 'java', 'cpp', 'c', 'go', 'rs', 'php'].includes(ext))
    return { label: ext.toUpperCase(), color: '#64748b', icon: 'code' }

  // Текст
  if (['txt', 'md', 'log'].includes(ext))
    return { label: 'TXT', color: '#64748b', icon: 'text' }

  // По умолчанию
  return { label: ext.toUpperCase() || 'FILE', color: '#64748b', icon: 'file' }
}

/**
 * Извлекает имя файла из URL (например: /uploads/123-abc.docx → 123-abc.docx).
 * Если URL содержит query-параметры — обрезает их.
 */
export function getFilenameFromUrl(url: string): string {
  try {
    const u = new URL(url, window.location.origin)
    const pathname = u.pathname
    return pathname.split('/').pop() || 'file'
  } catch {
    return url.split('/').pop()?.split('?')[0] || 'file'
  }
}

/**
 * Проверяет, является ли URL изображением по расширению.
 */
export function isImageUrl(url: string): boolean {
  const ext = (url.split('.').pop() || '').toLowerCase().split('?')[0]
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp'].includes(ext)
}

/**
 * Проверяет, является ли URL видеофайлом по расширению.
 */
export function isVideoUrl(url: string): boolean {
  const ext = (url.split('.').pop() || '').toLowerCase().split('?')[0]
  return ['mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg'].includes(ext)
}

/**
 * Проверяет, является ли URL аудиофайлом по расширению.
 */
export function isAudioUrl(url: string): boolean {
  const ext = (url.split('.').pop() || '').toLowerCase().split('?')[0]
  return ['mp3', 'wav', 'ogg', 'm4a', 'weba', 'aac', 'flac'].includes(ext)
}
