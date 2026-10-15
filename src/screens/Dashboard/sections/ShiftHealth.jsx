import { Badge, Card, Progress } from '../../../components/ui'
import { TARGETS } from '../../../lib/constants'

// Food cost against the cap + the average-check band. Colors are semantic; the
// status reads as color + word via the Badge.
export default function ShiftHealth({ copy, foodCost7d, foodCostCap }) {
  const onTarget = foodCost7d <= foodCostCap
  const ratio = Math.min(100, (foodCost7d / Math.max(foodCostCap, 0.01)) * 100)
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[var(--fs-body)] font-bold text-[var(--text-strong)]">{copy.shiftHealth}</h2>
        <Badge tone={onTarget ? 'success' : 'warning'} dot>{onTarget ? copy.onTarget : copy.review}</Badge>
      </div>

      <div className="mt-3 flex items-center justify-between text-[var(--fs-label)] text-[var(--text-muted)]">
        <span>{copy.foodCost7d}</span>
        <strong className="tnum text-[var(--text)]">{(foodCost7d * 100).toFixed(1)}% / {(foodCostCap * 100).toFixed(0)}%</strong>
      </div>
      <Progress value={ratio} tone={onTarget ? 'success' : 'warning'} className="mt-2" />

      <div className="mt-3 flex items-center justify-between text-[var(--fs-label)] text-[var(--text-muted)]">
        <span>{copy.avgCheckBand}</span>
        <strong className="text-[var(--text)]">${TARGETS.avgCheckLow}–${TARGETS.avgCheckHigh}</strong>
      </div>
    </Card>
  )
}
