// ─── Guest table booking ───────────────────────────────────────────
// A guest books against live floor availability: date strip → party →
// 30-minute slots (computed from the enabled service windows) → contact
// details. The booking id and guest token are kept locally so the same
// browser can manage it later; seeded/phone bookings are never offered.

import { useMemo, useState } from 'react'
import { Icon } from '../../../components/Icon'
import { findAvailableTablesForSlot, uid } from '../../../lib/models'
import { guestSessionToken, loadGuestBooking, saveGuestBooking } from '../../../lib/guest-session'
import { useRestora } from '../../../lib/store'
import { translateTableName, useI18n } from '../../../lib/i18n'

const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 8, 10]
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2'

function toLocalIsoDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function toMinutes(value) {
  const [hours, minutes] = String(value || '00:00').split(':').map(Number)
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0)
}

function timeLabel(value, locale) {
  const [hours, minutes] = String(value).split(':').map(Number)
  const date = new Date()
  date.setHours(hours || 0, minutes || 0, 0, 0)
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
}

function buildSlots(menuWindows) {
  const windows = (menuWindows || []).filter((window) => window?.enabled)
  const ranges = windows.length
    ? windows.map((window) => [toMinutes(window.from), toMinutes(window.to)])
    : [[11 * 60, 22 * 60]]
  const slots = []
  for (const [from, to] of ranges) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue
    for (let minute = from; minute < to; minute += 30) {
      const value = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
      if (!slots.includes(value)) slots.push(value)
    }
  }
  return slots.sort()
}

export function BookingPanel({ defaultName = '' }) {
  const { state, dispatch } = useRestora()
  const { lang } = useI18n()
  const locale = lang === 'km' ? 'km-KH' : lang === 'zh' ? 'zh-CN' : 'en-US'
  const bookingPolicy = state.settings?.booking || {}
  const durationMinutes = Number(bookingPolicy.defaultBookingDurationMinutes) || 90

  const days = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today)
      date.setDate(today.getDate() + index)
      return date
    })
  }, [])

  const [date, setDate] = useState(() => toLocalIsoDate(days[0]))
  const [partySize, setPartySize] = useState(2)
  const [selectedTime, setSelectedTime] = useState('')
  const [name, setName] = useState(defaultName)
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [confirmedId, setConfirmedId] = useState('')
  const [saved] = useState(loadGuestBooking)

  const slots = useMemo(
    () => buildSlots(state.settings?.food?.menuWindows),
    [state.settings?.food?.menuWindows],
  )

  const slotOptions = useMemo(() => {
    if (!date) return []
    return slots.map((time) => {
      const at = new Date(`${date}T${time}:00`)
      const past = at.getTime() < Date.now() + 15 * 60 * 1000
      const tables = past
        ? []
        : findAvailableTablesForSlot(state, {
          time: at.toISOString(),
          partySize,
          durationMinutes,
        })
      return { time, at, past, tables }
    })
  }, [date, slots, partySize, durationMinutes, state])

  const savedBooking = saved
    ? (state.reservations || []).find((reservation) => (
      reservation.id === saved.id &&
      (!reservation.guestToken || reservation.guestToken === saved.token)
    ))
    : null
  const confirmed = confirmedId
    ? (state.reservations || []).find((reservation) => reservation.id === confirmedId)
    : null
  const booking = confirmed || savedBooking

  function reset() {
    setConfirmedId('')
    saveGuestBooking(null)
    setSelectedTime('')
    setNotes('')
    setError('')
  }

  function submit(event) {
    event.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Add the name your table is under.')
      return
    }
    if (!phone.trim()) {
      setError('Add a phone number so we can reach you.')
      return
    }
    const slot = slotOptions.find((option) => option.time === selectedTime)
    if (!slot || slot.past || slot.tables.length === 0) {
      setError('That time just filled up. Pick another slot.')
      return
    }
    const id = uid('res')
    dispatch({
      type: 'ADD_RESERVATION',
      reservation: {
        id,
        name: name.trim().slice(0, 60),
        phone: phone.trim().slice(0, 30),
        partySize,
        time: slot.at.toISOString(),
        tableId: slot.tables[0]?.id || null,
        status: 'booked',
        source: 'online',
        notes: notes.trim().slice(0, 200),
        guestToken: guestSessionToken(),
        modificationCount: 0,
        createdAt: new Date().toISOString(),
      },
    })
    saveGuestBooking({ id, token: guestSessionToken() })
    setConfirmedId(id)
  }

  if (booking) {
    const when = new Date(booking.time)
    const dayLabel = when.toLocaleDateString(locale, { weekday: 'long', month: 'short', day: 'numeric' })
    const bookingTime = when.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
    const bookedTable = (state.tables || []).find((table) => table.id === booking.tableId)
    return (
      <section className="mt-4 space-y-3" aria-labelledby="guest-booking-title" data-testid="guest-booking-confirmed">
        <div className="rounded-3xl bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-2xl text-emerald-600">
            <Icon name="check" size={26} />
          </div>
          <h2 id="guest-booking-title" className="mt-3 text-xl font-extrabold text-stone-900">
            {booking.status === 'cancelled' ? 'Booking cancelled' : 'Your table is booked'}
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            {booking.status === 'cancelled'
              ? 'This reservation is no longer active.'
              : 'We look forward to hosting you.'}
          </p>
          <div className="mt-4 rounded-2xl bg-stone-50 p-4 text-left text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-stone-500">When</span>
              <strong className="text-right text-stone-900">{dayLabel} · {bookingTime}</strong>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-stone-500">Party</span>
              <strong className="text-stone-900">{booking.partySize} {booking.partySize === 1 ? 'guest' : 'guests'}</strong>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-stone-500">Table</span>
              <strong className="text-stone-900">{bookedTable ? translateTableName(bookedTable.name, lang) : 'Assigned on arrival'}</strong>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-stone-500">Reference</span>
              <strong className="font-mono text-stone-900">{booking.id.slice(-6).toUpperCase()}</strong>
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-stone-400">
            Please arrive within 15 minutes of your booking. Call the restaurant if you are running late.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className={`min-h-[48px] w-full rounded-2xl border border-stone-200 bg-white text-sm font-bold text-stone-700 ${FOCUS}`}
        >
          Book another table
        </button>
      </section>
    )
  }

  return (
    <section className="mt-4 space-y-4" aria-labelledby="guest-booking-title" data-testid="guest-booking">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">Reserve ahead</p>
        <h2 id="guest-booking-title" className="mt-0.5 text-xl font-extrabold tracking-tight text-stone-900">
          Book a table
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-stone-500">
          Pick a time and we will hold your table. Availability is live.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400">Date</h3>
          <span className="text-[11px] font-semibold text-stone-400">Next 7 days</span>
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {days.map((day) => {
            const value = toLocalIsoDate(day)
            const active = value === date
            return (
              <button
                key={value}
                type="button"
                onClick={() => { setDate(value); setSelectedTime(''); setError('') }}
                aria-pressed={active}
                className={`flex min-h-[62px] min-w-[58px] shrink-0 flex-col items-center justify-center rounded-2xl border text-xs font-bold transition-colors ${FOCUS} ${
                  active
                    ? 'border-[var(--guest-accent)] bg-[var(--guest-accent)] text-[var(--guest-ink)] shadow-sm'
                    : 'border-stone-200 bg-white text-stone-600'
                }`}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                  {day.toLocaleDateString(locale, { weekday: 'short' })}
                </span>
                <span className="mt-0.5 text-lg font-extrabold">{day.getDate()}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400">Party size</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {PARTY_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => { setPartySize(size); setSelectedTime(''); setError('') }}
              aria-pressed={partySize === size}
              className={`min-h-[44px] min-w-[44px] rounded-full border px-3 text-sm font-bold transition-colors ${FOCUS} ${
                partySize === size
                  ? 'border-stone-900 bg-stone-900 text-white'
                  : 'border-stone-200 bg-white text-stone-600'
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-widest text-stone-400">Time</h3>
          <span className="text-[11px] font-semibold text-stone-400">
            {selectedTime ? timeLabel(selectedTime, locale) : 'Choose a slot'}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {slotOptions.map((option) => {
            const full = option.past || option.tables.length === 0
            const active = selectedTime === option.time
            return (
              <button
                key={option.time}
                type="button"
                disabled={full}
                onClick={() => { setSelectedTime(option.time); setError('') }}
                aria-pressed={active}
                title={option.tables.length ? `${option.tables.length} tables available` : 'Fully booked'}
                className={`flex min-h-[52px] flex-col items-center justify-center rounded-2xl border text-xs font-bold transition-colors ${FOCUS} disabled:cursor-not-allowed disabled:opacity-45 ${
                  active
                    ? 'border-stone-900 bg-stone-900 text-white'
                    : 'border-stone-200 bg-white text-stone-700'
                }`}
              >
                <span>{timeLabel(option.time, locale)}</span>
                <span className={`mt-0.5 text-[9px] font-semibold ${active ? 'text-white/70' : full ? 'text-stone-400' : 'text-emerald-700'}`}>
                  {option.past ? 'Passed' : option.tables.length ? 'Available' : 'Full'}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-widest text-stone-400">Name</span>
          <input
            value={name}
            onChange={(event) => { setName(event.target.value); setError('') }}
            maxLength={60}
            autoComplete="name"
            placeholder="Name on the booking"
            className="min-h-[48px] w-full rounded-2xl border border-stone-200 bg-white px-4 text-sm shadow-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-widest text-stone-400">Phone</span>
          <input
            value={phone}
            onChange={(event) => { setPhone(event.target.value); setError('') }}
            maxLength={30}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="So we can reach you"
            className="min-h-[48px] w-full rounded-2xl border border-stone-200 bg-white px-4 text-sm shadow-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-widest text-stone-400">Notes (optional)</span>
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={200}
            placeholder="Window seat, birthday, allergies…"
            className="min-h-[44px] w-full rounded-2xl border border-stone-200 bg-white px-4 text-sm"
          />
        </label>

        {error && (
          <p className="rounded-2xl bg-red-50 px-4 py-3 text-xs font-semibold text-red-700" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!selectedTime}
          className={`min-h-[52px] w-full rounded-2xl bg-[var(--guest-accent)] text-base font-extrabold text-[var(--guest-ink)] shadow-sm disabled:opacity-40 ${FOCUS}`}
        >
          {selectedTime
            ? `Book for ${timeLabel(selectedTime, locale)} · ${partySize} ${partySize === 1 ? 'guest' : 'guests'}`
            : 'Pick a time to continue'}
        </button>
      </form>
    </section>
  )
}
