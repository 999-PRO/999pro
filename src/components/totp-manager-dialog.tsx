'use client'

/**
 * v19.0 — 2FA / TOTP management dialog for regular users.
 *
 * Allows the user to:
 *   - Enable TOTP 2FA (scan QR, enter verification code)
 *   - Disable TOTP 2FA (enter current code)
 *   - Generate backup codes
 *
 * For admins, TOTP is already managed via the login flow (mandatory setup).
 * This dialog is primarily for regular users who want to enable 2FA voluntarily.
 */

import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, ShieldCheck, ShieldOff, Key, QrCode, Copy, Check } from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from '@/lib/notifications'

interface TOTPManagerDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  totpEnabled: boolean
  onUpdated?: () => void
}

export function TOTPManagerDialog({ open, onOpenChange, totpEnabled, onUpdated }: TOTPManagerDialogProps) {
  const [mode, setMode] = useState<'idle' | 'setup' | 'verify' | 'disable' | 'backup'>('idle')
  const [secret, setSecret] = useState('')
  const [otpauthUrl, setOtpauthUrl] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)

  const reset = () => {
    setMode('idle')
    setSecret('')
    setOtpauthUrl('')
    setCode('')
    setBackupCodes(null)
  }

  const setup = async () => {
    setBusy(true)
    try {
      const data = await api.post<{ secret: string; otpauthUrl: string }>('/api/auth/totp/setup', { json: {}, auth: true })
      setSecret(data.secret)
      setOtpauthUrl(data.otpauthUrl)
      setMode('verify')
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось начать настройку 2FA')
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (!code.trim() || code.length !== 6) {
      toast.error('Введите 6-значный код')
      return
    }
    setBusy(true)
    try {
      await api.post('/api/auth/totp/verify', { json: { code }, auth: true })
      toast.success('2FA включена!')
      reset()
      onOpenChange(false)
      onUpdated?.()
    } catch (e: any) {
      toast.error(e?.message || 'Неверный код')
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    if (!code.trim()) {
      toast.error('Введите код для подтверждения')
      return
    }
    setBusy(true)
    try {
      await api.post('/api/auth/totp/disable', { json: { code }, auth: true })
      toast.success('2FA отключена')
      reset()
      onOpenChange(false)
      onUpdated?.()
    } catch (e: any) {
      toast.error(e?.message || 'Неверный код')
    } finally {
      setBusy(false)
    }
  }

  const generateBackupCodes = async () => {
    setBusy(true)
    try {
      const data = await api.post<{ codes: string[]; message: string }>('/api/security/totp/backup-codes', { json: {}, auth: true })
      setBackupCodes(data.codes)
      toast.success('Резервные коды сгенерированы')
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось сгенерировать коды')
    } finally {
      setBusy(false)
    }
  }

  const copyCodes = () => {
    if (!backupCodes) return
    navigator.clipboard.writeText(backupCodes.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Двухфакторная аутентификация
          </DialogTitle>
          <DialogDescription>
            Защитите аккаунт дополнительным кодом из приложения-аутентификатора.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status */}
          <div className={`rounded-xl p-3 ${totpEnabled ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-amber-500/10 border border-amber-500/20'}`}>
            <div className="flex items-center gap-2 text-sm font-medium">
              {totpEnabled ? (
                <><Check className="h-4 w-4 text-emerald-600" /> 2FA включена</>
              ) : (
                <><ShieldOff className="h-4 w-4 text-amber-600" /> 2FA не включена</>
              )}
            </div>
          </div>

          {/* Idle: show setup/disable options */}
          {mode === 'idle' && (
            <div className="space-y-2">
              {!totpEnabled && (
                <Button onClick={setup} disabled={busy} className="w-full gap-2">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Включить 2FA
                </Button>
              )}
              {totpEnabled && (
                <>
                  <Button onClick={() => setMode('disable')} variant="outline" className="w-full gap-2">
                    <ShieldOff className="h-4 w-4" /> Отключить 2FA
                  </Button>
                  <Button onClick={() => setMode('backup')} variant="outline" className="w-full gap-2">
                    <Key className="h-4 w-4" /> Резервные коды
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Verify mode: show QR + code input */}
          {mode === 'verify' && (
            <div className="space-y-3">
              <p className="text-sm">
                Отсканируйте этот QR-код в приложении Google Authenticator, Authy или любом другом TOTP-приложении:
              </p>
              {otpauthUrl && (
                <div className="grid place-items-center bg-white p-3 rounded-xl">
                  {/* v24.6-audit (C-FE-1 fix): generate QR locally via `qrcode` lib.
                      Previous version leaked the user's permanent TOTP secret to
                      api.qrserver.com via URL query string — a third-party could
                      log and reuse it to bypass 2FA. */}
                  <QRCodeCanvas data={otpauthUrl} size={200} />
                </div>
              )}
              <div className="text-xs">
                Или введите секрет вручную: <code className="font-mono bg-muted px-1.5 py-0.5 rounded">{secret}</code>
              </div>
              <div className="space-y-1.5">
                <Label>6-значный код из приложения</Label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="text-center font-mono text-lg tracking-widest"
                />
              </div>
              <Button onClick={verify} disabled={busy || code.length !== 6} className="w-full gap-2">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Подтвердить
              </Button>
            </div>
          )}

          {/* Disable mode */}
          {mode === 'disable' && (
            <div className="space-y-3">
              <p className="text-sm">Введите текущий код для подтверждения отключения:</p>
              <div className="space-y-1.5">
                <Label>TOTP код</Label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="text-center font-mono text-lg tracking-widest"
                />
              </div>
              <Button onClick={disable} disabled={busy} variant="destructive" className="w-full gap-2">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Отключить 2FA
              </Button>
            </div>
          )}

          {/* Backup codes mode */}
          {mode === 'backup' && (
            <div className="space-y-3">
              {!backupCodes ? (
                <>
                  <p className="text-sm">
                    Резервные коды позволяют войти в аккаунт, если у вас нет доступа к телефону.
                    Каждый код можно использовать один раз.
                  </p>
                  <Button onClick={generateBackupCodes} disabled={busy} className="w-full gap-2">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />}
                    Сгенерировать новые коды
                  </Button>
                </>
              ) : (
                <>
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-400">
                    ⚠️ Сохраните эти коды в безопасном месте. Они показываются только один раз.
                  </div>
                  <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                    {backupCodes.map((c, i) => (
                      <div key={i} className="bg-muted px-2 py-1.5 rounded text-center">{c}</div>
                    ))}
                  </div>
                  <Button onClick={copyCodes} variant="outline" className="w-full gap-2">
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? 'Скопировано!' : 'Скопировать все'}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// v24.6-audit (C-FE-1 fix): local QR code renderer — generates QR PNG data URL
// via the `qrcode` package (already a project dependency). Replaces the previous
// implementation that called api.qrserver.com with the TOTP secret in the URL.
function QRCodeCanvas({ data, size = 200 }: { data: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!canvasRef.current || !data) return
    setError(false)
    QRCode.toCanvas(
      canvasRef.current,
      data,
      {
        width: size,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      },
      (err: Error | null | undefined) => {
        if (err) {
          // Should never happen for a valid otpauth URL, but never crash the dialog
          setError(true)
        }
      }
    )
  }, [data, size])

  if (error) {
    return (
      <div className="text-xs text-destructive text-center p-4 border border-destructive/30 rounded-lg max-w-[200px]">
        Ошибка генерации QR.
        <br />
        Введите секрет вручную ниже.
      </div>
    )
  }

  return <canvas ref={canvasRef} width={size} height={size} role="img" aria-label="TOTP QR code" />
}
