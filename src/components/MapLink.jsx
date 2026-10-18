import { Icon } from './Icon'
import { googleMapsUrl } from '../lib/geo'

/** A small no-key Google Maps link shared by guest and dashboard screens. */
export function MapLink({ lat, lng, address, className = '', label = 'Open in Google Maps', children = null }) {
  const href = googleMapsUrl({ lat, lng, address })
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex min-h-[32px] items-center gap-1 underline underline-offset-2 ${className}`}
    >
      <Icon name="pin" size={13} />
      {children || label}
    </a>
  )
}
