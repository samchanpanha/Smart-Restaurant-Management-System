#!/usr/bin/env node
// ─── UI audit: fonts, CSS, and responsive risk ───────────────────────
// `npm run check:ui` prints a report; `tests/typography-css.test.js` asserts
// the error-level findings stay at zero. The rules exist so the two things
// that bit this codebase are caught mechanically:
//
//   • type that silently falls off the token scale (text-[11px] everywhere,
//     a font stack with no generic family, a webfont nobody preloads), and
//   • layout that only works on a 1280px desk (grid-cols-6 on a phone, a
//     900px table with no scroll container, 100vh chrome on iOS).
//
// Nothing here needs a browser: it is a static read of src/, public/, and the
// HTML entry point.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(root, rel))

export function walk(dir, filter) {
  const out = []
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(rel, filter))
    else if (filter(rel)) out.push(rel)
  }
  return out
}

export const CSS_FILES = ['src/index.css', 'src/styles/fonts.css', 'src/styles/typography.css', 'src/styles/responsive.css']
export const jsxFiles = () => walk('src', (rel) => /\.jsx$/.test(rel))
export const cssFiles = () => walk('src', (rel) => /\.css$/.test(rel))

const finding = (level, rule, message, file = '') => ({ level, rule, message, file })

// ─── Fonts ───────────────────────────────────────────────────────────
export function auditFonts() {
  const findings = []
  const fontsCss = read('src/styles/fonts.css')
  const indexCss = read('src/index.css')
  const html = read('index.html')

  // 1. Every @font-face url() has a file on disk (and the file is woff2).
  const srcs = [...fontsCss.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map((match) => match[1])
  if (srcs.length === 0) findings.push(finding('error', 'fonts/faces', 'no @font-face src found in src/styles/fonts.css'))
  for (const src of srcs) {
    const rel = src.replace(/^\//, 'public/')
    if (!exists(rel)) findings.push(finding('error', 'fonts/missing-file', `${src} is declared but ${rel} does not exist`, 'src/styles/fonts.css'))
    else if (!/\.woff2$/.test(src)) findings.push(finding('warn', 'fonts/format', `${src} is not woff2`, 'src/styles/fonts.css'))
  }
  // 2. …and every vendored file is declared (no dead weight in public/).
  const vendored = exists('public/fonts')
    ? fs.readdirSync(path.join(root, 'public/fonts')).filter((file) => /\.(woff2?|ttf|otf)$/.test(file))
    : []
  for (const file of vendored) {
    if (!srcs.some((src) => src.endsWith(file))) {
      findings.push(finding('error', 'fonts/unused-file', `public/fonts/${file} is never declared in a @font-face`))
    }
  }
  // 3. font-display on every face, or first paint blocks on the webfont.
  const faces = fontsCss.split('@font-face').slice(1)
  for (const face of faces) {
    if (!/font-display:\s*swap/.test(face)) {
      findings.push(finding('error', 'fonts/display', '@font-face without `font-display: swap`', 'src/styles/fonts.css'))
    }
  }
  // 4. The Latin face is preloaded (self-hosted fonts are CORS fetches).
  if (!/rel="preload"[^>]*as="font"/.test(html)) {
    findings.push(finding('warn', 'fonts/preload', 'no font preload in index.html — expect a flash of fallback text'))
  }

  // 5. Font stacks: self-hosted family first, generic family last, and a
  //    Khmer fallback (the UI defaults to Khmer).
  const stack = indexCss.match(/--font-sans:\s*([^;]+);/)?.[1] || ''
  if (!/Inter Variable/.test(stack)) findings.push(finding('error', 'fonts/stack', '--font-sans does not start from the self-hosted Inter'))
  if (!/sans-serif\s*$/.test(stack.trim())) findings.push(finding('error', 'fonts/stack', '--font-sans must end in a generic family'))
  if (!/Noto Sans Khmer/.test(stack)) findings.push(finding('error', 'fonts/stack', '--font-sans has no Khmer fallback'))
  const mono = indexCss.match(/--font-mono:\s*([^;]+);/)?.[1] || ''
  if (!/monospace\s*$/.test(mono.trim())) findings.push(finding('error', 'fonts/stack', '--font-mono must end in a generic family'))

  // 6. Script-aware scale: Khmer/Chinese need their own sizes and leading.
  const typography = read('src/styles/typography.css')
  for (const lang of ['km', 'zh']) {
    if (!typography.includes(`lang='${lang}'`)) {
      findings.push(finding('error', 'fonts/script', `typography.css has no html[lang='${lang}'] scale`, 'src/styles/typography.css'))
    }
  }
  if (!/--text-2xs/.test(indexCss)) findings.push(finding('error', 'fonts/tokens', 'micro type tokens (--text-2xs) are not declared'))

  return findings
}

// ─── CSS structure ───────────────────────────────────────────────────
export function auditCss() {
  const findings = []
  for (const file of cssFiles()) {
    const css = read(file)
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')

    // Balanced braces: an unbalanced file silently swallows every later rule.
    const open = (withoutComments.match(/{/g) || []).length
    const close = (withoutComments.match(/}/g) || []).length
    if (open !== close) findings.push(finding('error', 'css/braces', `${file} has ${open} “{” and ${close} “}”`, file))

    // Duplicate declarations of one selector inside the same at-rule scope.
    const seen = new Map()
    for (const match of withoutComments.matchAll(/(^|\n)\s*([^{}@\n][^{}\n]*?)\s*\{([^{}]*)\}/g)) {
      const selector = match[2].trim()
      const body = match[3].trim()
      const previous = seen.get(selector)
      if (previous && previous === body) {
        findings.push(finding('warn', 'css/duplicate', `${selector} is declared twice with identical rules`, file))
      }
      seen.set(selector, body)
    }

    // Font sizes below the 10px floor (the 8px chip counter is the only one).
    for (const match of withoutComments.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
      const size = Number(match[1])
      if (size < 8 || (size < 10 && !/counter|chip/.test(withoutComments.slice(Math.max(0, match.index - 120), match.index)))) {
        findings.push(finding('error', 'css/font-size-floor', `${size}px font-size is below the 10px floor`, file))
      }
    }
  }
  return findings
}

// ─── Responsive risk in JSX ──────────────────────────────────────────
const BREAKPOINTS = ['sm:', 'md:', 'lg:', 'xl:', '2xl:', 'max-sm:', 'max-md:']
const hasBreakpoint = (cls) => BREAKPOINTS.some((bp) => cls.includes(bp))
const classAttrs = (source) => [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((match) => match[1] || match[2] || '')

export function auditResponsive() {
  const findings = []
  for (const file of jsxFiles()) {
    const source = read(file)
    const attrs = classAttrs(source)

    for (const cls of attrs) {
      // A 5-8 column grid on a phone gives every column ~40px.
      for (const match of cls.matchAll(/(^|\s)(grid-cols-[5-9])/g)) {
        if (!hasBreakpoint(cls)) {
          findings.push(finding('warn', 'responsive/grid', `${match[2]} without a breakpoint — collapse it on phones`, file))
        }
      }
      // Duplicate responsive prefix on one element (sm: twice, second wins).
      const tokens = cls.split(/\s+/).filter((token) => token.includes(':'))
      const keyed = new Map()
      for (const token of tokens) {
        const [prefix, ...rest] = token.split(':')
        const property = rest.join(':').replace(/-\[[^\]]*\]/g, '-[]').replace(/-[0-9.]+$/, '')
        const key = `${prefix}:${property}`
        if (keyed.has(key) && keyed.get(key) !== token) {
          findings.push(finding('error', 'responsive/duplicate', `${keyed.get(key)} and ${token} both apply (the last one silently wins)`, file))
        }
        keyed.set(key, token)
      }
      // Tailwind's spacing scale is 0.5-based: `py-0.2` compiles to nothing and
      // fails silently, which is how a badge ends up with no padding at all.
      for (const match of cls.matchAll(/(^|\s)(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|inset|top|bottom|left|right)-[0-9]*\.([2346789])(?![0-9])/g)) {
        findings.push(finding('error', 'css/off-scale-spacing', `${match[2].trim()} is not on Tailwind's spacing scale (use .5 steps)`, file))
      }

      // A hard width wider than a small phone breaks the layout; a hard
      // *minimum* is legitimate inside a horizontal scroll container, so it is
      // only worth a look (see the table rule below, which is the error).
      for (const match of cls.matchAll(/(^|\s)w-\[(\d+)px\]/g)) {
        if (Number(match[2]) > 420) {
          findings.push(finding('error', 'responsive/fixed-width', `w-[${match[2]}px] cannot fit a phone — needs a fluid width`, file))
        }
      }

    }

    // A hard minimum wider than a phone is only fine on a table (handled by
    // the rule below) or inside a container that scrolls.
    for (const match of source.matchAll(/<(div|section|ul|ol|form|label)\s[^>]*className="([^"]*)"/g)) {
      for (const width of match[2].matchAll(/(^|\s)min-w-\[(\d+)px\]/g)) {
        if (Number(width[2]) > 420 && !/table-scroll|overflow-x-auto|overflow-auto/.test(match[2])) {
          findings.push(finding('warn', 'responsive/min-width', `min-w-[${width[2]}px] on a <${match[1]}> without a scroll container`, file))
        }
      }
    }

    // A wide table must sit in a horizontal scroll container.
    const tables = [...source.matchAll(/<table className="([^"]*)"/g)]
    for (const table of tables) {
      const minWidth = Number(table[1].match(/min-w-\[(\d+)px\]/)?.[1] || 0)
      if (minWidth < 640) continue
      const before = source.slice(0, table.index)
      const wrapper = before.lastIndexOf('<div')
      const wrapperTag = wrapper >= 0 ? before.slice(wrapper, before.indexOf('>', wrapper) + 1) : ''
      if (!/table-scroll|overflow-x-auto/.test(wrapperTag)) {
        findings.push(finding('error', 'responsive/table', `a ${minWidth}px table has no scroll wrapper (add class="table-scroll")`, file))
      }
    }

    // Chrome sized in vh instead of dvh.
    if (/className=[^>]*\bh-screen\b/.test(source) && !/app-shell/.test(source)) {
      findings.push(finding('warn', 'responsive/dvh', 'h-screen without the .app-shell dvh fallback', file))
    }
  }
  return findings
}

// ─── Type scale usage ────────────────────────────────────────────────
export function auditTypeScale() {
  const findings = []
  const allowed = new Set(['8px']) // the chip counter, declared as --text-4xs
  for (const file of jsxFiles()) {
    const source = read(file)
    for (const match of source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
      if (allowed.has(`${match[1]}px`)) continue
      if (Number(match[1]) >= 12) continue
      findings.push(finding('warn', 'type/arbitrary-size', `text-[${match[1]}px] should use a token (text-2xs / text-3xs / text-4xs)`, file))
    }
    for (const match of source.matchAll(/(?:^|\s)(?:sm:|md:)?text-\[(\d+(?:\.\d+)?)px\]/g)) {
      if (Number(match[1]) < 10 && !allowed.has(`${match[1]}px`)) {
        findings.push(finding('error', 'type/floor', `text-[${match[1]}px] is below the 10px floor`, file))
      }
    }
  }
  return findings
}

export function runAudit() {
  const groups = {
    fonts: auditFonts(),
    css: auditCss(),
    responsive: auditResponsive(),
    type: auditTypeScale(),
  }
  return { groups, findings: Object.values(groups).flat() }
}

const LEVEL_ORDER = { error: 0, warn: 1 }

function main() {
  const { groups, findings } = runAudit()
  const sorted = findings.slice().sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
  for (const [group, list] of Object.entries(groups)) {
    const errors = list.filter((entry) => entry.level === 'error').length
    const warns = list.length - errors
    console.log(`\n${group.toUpperCase()}  ${errors} error(s), ${warns} warning(s)`)
    for (const entry of list.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])) {
      console.log(`  ${entry.level === 'error' ? '✗' : '•'} [${entry.rule}] ${entry.message}${entry.file ? `  (${entry.file})` : ''}`)
    }
  }
  const errors = sorted.filter((entry) => entry.level === 'error').length
  console.log(`\n${errors === 0 ? '✓' : '✗'} ${errors} error(s), ${sorted.length - errors} warning(s)`)
  return errors === 0 ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
