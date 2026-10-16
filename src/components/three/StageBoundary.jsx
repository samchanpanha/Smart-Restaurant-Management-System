// ─── 3D stage boundary ───────────────────────────────────────────────
// If the 3D chunk fails to download, or the scene throws, the guest still
// gets their dish — this boundary swaps the stage for the ordinary photo
// rather than letting the whole menu break.

import { Component } from 'react'

export class StageBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    console.warn('3D stage failed, using the photo instead:', error, info?.componentStack)
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null
    return this.props.children
  }
}
