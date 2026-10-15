import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Merge conditional class lists, letting later Tailwind utilities win over
// earlier conflicting ones. Use everywhere instead of string concatenation.
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
