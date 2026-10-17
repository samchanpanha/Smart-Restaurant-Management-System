export function getSavedPresets(screenKey) {
  try {
    const raw = localStorage.getItem(`restora.filters.${screenKey}.v1`)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function savePreset(screenKey, name, filters) {
  try {
    const existing = getSavedPresets(screenKey)
    const label = String(name || '').trim()
    if (!label) return existing
    const updated = [...existing.filter((p) => p.name !== label), { name: label, filters }]
    localStorage.setItem(`restora.filters.${screenKey}.v1`, JSON.stringify(updated))
    return updated
  } catch {
    return []
  }
}

export function deletePreset(screenKey, name) {
  try {
    const existing = getSavedPresets(screenKey)
    const updated = existing.filter((p) => p.name !== name)
    localStorage.setItem(`restora.filters.${screenKey}.v1`, JSON.stringify(updated))
    return updated
  } catch {
    return []
  }
}
