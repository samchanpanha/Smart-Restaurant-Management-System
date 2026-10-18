// ─── Contrast regression guard ────────────────────────────────────────
// The palette in src/index.css is measured here rather than eyeballed, so a
// token edit that drops a label under WCAG AA fails the suite instead of
// shipping. Two mechanisms are covered, because the theme uses both:
//
//   • design tokens (`--text-on-accent`, `--success`, …) via CONTRAST_PAIRS;
//   • class-level utility remaps (`.text-zinc-400 { color: … }`), which no
//     token table can see and which carry the whole zinc/accent ink ramp.
//
// Run just this file with: node --test tests/contrast-tokens.test.js
// The full report lives in docs/contrast-audit.md and is regenerated with
// `node scripts/contrast-audit.mjs --out docs/contrast-audit.md`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONTRAST_PAIRS,
  auditContrast,
  composite,
  contrastRatio,
  parseClassOverrides,
  parseColor,
  parseCssTokens,
  resolveToken,
  toHex,
} from '../src/lib/contrast.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')
const scopes = parseCssTokens(css)
const overrides = parseClassOverrides(css)

/** The light roots the app renders under, and the dark islands inside them. */
const LIGHT = ['.restora-theme']
const GUEST = ['.restora-guest']
const ISLAND = ['.restora-theme', '.surface-dark']

const WHITE = '#ffffff'
const PAGE = '#f7f8fa'
const SUNKEN = '#f6f7f9'
const ISLAND_SURFACE = '#17181a'

const token = (name, scope = LIGHT) => resolveToken(scopes, name, scope)

/** Follow `var(--token, #fallback)` the way the cascade would. */
function resolveDeclared(declared, scope) {
  if (!declared) return ''
  const ref = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/.exec(declared)
  if (!ref) return declared
  return resolveToken(scopes, ref[1], scope) || ref[2] || ''
}

/** The colour a class-level utility actually paints in a scope. */
function painted(utility, scopeKey) {
  const declared = overrides[scopeKey]?.[utility]
  return declared ? resolveDeclared(declared, [scopeKey]) : ''
}

function ratio(fg, bg) {
  const a = parseColor(fg)
  const b = parseColor(bg)
  assert.ok(a, `unparsable foreground ${fg}`)
  assert.ok(b, `unparsable background ${bg}`)
  return contrastRatio(a, b)
}

/** Label a finding so a failure says what to fix, not just that it failed. */
function check(label, fg, bg, minimum = 4.5) {
  const value = ratio(fg, bg)
  assert.ok(
    value >= minimum,
    `${label}: ${toHex(parseColor(fg))} on ${toHex(parseColor(bg))} is `
    + `${value.toFixed(2)}:1, needs ${minimum}:1`,
  )
  return value
}

test('every CONTRAST_PAIRS row meets its WCAG target', () => {
  const rows = auditContrast(scopes)
  const failures = rows.filter((row) => !row.ok)
  assert.deepEqual(
    failures.map((row) => `${row.id}: ${row.fg} on ${row.bg} = ${row.ratio}`),
    [],
    `${failures.length} of ${rows.length} token pairs fail`,
  )
})

test('the pair table still covers the surfaces that matter', () => {
  // Guards against "fixing" the audit by deleting rows from it.
  const ids = CONTRAST_PAIRS.map((pair) => pair.id)
  assert.ok(ids.length >= 25, `only ${ids.length} pairs audited`)
  for (const required of [
    'accent/label-on-accent',
    'accent/accent-on-soft',
    'sidebar/active-on-accent',
    'workspace/body-on-surface',
    'workspace/muted-on-surface',
    'status/success-on-soft',
    'guest/label-on-accent',
  ]) {
    assert.ok(ids.includes(required), `CONTRAST_PAIRS lost ${required}`)
  }
})

test('primary button labels clear AA on the brand accent and its hover', () => {
  const ink = token('--text-on-accent')
  check('label on accent', ink, token('--accent'))
  check('label on accent hover', ink, token('--accent-hover'))
  check('guest label on guest accent', token('--guest-ink', GUEST), token('--guest-accent', GUEST))
})

test('white labels are flipped to dark ink on the light accent fills', () => {
  // src/index.css repaints `.text-white` inside these fills; the flip is only
  // worth anything if the dark label actually passes on each of them.
  const ink = token('--text-on-accent')
  for (const fill of ['--color-orange-500', '--color-orange-600', '--color-amber-400', '--color-amber-500']) {
    check(`label on ${fill}`, ink, token(fill))
  }
  assert.match(
    css,
    /:is\(\.bg-orange-500[^)]*\)\.text-white/,
    'the white-on-accent flip rule is missing from src/index.css',
  )
})

test('the cool strong fills carry a white label at AA', () => {
  // These keep `text-white`; each has to be dark enough to earn it.
  for (const fill of [
    '--color-red-500',
    '--color-red-600',
    '--color-rose-500',
    '--color-emerald-500',
    '--color-emerald-600',
    '--color-sky-500',
    '--color-sky-600',
    '--color-violet-500',
    '--color-violet-600',
  ]) {
    check(`white on ${fill}`, WHITE, token(fill))
  }
})

test('zinc ink ramp: light surfaces get dark text, dark islands get light text', () => {
  for (const step of [100, 200, 300, 400, 500, 600, 700, 800]) {
    const utility = `text-zinc-${step}`
    const ink = painted(utility, '.restora-theme')
    assert.ok(ink, `${utility} is not remapped for the light theme`)
    check(`${utility} on card`, ink, WHITE)
    check(`${utility} on page`, ink, PAGE)
    check(`${utility} on sunken`, ink, SUNKEN)

    const islandInk = painted(utility, '.surface-dark')
    assert.ok(islandInk, `${utility} is not remapped for dark islands`)
    check(`${utility} on island`, islandInk, ISLAND_SURFACE)
  }
  check('placeholder on card', painted('placeholder-zinc-500', '.restora-theme') || token('--text-subtle'), WHITE)
})

test('accent-family ink ramp clears AA on white and on its own pale wash', () => {
  const families = {
    orange: [100, 200, 300, 400, 500, 600, 700],
    amber: [100, 200, 300, 400, 500, 600, 700, 800],
    red: [100, 200, 300, 400],
    rose: [100, 200, 300, 400],
    emerald: [100, 200, 300, 400],
    sky: [100, 200, 300, 400],
    violet: [100, 200, 300, 400],
    stone: [300, 400, 500, 600],
  }
  for (const [family, steps] of Object.entries(families)) {
    for (const step of steps) {
      const utility = `text-${family}-${step}`
      const ink = painted(utility, '.restora-theme')
      assert.ok(ink, `${utility} is not remapped for the light theme`)
      check(`${utility} on card`, ink, WHITE)
      for (const wash of [50, 100]) {
        const fill = token(`--color-${family}-${wash}`)
        if (fill) check(`${utility} on ${family}-${wash}`, ink, fill)
      }
      // The same steps inside a dark island have to come back light.
      const islandInk = painted(utility, '.surface-dark')
      if (islandInk) check(`${utility} on island`, islandInk, ISLAND_SURFACE)
    }
  }
})

test('status colours read as ink on white and on their soft washes', () => {
  for (const name of ['success', 'warning', 'danger', 'info']) {
    const ink = token(`--${name}`)
    check(`${name} on card`, ink, WHITE)
    check(`${name} on page`, ink, PAGE)
    const softRaw = token(`--${name}-soft`)
    assert.ok(softRaw, `--${name}-soft is not defined`)
    const soft = composite(parseColor(softRaw), parseColor(WHITE))
    check(`${name} on ${name}-soft`, ink, toHex(soft))
  }
})

test('dark islands define status inks light enough to read on them', () => {
  for (const name of ['success', 'warning', 'danger', 'info', 'accent-text']) {
    const ink = token(`--${name}`, ISLAND)
    assert.ok(ink, `--${name} is not defined for .surface-dark`)
    check(`${name} on island`, ink, ISLAND_SURFACE)
  }
})

test('non-text UI (borders, focus ring, accent icon) clears the 3:1 target', () => {
  check('strong border on card', token('--border-strong'), WHITE, 3)
  check('strong border on page', token('--border-strong'), PAGE, 3)
  check('accent as icon on card', token('--accent'), WHITE, 3)
  check('focus ring on card', token('--accent'), WHITE, 3)
  const accentWash = toHex(composite(parseColor(token('--accent-soft')), parseColor(WHITE)))
  check('accent ink on accent wash', token('--accent-text'), accentWash, 4.5)
})

test('body, muted and subtle text tokens clear AA on every workspace surface', () => {
  for (const name of ['--text-strong', '--text', '--text-muted', '--text-subtle']) {
    for (const surface of [WHITE, PAGE, SUNKEN]) {
      check(`${name} on ${surface}`, token(name), surface)
    }
  }
})

test('the guest palette keeps its own ink readable on its warm surfaces', () => {
  const surfaces = ['--guest-bg', '--guest-page', '--guest-surface']
  for (const surface of surfaces) {
    const bg = token(surface, GUEST)
    check('guest ink', token('--guest-ink', GUEST), bg)
  }
  check('white on guest chrome', WHITE, token('--guest-chrome', GUEST))
})
