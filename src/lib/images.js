// ─── Item photos ────────────────────────────────────────────────────
// Owners photograph plates on a phone; the app has to keep those photos
// small enough to live in the state snapshot, so everything is resized
// and re-compressed in the browser before it is stored. No upload
// endpoint, no storage bill, no broken images offline.

import { MAX_IMAGE_CHARS } from './settings.js'

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif'

const loadImage = (src) => new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('That image could not be read.'))
  image.src = src
})

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(new Error('That file could not be read.'))
  reader.readAsDataURL(file)
})

/**
 * Shrink a chosen file to something a snapshot can carry.
 * Returns `{ dataUrl, width, height, kb, compressed }`.
 */
export async function readImageFile(file, { maxKb = 180, maxDim = 1024 } = {}) {
  if (!file) throw new Error('No file chosen.')
  if (!String(file.type || '').startsWith('image/')) throw new Error('Choose an image file (PNG, JPEG, WebP, or GIF).')

  const raw = await readAsDataUrl(file)
  if (!raw) throw new Error('That file could not be read.')
  const limitChars = Math.min(MAX_IMAGE_CHARS, Math.max(20000, maxKb * 1024 * 1.4))

  // Animated GIFs lose their animation on a canvas, so keep them as-is
  // when they already fit.
  if (file.type === 'image/gif' && raw.length <= limitChars) {
    return { dataUrl: raw, width: null, height: null, kb: Math.round(raw.length / 1024), compressed: false }
  }

  const image = await loadImage(raw)
  const scale = Math.min(1, maxDim / Math.max(image.width || maxDim, image.height || maxDim))
  const width = Math.max(1, Math.round((image.width || maxDim) * scale))
  const height = Math.max(1, Math.round((image.height || maxDim) * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return { dataUrl: raw.slice(0, limitChars), width, height, kb: Math.round(raw.length / 1024), compressed: false }
  // Photos go onto white so transparent PNGs do not turn black in JPEG.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)

  let dataUrl = canvas.toDataURL('image/webp', 0.85)
  if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  let quality = 0.85
  while (dataUrl.length > limitChars && quality > 0.35) {
    quality -= 0.12
    dataUrl = canvas.toDataURL('image/jpeg', quality)
  }
  return {
    dataUrl,
    width,
    height,
    kb: Math.round(dataUrl.length / 1024),
    compressed: true,
    oversized: dataUrl.length > limitChars,
  }
}

/** Is this a photo the app can show in an <img>? */
export function isDisplayableImage(value) {
  const raw = String(value || '').trim()
  if (!raw) return false
  return /^(https?:\/\/|\/|data:image\/)/i.test(raw)
}
