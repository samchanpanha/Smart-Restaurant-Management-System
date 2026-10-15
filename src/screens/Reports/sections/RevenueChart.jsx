import { Component, Suspense, lazy, useState } from 'react'

// recharts is heavy (d3 under the hood). It is imported only in a real browser
// with a layout engine, and any failure falls back to the CSS Bars the section
// already ships. jsdom/test environments skip it entirely.
const LazyRevenueChart = lazy(() => import('./RevenueChartImpl.jsx'))

function chartsEnabled() {
  if (typeof window === 'undefined') return false
  if (typeof navigator === 'undefined') return false
  return !/jsdom/i.test(navigator.userAgent)
}

class ChartBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function RevenueChart({ rows, fallback }) {
  const [enabled] = useState(chartsEnabled)

  if (!enabled || !rows?.length) return fallback

  return (
    <ChartBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <LazyRevenueChart rows={rows} />
      </Suspense>
    </ChartBoundary>
  )
}

export { RevenueChart }
