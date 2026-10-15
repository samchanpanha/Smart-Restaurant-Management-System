// ─── Type system, as data ────────────────────────────────────────────
// The CSS and the print-document HTML have to agree on the same stack, and a
// print document is a standalone HTML string that can be opened outside the
// app, so it cannot rely on the app's stylesheet. This module is that single
// source of truth; `src/styles/fonts.css` mirrors the @font-face blocks (CSS
// cannot import JS) and tests/typography-css.test.js fails if the three ever
// drift apart.

/** UI stack. Inter first, then the script faces, then the OS faces. */
export const FONT_FAMILY_SANS = [
  'Inter Variable',
  'Inter',
  'Noto Sans Khmer Variable',
  'Noto Sans Khmer',
  'ui-sans-serif',
  'system-ui',
  '-apple-system',
  'Segoe UI',
  'Roboto',
  'Helvetica Neue',
  'Arial',
  // Chinese is intentionally not bundled (a usable CJK webfont is megabytes):
  // these are the faces the OS already ships.
  'PingFang SC',
  'Hiragino Sans GB',
  'Microsoft YaHei',
  'Noto Sans SC',
  'sans-serif',
]

/** Figures / SKUs / document numbers. Tabular by default where it matters. */
export const FONT_FAMILY_MONO = [
  'ui-monospace',
  'SFMono-Regular',
  'SF Mono',
  'Menlo',
  'Consolas',
  'Liberation Mono',
  'monospace',
]

/** Files vendored into public/fonts by `npm run fonts:sync`. */
export const FONT_FACES = [
  {
    family: 'Inter Variable',
    file: 'inter-latin-wght-normal.woff2',
    weight: '100 900',
    unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  },
  {
    family: 'Inter Variable',
    file: 'inter-latin-ext-wght-normal.woff2',
    weight: '100 900',
    unicodeRange: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  },
  {
    family: 'Noto Sans Khmer Variable',
    file: 'noto-sans-khmer-khmer-wght-normal.woff2',
    weight: '100 900',
    unicodeRange: 'U+1780-17FF, U+19E0-19FF, U+200C-200D, U+25CC',
  },
]

export const SANS_STACK = FONT_FAMILY_SANS.map((family) => (/^[A-Za-z-]+$/.test(family) ? family : `"${family}"`)).join(', ')
export const MONO_STACK = FONT_FAMILY_MONO.map((family) => (/^[A-Za-z-]+$/.test(family) ? family : `"${family}"`)).join(', ')

/**
 * `@font-face` blocks for a document that renders outside the app's stylesheet.
 * `base` defaults to the current origin at runtime, and an empty base returns
 * nothing at all: a document downloaded to disk then falls back to the OS
 * faces in the stack instead of pointing at a host that will not answer.
 */
export function fontFaceCss(base = '') {
  const prefix = typeof base === 'string' ? base.replace(/\/+$/, '') : ''
  if (!prefix) return ''
  return FONT_FACES.map((face) => `  @font-face {
    font-family: '${face.family}';
    font-style: normal;
    font-weight: ${face.weight};
    font-display: swap;
    src: url('${prefix}/fonts/${face.file}') format('woff2-variations');
    unicode-range: ${face.unicodeRange};
  }`).join('\n')
}

/** Same-origin base for the vendored fonts, or '' outside a browser. */
export function fontBase() {
  return typeof window !== 'undefined' && window.location ? window.location.origin : ''
}
