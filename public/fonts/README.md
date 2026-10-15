# Vendored fonts

These files are the app's type, served from our own origin — never a font CDN,
so a restaurant LAN without internet (and the Docker image) still renders
exactly the same as a dev machine.

| File | Family | Subset | Licence |
|---|---|---|---|
| `inter-latin-wght-normal.woff2` | Inter Variable (wght 100–900) | Latin | SIL OFL 1.1 |
| `inter-latin-ext-wght-normal.woff2` | Inter Variable | Latin extended | SIL OFL 1.1 |
| `noto-sans-khmer-khmer-wght-normal.woff2` | Noto Sans Khmer Variable (wght 100–900) | Khmer | SIL OFL 1.1 |

Both families are licensed under the **SIL Open Font License 1.1**, which allows
bundling and redistribution (including commercially). Upstream: Inter by Rasmus
Andersson (`rsms/inter`), Noto Sans Khmer by Google (`notofonts`). Keep the
licence text with any redistribution of the built app.

## How they are produced

```bash
npm install                 # pulls the @fontsource dev-dependencies
npm run fonts:sync          # copies the subsets above out of node_modules
npm run check:ui            # verifies every file here is declared in CSS
npm test                    # tests/typography-css.test.js asserts the pairing
```

`src/styles/fonts.css` declares the matching `@font-face` blocks (with
`font-display: swap` and the per-subset `unicode-range`), and `index.html`
preloads the Latin and Khmer subsets. If you add a file here, declare it there
too — both the audit and the test suite fail otherwise.

Chinese is deliberately **not** bundled: a usable CJK webfont is megabytes, so
the font stack falls through to the OS faces (`PingFang SC`, `Microsoft YaHei`,
`Noto Sans SC`). Script-aware sizing lives in `src/styles/typography.css`.
