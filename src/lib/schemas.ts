// ============================================================================
//  F-HIGH-005: zod validation schemas for main public-facing forms.
//  ----------------------------------------------------------------------------
//  Previously `zod` was declared in `package.json` but never imported — a dead
//  dependency flagged in the frontend audit. These schemas cover the primary
//  user-input surfaces on the storefront (auth) and can be reused by both
//  client components (for inline error display) and API routes (for server-side
//  validation).
//
//  Russian error messages match the rest of the UI copy.
//
//  v9-audit-fix: removed unused registerSchema, leadSchema, reviewSchema and
//  their inferred types (0 importers confirmed via grep). Only loginSchema is
//  wired into the auth dialog. Removed schemas can be re-added when their
//  respective forms are wired up.
// ============================================================================

import { z } from 'zod'

// ----------------------------------------------------------------------------
//  Auth
// ----------------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().email('Некорректный email'),
  password: z.string().min(8, 'Минимум 8 символов'),
})

// ----------------------------------------------------------------------------
//  Inferred types — useful for typing form-state / API payloads
// ----------------------------------------------------------------------------

export type LoginInput = z.infer<typeof loginSchema>
