// ─── Guest location helpers ─────────────────────────────────────────
// Delivery needs an address plus, when the guest allows it, a map pin.
// We ask Telegram first (inside the mini app), then the browser. There is
// no maps API key and no reverse geocoding: the typed address is the
// human-readable source of truth, and the pin is the rider's shortcut.

export function validCoordinate(lat, lng) {
  const y = Number(lat)
  const x = Number(lng)
  return Number.isFinite(y) && Number.isFinite(x) && y >= -90 && y <= 90 && x >= -180 && x <= 180
}

export function hasCoordinates(value) {
  return Boolean(value && validCoordinate(value.lat, value.lng))
}

export function formatCoordinates(lat, lng) {
  if (!validCoordinate(lat, lng)) return ''
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`
}

/** A Google Maps link that needs no API key. Coordinates beat a typed address. */
export function googleMapsUrl({ lat, lng, address } = {}) {
  if (validCoordinate(lat, lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${Number(lat)},${Number(lng)}`
  }
  const query = String(address || '').trim()
  if (!query) return ''
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

function telegramLocation() {
  try {
    const manager = globalThis.window?.Telegram?.WebApp?.LocationManager
    if (!manager || typeof manager.init !== 'function' || typeof manager.getLocation !== 'function') return null
    return manager
  } catch {
    return null
  }
}

function browserLocation({ timeoutMs = 12000 } = {}) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.reject(new Error('This device cannot share a location. Type your address instead.'))
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords || {}
        if (!validCoordinate(latitude, longitude)) {
          reject(new Error('The location came back incomplete. Type your address instead.'))
          return
        }
        resolve({
          lat: Math.round(Number(latitude) * 1e6) / 1e6,
          lng: Math.round(Number(longitude) * 1e6) / 1e6,
          accuracy: Math.round(Number(accuracy) || 0),
          source: 'browser',
        })
      },
      (error) => {
        const message = error?.code === 1
          ? 'Location permission was denied. Type your address instead.'
          : error?.code === 3
            ? 'Finding your location took too long. Type your address instead.'
            : 'We could not find your location. Type your address instead.'
        reject(new Error(message))
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    )
  })
}

/**
 * Ask for one fix, preferring Telegram's native permission prompt.
 * Returns `{ lat, lng, accuracy, source }` or throws a guest-readable error.
 */
export async function getCurrentLocation(options = {}) {
  const manager = telegramLocation()
  if (manager) {
    try {
      await manager.init()
      const position = await manager.getLocation()
      const lat = Number(position?.latitude)
      const lng = Number(position?.longitude)
      if (validCoordinate(lat, lng)) {
        return {
          lat: Math.round(lat * 1e6) / 1e6,
          lng: Math.round(lng * 1e6) / 1e6,
          accuracy: Math.round(Number(position?.accuracy) || 0),
          source: 'telegram',
        }
      }
    } catch {
      // Not available or denied in Telegram — the browser may still work.
    }
  }
  return browserLocation(options)
}
