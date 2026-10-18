import { useState } from 'react'
import { Button, Field, Input, Modal, Select, Stepper } from '../../../components/ui'
import QrPrintModal from '../../../components/QrPrintModal'
import { useI18n } from '../../../lib/i18n'
import { useRestora } from '../../../lib/store'

function TableEditorModal({ table = null, zones, onClose }) {
  const { dispatch } = useRestora()
  const { lang } = useI18n()
  const editing = Boolean(table)
  const [name, setName] = useState(table?.name || '')
  const [seats, setSeats] = useState(table?.seats || 2)
  const [zone, setZone] = useState(table?.zone || zones[0] || 'Main')
  const [newZone, setNewZone] = useState(false)
  const [newZoneName, setNewZoneName] = useState('')
  const [error, setError] = useState('')
  const [showQr, setShowQr] = useState(false)

  function save() {
    if (!name.trim()) {
      setError(lang === 'km' ? 'សូមដាក់ឈ្មោះតុ។' : lang === 'zh' ? '请为餐桌命名。' : 'Give the table a name.')
      return
    }
    let zoneName = zone
    if (newZone) {
      // Typing a brand-new zone creates the record first, so the table
      // always belongs to a real rectangle on the plan.
      zoneName = (newZoneName.trim() || 'Main').slice(0, 32)
      if (!zones.includes(zoneName)) dispatch({ type: 'CREATE_FLOOR_ZONE', name: zoneName })
    }
    if (editing) dispatch({ type: 'UPDATE_TABLE', tableId: table.id, patch: { name, seats, zone: zoneName } })
    else dispatch({ type: 'ADD_TABLE', table: { name, seats, zone: zoneName } })
    onClose()
  }

  const modalTitle = editing
    ? (lang === 'km' ? `កែប្រែ ${table.name}` : lang === 'zh' ? `编辑 ${table.name}` : `Edit ${table.name}`)
    : (lang === 'km' ? 'បន្ថែមតុ' : lang === 'zh' ? '添加餐桌' : 'Add table')
  const modalSub = editing
    ? (lang === 'km' ? 'ប្តូរឈ្មោះ កែប្រែកៅអី ឬប្តូរទៅតំបន់ផ្សេង។' : lang === 'zh' ? '重命名、更改座位或移至其他区域。' : 'Rename, reseat, or move it to another zone.')
    : (lang === 'km' ? 'បង្កើតតុថ្មីមួយនៅលើប្លង់ភោជនីយដ្ឋាន។' : lang === 'zh' ? '在平面图上创建一张新餐桌。' : 'Create a new table on the floor.')

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
            placeholder="Table 17"
            maxLength={40}
            aria-label="Table name"
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={lang === 'km' ? 'កៅអី' : lang === 'zh' ? '座位' : 'Seats'}>
            <Stepper value={seats} onChange={setSeats} min={1} max={24} />
          </Field>
          <Field label={lang === 'km' ? 'តំបន់' : lang === 'zh' ? '区域' : 'Zone'}>
            {newZone ? (
              <div>
                <Input
                  value={newZoneName}
                  onChange={(e) => setNewZoneName(e.target.value)}
                  placeholder="Poolside"
                  maxLength={32}
                  aria-label="New zone name"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setNewZone(false)}
                  className="mt-1 text-[var(--fs-caption)] font-semibold text-[var(--accent)] hover:underline"
                >
                  {lang === 'km' ? 'ប្រើតំបន់ដែលមានស្រាប់' : lang === 'zh' ? '使用现有区域' : 'Use an existing zone'}
                </button>
              </div>
            ) : (
              <Select
                value={zone}
                onChange={(e) => { if (e.target.value === '__new') setNewZone(true); else setZone(e.target.value) }}
                aria-label="Zone"
              >
                {zones.map((entry) => (
                  <option key={entry} value={entry}>{entry}</option>
                ))}
                <option value="__new">➕ {lang === 'km' ? 'តំបន់ថ្មី…' : lang === 'zh' ? '新建区域…' : 'New zone…'}</option>
              </Select>
            )}
          </Field>
        </div>
        {error && (
          <div className="rounded-[var(--radius-lg)] bg-[var(--danger-soft)] px-3 py-2 text-[var(--fs-body)] text-[var(--danger)] ring-1 ring-inset ring-[var(--danger)]/30" role="alert">
            {error}
          </div>
        )}
        <Button block size="lg" onClick={save} aria-label="Save table">
          {editing ? (lang === 'km' ? 'រក្សាទុកតុ' : lang === 'zh' ? '保存餐桌' : 'Save table') : (lang === 'km' ? 'បន្ថែមតុ' : lang === 'zh' ? '添加餐桌' : 'Add table')}
          {lang !== 'en' && <span className="sr-only"> {editing ? 'Save table' : 'Add table'}</span>}
        </Button>

        {editing && (
          <Button block variant="secondary" onClick={() => setShowQr(true)}>
            📱 Print Table QR Tent (Self-order)
          </Button>
        )}
      </div>

      {showQr && (
        <QrPrintModal table={table} onClose={() => setShowQr(false)} />
      )}
    </Modal>
  )
}


export { TableEditorModal }
