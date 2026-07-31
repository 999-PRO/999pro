// ============================================================================
//  Web Share Target — POST /api/share-target
//  ----------------------------------------------------------------------------
//  P-HIGH-003: the PWA manifest declares a `share_target` so Android / Chrome
//  OS / Edge show "999 — Три девятки" in the native share sheet. When the user picks us,
//  the browser POSTs a multipart/form-data request to this URL with the shared
//  content as fields.
//
//  v10-native: full file handling — uploads the shared image to the backend
//  /api/upload endpoint, then redirects to the chat view with the uploaded
//  image URL so the user can send it to a recipient.
//
//  Why 303 (not 302): 303 forces the browser to issue a GET for the redirect
//  target and discards the POST body — required by the Web Share Target spec
//  so the user doesn't see a "re-submit form?" dialog.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const title = formData.get('title') as string | null
    const text = formData.get('text') as string | null
    const url = formData.get('url') as string | null
    // v9-audit-fix: manifest declares field name "image", but old code read "file".
    // Try both for backward compatibility — any existing PWA installs that cached
    // the old manifest will still send "file", while new installs use "image".
    const file = (formData.get('image') || formData.get('file')) as File | null

    // Concatenate the non-empty text fields with blank-line separators.
    const sharedText = [title, text, url].filter(Boolean).join('\n\n')

    const params = new URLSearchParams()
    if (sharedText) params.set('text', sharedText.slice(0, 500))

    // v10-native: if a file was shared, upload it to the backend and pass
    // the resulting URL to the client so the user can send it in a chat.
    if (file && file.size > 0 && file.size < 50 * 1024 * 1024) {
      try {
        const uploadFormData = new FormData()
        uploadFormData.append('file', file, file.name || `shared-${Date.now()}.jpg`)
        const uploadRes = await fetch(`${BACKEND_URL}/api/upload`, {
          method: 'POST',
          body: uploadFormData,
        })
        if (uploadRes.ok) {
          const data = await uploadRes.json() as { url?: string }
          if (data.url) {
            params.set('shared_image', data.url)
          }
        }
      } catch {
        // Upload failed — still redirect with the text only.
      }
    } else if (file) {
      params.set('shared_file', file.name || 'shared-file')
    }

    // Redirect to chat view so the user can pick a recipient and send
    // the shared text/image. The client detects ?shared=1 and opens the
    // chat view with a pre-filled message composer.
    const redirectUrl = params.toString()
      ? `/?shared=1&view=chat&${params.toString()}`
      : '/?shared=1&view=chat'
    return NextResponse.redirect(new URL(redirectUrl, req.url), 303)
  } catch {
    // If formData parsing fails (e.g. malformed multipart), still redirect
    // home with an error flag so the user lands somewhere useful rather
    // than seeing a 500 page.
    return NextResponse.redirect(new URL('/?shared=error', req.url), 303)
  }
}
