import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import StatusPill from '../components/StatusPill'
import { Field, Modal, btnGhost, btnPrimary, inputCls } from '../components/ui'
import { useConfirm } from '../components/ui/confirm-context'
import { useI18n } from '../lib/i18n'
import { uid } from '../lib/models'
import { useRestora } from '../lib/store'

const ROLE_META = {
  server: { label: 'Server', tone: 'info', color: 'bg-blue-500/15 text-blue-300 border-blue-500/40' },
  kitchen: { label: 'Kitchen', tone: 'bad', color: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
  host: { label: 'Host', tone: 'ok', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  manager: { label: 'Manager', tone: 'warn', color: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getWeekMonday(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function formatDayHeader(date) {
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function calcHours(start, end) {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let diff = (eh * 60 + em) - (sh * 60 + sm)
  if (diff < 0) diff += 24 * 60
  return Math.round((diff / 60) * 10) / 10
}

function ShiftModal({ shift, defaultDate, onClose, onSave, onDelete, sc = {} }) {
  const [staffName, setStaffName] = useState(shift?.staffName || '')
  const [role, setRole] = useState(shift?.role || 'server')
  const [date, setDate] = useState(shift?.date || defaultDate || new Date().toISOString().slice(0, 10))
  const [startTime, setStartTime] = useState(shift?.startTime || '10:00')
  const [endTime, setEndTime] = useState(shift?.endTime || '17:00')
  const [note, setNote] = useState(shift?.note || '')
  // A shift doubles as the branch's cash session: while it is 'open' the
  // drawer is out and offline terminals are allowed to sell and take
  // cash. 'closed' is the default so a roster edit never opens a drawer
  // by accident.
  const [open, setOpen] = useState(shift?.status === 'open')
  const [error, setError] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (!staffName.trim()) {
      setError(sc.staffMemberName ? `${sc.staffMemberName} required.` : 'Staff member name is required.')
      return
    }
    onSave({
      id: shift?.id || uid('shf'),
      staffName: staffName.trim(),
      role,
      date,
      startTime,
      endTime,
      note: note.trim(),
      status: open ? 'open' : 'closed',
    })
  }

  return (
    <Modal
      title={shift ? (sc.editShift || 'Edit Shift') : (sc.newShift || 'New Shift')}
      subtitle={sc.subtitle || 'Schedule team shifts and manage operational floor and kitchen coverage.'}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-300 ring-1 ring-inset ring-rose-500/30">
            {error}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Staff member name">
            <input
              type="text"
              required
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              placeholder="e.g. Jordan Lee"
              className={inputCls}
            />
          </Field>
          <Field label="Role">
            <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
              {Object.entries(ROLE_META).map(([key, meta]) => (
                <option key={key} value={key}>{meta.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Date">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start time">
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="End time">
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>

        <div className="text-xs text-zinc-400">
          Duration: <strong className="text-zinc-200">{calcHours(startTime, endTime)} hours</strong>
        </div>

        <Field label="Shift note (optional)">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Lunch floor lead, Section 1"
            className={inputCls}
          />
        </Field>

        <label className="flex items-start gap-3 rounded-xl bg-emerald-500/10 p-3 ring-1 ring-inset ring-emerald-500/25">
          <input
            type="checkbox"
            checked={open}
            onChange={(e) => setOpen(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-emerald-500"
          />
          <span className="text-xs leading-tight text-emerald-200">
            <strong className="text-emerald-300">Cash session open</strong>
            <br />
            While this shift is open the drawer counts as live and offline
            terminals may keep selling and taking cash. Close it at handover.
          </span>
        </label>

        <div className="flex items-center justify-between pt-3 border-t border-white/10">
          {shift && onDelete ? (
            <button
              type="button"
              onClick={() => onDelete(shift.id)}
              className="rounded-xl border border-red-500/40 px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-500/10"
            >
              Delete shift
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
            <button type="submit" className={btnPrimary}>Save shift</button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

export default function ScheduleScreen() {
  const confirm = useConfirm()
  const { lang, dict } = useI18n()
  const sc = dict.scheduleScreen || {}
  const { state, dispatch } = useRestora()
  const [currentWeekMonday, setCurrentWeekMonday] = useState(() => getWeekMonday(new Date()))
  const [modalCtx, setModalCtx] = useState(null) // { shift?, defaultDate? }
  const [roleFilter, setRoleFilter] = useState('all')

  const shifts = state.shifts || []

  // Build the 7 days of this week
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(currentWeekMonday)
      d.setDate(d.getDate() + i)
      const dateStr = d.toISOString().slice(0, 10)
      return {
        name: DAYS[i],
        date: d,
        dateStr,
        label: formatDayHeader(d),
        isToday: dateStr === new Date().toISOString().slice(0, 10),
      }
    })
  }, [currentWeekMonday])

  const weekStartStr = weekDays[0].dateStr
  const weekEndStr = weekDays[6].dateStr

  // Shifts in this week
  const weekShifts = useMemo(() => {
    return shifts.filter((s) => s.date >= weekStartStr && s.date <= weekEndStr)
  }, [shifts, weekStartStr, weekEndStr])

  // Coverage check per day
  const dailyCoverage = useMemo(() => {
    return weekDays.map((day) => {
      const dayShifts = weekShifts.filter((s) => s.date === day.dateStr)
      const servers = dayShifts.filter((s) => s.role === 'server').length
      const kitchen = dayShifts.filter((s) => s.role === 'kitchen').length
      const host = dayShifts.filter((s) => s.role === 'host').length
      const warnings = []
      if (servers === 0) warnings.push('0 servers')
      if (kitchen === 0) warnings.push('0 kitchen')
      return {
        ...day,
        dayShifts,
        servers,
        kitchen,
        host,
        warnings,
      }
    })
  }, [weekDays, weekShifts])

  const totalWeekHours = useMemo(() => {
    return weekShifts.reduce((sum, s) => sum + calcHours(s.startTime, s.endTime), 0)
  }, [weekShifts])

  function prevWeek() {
    setCurrentWeekMonday((prev) => {
      const d = new Date(prev)
      d.setDate(d.getDate() - 7)
      return d
    })
  }

  function nextWeek() {
    setCurrentWeekMonday((prev) => {
      const d = new Date(prev)
      d.setDate(d.getDate() + 7)
      return d
    })
  }

  function goToday() {
    setCurrentWeekMonday(getWeekMonday(new Date()))
  }

  function handleSaveShift(shift) {
    if (shifts.some((s) => s.id === shift.id)) {
      dispatch({ type: 'UPDATE_SHIFT', shiftId: shift.id, patch: shift })
    } else {
      dispatch({ type: 'ADD_SHIFT', shift })
    }
    setModalCtx(null)
  }

  async function handleDeleteShift(shiftId) {
    const ok = await confirm({
      title: sc.deleteConfirmTitle || 'Delete this shift?',
      body: sc.deleteConfirmBody || 'This shift will be permanently removed from the schedule.',
      confirmLabel: sc.deleteShift || 'Delete shift',
      tone: 'danger',
    })
    if (!ok) return
    dispatch({ type: 'DELETE_SHIFT', shiftId })
    setModalCtx(null)
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold text-orange-600">
            {sc.kicker || 'Control · Staff operations'}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {sc.title || 'Weekly shift schedule'}
            {lang !== 'en' && <span className="sr-only"> Weekly shift schedule</span>}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {sc.subtitle || 'Plan staff rosters, ensure kitchen and floor coverage, and balance weekly hours.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={goToday}
            className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-xs font-bold hover:bg-zinc-50 dark:hover:bg-zinc-700"
          >
            {sc.today || 'Today'}
          </button>
          <div className="flex rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-0.5">
            <button
              type="button"
              onClick={prevWeek}
              className="p-1.5 text-zinc-600 dark:text-zinc-300 hover:text-black dark:hover:text-white"
              title={sc.prevWeek || 'Previous week'}
            >
              ←
            </button>
            <span className="px-3 py-1 text-xs font-bold text-zinc-700 dark:text-zinc-200">
              {formatDayHeader(weekDays[0].date)} – {formatDayHeader(weekDays[6].date)}
            </span>
            <button
              type="button"
              onClick={nextWeek}
              className="p-1.5 text-zinc-600 dark:text-zinc-300 hover:text-black dark:hover:text-white"
              title={sc.nextWeek || 'Next week'}
            >
              →
            </button>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className={btnGhost}
            title={sc.printSchedule || 'Print weekly schedule'}
          >
            <Icon name="printer" className="mr-1 h-3.5 w-3.5" />
            {sc.print || 'Print'}
          </button>
          <button
            type="button"
            onClick={() => setModalCtx({ defaultDate: new Date().toISOString().slice(0, 10) })}
            className={btnPrimary}
          >
            {sc.addShift || '+ Add shift'}
          </button>
        </div>
      </header>

      {/* KPI & Summary Strip */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-[var(--color-ink-900)] p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            {sc.totalShifts || 'Total shifts'}
          </div>
          <div className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-100">{weekShifts.length}</div>
          <div className="text-xs text-zinc-500">{sc.acrossDays || 'across 7 days'}</div>
        </div>
        <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-[var(--color-ink-900)] p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            {sc.scheduledHours || 'Scheduled hours'}
          </div>
          <div className="mt-1 text-2xl font-bold text-orange-600 dark:text-orange-400">{totalWeekHours}h</div>
          <div className="text-xs text-zinc-500">{sc.rosteredDuration || 'rostered duration'}</div>
        </div>
        <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-[var(--color-ink-900)] p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            {sc.staffActive || 'Staff active'}
          </div>
          <div className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {new Set(weekShifts.map((s) => s.staffName)).size}
          </div>
          <div className="text-xs text-zinc-500">{sc.teamMembers || 'team members'}</div>
        </div>
        <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-[var(--color-ink-900)] p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            {sc.coverageAlerts || 'Coverage alerts'}
          </div>
          <div className="mt-1 text-2xl font-bold text-amber-500">
            {dailyCoverage.filter((d) => d.warnings.length > 0).length}
          </div>
          <div className="text-xs text-zinc-500">{sc.daysMissingRoles || 'days missing core roles'}</div>
        </div>
      </div>

      {/* Filter and Role legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-zinc-100 dark:bg-[var(--color-ink-850)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-zinc-500">Filter role:</span>
          <button
            type="button"
            onClick={() => setRoleFilter('all')}
            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${roleFilter === 'all' ? 'bg-zinc-900 text-white dark:bg-white dark:text-black' : 'text-zinc-600 dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-white/5'}`}
          >
            All roles ({weekShifts.length})
          </button>
          {Object.entries(ROLE_META).map(([key, meta]) => (
            <button
              key={key}
              type="button"
              onClick={() => setRoleFilter(key)}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${roleFilter === key ? 'bg-orange-500 text-white' : 'text-zinc-600 dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-white/5'}`}
            >
              {meta.label} ({weekShifts.filter((s) => s.role === key).length})
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400" /> Server</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-400" /> Kitchen</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Host</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> Manager</span>
        </div>
      </div>

      {/* 7-Day Week Grid */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
        {dailyCoverage.map((day) => {
          const visibleShifts = day.dayShifts.filter((s) => roleFilter === 'all' || s.role === roleFilter)
          return (
            <div
              key={day.dateStr}
              className={`flex flex-col rounded-2xl border p-3 transition-colors ${
                day.isToday
                  ? 'border-orange-500/60 bg-orange-500/5 dark:bg-orange-500/10 ring-1 ring-orange-500/30'
                  : 'border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-[var(--color-ink-900)]'
              }`}
            >
              <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-white/5">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">{day.name}</div>
                  <div className={`text-base font-bold ${day.isToday ? 'text-orange-600 dark:text-orange-400' : 'text-zinc-800 dark:text-zinc-100'}`}>
                    {day.label}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setModalCtx({ defaultDate: day.dateStr })}
                  className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/10 hover:text-zinc-700 dark:hover:text-zinc-200"
                  title={`Add shift on ${day.label}`}
                >
                  +
                </button>
              </div>

              {/* Coverage Warnings */}
              {day.warnings.length > 0 && (
                <div className="mt-2 rounded-lg bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-500 ring-1 ring-inset ring-amber-500/20">
                  ⚠️ Needs: {day.warnings.join(', ')}
                </div>
              )}

              {/* Shift list for the day */}
              <div className="mt-3 space-y-2 flex-1">
                {visibleShifts.length === 0 ? (
                  <div className="py-8 text-center text-xs text-zinc-400 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
                    No shifts
                  </div>
                ) : (
                  visibleShifts.map((shift) => {
                    const meta = ROLE_META[shift.role] || ROLE_META.server
                    const hrs = calcHours(shift.startTime, shift.endTime)
                    const sessionOpen = shift.status === 'open'
                    return (
                      <div
                        key={shift.id}
                        onClick={() => setModalCtx({ shift })}
                        className={`group cursor-pointer rounded-xl border p-2.5 transition hover:scale-[1.02] shadow-2xs ${meta.color}`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span className="font-bold text-xs truncate leading-snug">{shift.staffName}</span>
                          <StatusPill tone={meta.tone} size="sm">{meta.label}</StatusPill>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[11px] opacity-80">
                          <span>{shift.startTime} – {shift.endTime}</span>
                          <span className="font-semibold">{hrs}h</span>
                        </div>
                        {sessionOpen && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              dispatch({ type: 'UPDATE_SHIFT', shiftId: shift.id, patch: { status: 'closed' } })
                            }}
                            className="mt-1.5 w-full rounded-md bg-emerald-500/20 px-1.5 py-1 text-[10px] font-bold text-emerald-300 ring-1 ring-inset ring-emerald-500/40 hover:bg-emerald-500/30"
                            title="Close this cash session — offline selling on this branch locks until another shift opens"
                          >
                            💵 Cash session open — click to close
                          </button>
                        )}
                        {shift.note && (
                          <div className="mt-1 text-[10px] italic opacity-75 truncate">
                            “{shift.note}”
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>

      {modalCtx && (
        <ShiftModal
          shift={modalCtx.shift}
          defaultDate={modalCtx.defaultDate}
          onClose={() => setModalCtx(null)}
          onSave={handleSaveShift}
          onDelete={handleDeleteShift}
          sc={sc}
        />
      )}
    </div>
  )
}
