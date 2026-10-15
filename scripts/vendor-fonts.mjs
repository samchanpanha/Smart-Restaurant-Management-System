#!/usr/bin/env node
// ─── Vendor the UI fonts into public/fonts ───────────────────────────
// Restora ships its own type: Inter (Latin) + Noto Sans Khmer (Khmer script,
// which the UI and the Kitchen display both render). Serving them from our
// own origin means no Google Fonts request at runtime — the terminals keep
// working on a restaurant LAN with no internet, and the Docker image stays
// self-contained.
//
// The files come from @fontsource (dev dependencies), so refreshing them is
// `npm i -D @fontsource-variable/inter@latest` + `npm run fonts:sync`.
// `src/index.css` declares the matching @font-face blocks; tests/typography
// asserts the two stay in sync in both directions.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public', 'fonts')

// [source package file, public/fonts file]
export const FONT_FILES = [
  ['@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'inter-latin-wght-normal.woff2'],
  ['@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2', 'inter-latin-ext-wght-normal.woff2'],
  ['@fontsource-variable/noto-sans-khmer/files/noto-sans-khmer-khmer-wght-normal.woff2', 'noto-sans-khmer-khmer-wght-normal.woff2'],
]

export function vendorFonts({ quiet = false } = {}) {
  fs.mkdirSync(outDir, { recursive: true })
  const copied = []
  for (const [from, to] of FONT_FILES) {
    const src = path.join(root, 'node_modules', from)
    if (!fs.existsSync(src)) {
      throw new Error(`missing ${from} — run \`npm install\` (dev dependencies) first`)
    }
    const dest = path.join(outDir, to)
    fs.copyFileSync(src, dest)
    copied.push({ to, bytes: fs.statSync(dest).size })
  }
  if (!quiet) {
    const total = copied.reduce((sum, entry) => sum + entry.bytes, 0)
    for (const entry of copied) console.log(`  ${entry.to} ${(entry.bytes / 1024).toFixed(0)} KB`)
    console.log(`✓ ${copied.length} font files in public/fonts (${(total / 1024).toFixed(0)} KB total)`)
  }
  return copied
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  vendorFonts()
}
