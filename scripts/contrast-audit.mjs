// ─── Contrast & legibility audit ──────────────────────────────────────
// Reads the real palette out of src/index.css, walks every screen for the
// colour utilities it actually uses, and reports the pairs that fail WCAG 2.1
// AA. Run it before and after a palette change:
//
//   node scripts/contrast-audit.mjs                       # print the report
//   node scripts/contrast-audit.mjs --out docs/x.md       # also write a file
//   node scripts/contrast-audit.mjs --json                # machine-readable
//   node scripts/contrast-audit.mjs --fail                # exit 1 on any fail
//
// Two layers of evidence, because they answer different questions:
//   A. design tokens — the pairs CONTRAST_PAIRS names (authoritative; this is
//      what tests/contrast-tokens.test.js enforces);
//   B. utilities in markup — every `text-*`/`bg-*` combination literally
//      written in a className, resolved through the same token table, so a
//      screen that hardcodes `text-zinc-400` on white cannot hide.

import { globSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONTRAST_PAIRS,
  auditContrast,
  parseClassOverrides,
  composite,
  contrastRatio,
  parseColor,
  parseCssTokens,
  resolveToken,
  toHex,
  wcagLevel,
} from '../src/lib/contrast.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CSS_PATH = path.join(ROOT, 'src/index.css')

// Tailwind v4's default palette (hex equivalents of the shipped oklch values),
// used only where src/index.css does not override the token.
const TAILWIND = {
  zinc: { 50: '#fafafa', 100: '#f4f4f5', 200: '#e4e4e7', 300: '#d4d4d8', 400: '#a1a1aa', 500: '#71717a', 600: '#52525b', 700: '#3f3f46', 800: '#27272a', 900: '#18181b', 950: '#09090b' },
  stone: { 50: '#fafaf9', 100: '#f5f5f4', 200: '#e7e5e4', 300: '#d6d3d1', 400: '#a8a29e', 500: '#78716c', 600: '#57534e', 700: '#44403c', 800: '#292524', 900: '#1c1917', 950: '#0c0a09' },
  neutral: { 100: '#f5f5f5', 200: '#e5e5e5', 300: '#d4d4d4', 400: '#a3a3a3', 500: '#737373', 600: '#525252', 700: '#404040', 800: '#262626', 900: '#171717' },
  gray: { 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db', 400: '#9ca3af', 500: '#6b7280', 600: '#4b5563', 700: '#374151', 800: '#1f2937', 900: '#111827' },
  orange: { 50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74', 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c', 800: '#9a3412', 900: '#7c2d12' },
  amber: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e', 900: '#78350f' },
  red: { 50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', 800: '#991b1b', 900: '#7f1d1d' },
  rose: { 100: '#ffe4e6', 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185', 500: '#f43f5e', 600: '#e11d48', 700: '#be123c' },
  emerald: { 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b' },
  sky: { 50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1', 800: '#075985', 900: '#0c4a6e' },
  blue: { 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8' },
  teal: { 50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4', 400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e', 800: '#115e59', 900: '#134e4a' },
  violet: { 50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9', 800: '#5b21b6', 900: '#4c1d95' },
  white: '#ffffff',
  black: '#000000',
}

/** Surfaces a light-workspace screen can plausibly sit on. */
const LIGHT_SURFACES = [
  { name: 'card (#fff)', value: '#ffffff' },
  { name: 'page (#f7f8fa)', value: '#f7f8fa' },
  { name: 'sunken (#f6f7f9)', value: '#f6f7f9' },
]
const DARK_SURFACES = [
  { name: 'sidebar (#17181a)', value: '#17181a' },
  { name: 'ink (#131416)', value: '#131416' },
  { name: 'toast (#18181b)', value: '#18181b' },
]
const GUEST_SURFACES = [
  { name: 'guest bg (#faf6ef)', value: '#faf6ef' },
  { name: 'guest card (#fff)', value: '#ffffff' },
  { name: 'guest chrome (#1b1c1e)', value: '#1b1c1e' },
]

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const failOnProblem = args.includes('--fail')
const outIndex = args.indexOf('--out')
const outPath = outIndex >= 0 ? args[outIndex + 1] : ''

const css = readFileSync(CSS_PATH, 'utf8')
const scopes = parseCssTokens(css)

/**
 * The theme also overrides whole utilities by class (`.restora-theme
 * .bg-black\/30 { background-color: … }`), which no token table can see.
 * Read those too, or the audit grades a wash it is not actually painting.
 * Returns `{ '.restora-theme': { 'bg-black/30': '#…' }, … }`.
 */
const CLASS_OVERRIDES = parseClassOverrides(css)

// ── A. design tokens ──────────────────────────────────────────────────
const tokenRows = auditContrast(scopes)

// ── B. utilities in markup ────────────────────────────────────────────

/**
 * Resolve a Tailwind colour utility to a concrete colour, honouring the
 * overrides src/index.css makes at `.restora-theme` / `.app-sidebar` scope.
 * `text-zinc-400` in the workspace is not Tailwind's #a1a1aa — the theme
 * remaps it, and the audit has to see the remap.
 */
function resolveUtility(kind, name, { scope = ['.restora-theme'], opacity = null, classes = [] } = {}) {
  const tokenName = `--color-${name.replace(/\//g, '-')}`
  // White sitting on an accent fill is repainted with dark ink by src/index.css
  // (white on #f36a21 is 3.05:1; the dark label is 6.23:1). Mirror that rule so
  // the audit scores what a browser renders, not the literal class names.
  const fills = classes.map((c) => c.replace(/^(?:hover|focus|active|focus-visible):/, ''))
  if (kind === 'text' && name === 'white' && fills.some((c) => ACCENT_LABEL_FILLS.includes(c))) {
    const flipped = resolveToken(scopes, '--text-on-accent', scope)
    if (flipped) return parseColor(flipped)
  }
  // A class-level override wins over both the token and Tailwind's default.
  const slashed = opacity !== null && opacity !== undefined ? `${kind}-${name}/${opacity}` : ''
  let viaSlashedOverride = false
  for (const key of [...scope].reverse()) {
    const table = CLASS_OVERRIDES[key]
    const declared = (slashed && table?.[slashed]) || table?.[`${kind}-${name}`]
    if (!declared) continue
    if (slashed && table[slashed] === declared) viaSlashedOverride = true
    let painted = parseColor(declared)
    if (!painted) {
      // `color: var(--accent-text, #a63a0c)` — follow the token, then the fallback.
      const ref = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/.exec(declared)
      if (ref) {
        const viaToken = resolveToken(scopes, ref[1], scope)
        painted = parseColor(viaToken || ref[2] || '')
      }
    }
    if (painted) return painted
  }
  const override = resolveToken(scopes, tokenName, scope)
  let base = null
  if (override) base = parseColor(override)
  if (!base) {
    if (name === 'white') base = parseColor(TAILWIND.white)
    else if (name === 'black') base = parseColor(TAILWIND.black)
    else {
      const [family, step] = name.split('-')
      base = parseColor(TAILWIND[family]?.[step] || '')
    }
  }
  if (!base) return null
  // `text-white/70` is a composite over whatever it sits on, not a new colour.
  if (opacity !== null && opacity !== undefined && !viaSlashedOverride) {
    base = { ...base, a: Number(opacity) / 100 }
  }
  return base
}

const files = globSync('src/**/*.jsx', { cwd: ROOT })
const CLASS_RE = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g
// `dark:` variants never apply: this app ships one light theme with explicit
// dark islands, so grading `dark:hover:text-white` reports a colour no browser
// paints. The negative lookbehind drops them.
const TEXT_RE = /(?<!dark:)\btext-((?:[a-z]+-)?(?:white|black|\d+))(?:\/(\d{1,3}))?\b/g
const BG_RE = /(?<!dark:)\bbg-((?:[a-z]+-)?(?:white|black|\d+))(?:\/(\d{1,3}))?\b/g
const CLOSE_RE = /(?:<\/[A-Za-z][\w.]*\s*>|\/>)/g

/** True when the utility at `index` sits behind a `dark:` variant. */
function isDarkVariant(literal, index) {
  const before = literal.slice(Math.max(0, index - 24), index)
  const variants = /((?:[a-z-]+:)+)$/.exec(before)
  return Boolean(variants && variants[1].split(':').includes('dark'))
}

const pairFindings = []
const textFindings = []
// Indentation of the open element that declared a dark island, if any.
let islandStack = []

/** Files that are a dark island end to end (their root carries `.surface-dark`). */
const DARK_ISLAND_FILES = ['CommandPalette.jsx', 'ShortcutOverlay.jsx', 'ui/Toast.jsx']

/**
 * Fills whose *label* the theme repaints with dark ink, because white on the
 * brand orange measures only 3.05:1. Mirrors the rule in src/index.css; kept
 * here as a name list so the audit scores what a browser paints.
 */
const ACCENT_LABEL_FILLS = ['bg-orange-500', 'bg-orange-600', 'bg-amber-400', 'bg-amber-500']

/**
 * Which theme scopes reach a given element.
 *
 * The staff app renders inside `.restora-theme`; the guest QR menu and mini app
 * are portalled onto <body> under `.restora-guest`. `.app-sidebar` and
 * `.surface-dark` are *dark islands* — their ramps only apply to elements that
 * actually sit inside them, so they are detected per element (or per file for
 * components that are dark end to end) rather than assumed for a whole screen.
 * Assuming them per file is what made the topbar's zinc-500 look like a fail.
 */
function scopeFor(file, classes = [], inherited = false) {
  const base = /Guest|MiniApp/.test(file) ? '.restora-guest' : '.restora-theme'
  const island = classes.includes('app-sidebar')
    ? '.app-sidebar'
    : (classes.includes('surface-dark') || inherited || DARK_ISLAND_FILES.some((name) => file.endsWith(name)))
      ? '.surface-dark'
      : null
  return island ? [base, island] : [base]
}

function surfacesFor(file, classes = [], inherited = false) {
  if (scopeFor(file, classes, inherited).includes('.surface-dark')) return DARK_SURFACES
  if (/Guest|MiniApp/.test(file)) return GUEST_SURFACES
  if (/KitchenScreen|AppShell|TabStrip/.test(file)) return [...LIGHT_SURFACES, ...DARK_SURFACES]
  return LIGHT_SURFACES
}

/**
 * Resolve a Tailwind arbitrary value: `text-[var(--text-muted)]`,
 * `bg-[#121110]`, `bg-[rgb(18_17_16/72%)]`, `text-[var(--accent)]/70`.
 * Underscores are Tailwind's stand-in for spaces. Non-colour arbitrary values
 * (`text-[10px]`, `text-[var(--fs-label)]`) resolve to nothing and drop out.
 */
function resolveArbitrary(raw, scope) {
  let value = String(raw).replace(/_/g, ' ').trim()
  let opacity = null
  const slash = /\/(\d{1,3})$/.exec(value)
  if (slash) {
    opacity = Number(slash[1])
    value = value.slice(0, slash.index).trim()
  }
  const ref = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(value)
  const source = ref ? (resolveToken(scopes, ref[1], scope) || ref[2] || '') : value
  const painted = parseColor(source)
  if (!painted) return null
  return opacity === null ? painted : { ...painted, a: opacity / 100 }
}

/**
 * Every colour one className literal asks for, named or arbitrary, as
 * `{ label, color }`. This is what makes `bg-[var(--warning)] text-white`
 * measurable at all: without arbitrary values those badges looked like white
 * ink on a white card.
 */
function colourCandidates(literal, kind, scope, classes) {
  const out = []
  const named = kind === 'text' ? TEXT_RE : BG_RE
  for (const entry of literal.matchAll(named)) {
    if (isDarkVariant(literal, entry.index)) continue
    const color = resolveUtility(kind, entry[1], {
      scope,
      opacity: entry[2] ? Number(entry[2]) : null,
      classes,
    })
    if (color) out.push({ label: `${kind}-${entry[1]}${entry[2] ? `/${entry[2]}` : ''}`, color })
  }
  const arbitrary = new RegExp(`\\b${kind}-\\[([^\\]]+)\\]`, 'g')
  for (const entry of literal.matchAll(arbitrary)) {
    if (isDarkVariant(literal, entry.index)) continue
    const color = resolveArbitrary(entry[1], scope)
    if (color) out.push({ label: `${kind}-[${entry[1]}]`, color })
  }
  return out
}

/** Indent of the line the tag enclosing `pos` opens on. */
function indentAt(source, lines, pos) {
  // A closing tag starts with its own `<`; a className or a `/>` has to look
  // back to the tag that opened it.
  const tagStart = source[pos] === '<' ? pos : source.slice(0, pos).lastIndexOf('<')
  const line = source.slice(0, tagStart < 0 ? pos : tagStart).split('\n').length
  return /^\s*/.exec(lines[line - 1] || '')[0].length
}

for (const file of files) {
  const source = readFileSync(path.join(ROOT, file), 'utf8')
  const lines = source.split('\n')
  islandStack = []
  let match
  // Literals and JSX closing tags in source order. The closes matter: an
  // island marker only reaches as far as its own element, and indentation
  // alone cannot tell a nested child from the next sibling subtree.
  const events = []
  CLASS_RE.lastIndex = 0
  while ((match = CLASS_RE.exec(source))) events.push({ kind: 'class', pos: match.index, match })
  CLOSE_RE.lastIndex = 0
  while ((match = CLOSE_RE.exec(source))) events.push({ kind: 'close', pos: match.index, match })
  events.sort((a, b) => a.pos - b.pos)

  for (const event of events) {
    if (event.kind === 'close') {
      const indent = indentAt(source, lines, event.pos)
      while (islandStack.length && islandStack[islandStack.length - 1] >= indent) islandStack.pop()
      continue
    }
    match = event.match
    const literal = match[1] || match[2] || ''
    if (!literal || literal.includes('${')) continue
    const lineNumber = source.slice(0, match.index).split('\n').length
    // Nesting proxy: the indent of the line the enclosing tag opens on. JSX
    // here is consistently indented, so a literal deeper than an island marker
    // is inside it, and the first literal at or above that indent closes it.
    const indent = indentAt(source, lines, match.index)
    while (islandStack.length && indent <= islandStack[islandStack.length - 1]) islandStack.pop()

    const classes = literal.split(/\s+/).filter(Boolean)
    if (classes.some((c) => c === 'surface-dark' || c === 'app-sidebar')) islandStack.push(indent)
    const scope = scopeFor(file, classes, islandStack.length > 0)
    const surfaces = surfacesFor(file, classes, islandStack.length > 0)
    // A wash composites over the surface it sits on: white cards in the light
    // workspace, the island's own ink inside `.app-sidebar` / `.surface-dark`.
    const washBase = parseColor(surfaces[0].value)
    const texts = colourCandidates(literal, 'text', scope, classes)
    const bgs = colourCandidates(literal, 'bg', scope, classes)
    if (!texts.length) continue

    if (bgs.length) {
      // An explicit pair: the element names both its ink and its fill.
      const bg = bgs[0].color.a < 1 ? composite(bgs[0].color, washBase) : bgs[0].color
      for (const ink of texts) {
        const fg = ink.color.a < 1 ? composite(ink.color, bg) : ink.color
        const ratio = contrastRatio(fg, bg)
        const level = wcagLevel(ratio)
        if (level === 'fail') {
          pairFindings.push({
            file,
            line: lineNumber,
            text: ink.label,
            bg: bgs[0].label,
            fgHex: toHex(fg),
            bgHex: toHex(bg),
            ratio: Number(ratio.toFixed(2)),
            level,
            snippet: (lines[lineNumber - 1] || '').trim().slice(0, 150),
          })
        }
      }
      continue
    }

    // No fill of its own: judge the ink against the surfaces it can land on.
    for (const ink of texts) {
      // zinc-700..900 are body inks; the light grays are the ones that vanish.
      const step = Number(ink.label.split('-').pop())
      if (!Number.isNaN(step) && step >= 700) continue
      const worst = []
      for (const surface of surfaces) {
        const base = parseColor(surface.value)
        const fg = ink.color.a < 1 ? composite(ink.color, base) : ink.color
        const ratio = contrastRatio(fg, base)
        worst.push({ surface: surface.name, ratio: Number(ratio.toFixed(2)), level: wcagLevel(ratio) })
      }
      const failing = worst.filter((entry) => entry.level === 'fail')
      if (failing.length === worst.length && worst.length) {
        textFindings.push({
          file,
          line: lineNumber,
          text: ink.label,
          ratios: worst,
          snippet: (lines[lineNumber - 1] || '').trim().slice(0, 150),
        })
      }
    }
  }
}

// ── --why <file>:<line> ───────────────────────────────────────────────
// Shows exactly how one className literal resolves: which scope won, which
// colour each utility mapped to, and the ratio that came out. Use it when a
// finding looks wrong — either the audit or the CSS is lying, and this says which.
const whyIndex = args.indexOf('--why')
if (whyIndex >= 0 && args[whyIndex + 1]) {
  const [whyFile, whyLineRaw] = args[whyIndex + 1].split(':')
  const whyLine = Number(whyLineRaw)
  const whyPath = path.isAbsolute(whyFile) ? whyFile : path.join(ROOT, whyFile)
  const whySource = readFileSync(whyPath, 'utf8')
  const re = new RegExp(CLASS_RE.source, 'g')
  let hit = null
  let m
  while ((m = re.exec(whySource))) {
    const at = whySource.slice(0, m.index).split('\n').length
    if (at === whyLine) { hit = m; break }
  }
  if (!hit) {
    process.stdout.write(`no className literal at ${whyFile}:${whyLine}\n`)
  } else {
    const literal = hit[1] || hit[2] || ''
    const classes = literal.split(/\s+/).filter(Boolean)
    const scope = scopeFor(whyFile, classes)
    const surfaces = surfacesFor(whyFile, classes)
    process.stdout.write(`literal : ${literal.slice(0, 200)}\n`)
    process.stdout.write(`scope   : ${scope.join(' → ')}\n`)
    process.stdout.write(`surfaces: ${surfaces.map((x) => x.name).join(', ')}\n`)
    for (const cls of classes) {
      if (!/^(text|bg|border)-/.test(cls)) continue
      const [kind, ...rest] = cls.split('-')
      const [name, opRaw] = rest.join('-').split('/')
      const op = opRaw ? Number(opRaw) : null
      const resolved = resolveUtility(kind, name, { scope, opacity: op, classes })
      if (!resolved) continue
      let painted = resolved
      let note = ''
      if (kind === 'bg' && resolved.a < 1) {
        painted = composite(resolved, parseColor(surfaces[0].value))
        note = ` (${Math.round(resolved.a * 100)}% over ${surfaces[0].name})`
      }
      process.stdout.write(`  ${cls.padEnd(22)} → ${toHex(painted)}${note}\n`)
    }
  }
  process.exit(0)
}

// ── report ────────────────────────────────────────────────────────────

const failingTokens = tokenRows.filter((row) => !row.ok)

function markdown() {
  const out = []
  out.push('# Restora contrast & legibility audit')
  out.push('')
  out.push(`Generated ${new Date().toISOString().slice(0, 10)} by \`node scripts/contrast-audit.mjs\`. `)
  out.push('WCAG 2.1: body text needs 4.5:1 (AA), large text and non-text UI 3:1.')
  out.push('')
  out.push(`**${failingTokens.length} of ${tokenRows.length} token pairs fail**, `
    + `**${pairFindings.length} hardcoded class pairs fail**, `
    + `**${textFindings.length} text colours fail on every surface they can land on.**`)
  out.push('')
  out.push('## A. Design tokens')
  out.push('')
  out.push('| Pair | Ink | Surface | Ratio | Level |')
  out.push('| --- | --- | --- | --- | --- |')
  for (const row of tokenRows) {
    out.push(`| ${row.label} \`${row.id}\` | \`${row.fg}\` | \`${row.bg}\` | ${row.ratio.toFixed(2)} | ${row.ok ? row.level : '**FAIL**'} |`)
  }
  out.push('')
  out.push('## B. Hardcoded class pairs (text + background on one element)')
  out.push('')
  if (!pairFindings.length) {
    out.push('None failing.')
  } else {
    out.push('| File | Line | Classes | Ink | Fill | Ratio |')
    out.push('| --- | --- | --- | --- | --- | --- |')
    for (const row of pairFindings.slice(0, 80)) {
      out.push(`| \`${row.file}\` | ${row.line} | \`${row.text}\` + \`${row.bg}\` | \`${row.fgHex}\` | \`${row.bgHex}\` | ${row.ratio.toFixed(2)} |`)
    }
  }
  out.push('')
  out.push('## C. Text colours that fail on every surface they can land on')
  out.push('')
  if (!textFindings.length) {
    out.push('None failing.')
  } else {
    out.push('| File | Line | Class | Worst ratio |')
    out.push('| --- | --- | --- | --- |')
    const seen = new Map()
    for (const row of textFindings) {
      const best = row.ratios.reduce((max, entry) => Math.max(max, entry.ratio), 0)
      const key = `${row.file}:${row.text}`
      if (!seen.has(key) || seen.get(key).ratio < best) seen.set(key, { ...row, ratio: best })
    }
    for (const row of [...seen.values()].sort((a, b) => b.ratio - a.ratio).slice(0, 60)) {
      out.push(`| \`${row.file}\` | ${row.line} | \`${row.text}\` | ${row.ratio.toFixed(2)} |`)
    }
  }
  out.push('')
  return out.join('\n')
}

if (args.includes('--debug')) {
  process.stdout.write(`token scopes: ${Object.keys(scopes).length}\n`)
  for (const [key, table] of Object.entries(CLASS_OVERRIDES)) {
    process.stdout.write(`override scope ${key}: ${Object.keys(table).length} → ${JSON.stringify(Object.entries(table).slice(0, 3))}\n`)
  }
  process.stdout.write(`probe text-zinc-400 → ${toHex(resolveUtility('text', 'zinc-400', { scope: ['.restora-theme'] }) || '')}\n`)
  process.stdout.write(`probe bg-black/30   → ${toHex(resolveUtility('bg', 'black/30', { scope: ['.restora-theme'] }) || '')}\n`)
}

if (asJson) {
  process.stdout.write(`${JSON.stringify({ tokens: tokenRows, pairs: pairFindings, textOnly: textFindings }, null, 2)}\n`)
} else {
  process.stdout.write(`${markdown()}\n`)
}
if (outPath) {
  writeFileSync(path.resolve(ROOT, outPath), markdown())
  process.stdout.write(`written: ${outPath}\n`)
}
if (failOnProblem && (failingTokens.length || pairFindings.length)) process.exit(1)
