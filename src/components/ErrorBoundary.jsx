// ─── Error boundary ──────────────────────────────────────────────────
// A screen that throws should cost one panel, not the whole terminal.
// The boundary catches, logs and shows a recoverable card; switching tabs
// (ScreenBoundary keys on the active tab) or pressing "Try again" clears it.

import { Component } from 'react'
import { Icon } from './Icon'
import { useRestora } from '../lib/store'

// A screen chunk that fails to load is almost always a *stale bundle*: the tab
// is holding an index.html from before the last build, so the hashed file it
// asks for is gone. Saying "something went wrong" there sends people looking
// for a server problem; name the real fix — reload and get the new build.
const STALE_CHUNK = /dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically/i

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
    this.reset = this.reset.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Kept as a console trail so a real crash is diagnosable without a bundler.
    console.error('Screen crashed:', error, info?.componentStack)
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.reset()
    }
  }

  reset() {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const stale = STALE_CHUNK.test(String(error?.message || error))
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl border border-red-200 bg-red-50/70 p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-red-600">
          <Icon name="warning" size={22} />
        </span>
        <h2 className="mt-4 text-lg font-bold tracking-tight text-zinc-900">
          {stale ? 'This screen needs the newer app' : 'Something went wrong'}
        </h2>
        <p className="mt-2 text-sm text-zinc-600">
          {stale
            ? 'Your tab is running an older copy of the workspace than the server. Reload to pick up the new one — nothing was lost.'
            : 'This screen stopped unexpectedly. The rest of your workspace is still live.'}
        </p>
        <p className="mt-3 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-zinc-400" title={String(error?.message || error)}>
          {String(error?.message || error)}
        </p>
        <button
          type="button"
          onClick={() => { if (stale && typeof window !== 'undefined') window.location.reload(); else this.reset() }}
          className="mt-5 min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-white hover:bg-orange-600"
        >
          {stale ? 'Reload the app' : 'Try again'}
        </button>
      </div>
    )
  }
}

/** Wraps the router panel and auto-resets the boundary when the tab changes. */
export function ScreenBoundary({ children }) {
  const { activeTabId } = useRestora()
  return <ErrorBoundary resetKey={activeTabId || 'none'}>{children}</ErrorBoundary>
}
