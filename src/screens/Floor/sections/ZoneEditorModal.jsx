import { useState } from 'react'
import { Button, Field, Input, Modal } from '../../../components/ui'
import { useConfirm } from '../../../components/ui/confirm-context'
import { useI18n } from '../../../lib/i18n'
import { useRestora } from '../../../lib/store'

// Rename a floor zone (its assigned tables follow), or create the first
// one straight from Manage. Deleting never touches tables — they fall
// back to 'Main' in the reducer.
function ZoneEditorModal({ zone = null, zoneCount = 0, onClose }) {
  const { dispatch } = useRestora()
  const { lang } = useI18n()
  const confirm = useConfirm()
  const editing = Boolean(zone)
  const [name, setName] = useState(zone?.name || `Zone ${zoneCount + 1}`)
  const [error, setError] = useState('')

  function save() {
    if (!name.trim()) {
      setError(lang === 'km' ? 'សូមដាក់ឈ្មោះតំបន់។' : lang === 'zh' ? '请为区域命名。' : 'Give the zone a name.')
      return
    }
    if (editing) dispatch({ type: 'UPDATE_FLOOR_ZONE', zoneId: zone.id, patch: { name } })
    else dispatch({ type: 'CREATE_FLOOR_ZONE', name })
    onClose()
  }

  async function remove() {
    const ok = await confirm({
      title: lang === 'km' ? `លុបតំបន់ ${zone.name}?` : lang === 'zh' ? `删除区域 ${zone.name}？` : `Delete ${zone.name}?`,
      body: lang === 'km'
        ? 'តុទាំងអស់ក្នុងតំបន់នេះត្រឡប់ទៅតំបន់ Main វិញ។'
        : lang === 'zh'
          ? '该区域中的所有餐桌将回到“Main”区域。'
          : 'Its tables go back to the Main zone.',
      confirmLabel: 'Delete zone',
      tone: 'danger',
    })
    if (!ok) return
    dispatch({ type: 'DELETE_FLOOR_ZONE', zoneId: zone.id })
    onClose()
  }

  const modalTitle = editing
    ? (lang === 'km' ? `កែតំបន់ ${zone.name}` : lang === 'zh' ? `编辑区域 ${zone.name}` : `Edit zone`)
    : (lang === 'km' ? 'បន្ថែមតំបន់' : lang === 'zh' ? '添加区域' : 'Add zone')
  const modalSub = editing
    ? (lang === 'km' ? 'ប្ដូរឈ្មោះតំបន់ — តុដែលស្ថិតនៅក្នុងនោះតាមចុះ។ ប្លង់នៅលើផ្ទាំងតម្លៃរបស់វាកំណត់ឡើងវិញបាន।' : lang === 'zh' ? '重命名区域 — 其中的餐桌会跟随。矩形几何可在平面图上拖拽调整。' : 'Rename it — its assigned tables follow. The rectangle itself is moved and resized by drag on the map.')
    : (lang === 'km' ? 'បង្កើតតំបន់ថ្មី ដើម្បីដាក់តុ។' : lang === 'zh' ? '创建用于摆放餐桌的新区域。' : 'Create a region to hold tables.')

  return (
    <Modal
      title={modalTitle}
      sub={modalSub}
      onClose={onClose}
    >
      <div className="mt-3 space-y-4">
        <Field label={lang === 'km' ? 'ឈ្មោះ' : lang === 'zh' ? '名称' : 'Name'}>
          <Input
            value={name}
            onChange={(e) => { setName(e.target.value); setError('') }}
            placeholder="Terrace"
            maxLength={32}
            aria-label="Zone name"
            autoFocus
          />
        </Field>
        {error && (
          <div className="rounded-[var(--radius-lg)] bg-[var(--danger-soft)] px-3 py-2 text-[var(--fs-body)] text-[var(--danger)] ring-1 ring-inset ring-[var(--danger)]/30" role="alert">
            {error}
          </div>
        )}
        <Button block size="lg" onClick={save} aria-label="Save zone">
          {editing ? (lang === 'km' ? 'រក្សាទុកតំបន់' : lang === 'zh' ? '保存区域' : 'Save zone') : (lang === 'km' ? 'បន្ថែមតំបន់' : lang === 'zh' ? '添加区域' : 'Add zone')}
          {lang !== 'en' && <span className="sr-only"> {editing ? 'Save zone' : 'Add zone'}</span>}
        </Button>

        {editing && (
          <Button block variant="dangerGhost" onClick={remove} aria-label="Delete zone">
            {lang === 'km' ? 'លុបតំបន់' : lang === 'zh' ? '删除区域' : 'Delete zone'}
            {lang !== 'en' && <span className="sr-only"> Delete zone</span>}
          </Button>
        )}
      </div>
    </Modal>
  )
}


export { ZoneEditorModal }
