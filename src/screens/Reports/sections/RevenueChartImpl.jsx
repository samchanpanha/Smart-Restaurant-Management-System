import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money } from '../../../lib/models'

function RevenueChartImpl({ rows, color = '#f59e0b' }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="restoraRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.45} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#3f3f46" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: '#a1a1aa', fontSize: 11 }} stroke="#52525b" tickLine={false} />
          <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} stroke="#52525b" tickLine={false} width={54} tickFormatter={(value) => money(value)} />
          <Tooltip
            formatter={(value) => [money(value), 'Sales']}
            contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 12, fontSize: 12 }}
            labelStyle={{ color: '#e4e4e7' }}
            itemStyle={{ color: '#fcd34d' }}
          />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#restoraRevenue)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export default RevenueChartImpl
