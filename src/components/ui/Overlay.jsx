import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

// Shared dialog behavior: Esc to close, focus moved in and restored, focus
// trapped inside, and background scroll locked. The legacy ui.jsx Modal had
// none of this.
function useDialog(panelRef, onClose) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const previouslyFocused = document.activeElement
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    const panel = panelRef.current
    const first = panel?.querySelector(FOCUSABLE)
    ;(first || panel)?.focus?.()

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose?.()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const nodes = Array.from(panel.querySelectorAll(FOCUSABLE)).filter((n) => n.offsetParent !== null)
      if (!nodes.length) return
      const firstNode = nodes[0]
      const lastNode = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === firstNode) {
        event.preventDefault()
        lastNode.focus()
      } else if (!event.shiftKey && document.activeElement === lastNode) {
        event.preventDefault()
        firstNode.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = overflow
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus?.()
    }
  }, [panelRef, onClose])
}

function OverlayRoot({ children, onClose, className }) {
  return (
    <div
      className={cn('fixed inset-0 flex bg-black/60 backdrop-blur-[2px]', className)}
      style={{ zIndex: 'var(--z-modal)' }}
      onClick={onClose}
    >
      {children}
    </div>
  )
}

function CloseButton({ onClose }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close dialog"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-xl text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
    >
      ×
    </button>
  )
}

export function Modal({ title, sub, onClose, children, wide = false, className, footer }) {
  const panelRef = useRef(null)
  useDialog(panelRef, onClose)
  if (typeof document === 'undefined') return null
  const titleId = title ? 'modal-title' : undefined
  return createPortal(
    <OverlayRoot onClose={onClose} className="items-center justify-center p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'restora-light max-h-[92vh] w-full overflow-y-auto rounded-[var(--radius-2xl)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-lg)] outline-none',
          wide ? 'max-w-2xl' : 'max-w-md',
          className,
        )}
      >
        {(title || onClose) && (
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="text-[var(--fs-h1)] font-bold tracking-tight text-[var(--text-strong)]">{title}</h2>
              {sub && <p className="mt-0.5 text-[var(--fs-label)] text-[var(--text-muted)]">{sub}</p>}
            </div>
            <CloseButton onClose={onClose} />
          </div>
        )}
        {children}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </OverlayRoot>,
    document.body,
  )
}

// Bottom sheet — the phone-first pattern for guests and mini-app flows.
export function Sheet({ title, label, onClose, children, tall = false, className }) {
  const panelRef = useRef(null)
  useDialog(panelRef, onClose)
  const titleId = useId()
  if (typeof document === 'undefined') return null
  return createPortal(
    <OverlayRoot onClose={onClose} className="items-end justify-center">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'restora-light w-full max-w-[520px] animate-status-in overflow-y-auto rounded-t-[var(--radius-2xl)] bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-lg)] outline-none',
          tall ? 'max-h-[90vh]' : 'max-h-[86vh]',
          'pb-[max(28px,env(safe-area-inset-bottom))]',
          className,
        )}
      >
        <div className="mx-auto mt-3 h-1.5 w-11 rounded-full bg-[var(--border-strong)]" />
        <div className="p-5">
          {title && <h2 id={titleId} className="mb-1 text-[var(--fs-h2)] font-bold text-[var(--text-strong)]">{title}</h2>}
          {children}
        </div>
      </div>
    </OverlayRoot>,
    document.body,
  )
}

export function Drawer({ title, onClose, children, side = 'right', width = 480, className }) {
  const panelRef = useRef(null)
  useDialog(panelRef, onClose)
  if (typeof document === 'undefined') return null
  return createPortal(
    <OverlayRoot onClose={onClose} className={side === 'right' ? 'justify-end' : 'justify-start'}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={{ width, maxWidth: '100%' }}
        className={cn('restora-light flex h-full flex-col overflow-y-auto bg-[var(--surface)] p-5 shadow-[var(--shadow-lg)] outline-none', className)}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-[var(--fs-h2)] font-bold text-[var(--text-strong)]">{title}</h2>
          <CloseButton onClose={onClose} />
        </div>
        {children}
      </div>
    </OverlayRoot>,
    document.body,
  )
}
