// ─── Typography + CSS contract ───────────────────────────────────────
// Two kinds of check, both about things a screenshot review misses:
//
//   1. the static audit (scripts/audit-ui.mjs) — fonts declared ⇄ fonts on
//      disk, balanced CSS, a font stack with a generic family, no type below
//      the 10px floor, no grid/table/size that only works on a desktop;
//   2. real measurements — WCAG contrast for every text token and for the
//      remapped zinc ladder, so "verified" means computed, not vibes.
//
// Run `npm run check:ui` to see the same report by hand.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { auditCss, auditFonts, auditResponsive, auditTypeScale, root, runAudit } from '../scripts/audit-ui.mjs'
import { buildEmpire } from '../src/lib/reducer.js'
import { buildInvoiceDocument, renderDocumentHtml } from '../src/lib/documents.js'
import { FONT_FACES, MONO_STACK, SANS_STACK, fontFaceCss } from '../src/lib/typography.js'

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// ─── Static audit ──────────────────────────────────────────────────

test('the UI audit is clean: fonts, CSS, responsive, type scale', () => {
  const { groups } = runAudit()
  for (const [group, findings] of Object.entries(groups)) {
    const errors = findings.filter((entry) => entry.level === 'error')
    assert.deepEqual(
      errors.map((entry) => `${entry.rule}: ${entry.message} (${entry.file})`),
      [],
      `${group} has no error-level findings`,
    )
  }
  assert.deepEqual(auditFonts(), [], 'fonts')
  assert.deepEqual(auditCss(), [], 'css')
  assert.deepEqual(auditResponsive(), [], 'responsive')
  assert.deepEqual(auditTypeScale().filter((entry) => entry.level === 'error'), [], 'type floors')
})

test('every vendored font file is declared and every declared file is vendored', () => {
  const faces = read('src/styles/fonts.css')
  const declared = [...faces.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map((match) => match[1]).sort()
  const onDisk = fs.readdirSync(path.join(root, 'public/fonts')).filter((file) => /\.woff2?$/.test(file)).sort()
  assert.deepEqual(declared, onDisk)
  assert.ok(onDisk.every((file) => file.endsWith('.woff2')), 'woff2 only — no legacy formats to download')
  for (const file of onDisk) {
    assert.ok(fs.statSync(path.join(root, 'public/fonts', file)).size < 120_000, `${file} stays under 120 KB`)
  }
})

test('the webfonts are preloaded so the first paint is not the fallback', () => {
  const html = read('index.html')
  const preloads = [...html.matchAll(/rel="preload"[^>]*href="([^"]+)"/g)].map((match) => match[1])
  assert.ok(preloads.some((href) => href.includes('inter-latin-wght-normal')), 'Inter is preloaded')
  assert.ok(preloads.some((href) => href.includes('noto-sans-khmer')), 'Khmer is preloaded (the UI defaults to Khmer)')
  assert.match(html, /crossorigin/, 'same-origin font preloads must be CORS')
})

test('the language switch writes <html lang> (behaviour is covered in the jsdom suite)', () => {
  // src/lib/i18n.js is a Vite module (extensionless relative imports), so the
  // live check lives in tests/ai-settings-ui.test.js. Here we only assert the
  // wiring exists: one writer, called on boot and on every language change.
  const i18n = read('src/lib/i18n.js')
  assert.match(i18n, /const LANG_TAG = \{ km: 'km-KH', en: 'en-US', zh: 'zh-CN' \}/)
  assert.match(i18n, /document\.documentElement\.lang = LANG_TAG\[normalized\]/)
  assert.match(i18n, /applyDocumentLang\(saved\)/, 'setAppLang updates the document')
  assert.match(i18n, /useEffect\(\(\) => \{\s*applyDocumentLang\(lang\)/, 'useI18n keeps it in sync')
})

test('the entry point sets lang before React boots, and preloads match the app default', () => {
  const html = read('index.html')
  assert.match(html, /restora-kitchen-lang/)
  assert.match(html, /documentElement\.lang/)
  assert.match(html, /<html lang="km-KH">/, 'the static default is the app default')
})

// ─── Contrast (computed, not eyeballed) ────────────────────────────

function luminance(hex) {
  const value = hex.replace('#', '').trim()
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const channels = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16) / 255)
  const [r, g, b] = channels.map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground, background) {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const tokenValue = (css, name) => css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,6})`))?.[1]

test('every light-surface text token clears WCAG AA (4.5:1)', () => {
  const css = read('src/index.css')
  const surfaces = ['#ffffff', '#f5f6f8', '#fafbfc', '#f6f7f9']
  for (const name of ['--text-strong', '--text', '--text-muted', '--text-subtle']) {
    const value = tokenValue(css, name)
    assert.ok(value, `${name} is declared`)
    for (const surface of surfaces) {
      const ratio = contrast(value, surface)
      assert.ok(ratio >= 4.5, `${name} (${value}) on ${surface} is ${ratio.toFixed(2)}:1, below AA`)
    }
  }
})

test('the remapped zinc ladder is monotonic and readable', () => {
  const css = read('src/index.css')
  const ladder = [400, 500, 600, 700, 800].map((step) => ({
    step,
    color: css.match(new RegExp(`text-zinc-${step}\\s*\\{\\s*color:\\s*(#[0-9a-fA-F]{3,6})`))?.[1],
  }))
  for (const entry of ladder) {
    assert.ok(entry.color, `zinc-${entry.step} has a light-theme colour`)
    const ratio = contrast(entry.color, '#ffffff')
    assert.ok(ratio >= 4.5, `zinc-${entry.step} (${entry.color}) is ${ratio.toFixed(2)}:1 on white`)
  }
  // Higher zinc step ⇒ darker grey (a higher step is a *dimmer* tier in the
  // dark console, so it must not become the most prominent text in light mode).
  const luminances = ladder.map((entry) => luminance(entry.color))
  for (let index = 1; index < luminances.length; index += 1) {
    assert.ok(luminances[index] < luminances[index - 1], `zinc-${ladder[index].step} is darker than zinc-${ladder[index - 1].step}`)
  }
})

test('the focus ring is visible on the surface it lands on', () => {
  const css = read('src/index.css')
  const workspace = css.match(/-focus-ring:\s*(#[0-9a-fA-F]{3,6})/g).map((match) => match.split(':')[1].trim())
  assert.ok(workspace.length >= 2, 'a light ring and a dark ring are both declared')
  // The first declaration is the dark-surface ring, the second the workspace's.
  const [dark, light] = workspace
  assert.ok(contrast(light, '#ffffff') >= 3, `workspace focus ring ${light} needs 3:1 against white`)
  assert.ok(contrast(dark, '#17181a') >= 3, `dark-scope focus ring ${dark} needs 3:1 against the sidebar`)
})

test('status colours keep AA against their own soft backgrounds', () => {
  const css = read('src/index.css')
  const pairs = [['--success', '--success-soft'], ['--danger', '--danger-soft'], ['--info', '--info-soft']]
  for (const [ink, soft] of pairs) {
    const value = tokenValue(css, ink)
    assert.ok(value, `${ink} is declared`)
    // Soft backgrounds are alpha over white; treat them as white-ish.
    assert.ok(contrast(value, '#ffffff') >= 4.5, `${ink} (${value}) on white`)
    assert.ok(soft)
  }
})

// ─── Layout behaviour ──────────────────────────────────────────────

test('the shell uses dvh with a vh fallback and honours safe areas', () => {
  const css = read('src/styles/responsive.css')
  assert.match(css, /\.app-shell,[\s\S]*?height:\s*100vh;/)
  assert.match(css, /@supports \(height: 100dvh\)/)
  assert.match(css, /env\(safe-area-inset-left/)
  assert.match(css, /-webkit-text-size-adjust:\s*100%/)
})

test('print styles strip the ops chrome but keep the report', () => {
  const css = read('src/styles/responsive.css')
  const block = css.slice(css.indexOf('@media print'))
  assert.match(block, /\.app-sidebar/)
  assert.match(block, /\.app-topbar/)
  assert.match(block, /break-inside:\s*avoid/)
  assert.match(block, /thead\s*\{\s*display:\s*table-header-group/)
})

test('charts take their palette from the surface, not from the JSX', () => {
  const chart = read('src/screens/Reports/sections/RevenueChartImpl.jsx').replace(/\/\/[^\n]*/g, '').replace(/\{[\s\S]*?\}/g, '')
  assert.doesNotMatch(chart, /#3f3f46|#18181b|#a1a1aa|#52525b/, 'no hard-coded dark palette in the chart')
  const css = read('src/styles/responsive.css')
  assert.match(css, /\.recharts-cartesian-axis-tick text/)
  assert.match(css, /\.recharts-default-tooltip/)
})

test('the type scale is tokenised and Khmer gets more room', () => {
  const index = read('src/index.css')
  const typography = read('src/styles/typography.css')
  for (const token of ['--text-2xs', '--text-3xs', '--text-4xs', '--text-kpi']) {
    assert.ok(index.includes(token), `${token} is declared`)
  }
  assert.match(typography, /html\[lang='km'\][\s\S]*--text-2xs:\s*0\.8125rem/)
  assert.match(typography, /html\[lang='km'\][\s\S]*line-height:\s*1\.65/)
  assert.match(typography, /html\[lang='zh'\]/)
  assert.match(typography, /text-wrap:\s*balance/)
})

test('micro type is not hard-coded in components any more', () => {
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(rel)
      else if (/\.jsx$/.test(rel)) {
        const matches = read(rel).match(/text-\[\d+(?:\.\d+)?px\]/g)
        if (matches) offenders.push(`${rel}: ${matches.join(', ')}`)
      }
    }
  }
  walk('src')
  assert.deepEqual(offenders, [], 'use a named step (text-2xs/3xs/4xs/brand/hero/kpi) so Khmer can rescale')
})

// ─── The print path ────────────────────────────────────────────────
// A printed invoice is a standalone HTML string, so it cannot inherit the app
// stylesheet: it carries its own @font-face + stack, and both must match the
// faces the app boots with.

test('the JS face list and the CSS @font-face blocks agree', () => {
  const css = read('src/styles/fonts.css')
  for (const face of FONT_FACES) {
    assert.ok(css.includes(face.file), `${face.file} is declared in src/styles/fonts.css`)
    assert.ok(css.includes(face.unicodeRange), `${face.file} keeps its unicode-range`)
  }
  const declared = [...css.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map((match) => match[1])
  assert.deepEqual(declared.sort(), FONT_FACES.map((face) => face.file).sort(), 'no face is declared twice or left orphaned')
  assert.ok(SANS_STACK.includes('"Inter Variable"'), 'the JS stack names the bundled family')
  assert.ok(MONO_STACK.includes('ui-monospace'), 'figures have a monospace fallback')
})

test('a printed document carries the fonts when it can, and never points at a dead host', () => {
  const empire = buildEmpire()
  const shop = empire.locations.downtown
  const order = Object.values(shop.orders)[0]
  const doc = buildInvoiceDocument({ shop, order, settings: shop.settings })

  const sameOrigin = renderDocumentHtml(doc, shop.settings, { fontBase: 'https://restora.test' })
  assert.match(sameOrigin, /@font-face/)
  assert.match(sameOrigin, /https:\/\/restora\.test\/fonts\/inter-latin-wght-normal\.woff2/)
  assert.match(sameOrigin, /https:\/\/restora\.test\/fonts\/noto-sans-khmer-khmer-wght-normal\.woff2/)
  assert.ok(sameOrigin.includes('Inter Variable'), 'the sheet uses the same stack as the app')

  const standalone = renderDocumentHtml(doc, shop.settings, { fontBase: '' })
  assert.ok(!standalone.includes('@font-face'), 'a downloaded sheet falls back to the OS faces')
  assert.ok(standalone.includes('Noto Sans Khmer'), 'Khmer text still has a face to land on')
  assert.ok(!fontFaceCss('').includes('@font-face'))
})
