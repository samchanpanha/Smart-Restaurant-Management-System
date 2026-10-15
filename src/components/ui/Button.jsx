import { cva } from 'class-variance-authority'
import { cn } from '../../lib/cn'

// One button vocabulary for the whole app. Sizes keep the 44px tap-target
// floor at `md` and above; `sm` is reserved for dense office toolbars.
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-40',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--accent)] text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]',
        secondary: 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-hover)]',
        ghost: 'text-[var(--text)] hover:bg-[var(--surface-hover)]',
        subtle: 'bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent-soft)]',
        danger: 'bg-[var(--danger)] text-white hover:opacity-90',
        dangerGhost: 'text-[var(--danger)] hover:bg-[var(--danger-soft)]',
      },
      size: {
        sm: 'min-h-9 px-3 text-[var(--fs-label)]',
        md: 'min-h-11 px-4 text-[var(--fs-body)]',
        lg: 'min-h-12 px-5 text-[var(--fs-h3)]',
        icon: 'h-11 w-11 shrink-0',
      },
      block: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
)

export function Button({ className, variant, size, block, type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    />
  )
}

export function IconButton({ label, className, variant = 'ghost', size = 'icon', ...props }) {
  return (
    <Button
      variant={variant}
      size={size}
      aria-label={label}
      title={props.title || label}
      className={className}
      {...props}
    />
  )
}

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[var(--fs-caption)] font-semibold',
  {
    variants: {
      tone: {
        neutral: 'bg-[var(--surface-hover)] text-[var(--text-muted)]',
        accent: 'bg-[var(--accent-soft)] text-[var(--accent)]',
        success: 'bg-[var(--success-soft)] text-[var(--success)]',
        warning: 'bg-[var(--warning-soft)] text-[var(--warning)]',
        danger: 'bg-[var(--danger-soft)] text-[var(--danger)]',
        info: 'bg-[var(--info-soft)] text-[var(--info)]',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

// A dot + word, never color alone (status must read in a dark dining room).
export function Badge({ tone, dot = false, className, children, ...props }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}
