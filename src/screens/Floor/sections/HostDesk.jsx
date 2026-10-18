import { useState } from 'react'
import { Card, Tabs } from '../../../components/ui'
import { useI18n } from '../../../lib/i18n'
import { useRestora } from '../../../lib/store'
import { ReservationsPanel } from './ReservationsPanel.jsx'
import { WaitlistPanel } from './WaitlistPanel.jsx'

// The host desk: one card, two tools. Reservations and the waitlist were two
// stacked cards that both grew a long list — the host had to scroll past one to
// reach the other, and the sidebar ran off the screen. They are tabs now, with
// the live count on each label so a glance says where the pressure is.
function HostDesk({ onSeatRes, onSeatWl, onError }) {
  const { state } = useRestora()
  const { dict } = useI18n()
  const f = dict.floor || {}
  const [tab, setTab] = useState('reservations')
  const booked = state.reservations.filter((reservation) => reservation.status === 'booked').length

  return (
    <Card inset>
      <div className="mb-3 rounded-[var(--radius-lg)] bg-[var(--surface-sunken)] p-1">
        <Tabs
          ariaLabel="Host desk"
          size="sm"
          value={tab}
          onChange={setTab}
          items={[
            {
              id: 'reservations',
              label: f.reservations || 'Reservations',
              count: booked,
              icon: <span className="text-[var(--fs-caption)]">◷</span>,
            },
            {
              id: 'waitlist',
              label: f.waitlist || 'Waitlist',
              count: state.waitlist.length,
              icon: <span className="text-[var(--fs-caption)]">⧗</span>,
            },
          ]}
        />
      </div>

      <div role="tabpanel" aria-label={tab === 'reservations' ? 'Reservations' : 'Waitlist'}>
        {tab === 'reservations' ? (
          <ReservationsPanel onSeatRes={onSeatRes} onError={onError} />
        ) : (
          <WaitlistPanel onSeatWl={onSeatWl} onError={onError} />
        )}
      </div>
    </Card>
  )
}

export { HostDesk }
