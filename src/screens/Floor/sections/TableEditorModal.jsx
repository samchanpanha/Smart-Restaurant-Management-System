import { useState } from 'react'
import { Field, Modal, Stepper, inputCls } from '../../../components/ui'
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
  const [error, setError] = useState('')
  const [showQr, setShowQr] = useState(false)

  function save() {
    if (!name.trim()) {
      setError(lang === 'km' ? 'សូមដាក់ឈ្មោះតុ។' : lang === 'zh' ? '请为餐桌命名。' : 'Give the table a name.')
      return
    }
    if (editing) dispatch({ type: 'UPDATE_TABLE', tableId: table.id, patch: { name, seats, zone } })
    else dispatch({ type: 'ADD_TABLE', table: { name, seats, zone } })
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
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setError('') }}
            placeholder="Table 17"
            className={inputCls}
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
            <input
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              placeholder="Main"
              className={inputCls}
              maxLength={32}
            />
          </Field>
        </div>
        {error && (
          <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-inset ring-red-500/30" role="alert">
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={save}
          aria-label="Save table"
          className="min-h-[44px] w-full rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-black hover:bg-amber-400"
        >
          {editing ? (lang === 'km' ? 'រក្សាទុកតុ' : lang === 'zh' ? '保存餐桌' : 'Save table') : (lang === 'km' ? 'បន្ថែមតុ' : lang === 'zh' ? '添加餐桌' : 'Add table')}
          {lang !== 'en' && <span className="sr-only"> {editing ? 'Save table' : 'Add table'}</span>}
        </button>

        {editing && (
          <button
            type="button"
            onClick={() => setShowQr(true)}
            className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--color-ink-600)] bg-[var(--color-ink-800)] py-2 text-xs font-bold text-zinc-200 hover:bg-white/5"
          >
            <span>📱 Print Table QR Tent (Self-order)</span>
          </button>
        )}
      </div>

      {showQr && (
        <QrPrintModal table={table} onClose={() => setShowQr(false)} />
      )}
    </Modal>
  )
}


export { TableEditorModal }
