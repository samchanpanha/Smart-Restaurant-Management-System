import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money } from '../../../lib/models'

// Recharts colours are NOT set here: grid, axes, ticks, and the tooltip are
// styled by `.recharts-*` rules in src/styles/responsive.css so they follow the
// surface scope (the light reports page used to render a #3f3f46 grid and a
// #18181b tooltip — invisible-to-muddy on white). The series colour stays a
// prop, because a report can print two series in different tones.
function RevenueChartImpl({ rows, color = '#f59e0b' }) {
  return (
    <div className="h-56 w-full sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="restoraRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.45} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          {/* A narrower axis leaves more plot area on a phone; ticks thin out
              automatically (minTickGap) instead of overlapping. */}
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={14} />
          <YAxis tickLine={false} axisLine={false} width={46} tickFormatter={(value) => money(value)} />
          <Tooltip formatter={(value) => [money(value), 'Sales']} />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#restoraRevenue)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export default RevenueChartImpl
