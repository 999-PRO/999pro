import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { logger } from './logger.js'

// ============================================================================
// Email service — SMTP via nodemailer.
//
// AUDIT-3 S-HIGH-002 fix (v16.8): implements real SMTP sending for email
// verification, password reset, and order/notification emails. Previously
// the verification URL was just logged to stderr — anyone with log access
// could see the token, and emails were never actually sent.
//
// Configuration via env:
//   SMTP_HOST     — SMTP server hostname (e.g. smtp.yandex.ru, smtp.gmail.com)
//   SMTP_PORT     — port (default 587 for STARTTLS, 465 for SSL)
//   SMTP_USER     — username
//   SMTP_PASS     — password
//   SMTP_FROM     — From: address (default: no-reply@999.pro)
//   SMTP_SECURE   — 'true' for port 465 (implicit TLS), 'false' for 587 (STARTTLS)
//
// If SMTP_HOST is unset, emails are silently skipped (dev mode). In prod,
// EMAIL_VERIFICATION_REQUIRED=true should be paired with a real SMTP config.
// ============================================================================

let transporter: Transporter | null = null
let lastTransportConfig = ''

function getTransporter(): Transporter | null {
  const host = process.env.SMTP_HOST || ''
  if (!host) return null

  const port = Number(process.env.SMTP_PORT || 587)
  const user = process.env.SMTP_USER || ''
  const pass = process.env.SMTP_PASS || ''
  const secure = process.env.SMTP_SECURE === 'true' || port === 465

  // Cache key — recreate transporter only if config changed
  const config = `${host}:${port}:${user}:${secure}`
  if (transporter && config === lastTransportConfig) return transporter

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
    // Yandex/Gmail often require STARTTLS even on 587
    requireTLS: !secure,
  })
  lastTransportConfig = config
  return transporter
}

export interface SendEmailOptions {
  to: string
  subject: string
  text: string
  html?: string
}

/**
 * Send an email. Returns true on success, false on failure (or if no SMTP configured).
 * Never throws — email failures are non-blocking for the calling flow.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  const t = getTransporter()
  if (!t) {
    // No SMTP configured — dev mode. Log the subject (NOT the body — body
    // may contain verification tokens or reset links).
    logger.info(`[EMAIL] (no SMTP) Skipped email to ${opts.to}: ${opts.subject}`)
    return false
  }

  const from = process.env.SMTP_FROM || 'no-reply@999.pro'
  try {
    await t.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    })
    logger.info(`[EMAIL] Sent to ${opts.to}: ${opts.subject}`)
    return true
  } catch (e) {
    logger.error(`[EMAIL] Failed to send to ${opts.to}:`, { module: 'email', error: e })
    return false
  }
}

/**
 * AUDIT-3 S-HIGH-002 fix: send the email verification message.
 * The verification URL is NOT logged — only the recipient + subject.
 */
export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  await sendEmail({
    to,
    subject: '999 — Три девятки — подтверждение email',
    text: (
      `Здравствуйте!\n\n` +
      `Для подтверждения email перейдите по ссылке:\n${verifyUrl}\n\n` +
      `Ссылка действительна 24 часа. Если вы не регистрировались на «Три девятки», ` +
      `просто проигнорируйте это письмо.\n\n— Команда «Три девятки»`
    ),
    html: (
      `<div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">` +
      `<h2 style="color:#796d47">999 — Три девятки — подтверждение email</h2>` +
      `<p>Здравствуйте!</p>` +
      `<p>Для подтверждения email перейдите по кнопке ниже:</p>` +
      `<p style="margin:24px 0"><a href="${verifyUrl}" style="display:inline-block;background:#796d47;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">Подтвердить email</a></p>` +
      `<p style="color:#666;font-size:13px">Ссылка действительна 24 часа. Если вы не регистрировались на «Три девятки», просто проигнорируйте это письмо.</p>` +
      `<p style="color:#666;font-size:13px">— Команда «Три девятки»</p>` +
      `</div>`
    ),
  })
}

/**
 * AUDIT-3 S-MED-008 fix: send password reset email.
 */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await sendEmail({
    to,
    subject: '999 — Три девятки — сброс пароля',
    text: (
      `Здравствуйте!\n\n` +
      `Для сброса пароля перейдите по ссылке:\n${resetUrl}\n\n` +
      `Ссылка действительна 1 час. Если вы не запрашивали сброс пароля, ` +
      `проигнорируйте это письмо — ваш пароль останется без изменений.\n\n— Команда «Три девятки»`
    ),
    html: (
      `<div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">` +
      `<h2 style="color:#796d47">999 — Три девятки — сброс пароля</h2>` +
      `<p>Здравствуйте!</p>` +
      `<p>Для сброса пароля нажмите кнопку ниже:</p>` +
      `<p style="margin:24px 0"><a href="${resetUrl}" style="display:inline-block;background:#796d47;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">Сбросить пароль</a></p>` +
      `<p style="color:#666;font-size:13px">Ссылка действительна 1 час. Если вы не запрашивали сброс пароля, проигнорируйте это письмо — ваш пароль останется без изменений.</p>` +
      `<p style="color:#666;font-size:13px">— Команда «Три девятки»</p>` +
      `</div>`
    ),
  })
}
