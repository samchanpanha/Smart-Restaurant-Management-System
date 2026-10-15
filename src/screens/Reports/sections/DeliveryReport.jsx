import { useMemo } from 'react'
import { useRestora } from '../../../lib/store'
import { buildReports } from '../../../lib/reports'
import { Card, NextAction, ReportShell } from './Common.jsx'

const minutesLabel = (value) => value == null ? '—' : `${Math.round(value)} min`
const rateLabel = (value) => value == null ? '—' : `${(value * 100).toFixed(0)}%`

function DeliveryReport({ range }) {
  const { state, setScreen } = useRestora()
  const reports = useMemo(() => buildReports(state, range), [state, range])
  const delivery = reports.delivery
  const metTarget = delivery.onTimeRate != null && delivery.onTimeRate >= 0.9

  return (
    <ReportShell
      title="Delivery performance"
      source={`Completed and cancelled delivery orders · ${reports.bounds.label}. On-time rate includes completed orders with an ETA.`}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: 'Completed', value: delivery.completed },
          { label: 'On time', value: rateLabel(delivery.onTimeRate), detail: `${delivery.onTime} of ${delivery.withEta} with ETA` },
          { label: 'Ready to driver', value: minutesLabel(delivery.avgReadyToHandoffMinutes) },
          { label: 'With driver', value: minutesLabel(delivery.avgDeliveryMinutes) },
          { label: 'Cancelled', value: delivery.cancelled },
        ].map((metric) => (
          <Card key={metric.label} title={metric.label}>
            <div className="tnum text-2xl font-bold text-zinc-100">{metric.value}</div>
            {metric.detail && <div className="mt-1 text-2xs text-zinc-500">{metric.detail}</div>}
          </Card>
        ))}
      </div>

      <Card title="On-time delivery">
        {delivery.onTimeRate == null ? (
          <p className="text-sm text-zinc-400">No completed deliveries with an ETA in this range.</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-zinc-300">Delivered by the promised time</span>
              <strong className="tnum text-zinc-100">{rateLabel(delivery.onTimeRate)}</strong>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/50" role="progressbar" aria-label="On-time delivery rate" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(delivery.onTimeRate * 100)}>
              <div className={`h-full ${metTarget ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, delivery.onTimeRate * 100)}%` }} />
            </div>
          </>
        )}
      </Card>

      <NextAction onGo={() => setScreen('tickets')} goLabel="Open tickets →">
        {delivery.onTimeRate == null
          ? 'Delivery timing will appear after orders have ETA and handoff timestamps.'
          : metTarget
            ? 'Delivery timing is meeting the 90% on-time target.'
            : 'Review handoff and driver times to find where deliveries are falling behind.'}
      </NextAction>
    </ReportShell>
  )
}

export { DeliveryReport }