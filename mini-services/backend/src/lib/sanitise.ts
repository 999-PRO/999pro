/**
 * HTML sanitiser — server-side defence against stored XSS in user-edited
 * HTML fields (Info Pages, Hero block text, AI KB system prompt).
 *
 * Uses sanitize-html with a strict allowlist. Drops <script>, on* attributes,
 * javascript: URLs, and any tag not in the allowlist.
 */

import sanitizeHtml from 'sanitize-html'

const STRICT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'a', 'img', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'mark',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'div', 'span', 'figure', 'figcaption', 'details', 'summary',
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    '*': ['class', 'id', 'style'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  // Strip style attributes that could carry malicious CSS (expression(), url(javascript:))
  allowedStyles: {},
  // Enforce rel=noopener noreferrer on target=_blank links
  transformTags: {
    a: (tagName, attribs) => {
      if (attribs.target === '_blank') {
        return {
          tagName,
          attribs: { ...attribs, rel: 'noopener noreferrer' },
        }
      }
      return { tagName, attribs }
    },
  },
  // Disallow unknown protocols entirely
  allowVulnerableTags: false,
  disallowedTagsMode: 'discard',
}

/** Sanitise rich HTML content (info pages, etc.). Returns safe HTML. */
export function sanitiseRichHtml(input: string): string {
  if (!input || typeof input !== 'string') return ''
  return sanitizeHtml(input, STRICT_OPTIONS)
}

/** Stricter sanitiser for plain-text-ish fields (titles, badges). Only inline tags. */
export function sanitiseInlineHtml(input: string): string {
  if (!input || typeof input !== 'string') return ''
  return sanitizeHtml(input, {
    allowedTags: ['b', 'i', 'em', 'strong', 'br', 'span'],
    allowedAttributes: { '*': ['class'] },
    allowedSchemes: [],
  })
}

/** Strip ALL HTML — for fields that should be plain text only. */
export function stripHtml(input: string): string {
  if (!input || typeof input !== 'string') return ''
  return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} })
}
