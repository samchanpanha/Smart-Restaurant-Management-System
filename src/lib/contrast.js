// ─── Colour + contrast maths for the design-system audit ─────────────
// Pure helpers, no DOM and no file access: `scripts/contrast-audit.mjs` and
// `tests/contrast-tokens.test.js` both drive them, so the numbers in the
// written report and the numbers the test suite enforces cannot drift.
//
// WCAG 2.1 relative luminance + contrast ratio, plus alpha compositing,
// because half of this app's palette is `rgb(243 106 33 / 10%)` over a
// surface and a slash-opacity utility (`text-white/70`) is a composite too.

/** Parse #rgb, #rrggbb, #rrggbbaa, rgb(), rgba() and `rgb(R G B / A)` → {r,g,b,a}. */
export function parseColor(input) {
  if (!input) return null
  const value = String(input).trim()

  if (value.startsWith('#')) {
    let hex = value.slice(1)
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('')
    if (hex.length !== 6 && hex.length !== 8) return null
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
    if ([r, g, b].some(Number.isNaN)) return null
    return { r, g, b, a }
  }

  const match = /^rgba?\(([^)]+)\)$/i.exec(value)
  if (!match) return null
  const body = match[1].trim()
  // Both `255, 255, 255, 0.5` and `255 255 255 / 50%` are legal CSS.
  const [colorPart, alphaPart] = body.split('/')
  const parts = colorPart.trim().split(/[\s,]+/).filter(Boolean)
  if (parts.length < 3) return null
  const channel = (raw) => {
    const text = String(raw).trim()
    if (text.endsWith('%')) return Math.round((parseFloat(text) / 100) * 255)
    return Math.round(parseFloat(text))
  }
  const [r, g, b] = parts.map(channel)
  if ([r, g, b].some(Number.isNaN)) return null
  let a = 1
  if (alphaPart !== undefined) {
    const text = alphaPart.trim()
    a = text.endsWith('%') ? parseFloat(text) / 100 : parseFloat(text)
  } else if (parts.length === 4) {
    const text = String(parts[3]).trim()
    a = text.endsWith('%') ? parseFloat(text) / 100 : parseFloat(text)
  }
  return { r, g, b, a: Number.isNaN(a) ? 1 : Math.min(1, Math.max(0, a)) }
}

const toLinear = (channel) => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.1 relative luminance (0 = black, 1 = white). */
export function relativeLuminance(color) {
  const parsed = typeof color === 'string' ? parseColor(color) : color
  if (!parsed) return 0
  return 0.2126 * toLinear(parsed.r) + 0.7152 * toLinear(parsed.g) + 0.0722 * toLinear(parsed.b)
}

/** Paint `foreground` (possibly translucent) over an opaque `background`. */
export function composite(foreground, background) {
  const fg = typeof foreground === 'string' ? parseColor(foreground) : foreground
  const bg = typeof background === 'string' ? parseColor(background) : background
  if (!fg) return bg
  if (!bg) return fg
  const alpha = fg.a ?? 1
  if (alpha >= 1) return { r: fg.r, g: fg.g, b: fg.b, a: 1 }
  const channel = (f, b) => Math.round(f * alpha + b * (1 - alpha))
  return { r: channel(fg.r, bg.r), g: channel(fg.g, bg.g), b: channel(fg.b, bg.b), a: 1 }
}

/** WCAG contrast ratio, 1…21. */
export function contrastRatio(foreground, background, { over = null } = {}) {
  let fg = typeof foreground === 'string' ? parseColor(foreground) : foreground
  let bg = typeof background === 'string' ? parseColor(background) : background
  if (!fg || !bg) return 0
  // A translucent surface (a 10% accent wash) sits on something else first.
  if (over && bg.a < 1) bg = composite(bg, over)
  if (fg.a < 1) fg = composite(fg, bg)
  if (bg.a < 1) bg = composite(bg, over || { r: 255, g: 255, b: 255, a: 1 })
  const light = relativeLuminance(fg)
  const dark = relativeLuminance(bg)
  const [hi, lo] = light > dark ? [light, dark] : [dark, light]
  return (hi + 0.05) / (lo + 0.05)
}

export function toHex(color) {
  const parsed = typeof color === 'string' ? parseColor(color) : color
  if (!parsed) return ''
  const part = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  return `#${part(parsed.r)}${part(parsed.g)}${part(parsed.b)}`
}

/**
 * WCAG 2.1 verdict. `large` is 18.66px bold or 24px normal — the app's KPI
 * numerals and hero headings, which get the 3:1 allowance.
 */
export function wcagLevel(ratio, { large = false } = {}) {
  const bodyTarget = large ? 3 : 4.5
  const aaaTarget = large ? 4.5 : 7
  if (ratio >= aaaTarget) return 'AAA'
  if (ratio >= bodyTarget) return 'AA'
  return 'fail'
}

// ─── token extraction ─────────────────────────────────────────────────

/**
 * Pull `--name: value` custom properties out of each selector block in a CSS
 * file, so the audit reads the real palette instead of a copy of it.
 * Returns `{ scope: { '--text': '#30343a', … } }` keyed by the block's
 * selector list (`:root`, `.restora-theme`, `.surface-dark`, …).
 */
export function parseCssTokens(css) {
  const scopes = {}
  // Strip comments so a commented-out token cannot be audited as live.
  const source = String(css).replace(/\/\*[\s\S]*?\*\//g, '')
  const blockRe = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = blockRe.exec(source))) {
    const selector = match[1].trim().replace(/\s+/g, ' ')
    const body = match[2]
    if (!selector || !body.includes('--')) continue
    const tokens = {}
    const tokenRe = /(--[\w-]+)\s*:\s*([^;]+);/g
    let tokenMatch
    while ((tokenMatch = tokenRe.exec(body))) {
      tokens[tokenMatch[1]] = tokenMatch[2].trim()
    }
    if (!Object.keys(tokens).length) continue
    // Several blocks can share a selector list (media queries); merge.
    scopes[selector] = { ...(scopes[selector] || {}), ...tokens }
  }
  return scopes
}

/**
 * Resolve one token inside a scope chain: the deepest scope wins, `:root`
 * is the fallback. `--color-zinc-500` inside `.restora-theme .app-sidebar`
 * is the sidebar's value, not the workspace's.
 */
export function resolveToken(scopes, name, chain = []) {
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const scope = chain[index]
    for (const [selector, tokens] of Object.entries(scopes)) {
      if (selector.split(',').some((part) => part.trim() === scope || part.trim().endsWith(scope))) {
        if (tokens[name]) return tokens[name]
      }
    }
  }
  return scopes[':root']?.[name] || ''
}

// ─── the pairs this app actually paints ───────────────────────────────
//
// Each entry is one real combination on screen: a token (or literal colour,
// or a slash-opacity composite) against the surface it sits on. `size`
// decides the AA threshold — `large` for the KPI numerals and hero headings,
// `body` for everything a guest or a server reads at 11–14px.
//
// Scopes are the chain the token is resolved through, deepest last.
export const CONTRAST_PAIRS = [
  // Light staff workspace (the default surface of every ops screen).
  { id: 'workspace/body-on-surface', label: 'Body text on card', scope: ['.restora-theme'], fg: '--text', bg: '--surface', size: 'body' },
  { id: 'workspace/strong-on-surface', label: 'Heading text on card', scope: ['.restora-theme'], fg: '--text-strong', bg: '--surface', size: 'body' },
  { id: 'workspace/muted-on-surface', label: 'Muted text on card', scope: ['.restora-theme'], fg: '--text-muted', bg: '--surface', size: 'body' },
  { id: 'workspace/subtle-on-surface', label: 'Subtle text on card', scope: ['.restora-theme'], fg: '--text-subtle', bg: '--surface', size: 'body' },
  { id: 'workspace/subtle-on-sunken', label: 'Subtle text on sunken panel', scope: ['.restora-theme'], fg: '--text-subtle', bg: '--surface-sunken', size: 'body' },
  { id: 'workspace/muted-on-page', label: 'Muted text on page background', scope: ['.restora-theme'], fg: '--text-muted', bg: '--surface-page', size: 'body' },
  { id: 'workspace/border-on-surface', label: 'Card border (non-text)', scope: ['.restora-theme'], fg: '--border-strong', bg: '--surface', size: 'large' },

  // Primary action — the most-clicked pixels in the app.
  { id: 'accent/label-on-accent', label: 'Primary button label', scope: ['.restora-theme'], fg: '--text-on-accent', bg: '--accent', size: 'body' },
  { id: 'accent/label-on-accent-hover', label: 'Primary button label (hover)', scope: ['.restora-theme'], fg: '--text-on-accent', bg: '--accent-hover', size: 'body' },
  { id: 'accent/accent-on-soft', label: 'Subtle button / badge label', scope: ['.restora-theme'], fg: '--accent-text', bg: '--accent-soft', over: '--surface', size: 'body' },
  { id: 'accent/accent-as-icon', label: 'Accent icon on card (non-text)', scope: ['.restora-theme'], fg: '--accent', bg: '--surface', size: 'large' },

  // Status vocabulary — colour is never the only signal, but it must still read.
  { id: 'status/success-on-soft', label: 'Success pill text', scope: ['.restora-theme'], fg: '--success', bg: '--success-soft', over: '--surface', size: 'body' },
  { id: 'status/warning-on-soft', label: 'Warning pill text', scope: ['.restora-theme'], fg: '--warning', bg: '--warning-soft', over: '--surface', size: 'body' },
  { id: 'status/danger-on-soft', label: 'Danger pill text', scope: ['.restora-theme'], fg: '--danger', bg: '--danger-soft', over: '--surface', size: 'body' },
  { id: 'status/info-on-soft', label: 'Info pill text', scope: ['.restora-theme'], fg: '--info', bg: '--info-soft', over: '--surface', size: 'body' },

  // Dark sidebar (its own zinc ramp, its own surfaces).
  { id: 'sidebar/nav-on-sidebar', label: 'Sidebar nav label', scope: ['.restora-theme', '.app-sidebar'], fg: '--color-zinc-300', bg: '#17181a', size: 'body' },
  { id: 'sidebar/muted-on-sidebar', label: 'Sidebar section heading', scope: ['.restora-theme', '.app-sidebar'], fg: '#85898f', bg: '#17181a', size: 'body' },
  { id: 'sidebar/active-on-accent', label: 'Active nav item label', scope: ['.restora-theme', '.app-sidebar'], fg: '--text-on-accent', bg: '--color-amber-500', size: 'body' },

  // Dark surfaces elsewhere: toasts, the command palette, the shortcut sheet.
  { id: 'dark/body-on-ink', label: 'Toast / palette body text', scope: ['.surface-dark'], fg: '--color-zinc-100', bg: '--color-zinc-900', size: 'body' },
  { id: 'dark/muted-on-ink', label: 'Toast / palette secondary text', scope: ['.surface-dark'], fg: '--color-zinc-400', bg: '--color-zinc-900', size: 'body' },

  // Guest QR menu + Telegram mini app (the warm consumer palette).
  { id: 'guest/ink-on-bg', label: 'Guest body text', scope: [':root'], fg: '--guest-ink', bg: '--guest-bg', size: 'body' },
  { id: 'guest/ink-on-surface', label: 'Guest card text', scope: [':root'], fg: '--guest-ink', bg: '--guest-surface', size: 'body' },
  { id: 'guest/label-on-accent', label: 'Guest primary button label', scope: [':root'], fg: '--guest-ink', bg: '--guest-accent', size: 'body' },
  { id: 'guest/white-on-chrome', label: 'Mini-app header text', scope: [':root'], fg: 'rgb(255 255 255 / 90%)', bg: '--guest-chrome', size: 'body' },
  { id: 'guest/muted-white-on-chrome', label: 'Mini-app header sub-line', scope: [':root'], fg: 'rgb(255 255 255 / 70%)', bg: '--guest-chrome', size: 'body' },
]

/**
 * Audit every pair against a parsed token table.
 * Returns rows `{ id, label, ratio, level, fg, bg, size, ok }`, worst first.
 */
export function auditContrast(scopes, pairs = CONTRAST_PAIRS) {
  const rows = []
  for (const pair of pairs) {
    const chain = pair.scope || [':root']
    const resolve = (value) => {
      if (typeof value !== 'string') return value
      if (value.startsWith('--')) return resolveToken(scopes, value, chain)
      return value
    }
    const fgRaw = resolve(pair.fg)
    const bgRaw = resolve(pair.bg)
    const overRaw = pair.over ? resolve(pair.over) : null
    const fg = parseColor(fgRaw)
    const bg = parseColor(bgRaw)
    if (!fg || !bg) {
      rows.push({ ...pair, fg: fgRaw, bg: bgRaw, ratio: 0, level: 'unresolved', ok: false })
      continue
    }
    const ratio = contrastRatio(fg, bg, overRaw ? { over: parseColor(overRaw) } : {})
    const level = wcagLevel(ratio, { large: pair.size === 'large' })
    rows.push({
      ...pair,
      fg: toHex(fg),
      bg: toHex(composite(bg, overRaw ? parseColor(overRaw) : null)),
      ratio: Number(ratio.toFixed(2)),
      level,
      ok: level !== 'fail' && level !== 'unresolved',
    })
  }
  return rows.sort((a, b) => a.ratio - b.ratio)
}

// ─── Class-level utility overrides ────────────────────────────────────
// src/index.css does not only define tokens; it repaints whole utilities by
// class (`.restora-theme .text-zinc-400 { color: #565e68 }`, `.surface-dark
// .text-amber-300 { color: #ff9a62 }`). No token table can see those, so an
// audit that ignores them grades colours the browser never paints. These two
// helpers live here — not in scripts/ — so tests can pin the behaviour.

/** Split a selector list on commas that are not inside `:is(...)` groups. */
export function splitSelectorList(selectors) {
  const out = []
  let depth = 0
  let current = ''
  for (const char of selectors) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      out.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) out.push(current)
  return out
}

export function parseClassOverrides(source) {
  const cleaned = String(source).replace(/\/\*[\s\S]*?\*\//g, '')
  const byScope = {}
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g
  let rule
  while ((rule = ruleRe.exec(cleaned))) {
    const selectors = rule[1].trim()
    const body = rule[2]
    const decl = /(?:^|;)\s*(background-color|color|border-color)\s*:\s*([^;]+);/m.exec(body)
    if (!decl) continue
    // The scope is decided from the *whole* selector list: a list like
    // `.restora-theme :is(.app-topbar, .app-tabs, .app-workspace) .text-zinc-400`
    // splits on commas into fragments that no longer mention the theme.
    // A rule that names several dark islands applies to each of them, so it is
    // registered under every scope it mentions (`.restora-theme :is(.app-sidebar,
    // .surface-dark) .text-zinc-300` has to answer for both islands).
    const islands = []
    if (selectors.includes('.app-sidebar')) islands.push('.app-sidebar')
    if (selectors.includes('.surface-dark')) islands.push('.surface-dark')
    // An island rule must not also claim the light scope it is nested under:
    // `.restora-theme .surface-dark .text-zinc-400` only repaints the island.
    const keys = islands.length
      ? islands
      : ['.restora-guest', '.restora-light', '.restora-theme']
          .filter((key) => selectors.includes(key))
    if (!keys.length) keys.push(selectors.replace(/\s+/g, ' ').trim())
    for (const raw of splitSelectorList(selectors)) {
      const selector = raw.trim().replace(/\s+/g, ' ')
      const parts = selector.split(' ')
      // Only unconditional utilities can be stored as a flat `utility → colour`
      // row. `:is(.text-rose-100, .text-rose-400)` is a list of them;
      // `:is(.bg-orange-500, …).text-white` repaints white *only on those
      // fills*, and storing it as `text-white` would flip every white label in
      // the app — exactly the lie this audit exists to catch.
      const plain = /^[.](?:bg|text|border|divide)-[^.\s:()]+$/
      const utilities = []
      const trailing = /(?::is\(([^()]*)\)|[.][^.\s:()]+)$/.exec(selector)
      if (trailing) {
        for (const inner of (trailing[1] || trailing[0]).split(',')) {
          const candidate = inner.trim()
          if (plain.test(candidate)) utilities.push(candidate.slice(1).replace(/\\/g, ''))
        }
      }
      if (!utilities.length) continue
      // A utility that only applies under another utility class is conditional.
      const head = selector.slice(0, selector.length - (trailing ? trailing[0].length : 0))
      if (/\.(?:bg|text|border|divide)-/.test(head)) continue
      // `color` only ever repaints ink: `.app-sidebar .bg-amber-500 { color: … }`
      // is a label rule, not a fill, so it must not answer `bg-amber-500`.
      const kind = decl[1] === 'color' ? 'text' : decl[1] === 'background-color' ? 'bg' : 'border'
      for (const utility of utilities.filter((u) => u.startsWith(`${kind}-`))) {
        for (const key of keys) {
          byScope[key] = { ...(byScope[key] || {}), [utility]: decl[2].trim() }
        }
      }
    }
  }
  return byScope
}
