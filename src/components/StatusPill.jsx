// Status is color + word, never color alone (spec §5).
import { TONE_CLASSES } from '../lib/constants'

export default function StatusPill({ tone = 'muted', children, size = 'md' }) {
  const cls = TONE_CLASSES[tone] || TONE_CLASSES.muted
  const pad = size === 'sm' ? 'px-2 py-0.5 text-2xs' : 'px-2.5 py-1 text-xs'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ring-inset ${pad} ${cls}`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  )
}
