'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Pencil, Phone, MessageCircle, Send, Mail, MapPin, User } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useConfirmDialog, StudioConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { toast } from '@/lib/notifications'

interface Department {
  id: string
  name: string
  slug: string
  sortOrder: number
  isActive: boolean
  phone: string | null
  whatsapp: string | null
  telegram: string | null
  email: string | null
  address: string | null
  managerName: string | null
  description: string | null
  _count?: { products: number }
}

export function DepartmentsManager() {
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Department | null>(null)
  const [creating, setCreating] = useState(false)
  const { dialog: confirmDialog, confirm: openConfirm, close: closeConfirm } = useConfirmDialog()
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.get<{ items: Department[] }>('/api/departments/all', { auth: true })
      setDepartments(d.items)
    } catch {
      toast.error('Не удалось загрузить подразделения')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await api.delete(`/api/departments/${deleteId}`, { auth: true })
      toast.success('Подразделение удалено')
      setDepartments(departments.filter((d) => d.id !== deleteId))
    } catch {
      toast.error('Ошибка удаления')
    } finally {
      setDeleteId(null)
      closeConfirm()
    }
  }

  if (loading) {
    return (
      <div className="px-4 md:px-6 py-6 pb-28 page-top-padding">
        <div className="h-8 w-48 skeleton rounded-lg mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 skeleton rounded-2xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 md:px-6 py-6 pb-28 page-top-padding max-w-3xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Подразделения</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Контакты по направлениям (Реклама, Подарки, Мебель и т.д.). Каждое подразделение привязывается к товарам.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="rounded-full gradient-brand text-white shadow-glow">
          <Plus className="h-4 w-4 mr-1" /> Добавить
        </Button>
      </div>

      {departments.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed border-border">
          <p className="text-muted-foreground mb-3">Пока нет подразделений</p>
          <Button onClick={() => setCreating(true)} variant="outline" className="rounded-full">
            <Plus className="h-4 w-4 mr-1" /> Создать первое
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {departments.map((dept) => (
            <div
              key={dept.id}
              className="rounded-2xl border border-border bg-card p-4 flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-base truncate">{dept.name}</h3>
                  {!dept.isActive && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      Скрыт
                    </span>
                  )}
                  {dept._count && dept._count.products > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-600">
                      {dept._count.products} тов.
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {dept.managerName && <span className="flex items-center gap-1"><User className="h-3 w-3" />{dept.managerName}</span>}
                  {dept.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{dept.phone}</span>}
                  {dept.whatsapp && <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />WhatsApp</span>}
                  {dept.telegram && <span className="flex items-center gap-1"><Send className="h-3 w-3" />Telegram</span>}
                  {dept.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{dept.email}</span>}
                  {dept.address && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{dept.address}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setEditing(dept)}
                  className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => { setDeleteId(dept.id); openConfirm({ title: 'Удалить подразделение?', message: 'Товары этого подразделения останутся, но потеряют привязку к контактам.', confirmLabel: 'Удалить', variant: 'danger', onConfirm: handleDelete }) }}
                  className="p-2 rounded-lg hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <DepartmentEditor
          department={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); load() }}
        />
      )}

      <StudioConfirmDialog
        dialog={confirmDialog}
        onClose={() => { closeConfirm(); setDeleteId(null) }}
      />
    </div>
  )
}

function DepartmentEditor({ department, onClose, onSaved }: {
  department: Department | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(department?.name || '')
  const [phone, setPhone] = useState(department?.phone || '')
  const [whatsapp, setWhatsapp] = useState(department?.whatsapp || '')
  const [telegram, setTelegram] = useState(department?.telegram || '')
  const [email, setEmail] = useState(department?.email || '')
  const [address, setAddress] = useState(department?.address || '')
  const [managerName, setManagerName] = useState(department?.managerName || '')
  const [description, setDescription] = useState(department?.description || '')
  const [isActive, setIsActive] = useState(department?.isActive ?? true)
  const [sortOrder, setSortOrder] = useState(department?.sortOrder ?? 0)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!name.trim()) return toast.error('Введите название')
    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        phone: phone.trim() || null,
        whatsapp: whatsapp.trim() || null,
        telegram: telegram.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        managerName: managerName.trim() || null,
        description: description.trim() || null,
        isActive,
        sortOrder,
      }
      if (department) {
        await api.patch(`/api/departments/${department.id}`, { json: body, auth: true })
        toast.success('Подразделение обновлено')
      } else {
        await api.post('/api/departments', { json: body, auth: true })
        toast.success('Подразделение создано')
      }
      onSaved()
    } catch (e: unknown) {
      toast.error('Ошибка', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={true} modal={false} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg rounded-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{department ? 'Редактировать подразделение' : 'Новое подразделение'}</DialogTitle>
          <DialogDescription>Контакты для направления (Реклама, Подарки, Мебель и т.д.)</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Название направления *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Реклама" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Имя менеджера</Label>
              <Input value={managerName} onChange={(e) => setManagerName(e.target.value)} placeholder="Иван Иванов" />
            </div>
            <div className="space-y-1.5">
              <Label>Телефон</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 999 123-45-67" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>WhatsApp</Label>
              <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+79991234567 или ссылка" />
            </div>
            <div className="space-y-1.5">
              <Label>Telegram</Label>
              <Input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="@username или ссылка" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="manager@999.pro" />
          </div>

          <div className="space-y-1.5">
            <Label>Адрес</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="г. Москва, ул. Пример, 1" />
          </div>

          <div className="space-y-1.5">
            <Label>Описание</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Доп. информация о подразделении"
              rows={2}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-400/20 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} id="dept-active" />
              <Label htmlFor="dept-active">Активен</Label>
            </div>
            <div className="space-y-1.5">
              <Label>Порядок сортировки</Label>
              <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1 rounded-full h-11" onClick={onClose}>Отмена</Button>
            <Button className="flex-1 rounded-full gradient-brand text-white shadow-glow h-11" onClick={save} disabled={saving}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
