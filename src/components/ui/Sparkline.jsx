import { useId } from 'react'
import { cn } from '../../lib/cn'

// A dependency-free inline SVG sparkline. Draws the series as a normalized
// polyline plus a soft gradient fill, using semantic accent tokens so it never
// hardcodes a dark palette. Works in jsdom (no canvas, no recharts).
const toneStroke = {
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  muted: 'var(--text-subtle)',
}

export function Sparkline({
  values = [],
  width = 120,
  height = 36,
  strokeWidth = 2,
  tone = 'accent',
  fill = true,
  className,
  ...props
}) {
  const gradId = useId().replace(/:/g, '')
  const series = values.filter((value) => Number.isFinite(value))
  const color = toneStroke[tone] || toneStroke.accent

  if (series.length < 2) {
    return <div className={cn('h-[36px] w-full', className)} aria-hidden="true" {...props} />
  }

  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1
  const pad = strokeWidth
  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const points = series.map((value, index) => {
    const x = pad + (index / (series.length - 1)) * innerW
    const y = pad + (1 - (value - min) / span) * innerH
    return [x, y]
  })
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${points[0][0].toFixed(1)},${(height - pad).toFixed(1)} ${line} ${points.at(-1)[0].toFixed(1)},${(height - pad).toFixed(1)}`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-hidden="true"
      className={cn('block', className)}
      {...props}
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={`spark-${gradId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={area} fill={`url(#spark-${gradId})`} />
        </>
      )}
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
